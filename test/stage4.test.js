import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION_KIND,
  ORDINARY_ADVANCE_RESULT,
  SIDE,
  TARGET_TYPE,
  createActionDeclaration,
  createBattleState,
  createHoldDeclaration,
  createInitiativeScheduler,
  createRoundSimulation,
  createUnitState,
  getOrdinaryEligibleActorIds,
  manhattanDistance,
  orderOrdinaryActorsForCycle
} from '../src/index.js';

function unit({
  unitId,
  side,
  draftSlot = 0,
  position,
  qkn = 10,
  movementMax = 20,
  attacksMax = 5,
  weaponRange = 2,
  attackInterval = 1
}) {
  return createUnitState({
    unitId,
    side,
    draftSlot,
    archetypeId: unitId,
    stats: { maxHP: 100, hp: 100, ATK: 10, DEF: 10, SDM: 10, CRIT: 0.05, QKN: qkn },
    position,
    combat: { movementMax, attacksMax, attackInterval },
    weapon: {
      weaponProfileId: `${unitId}-weapon`,
      mode: 'MELEE',
      weaponRange,
      preferredRange: weaponRange,
      counterMoveMax: 1
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

function simulation({ units, declarations, seed = 12345, board = { width: 14, height: 10 } }) {
  const state = createBattleState({ matchId: 'stage4-test', roundNumber: 1, board, units });
  return createRoundSimulation({ state, declarations, seed });
}

function moveEvents(sim) {
  return sim.events.snapshot().filter((event) => event.type === 'MOVE');
}

test('higher QKN determines ordinary initiative order every cycle', () => {
  const sim = simulation({
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 0 }, qkn: 16 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 13 }, qkn: 17 })
    ],
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), attack({ actorId: 'G0', targetId: 'H0' })]
  });
  const scheduler = createInitiativeScheduler(sim);

  const c0 = scheduler.advanceCycle();
  const c1 = scheduler.advanceCycle();
  assert.deepEqual(c0.initiativeOrder, ['G0', 'H0']);
  assert.deepEqual(c1.initiativeOrder, ['G0', 'H0']);
  assert.equal(c0.cycle, 0);
  assert.equal(c1.cycle, 1);
  assert.equal(sim.state.round.initiativeCycle, 2);
});

test('reversing QKN reverses the recurring ordinary order', () => {
  const sim = simulation({
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 0 }, qkn: 18 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 13 }, qkn: 15 })
    ],
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), attack({ actorId: 'G0', targetId: 'H0' })]
  });
  const scheduler = createInitiativeScheduler(sim);
  assert.deepEqual(scheduler.advanceCycle().initiativeOrder, ['H0', 'G0']);
  assert.deepEqual(scheduler.advanceCycle().initiativeOrder, ['H0', 'G0']);
});

test('equal QKN order uses synchronized RNG and replays identically', () => {
  const make = () => simulation({
    seed: 0xabcdef01,
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 0 }, qkn: 16 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 2, col: 8 }, qkn: 16 })
    ],
    board: { width: 10, height: 6 },
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), attack({ actorId: 'G0', targetId: 'H0' })]
  });

  const a = make();
  const b = make();
  const orderA = createInitiativeScheduler(a).advanceCycle().initiativeOrder;
  const orderB = createInitiativeScheduler(b).advanceCycle().initiativeOrder;

  assert.deepEqual(orderA, orderB);
  assert.equal(a.rng.drawCount, 1, 'two-way QKN tie consumes exactly one draw when movement paths are unique');
  assert.equal(b.rng.drawCount, 1);
  assert.equal(a.rng.state, b.rng.state);
});

