import test from 'node:test';
import assert from 'node:assert/strict';

import {
  LIFE_STATE,
  SIDE,
  assertBattlefieldInvariants,
  cellKey,
  createBattleState,
  createUnitState,
  getOccupantId,
  hashCanonical,
  isCellOpen,
  isOccupied,
  markUnitDead,
  parseCellKey,
  relocateUnitOneStep,
  resurrectUnitAtCorpse,
  standardStartingPosition
} from '../src/index.js';

function unit({ unitId, side, draftSlot, archetypeId = 'Test', hp = 100, position, statuses = [] }) {
  return createUnitState({
    unitId,
    side,
    draftSlot,
    archetypeId,
    stats: { maxHP: 100, hp, ATK: 10, DEF: 10, SDM: 10, CRIT: 0.05, QKN: 10 },
    position,
    combat: { movementMax: 10, attacksMax: 5, attackInterval: 1 },
    weapon: { weaponProfileId: 'test', mode: 'MELEE', weaponRange: 2, preferredRange: 2, counterMoveMax: 1 },
    statuses
  });
}

function sixUnitState() {
  const board = { width: 14, height: 10 };
  const units = [];
  for (const side of [SIDE.A, SIDE.B]) {
    for (let draftSlot = 0; draftSlot < 3; draftSlot += 1) {
      const prefix = side === SIDE.A ? 'H' : 'G';
      units.push(unit({
        unitId: `${prefix}${draftSlot}`,
        side,
        draftSlot,
        archetypeId: `${side}-${draftSlot}`,
        position: standardStartingPosition({ side, draftSlot, board })
      }));
    }
  }
  return createBattleState({ matchId: 'grid-test', board, units });
}

test('standard 16x11 starting formation is staggered C/B/C vs N/O/N', () => {
  assert.deepEqual(standardStartingPosition({ side: SIDE.A, draftSlot: 0 }), { row: 3, col: 2 });
  assert.deepEqual(standardStartingPosition({ side: SIDE.A, draftSlot: 1 }), { row: 5, col: 1 });
  assert.deepEqual(standardStartingPosition({ side: SIDE.A, draftSlot: 2 }), { row: 7, col: 2 });
  assert.deepEqual(standardStartingPosition({ side: SIDE.B, draftSlot: 0 }), { row: 3, col: 13 });
  assert.deepEqual(standardStartingPosition({ side: SIDE.B, draftSlot: 1 }), { row: 5, col: 14 });
  assert.deepEqual(standardStartingPosition({ side: SIDE.B, draftSlot: 2 }), { row: 7, col: 13 });
});

test('cell keys round-trip deterministically', () => {
  assert.equal(cellKey(7, 13), '7,13');
  assert.deepEqual(parseCellKey('7,13'), { row: 7, col: 13 });
});

test('battle creation builds authoritative occupancy for all six champions', () => {
  const state = sixUnitState();
  assert.equal(Object.keys(state.board.occupancy).length, 6);
  assert.equal(getOccupantId(state, 3, 0), 'H0');
  assert.equal(getOccupantId(state, 5, 0), 'H1');
  assert.equal(getOccupantId(state, 7, 0), 'H2');
  assert.equal(getOccupantId(state, 3, 13), 'G0');
  assert.equal(getOccupantId(state, 5, 13), 'G1');
  assert.equal(getOccupantId(state, 7, 13), 'G2');
  assert.equal(assertBattlefieldInvariants(state), true);
});

test('battle creation rejects overlapping champions', () => {
  const a = unit({ unitId: 'H0', side: SIDE.A, draftSlot: 0, position: { row: 3, col: 0 } });
  const b = unit({ unitId: 'G0', side: SIDE.B, draftSlot: 0, position: { row: 3, col: 0 } });
  assert.throws(() => createBattleState({ matchId: 'overlap', units: [a, b] }), /cannot occupy the same square/);
});

test('battle creation rejects out-of-bounds champion positions', () => {
  const a = unit({ unitId: 'H0', side: SIDE.A, draftSlot: 0, position: { row: 11, col: 0 } });
  assert.throws(() => createBattleState({ matchId: 'oob', units: [a] }), /outside the battlefield/);
});

test('battle creation requires every active-battle champion to occupy a square', () => {
  const a = unit({ unitId: 'H0', side: SIDE.A, draftSlot: 0, position: null });
  assert.throws(() => createBattleState({ matchId: 'no-position', units: [a] }), /must occupy a battlefield square/);
});

