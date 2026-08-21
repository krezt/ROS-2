import {
  ACTION_KIND,
  SIDE,
  TARGET_TYPE,
  createActionDeclaration,
  createBattleState,
  createInitiativeScheduler,
  createRoundSimulation,
  createUnitState,
  manhattanDistance,
  snapshotRoundSimulation
} from '../src/index.js';

function makeUnit({ unitId, side, position, qkn, archetypeId }) {
  return createUnitState({
    unitId,
    side,
    draftSlot: 0,
    archetypeId,
    stats: { maxHP: 250, hp: 250, ATK: 50, DEF: 40, SDM: 20, CRIT: 0.05, QKN: qkn },
    position,
    combat: { movementMax: 20, attacksMax: 7, attackInterval: 1 },
    weapon: {
      weaponProfileId: `${unitId}-range2`,
      mode: 'MELEE',
      weaponRange: 2,
      preferredRange: 2,
      counterMoveMax: 1
    }
  });
}

const warrior = makeUnit({
  unitId: 'H0',
  side: SIDE.A,
  position: { row: 3, col: 0 },
  qkn: 16,
  archetypeId: 'Warrior'
});

const barbarian = makeUnit({
  unitId: 'G0',
  side: SIDE.B,
  position: { row: 3, col: 13 },
  qkn: 17,
  archetypeId: 'Barbarian'
});

const state = createBattleState({
  matchId: 'stage4-demo',
  roundNumber: 1,
  board: { width: 14, height: 10 },
  units: [warrior, barbarian]
});

const declarations = [
  createActionDeclaration({
    declarationId: 'D-H0-R1',
    roundNumber: 1,
    actorId: 'H0',
    actionId: 'ATTACK',
    actionKind: ACTION_KIND.BASIC_ATTACK,
    target: { type: TARGET_TYPE.UNIT, unitId: 'G0' }
  }),
  createActionDeclaration({
    declarationId: 'D-G0-R1',
    roundNumber: 1,
    actorId: 'G0',
    actionId: 'ATTACK',
    actionKind: ACTION_KIND.BASIC_ATTACK,
    target: { type: TARGET_TYPE.UNIT, unitId: 'H0' }
  })
];

const sim = createRoundSimulation({ state, declarations, seed: 0x5a17e004 });
const scheduler = createInitiativeScheduler(sim);
const run = scheduler.runUntilMovementStalled();

console.log('=== ROS 2.0 Stage 4 Demo ===');
console.log('QKN: G0 Barbarian = 17, H0 Warrior = 16');
console.log('');

for (const cycle of run.cycles) {
  console.log(`Cycle ${cycle.cycle}: ${cycle.initiativeOrder.join(' -> ') || '(no Stage-4 ordinary actors)'}`);
  for (const advancement of cycle.advancements) {
    if (advancement.moved) {
      console.log(`  ${advancement.actorId} MOVE (${advancement.from.row},${advancement.from.col}) -> (${advancement.to.row},${advancement.to.col})`);
    } else {
      console.log(`  ${advancement.actorId} ${advancement.result}`);
    }
  }
}

const h = sim.state.units.H0;
const g = sim.state.units.G0;
const snapshot = snapshotRoundSimulation(sim);

console.log('');
console.log('Final:');
console.log(`  H0 Warrior:    (${h.position.row},${h.position.col}), Movement ${h.resources.movementRemaining}/${h.resources.movementMax}`);
console.log(`  G0 Barbarian:  (${g.position.row},${g.position.col}), Movement ${g.resources.movementRemaining}/${g.resources.movementMax}`);
console.log(`  Distance: ${manhattanDistance(h.position, g.position)}`);
console.log(`  Initiative cycle now: ${sim.state.round.initiativeCycle}`);
console.log(`  RNG draws: ${snapshot.rng.drawCount}`);
console.log(`  State hash: ${snapshot.stateHash}`);
console.log(`  Event hash: ${snapshot.eventHash}`);
