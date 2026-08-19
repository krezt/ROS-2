import { LIFE_STATE, SIDE } from './constants.js';
import { invariant } from './errors.js';
import { assertNonNegativeInteger, assertPositiveInteger } from './util.js';

export const DEFAULT_BOARD = Object.freeze({ width: 16, height: 11 });
export const STANDARD_DRAFT_SLOTS = 3;
export const SUPPORTED_TEAM_SIZES = Object.freeze([1,2,3,4,5]);

export function cellKey(row, col) {
  assertNonNegativeInteger(row, 'row');
  assertNonNegativeInteger(col, 'col');
  return `${row},${col}`;
}

export function parseCellKey(key) {
  invariant(typeof key === 'string', 'cell key must be a string.', { key });
  const match = /^(\d+),(\d+)$/.exec(key);
  invariant(match, 'Invalid cell key.', { key });
  return { row: Number(match[1]), col: Number(match[2]) };
}

export function isInBounds(board, row, col) {
  return Number.isInteger(row)
    && Number.isInteger(col)
    && row >= 0
    && col >= 0
    && row < board.height
    && col < board.width;
}

export function assertInBounds(board, row, col, label = 'position') {
  invariant(isInBounds(board, row, col), `${label} is outside the battlefield.`, {
    row, col, width: board.width, height: board.height
  });
}

export function getOccupantId(state, row, col) {
  assertInBounds(state.board, row, col);
  return state.board.occupancy[cellKey(row, col)] ?? null;
}

export function getOccupant(state, row, col) {
  const unitId = getOccupantId(state, row, col);
  return unitId ? state.units[unitId] ?? null : null;
}

export function isOccupied(state, row, col) {
  return getOccupantId(state, row, col) !== null;
}

export function isCellOpen(state, row, col, { ignoreUnitId = null } = {}) {
  assertInBounds(state.board, row, col);
  const occupantId = state.board.occupancy[cellKey(row, col)] ?? null;
  return occupantId === null || occupantId === ignoreUnitId;
}

export function manhattanDistance(a, b) {
  invariant(a && b, 'manhattanDistance requires two positions.');
  return Math.abs(a.row - b.row) + Math.abs(a.col - b.col);
}

export function isOrthogonallyAdjacent(a, b) {
  return manhattanDistance(a, b) === 1;
}

/**
 * Standard ROS 2.0 opening formation.
 * Stage 23.10 default battlefield is 16x11. Internal coordinates are zero-based:
 * rows 3/5/7 with a staggered formation: Side A C4/B6/C8 and Side B N4/O6/N8.
 * Non-default boards retain the historical edge starts so older deterministic
 * fixtures can continue to use their explicitly supplied geometry.
 */
export function standardStartingPosition({ side, draftSlot, teamSize = STANDARD_DRAFT_SLOTS, board = DEFAULT_BOARD }) {
  invariant(side === SIDE.A || side === SIDE.B, 'side must be A or B.', { side });
  assertNonNegativeInteger(draftSlot, 'draftSlot');
  invariant(SUPPORTED_TEAM_SIZES.includes(teamSize), 'teamSize must be between 1 and 5.', { teamSize });
  invariant(draftSlot < teamSize, 'draftSlot must be smaller than teamSize.', { draftSlot, teamSize });
  assertPositiveInteger(board.width, 'board.width');
  assertPositiveInteger(board.height, 'board.height');

  const isDefaultBoard = board.width === DEFAULT_BOARD.width && board.height === DEFAULT_BOARD.height;
  if (isDefaultBoard) {
    // Player-facing coordinates are 1-based rows / lettered columns. Internal coordinates are zero-based.
    // 1v1: West C6 vs East N6.
    // 2v2: West C5/B7 vs East N7/O5.
    // 3v3: legacy C4/B6/C8 vs N4/O6/N8.
    // 4v4 adds West D2 and East M10.
    // 5v5 adds West D2/D10 and East M2/M10. Slot order preserves the 4v4 extra as slot 3.
    const formations = {
      1: {
        A: [{ row:5, col:2 }],
        B: [{ row:5, col:13 }]
      },
      2: {
        A: [{ row:4, col:2 }, { row:6, col:1 }],
        B: [{ row:6, col:13 }, { row:4, col:14 }]
      },
      3: {
        A: [{ row:3, col:2 }, { row:5, col:1 }, { row:7, col:2 }],
        B: [{ row:3, col:13 }, { row:5, col:14 }, { row:7, col:13 }]
      },
      4: {
        A: [{ row:3, col:2 }, { row:5, col:1 }, { row:7, col:2 }, { row:1, col:3 }],
        B: [{ row:3, col:13 }, { row:5, col:14 }, { row:7, col:13 }, { row:9, col:12 }]
      },
      5: {
        A: [{ row:3, col:2 }, { row:5, col:1 }, { row:7, col:2 }, { row:1, col:3 }, { row:9, col:3 }],
        B: [{ row:3, col:13 }, { row:5, col:14 }, { row:7, col:13 }, { row:9, col:12 }, { row:1, col:12 }]
      }
    };
    return { ...formations[teamSize][side][draftSlot] };
  }

  // Historical non-default-board behavior remains available for deterministic fixtures.
  const centerRow = Math.floor(board.height / 2);
  const offsetsBySize = {
    1:[0],
    2:[-1,1],
    3:[-2,0,2],
    4:[-3,-1,1,3],
    5:[-4,-2,0,2,4]
  };
  const row = centerRow + offsetsBySize[teamSize][draftSlot];
  invariant(row >= 0 && row < board.height,
    'Board is too short for the requested team formation.', { board, teamSize, draftSlot });
  return { row, col: side === SIDE.A ? 0 : board.width - 1 };
}

