import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {readFileSync} from 'node:fs';
import {api} from './worker/api.mjs';

const CAP = 2000, TTL = 24 * 60 * 60 * 1000;
const now = Date.now;
const clock = 1_800_000_000_000;
Date.now = () => clock;
const tokens = ['a', 'b'].map(char => char.repeat(64));
let passed = 0;

function fixture() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('./drizzle/0000_rooms.sql', import.meta.url), 'utf8'));
  let beforeInsert = null, insertFailure = null, reads = 0, writes = 0;
  const env = {DB: {prepare(sql) {
    let values = [];
    return {
      bind(...args) { values = args; return this; },
      async first() { reads++; return db.prepare(sql).get(...values) ?? null; },
      async run() {
        if (sql.startsWith('INSERT')) {
          if (beforeInsert) await beforeInsert();
          if (insertFailure === 'before') { insertFailure = null; throw Error('SQLITE_SYNTHETIC private diagnostic'); }
        }
        writes++;
        const meta = db.prepare(sql).run(...values);
        if (sql.startsWith('INSERT') && insertFailure === 'after') {
          insertFailure = null; throw Error('SQLITE_SYNTHETIC private diagnostic after commit');
        }
        return {meta};
      },
    };
  }}};
  async function request(path, data) {
    const response = await api(new Request('https://ludo.test' + path, {
      method: 'POST', headers: {'Content-Type': 'application/json'}, body: JSON.stringify(data),
    }), env);
    assert.equal(response.headers.get('Cache-Control'), 'no-store');
    return {status: response.status, body: await response.json()};
  }
  const create = (token = tokens[0], count = 2) => request('/api/create', {token, count});
  function seed(count, expires = clock + TTL, start = 0) {
    const statement = db.prepare('INSERT INTO rooms (code,data,version,expires) VALUES (?,?,0,?)');
    for (let i = start; i < start + count; i++) {
      statement.run(i.toString(16).padStart(16, '0').toUpperCase(), '{}', expires);
    }
  }
  function rendezvous(count) {
    let arrivals = 0, release;
    const gate = new Promise(resolve => { release = resolve; });
    beforeInsert = async () => {
      if (++arrivals === count) { beforeInsert = null; release(); }
      let timer;
      try {
        await Promise.race([gate, new Promise((_, reject) => {
          timer = setTimeout(() => reject(Error('Synthetic insert rendezvous timed out')), 3000);
        })]);
      } finally { clearTimeout(timer); }
    };
  }
  return {db, request, create, seed, rendezvous,
    queries: () => ({reads, writes}),
    total: () => db.prepare('SELECT COUNT(*) AS total FROM rooms').get().total,
    failInsert(at) { insertFailure = at; },
  };
}

async function test(name, run) {
  const f = fixture();
  try { await run(f); passed++; console.log('PASS', name); }
  finally { f.db.close(); }
}

