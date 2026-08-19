import { LIFE_STATE } from './constants.js';
import { invariant } from './errors.js';
import {
  assertBattlefieldInvariants,
  cellKey,
  isCellOpen,
  isInBounds,
  manhattanDistance,
  relocateUnitOneStep
} from './grid.js';
import { isRooted } from './counterplay.js';

export const PURSUIT_RESULT = Object.freeze({
  MOVE: 'MOVE',
  ALREADY_IN_RANGE: 'ALREADY_IN_RANGE',
  NO_MOVEMENT: 'NO_MOVEMENT',
  NO_ATTACKS: 'NO_ATTACKS',
  NO_PATH: 'NO_PATH',
  TARGET_DEAD: 'TARGET_DEAD'
});

const ORTHOGONAL_DELTAS = Object.freeze([
  Object.freeze({ dr: -1, dc: 0 }),
  Object.freeze({ dr: 0, dc: -1 }),
  Object.freeze({ dr: 0, dc: 1 }),
  Object.freeze({ dr: 1, dc: 0 })
]);

function requireUnit(state, unitId, label = 'unit') {
  const unit = state.units[unitId];
  invariant(unit, `Unknown ${label} unitId: ${unitId}`);
  return unit;
}

function comparePositions(a, b) {
  if (a.row !== b.row) return a.row - b.row;
  return a.col - b.col;
}

export function orthogonalNeighbors(board, position) {
  invariant(position && Number.isInteger(position.row) && Number.isInteger(position.col),
    'orthogonalNeighbors requires an integer position.', { position });

  return ORTHOGONAL_DELTAS
    .map(({ dr, dc }) => ({ row: position.row + dr, col: position.col + dc }))
    .filter((pos) => isInBounds(board, pos.row, pos.col))
    .sort(comparePositions);
}

/**
 * Returns every currently legal square from which actor could attack target.
 * Stage 3 deliberately treats any square within weapon range as a goal.
 * Preferred-range optimization/range-maintenance is Stage 6.
 */
export function getEngagementCells(state, actorId, targetId, { range = null } = {}) {
  assertBattlefieldInvariants(state);
  const actor = requireUnit(state, actorId, 'actor');
  const target = requireUnit(state, targetId, 'target');
  invariant(actor.position && target.position, 'Actor and target must be on the battlefield.');

  const effectiveRange = range ?? actor.weapon.weaponRange;
  invariant(Number.isInteger(effectiveRange) && effectiveRange >= 0,
    'Engagement range must be a non-negative integer.', { effectiveRange });

  const cells = [];
  for (let row = 0; row < state.board.height; row += 1) {
    for (let col = 0; col < state.board.width; col += 1) {
      const pos = { row, col };
      if (manhattanDistance(pos, target.position) > effectiveRange) continue;
      if (!isCellOpen(state, row, col, { ignoreUnitId: actorId })) continue;
      cells.push(pos);
    }
  }

  return cells.sort(comparePositions);
}

function buildDistanceToGoals(state, actorId, goals) {
  const distance = new Map();
  const queue = [];

  for (const goal of goals.slice().sort(comparePositions)) {
    const key = cellKey(goal.row, goal.col);
    if (distance.has(key)) continue;
    distance.set(key, 0);
    queue.push(goal);
  }

  let head = 0;
  while (head < queue.length) {
    const current = queue[head++];
    const currentDistance = distance.get(cellKey(current.row, current.col));

    for (const next of orthogonalNeighbors(state.board, current)) {
      const key = cellKey(next.row, next.col);
      if (distance.has(key)) continue;
      if (!isCellOpen(state, next.row, next.col, { ignoreUnitId: actorId })) continue;
      distance.set(key, currentDistance + 1);
      queue.push(next);
    }
  }

  return distance;
}

/**
 * Pure pathfinding decision for the actor's CURRENT next pursuit square.
 * It never mutates state.
 *
 * Crucially, it does not generate/speculate a full randomized path. If multiple
 * equally optimal immediate squares exist, exactly one synchronized RNG choice
 * is made for the current step. The engine will re-run this after movement.
 */
