import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION_KIND,
  ACTION_RUNTIME_STATE,
  ATTACK_OUTCOME,
  COMBAT_ADVANCE_RESULT,
  DAMAGE_TYPE,
  EVENT_TYPE,
  LIFE_STATE,
  SIDE,
  TARGET_TYPE,
  createActionDeclaration,
  createBattleState,
  createCombatScheduler,
  createHoldDeclaration,
  createRoundSimulation,
  createUnitState,
  markUnitDead,
  resolveBasicAttack,
  selectNearestInRangeEnemy,
  snapshotRoundSimulation
} from '../src/index.js';

function unit({
  unitId,
  side,
  draftSlot = 0,
  position,
  qkn = 10,
  hp = 100,
  maxHP = hp,
  atk = 100,
  def = 0,
  crit = 0,
  movementMax = 20,
  attacksMax = 5,
  attackInterval = 1,
  weaponRange = 2,
  attackBaseMin = 20,
  attackBaseMax = attackBaseMin,
  accuracy = 1,
  critBonus = 0,
  critMultiplier = 1.75,
  defensePenetration = 0,
  damageType = DAMAGE_TYPE.PHYSICAL,
  dodgeable = false
}) {
  return createUnitState({
    unitId,
    side,
    draftSlot,
    archetypeId: unitId,
    stats: { maxHP, hp, ATK: atk, DEF: def, SDM: 0, CRIT: crit, QKN: qkn },
    position,
    combat: { movementMax, attacksMax, attackInterval },
    weapon: {
      weaponProfileId: `${unitId}-weapon`,
      mode: 'MELEE',
      weaponRange,
      preferredRange: weaponRange,
      counterMoveMax: 1,
      attackBaseMin,
      attackBaseMax,
      accuracy,
      critBonus,
      critMultiplier,
      defensePenetration,
      damageType,
      dodgeable
    }
  });
}

function attack({ actorId, targetId, roundNumber = 1 }) {
  return createActionDeclaration({
    declarationId: `D-${actorId}-R${roundNumber}`,
    roundNumber,
    actorId,
    actionId: 'ATTACK',
    actionKind: ACTION_KIND.BASIC_ATTACK,
    target: { type: TARGET_TYPE.UNIT, unitId: targetId }
  });
}

function hold(actorId) {
  return createHoldDeclaration({ declarationId: `D-${actorId}-HOLD`, roundNumber: 1, actorId });
}

function simulation({ units, declarations, seed = 1, board = { width: 14, height: 10 } }) {
  const state = createBattleState({ matchId: 'stage5-test', roundNumber: 1, board, units });
  return createRoundSimulation({ state, declarations, seed });
}

function eventsOf(sim, type) {
  return sim.events.snapshot().filter((event) => event.type === type);
}

test('ordinary in-range basic attack consumes one attack and advances attackInterval eligibility', () => {
  const sim = simulation({
    board: { width: 8, height: 6 },
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 2 }, attacksMax: 3, attackInterval: 2 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 2, col: 4 }, attacksMax: 3, attackBaseMin: 0, accuracy: 0 })
    ],
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), attack({ actorId: 'G0', targetId: 'H0' })]
  });

  const cycle = createCombatScheduler(sim, { countersEnabled: false }).advanceCycle();
  const h = cycle.advancements.find((x) => x.actorId === 'H0');
  assert.equal(h.result, COMBAT_ADVANCE_RESULT.ATTACKED);
  assert.equal(sim.state.units.H0.resources.attacksRemaining, 2);
  assert.equal(sim.state.units.H0.resources.nextOrdinaryAttackCycle, 2);
  assert.equal(sim.state.units.G0.stats.hp, 80);
});

test('attackInterval spaces competing ordinary attacks across initiative cycles', () => {
  const sim = simulation({
    board: { width: 8, height: 6 },
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 2 }, qkn: 20, attacksMax: 3, attackInterval: 2, attackBaseMin: 1 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 2, col: 4 }, qkn: 10, hp: 1000, maxHP: 1000, attacksMax: 3, attackInterval: 2, attackBaseMin: 1 })
    ],
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), attack({ actorId: 'G0', targetId: 'H0' })]
  });
  const scheduler = createCombatScheduler(sim, { countersEnabled: false });

  const c0 = scheduler.advanceCycle();
  const c1 = scheduler.advanceCycle();
  const c2 = scheduler.advanceCycle();

  assert.equal(c0.advancements.filter((x) => x.attacked).length, 2);
  assert.equal(c1.advancements.filter((x) => x.result === COMBAT_ADVANCE_RESULT.WAIT_ATTACK_INTERVAL).length, 2);
  assert.equal(c2.advancements.filter((x) => x.attacked).length, 2);
  assert.deepEqual(eventsOf(sim, EVENT_TYPE.ATTACK_START).map((e) => e.initiativeCycle), [0, 0, 2, 2]);
});

