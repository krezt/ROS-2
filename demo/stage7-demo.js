import {
  ACTION_KIND, DAMAGE_TYPE, EVENT_TYPE, SIDE, TARGET_TYPE,
  createActionDeclaration, createBattleState, createCombatScheduler,
  createRoundSimulation, createUnitState, snapshotRoundSimulation
} from '../src/index.js';

function makeUnit({ unitId, side, col, qkn, range }) {
  return createUnitState({
    unitId, side, draftSlot: 0, archetypeId: unitId,
    stats: { maxHP: 1000, hp: 1000, ATK: 0, DEF: 0, SDM: 0, CRIT: 0, QKN: qkn },
    position: { row: 3, col },
    combat: { movementMax: 8, attacksMax: 4, attackInterval: 1 },
    weapon: {
      weaponProfileId: `${unitId}-weapon`, mode: 'MELEE', weaponRange: range,
      preferredRange: range, counterMoveMax: 1,
      attackBaseMin: 10, attackBaseMax: 10, accuracy: 1,
      critBonus: 0, critMultiplier: 1.75, defensePenetration: 0,
      damageType: DAMAGE_TYPE.PHYSICAL, dodgeable: false
    }
  });
}
function attack(actorId, targetId) {
  return createActionDeclaration({
    declarationId: `D-${actorId}`, roundNumber: 1, actorId,
    actionId: 'ATTACK', actionKind: ACTION_KIND.BASIC_ATTACK,
    target: { type: TARGET_TYPE.UNIT, unitId: targetId }
  });
}

const simulation = createRoundSimulation({
  state: createBattleState({
    matchId: 'stage7-demo', roundNumber: 1, board: { width: 10, height: 7 },
    units: [
      makeUnit({ unitId: 'H0', side: SIDE.A, col: 2, qkn: 16, range: 2 }),
      makeUnit({ unitId: 'G0', side: SIDE.B, col: 5, qkn: 17, range: 3 })
    ]
  }),
  declarations: [attack('H0', 'G0'), attack('G0', 'H0')],
  seed: 202607
});

const scheduler = createCombatScheduler(simulation);
for (let i = 0; i < 4; i += 1) {
  const cycle = scheduler.advanceCycle();
  console.log(`Cycle ${cycle.cycle}: ${cycle.advancements.map((x) => `${x.actorId}:${x.result}`).join(' | ')}`);
}

console.log('\nCounter events:');
for (const event of simulation.events.snapshot().filter((e) => e.type === EVENT_TYPE.COUNTER || e.type === EVENT_TYPE.COUNTER_MOVE)) {
  console.log(event.eventId, event.type, `${event.actorId}->${event.targetId}`, event.payload);
}

const snap = snapshotRoundSimulation(simulation);
console.log('\nFinal positions/resources:');
for (const id of ['H0', 'G0']) {
  const u = simulation.state.units[id];
  console.log(id, u.position, { movement: u.resources.movementRemaining, attacks: u.resources.attacksRemaining, hp: u.stats.hp });
}
console.log('\nState hash:', snap.stateHash);
console.log('Event hash:', snap.eventHash);
console.log('RNG draws:', snap.rng.drawCount);