export function planPursuitStep(state, actorId, targetId, { rng = null, range = null } = {}) {
  assertBattlefieldInvariants(state);
  const actor = requireUnit(state, actorId, 'actor');
  const target = requireUnit(state, targetId, 'target');

  invariant(actor.lifeState === LIFE_STATE.ALIVE, 'Dead actor cannot pursue.', { actorId });
  invariant(actor.position && target.position, 'Actor and target must have battlefield positions.');

  const effectiveRange = range ?? actor.weapon.weaponRange;
  invariant(Number.isInteger(effectiveRange) && effectiveRange >= 0,
    'Pursuit range must be a non-negative integer.', { effectiveRange });

  const distanceBefore = manhattanDistance(actor.position, target.position);

  if (target.lifeState !== LIFE_STATE.ALIVE) {
    return Object.freeze({
      result: PURSUIT_RESULT.TARGET_DEAD,
      actorId,
      targetId,
      from: { ...actor.position },
      to: null,
      targetDistanceBefore: distanceBefore,
      targetDistanceAfter: distanceBefore,
      shortestStepsToEngagement: null,
      candidateSteps: [],
      tieBroken: false
    });
  }

  if (actor.resources.attacksRemaining <= 0) {
    return Object.freeze({
      result: PURSUIT_RESULT.NO_ATTACKS,
      actorId,
      targetId,
      from: { ...actor.position },
      to: null,
      targetDistanceBefore: distanceBefore,
      targetDistanceAfter: distanceBefore,
      shortestStepsToEngagement: null,
      candidateSteps: [],
      tieBroken: false
    });
  }

  if (distanceBefore <= effectiveRange) {
    return Object.freeze({
      result: PURSUIT_RESULT.ALREADY_IN_RANGE,
      actorId,
      targetId,
      from: { ...actor.position },
      to: null,
      targetDistanceBefore: distanceBefore,
      targetDistanceAfter: distanceBefore,
      shortestStepsToEngagement: 0,
      candidateSteps: [],
      tieBroken: false
    });
  }

  if (isRooted(actor) || actor.resources.movementRemaining <= 0) {
    return Object.freeze({
      result: PURSUIT_RESULT.NO_MOVEMENT,
      actorId,
      targetId,
      from: { ...actor.position },
      to: null,
      targetDistanceBefore: distanceBefore,
      targetDistanceAfter: distanceBefore,
      shortestStepsToEngagement: null,
      candidateSteps: [],
      tieBroken: false
    });
  }

  const goals = getEngagementCells(state, actorId, targetId, { range: effectiveRange });
  if (goals.length === 0) {
    return Object.freeze({
      result: PURSUIT_RESULT.NO_PATH,
      actorId,
      targetId,
      from: { ...actor.position },
      to: null,
      targetDistanceBefore: distanceBefore,
      targetDistanceAfter: distanceBefore,
      shortestStepsToEngagement: null,
      candidateSteps: [],
      tieBroken: false
    });
  }

  const distances = buildDistanceToGoals(state, actorId, goals);
  const actorKey = cellKey(actor.position.row, actor.position.col);
  const shortestSteps = distances.get(actorKey);

  if (!Number.isInteger(shortestSteps) || shortestSteps <= 0) {
    return Object.freeze({
      result: PURSUIT_RESULT.NO_PATH,
      actorId,
      targetId,
      from: { ...actor.position },
      to: null,
      targetDistanceBefore: distanceBefore,
      targetDistanceAfter: distanceBefore,
      shortestStepsToEngagement: null,
      candidateSteps: [],
      tieBroken: false
    });
  }

  const candidates = orthogonalNeighbors(state.board, actor.position)
    .filter((next) => isCellOpen(state, next.row, next.col, { ignoreUnitId: actorId }))
    .filter((next) => distances.get(cellKey(next.row, next.col)) === shortestSteps - 1)
    .sort(comparePositions);

  invariant(candidates.length > 0,
    'BFS found a pursuit distance but no legal next step.', { actorId, targetId, shortestSteps });

  let chosen = candidates[0];
  const tieBroken = candidates.length > 1;
  if (tieBroken) {
    invariant(rng && typeof rng.choose === 'function',
      'Equal optimal pursuit steps require synchronized gameplay RNG.', {
        actorId,
        targetId,
        candidates
      });
    chosen = rng.choose(candidates, `PATH_TIE:${actorId}->${targetId}:step`);
  }

  return Object.freeze({
    result: PURSUIT_RESULT.MOVE,
    actorId,
    targetId,
    from: { ...actor.position },
    to: { ...chosen },
    targetDistanceBefore: distanceBefore,
    targetDistanceAfter: manhattanDistance(chosen, target.position),
    shortestStepsToEngagement: shortestSteps,
    candidateSteps: candidates.map((pos) => ({ ...pos })),
    tieBroken
  });
}