test('one-square pursuit step may immediately attack when it establishes range', () => {
  const sim = simulation({
    board: { width: 8, height: 6 },
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 1 }, qkn: 20, attacksMax: 1, weaponRange: 2 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 2, col: 4 }, qkn: 10, attacksMax: 1 })
    ],
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), hold('G0')]
  });

  const cycle = createCombatScheduler(sim, { countersEnabled: false }).advanceCycle();
  assert.equal(cycle.advancements[0].result, COMBAT_ADVANCE_RESULT.MOVED_AND_ATTACKED);
  assert.deepEqual(sim.state.units.H0.position, { row: 2, col: 2 });
  assert.equal(sim.state.units.G0.stats.hp, 80);
  assert.equal(eventsOf(sim, EVENT_TYPE.MOVE).length, 1);
  assert.equal(eventsOf(sim, EVENT_TYPE.ATTACK_START).length, 1);
});

test('attack exhaustion completes the proactive runtime', () => {
  const sim = simulation({
    board: { width: 8, height: 6 },
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 2 }, attacksMax: 1 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 2, col: 4 } })
    ],
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), hold('G0')]
  });
  createCombatScheduler(sim, { countersEnabled: false }).advanceCycle();
  const runtime = sim.runtimes['R1:H0'];
  assert.equal(runtime.state, ACTION_RUNTIME_STATE.COMPLETED);
  assert.equal(runtime.completed, true);
  assert.equal(runtime.metadata.terminalReason, 'ATTACKS_EXHAUSTED');
});

test('successful hit emits causal attack-impact-damage events and mutates HP synchronously', () => {
  const sim = simulation({
    board: { width: 8, height: 6 },
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 2 }, attacksMax: 1, attackBaseMin: 30 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 2, col: 4 } })
    ],
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), hold('G0')]
  });

  const result = resolveBasicAttack(sim, 'H0', 'G0', { cycle: 0 });
  assert.equal(result.outcome, ATTACK_OUTCOME.HIT);
  assert.equal(result.dealt, 30);
  assert.equal(sim.state.units.G0.stats.hp, 70);

  const start = eventsOf(sim, EVENT_TYPE.ATTACK_START).at(-1);
  const impact = eventsOf(sim, EVENT_TYPE.ATTACK_IMPACT).at(-1);
  const damage = eventsOf(sim, EVENT_TYPE.DAMAGE).at(-1);
  assert.equal(impact.parentEventId, start.eventId);
  assert.equal(damage.parentEventId, impact.eventId);
  assert.equal(sim.state.round.eventSequence, sim.events.length);
});

test('accuracy miss consumes the attack but deals no damage', () => {
  const sim = simulation({
    board: { width: 8, height: 6 },
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 2 }, attacksMax: 1, accuracy: 0 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 2, col: 4 } })
    ],
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), hold('G0')]
  });

  const result = resolveBasicAttack(sim, 'H0', 'G0', { cycle: 0 });
  assert.equal(result.outcome, ATTACK_OUTCOME.MISS);
  assert.equal(sim.state.units.H0.resources.attacksRemaining, 0);
  assert.equal(sim.state.units.G0.stats.hp, 100);
  assert.equal(eventsOf(sim, EVENT_TYPE.MISS).length, 1);
  assert.equal(eventsOf(sim, EVENT_TYPE.DAMAGE).length, 0);
});

test('physical dodge uses synchronized gameplay RNG and consumes the attack', () => {
  const sim = simulation({
    seed: 1, // xorshift32 first draw is below the 25% dodge cap
    board: { width: 8, height: 6 },
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 2 }, attacksMax: 1, dodgeable: true }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 2, col: 4 }, qkn: 100 })
    ],
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), hold('G0')]
  });

  const result = resolveBasicAttack(sim, 'H0', 'G0', { cycle: 0 });
  assert.equal(result.outcome, ATTACK_OUTCOME.DODGE);
  assert.equal(sim.rng.drawCount, 1);
  assert.equal(sim.state.units.H0.resources.attacksRemaining, 0);
  assert.equal(sim.state.units.G0.stats.hp, 100);
  assert.equal(eventsOf(sim, EVENT_TYPE.DODGE).length, 1);
});

