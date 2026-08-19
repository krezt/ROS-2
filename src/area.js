import { LIFE_STATE } from './constants.js';
import { invariant } from './errors.js';
import { cellKey, isInBounds, manhattanDistance } from './grid.js';

export const AREA_SHAPE = Object.freeze({
  SINGLE: 'SINGLE',
  SQUARE_3X3: 'SQUARE_3X3',
  SQUARE_4X4: 'SQUARE_4X4',
  SQUARE_5X5: 'SQUARE_5X5',
  SQUARE_6X6: 'SQUARE_6X6',
  CROSS: 'CROSS',
  LINE: 'LINE',
  MANHATTAN_RADIUS: 'MANHATTAN_RADIUS',
  ALL_ENEMIES: 'ALL_ENEMIES',
  ALL_ALLIES: 'ALL_ALLIES'
});

function pushIfInBounds(board, cells, row, col) {
  if (isInBounds(board, row, col)) cells.push({ row, col });
}

export function cellsForArea(board, spec) {
  invariant(board && spec && Object.values(AREA_SHAPE).includes(spec.shape), 'Invalid area specification.', { spec });
  const cells = [];
  const center = spec.center ?? null;
  switch (spec.shape) {
    case AREA_SHAPE.SINGLE:
      invariant(center, 'SINGLE area requires center.');
      pushIfInBounds(board, cells, center.row, center.col);
      break;
    case AREA_SHAPE.SQUARE_3X3:
      invariant(center, 'SQUARE_3X3 area requires center.');
      for (let dr = -1; dr <= 1; dr += 1) for (let dc = -1; dc <= 1; dc += 1) pushIfInBounds(board, cells, center.row + dr, center.col + dc);
      break;
    case AREA_SHAPE.SQUARE_4X4:
      invariant(center, 'SQUARE_4X4 area requires center.');
      for (let dr = -1; dr <= 2; dr += 1) for (let dc = -1; dc <= 2; dc += 1) pushIfInBounds(board, cells, center.row + dr, center.col + dc);
      break;
    case AREA_SHAPE.SQUARE_5X5:
      invariant(center, 'SQUARE_5X5 area requires center.');
      for (let dr = -2; dr <= 2; dr += 1) for (let dc = -2; dc <= 2; dc += 1) pushIfInBounds(board, cells, center.row + dr, center.col + dc);
      break;
    case AREA_SHAPE.SQUARE_6X6:
      invariant(center, 'SQUARE_6X6 area requires center.');
      for (let dr = -2; dr <= 3; dr += 1) for (let dc = -2; dc <= 3; dc += 1) pushIfInBounds(board, cells, center.row + dr, center.col + dc);
      break;
    case AREA_SHAPE.CROSS:
      invariant(center, 'CROSS area requires center.');
      for (const [dr, dc] of [[0,0],[-1,0],[1,0],[0,-1],[0,1]]) pushIfInBounds(board, cells, center.row + dr, center.col + dc);
      break;
    case AREA_SHAPE.MANHATTAN_RADIUS: {
      invariant(center, 'MANHATTAN_RADIUS area requires center.');
      const radius = spec.radius ?? 0;
      invariant(Number.isInteger(radius) && radius >= 0, 'MANHATTAN_RADIUS requires integer radius >= 0.');
      for (let row = center.row - radius; row <= center.row + radius; row += 1) {
        for (let col = center.col - radius; col <= center.col + radius; col += 1) {
          if (isInBounds(board, row, col) && manhattanDistance(center, { row, col }) <= radius) cells.push({ row, col });
        }
      }
      break;
    }
    case AREA_SHAPE.LINE: {
      const origin = spec.origin;
      const direction = spec.direction;
      const length = spec.length;
      invariant(origin && direction && Number.isInteger(length) && length >= 1, 'LINE requires origin, direction and length >= 1.');
      invariant(Math.abs(direction.dr) + Math.abs(direction.dc) === 1, 'LINE direction must be one orthogonal unit vector.');
      for (let i = spec.includeOrigin ? 0 : 1; i <= length; i += 1) pushIfInBounds(board, cells, origin.row + direction.dr * i, origin.col + direction.dc * i);
      break;
    }
    case AREA_SHAPE.ALL_ENEMIES:
    case AREA_SHAPE.ALL_ALLIES:
      break;
    default:
      invariant(false, 'Unsupported area shape.', { shape: spec.shape });
  }
  const seen = new Set();
  return cells.filter((cell) => {
    const key = cellKey(cell.row, cell.col);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).sort((a, b) => a.row - b.row || a.col - b.col);
}

export function unitsInArea(state, actorId, spec, { includeDead = false } = {}) {
  const actor = state.units[actorId];
  invariant(actor, `Unknown actorId: ${actorId}`);
  if (spec.shape === AREA_SHAPE.ALL_ENEMIES || spec.shape === AREA_SHAPE.ALL_ALLIES) {
    return Object.values(state.units)
      .filter((unit) => includeDead || unit.lifeState === LIFE_STATE.ALIVE)
      .filter((unit) => spec.shape === AREA_SHAPE.ALL_ENEMIES ? unit.side !== actor.side : unit.side === actor.side)
      .sort((a, b) => a.unitId.localeCompare(b.unitId));
  }
  const keys = new Set(cellsForArea(state.board, spec).map((c) => cellKey(c.row, c.col)));
  return Object.values(state.units)
    .filter((unit) => unit.position && keys.has(cellKey(unit.position.row, unit.position.col)))
    .filter((unit) => includeDead || unit.lifeState === LIFE_STATE.ALIVE)
    .sort((a, b) => a.unitId.localeCompare(b.unitId));
}