/**
 * Generic authoritative one-step movement that spends exactly one Movement.
 * Stage 4 will decide WHEN this primitive is called.
 */
export function moveUnitOneStepWithResource(state, unitId, to) {
  const unit = requireUnit(state, unitId, 'actor');
  invariant(unit.lifeState === LIFE_STATE.ALIVE, 'Dead champion cannot spend Movement.', { unitId });
  invariant(!isRooted(unit), 'Rooted champion cannot spend voluntary Movement.', { unitId });
  invariant(unit.resources.movementRemaining > 0,
    'Champion has no Movement remaining.', { unitId, movementRemaining: unit.resources.movementRemaining });

  const before = unit.resources.movementRemaining;
  const relocation = relocateUnitOneStep(state, unitId, to);
  unit.resources.movementRemaining -= 1;
  const after = unit.resources.movementRemaining;

  assertBattlefieldInvariants(state);
  return Object.freeze({ ...relocation, movementBefore: before, movementAfter: after });
}

/**
 * Stage-3 pursuit advancement: plan CURRENT best step, then execute exactly one
 * square and spend one Movement. No scheduler and no attack resolution yet.
 */
export function advancePursuitOneStep(state, actorId, targetId, { rng = null, range = null } = {}) {
  const plan = planPursuitStep(state, actorId, targetId, { rng, range });
  if (plan.result !== PURSUIT_RESULT.MOVE) {
    return Object.freeze({ ...plan, moved: false, movementBefore: null, movementAfter: null });
  }

  const movement = moveUnitOneStepWithResource(state, actorId, plan.to);
  const target = requireUnit(state, targetId, 'target');
  const actor = requireUnit(state, actorId, 'actor');
  const effectiveRange = range ?? actor.weapon.weaponRange;

  return Object.freeze({
    ...plan,
    moved: true,
    movementBefore: movement.movementBefore,
    movementAfter: movement.movementAfter,
    targetDistanceAfter: manhattanDistance(actor.position, target.position),
    nowInRange: manhattanDistance(actor.position, target.position) <= effectiveRange
  });
}

/**
 * Stage-6 preferred-range maintenance outcomes.
 *
 * Range maintenance is deliberately a CURRENT one-step decision, just like
 * pursuit. It never speculates a randomized multi-square retreat path.
 */
export const RANGE_MAINTENANCE_RESULT = Object.freeze({
  MOVE: 'MOVE',
  SATISFIED: 'SATISFIED',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  NO_MOVEMENT: 'NO_MOVEMENT',
  NO_ATTACKS: 'NO_ATTACKS',
  NO_BENEFICIAL_STEP: 'NO_BENEFICIAL_STEP',
  TARGET_DEAD: 'TARGET_DEAD'
});

function preferredRangeFor(actor) {
  const preferred = actor.weapon.preferredRange ?? actor.weapon.weaponRange;
  invariant(Number.isInteger(preferred) && preferred >= 0,
    'preferredRange must be a non-negative integer.', { actorId: actor.unitId, preferred });
  invariant(preferred <= actor.weapon.weaponRange,
    'preferredRange cannot exceed weaponRange.', {
      actorId: actor.unitId,
      preferredRange: preferred,
      weaponRange: actor.weapon.weaponRange
    });
  return preferred;
}

/**
 * Pure candidate enumeration used by both the real planner and Stage-6 attack
 * dump eligibility. It consumes NO RNG.
 *
 * A beneficial maintenance square must:
 * - be one legal orthogonal square away;
 * - increase distance from the target;
 * - remain inside weaponRange;
 * - not move farther than preferredRange.
 */