test('single-step relocation immediately vacates source and occupies destination', () => {
  const state = sixUnitState();
  const originalHash = hashCanonical(state);
  const move = relocateUnitOneStep(state, 'H0', { row: 3, col: 1 });

  assert.deepEqual(move.from, { row: 3, col: 0 });
  assert.deepEqual(move.to, { row: 3, col: 1 });
  assert.equal(getOccupantId(state, 3, 0), null);
  assert.equal(getOccupantId(state, 3, 1), 'H0');
  assert.deepEqual(state.units.H0.position, { row: 3, col: 1 });
  assert.notEqual(hashCanonical(state), originalHash);
  assert.equal(assertBattlefieldInvariants(state), true);
});

test('normal relocation cannot enter a square occupied by ally or enemy', () => {
  const allyA = unit({ unitId: 'H0', side: SIDE.A, draftSlot: 0, position: { row: 3, col: 0 } });
  const allyB = unit({ unitId: 'H1', side: SIDE.A, draftSlot: 1, position: { row: 3, col: 1 } });
  let state = createBattleState({ matchId: 'ally-block', units: [allyA, allyB] });
  assert.throws(() => relocateUnitOneStep(state, 'H0', { row: 3, col: 1 }), /destination is occupied/);

  const enemy = unit({ unitId: 'G0', side: SIDE.B, draftSlot: 0, position: { row: 3, col: 1 } });
  state = createBattleState({ matchId: 'enemy-block', units: [allyA, enemy] });
  assert.throws(() => relocateUnitOneStep(state, 'H0', { row: 3, col: 1 }), /destination is occupied/);
});

test('normal relocation is orthogonal one-square only', () => {
  const state = sixUnitState();
  assert.throws(() => relocateUnitOneStep(state, 'H0', { row: 4, col: 1 }), /exactly one orthogonal square/);
  assert.throws(() => relocateUnitOneStep(state, 'H0', { row: 3, col: 2 }), /exactly one orthogonal square/);
});

test('dead champion becomes a corpse and continues occupying the same square', () => {
  const state = sixUnitState();
  const before = { ...state.units.H0.position };
  markUnitDead(state, 'H0');

  assert.equal(state.units.H0.lifeState, LIFE_STATE.DEAD);
  assert.equal(state.units.H0.stats.hp, 0);
  assert.deepEqual(state.units.H0.position, before);
  assert.equal(getOccupantId(state, before.row, before.col), 'H0');
  assert.equal(isCellOpen(state, before.row, before.col), false);
  assert.throws(() => relocateUnitOneStep(state, 'H0', { row: 3, col: 1 }), /Corpses cannot perform|Dead champions\/corpses cannot perform/);
});

test('corpse blocks movement and resurrection restores life on the occupied corpse square', () => {
  const corpse = unit({ unitId: 'G0', side: SIDE.B, draftSlot: 0, hp: 0, position: { row: 3, col: 1 } });
  const living = unit({ unitId: 'H0', side: SIDE.A, draftSlot: 0, position: { row: 3, col: 0 } });
  const state = createBattleState({ matchId: 'corpse-block', units: [living, corpse] });

  assert.equal(state.units.G0.lifeState, LIFE_STATE.DEAD);
  assert.equal(isOccupied(state, 3, 1), true);
  assert.throws(() => relocateUnitOneStep(state, 'H0', { row: 3, col: 1 }), /destination is occupied/);

  resurrectUnitAtCorpse(state, 'G0', 40);
  assert.equal(state.units.G0.lifeState, LIFE_STATE.ALIVE);
  assert.equal(state.units.G0.stats.hp, 40);
  assert.equal(getOccupantId(state, 3, 1), 'G0');
});

test('invisibility status never removes physical occupancy', () => {
  const invisible = unit({
    unitId: 'G0', side: SIDE.B, draftSlot: 0, position: { row: 3, col: 1 },
    statuses: [{ key: 'invisible', duration: 3 }]
  });
  const living = unit({ unitId: 'H0', side: SIDE.A, draftSlot: 0, position: { row: 3, col: 0 } });
  const state = createBattleState({ matchId: 'invisible-block', units: [living, invisible] });

  assert.equal(getOccupantId(state, 3, 1), 'G0');
  assert.equal(isOccupied(state, 3, 1), true);
  assert.throws(() => relocateUnitOneStep(state, 'H0', { row: 3, col: 1 }), /destination is occupied/);
});

test('battlefield invariant validator catches position/occupancy desync', () => {
  const state = sixUnitState();
  state.units.H0.position = { row: 3, col: 1 };
  assert.throws(() => assertBattlefieldInvariants(state), /Occupancy keys do not match|Occupancy occupant does not match/);
});
