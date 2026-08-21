import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION_KIND,
  EVENT_TYPE,
  EventRecorder,
  GameplayRng,
  SIDE,
  TARGET_TYPE,
  canonicalStringify,
  createActionDeclaration,
  createActionRuntime,
  createBattleState,
  createHoldDeclaration,
  createRoundSimulation,
  createUnitState,
  hashCanonical,
  snapshotRoundSimulation
} from '../src/index.js';

function fixtureState() {
  const warrior = createUnitState({
    unitId: 'H0', side: SIDE.A, draftSlot: 0, archetypeId: 'Warrior',
    stats: { maxHP: 300, hp: 300, ATK: 80, DEF: 60, SDM: 10, CRIT: 0.10, QKN: 17 },
    position: { row: 3, col: 0 },
    combat: { movementMax: 12, attacksMax: 7, attackInterval: 1 },
    weapon: { weaponProfileId: 'warrior_sword', mode: 'MELEE', weaponRange: 2, preferredRange: 2, counterMoveMax: 1 }
  });
  const mage = createUnitState({
    unitId: 'G0', side: SIDE.B, draftSlot: 0, archetypeId: 'Mage',
    stats: { maxHP: 210, hp: 210, ATK: 20, DEF: 30, SDM: 100, CRIT: 0.05, QKN: 14 },
    position: { row: 3, col: 13 },
    combat: { movementMax: 10, attacksMax: 4, attackInterval: 2 },
    weapon: { weaponProfileId: 'mage_staff', mode: 'MELEE', weaponRange: 2, preferredRange: 2, counterMoveMax: 1 }
  });
  return createBattleState({ matchId: 'test-match', roundNumber: 1, units: [warrior, mage] });
}

function fixtureDeclarations() {
  return [
    createActionDeclaration({
      declarationId: 'D-H0-R1', roundNumber: 1, actorId: 'H0', actionId: 'ATTACK',
      actionKind: ACTION_KIND.BASIC_ATTACK,
      target: { type: TARGET_TYPE.UNIT, unitId: 'G0' }
    }),
    createActionDeclaration({
      declarationId: 'D-G0-R1', roundNumber: 1, actorId: 'G0', actionId: 'FIREBALL',
      actionKind: ACTION_KIND.SPELL,
      target: { type: TARGET_TYPE.GROUND, row: 3, col: 6 }
    })
  ];
}

test('xorshift32 RNG is identical for identical seeds', () => {
  const a = new GameplayRng(123456);
  const b = new GameplayRng(123456);
  const seqA = Array.from({ length: 20 }, (_, i) => a.nextFloat(`a-${i}`));
  const seqB = Array.from({ length: 20 }, (_, i) => b.nextFloat(`b-${i}`));
  assert.deepEqual(seqA, seqB);
  assert.equal(a.drawCount, 20);
  assert.equal(b.drawCount, 20);
  assert.equal(a.state, b.state);
});

test('RNG uses non-zero state even when seed is zero', () => {
  const rng = new GameplayRng(0);
  assert.equal(rng.initialSeed, 1);
  assert.notEqual(rng.nextFloat('zero-seed-test'), 0);
});

test('canonical serialization ignores object insertion order', () => {
  const a = { z: 1, a: { y: 2, x: 3 }, list: [3, 2, 1] };
  const b = { list: [3, 2, 1], a: { x: 3, y: 2 }, z: 1 };
  assert.equal(canonicalStringify(a), canonicalStringify(b));
  assert.equal(hashCanonical(a), hashCanonical(b));
});

test('authoritative hash changes when gameplay state changes', () => {
  const state = fixtureState();
  const original = hashCanonical(state);
  state.units.H0.stats.hp -= 1;
  assert.notEqual(hashCanonical(state), original);
});

test('declarations are immutable and runtime is separate', () => {
  const declaration = fixtureDeclarations()[0];
  assert.equal(Object.isFrozen(declaration), true);
  assert.equal(Object.isFrozen(declaration.target), true);

  const runtime = createActionRuntime(declaration);
  runtime.currentForcedTargetId = 'OTHER';
  runtime.metadata.reason = 'taunt-test';

  assert.equal(declaration.target.unitId, 'G0');
  assert.equal(runtime.declaredPrimaryTargetId, 'G0');
  assert.equal(runtime.currentForcedTargetId, 'OTHER');
});

test('HOLD is a first-class serializable declaration', () => {
  const hold = createHoldDeclaration({ declarationId: 'D-H0-HOLD', roundNumber: 1, actorId: 'H0' });
  assert.equal(hold.actionKind, ACTION_KIND.HOLD);
  assert.equal(hold.target.type, TARGET_TYPE.NONE);
});

test('simulation bootstrap canonicalizes declaration order', () => {
  const stateA = fixtureState();
  const stateB = fixtureState();
  const declarations = fixtureDeclarations();

  const simA = createRoundSimulation({ state: stateA, declarations, seed: 777 });
  const simB = createRoundSimulation({ state: stateB, declarations: declarations.slice().reverse(), seed: 777 });

  assert.equal(simA.declarationsHash, simB.declarationsHash);
  assert.deepEqual(Object.keys(simA.runtimes).sort(), Object.keys(simB.runtimes).sort());
});

test('identical bootstrap + identical RNG consumption yields identical artifacts', () => {
  const make = () => createRoundSimulation({ state: fixtureState(), declarations: fixtureDeclarations(), seed: 0xdecafbad });
  const a = make();
  const b = make();

  // Stand in for future combat decisions. Reasons are diagnostic only and do not affect RNG values.
  for (let i = 0; i < 8; i += 1) {
    assert.equal(a.rng.nextFloat(`A:${i}`), b.rng.nextFloat(`B:${i}`));
  }

  const snapA = snapshotRoundSimulation(a);
  const snapB = snapshotRoundSimulation(b);

  assert.equal(snapA.stateHash, snapB.stateHash);
  assert.equal(snapA.eventHash, snapB.eventHash);
  assert.equal(snapA.rng.drawCount, snapB.rng.drawCount);
  assert.equal(snapA.rng.state, snapB.rng.state);
});

test('bootstrap rejects more than one declaration from the same actor', () => {
  const declarations = fixtureDeclarations();
  const duplicate = createActionDeclaration({
    declarationId: 'D-H0-SECOND', roundNumber: 1, actorId: 'H0', actionId: 'HOLD-ISH',
    actionKind: ACTION_KIND.HOLD,
    target: { type: TARGET_TYPE.NONE }
  });

  assert.throws(() => createRoundSimulation({
    state: fixtureState(), declarations: [declarations[0], duplicate], seed: 1
  }), /Only one declaration per actor/);
});


test('bootstrap requires one declaration per living champion; HOLD is the explicit no-action choice', () => {
  const declarations = fixtureDeclarations();
  assert.throws(() => createRoundSimulation({
    state: fixtureState(), declarations: [declarations[0]], seed: 1
  }), /Every living champion must have exactly one declaration/);
});

test('event recorder enforces valid causal parent references', () => {
  const events = new EventRecorder();
  const root = events.emit(EVENT_TYPE.ATTACK_START, { actorId: 'H0', targetId: 'G0' });
  const child = events.emit(EVENT_TYPE.DAMAGE, {
    actorId: 'H0', targetId: 'G0', parentEventId: root.eventId, payload: { amount: 37 }
  });
  assert.equal(child.parentEventId, root.eventId);
  assert.throws(() => events.emit(EVENT_TYPE.CRIT, { parentEventId: 'E999999' }), /parentEventId does not exist/);
});