test('three-way QKN tie is canonicalized then seeded-shuffled with exactly N-1 draws', () => {
  const units = [
    unit({ unitId: 'H0', side: SIDE.A, draftSlot: 0, position: { row: 1, col: 0 }, qkn: 12 }),
    unit({ unitId: 'H1', side: SIDE.A, draftSlot: 1, position: { row: 3, col: 0 }, qkn: 12 }),
    unit({ unitId: 'G0', side: SIDE.B, draftSlot: 0, position: { row: 2, col: 6 }, qkn: 12 }),
    unit({ unitId: 'G1', side: SIDE.B, draftSlot: 1, position: { row: 4, col: 6 }, qkn: 5 })
  ];
  const declarations = [
    attack({ actorId: 'H0', targetId: 'G0' }),
    attack({ actorId: 'H1', targetId: 'G0' }),
    attack({ actorId: 'G0', targetId: 'H0' }),
    createHoldDeclaration({ declarationId: 'D-G1-HOLD', roundNumber: 1, actorId: 'G1' })
  ];
  const sim = simulation({ units, declarations, seed: 222, board: { width: 7, height: 6 } });

  const eligible = getOrdinaryEligibleActorIds(sim);
  assert.deepEqual(eligible.slice().sort(), ['G0', 'H0', 'H1']);
  const ordered = orderOrdinaryActorsForCycle(sim, eligible, { cycle: 0 });
  assert.equal(new Set(ordered).size, 3);
  assert.deepEqual(ordered.slice().sort(), ['G0', 'H0', 'H1']);
  assert.equal(sim.rng.drawCount, 2);
});

test('two opposing melee champions genuinely interleave and meet through initiative cycles', () => {
  const sim = simulation({
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 0 }, qkn: 16, weaponRange: 2 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 13 }, qkn: 17, weaponRange: 2 })
    ],
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), attack({ actorId: 'G0', targetId: 'H0' })]
  });
  const scheduler = createInitiativeScheduler(sim);
  const result = scheduler.runUntilMovementStalled();
  const moves = moveEvents(sim);

  assert.equal(result.stalled, true);
  assert.deepEqual(moves.slice(0, 6).map((e) => e.actorId), ['G0', 'H0', 'G0', 'H0', 'G0', 'H0']);
  assert.deepEqual(sim.state.units.H0.position, { row: 3, col: 5 });
  assert.deepEqual(sim.state.units.G0.position, { row: 3, col: 7 });
  assert.equal(manhattanDistance(sim.state.units.H0.position, sim.state.units.G0.position), 2);
  assert.equal(sim.state.units.H0.resources.movementRemaining, 15);
  assert.equal(sim.state.units.G0.resources.movementRemaining, 14);
});

test('each eligible actor receives at most one ordinary advancement per initiative cycle', () => {
  const sim = simulation({
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 0 }, qkn: 20 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 10 }, qkn: 1 })
    ],
    board: { width: 12, height: 7 },
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), attack({ actorId: 'G0', targetId: 'H0' })]
  });
  const scheduler = createInitiativeScheduler(sim);
  const cycle = scheduler.advanceCycle();

  assert.equal(cycle.advancements.filter((a) => a.actorId === 'H0').length, 1);
  assert.equal(cycle.advancements.filter((a) => a.actorId === 'G0').length, 1);
  assert.deepEqual(sim.state.units.H0.position, { row: 3, col: 1 });
  assert.deepEqual(sim.state.units.G0.position, { row: 3, col: 9 });
});

test('HOLD has no ordinary initiative opportunity and causes no proactive movement', () => {
  const sim = simulation({
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 0 }, qkn: 99 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 8 }, qkn: 1 })
    ],
    board: { width: 10, height: 7 },
    declarations: [
      createHoldDeclaration({ declarationId: 'D-H0-HOLD', roundNumber: 1, actorId: 'H0' }),
      attack({ actorId: 'G0', targetId: 'H0' })
    ]
  });
  const scheduler = createInitiativeScheduler(sim);
  const cycle = scheduler.advanceCycle();

  assert.deepEqual(cycle.initiativeOrder, ['G0']);
  assert.deepEqual(sim.state.units.H0.position, { row: 3, col: 0 });
  assert.deepEqual(sim.state.units.G0.position, { row: 3, col: 7 });
  assert.equal(sim.rng.drawCount, 0, 'HOLD never participates in QKN tie logic');
});

