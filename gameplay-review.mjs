import assert from 'node:assert/strict';
import {createGame, current, legalMoves, roll, move} from './public/engine.mjs';

// Independent rule expectations, not calls to the production guidance helpers.
// Capturing pieces lock; victims stay captured. “Home” in the owner's release
// exception means an unstarted yard piece, not a piece that has finished.
const starts = [0, 13, 26, 39];
const safeSquares = new Set([0, 8, 13, 21, 26, 34, 39, 47]);
let checks = 0, cases = 0;
function test(name, run) { run(); checks++; console.log('PASS', name); }
function forEachSeat(run) {
  for (const count of [2, 3, 4]) {
    const initial = createGame(count);
    for (let turn = 0; turn < count; turn++) {
      const state = structuredClone(initial);
      state.turn = turn;
      run(state, state.players[turn]);
    }
  }
}
function expectedChoices(state) {
  return state.tokens[state.players[state.turn]].flatMap((position, index) => {
    if (state.locked.includes(index) || position === 56) return [];
    if (position === -1) return state.dice === 6 ? [index] : [];
    return position + state.dice <= 56 ? [index] : [];
  });
}
function captureFixture(player, victim, other = [56, 56, 56]) {
  const state = createGame(4);
  state.turn = player;
  // This unsafe destination has a reachable ring position for every color.
  const target = 16;
  const to = (target - starts[player] + 52) % 52;
  const opponent = (target - starts[victim] + 52) % 52;
  state.tokens[player] = [to - 2, ...other];
  state.tokens[victim][0] = opponent;
  return state;
}

test('legal-choice oracle covers every board position, die, lock mask and supported seat', () => {
  forEachSeat((initial, player) => {
    for (let position = -1; position <= 56; position++) {
      for (let die = 1; die <= 6; die++) {
        for (let mask = 0; mask < 16; mask++) {
          const state = structuredClone(initial);
          state.tokens[player] = [position, 55, -1, 56];
          state.dice = die;
          state.locked = [0, 1, 2, 3].filter(index => mask & (1 << index));
          assert.deepEqual(legalMoves(state), expectedChoices(state));
          cases++;
        }
      }
    }
  });
});

test('every color captures only unsafe ring stacks and an unusable bonus preserves that checkpoint', () => {
  for (let player = 0; player < 4; player++) {
    for (let to = 1; to <= 50; to++) {
      for (let die = 1; die <= Math.min(6, to); die++) {
        const state = createGame(4);
        state.turn = player;
        state.tokens[player] = [to - die, 56, 56, 56];
        const target = (starts[player] + to) % 52;
        const expectedVictims = [];
        for (let other = 0; other < 4; other++) {
          if (other === player) continue;
          const at = (target - starts[other] + 52) % 52;
          if (at <= 50) {
            state.tokens[other] = [at, at, -1, -1];
            if (!safeSquares.has(target)) expectedVictims.push(other);
          }
        }
        const original = JSON.stringify(state);
        const rolled = roll(state, die).state;
        const result = move(rolled, 0).state;
        assert.equal(JSON.stringify(state), original, 'Inputs remain immutable');
        assert.equal(result.tokens[player][0], to);
        for (let other = 0; other < 4; other++) {
          if (other === player) continue;
          assert.deepEqual(result.tokens[other], expectedVictims.includes(other)
            ? [-1, -1, -1, -1] : state.tokens[other]);
        }
        if (expectedVictims.length) {
          assert.deepEqual(result.locked, [0]);
          assert.deepEqual(result.snapshot, result.tokens);
          for (let bonus = 1; bonus <= 6; bonus++) {
            const expired = roll(result, bonus).state;
            assert.deepEqual(expired.tokens, result.tokens, 'Capture must never be undone');
            assert.equal(current(expired), (player + 1) % 4);
            assert.equal(expired.snapshot, null);
            assert.deepEqual(expired.locked, []);
          }
        } else {
          assert.deepEqual(result.locked, []);
        }
        cases++;
      }
    }
  }
});

test('capture lock survives serialization and six can release only an unfinished yard piece', () => {
  for (let player = 0; player < 4; player++) {
    const victim = (player + 1) % 4;
    let state = captureFixture(player, victim, [55, -1, 56]);
    state = move(roll(state, 2).state, 0).state;
    state = JSON.parse(JSON.stringify(state));
    const committed = structuredClone(state.tokens);
    const bonus = roll(state, 6).state;
    assert.deepEqual(legalMoves(bonus), [2]);
    assert.throws(() => move(bonus, 0), /Illegal move/);
    assert.throws(() => move(bonus, 1), /Illegal move/);
    assert.throws(() => move(bonus, 3), /Illegal move/);
    state = move(bonus, 2).state;
    assert.equal(state.tokens[player][2], 0);
    assert.equal(state.tokens[victim][0], -1);
    assert.deepEqual(state.locked, [0]);
    state = move(roll(state, 6).state, 2).state;
    state = roll(state, 6).state;
    assert.deepEqual(state.tokens, committed, 'Third-six rollback keeps the capture but undoes yard release');
    cases++;
  }
});

test('exact fourth-piece finishes win for every die, token index and supported seat', () => {
  forEachSeat((initial, player) => {
    for (let index = 0; index < 4; index++) {
      for (let die = 1; die <= 6; die++) {
        const state = structuredClone(initial);
        state.tokens[player].fill(56);
        state.tokens[player][index] = 56 - die;
        const result = move(roll(state, die).state, index).state;
        assert.equal(result.winner, player);
        assert.equal(result.dice, null);
        assert.equal(result.sixes, 0);
        assert.equal(result.snapshot, null);
        assert.deepEqual(result.locked, []);
        assert.deepEqual(result.tokens[player], [56, 56, 56, 56]);
        assert.deepEqual(legalMoves(result), []);
        assert.throws(() => roll(result, 1), /Illegal roll/);
        cases++;
      }
    }
  });
});

test('an unusable six passes immediately rather than waiting for a later exact-home roll', () => {
  forEachSeat((initial, player) => {
    for (let remaining = 1; remaining <= 5; remaining++) {
      const state = structuredClone(initial);
      state.tokens[player] = [56 - remaining, 56, 56, 56];
      const result = roll(state, 6).state;
      assert.equal(result.turn, (state.turn + 1) % state.players.length);
      assert.equal(result.dice, null);
      assert.equal(result.winner, null);
      assert.deepEqual(result.tokens, state.tokens);
      const withYard = structuredClone(state);
      withYard.tokens[player][1] = -1;
      const usable = roll(withYard, 6).state;
      assert.equal(usable.turn, state.turn);
      assert.deepEqual(legalMoves(usable), [1]);
      cases++;
    }
  });
});

test('a non-final six-to-home move is undone after bonus failure unless a capture committed it', () => {
  forEachSeat((initial, player) => {
    const state = structuredClone(initial);
    state.tokens[player] = [50, 55, 56, 56];
    const finished = move(roll(state, 6).state, 0).state;
    assert.equal(finished.tokens[player][0], 56);
    assert.equal(finished.turn, state.turn);
    const failed = roll(finished, 6).state;
    assert.deepEqual(failed.tokens, state.tokens);
    assert.equal(failed.turn, (state.turn + 1) % state.players.length);
    cases++;
  });
});

console.log(`${checks} independent gameplay properties passed across ${cases} deterministic cases.`);
