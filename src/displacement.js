import { EVENT_TYPE, LIFE_STATE } from './constants.js';
import { invariant } from './errors.js';
import { isCellOpen, isInBounds, manhattanDistance, relocateUnitOneStep } from './grid.js';

export const DISPLACEMENT_KIND = Object.freeze({ PUSH: 'PUSH', PULL: 'PULL' });

function emit(simulation, type, options) {
  const event = simulation.events.emit(type, options);
  simulation.state.round.eventSequence = simulation.events.length;
  return event;
}

function candidateDirections(target, anchor, kind) {
  const dr = Math.sign(target.row - anchor.row);
  const dc = Math.sign(target.col - anchor.col);
  const directions = [];
  if (dr !== 0) directions.push({ dr: kind === DISPLACEMENT_KIND.PUSH ? dr : -dr, dc: 0 });
  if (dc !== 0) directions.push({ dr: 0, dc: kind === DISPLACEMENT_KIND.PUSH ? dc : -dc });
  return directions;
}

function chooseDirection(simulation, target, anchor, kind, reason) {
  const dirs = candidateDirections(target, anchor, kind);
  if (dirs.length <= 1) return dirs[0] ?? null;
  // Both orthogonal directions are equally correct for Manhattan push/pull; choose with gameplay RNG.
  const idx = simulation.rng.nextInt(0, dirs.length - 1, reason);
  return dirs[idx];
}

export function displaceUnit(simulation, targetId, {
  kind,
  sourceId = null,
  anchor,
  distance = 1,
  cycle = simulation.state.round.initiativeCycle,
  parentEventId = null
}) {
  invariant(Object.values(DISPLACEMENT_KIND).includes(kind), 'Invalid displacement kind.', { kind });
  invariant(Number.isInteger(distance) && distance >= 0, 'Displacement distance must be an integer >= 0.');
  const unit = simulation.state.units[targetId];
  invariant(unit, `Unknown targetId: ${targetId}`);
  invariant(unit.lifeState === LIFE_STATE.ALIVE, 'Corpses cannot be displaced by Stage-13 push/pull.', { targetId });
  invariant(anchor && Number.isInteger(anchor.row) && Number.isInteger(anchor.col), 'Displacement requires anchor position.');

  const from = { ...unit.position };
  let moved = 0;
  let stopReason = distance === 0 ? 'ZERO_DISTANCE' : null;
  for (let step = 0; step < distance; step += 1) {
    const dir = chooseDirection(simulation, unit.position, anchor, kind, `${kind}_AXIS:${sourceId ?? 'ENV'}->${targetId}:step${step}`);
    if (!dir) { stopReason = 'SAME_CELL_AS_ANCHOR'; break; }
    const to = { row: unit.position.row + dir.dr, col: unit.position.col + dir.dc };
    if (!isInBounds(simulation.state.board, to.row, to.col)) { stopReason = 'EDGE'; break; }
    if (!isCellOpen(simulation.state, to.row, to.col, { ignoreUnitId: targetId })) { stopReason = 'BLOCKED'; break; }
    relocateUnitOneStep(simulation.state, targetId, to);
    moved += 1;
  }

  const eventType = kind === DISPLACEMENT_KIND.PUSH ? EVENT_TYPE.PUSH : EVENT_TYPE.PULL;
  const event = emit(simulation, eventType, {
    initiativeCycle: cycle,
    actorId: sourceId,
    targetId,
    parentEventId,
    payload: {
      requestedDistance: distance,
      movedDistance: moved,
      from,
      to: { ...unit.position },
      anchor: { ...anchor },
      stopped: moved < distance,
      stopReason
    }
  });
  simulation.trace.record(kind, { cycle, sourceId, targetId, requestedDistance: distance, movedDistance: moved, from, to: { ...unit.position }, stopReason, eventId: event.eventId });
  return { event, movedDistance: moved, from, to: { ...unit.position }, stopReason };
}

export function pushUnit(simulation, targetId, options) {
  return displaceUnit(simulation, targetId, { ...options, kind: DISPLACEMENT_KIND.PUSH });
}
export function pullUnit(simulation, targetId, options) {
  return displaceUnit(simulation, targetId, { ...options, kind: DISPLACEMENT_KIND.PULL });
}
