import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION_KIND,
  COMBAT_ADVANCE_RESULT,
  DAMAGE_TYPE,
  EVENT_TYPE,
  RANGE_MAINTENANCE_RESULT,
  SIDE,
  TARGET_TYPE,
  advanceRangeMaintenanceOneStep,
  createActionDeclaration,
  createBattleState,
  createCombatScheduler,
  createHoldDeclaration,
  createRoundSimulation,
  createUnitState,
  getRangeMaintenanceCandidates,
  planRangeMaintenanceStep,
  runtimeHasMeaningfulRangeMaintenance,
  snapshotRoundSimulation
} from '../src/index.js';

function unit({
  unitId,
  side,
  draftSlot = 0,
  position,
  qkn = 10,
  hp = 1000,
  maxHP = hp,
  movementMax = 20,
  attacksMax = 5,
  attackInterval = 1,
  weaponRange = 2,
  preferredRange = weaponRange,
  attackBaseMin = 1,
  attackBaseMax = attackBaseMin
}) {
  return createUnitState({
    unitId,
    side,
    draftSlot,
    archetypeId: unitId,
    stats: { maxHP, hp, ATK: 100, DEF: 0, SDM: 100, CRIT: 0, QKN: qkn },
    position,
    combat: { movementMax, attacksMax, attackInterval },
    weapon: {
      weaponProfileId: `${unitId}-weapon`,
      mode: 'MELEE',
      weaponRange,
      preferredRange,
      counterMoveMax: 1,
      attackBaseMin,
      attackBaseMax,
      accuracy: 1,
      critBonus: 0,
      critMultiplier: 1.75,
      defensePenetration: 0,
      damageType: DAMAGE_TYPE.PHYSICAL,
      dodgeable: false
    }
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
  return createHoldDeclaration({ declarationId: `D-${actorId}-HOLD`, roundNumber: 1, actorId });
}

function simulation({ units, declarations, seed = 1, board = { width: 10, height: 7 } }) {
  const state = createBattleState({ matchId: 'stage6-test', roundNumber: 1, board, units });
  return createRoundSimulation({ state, declarations, seed });
}

function eventsOf(sim, type) {
  return sim.events.snapshot().filter((event) => event.type === type);
}

test('preferredRange cannot exceed weaponRange', () => {
  assert.throws(() => unit({
    unitId: 'H0', side: SIDE.A, position: { row: 2, col: 2 }, weaponRange: 2, preferredRange: 3
  }), /preferredRange must be <= weapon\.weaponRange/);
});

test('range maintenance is satisfied at preferred maximum distance and consumes no RNG', () => {
  const sim = simulation({
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 }, weaponRange: 3 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 } })
    ],
    declarations: [attack('H0', 'G0'), hold('G0')]
  });

  const plan = planRangeMaintenanceStep(sim.state, 'H0', 'G0', { rng: sim.rng });
  assert.equal(plan.result, RANGE_MAINTENANCE_RESULT.SATISFIED);
  assert.equal(sim.rng.drawCount, 0);
});

test('too-close Range-3 fighter spends one Movement to restore preferred distance', () => {
  const sim = simulation({
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 }, movementMax: 4, weaponRange: 3 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 4 } })
    ],
    declarations: [attack('H0', 'G0'), hold('G0')]
  });

  const result = advanceRangeMaintenanceOneStep(sim.state, 'H0', 'G0', { rng: sim.rng });
  assert.equal(result.result, RANGE_MAINTENANCE_RESULT.MOVE);
  assert.equal(result.targetDistanceBefore, 2);
  assert.equal(result.targetDistanceAfter, 3);
  assert.equal(sim.state.units.H0.resources.movementRemaining, 3);
  assert.equal(sim.rng.drawCount, 1, 'three equally good open retreat squares require one seeded choice');
});

test('ordinary opportunity range-maintains then attacks from the new square', () => {
  const sim = simulation({
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 }, qkn: 20, attacksMax: 1, weaponRange: 3, attackBaseMin: 10 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 4 } })
    ],
    declarations: [attack('H0', 'G0'), hold('G0')]
  });

  const cycle = createCombatScheduler(sim, { countersEnabled: false }).advanceCycle();
  const advance = cycle.advancements[0];
  assert.equal(advance.result, COMBAT_ADVANCE_RESULT.RANGE_MAINTAINED_AND_ATTACKED);
  assert.equal(Math.abs(sim.state.units.H0.position.row - sim.state.units.G0.position.row) + Math.abs(sim.state.units.H0.position.col - sim.state.units.G0.position.col), 3);
  assert.equal(sim.state.units.G0.stats.hp, 990);

  const move = eventsOf(sim, EVENT_TYPE.MOVE)[0];
  const attackStart = eventsOf(sim, EVENT_TYPE.ATTACK_START)[0];
  assert.equal(move.payload.movementReason, 'RANGE_MAINTENANCE');
  assert.equal(attackStart.parentEventId, move.eventId);
});

