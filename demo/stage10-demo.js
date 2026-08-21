import {
  ACTION_KIND, DAMAGE_TYPE, EVENT_TYPE, SIDE, TARGET_TYPE,
  createActionDeclaration, createBattleState, createRoundSimulation,
  createSpellCombatScheduler, createUnitState, snapshotRoundSimulation
} from '../src/index.js';

function unit({ unitId, side, position, qkn, attacksMax, movementMax, attackInterval, weaponRange, preferredRange, counterMoveMax, damage }) {
  return createUnitState({
    unitId, side, draftSlot: 0, archetypeId: unitId,
    stats: { maxHP: 500, hp: 500, ATK: 0, DEF: 0, SDM: 0, CRIT: 0, QKN: qkn },
    position,
    combat: { movementMax, attacksMax, attackInterval },
    weapon: {
      weaponProfileId: `${unitId}-weapon`, mode: 'MELEE', weaponRange, preferredRange, counterMoveMax,
      attackBaseMin: damage, attackBaseMax: damage, accuracy: 1, critBonus: 0, critMultiplier: 1.75,
      defensePenetration: 0, damageType: DAMAGE_TYPE.PHYSICAL, dodgeable: false
    }
  });
}

const caster = unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 4 }, qkn: 15,
  attacksMax: 4, movementMax: 4, attackInterval: 1, weaponRange: 3, preferredRange: 3, counterMoveMax: 1, damage: 18 });
const warrior = unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, qkn: 16,
  attacksMax: 3, movementMax: 0, attackInterval: 2, weaponRange: 2, preferredRange: 2, counterMoveMax: 1, damage: 25 });

const declarations = [
  createActionDeclaration({
    declarationId: 'D-H0', roundNumber: 1, actorId: 'H0', actionId: 'ARC_BOLT', actionKind: ACTION_KIND.SPELL,
    target: { type: TARGET_TYPE.UNIT, unitId: 'G0' },
    payload: { spell: { completionDelayCycles: 2, castRange: 6, effect: { type: 'DAMAGE', amount: 40 } } }
  }),
  createActionDeclaration({
    declarationId: 'D-G0', roundNumber: 1, actorId: 'G0', actionId: 'ATTACK', actionKind: ACTION_KIND.BASIC_ATTACK,
    target: { type: TARGET_TYPE.UNIT, unitId: 'H0' }
  })
];

const simulation = createRoundSimulation({
  state: createBattleState({ matchId: 'stage10-demo', roundNumber: 1, board: { width: 14, height: 10 }, units: [caster, warrior] }),
  declarations,
  seed: 0x10a0b0c0
});
const scheduler = createSpellCombatScheduler(simulation, { countersEnabled: true });

for (let i = 0; i < 4; i += 1) {
  const before = simulation.state.round.initiativeCycle;
  const result = scheduler.advanceCycle();
  const newEvents = simulation.events.snapshot().filter((e) => e.initiativeCycle === before);
  console.log(`\nCycle ${before}`);
  for (const e of newEvents) {
    if ([EVENT_TYPE.ATTACK_START, EVENT_TYPE.CAST_COMPLETE, EVENT_TYPE.CAST_INTERRUPT, EVENT_TYPE.COUNTER, EVENT_TYPE.COUNTER_MOVE, EVENT_TYPE.DAMAGE].includes(e.type)) {
      console.log(`  ${e.type} ${e.actorId ?? '-'} -> ${e.targetId ?? '-'} ${JSON.stringify(e.payload)}`);
    }
  }
  console.log(`  H0 pos=${JSON.stringify(simulation.state.units.H0.position)} HP=${simulation.state.units.H0.stats.hp} M=${simulation.state.units.H0.resources.movementRemaining} A=${simulation.state.units.H0.resources.attacksRemaining}`);
  console.log(`  G0 pos=${JSON.stringify(simulation.state.units.G0.position)} HP=${simulation.state.units.G0.stats.hp} A=${simulation.state.units.G0.resources.attacksRemaining}`);
}

const digest = snapshotRoundSimulation(simulation);
console.log('\nDigest');
console.log('State hash:', digest.stateHash);
console.log('Event hash:', digest.eventHash);
console.log('RNG draws:', digest.rng.drawCount);
console.log('RNG final state:', digest.rng.state);