export function getRangeMaintenanceCandidates(state, actorId, targetId) {
  assertBattlefieldInvariants(state);
  const actor = requireUnit(state, actorId, 'actor');
  const target = requireUnit(state, targetId, 'target');
  invariant(actor.position && target.position, 'Actor and target must have battlefield positions.');

  if (actor.lifeState !== LIFE_STATE.ALIVE || target.lifeState !== LIFE_STATE.ALIVE) return [];

  const currentDistance = manhattanDistance(actor.position, target.position);
  const preferredRange = preferredRangeFor(actor);
  if (currentDistance > actor.weapon.weaponRange || currentDistance >= preferredRange) return [];

  return orthogonalNeighbors(state.board, actor.position)
    .filter((next) => isCellOpen(state, next.row, next.col, { ignoreUnitId: actorId }))
    .map((next) => ({
      ...next,
      targetDistance: manhattanDistance(next, target.position)
    }))
    .filter((next) => next.targetDistance > currentDistance)
    .filter((next) => next.targetDistance <= actor.weapon.weaponRange)
    .filter((next) => next.targetDistance <= preferredRange)
    .sort((a, b) => {
      // Greater distance is mechanically better until preferredRange is met.
      if (a.targetDistance !== b.targetDistance) return b.targetDistance - a.targetDistance;
      return comparePositions(a, b);
    });
}

/** True only when a real one-square preferred-range improvement is available. */
export function hasBeneficialRangeMaintenanceStep(state, actorId, targetId) {
  const actor = requireUnit(state, actorId, 'actor');
  if (actor.lifeState !== LIFE_STATE.ALIVE) return false;
  if (actor.resources.attacksRemaining <= 0 || actor.resources.movementRemaining <= 0 || isRooted(actor)) return false;
  return getRangeMaintenanceCandidates(state, actorId, targetId).length > 0;
}

/**
 * Pure Stage-6 range-maintenance decision for the actor's CURRENT square.
 * Exactly one synchronized RNG draw is used only when multiple equally good
 * immediate squares truly exist.
 */
export function planRangeMaintenanceStep(state, actorId, targetId, { rng = null } = {}) {
  assertBattlefieldInvariants(state);
  const actor = requireUnit(state, actorId, 'actor');
  const target = requireUnit(state, targetId, 'target');
  invariant(actor.position && target.position, 'Actor and target must have battlefield positions.');
  invariant(actor.lifeState === LIFE_STATE.ALIVE, 'Dead actor cannot range-maintain.', { actorId });

  const distanceBefore = manhattanDistance(actor.position, target.position);
  const preferredRange = preferredRangeFor(actor);

  const base = {
    actorId,
    targetId,
    from: { ...actor.position },
    to: null,
    targetDistanceBefore: distanceBefore,
    targetDistanceAfter: distanceBefore,
    preferredRange,
    weaponRange: actor.weapon.weaponRange,
    candidateSteps: [],
    tieBroken: false
  };

  if (target.lifeState !== LIFE_STATE.ALIVE) {
    return Object.freeze({ ...base, result: RANGE_MAINTENANCE_RESULT.TARGET_DEAD });
  }
  if (actor.resources.attacksRemaining <= 0) {
    return Object.freeze({ ...base, result: RANGE_MAINTENANCE_RESULT.NO_ATTACKS });
  }
  if (distanceBefore > actor.weapon.weaponRange) {
    return Object.freeze({ ...base, result: RANGE_MAINTENANCE_RESULT.OUT_OF_RANGE });
  }
  if (distanceBefore >= preferredRange) {
    return Object.freeze({ ...base, result: RANGE_MAINTENANCE_RESULT.SATISFIED });
  }
  if (isRooted(actor) || actor.resources.movementRemaining <= 0) {
    return Object.freeze({ ...base, result: RANGE_MAINTENANCE_RESULT.NO_MOVEMENT });
  }

  const candidates = getRangeMaintenanceCandidates(state, actorId, targetId);
  if (candidates.length === 0) {
    return Object.freeze({ ...base, result: RANGE_MAINTENANCE_RESULT.NO_BENEFICIAL_STEP });
  }

  const bestDistance = candidates[0].targetDistance;
  const best = candidates.filter((candidate) => candidate.targetDistance === bestDistance);
  let chosen = best[0];
  const tieBroken = best.length > 1;
  if (tieBroken) {
    invariant(rng && typeof rng.choose === 'function',
      'Equal best range-maintenance squares require synchronized gameplay RNG.', {
        actorId,
        targetId,
        candidates: best
      });
    chosen = rng.choose(best, `RANGE_MAINTENANCE_TIE:${actorId}->${targetId}:D${distanceBefore}->${bestDistance}`);
  }

  return Object.freeze({
    ...base,
    result: RANGE_MAINTENANCE_RESULT.MOVE,
    to: { row: chosen.row, col: chosen.col },
    targetDistanceAfter: chosen.targetDistance,
    candidateSteps: best.map(({ row, col, targetDistance }) => ({ row, col, targetDistance })),
    tieBroken
  });
}

