import {
  SIDE,
  createBattleState,
  createUnitState,
  getOccupantId,
  markUnitDead,
  relocateUnitOneStep,
  standardStartingPosition
} from '../src/index.js';

function makeUnit(unitId, side, draftSlot) {
  return createUnitState({
    unitId,
    side,
    draftSlot,
    archetypeId: unitId,
    stats: { maxHP: 100, hp: 100, ATK: 10, DEF: 10, SDM: 10, CRIT: 0.05, QKN: 10 },
    position: standardStartingPosition({ side, draftSlot }),
    combat: { movementMax: 10, attacksMax: 5, attackInterval: 1 },
    weapon: { weaponProfileId: 'demo', mode: 'MELEE', weaponRange: 2, preferredRange: 2, counterMoveMax: 1 }
  });
}

const units = [];
for (const side of [SIDE.A, SIDE.B]) {
  for (let slot = 0; slot < 3; slot += 1) {
    units.push(makeUnit(`${side === SIDE.A ? 'H' : 'G'}${slot}`, side, slot));
  }
}

const state = createBattleState({ matchId: 'stage2-demo', units });
console.log('Opening occupancy:', state.board.occupancy);

relocateUnitOneStep(state, 'H0', { row: 3, col: 1 });
console.log('H0 moved. Old square:', getOccupantId(state, 3, 0), 'New square:', getOccupantId(state, 3, 1));

markUnitDead(state, 'H0');
console.log('H0 is dead but still occupies:', getOccupantId(state, 3, 1));
