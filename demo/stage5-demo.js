import {
  ACTION_KIND,
  DAMAGE_TYPE,
  SIDE,
  TARGET_TYPE,
  createActionDeclaration,
  createBattleState,
  createCombatScheduler,
  createRoundSimulation,
  createUnitState,
  snapshotRoundSimulation
} from '../src/index.js';

function fighter({ unitId, side, qkn, col, attacksMax, attackInterval, damage }) {
  return createUnitState({
    unitId,
    side,
    draftSlot: 0,
    archetypeId: unitId === 'G0' ? 'Barbarian' : 'Warrior',
    stats: {
      maxHP: 300,
      hp: 300,
      ATK: 0,
      DEF: 0,
      SDM: 0,
      CRIT: 0,
      QKN: qkn
    },
    position: { row: 3, col },
    combat: {
      movementMax: 20,
      attacksMax,
      attackInterval
    },
    weapon: {
      weaponProfileId: `${unitId}-demo-weapon`,
      mode: 'MELEE',
      weaponRange: 2,
      preferredRange: 2,
      counterMoveMax: 1,
      attackBaseMin: damage,
      attackBaseMax: damage,
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
  matchId: 'stage5-demo',
  roundNumber: 1,
  board: { width: 14, height: 10 },
  units: [
    fighter({ unitId: 'H0', side: SIDE.A, qkn: 16, col: 0, attacksMax: 6, attackInterval: 2, damage: 18 }),
    fighter({ unitId: 'G0', side: SIDE.B, qkn: 17, col: 13, attacksMax: 7, attackInterval: 1, damage: 20 })
  ]
});

const simulation = createRoundSimulation({
  state,
  declarations: [attack('H0', 'G0'), attack('G0', 'H0')],
  seed: 0x51515151
});

const scheduler = createCombatScheduler(simulation);
const result = scheduler.runUntilCombatSettled();

console.log('=== ROS 2.0 STAGE 5 DEMO ===');
console.log(`Cycles resolved: ${result.cycles.length}`);
console.log('');

for (const cycle of result.cycles) {
  const summary = cycle.advancements.map((x) => `${x.actorId}:${x.result}`).join(' | ');
  const dump = cycle.dumpedAttackCount ? ` | dump=${cycle.dumpedAttackCount}` : '';
  console.log(`Cycle ${cycle.cycle}: ${summary}${dump}`);
}

console.log('\nFinal units:');
for (const unit of Object.values(simulation.state.units).sort((a, b) => a.unitId.localeCompare(b.unitId))) {
  console.log(`${unit.unitId} ${unit.archetypeId}: HP=${unit.stats.hp}/${unit.stats.maxHP} pos=(${unit.position.row},${unit.position.col}) attacks=${unit.resources.attacksRemaining} movement=${unit.resources.movementRemaining} ${unit.lifeState}`);
}

console.log('\nAttack events:');
for (const event of simulation.events.snapshot().filter((e) => e.type === 'ATTACK_START' || e.type === 'DAMAGE' || e.type === 'KO')) {
  if (event.type === 'ATTACK_START') {
    console.log(`C${event.initiativeCycle} ${event.actorId} ATTACK ${event.targetId} [${event.payload.attackReason}] attacks ${event.payload.attacksBefore}->${event.payload.attacksAfter}`);
  } else if (event.type === 'DAMAGE') {
    console.log(`   DAMAGE ${event.targetId}: -${event.payload.amount} HP ${event.payload.hpBefore}->${event.payload.hpAfter}`);
  } else {
    console.log(`   KO ${event.targetId}`);
  }
}

const snapshot = snapshotRoundSimulation(simulation);
console.log('\nDeterminism digest:');
console.log(`State hash: ${snapshot.stateHash}`);
console.log(`Event hash: ${snapshot.eventHash}`);
console.log(`RNG draws: ${snapshot.rng.drawCount}`);
console.log(`RNG final state: ${snapshot.rng.state}`);