test('range maintenance still occurs while ordinary attackInterval is cooling down', () => {
  const sim = simulation({
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 }, weaponRange: 3, attackInterval: 5 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 4 } })
    ],
    declarations: [attack('H0', 'G0'), attack('G0', 'H0')]
  });
  sim.state.units.H0.resources.nextOrdinaryAttackCycle = 5;

  const cycle = createCombatScheduler(sim, { countersEnabled: false }).advanceCycle();
  const h = cycle.advancements.find((x) => x.actorId === 'H0');
  assert.equal(h.result, COMBAT_ADVANCE_RESULT.RANGE_MAINTAINED);
  assert.equal(h.moved, true);
  assert.equal(h.attacked, false);
  assert.equal(h.rangeMaintenance.targetDistanceAfter, 3);
});

test('zero Movement prevents retreat but does not prevent attacking from shorter valid range', () => {
  const sim = simulation({
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 }, movementMax: 0, attacksMax: 1, weaponRange: 3, attackBaseMin: 10 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 4 } })
    ],
    declarations: [attack('H0', 'G0'), hold('G0')]
  });

  const cycle = createCombatScheduler(sim, { countersEnabled: false }).advanceCycle();
  assert.equal(cycle.advancements[0].result, COMBAT_ADVANCE_RESULT.ATTACKED);
  assert.deepEqual(sim.state.units.H0.position, { row: 3, col: 2 });
  assert.equal(sim.state.units.G0.stats.hp, 990);
});

test('blocked direct retreat chooses another legal square that reaches preferred range', () => {
  const sim = simulation({
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 }, weaponRange: 3 }),
      unit({ unitId: 'H1', side: SIDE.A, draftSlot: 1, position: { row: 3, col: 2 } }),
      unit({ unitId: 'H2', side: SIDE.A, draftSlot: 2, position: { row: 2, col: 3 } }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 } })
    ],
    declarations: [attack('H0', 'G0'), hold('H1'), hold('H2'), hold('G0')]
  });

  const candidates = getRangeMaintenanceCandidates(sim.state, 'H0', 'G0');
  assert.deepEqual(candidates.map(({ row, col }) => ({ row, col })), [{ row: 4, col: 3 }]);
  const move = advanceRangeMaintenanceOneStep(sim.state, 'H0', 'G0', { rng: sim.rng });
  assert.deepEqual(move.to, { row: 4, col: 3 });
  assert.equal(sim.rng.drawCount, 0);
});

test('equal best retreat squares use exactly one synchronized RNG draw and replay identically', () => {
  const make = () => simulation({
    seed: 0x12345678,
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 }, weaponRange: 3 }),
      unit({ unitId: 'H1', side: SIDE.A, draftSlot: 1, position: { row: 3, col: 2 } }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 } })
    ],
    declarations: [attack('H0', 'G0'), hold('H1'), hold('G0')]
  });
  const a = make();
  const b = make();

  const pa = planRangeMaintenanceStep(a.state, 'H0', 'G0', { rng: a.rng });
  const pb = planRangeMaintenanceStep(b.state, 'H0', 'G0', { rng: b.rng });
  assert.deepEqual(pa.to, pb.to);
  assert.ok([{ row: 2, col: 3 }, { row: 4, col: 3 }].some((p) => p.row === pa.to.row && p.col === pa.to.col));
  assert.equal(a.rng.drawCount, 1);
  assert.equal(b.rng.drawCount, 1);
});

test('fully blocked range maintenance falls back to attacking from current legal range', () => {
  const sim = simulation({
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 }, attacksMax: 1, weaponRange: 3, attackBaseMin: 10 }),
      unit({ unitId: 'H1', side: SIDE.A, draftSlot: 1, position: { row: 3, col: 2 } }),
      unit({ unitId: 'H2', side: SIDE.A, draftSlot: 2, position: { row: 2, col: 3 } }),
      unit({ unitId: 'H3', side: SIDE.A, draftSlot: 3, position: { row: 4, col: 3 } }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 } })
    ],
    declarations: [attack('H0', 'G0'), hold('H1'), hold('H2'), hold('H3'), hold('G0')]
  });

  const cycle = createCombatScheduler(sim, { countersEnabled: false }).advanceCycle();
  assert.equal(cycle.advancements[0].result, COMBAT_ADVANCE_RESULT.ATTACKED);
  assert.deepEqual(sim.state.units.H0.position, { row: 3, col: 3 });
  assert.equal(sim.state.units.G0.stats.hp, 990);
  assert.equal(sim.rng.drawCount, 0);
});