/** Execute one authoritative Stage-6 preferred-range movement step. */
export function advanceRangeMaintenanceOneStep(state, actorId, targetId, { rng = null } = {}) {
  const plan = planRangeMaintenanceStep(state, actorId, targetId, { rng });
  if (plan.result !== RANGE_MAINTENANCE_RESULT.MOVE) {
    return Object.freeze({ ...plan, moved: false, movementBefore: null, movementAfter: null });
  }

  const movement = moveUnitOneStepWithResource(state, actorId, plan.to);
  const actor = requireUnit(state, actorId, 'actor');
  const target = requireUnit(state, targetId, 'target');
  const distanceAfter = manhattanDistance(actor.position, target.position);

  return Object.freeze({
    ...plan,
    moved: true,
    movementBefore: movement.movementBefore,
    movementAfter: movement.movementAfter,
    targetDistanceAfter: distanceAfter,
    atPreferredRange: distanceAfter >= preferredRangeFor(actor),
    stillInWeaponRange: distanceAfter <= actor.weapon.weaponRange
  });
}


/**
 * Counter-only escape repositioning.
 *
 * Ordinary preferred-range maintenance still requires an immediate distance
 * increase. During a counter, however, a longer-reach melee defender may take
 * one equal-distance lateral step when the ideal retreat square is blocked IF
 * that square creates a strictly better non-decreasing route toward preferred
 * range. This prevents a Range-3 fighter from languishing forever in a pocket
 * simply because the first useful escape step is sideways.
 */
export const COUNTER_ESCAPE_RESULT = Object.freeze({
  MOVE: 'MOVE',
  SATISFIED: 'SATISFIED',
  OUT_OF_RANGE: 'OUT_OF_RANGE',
  NO_MOVEMENT: 'NO_MOVEMENT',
  NO_ATTACKS: 'NO_ATTACKS',
  NO_BETTER_ESCAPE: 'NO_BETTER_ESCAPE',
  TARGET_DEAD: 'TARGET_DEAD'
});

function counterEscapeQuality(state, actorId, targetId, start) {
  const actor = requireUnit(state, actorId, 'actor');
  const target = requireUnit(state, targetId, 'target');
  const preferredRange = preferredRangeFor(actor);
  const weaponRange = actor.weapon.weaponRange;
  const startDistance = manhattanDistance(start, target.position);
  const legal = (pos) => isCellOpen(state, pos.row, pos.col, { ignoreUnitId: actorId });

  const neighbors = orthogonalNeighbors(state.board, start)
    .filter(legal)
    .map((pos) => ({ ...pos, distance: manhattanDistance(pos, target.position) }))
    .filter((pos) => pos.distance >= startDistance && pos.distance <= weaponRange);
  const outwardOptions = neighbors.filter((pos) => pos.distance > startDistance).length;
  const mobilityOptions = neighbors.length;

  if (startDistance >= preferredRange) {
    return { distanceToPreferred: 0, outwardOptions, mobilityOptions };
  }

  const queue = [{ ...start, depth: 0, distance: startDistance }];
  const seen = new Set([cellKey(start.row, start.col)]);
  let head = 0;
  let distanceToPreferred = null;
  while (head < queue.length) {
    const current = queue[head++];
    if (current.depth > 0 && current.distance >= preferredRange) {
      distanceToPreferred = current.depth;
      break;
    }
    for (const next of orthogonalNeighbors(state.board, current)) {
      const key = cellKey(next.row, next.col);
      if (seen.has(key) || !legal(next)) continue;
      const d = manhattanDistance(next, target.position);
      if (d < current.distance || d > weaponRange) continue;
      seen.add(key);
      queue.push({ ...next, depth: current.depth + 1, distance: d });
    }
  }
  return { distanceToPreferred, outwardOptions, mobilityOptions };
}