export function buildOccupancy({ board, units }) {
  const occupancy = {};
  const entries = Array.isArray(units) ? units : Object.values(units ?? {});

  for (const unit of entries) {
    invariant(unit?.unitId, 'Every battlefield unit must have a unitId.');
    invariant(unit.position !== null,
      'Every champion in an active BattleState must occupy a battlefield square.', { unitId: unit.unitId });
    assertInBounds(board, unit.position.row, unit.position.col, `Unit ${unit.unitId} position`);

    const key = cellKey(unit.position.row, unit.position.col);
    invariant(!occupancy[key], 'Two champions cannot occupy the same square.', {
      row: unit.position.row,
      col: unit.position.col,
      existingUnitId: occupancy[key] ?? null,
      incomingUnitId: unit.unitId
    });
    occupancy[key] = unit.unitId;
  }

  return occupancy;
}

export function assertBattlefieldInvariants(state) {
  invariant(state?.board && state?.units, 'BattleState requires board and units.');
  assertPositiveInteger(state.board.width, 'board.width');
  assertPositiveInteger(state.board.height, 'board.height');
  invariant(state.board.occupancy && typeof state.board.occupancy === 'object',
    'board.occupancy must be an object.');

  const expected = buildOccupancy({ board: state.board, units: state.units });
  const actualKeys = Object.keys(state.board.occupancy).sort();
  const expectedKeys = Object.keys(expected).sort();
  invariant(JSON.stringify(actualKeys) === JSON.stringify(expectedKeys),
    'Occupancy keys do not match unit positions.', { actualKeys, expectedKeys });

  for (const key of expectedKeys) {
    invariant(state.board.occupancy[key] === expected[key],
      'Occupancy occupant does not match unit position.', {
        key,
        actual: state.board.occupancy[key],
        expected: expected[key]
      });
  }

  for (const unit of Object.values(state.units)) {
    invariant(unit.lifeState === LIFE_STATE.ALIVE || unit.lifeState === LIFE_STATE.DEAD,
      'Invalid unit lifeState.', { unitId: unit.unitId, lifeState: unit.lifeState });
    if (unit.lifeState === LIFE_STATE.ALIVE) {
      invariant(unit.stats.hp > 0, 'ALIVE unit must have hp > 0.', { unitId: unit.unitId, hp: unit.stats.hp });
    } else {
      invariant(unit.stats.hp === 0, 'DEAD unit must have hp = 0.', { unitId: unit.unitId, hp: unit.stats.hp });
    }
  }

  return true;
}

function requireUnit(state, unitId) {
  const unit = state.units[unitId];
  invariant(unit, `Unknown unitId: ${unitId}`);
  return unit;
}

/**
 * Stage-2 primitive for a normal single-square movement step.
 * This is NOT pathfinding and does NOT decide whether a unit should move.
 */
export function relocateUnitOneStep(state, unitId, to) {
  const unit = requireUnit(state, unitId);
  invariant(unit.lifeState === LIFE_STATE.ALIVE,
    'Dead champions/corpses cannot perform a normal movement step.', { unitId });
  invariant(unit.position, 'Unit has no battlefield position.', { unitId });
  assertInBounds(state.board, to.row, to.col, 'Movement destination');
  invariant(isOrthogonallyAdjacent(unit.position, to),
    'Normal movement step must be exactly one orthogonal square.', {
      unitId, from: unit.position, to
    });
  invariant(isCellOpen(state, to.row, to.col, { ignoreUnitId: unitId }),
    'Movement destination is occupied.', {
      unitId, to, occupantId: getOccupantId(state, to.row, to.col)
    });

  const from = { ...unit.position };
  const fromKey = cellKey(from.row, from.col);
  const toKey = cellKey(to.row, to.col);

  invariant(state.board.occupancy[fromKey] === unitId,
    'Unit position and occupancy map disagree before movement.', {
      unitId, from, occupantId: state.board.occupancy[fromKey] ?? null
    });

  // Authoritative occupancy changes happen synchronously with simulation state.
  delete state.board.occupancy[fromKey];
  unit.position = { row: to.row, col: to.col };
  state.board.occupancy[toKey] = unitId;

  assertBattlefieldInvariants(state);
  return { unitId, from, to: { ...unit.position } };
}

/** Corpses intentionally remain in occupancy. */
export function markUnitDead(state, unitId) {
  const unit = requireUnit(state, unitId);
  unit.stats.hp = 0;
  unit.lifeState = LIFE_STATE.DEAD;
  assertBattlefieldInvariants(state);
  return unit;
}

/** Stage-2 resurrection state primitive; ability rules arrive later. */
export function resurrectUnitAtCorpse(state, unitId, hp) {
  const unit = requireUnit(state, unitId);
  invariant(unit.lifeState === LIFE_STATE.DEAD, 'Only a dead champion can be resurrected.', { unitId });
  invariant(Number.isFinite(hp) && hp > 0 && hp <= unit.stats.maxHP,
    'Resurrection hp must be within (0, maxHP].', { unitId, hp, maxHP: unit.stats.maxHP });
  invariant(unit.position, 'Corpse must still occupy a battlefield square.', { unitId });
  invariant(getOccupantId(state, unit.position.row, unit.position.col) === unitId,
    'Corpse square is not occupied by the champion being resurrected.', { unitId, position: unit.position });

  unit.stats.hp = hp;
  unit.lifeState = LIFE_STATE.ALIVE;
  assertBattlefieldInvariants(state);
  return unit;
}
