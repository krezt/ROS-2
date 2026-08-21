import test from 'node:test';
import assert from 'node:assert/strict';

import {
  GameplayRng,
  PURSUIT_RESULT,
  SIDE,
  advancePursuitOneStep,
  createBattleState,
  createUnitState,
  getEngagementCells,
  getOccupantId,
  manhattanDistance,
  markUnitDead,
  moveUnitOneStepWithResource,
  planPursuitStep,
  relocateUnitOneStep
} from '../src/index.js';

function unit({
  unitId,
  side,
  draftSlot = 0,
  position,
  hp = 100,
  qkn = 10,
  movementMax = 20,
  attacksMax = 5,
  weaponRange = 2,
  preferredRange = weaponRange,
  counterMoveMax = 1
}) {
  return createUnitState({
    unitId,
    side,
    draftSlot,
    archetypeId: unitId,
    stats: { maxHP: 100, hp, ATK: 10, DEF: 10, SDM: 10, CRIT: 0.05, QKN: qkn },
    position,
    combat: { movementMax, attacksMax, attackInterval: 1 },
    weapon: {
      weaponProfileId: `${unitId}-weapon`,
      mode: 'MELEE',
      weaponRange,
      preferredRange,
      counterMoveMax
    }
  });
}

function battle(units, board = { width: 14, height: 10 }) {
  return createBattleState({ matchId: 'stage3-test', board, units });
}

function walkUntilNotMove(state, actorId, targetId, rng = new GameplayRng(12345)) {
  const steps = [];
  while (true) {
    const result = advancePursuitOneStep(state, actorId, targetId, { rng });
    if (!result.moved) return { steps, terminal: result };
    steps.push({ ...state.units[actorId].position });
    if (result.nowInRange) {
      const terminal = planPursuitStep(state, actorId, targetId, { rng });
      return { steps, terminal };
    }
  }
}

test('engagement cells are open battlefield cells within weapon range, never the occupied target square', () => {
  const actor = unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 0 }, weaponRange: 2 });
  const target = unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 }, weaponRange: 2 });
  const blocker = unit({ unitId: 'G1', side: SIDE.B, draftSlot: 1, position: { row: 3, col: 4 } });
  const state = battle([actor, target, blocker], { width: 7, height: 7 });

  const goals = getEngagementCells(state, 'H0', 'G0');
  assert.equal(goals.some((p) => p.row === 3 && p.col === 5), false, 'target square is occupied');
  assert.equal(goals.some((p) => p.row === 3 && p.col === 4), false, 'other occupied square is excluded');
  assert.equal(goals.every((p) => manhattanDistance(p, target.position) <= 2), true);
});

test('Range-2 pursuit advances one square at a time and stops at distance 2', () => {
  const actor = unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 0 }, movementMax: 20, weaponRange: 2 });
  const target = unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 13 } });
  const state = battle([actor, target]);

  const { steps, terminal } = walkUntilNotMove(state, 'H0', 'G0');
  assert.equal(steps.length, 11);
  assert.deepEqual(state.units.H0.position, { row: 3, col: 11 });
  assert.equal(manhattanDistance(state.units.H0.position, state.units.G0.position), 2);
  assert.equal(state.units.H0.resources.movementRemaining, 9);
  assert.equal(terminal.result, PURSUIT_RESULT.ALREADY_IN_RANGE);
});

test('Range-3 pursuit naturally stops at distance 3 without over-closing', () => {
  const actor = unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 0 }, movementMax: 20, weaponRange: 3 });
  const target = unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 13 } });
  const state = battle([actor, target]);

  const { steps, terminal } = walkUntilNotMove(state, 'H0', 'G0');
  assert.equal(steps.length, 10);
  assert.deepEqual(state.units.H0.position, { row: 3, col: 10 });
  assert.equal(terminal.result, PURSUIT_RESULT.ALREADY_IN_RANGE);
});