function compareEscapeQuality(a, b) {
  const ad = Number.isFinite(a.distanceToPreferred) ? a.distanceToPreferred : Number.MAX_SAFE_INTEGER;
  const bd = Number.isFinite(b.distanceToPreferred) ? b.distanceToPreferred : Number.MAX_SAFE_INTEGER;
  if (ad !== bd) return ad - bd; // fewer future steps is better
  if (a.outwardOptions !== b.outwardOptions) return b.outwardOptions - a.outwardOptions;
  if (a.mobilityOptions !== b.mobilityOptions) return b.mobilityOptions - a.mobilityOptions;
  return 0;
}

export function planCounterEscapeStep(state, actorId, targetId, { rng = null } = {}) {
  const actor = requireUnit(state, actorId, 'actor');
  const target = requireUnit(state, targetId, 'target');
  const distanceBefore = manhattanDistance(actor.position, target.position);
  const preferredRange = preferredRangeFor(actor);
  const base = {
    actorId, targetId, from: { ...actor.position }, to: null,
    targetDistanceBefore: distanceBefore, targetDistanceAfter: distanceBefore,
    preferredRange, weaponRange: actor.weapon.weaponRange,
    escapeMode: null, tieBroken: false, candidateSteps: []
  };
  if (target.lifeState !== LIFE_STATE.ALIVE) return Object.freeze({ ...base, result: COUNTER_ESCAPE_RESULT.TARGET_DEAD });
  if (actor.resources.attacksRemaining <= 0) return Object.freeze({ ...base, result: COUNTER_ESCAPE_RESULT.NO_ATTACKS });
  if (distanceBefore > actor.weapon.weaponRange) return Object.freeze({ ...base, result: COUNTER_ESCAPE_RESULT.OUT_OF_RANGE });
  if (distanceBefore >= preferredRange) return Object.freeze({ ...base, result: COUNTER_ESCAPE_RESULT.SATISFIED });
  if (isRooted(actor) || actor.resources.movementRemaining <= 0) return Object.freeze({ ...base, result: COUNTER_ESCAPE_RESULT.NO_MOVEMENT });

  // Immediate separation remains the first and strongest choice.
  const immediate = planRangeMaintenanceStep(state, actorId, targetId, { rng });
  if (immediate.result === RANGE_MAINTENANCE_RESULT.MOVE) {
    return Object.freeze({ ...base, ...immediate, result: COUNTER_ESCAPE_RESULT.MOVE, escapeMode: 'IMMEDIATE_SEPARATION' });
  }
  if (immediate.result !== RANGE_MAINTENANCE_RESULT.NO_BENEFICIAL_STEP) {
    return Object.freeze({ ...base, result: COUNTER_ESCAPE_RESULT.NO_BETTER_ESCAPE });
  }

  const currentQuality = counterEscapeQuality(state, actorId, targetId, actor.position);
  const lateral = orthogonalNeighbors(state.board, actor.position)
    .filter((next) => isCellOpen(state, next.row, next.col, { ignoreUnitId: actorId }))
    .map((next) => ({ ...next, targetDistance: manhattanDistance(next, target.position) }))
    .filter((next) => next.targetDistance >= 1 && next.targetDistance <= actor.weapon.weaponRange)
    .map((next) => ({ ...next, quality: counterEscapeQuality(state, actorId, targetId, next) }))
    .filter((next) => compareEscapeQuality(next.quality, currentQuality) < 0)
    .sort((a, b) => compareEscapeQuality(a.quality, b.quality) || b.targetDistance-a.targetDistance || comparePositions(a, b));

  if (!lateral.length) return Object.freeze({ ...base, result: COUNTER_ESCAPE_RESULT.NO_BETTER_ESCAPE, currentEscapeQuality: currentQuality });
  const bestQuality = lateral[0].quality;
  const bestDistance = lateral[0].targetDistance;
  const best = lateral.filter((candidate) => compareEscapeQuality(candidate.quality, bestQuality) === 0 && candidate.targetDistance === bestDistance);
  let chosen = best[0];
  const tieBroken = best.length > 1;
  if (tieBroken) {
    invariant(rng && typeof rng.choose === 'function', 'Equal counter escape squares require synchronized gameplay RNG.', { actorId, targetId, candidates: best });
    chosen = rng.choose(best, `COUNTER_ESCAPE_TIE:${actorId}->${targetId}:D${distanceBefore}`);
  }
  return Object.freeze({
    ...base,
    result: COUNTER_ESCAPE_RESULT.MOVE,
    to: { row: chosen.row, col: chosen.col },
    targetDistanceAfter: chosen.targetDistance,
    escapeMode: 'ESCAPE_SETUP',
    currentEscapeQuality: currentQuality,
    chosenEscapeQuality: chosen.quality,
    candidateSteps: best.map(({ row, col, targetDistance, quality }) => ({ row, col, targetDistance, quality })),
    tieBroken
  });
}

