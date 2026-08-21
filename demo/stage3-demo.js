import {
  GameplayRng,
  PURSUIT_RESULT,
  SIDE,
  advancePursuitOneStep,
  createBattleState,
  createUnitState,
  manhattanDistance
} from '../src/index.js';

function makeUnit({ unitId, side, position, qkn, range, movementMax }) {
  return createUnitState({
    unitId,
    side,
    draftSlot: 0,
    archetypeId: unitId === 'H0' ? 'Warrior' : 'Barbarian',
    stats: { maxHP: 500, hp: 500, ATK: 80, DEF: 70, SDM: 20, CRIT: 0.1, QKN: qkn },
    position,
    combat: { movementMax, attacksMax: 7, attackInterval: 1 },
    weapon: {
      weaponProfileId: unitId === 'H0' ? 'sword' : 'long-axe',
      mode: 'MELEE',
      weaponRange: range,
      preferredRange: range,
      counterMoveMax: 1
    }
  });
}

const state = createBattleState({
  matchId: 'stage3-demo',
  board: { width: 14, height: 10 },
  units: [
    makeUnit({ unitId: 'H0', side: SIDE.A, position: { row: 5, col: 0 }, qkn: 16, range: 2, movementMax: 12 }),
    makeUnit({ unitId: 'G0', side: SIDE.B, position: { row: 5, col: 13 }, qkn: 17, range: 3, movementMax: 12 })
  ]
});

const rng = new GameplayRng(0x51a3e3);
console.log('Stage 3: pathfinding/movement demo (no initiative scheduler yet)');
console.log('Warrior starts:', state.units.H0.position, 'target distance:', manhattanDistance(state.units.H0.position, state.units.G0.position));

for (let step = 1; step <= 12; step += 1) {
  const result = advancePursuitOneStep(state, 'H0', 'G0', { rng });
  console.log(`Step ${step}:`, result.result, 'position=', state.units.H0.position,
    'movement=', state.units.H0.resources.movementRemaining,
    'distance=', manhattanDistance(state.units.H0.position, state.units.G0.position));
  if (result.result !== PURSUIT_RESULT.MOVE || result.nowInRange) break;
}

console.log('Gameplay RNG draws used by path ties:', rng.drawCount);