test('guaranteed critical uses configured multiplier and emits CRIT', () => {
  const sim = simulation({
    board: { width: 8, height: 6 },
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 2 }, attacksMax: 1, crit: 1, attackBaseMin: 20, critMultiplier: 2 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 2, col: 4 } })
    ],
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), hold('G0')]
  });

  const result = resolveBasicAttack(sim, 'H0', 'G0', { cycle: 0 });
  assert.equal(result.crit, true);
  assert.equal(result.dealt, 40);
  assert.equal(sim.state.units.G0.stats.hp, 60);
  assert.equal(eventsOf(sim, EVENT_TYPE.CRIT).length, 1);
});

test('lethal attack creates a corpse, emits KO, and sets match outcome when a side is eliminated', () => {
  const sim = simulation({
    board: { width: 8, height: 6 },
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 2 }, attacksMax: 1, attackBaseMin: 100 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 2, col: 4, }, hp: 30, maxHP: 30 })
    ],
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), hold('G0')]
  });

  resolveBasicAttack(sim, 'H0', 'G0', { cycle: 0 });
  assert.equal(sim.state.units.G0.lifeState, LIFE_STATE.DEAD);
  assert.deepEqual(sim.state.units.G0.position, { row: 2, col: 4 });
  assert.equal(sim.state.board.occupancy['2,4'], 'G0');
  assert.equal(eventsOf(sim, EVENT_TYPE.KO).length, 1);
  assert.deepEqual(sim.state.outcome, { status: 'COMPLETE', winner: 'A' });
});

test('dead primary target may be replaced only by nearest enemy already in weapon range', () => {
  const sim = simulation({
    board: { width: 10, height: 7 },
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 }, attacksMax: 2, weaponRange: 2 }),
      unit({ unitId: 'G0', side: SIDE.B, draftSlot: 0, position: { row: 3, col: 5 }, hp: 10, maxHP: 10 }),
      unit({ unitId: 'G1', side: SIDE.B, draftSlot: 1, position: { row: 4, col: 4 }, hp: 100, maxHP: 100 }),
      unit({ unitId: 'G2', side: SIDE.B, draftSlot: 2, position: { row: 3, col: 8 }, hp: 100, maxHP: 100 })
    ],
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), hold('G0'), hold('G1'), hold('G2')]
  });
  markUnitDead(sim.state, 'G0');

  assert.equal(selectNearestInRangeEnemy(sim, 'H0'), 'G1');
  createCombatScheduler(sim, { countersEnabled: false }).advanceCycle();
  assert.equal(sim.state.units.G1.stats.hp, 60, 'with only one proactive runtime, the remaining two attacks are dumped into G1');
  assert.deepEqual(sim.state.units.H0.position, { row: 3, col: 3 }, 'replacement target never causes pursuit');
});

test('equidistant in-range replacement target uses synchronized RNG', () => {
  const make = () => simulation({
    seed: 0x12345678,
    board: { width: 10, height: 7 },
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 }, weaponRange: 2 }),
      unit({ unitId: 'G0', side: SIDE.B, draftSlot: 0, position: { row: 3, col: 5 } }),
      unit({ unitId: 'G1', side: SIDE.B, draftSlot: 1, position: { row: 2, col: 4 } }),
      unit({ unitId: 'G2', side: SIDE.B, draftSlot: 2, position: { row: 4, col: 4 } })
    ],
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), hold('G0'), hold('G1'), hold('G2')]
  });
  const a = make();
  const b = make();
  markUnitDead(a.state, 'G0');
  markUnitDead(b.state, 'G0');

  const ta = selectNearestInRangeEnemy(a, 'H0');
  const tb = selectNearestInRangeEnemy(b, 'H0');
  assert.equal(ta, tb);
  assert.ok(['G1', 'G2'].includes(ta));
  assert.equal(a.rng.drawCount, 1);
  assert.equal(b.rng.drawCount, 1);
});