export function advanceCounterEscapeOneStep(state, actorId, targetId, { rng = null } = {}) {
  const plan = planCounterEscapeStep(state, actorId, targetId, { rng });
  if (plan.result !== COUNTER_ESCAPE_RESULT.MOVE) {
    return Object.freeze({ ...plan, moved: false, movementBefore: null, movementAfter: null });
  }
  const movement = moveUnitOneStepWithResource(state, actorId, plan.to);
  const actor = requireUnit(state, actorId, 'actor');
  const target = requireUnit(state, targetId, 'target');
  const distanceAfter = manhattanDistance(actor.position, target.position);
  return Object.freeze({
    ...plan,
    moved: true,
    movementBefore: movement.movementBefore,
    movementAfter: movement.movementAfter,
    targetDistanceAfter: distanceAfter,
    atPreferredRange: distanceAfter >= preferredRangeFor(actor),
    stillInWeaponRange: distanceAfter <= actor.weapon.weaponRange
  });
}

/** Stage-8 threat-retreat / kiting outcomes. */
export const KITE_RESULT = Object.freeze({
  MOVE: 'MOVE',
  NO_MOVEMENT: 'NO_MOVEMENT',
  NO_ATTACKS: 'NO_ATTACKS',
  THREAT_DEAD: 'THREAT_DEAD',
  NO_LEGAL_RETREAT: 'NO_LEGAL_RETREAT'
});

function directAwayCandidates(state, actorId, threatId) {
  const actor = requireUnit(state, actorId, 'actor');
  const threat = requireUnit(state, threatId, 'threat');
  const { row: ar, col: ac } = actor.position;
  const { row: tr, col: tc } = threat.position;
  const out = [];

  if (ar < tr) out.push({ row: ar - 1, col: ac });
  else if (ar > tr) out.push({ row: ar + 1, col: ac });
  if (ac < tc) out.push({ row: ar, col: ac - 1 });
  else if (ac > tc) out.push({ row: ar, col: ac + 1 });

  return out
    .filter((pos) => isInBounds(state.board, pos.row, pos.col))
    .filter((pos) => isCellOpen(state, pos.row, pos.col, { ignoreUnitId: actorId }))
    .map((pos) => ({ ...pos, threatDistance: manhattanDistance(pos, threat.position) }))
    .filter((pos) => pos.threatDistance <= actor.weapon.weaponRange)
    .sort(comparePositions);
}

/**
 * Stage-8 Throwing-Dagger retreat planner.
 *
 * Priority:
 * 1. A legal direct-away orthogonal square that increases distance.
 * 2. Otherwise any legal orthogonal square that maximizes or maintains distance.
 * 3. Equal choices use synchronized gameplay RNG.
 *
 * The chosen square must keep the threat inside weaponRange so the promised
 * attack/counter can still occur immediately after the retreat.
 */
