import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION_KIND,
  DAMAGE_TYPE,
  EVENT_TYPE,
  KITE_RESULT,
  RETARGET_POLICY,
  SIDE,
  TARGET_TYPE,
  WEAPON_BEHAVIOR,
  advanceThreatRetreatOneStep,
  createActionDeclaration,
  createBattleState,
  createCombatScheduler,
  createHoldDeclaration,
  createRoundSimulation,
  createUnitState,
  planThreatRetreatStep,
  selectReplacementTarget,
  snapshotRoundSimulation
} from '../src/index.js';

function unit({
  unitId,
  side,
  position,
  qkn = 10,
  hp = 1000,
  movementMax = 10,
  attacksMax = 4,
  attackInterval = 1,
  weaponRange = 2,
  preferredRange = weaponRange,
  counterMoveMax = 1,
  damage = 10,
  mode = 'MELEE',
  behavior = WEAPON_BEHAVIOR.STANDARD,
  retargetPolicy = RETARGET_POLICY.IN_RANGE_NEAREST
}) {
  return createUnitState({
    unitId,
    side,
    draftSlot: 0,
    archetypeId: unitId,
    stats: { maxHP: Math.max(1, hp), hp, ATK: 100, DEF: 0, SDM: 100, CRIT: 0, QKN: qkn },
    position,
    combat: { movementMax, attacksMax, attackInterval },
    weapon: {
      weaponProfileId: `${unitId}-weapon`,
      mode,
      weaponRange,
      preferredRange,
      counterMoveMax,
      attackBaseMin: damage,
      attackBaseMax: damage,
      accuracy: 1,
      critBonus: 0,
      critMultiplier: 1.75,
      defensePenetration: 0,
      damageType: DAMAGE_TYPE.PHYSICAL,
      dodgeable: false,
      behavior,
      retargetPolicy
    }
  });
}

function dagger(opts) {
  return unit({
    mode: 'RANGED',
    behavior: WEAPON_BEHAVIOR.THROWING_DAGGER,
    retargetPolicy: RETARGET_POLICY.IN_RANGE_RANDOM,
    weaponRange: 20,
    preferredRange: 20,
    counterMoveMax: 3,
    ...opts
  });
}

function attack(actorId, targetId) {
  return createActionDeclaration({
    declarationId: `D-${actorId}`,
    roundNumber: 1,
    actorId,
    actionId: 'ATTACK',
    actionKind: ACTION_KIND.BASIC_ATTACK,
    target: { type: TARGET_TYPE.UNIT, unitId: targetId }
  });
}

function hold(actorId) {
  return createHoldDeclaration({ declarationId: `D-${actorId}-H`, roundNumber: 1, actorId });
}

function sim(units, declarations, seed = 1, board = { width: 10, height: 8 }) {
  return createRoundSimulation({
    state: createBattleState({ matchId: 'stage8', roundNumber: 1, board, units }),
    declarations,
    seed
  });
}

function eventsOf(s, type) {
  return s.events.snapshot().filter((e) => e.type === type);
}

function distance(a, b) {
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

test('Throwing Dagger direct retreat is preferred over equally distant lateral alternatives without RNG', () => {
  const s = sim([
    dagger({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 6 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 2 } })
  ], [attack('H0', 'G0'), hold('G0')]);

  const plan = planThreatRetreatStep(s.state, 'H0', 'G0', { rng: s.rng });
  assert.equal(plan.result, KITE_RESULT.MOVE);
  assert.deepEqual(plan.to, { row: 3, col: 7 });
  assert.equal(plan.directRetreat, true);
  assert.equal(plan.tieBroken, false);
  assert.equal(s.rng.drawCount, 0);
});

test('Throwing Dagger uses synchronized RNG only when multiple direct retreats are equally valid', () => {
  const make = () => sim([
    dagger({ unitId: 'H0', side: SIDE.A, position: { row: 4, col: 6 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 2, col: 4 } })
  ], [attack('H0', 'G0'), hold('G0')], 0x8181);
  const a = make(), b = make();
  const pa = planThreatRetreatStep(a.state, 'H0', 'G0', { rng: a.rng });
  const pb = planThreatRetreatStep(b.state, 'H0', 'G0', { rng: b.rng });
  assert.deepEqual(pa.to, pb.to);
  assert.equal(pa.tieBroken, true);
  assert.equal(a.rng.drawCount, 1);
  assert.equal(b.rng.drawCount, 1);
});

