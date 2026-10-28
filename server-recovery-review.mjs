import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {api} from './worker/api.mjs';
import {createGame} from './public/engine.mjs';

const TTL = 24 * 60 * 60 * 1000;
const now = Date.now;
const randomValues = crypto.getRandomValues;
let clock = 1_800_000_000_000, nextDie = 1, sequence = 0, passed = 0;
// Only this isolated test process controls time/dice. Production remains secure
// server-generated randomness; clients still cannot choose a result.
Date.now = () => clock;
crypto.getRandomValues = array => { array[0] = nextDie - 1; return array; };
const tokens = ['a', 'b', 'c', 'd'].map(char => char.repeat(64));
const actionId = () => (++sequence).toString(16).padStart(32, '0');
function fixture() {
  let beforeWrite = null;
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('./drizzle/0000_rooms.sql', import.meta.url), 'utf8'));
  const env = {DB: {prepare(sql) {
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async first() { return db.prepare(sql).get(...values) ?? null; },
      async run() { if (sql.startsWith('UPDATE rooms') && beforeWrite) { const hook = beforeWrite; beforeWrite = null; await hook(); } return {meta: db.prepare(sql).run(...values)}; },
    };
  }}};
  async function request(path, data) {
    const response = await api(new Request('https://ludo.test' + path, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data),
    }), env);
    return {status: response.status, body: await response.json()};
  }
  async function room(count = 2) {
    const created = await request('/api/create', {token: tokens[0], count});
    assert.equal(created.status, 200);
    let view = created.body;
    for (let seat = 1; seat < count; seat++) {
      const joined = await request('/api/join/' + view.code, {token: tokens[seat]});
      assert.equal(joined.status, 200);
      view = joined.body;
    }
    return view;
  }
  function seed(code, state) {
    const row = db.prepare('SELECT * FROM rooms WHERE code = ?').get(code);
    const data = JSON.parse(row.data);
    data.state = state; data.actions = []; data.events = [];
    db.prepare('UPDATE rooms SET data = ? WHERE code = ?').run(JSON.stringify(data), code);
    return row.version;
  }
  return {db, request, room, seed, interceptWrite(hook) { beforeWrite = hook; }};
}
async function test(name, run) { await run(); passed++; console.log('PASS', name); }