export function planThreatRetreatStep(state, actorId, threatId, { rng = null } = {}) {
  assertBattlefieldInvariants(state);
  const actor = requireUnit(state, actorId, 'actor');
  const threat = requireUnit(state, threatId, 'threat');
  invariant(actor.position && threat.position, 'Actor and threat must have battlefield positions.');
  invariant(actor.lifeState === LIFE_STATE.ALIVE, 'Dead actor cannot kite.', { actorId });

  const distanceBefore = manhattanDistance(actor.position, threat.position);
  const base = {
    actorId,
    threatId,
    from: { ...actor.position },
    to: null,
    threatDistanceBefore: distanceBefore,
    threatDistanceAfter: distanceBefore,
    candidateSteps: [],
    directRetreat: false,
    tieBroken: false
  };

  if (threat.lifeState !== LIFE_STATE.ALIVE) return Object.freeze({ ...base, result: KITE_RESULT.THREAT_DEAD });
  if (actor.resources.attacksRemaining <= 0) return Object.freeze({ ...base, result: KITE_RESULT.NO_ATTACKS });
  if (isRooted(actor) || actor.resources.movementRemaining <= 0) return Object.freeze({ ...base, result: KITE_RESULT.NO_MOVEMENT });

  const direct = directAwayCandidates(state, actorId, threatId)
    .filter((pos) => pos.threatDistance > distanceBefore);

  let best = direct;
  let directRetreat = direct.length > 0;

  if (best.length === 0) {
    const legal = orthogonalNeighbors(state.board, actor.position)
      .filter((pos) => isCellOpen(state, pos.row, pos.col, { ignoreUnitId: actorId }))
      .map((pos) => ({ ...pos, threatDistance: manhattanDistance(pos, threat.position) }))
      .filter((pos) => pos.threatDistance <= actor.weapon.weaponRange)
      .filter((pos) => pos.threatDistance >= distanceBefore)
      .sort((a, b) => {
        if (a.threatDistance !== b.threatDistance) return b.threatDistance - a.threatDistance;
        return comparePositions(a, b);
      });

    if (legal.length > 0) {
      const maxDistance = legal[0].threatDistance;
      best = legal.filter((pos) => pos.threatDistance === maxDistance);
    }
  }

  if (best.length === 0) return Object.freeze({ ...base, result: KITE_RESULT.NO_LEGAL_RETREAT });

  let chosen = best[0];
  const tieBroken = best.length > 1;
  if (tieBroken) {
    invariant(rng && typeof rng.choose === 'function',
      'Equal Throwing-Dagger retreat squares require synchronized gameplay RNG.', {
        actorId,
        threatId,
        candidates: best
      });
    chosen = rng.choose(best, `THROWING_DAGGER_RETREAT_TIE:${actorId}->${threatId}:D${distanceBefore}`);
  }

  return Object.freeze({
    ...base,
    result: KITE_RESULT.MOVE,
    to: { row: chosen.row, col: chosen.col },
    threatDistanceAfter: chosen.threatDistance,
    candidateSteps: best.map(({ row, col, threatDistance }) => ({ row, col, threatDistance })),
    directRetreat,
    tieBroken
  });
}

export function hasLegalThreatRetreatStep(state, actorId, threatId) {
  const actor = requireUnit(state, actorId, 'actor');
  const threat = requireUnit(state, threatId, 'threat');
  if (!actor || !threat || actor.lifeState !== LIFE_STATE.ALIVE || threat.lifeState !== LIFE_STATE.ALIVE) return false;
  if (actor.resources.attacksRemaining <= 0 || actor.resources.movementRemaining <= 0 || isRooted(actor)) return false;

  const distanceBefore = manhattanDistance(actor.position, threat.position);
  return orthogonalNeighbors(state.board, actor.position)
    .filter((pos) => isCellOpen(state, pos.row, pos.col, { ignoreUnitId: actorId }))
    .map((pos) => ({ ...pos, distance: manhattanDistance(pos, threat.position) }))
    .some((pos) => pos.distance >= distanceBefore && pos.distance <= actor.weapon.weaponRange);
}

/** Execute exactly one authoritative Stage-8 retreat step. */
export function advanceThreatRetreatOneStep(state, actorId, threatId, { rng = null } = {}) {
  const plan = planThreatRetreatStep(state, actorId, threatId, { rng });
  if (plan.result !== KITE_RESULT.MOVE) {
    return Object.freeze({ ...plan, moved: false, movementBefore: null, movementAfter: null });
  }
  const movement = moveUnitOneStepWithResource(state, actorId, plan.to);
  const actor = requireUnit(state, actorId, 'actor');
  const threat = requireUnit(state, threatId, 'threat');
  return Object.freeze({
    ...plan,
    moved: true,
    movementBefore: movement.movementBefore,
    movementAfter: movement.movementAfter,
    threatDistanceAfter: manhattanDistance(actor.position, threat.position)
  });
}