test('one pursuit advancement spends exactly one Movement and updates occupancy immediately', () => {
  const actor = unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 0 }, movementMax: 4, weaponRange: 1 });
  const target = unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 } });
  const state = battle([actor, target], { width: 7, height: 7 });

  const result = advancePursuitOneStep(state, 'H0', 'G0');
  assert.equal(result.result, PURSUIT_RESULT.MOVE);
  assert.equal(result.moved, true);
  assert.equal(result.movementBefore, 4);
  assert.equal(result.movementAfter, 3);
  assert.deepEqual(state.units.H0.position, { row: 3, col: 1 });
  assert.equal(getOccupantId(state, 3, 0), null);
  assert.equal(getOccupantId(state, 3, 1), 'H0');
});

test('already-in-range actor spends no Movement', () => {
  const actor = unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 }, movementMax: 5, weaponRange: 2 });
  const target = unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 4 } });
  const state = battle([actor, target], { width: 7, height: 7 });

  const result = advancePursuitOneStep(state, 'H0', 'G0');
  assert.equal(result.result, PURSUIT_RESULT.ALREADY_IN_RANGE);
  assert.equal(result.moved, false);
  assert.equal(state.units.H0.resources.movementRemaining, 5);
  assert.deepEqual(state.units.H0.position, { row: 3, col: 2 });
});

test('zero Movement prevents pursuit but does not alter position', () => {
  const actor = unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 0 }, movementMax: 0, weaponRange: 1 });
  const target = unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 } });
  const state = battle([actor, target], { width: 7, height: 7 });

  const result = advancePursuitOneStep(state, 'H0', 'G0');
  assert.equal(result.result, PURSUIT_RESULT.NO_MOVEMENT);
  assert.equal(result.moved, false);
  assert.deepEqual(state.units.H0.position, { row: 3, col: 0 });
});

test('zero Attacks prevents further pursuit even if Movement remains', () => {
  const actor = unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 0 }, movementMax: 10, attacksMax: 0, weaponRange: 1 });
  const target = unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 } });
  const state = battle([actor, target], { width: 7, height: 7 });

  const result = advancePursuitOneStep(state, 'H0', 'G0');
  assert.equal(result.result, PURSUIT_RESULT.NO_ATTACKS);
  assert.equal(result.moved, false);
  assert.equal(state.units.H0.resources.movementRemaining, 10);
});

test('dead target terminates pursuit planning', () => {
  const actor = unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 0 }, weaponRange: 1 });
  const target = unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 } });
  const state = battle([actor, target], { width: 7, height: 7 });
  markUnitDead(state, 'G0');

  const result = planPursuitStep(state, 'H0', 'G0');
  assert.equal(result.result, PURSUIT_RESULT.TARGET_DEAD);
  assert.equal(result.to, null);
});

test('BFS routes around an occupied blocker rather than treating target as directly reachable', () => {
  const actor = unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 1 }, weaponRange: 1 });
  const blocker = unit({ unitId: 'H1', side: SIDE.A, draftSlot: 1, position: { row: 3, col: 2 } });
  const target = unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 } });
  const state = battle([actor, blocker, target], { width: 7, height: 7 });
  const rng = new GameplayRng(0x12345678);

  const plan = planPursuitStep(state, 'H0', 'G0', { rng });
  assert.equal(plan.result, PURSUIT_RESULT.MOVE);
  assert.equal(plan.tieBroken, true);
  assert.deepEqual(plan.candidateSteps, [{ row: 2, col: 1 }, { row: 4, col: 1 }]);
  assert.equal(rng.drawCount, 1);
});

test('equal optimal next squares consume exactly one synchronized RNG draw and replay identically', () => {
  const makeState = () => battle([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 1 }, weaponRange: 1 }),
    unit({ unitId: 'H1', side: SIDE.A, draftSlot: 1, position: { row: 3, col: 2 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 } })
  ], { width: 7, height: 7 });

  const rngA = new GameplayRng(987654321);
  const rngB = new GameplayRng(987654321);
  const planA = planPursuitStep(makeState(), 'H0', 'G0', { rng: rngA });
  const planB = planPursuitStep(makeState(), 'H0', 'G0', { rng: rngB });

  assert.deepEqual(planA.to, planB.to);
  assert.deepEqual(planA.candidateSteps, planB.candidateSteps);
  assert.equal(rngA.drawCount, 1);
  assert.equal(rngB.drawCount, 1);
  assert.equal(rngA.state, rngB.state);
});