test('board edge still allows lateral range maintenance when it increases distance', () => {
  const sim = simulation({
    board: { width: 8, height: 6 },
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 0, col: 0 }, weaponRange: 3 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 0, col: 2 } })
    ],
    declarations: [attack('H0', 'G0'), hold('G0')]
  });

  const move = advanceRangeMaintenanceOneStep(sim.state, 'H0', 'G0', { rng: sim.rng });
  assert.equal(move.result, RANGE_MAINTENANCE_RESULT.MOVE);
  assert.deepEqual(move.to, { row: 1, col: 0 });
  assert.equal(move.targetDistanceAfter, 3);
  assert.equal(sim.rng.drawCount, 0);
});

test('Range-3 higher-QKN fighter controls Range-2 fighter through recurring ordinary range maintenance', () => {
  const sim = simulation({
    board: { width: 10, height: 7 },
    units: [
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 }, qkn: 17, weaponRange: 3, attacksMax: 5, attackBaseMin: 1 }),
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 }, qkn: 16, weaponRange: 2, attacksMax: 5, attackBaseMin: 1 })
    ],
    declarations: [attack('H0', 'G0'), attack('G0', 'H0')]
  });
  const scheduler = createCombatScheduler(sim, { countersEnabled: false });

  const c0 = scheduler.advanceCycle();
  assert.deepEqual(c0.initiativeOrder, ['G0', 'H0']);
  assert.equal(c0.advancements[0].result, COMBAT_ADVANCE_RESULT.ATTACKED);
  assert.equal(c0.advancements[1].result, COMBAT_ADVANCE_RESULT.MOVED_AND_ATTACKED);
  assert.equal(Math.abs(sim.state.units.G0.position.col - sim.state.units.H0.position.col), 2);

  const c1 = scheduler.advanceCycle();
  assert.equal(c1.advancements[0].result, COMBAT_ADVANCE_RESULT.RANGE_MAINTAINED_AND_ATTACKED);
  assert.equal(c1.advancements[1].result, COMBAT_ADVANCE_RESULT.MOVED_AND_ATTACKED);
  assert.equal(Math.abs(sim.state.units.G0.position.col - sim.state.units.H0.position.col), 2);

  const maintenanceMove = eventsOf(sim, EVENT_TYPE.MOVE).find((e) => e.payload.movementReason === 'RANGE_MAINTENANCE');
  assert.ok(maintenanceMove);
  assert.equal(maintenanceMove.actorId, 'G0');
  assert.equal(maintenanceMove.payload.targetDistanceAfter, 3);
});

test('single remaining attacker does not dump attacks before meaningful range maintenance finishes', () => {
  const sim = simulation({
    board: { width: 8, height: 6 },
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 2 }, attacksMax: 3, attackInterval: 99, weaponRange: 3, attackBaseMin: 1 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 2, col: 3 }, hp: 1000, maxHP: 1000 })
    ],
    declarations: [attack('H0', 'G0'), hold('G0')]
  });
  const scheduler = createCombatScheduler(sim, { countersEnabled: false });

  const runtime = sim.runtimes['R1:H0'];
  assert.equal(runtimeHasMeaningfulRangeMaintenance(sim, runtime), true);

  const c0 = scheduler.advanceCycle();
  assert.equal(c0.advancements[0].result, COMBAT_ADVANCE_RESULT.RANGE_MAINTAINED_AND_ATTACKED);
  assert.equal(c0.dumpedAttackCount, 0, 'distance 2 still has meaningful movement toward preferred Range 3');
  assert.equal(sim.state.units.H0.resources.attacksRemaining, 2);

  const c1 = scheduler.advanceCycle();
  assert.equal(c1.advancements[0].result, COMBAT_ADVANCE_RESULT.RANGE_MAINTAINED);
  assert.equal(c1.dumpedAttackCount, 2, 'once preferred range is reached, remaining interval delay is meaningless');
  assert.equal(sim.state.units.H0.resources.attacksRemaining, 0);
});

test('pure attack-dump eligibility does not consume extra range-maintenance RNG', () => {
  const sim = simulation({
    seed: 0xabcdef01,
    board: { width: 8, height: 7 },
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 0 }, attacksMax: 1, weaponRange: 3 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 2 } })
    ],
    declarations: [attack('H0', 'G0'), hold('G0')]
  });

  createCombatScheduler(sim, { countersEnabled: false }).advanceCycle();
  assert.equal(sim.rng.drawCount, 1, 'only the real equal-choice movement should consume RNG');
});

test('Stage-6 full combat replay remains deterministic', () => {
  const make = () => simulation({
    seed: 0x0ddba11,
    board: { width: 12, height: 8 },
    units: [
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 8 }, qkn: 17, weaponRange: 3, attacksMax: 6, attackInterval: 2, attackBaseMin: 7, attackBaseMax: 13 }),
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 5 }, qkn: 16, weaponRange: 2, attacksMax: 6, attackInterval: 2, attackBaseMin: 7, attackBaseMax: 13 })
    ],
    declarations: [attack('H0', 'G0'), attack('G0', 'H0')]
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