test('blocked direct retreat chooses best legal orthogonal alternative', () => {
  const s = sim([
    dagger({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 6 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 2 } }),
    unit({ unitId: 'H1', side: SIDE.A, position: { row: 3, col: 7 } })
  ], [attack('H0', 'G0'), hold('G0'), hold('H1')], 77);
  const before = distance(s.state.units.H0.position, s.state.units.G0.position);
  const move = advanceThreatRetreatOneStep(s.state, 'H0', 'G0', { rng: s.rng });
  assert.equal(move.result, KITE_RESULT.MOVE);
  assert.notDeepEqual(move.to, { row: 3, col: 7 });
  assert.ok(move.threatDistanceAfter > before);
});

test('board edge allows lateral Throwing Dagger kite instead of stopping', () => {
  const s = sim([
    dagger({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 9 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 } })
  ], [attack('H0', 'G0'), hold('G0')], 21);
  const move = advanceThreatRetreatOneStep(s.state, 'H0', 'G0', { rng: s.rng });
  assert.equal(move.result, KITE_RESULT.MOVE);
  assert.equal(move.to.col, 9);
  assert.notEqual(move.to.row, 3);
  assert.ok(move.threatDistanceAfter > move.threatDistanceBefore);
});

test('ordinary Throwing Dagger opportunity retreats one square then attacks', () => {
  const s = sim([
    dagger({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 6 }, movementMax: 4, attacksMax: 1 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 2 }, attacksMax: 0 })
  ], [attack('H0', 'G0'), hold('G0')]);
  createCombatScheduler(s).advanceCycle();
  const moves = eventsOf(s, EVENT_TYPE.MOVE).filter((e) => e.actorId === 'H0');
  const attacks = eventsOf(s, EVENT_TYPE.ATTACK_START).filter((e) => e.actorId === 'H0');
  assert.equal(moves.length, 1);
  assert.equal(moves[0].payload.movementReason, 'THROWING_DAGGER_KITE');
  assert.equal(attacks.length, 1);
  assert.equal(s.state.units.H0.resources.movementRemaining, 3);
  assert.equal(s.state.units.H0.resources.attacksRemaining, 0);
});

test('Throwing Dagger with no legal retreat remains in place and still attacks', () => {
  const s = sim([
    dagger({ unitId: 'H0', side: SIDE.A, position: { row: 0, col: 0 }, movementMax: 4, attacksMax: 1 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 0, col: 1 }, attacksMax: 0 }),
    unit({ unitId: 'H1', side: SIDE.A, position: { row: 1, col: 0 } })
  ], [attack('H0', 'G0'), hold('G0'), hold('H1')], 1, { width: 4, height: 4 });
  createCombatScheduler(s).advanceCycle();
  assert.equal(eventsOf(s, EVENT_TYPE.MOVE).filter((e) => e.actorId === 'H0').length, 0);
  assert.equal(eventsOf(s, EVENT_TYPE.ATTACK_START).filter((e) => e.actorId === 'H0').length, 1);
});

test('Throwing Dagger does not kite during attackInterval cooldown without an attack', () => {
  const s = sim([
    dagger({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 6 }, movementMax: 4, attacksMax: 2, attackInterval: 3 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 2 }, attacksMax: 0 })
  ], [attack('H0', 'G0'), hold('G0')]);
  s.state.units.H0.resources.nextOrdinaryAttackCycle = 2;
  createCombatScheduler(s).advanceCycle();
  assert.deepEqual(s.state.units.H0.position, { row: 3, col: 6 });
  assert.equal(s.state.units.H0.resources.movementRemaining, 4);
  assert.equal(eventsOf(s, EVENT_TYPE.ATTACK_START).length, 0);
});

test('generic bow/ranged weapon does not automatically ordinary-retreat', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 6 }, mode: 'RANGED', weaponRange: 8, preferredRange: 8, counterMoveMax: 3, attacksMax: 1 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 2 }, attacksMax: 0 })
  ], [attack('H0', 'G0'), hold('G0')]);
  createCombatScheduler(s).advanceCycle();
  assert.deepEqual(s.state.units.H0.position, { row: 3, col: 6 });
  assert.equal(eventsOf(s, EVENT_TYPE.MOVE).filter((e) => e.actorId === 'H0').length, 0);
  assert.equal(eventsOf(s, EVENT_TYPE.ATTACK_START).filter((e) => e.actorId === 'H0').length, 1);
});