test('pathfinding consumes no RNG when the optimal current step is unique', () => {
  const actor = unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 0 }, weaponRange: 2 });
  const target = unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 8 } });
  const state = battle([actor, target], { width: 10, height: 7 });
  const rng = new GameplayRng(55);

  const plan = planPursuitStep(state, 'H0', 'G0', { rng });
  assert.deepEqual(plan.to, { row: 3, col: 1 });
  assert.equal(plan.tieBroken, false);
  assert.equal(rng.drawCount, 0);
});

test('path is dynamically re-evaluated after occupancy changes', () => {
  const actor = unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 1 }, weaponRange: 1 });
  const blocker = unit({ unitId: 'H1', side: SIDE.A, draftSlot: 1, position: { row: 3, col: 2 } });
  const target = unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 } });
  const state = battle([actor, blocker, target], { width: 7, height: 7 });

  const before = planPursuitStep(state, 'H0', 'G0', { rng: new GameplayRng(1) });
  assert.equal(before.candidateSteps.some((p) => p.row === 3 && p.col === 2), false);

  relocateUnitOneStep(state, 'H1', { row: 2, col: 2 });
  const after = planPursuitStep(state, 'H0', 'G0');
  assert.deepEqual(after.to, { row: 3, col: 2 });
  assert.equal(after.tieBroken, false);
});

test('corpse occupancy participates in BFS blocking', () => {
  const actor = unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 1 }, weaponRange: 1 });
  const corpse = unit({ unitId: 'G1', side: SIDE.B, draftSlot: 1, position: { row: 3, col: 2 }, hp: 0 });
  const target = unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 } });
  const state = battle([actor, corpse, target], { width: 7, height: 7 });
  const plan = planPursuitStep(state, 'H0', 'G0', { rng: new GameplayRng(10) });

  assert.equal(plan.candidateSteps.some((p) => p.row === 3 && p.col === 2), false);
  assert.equal(plan.candidateSteps.length, 2);
});

test('completely enclosed actor returns NO_PATH without spending Movement or RNG', () => {
  const state = battle([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 0 }, movementMax: 10, weaponRange: 1 }),
    unit({ unitId: 'H1', side: SIDE.A, draftSlot: 1, position: { row: 1, col: 0 } }),
    unit({ unitId: 'H2', side: SIDE.A, draftSlot: 2, position: { row: 2, col: 1 } }),
    unit({ unitId: 'G1', side: SIDE.B, draftSlot: 1, position: { row: 3, col: 0 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 2, col: 4 } })
  ], { width: 5, height: 5 });
  const rng = new GameplayRng(100);

  const result = advancePursuitOneStep(state, 'H0', 'G0', { rng });
  assert.equal(result.result, PURSUIT_RESULT.NO_PATH);
  assert.equal(result.moved, false);
  assert.equal(state.units.H0.resources.movementRemaining, 10);
  assert.equal(rng.drawCount, 0);
});

test('generic resource-aware movement refuses to spend below zero', () => {
  const actor = unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 0 }, movementMax: 1 });
  const target = unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 } });
  const state = battle([actor, target], { width: 7, height: 7 });

  moveUnitOneStepWithResource(state, 'H0', { row: 3, col: 1 });
  assert.equal(state.units.H0.resources.movementRemaining, 0);
  assert.throws(() => moveUnitOneStepWithResource(state, 'H0', { row: 3, col: 2 }), /no Movement remaining/);
  assert.equal(state.units.H0.resources.movementRemaining, 0);
  assert.deepEqual(state.units.H0.position, { row: 3, col: 1 });
});
