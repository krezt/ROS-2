import {
  ACTION_KIND,
  DAMAGE_TYPE,
  EVENT_TYPE,
  SIDE,
  TARGET_TYPE,
  createActionDeclaration,
  createBattleState,
  createCombatScheduler,
  createRoundSimulation,
  createUnitState,
  manhattanDistance,
  snapshotRoundSimulation
} from '../src/index.js';

function fighter({ unitId, side, archetypeId, qkn, position, weaponRange, attacksMax = 5 }) {
  return createUnitState({
    unitId,
    side,
    draftSlot: 0,
    archetypeId,
    stats: { maxHP: 1000, hp: 1000, ATK: 0, DEF: 0, SDM: 0, CRIT: 0, QKN: qkn },
    position,
    combat: { movementMax: 12, attacksMax, attackInterval: 1 },
    weapon: {
      weaponProfileId: `${unitId}-demo-weapon`,
      mode: 'MELEE',
      weaponRange,
      preferredRange: weaponRange,
      counterMoveMax: 1,
      attackBaseMin: 10,
      attackBaseMax: 10,
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

const state = createBattleState({
  matchId: 'stage6-demo',
  roundNumber: 1,
  board: { width: 10, height: 7 },
  units: [
    fighter({ unitId: 'G0', side: SIDE.B, archetypeId: 'Barbarian', qkn: 17, position: { row: 3, col: 5 }, weaponRange: 3 }),
    fighter({ unitId: 'H0', side: SIDE.A, archetypeId: 'Warrior', qkn: 16, position: { row: 3, col: 2 }, weaponRange: 2 })
  ]
});

const simulation = createRoundSimulation({
  state,
  declarations: [attack('H0', 'G0'), attack('G0', 'H0')],
  seed: 0x61616161
});
const scheduler = createCombatScheduler(simulation);

console.log('=== ROS 2.0 STAGE 6 DEMO: RANGE 3 vs RANGE 2 ===');
console.log('G0 Barbarian: QKN 17, Range 3');
console.log('H0 Warrior:   QKN 16, Range 2');
console.log('');

for (let i = 0; i < 4; i += 1) {
  const cycle = scheduler.advanceCycle();
  console.log(`Cycle ${cycle.cycle} initiative: ${cycle.initiativeOrder.join(' -> ')}`);
  for (const advancement of cycle.advancements) {
    const extra = advancement.rangeMaintenance
      ? ` range ${advancement.rangeMaintenance.targetDistanceBefore}->${advancement.rangeMaintenance.targetDistanceAfter}`
      : '';
    console.log(`  ${advancement.actorId}: ${advancement.result}${extra}`);
  }
  const g = simulation.state.units.G0;
  const h = simulation.state.units.H0;
  console.log(`  positions: G0=(${g.position.row},${g.position.col}) H0=(${h.position.row},${h.position.col}) distance=${manhattanDistance(g.position, h.position)}`);
  console.log('');
}

console.log('Range-maintenance MOVE events:');
for (const event of simulation.events.snapshot().filter((e) => e.type === EVENT_TYPE.MOVE && e.payload.movementReason === 'RANGE_MAINTENANCE')) {
  const p = event.payload;
  console.log(`  C${event.initiativeCycle} ${event.actorId}: (${p.from.row},${p.from.col})->(${p.to.row},${p.to.col}) distance ${p.targetDistanceBefore}->${p.targetDistanceAfter}`);
}

const snapshot = snapshotRoundSimulation(simulation);
console.log('\nDeterminism digest after four cycles:');
console.log(`State hash: ${snapshot.stateHash}`);
console.log(`Event hash: ${snapshot.eventHash}`);
console.log(`RNG draws: ${snapshot.rng.drawCount}`);
console.log(`RNG final state: ${snapshot.rng.state}`);