test('primary target death never causes pursuit of an out-of-range replacement', () => {
  const sim = simulation({
    board: { width: 10, height: 7 },
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 1 }, movementMax: 20, weaponRange: 2 }),
      unit({ unitId: 'G0', side: SIDE.B, draftSlot: 0, position: { row: 3, col: 3 } }),
      unit({ unitId: 'G1', side: SIDE.B, draftSlot: 1, position: { row: 3, col: 8 } })
    ],
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), hold('G0'), hold('G1')]
  });
  markUnitDead(sim.state, 'G0');
  const before = { ...sim.state.units.H0.position };
  const result = createCombatScheduler(sim, { countersEnabled: false }).advanceCycle();

  assert.deepEqual(sim.state.units.H0.position, before);
  assert.equal(result.advancements[0].result, COMBAT_ADVANCE_RESULT.COMPLETED_TARGET_DEAD);
  assert.equal(sim.runtimes['R1:H0'].state, ACTION_RUNTIME_STATE.COMPLETED);
});

test('end-of-round attack dump ignores attackInterval when only one proactive attacker remains', () => {
  const sim = simulation({
    board: { width: 8, height: 6 },
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 2 }, attacksMax: 4, attackInterval: 99, attackBaseMin: 5 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 2, col: 4 }, hp: 1000, maxHP: 1000 })
    ],
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), hold('G0')]
  });

  const cycle = createCombatScheduler(sim, { countersEnabled: false }).advanceCycle();
  assert.equal(cycle.advancements[0].attacked, true);
  assert.equal(cycle.dumpedAttackCount, 3);
  assert.equal(sim.state.units.H0.resources.attacksRemaining, 0);
  assert.equal(eventsOf(sim, EVENT_TYPE.ATTACK_START).length, 4);
  assert.equal(sim.runtimes['R1:H0'].state, ACTION_RUNTIME_STATE.COMPLETED);
});

test('attack dump does not occur while two meaningful proactive attackers remain', () => {
  const sim = simulation({
    board: { width: 8, height: 6 },
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 2 }, attacksMax: 4, attackInterval: 3, attackBaseMin: 1 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 2, col: 4 }, attacksMax: 4, attackInterval: 3, attackBaseMin: 1, hp: 1000, maxHP: 1000 })
    ],
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), attack({ actorId: 'G0', targetId: 'H0' })]
  });

  const cycle = createCombatScheduler(sim, { countersEnabled: false }).advanceCycle();
  assert.equal(cycle.dumpedAttackCount, 0);
  assert.equal(sim.state.units.H0.resources.attacksRemaining, 3);
  assert.equal(sim.state.units.G0.resources.attacksRemaining, 3);
});

test('zero attacks prevents Stage-5 pursuit and completes the action', () => {
  const h = unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 0 }, attacksMax: 0, movementMax: 20 });
  const g = unit({ unitId: 'G0', side: SIDE.B, position: { row: 2, col: 8 } });
  const sim = simulation({ board: { width: 10, height: 6 }, units: [h, g], declarations: [attack({ actorId: 'H0', targetId: 'G0' }), hold('G0')] });

  const before = { ...sim.state.units.H0.position };
  const cycle = createCombatScheduler(sim, { countersEnabled: false }).advanceCycle();
  assert.deepEqual(sim.state.units.H0.position, before);
  assert.equal(cycle.advancements[0].result, COMBAT_ADVANCE_RESULT.COMPLETED_NO_ATTACKS);
  assert.equal(sim.runtimes['R1:H0'].state, ACTION_RUNTIME_STATE.COMPLETED);
});

test('complete Stage-5 combat replay is deterministic across identical simulations', () => {
  const make = () => simulation({
    seed: 0x0badc0de,
    board: { width: 12, height: 7 },
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 0 }, qkn: 16, attacksMax: 5, attackInterval: 2, attackBaseMin: 15, attackBaseMax: 25, crit: 0.15, dodgeable: true }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 11 }, qkn: 17, attacksMax: 5, attackInterval: 2, attackBaseMin: 15, attackBaseMax: 25, crit: 0.15, dodgeable: true })
    ],
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), attack({ actorId: 'G0', targetId: 'H0' })]
  });

  const a = make();
  const b = make();
  createCombatScheduler(a, { countersEnabled: false }).runUntilCombatSettled();
  createCombatScheduler(b, { countersEnabled: false }).runUntilCombatSettled();
  const sa = snapshotRoundSimulation(a);
  const sb = snapshotRoundSimulation(b);

  assert.equal(sa.stateHash, sb.stateHash);
  assert.equal(sa.eventHash, sb.eventHash);
  assert.deepEqual(sa.rng, sb.rng);
  assert.deepEqual(sa.events, sb.events);
  assert.deepEqual(sa.trace, sb.trace);
});