test('Stage-4 scheduler leaves unsupported spell runtime untouched instead of inventing timing', () => {
  const caster = unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 0 }, qkn: 50 });
  const enemy = unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 8 }, qkn: 1 });
  const spell = createActionDeclaration({
    declarationId: 'D-H0-SPELL', roundNumber: 1, actorId: 'H0', actionId: 'TEST_SPELL',
    actionKind: ACTION_KIND.SPELL,
    target: { type: TARGET_TYPE.UNIT, unitId: 'G0' }
  });
  const sim = simulation({
    units: [caster, enemy],
    board: { width: 10, height: 7 },
    declarations: [spell, createHoldDeclaration({ declarationId: 'D-G0-HOLD', roundNumber: 1, actorId: 'G0' })]
  });
  const scheduler = createInitiativeScheduler(sim);
  const runtime = sim.runtimes['R1:H0'];

  const cycle = scheduler.advanceCycle();
  assert.deepEqual(cycle.initiativeOrder, []);
  assert.equal(runtime.state, 'PENDING');
  assert.equal(runtime.castStartCycle, null);
  assert.equal(runtime.completionCycle, null);
  assert.equal(sim.rng.drawCount, 0);
});

test('movement emits authoritative MOVE events in the same order as ordinary initiative', () => {
  const sim = simulation({
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 0 }, qkn: 10 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 8 }, qkn: 20 })
    ],
    board: { width: 10, height: 7 },
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), attack({ actorId: 'G0', targetId: 'H0' })]
  });
  createInitiativeScheduler(sim).advanceCycle();
  const moves = moveEvents(sim);

  assert.deepEqual(moves.map((e) => e.actorId), ['G0', 'H0']);
  assert.deepEqual(moves[0].payload.from, { row: 3, col: 8 });
  assert.deepEqual(moves[0].payload.to, { row: 3, col: 7 });
  assert.equal(moves[0].initiativeCycle, 0);
});

test('runtime becomes ACTIVE on its first ordinary advancement and records current pursuit state', () => {
  const sim = simulation({
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 0 }, qkn: 10 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 8 }, qkn: 5 })
    ],
    board: { width: 10, height: 7 },
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), createHoldDeclaration({ declarationId: 'D-G0-HOLD', roundNumber: 1, actorId: 'G0' })]
  });
  const scheduler = createInitiativeScheduler(sim);
  const runtime = sim.runtimes['R1:H0'];
  assert.equal(runtime.state, 'PENDING');

  const advancement = scheduler.advanceCycle().advancements[0];
  assert.equal(runtime.state, 'ACTIVE');
  assert.equal(runtime.metadata.lastOrdinaryCycle, 0);
  assert.equal(runtime.metadata.lastPursuitResult, 'MOVE');
  assert.equal(advancement.result, ORDINARY_ADVANCE_RESULT.MOVED);
});

test('a complete no-movement cycle stalls Stage 4 cleanly at READY_TO_ATTACK rather than completing the action', () => {
  const sim = simulation({
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 }, qkn: 10, weaponRange: 2 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 }, qkn: 9, weaponRange: 2 })
    ],
    board: { width: 8, height: 7 },
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), attack({ actorId: 'G0', targetId: 'H0' })]
  });
  const scheduler = createInitiativeScheduler(sim);
  const result = scheduler.runUntilMovementStalled();

  assert.equal(result.cycles.length, 1);
  assert.equal(result.cycles[0].madeStage4Progress, false);
  assert.deepEqual(result.cycles[0].advancements.map((a) => a.result), [
    ORDINARY_ADVANCE_RESULT.READY_TO_ATTACK,
    ORDINARY_ADVANCE_RESULT.READY_TO_ATTACK
  ]);
  assert.equal(sim.runtimes['R1:H0'].completed, false);
  assert.equal(sim.runtimes['R1:G0'].completed, false);
});