test('Throwing Dagger counter kites up to three squares directly away before countering', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 }, weaponRange: 6, preferredRange: 2, attacksMax: 1 }),
    dagger({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 4 }, movementMax: 5, attacksMax: 2 })
  ], [attack('H0', 'G0'), hold('G0')]);
  createCombatScheduler(s).advanceCycle();
  const counterMoves = eventsOf(s, EVENT_TYPE.COUNTER_MOVE).filter((e) => e.actorId === 'G0');
  assert.equal(counterMoves.length, 3);
  assert.ok(counterMoves.every((e) => e.payload.movementReason === 'THROWING_DAGGER_COUNTER_KITE'));
  assert.deepEqual(s.state.units.G0.position, { row: 3, col: 7 });
  assert.equal(eventsOf(s, EVENT_TYPE.COUNTER).length, 1);
});

test('Throwing Dagger counter still works with zero Movement if aggressor is already in range', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 }, attacksMax: 1 }),
    dagger({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 4 }, movementMax: 0, attacksMax: 1 })
  ], [attack('H0', 'G0'), hold('G0')]);
  createCombatScheduler(s).advanceCycle();
  assert.equal(eventsOf(s, EVENT_TYPE.COUNTER_MOVE).length, 0);
  assert.equal(eventsOf(s, EVENT_TYPE.COUNTER).length, 1);
});

test('Throwing Dagger random replacement target is selected from all living in-range enemies', () => {
  const s = sim([
    dagger({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 5 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 1 }, hp: 0 }),
    unit({ unitId: 'G1', side: SIDE.B, position: { row: 1, col: 1 } }),
    unit({ unitId: 'G2', side: SIDE.B, position: { row: 6, col: 1 } })
  ], [attack('H0', 'G0'), hold('G1'), hold('G2')], 0x5151);
  const id = selectReplacementTarget(s, 'H0', { reason: 'TEST_DAGGER_RETARGET' });
  assert.ok(['G1', 'G2'].includes(id));
  assert.equal(s.rng.drawCount, 1);
});

test('Throwing Dagger continues attacking a new living enemy after primary target dies', () => {
  const s = sim([
    dagger({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 6 }, movementMax: 4, attacksMax: 2, damage: 100 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 2 }, hp: 50, attacksMax: 0 }),
    unit({ unitId: 'G1', side: SIDE.B, position: { row: 1, col: 2 }, hp: 500, attacksMax: 0 })
  ], [attack('H0', 'G0'), hold('G0'), hold('G1')], 9);
  createCombatScheduler(s).runUntilCombatSettled({ maxCycles: 20 });
  const attacks = eventsOf(s, EVENT_TYPE.ATTACK_START).filter((e) => e.actorId === 'H0');
  assert.equal(attacks.length, 2);
  assert.equal(attacks[0].targetId, 'G0');
  assert.equal(attacks[1].targetId, 'G1');
  assert.ok(s.state.units.G1.stats.hp < 500);
});

test('standard melee replacement behavior remains nearest-in-range rather than random', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 5 }, weaponRange: 5 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 1 }, hp: 0 }),
    unit({ unitId: 'G1', side: SIDE.B, position: { row: 3, col: 3 } }),
    unit({ unitId: 'G2', side: SIDE.B, position: { row: 6, col: 5 } })
  ], [attack('H0', 'G0'), hold('G1'), hold('G2')], 123);
  assert.equal(selectReplacementTarget(s, 'H0'), 'G1');
  assert.equal(s.rng.drawCount, 0);
});

test('Stage-8 Throwing Dagger replay is deterministic across identical simulations', () => {
  const make = () => sim([
    dagger({ unitId: 'H0', side: SIDE.A, position: { row: 4, col: 7 }, qkn: 18, movementMax: 7, attacksMax: 4, damage: 25 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 4, col: 3 }, qkn: 17, weaponRange: 3, preferredRange: 3, attacksMax: 3, damage: 20 }),
    unit({ unitId: 'G1', side: SIDE.B, position: { row: 2, col: 3 }, qkn: 10, attacksMax: 0 })
  ], [attack('H0', 'G0'), attack('G0', 'H0'), hold('G1')], 0x8a8a8a);
  const a = make(), b = make();
  createCombatScheduler(a).runUntilCombatSettled({ maxCycles: 50 });
  createCombatScheduler(b).runUntilCombatSettled({ maxCycles: 50 });
  assert.deepEqual(snapshotRoundSimulation(a), snapshotRoundSimulation(b));
});
