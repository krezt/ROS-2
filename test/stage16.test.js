import test from 'node:test';
import assert from 'node:assert/strict';
import {
  MatchRoom,
  RoundCoordinator,
  ROUND_COORDINATOR_STATUS,
  generateServerRoundSeed
} from '../src/round-coordinator.js';
import { hashRoundPackage } from '../src/determinism.js';

const A_DECL = [{ actorId: 'H0', kind: 'HOLD' }];
const B_DECL = [{ actorId: 'G0', kind: 'HOLD' }];

function digest(overrides = {}) {
  return {
    protocolVersion: 'ros2-protocol-1',
    rulesetVersion: 'ros2-ruleset-stage16',
    matchId: 'm1',
    roundNumber: 1,
    declarationsHash: 'decl',
    finalStateHash: 'state',
    eventStreamHash: 'events',
    gameplayRngDrawCount: 9,
    finalGameplayRngState: 123456,
    ...overrides
  };
}

function coordinator(seed = 424242) {
  return new RoundCoordinator({
    matchId: 'm1',
    protocolVersion: 'ros2-protocol-1',
    rulesetVersion: 'ros2-ruleset-stage16',
    seedFactory: () => seed
  });
}

test('server seed source produces non-zero uint32 and normalizes zero', () => {
  const zero = Buffer.alloc(4);
  assert.equal(generateServerRoundSeed(() => zero), 1);
  const b = Buffer.alloc(4); b.writeUInt32BE(0xffffffff);
  assert.equal(generateServerRoundSeed(() => b), 0xffffffff);
});

test('room hard caps at two players and assigns A then B', () => {
  const room = new MatchRoom({ id: 'r' });
  assert.equal(room.addPlayer('p1'), 'A');
  assert.equal(room.addPlayer('p2'), 'B');
  assert.equal(room.isReady(), true);
  assert.throws(() => room.addPlayer('p3'), /ROOM_FULL/);
});

test('one side cannot release a round package alone', () => {
  const c = coordinator();
  c.submitDeclarations('A', A_DECL);
  assert.equal(c.canReleaseRound(), false);
  assert.throws(() => c.releaseRoundPackage(), /Both sides/);
});

test('declarations lock once per side and remain private coordinator submissions', () => {
  const c = coordinator();
  c.submitDeclarations('A', A_DECL);
  assert.throws(() => c.submitDeclarations('A', A_DECL), /already submitted/);
  assert.equal(c.submissions.has('B'), false);
});

test('server issues the gameplay seed only after both sides lock', () => {
  let calls = 0;
  const c = new RoundCoordinator({ matchId: 'm1', seedFactory: () => { calls++; return 77; } });
  c.submitDeclarations('A', A_DECL);
  assert.equal(calls, 0);
  c.submitDeclarations('B', B_DECL);
  assert.equal(calls, 0);
  const pkg = c.releaseRoundPackage();
  assert.equal(calls, 1);
  assert.equal(pkg.gameplaySeed, 77);
});

test('released package contains both locked declarations and deterministic package hash', () => {
  const c = coordinator(99);
  c.submitDeclarations('B', B_DECL);
  c.submitDeclarations('A', A_DECL);
  const pkg = c.releaseRoundPackage();
  assert.deepEqual(pkg.declarationsA, A_DECL);
  assert.deepEqual(pkg.declarationsB, B_DECL);
  const { packageHash, ...body } = pkg;
  assert.equal(packageHash, hashRoundPackage(body));
});

test('round package seed cannot be supplied by either client', () => {
  const c = coordinator(555);
  c.submitDeclarations('A', [{ ...A_DECL[0], gameplaySeed: 1 }]);
  c.submitDeclarations('B', [{ ...B_DECL[0], gameplaySeed: 2 }]);
  const pkg = c.releaseRoundPackage();
  assert.equal(pkg.gameplaySeed, 555);
});

test('matching client digests confirm the round', () => {
  const c = coordinator();
  c.submitDeclarations('A', A_DECL); c.submitDeclarations('B', B_DECL); c.releaseRoundPackage();
  const first = c.submitDigest('A', digest());
  assert.equal(first.waitingForOpponent, true);
  const second = c.submitDigest('B', digest());
  assert.equal(second.kind, 'round_confirmed');
  assert.equal(c.status, ROUND_COORDINATOR_STATUS.CONFIRMED);
});

test('different RNG draw count causes DESYNC even when state/event hashes match', () => {
  const c = coordinator();
  c.submitDeclarations('A', A_DECL); c.submitDeclarations('B', B_DECL); c.releaseRoundPackage();
  c.submitDigest('A', digest());
  const result = c.submitDigest('B', digest({ gameplayRngDrawCount: 10 }));
  assert.equal(result.kind, 'round_desync');
  assert.equal(c.status, ROUND_COORDINATOR_STATUS.DESYNC);
  assert.deepEqual(result.mismatches.map(x => x.field), ['gameplayRngDrawCount']);
});

test('different final RNG state causes DESYNC independently', () => {
  const c = coordinator();
  c.submitDeclarations('A', A_DECL); c.submitDeclarations('B', B_DECL); c.releaseRoundPackage();
  c.submitDigest('A', digest());
  const result = c.submitDigest('B', digest({ finalGameplayRngState: 999 }));
  assert.deepEqual(result.mismatches.map(x => x.field), ['finalGameplayRngState']);
});

test('digest identity must match coordinator match/round/protocol/ruleset', () => {
  const c = coordinator();
  c.submitDeclarations('A', A_DECL); c.submitDeclarations('B', B_DECL); c.releaseRoundPackage();
  assert.throws(() => c.submitDigest('A', digest({ roundNumber: 2 })), /roundNumber mismatch/);
  assert.throws(() => c.submitDigest('A', digest({ matchId: 'wrong' })), /matchId mismatch/);
});

test('duplicate digest submission is rejected', () => {
  const c = coordinator();
  c.submitDeclarations('A', A_DECL); c.submitDeclarations('B', B_DECL); c.releaseRoundPackage();
  c.submitDigest('A', digest());
  assert.throws(() => c.submitDigest('A', digest()), /already submitted/);
});

test('confirmed round advances and clears prior round data', () => {
  const c = coordinator();
  c.submitDeclarations('A', A_DECL); c.submitDeclarations('B', B_DECL); c.releaseRoundPackage();
  c.submitDigest('A', digest()); c.submitDigest('B', digest());
  assert.equal(c.nextRound(), 2);
  assert.equal(c.status, ROUND_COORDINATOR_STATUS.COLLECTING);
  assert.equal(c.submissions.size, 0);
  assert.equal(c.digests.size, 0);
  assert.equal(c.roundPackage, null);
});

test('desynced round cannot advance', () => {
  const c = coordinator();
  c.submitDeclarations('A', A_DECL); c.submitDeclarations('B', B_DECL); c.releaseRoundPackage();
  c.submitDigest('A', digest()); c.submitDigest('B', digest({ finalStateHash: 'different' }));
  assert.throws(() => c.nextRound(), /Cannot advance/);
});

test('snapshot is canonical regardless submission order', () => {
  const a = coordinator(101);
  a.submitDeclarations('A', A_DECL); a.submitDeclarations('B', B_DECL); a.releaseRoundPackage();
  const b = coordinator(101);
  b.submitDeclarations('B', B_DECL); b.submitDeclarations('A', A_DECL); b.releaseRoundPackage();
  assert.deepEqual(a.snapshot(), b.snapshot());
});