test('pending reaction chain is drained before unrelated ordinary initiative continues', () => {
  const observed = [];
  const sim = simulation({
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 0 }, qkn: 20 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 2, col: 6 }, qkn: 10 })
    ],
    board: { width: 8, height: 6 },
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), attack({ actorId: 'G0', targetId: 'H0' })]
  });

  const scheduler = createInitiativeScheduler(sim, {
    ordinaryAdvancer: (_simulation, actorId, { scheduler: ctxScheduler }) => {
      observed.push(`ordinary:${actorId}`);
      if (actorId === 'H0') {
        ctxScheduler.reactions.enqueue({ type: 'TEST_REACTION', actorId: 'G0', targetId: 'H0' });
      }
      return Object.freeze({ actorId, runtimeId: `R1:${actorId}`, result: 'TEST', moved: false });
    },
    reactionResolver: (reaction) => {
      observed.push(`reaction:${reaction.type}`);
    }
  });

  scheduler.advanceCycle();
  assert.deepEqual(observed, ['ordinary:H0', 'reaction:TEST_REACTION', 'ordinary:G0']);
});

test('nested reactions fully drain before scheduler returns to ordinary initiative', () => {
  const observed = [];
  const sim = simulation({
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 0 }, qkn: 20 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 2, col: 6 }, qkn: 10 })
    ],
    board: { width: 8, height: 6 },
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), attack({ actorId: 'G0', targetId: 'H0' })]
  });

  const scheduler = createInitiativeScheduler(sim, {
    ordinaryAdvancer: (_simulation, actorId, { scheduler: ctxScheduler }) => {
      observed.push(`ordinary:${actorId}`);
      if (actorId === 'H0') ctxScheduler.reactions.enqueue({ type: 'R1' });
      return Object.freeze({ actorId, runtimeId: `R1:${actorId}`, result: 'TEST', moved: false });
    },
    reactionResolver: (reaction, { scheduler: ctxScheduler }) => {
      observed.push(`reaction:${reaction.type}`);
      if (reaction.type === 'R1') ctxScheduler.reactions.enqueue({ type: 'R2' });
    }
  });

  scheduler.advanceCycle();
  assert.deepEqual(observed, ['ordinary:H0', 'reaction:R1', 'reaction:R2', 'ordinary:G0']);
});

test('initiative trace records cycle boundaries and QKN order without adding fake gameplay events', () => {
  const sim = simulation({
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 0 }, qkn: 11 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 2, col: 6 }, qkn: 12 })
    ],
    board: { width: 8, height: 6 },
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), attack({ actorId: 'G0', targetId: 'H0' })]
  });

  createInitiativeScheduler(sim).advanceCycle();
  const trace = sim.trace.snapshot();
  const start = trace.find((entry) => entry.kind === 'CYCLE_START');
  const end = trace.find((entry) => entry.kind === 'CYCLE_END');
  assert.deepEqual(start.payload.initiativeOrder, ['G0', 'H0']);
  assert.deepEqual(end.payload.initiativeOrder, ['G0', 'H0']);
  assert.equal(sim.events.snapshot().some((event) => event.type === 'CYCLE_START'), false);
});

test('complete Stage-4 initiative replay is deterministic across identical simulations', async () => {
  const { snapshotRoundSimulation } = await import('../src/index.js');
  const make = () => simulation({
    seed: 0x10203040,
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 0 }, qkn: 14, weaponRange: 2 }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 2, col: 9 }, qkn: 14, weaponRange: 2 })
    ],
    board: { width: 11, height: 6 },
    declarations: [attack({ actorId: 'H0', targetId: 'G0' }), attack({ actorId: 'G0', targetId: 'H0' })]
  });

  const a = make();
  const b = make();
  createInitiativeScheduler(a).runUntilMovementStalled();
  createInitiativeScheduler(b).runUntilMovementStalled();
  const sa = snapshotRoundSimulation(a);
  const sb = snapshotRoundSimulation(b);

  assert.equal(sa.stateHash, sb.stateHash);
  assert.equal(sa.eventHash, sb.eventHash);
  assert.deepEqual(sa.rng, sb.rng);
  assert.deepEqual(sa.events, sb.events);
});