try {
  await test('distinct concurrent creates below capacity both receive usable tables', async f => {
    f.seed(CAP - 2); f.rendezvous(2);
    const responses = await Promise.all(tokens.map(token => f.create(token)));
    assert.deepEqual(responses.map(r => r.status), [200, 200]);
    assert.equal(new Set(responses.map(r => r.body.code)).size, 2);
    assert.equal(f.total(), CAP);
    for (const r of responses) assert.deepEqual(r.body.joined, [true, false]);
  });

  await test('distinct concurrent creates cannot both claim the final capacity slot', async f => {
    f.seed(CAP - 1); f.rendezvous(2);
    const responses = await Promise.all(tokens.map(token => f.create(token)));
    assert.deepEqual(responses.map(r => r.status).sort(), [200, 503]);
    assert.equal(f.total(), CAP);
    const rejected = responses.find(r => r.status === 503);
    assert.match(rejected.body.error, /All tables are busy/);
    assert.deepEqual(Object.keys(rejected.body), ['error']);
  });

  await test('new creation at capacity is rejected without changing existing rows', async f => {
    f.seed(CAP);
    const before = f.db.prepare('SELECT * FROM rooms ORDER BY code').all();
    const response = await f.create();
    assert.equal(response.status, 503);
    assert.match(response.body.error, /All tables are busy/);
    assert.deepEqual(f.db.prepare('SELECT * FROM rooms ORDER BY code').all(), before);
  });

  await test('same-token concurrent creates share the final slot and both succeed', async f => {
    f.seed(CAP - 1); f.rendezvous(2);
    const responses = await Promise.all([f.create(), f.create()]);
    assert.deepEqual(responses.map(r => r.status), [200, 200]);
    assert.deepEqual(responses[0].body, responses[1].body);
    assert.equal(f.total(), CAP);
    assert.equal(responses[0].body.version, 0);
  });

  await test('existing same-token retry at capacity preserves the original room', async f => {
    const original = await f.create();
    f.seed(CAP - 1);
    const retry = await f.create(tokens[0], 4);
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body, original.body);
    assert.equal(f.total(), CAP);
  });

  await test('expired records and an expired same-token room release capacity for recreation', async f => {
    const original = await f.create();
    f.db.prepare('UPDATE rooms SET expires=? WHERE code=?').run(clock, original.body.code);
    f.seed(CAP - 1);
    f.seed(2, clock - 1, CAP);
    assert.equal(f.total(), CAP + 2);
    const replacement = await f.create(tokens[0], 3);
    assert.equal(replacement.status, 200);
    assert.equal(replacement.body.code, original.body.code);
    assert.equal(replacement.body.expires, clock + TTL);
    assert.deepEqual(replacement.body.joined, [true, false, false]);
    assert.equal(f.total(), CAP);
    assert.equal(f.db.prepare('SELECT COUNT(*) AS n FROM rooms WHERE expires<=?').get(clock).n, 0);
  });

  await test('failed admission returns a sanitized retryable error and leaves capacity available', async f => {
    f.seed(CAP - 1); f.failInsert('before');
    const failure = await f.create();
    assert.equal(failure.status, 503);
    assert.deepEqual(failure.body, {error: 'Could not reach the table. Please retry in a moment.'});
    assert.equal(f.total(), CAP - 1);
    const retry = await f.create();
    assert.equal(retry.status, 200);
    assert.equal(f.total(), CAP);
  });

  await test('lost post-commit result retries idempotently even when admission filled capacity', async f => {
    f.seed(CAP - 1); f.failInsert('after');
    const failure = await f.create();
    assert.equal(failure.status, 503);
    assert.deepEqual(failure.body, {error: 'Could not reach the table. Please retry in a moment.'});
    assert.equal(f.total(), CAP);
    const retry = await f.create();
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body.joined, [true, false]);
    assert.equal(retry.body.version, 0);
    assert.equal(f.total(), CAP);
  });
  await test('non-string tokens reject before database access on every API route', async f => {
    const malformed = [[tokens[0]], [[tokens[0]]], {toString: tokens[0]}, {}, null, 1];
    for (const path of ['/api/create', '/api/state/0000000000000000', '/api/join/0000000000000000', '/api/action/0000000000000000']) {
      for (const token of malformed) {
        const before = f.queries();
        const response = await f.request(path, {token, count: 2});
        assert.equal(response.status, 401, `${path}: ${JSON.stringify(token)}`);
        assert.equal(response.body.errorCode, 'invalid_session');
        assert.deepEqual(f.queries(), before, 'Invalid token must not reach the database');
      }
    }
    assert.equal(f.total(), 0);
  });

  await test('non-string action IDs reject without changing room state or replay history', async f => {
    const created = await f.create();
    const joined = await f.request('/api/join/' + created.body.code, {token: tokens[1]});
    assert.equal(joined.status, 200);
    const view = joined.body, id = 'f'.repeat(32);
    const before = f.db.prepare('SELECT * FROM rooms WHERE code=?').get(view.code);
    for (const actionId of [[id], [[id]], {toString: id}, {}, null, 1]) {
      const writes = f.queries().writes;
      const response = await f.request('/api/action/' + view.code, {
        token: tokens[0], kind: 'roll', version: view.version, actionId,
      });
      assert.equal(response.status, 400, JSON.stringify(actionId));
      assert.deepEqual(response.body, {error: 'Invalid action.'});
      assert.equal(f.queries().writes, writes);
      assert.deepEqual(f.db.prepare('SELECT * FROM rooms WHERE code=?').get(view.code), before);
    }
  });

  await test('primitive-string tokens and action IDs preserve successful same-action retries', async f => {
    const created = await f.create();
    const joined = await f.request('/api/join/' + created.body.code, {token: tokens[1]});
    assert.equal(joined.status, 200);
    const view = joined.body, actionId = 'f'.repeat(32);
    const input = {token: tokens[0], kind: 'roll', version: view.version, actionId};
    const first = await f.request('/api/action/' + view.code, input);
    assert.equal(first.status, 200);
    const before = f.db.prepare('SELECT * FROM rooms WHERE code=?').get(view.code);
    const writes = f.queries().writes;
    const retry = await f.request('/api/action/' + view.code, input);
    assert.equal(retry.status, 200);
    assert.deepEqual(retry.body, first.body);
    assert.equal(retry.body.version, view.version + 1);
    assert.equal(f.queries().writes, writes);
    assert.deepEqual(f.db.prepare('SELECT * FROM rooms WHERE code=?').get(view.code), before);
  });
} finally { Date.now = now; }

console.log(`${passed} authoritative request-boundary checks passed.`);