try {
  await test('Create retry one millisecond before expiry preserves the existing game and seats', async () => {
    const f = fixture(), first = await f.room();
    const state = createGame(); state.tokens[0][0] = 12;
    f.seed(first.code, state);
    clock = first.expires - 1;
    const retry = await f.request('/api/create', {token: tokens[0], count: 4});
    assert.equal(retry.status, 200);
    assert.equal(retry.body.expires, first.expires);
    assert.equal(retry.body.state.players.length, 2);
    assert.equal(retry.body.state.tokens[0][0], 12);
    assert.deepEqual(retry.body.joined, [true, true]);
    f.db.close();
  });

  for (const offset of [0, 1]) {
    await test(`Create retry ${offset === 0 ? 'at' : 'after'} exact expiry yields an immediately usable fresh table`, async () => {
      const f = fixture(), first = await f.room();
      clock = first.expires + offset;
      const retry = await f.request('/api/create', {token: tokens[0], count: 3});
      assert.equal(retry.status, 200);
      assert.equal(retry.body.expires, clock + TTL, 'Expired row must be replaced, not returned as a success');
      assert.equal(retry.body.version, 0);
      assert.equal(retry.body.state.players.length, 3);
      assert.deepEqual(retry.body.joined, [true, false, false]);
      const read = await f.request('/api/state/' + retry.body.code, {token: tokens[0]});
      assert.equal(read.status, 200, 'A successful Create must not immediately return room_unavailable');
      assert.deepEqual(read.body.state, createGame(3));
      const oldGuest = await f.request('/api/state/' + retry.body.code, {token: tokens[1]});
      assert.equal(oldGuest.status, 403);
      assert.equal(oldGuest.body.errorCode, 'seat_missing');
      assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n, 1);
      f.db.close();
    });
  }

  await test('simultaneous same-token retries at expiry create only one usable replacement', async () => {
    const f = fixture(), first = await f.room(); clock = first.expires;
    const responses = await Promise.all(Array.from({length: 4}, () =>
      f.request('/api/create', {token: tokens[0], count: 4})));
    assert.ok(responses.every(r => r.status === 200 && r.body.expires === clock + TTL));
    assert.equal(new Set(responses.map(r => r.body.code)).size, 1);
    assert.ok(responses.every(r => r.body.version === 0));
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM rooms').get().n, 1);
    const read = await f.request('/api/state/' + first.code, {token: tokens[0]});
    assert.equal(read.status, 200);
    f.db.close();
  });

  await test('expiry identifies each incarnation even with fixed-clock same-token recreation retries', async () => {
    const f = fixture();
    let view = (await f.request('/api/create', {token: tokens[0], count: 2})).body;
    for (let generation = 0; generation < 4; generation++) {
      const oldExpiry = view.expires;
      clock = oldExpiry;
      view = (await f.request('/api/create', {token: tokens[0], count: 2})).body;
      assert.equal(view.expires, oldExpiry + TTL);
      assert.equal(view.version, 0);
      const retries = await Promise.all(Array.from({length: 3}, () =>
        f.request('/api/create', {token: tokens[0], count: 4})));
      for (const retry of retries) {
        assert.equal(retry.status, 200);
        assert.deepEqual(retry.body, view, 'Same-clock retries reuse, never recreate, the live incarnation');
      }
    }
    f.db.close();
  });

  await test('a delayed old join cannot overwrite a recreated room with the same code and version', async () => {
    const f = fixture();
    const first = (await f.request('/api/create', {token: tokens[0], count: 2})).body;
    let replacement;
    f.interceptWrite(async () => {
      clock = first.expires;
      replacement = (await f.request('/api/create', {token: tokens[0], count: 4})).body;
    });
    const delayed = await f.request('/api/join/' + first.code, {token: tokens[1]});
    assert.equal(delayed.status, 404, 'Expired generation must not join its replacement');
    assert.equal(delayed.body.errorCode, 'room_unavailable');
    const actual = await f.request('/api/state/' + first.code, {token: tokens[0]});
    assert.deepEqual(actual.body, replacement, 'Fresh four-seat table must remain unchanged');
    f.db.close();
  });

  await test('a delayed old action cannot resurrect its board in a recreated same-version room', async () => {
    const f = fixture(), first = await f.room();
    const state = createGame(); state.turn = 1; state.tokens[2][0] = 12;
    f.seed(first.code, state);
    let replacement;
    nextDie = 6;
    f.interceptWrite(async () => {
      clock = first.expires;
      await f.request('/api/create', {token: tokens[0], count: 2});
      replacement = (await f.request('/api/join/' + first.code, {token: tokens[2]})).body;
    });
    const delayed = await f.request('/api/action/' + first.code, {
      token: tokens[1], version: first.version, actionId: actionId(), kind: 'roll',
    });
    assert.equal(delayed.status, 404, 'Expired generation must not mutate its replacement');
    assert.equal(delayed.body.errorCode, 'room_unavailable');
    const actual = await f.request('/api/state/' + first.code, {token: tokens[2]});
    assert.deepEqual(actual.body, replacement, 'New board and replacement guest must remain unchanged');
    f.db.close();
  });

  await test('a rejected old action does not return a replacement board to its former guest', async () => {
    const f = fixture(), first = await f.room();
    const state = createGame(); state.turn = 1; f.seed(first.code, state);
    f.interceptWrite(async () => {
      clock = first.expires;
      await f.request('/api/create', {token: tokens[0], count: 4});
    });
    const delayed = await f.request('/api/action/' + first.code, {
      token: tokens[1], version: first.version, actionId: actionId(), kind: 'roll',
    });
    assert.equal(delayed.status, 404);
    assert.equal(delayed.body.errorCode, 'room_unavailable');
    assert.equal(delayed.body.state, undefined, 'Old seat must not receive a new incarnation');
    f.db.close();
  });

  for (const kind of ['join', 'action']) {
    await test(`a delayed ${kind} handles a deleted old room as terminal, not a retryable failure`, async () => {
      const f = fixture();
      const first = kind === 'join'
        ? (await f.request('/api/create', {token: tokens[0], count: 2})).body : await f.room();
      f.interceptWrite(async () => {
        clock = first.expires;
        f.db.prepare('DELETE FROM rooms WHERE code = ?').run(first.code);
      });
      const delayed = await f.request('/api/' + kind + '/' + first.code, {
        token: kind === 'join' ? tokens[1] : tokens[0],
        version: first.version, actionId: actionId(), kind: 'roll',
      });
      assert.equal(delayed.status, 404);
      assert.equal(delayed.body.errorCode, 'room_unavailable');
      f.db.close();
    });
  }

  await test('same-generation action contention still returns the authoritative board and safe retry', async () => {
    const f = fixture(), first = await f.room(); nextDie = 6;
    const winnerInput = {token: tokens[0], version: first.version, actionId: actionId(), kind: 'roll'};
    let winner;
    f.interceptWrite(async () => { winner = await f.request('/api/action/' + first.code, winnerInput); });
    const loser = await f.request('/api/action/' + first.code, {
      token: tokens[0], version: first.version, actionId: actionId(), kind: 'roll',
    });
    assert.equal(winner.status, 200);
    assert.equal(loser.status, 409);
    assert.deepEqual(loser.body.state, winner.body.state);
    assert.equal(loser.body.version, first.version + 1);
    const retry = await f.request('/api/action/' + first.code, winnerInput);
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body, winner.body);
    f.db.close();
  });

  await test('a lost capture response reconnects with the lock and checkpoint intact for every seat', async () => {
    for (let player = 0; player < 4; player++) {
      const f = fixture(), initial = await f.room(4), code = initial.code;
      const state = createGame(4), starts = [0, 13, 26, 39], victim = (player + 1) % 4;
      state.turn = player;
      state.tokens[player] = [(16 - starts[player] + 52) % 52 - 2, 50, 56, 56];
      state.tokens[victim][0] = (16 - starts[victim] + 52) % 52;
      f.seed(code, state);
      let view = (await f.request('/api/state/' + code, {token: tokens[player]})).body;
      async function act(kind, index, die) {
        if (die) nextDie = die;
        const input = {token: tokens[player], version: view.version, actionId: actionId(), kind, index};
        const response = await f.request('/api/action/' + code, input);
        assert.equal(response.status, 200, JSON.stringify(response.body)); view = response.body;
        return input;
      }
      await act('roll', undefined, 2);
      const captureRequest = await act('move', 0);
      const committed = structuredClone(view.state.tokens);
      // Simulate losing the response: rebuild the client's state through /state.
      const reconnected = await f.request('/api/state/' + code, {token: tokens[player]});
      assert.equal(reconnected.status, 200);
      assert.deepEqual(reconnected.body.state.locked, [0]);
      assert.deepEqual(reconnected.body.state.snapshot, committed);
      assert.equal(reconnected.body.state.tokens[victim][0], -1);
      view = reconnected.body;
      await act('roll', undefined, 6);
      const beforeRejected = JSON.stringify(view);
      const illegal = await f.request('/api/action/' + code, {
        token: tokens[player], version: view.version, actionId: actionId(), kind: 'move', index: 0,
      });
      assert.equal(illegal.status, 409, 'A capture-locked token cannot move after reconnect');
      const afterRejected = await f.request('/api/state/' + code, {token: tokens[player]});
      assert.equal(JSON.stringify(afterRejected.body), beforeRejected);
      const duplicate = await f.request('/api/action/' + code, captureRequest);
      assert.equal(duplicate.status, 200);
      assert.equal(duplicate.body.version, view.version);
      assert.deepEqual(duplicate.body.state, view.state, 'Old retry returns latest state, not old capture state');
      const homeRequest = await act('move', 1);
      assert.equal(view.state.tokens[player][1], 56);
      await act('roll', undefined, 6);
      assert.deepEqual(view.state.tokens, committed, 'Failed bonus reverses only post-capture movement');
      assert.equal(view.state.turn, (player + 1) % 4);
      const retryHome = await f.request('/api/action/' + code, homeRequest);
      assert.equal(retryHome.status, 200);
      assert.deepEqual(retryHome.body.state.tokens, committed, 'Late retry cannot replay a rolled-back move');
      assert.equal(retryHome.body.version, view.version);
      f.db.close();
    }
  });

  await test('lost exact-six victory response retries once without another roll or reopening the game', async () => {
    const f = fixture(), initial = await f.room(), code = initial.code;
    const state = createGame(); state.tokens[0] = [56, 56, 56, 50];
    let version = f.seed(code, state); nextDie = 6;
    const rolled = await f.request('/api/action/' + code, {
      token: tokens[0], version, actionId: actionId(), kind: 'roll',
    });
    assert.equal(rolled.status, 200); version = rolled.body.version;
    const input = {token: tokens[0], version, actionId: actionId(), kind: 'move', index: 3};
    const won = await f.request('/api/action/' + code, input);
    const retry = await f.request('/api/action/' + code, input);
    assert.equal(won.status, 200); assert.equal(retry.status, 200);
    assert.equal(won.body.state.winner, 0);
    assert.deepEqual(retry.body, won.body);
    const extra = await f.request('/api/action/' + code, {
      token: tokens[0], version: won.body.version, actionId: actionId(), kind: 'roll',
    });
    assert.equal(extra.status, 409);
    assert.equal((await f.request('/api/state/' + code, {token: tokens[0]})).body.version, won.body.version);
    f.db.close();
  });
} finally {
  Date.now = now;
  crypto.getRandomValues = randomValues;
}
console.log(`${passed} authoritative expiry/reconnect checks passed.`);
