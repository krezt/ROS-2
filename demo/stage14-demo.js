import {
  DAMAGE_TYPE, SIDE,
  applyBleed, applyPoison, applyTimedStatus, closeRound,
  createBattleState, createHoldDeclaration, createRoundSimulation, createUnitState,
  findStatus, poisonTotal, snapshotRoundSimulation
} from '../src/index.js';

function unit({ unitId, side, position }) {
  return createUnitState({
    unitId, side, draftSlot: 0, archetypeId: unitId,
    stats: { maxHP: 1000, hp: 1000, ATK: 0, DEF: 0, SDM: 0, CRIT: 0, QKN: 10 },
    position,
    combat: { movementMax: 8, attacksMax: 4, attackInterval: 1 },
    weapon: { weaponRange: 2, preferredRange: 2, counterMoveMax: 1, attackBaseMin: 10, attackBaseMax: 10, accuracy: 1, critMultiplier: 1.75, damageType: DAMAGE_TYPE.PHYSICAL, dodgeable: false }
  });
}

const state = createBattleState({
  matchId: 'stage14-demo',
  units: [
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 } })
  ]
});
const simulation = createRoundSimulation({
  state,
  declarations: [
    createHoldDeclaration({ declarationId: 'D-H0', roundNumber: 1, actorId: 'H0' }),
    createHoldDeclaration({ declarationId: 'D-G0', roundNumber: 1, actorId: 'G0' })
  ],
  seed: 0x140014
});

applyPoison(simulation, 'G0', 100, { sourceId: 'H0' });
applyPoison(simulation, 'G0', 50, { sourceId: 'H0' });
applyBleed(simulation, 'G0', { duration: 3, pct: 0.15, sourceId: 'H0' });
applyTimedStatus(simulation, 'G0', { key: 'invisible', duration: 2, sourceId: 'G0' });

console.log('Before end Round 1:', {
  hp: simulation.state.units.G0.stats.hp,
  poison: poisonTotal(simulation.state.units.G0),
  bleedDuration: findStatus(simulation.state.units.G0, 'bleed')?.duration,
  invisibleDuration: findStatus(simulation.state.units.G0, 'invisible')?.duration
});

closeRound(simulation);
console.log('After end Round 1 / start Round 2:', {
  hp: simulation.state.units.G0.stats.hp,
  poison: poisonTotal(simulation.state.units.G0),
  bleedDuration: findStatus(simulation.state.units.G0, 'bleed')?.duration,
  invisibleDuration: findStatus(simulation.state.units.G0, 'invisible')?.duration,
  roundNumber: simulation.state.roundNumber
});

const snap = snapshotRoundSimulation(simulation);
console.log('State hash:', snap.stateHash);
console.log('Event hash:', snap.eventHash);
console.log('RNG draws:', snap.rng.drawCount);
console.log('RNG final state:', snap.rng.state);
