import { ACTION_KIND, ACTION_RUNTIME_STATE, EVENT_TYPE, LIFE_STATE } from './constants.js';
import { invariant } from './errors.js';
import { interruptSpell } from './spells.js';
import { findStatus, hasStatus, removeStatus, statusKey, upsertStatus } from './status.js';
import { canAcquireDirectHostileTarget } from './targeting.js';
import { getAbility } from './roster.js';
import { consumeWardForStatus, unstoppableBlocksControl } from './counterplay.js';

export const CONTROL_TYPE = Object.freeze({
  STUN: 'STUN',
  SILENCE: 'SILENCE',
  TAUNT: 'TAUNT',
  BERSERK: 'BERSERK'
});

function sync(simulation) { simulation.state.round.eventSequence = simulation.events.length; }
function emit(simulation, type, options) {
  const event = simulation.events.emit(type, options);
  sync(simulation);
  return event;
}
function runtimeForActor(simulation, actorId) {
  return Object.values(simulation.runtimes).find((r) => r.actorId === actorId) ?? null;
}
function markRuntimeActive(simulation, runtime) {
  const ids = new Set(simulation.state.round.activeRuntimeIds);
  ids.add(runtime.runtimeId);
  simulation.state.round.activeRuntimeIds = Array.from(ids).sort();
}
function unmarkRuntimeActive(simulation, runtime) {
  const ids = new Set(simulation.state.round.activeRuntimeIds);
  ids.delete(runtime.runtimeId);
  simulation.state.round.activeRuntimeIds = Array.from(ids).sort();
}
export function hasControlStatus(unit, type) { return hasStatus(unit, type); }

function livingTargetPool(simulation, actorId) {
  return Object.values(simulation.state.units)
    .filter((u) => u.unitId !== actorId && u.lifeState === LIFE_STATE.ALIVE)
    .filter((u) => canAcquireDirectHostileTarget(simulation.state, actorId, u.unitId))
    .sort((a, b) => a.unitId.localeCompare(b.unitId));
}

function chooseBerserkTarget(simulation, actorId) {
  const pool = livingTargetPool(simulation, actorId);
  if (!pool.length) return null;
  if (pool.length === 1) return pool[0].unitId;
  return simulation.rng.choose(pool, `BERSERK_TARGET:${actorId}`).unitId;
}

function captureOriginalRuntime(runtime) {
  if (runtime.metadata.controlOriginal) return runtime.metadata.controlOriginal;
  runtime.metadata.controlOriginal = {
    actionKind: runtime.actionKind,
    actionId: runtime.actionId,
    state: runtime.state,
    completed: runtime.completed,
    interrupted: runtime.interrupted,
    currentForcedTargetId: runtime.currentForcedTargetId,
    basicStyle: runtime.metadata.basicStyle ? structuredClone(runtime.metadata.basicStyle) : null,
    basicStyleReadyCycle: runtime.metadata.basicStyleReadyCycle ?? null,
    basicStylePrimedInvisible: runtime.metadata.basicStylePrimedInvisible ?? false,
    basicStyleSuccessfulHits: runtime.metadata.basicStyleSuccessfulHits ?? 0
  };
  return runtime.metadata.controlOriginal;
}

function emitForcedActionStart(simulation, runtime, forcedTargetId, { cycle, controlType, parentEventId }) {
  const start = emit(simulation, EVENT_TYPE.ACTION_START, {
    initiativeCycle: cycle,
    actorId: runtime.actorId,
    targetId: forcedTargetId,
    parentEventId,
    payload: {
      actionId: runtime.actionId,
      actionKind: ACTION_KIND.BASIC_ATTACK,
      forcedByControl: controlType,
      preservesSpentResources: true
    }
  });
  runtime.metadata.actionStartEventId = start.eventId;
  simulation.trace.record('CONTROL_FORCED_ATTACK', {
    cycle,
    actorId: runtime.actorId,
    forcedTargetId,
    controlType,
    movementRemaining: simulation.state.units[runtime.actorId]?.resources?.movementRemaining,
    attacksRemaining: simulation.state.units[runtime.actorId]?.resources?.attacksRemaining,
    eventId: start.eventId
  });
  return start;
}

function forceRuntimeToTarget(simulation, runtime, forcedTargetId, { cycle, controlType, parentEventId, emitStart = false }) {
  if (!runtime || !forcedTargetId) return null;
  captureOriginalRuntime(runtime);

  const needsConversion = runtime.actionKind !== ACTION_KIND.BASIC_ATTACK || runtime.state === ACTION_RUNTIME_STATE.INTERRUPTED;
  if (needsConversion) {
    runtime.actionKind = ACTION_KIND.BASIC_ATTACK;
    runtime.actionId = `${controlType}_FORCED_ATTACK`;
    runtime.state = ACTION_RUNTIME_STATE.ACTIVE;
    runtime.interrupted = false;
    runtime.completed = false;
    markRuntimeActive(simulation, runtime);
  }

  runtime.currentForcedTargetId = forcedTargetId;
  runtime.metadata.forcedByControl = controlType;
  runtime.metadata.forcedAttackTargetId = forcedTargetId;
  // Taunt/Berserk force a plain Basic Attack. Declaration-specific attack styles
  // (Rend, Snipe, Backstab, etc.) are suspended until control legitimately ends.
  runtime.metadata.basicStyle = null;

  if (emitStart || needsConversion) {
    return emitForcedActionStart(simulation, runtime, forcedTargetId, { cycle, controlType, parentEventId });
  }
  return null;
}

function terminalRuntime(runtime) {
  return !runtime || [ACTION_RUNTIME_STATE.COMPLETED, ACTION_RUNTIME_STATE.INTERRUPTED, ACTION_RUNTIME_STATE.IMPOSSIBLE].includes(runtime.state);
}

function declarationForRuntime(simulation, runtime) {
  return simulation.declarations.find((d) => d.declarationId === runtime?.declarationId) ?? null;
}

function runtimeSilenceSensitive(simulation, runtime) {
  if (!runtime) return false;
  if (runtime.actionKind === ACTION_KIND.SPELL) return true;
  const ref = declarationForRuntime(simulation, runtime)?.payload?.roster;
  if (!ref) return false;
  return getAbility(ref.archetypeId, ref.abilityId)?.silenceSensitive === true;
}
function runtimeHardControlBypass(simulation, runtime) {
  if (!runtime) return false;
  const ref = declarationForRuntime(simulation, runtime)?.payload?.roster;
  if (!ref) return false;
  return getAbility(ref.archetypeId, ref.abilityId)?.hardControlBypass === true;
}

function interruptNonSpellAction(simulation, runtime, { cycle, reason, parentEventId, preventedStart = false }) {
  if (!runtime || runtime.actionKind === ACTION_KIND.SPELL || terminalRuntime(runtime)) return null;
  const wasCharging = runtime.state === ACTION_RUNTIME_STATE.CHARGING;
  runtime.state = ACTION_RUNTIME_STATE.INTERRUPTED;
  runtime.interrupted = true;
  runtime.completed = false;
  runtime.metadata.interruptReason = reason;
  unmarkRuntimeActive(simulation, runtime);

  let causalParentId = parentEventId;
  let itemInterruptEvent = null;
  if (runtime.actionKind === ACTION_KIND.ITEM && wasCharging) {
    itemInterruptEvent = emit(simulation, EVENT_TYPE.ITEM_INTERRUPT, {
      initiativeCycle: cycle,
      actorId: runtime.actorId,
      targetId: runtime.currentForcedTargetId ?? runtime.declaredPrimaryTargetId,
      parentEventId,
      payload: { reason, actionId: runtime.actionId }
    });
    causalParentId = itemInterruptEvent.eventId;
  }

  const event = emit(simulation, EVENT_TYPE.ACTION_INTERRUPT, {
    initiativeCycle: cycle,
    actorId: runtime.actorId,
    targetId: runtime.currentForcedTargetId ?? runtime.declaredPrimaryTargetId,
    parentEventId: causalParentId,
    payload: { reason, actionId: runtime.actionId, preventedStart }
  });
  simulation.trace.record('CONTROL_ACTION_INTERRUPT', {
    cycle,
    actorId: runtime.actorId,
    actionKind: runtime.actionKind,
    reason,
    preventedStart,
    itemInterruptEventId: itemInterruptEvent?.eventId ?? null,
    eventId: event.eventId
  });
  return event;
}

function interruptPendingSpell(simulation, runtime, { cycle, reason, parentEventId }) {
  if (!runtime || runtime.actionKind !== ACTION_KIND.SPELL || terminalRuntime(runtime)) return null;
  if (runtime.state === ACTION_RUNTIME_STATE.CHARGING) {
    const out = interruptSpell(simulation, runtime.actorId, { cycle, reason, parentEventId });
    return out.interrupted ? { eventId: out.eventId } : null;
  }
  runtime.state = ACTION_RUNTIME_STATE.INTERRUPTED;
  runtime.interrupted = true;
  runtime.completed = false;
  runtime.metadata.interruptReason = reason;
  unmarkRuntimeActive(simulation, runtime);
  const event = emit(simulation, EVENT_TYPE.ACTION_INTERRUPT, {
    initiativeCycle: cycle,
    actorId: runtime.actorId,
    targetId: runtime.currentForcedTargetId ?? runtime.declaredPrimaryTargetId,
    parentEventId,
    payload: { reason, actionId: runtime.actionId, preventedStart: true }
  });
  simulation.trace.record('CONTROL_SPELL_START_PREVENTED', { cycle, actorId: runtime.actorId, reason, eventId: event.eventId });
  return event;
}

function interruptRuntimeForControl(simulation, runtime, { cycle, reason, parentEventId }) {
  if (!runtime || terminalRuntime(runtime)) return null;
  if (runtimeHardControlBypass(simulation, runtime)) return null;
  if (runtime.actionKind === ACTION_KIND.SPELL) {
    return interruptPendingSpell(simulation, runtime, { cycle, reason, parentEventId });
  }
  return interruptNonSpellAction(simulation, runtime, {
    cycle,
    reason,
    parentEventId,
    preventedStart: runtime.state === ACTION_RUNTIME_STATE.PENDING
  });
}

/** Public round-start/control reconciliation hook for carried hard CC. */
export function interruptActorRuntimeForControl(simulation, actorId, {
  cycle = simulation.state.round.initiativeCycle,
  reason = 'STUN',
  parentEventId = null
} = {}) {
  const runtime = runtimeForActor(simulation, actorId);
  return interruptRuntimeForControl(simulation, runtime, { cycle, reason, parentEventId });
}

export function applyControlEffect(simulation, targetId, {
  type,
  sourceId = null,
  duration = 1,
  cycle = simulation.state.round.initiativeCycle,
  parentEventId = null
} = {}) {
  invariant(Object.values(CONTROL_TYPE).includes(type), `Unknown control type: ${type}`);
  invariant(Number.isInteger(duration) && duration >= 1, 'Control duration must be an integer >= 1.');
  const target = simulation.state.units[targetId];
  invariant(target, `Unknown control target: ${targetId}`);
  if (target.lifeState !== LIFE_STATE.ALIVE) return { applied: false, reason: 'TARGET_DEAD' };

  if (unstoppableBlocksControl(target, type)) {
    const block = emit(simulation, EVENT_TYPE.BLOCK, {
      initiativeCycle: cycle,
      actorId: targetId,
      targetId,
      parentEventId,
      payload: { reason: 'UNSTOPPABLE', blockedControl: statusKey(type), hostileSourceId: sourceId }
    });
    simulation.trace.record('UNSTOPPABLE_BLOCK', { cycle, targetId, sourceId, type, eventId: block.eventId });
    return { applied: false, reason: 'UNSTOPPABLE', blockEventId: block.eventId };
  }

  const wardBlock = consumeWardForStatus(simulation, targetId, { sourceId, key: statusKey(type), cycle, parentEventId });
  if (wardBlock) return { applied: false, reason: 'WARD', blockEventId: wardBlock.eventId };

  let forcedTargetId = null;
  if (type === CONTROL_TYPE.TAUNT) {
    invariant(sourceId && simulation.state.units[sourceId]?.lifeState === LIFE_STATE.ALIVE, 'TAUNT requires a living sourceId.');
    forcedTargetId = sourceId;
  } else if (type === CONTROL_TYPE.BERSERK) {
    forcedTargetId = chooseBerserkTarget(simulation, targetId);
  }

  const controlEvent = emit(simulation, EVENT_TYPE[type], {
    initiativeCycle: cycle,
    actorId: sourceId,
    targetId,
    parentEventId,
    payload: { duration, forcedTargetId }
  });
  const status = {
    key: statusKey(type),
    duration,
    sourceId,
    data: forcedTargetId
      ? { forcedTargetId, ...(type === CONTROL_TYPE.BERSERK ? { targetRoundNumber: simulation.state.roundNumber } : {}) }
      : (type === CONTROL_TYPE.BERSERK ? { targetRoundNumber: simulation.state.roundNumber } : {})
  };
  upsertStatus(target, status);
  const statusEvent = emit(simulation, EVENT_TYPE.STATUS_APPLY, {
    initiativeCycle: cycle,
    actorId: sourceId,
    targetId,
    parentEventId: controlEvent.eventId,
    payload: { ...status }
  });

  const runtime = runtimeForActor(simulation, targetId);
  const hardControlBypass = runtimeHardControlBypass(simulation, runtime);
  let actionInterruptEvent = null;
  let interruptedCast = false;

  if (runtime && !hardControlBypass && (type === CONTROL_TYPE.TAUNT || type === CONTROL_TYPE.BERSERK)) {
    // Preserve the immutable underlying action identity before hard control converts
    // the mutable runtime into a forced basic engagement.
    captureOriginalRuntime(runtime);
  }

  if (runtime && !hardControlBypass && type === CONTROL_TYPE.STUN) {
    actionInterruptEvent = interruptRuntimeForControl(simulation, runtime, {
      cycle, reason: CONTROL_TYPE.STUN, parentEventId: statusEvent.eventId
    });
    interruptedCast = runtime.actionKind === ACTION_KIND.SPELL && !!actionInterruptEvent;
  } else if (runtime && !hardControlBypass && type === CONTROL_TYPE.SILENCE && runtimeSilenceSensitive(simulation, runtime)) {
    actionInterruptEvent = interruptRuntimeForControl(simulation, runtime, {
      cycle, reason: CONTROL_TYPE.SILENCE, parentEventId: statusEvent.eventId
    });
    interruptedCast = runtime.actionKind === ACTION_KIND.SPELL && !!actionInterruptEvent;
  } else if (runtime && !hardControlBypass && (type === CONTROL_TYPE.TAUNT || type === CONTROL_TYPE.BERSERK) && forcedTargetId) {
    if ([ACTION_KIND.SPELL, ACTION_KIND.ABILITY, ACTION_KIND.ITEM].includes(runtime.actionKind)) {
      actionInterruptEvent = interruptRuntimeForControl(simulation, runtime, {
        cycle, reason: type, parentEventId: statusEvent.eventId
      });
      interruptedCast = runtime.metadata.controlOriginal?.actionKind === ACTION_KIND.SPELL && !!actionInterruptEvent;
    }
  }

  let forcedStart = null;
  const suppressedByExistingStun = hasControlStatus(target, CONTROL_TYPE.STUN);
  if (!hardControlBypass && !suppressedByExistingStun && (type === CONTROL_TYPE.TAUNT || type === CONTROL_TYPE.BERSERK) && forcedTargetId && runtime) {
    forcedStart = forceRuntimeToTarget(simulation, runtime, forcedTargetId, {
      cycle,
      controlType: type,
      parentEventId: actionInterruptEvent?.eventId ?? statusEvent.eventId,
      emitStart: !!actionInterruptEvent || runtime.actionKind === ACTION_KIND.HOLD
    });
  }

  simulation.trace.record('CONTROL_APPLY', {
    cycle,
    type,
    sourceId,
    targetId,
    duration,
    forcedTargetId,
    interruptedCast,
    controlEventId: controlEvent.eventId,
    statusEventId: statusEvent.eventId
  });

  return {
    applied: true,
    type,
    targetId,
    forcedTargetId,
    interruptedCast,
    controlEventId: controlEvent.eventId,
    statusEventId: statusEvent.eventId,
    actionInterruptEventId: actionInterruptEvent?.eventId ?? null,
    forcedActionStartEventId: forcedStart?.eventId ?? null
  };
}

function restoreRuntimeAfterForcedControl(simulation, runtime, { cycle, reason, parentEventId }) {
  if (!runtime?.metadata?.controlOriginal) return null;
  const original = runtime.metadata.controlOriginal;
  runtime.currentForcedTargetId = original.currentForcedTargetId ?? null;
  runtime.metadata.forcedByControl = null;
  runtime.metadata.forcedAttackTargetId = null;

  if (original.actionKind === ACTION_KIND.BASIC_ATTACK) {
    runtime.actionKind = ACTION_KIND.BASIC_ATTACK;
    runtime.actionId = original.actionId;
    runtime.state = original.state === ACTION_RUNTIME_STATE.PENDING ? ACTION_RUNTIME_STATE.ACTIVE : original.state;
    runtime.completed = false;
    runtime.interrupted = false;
    runtime.metadata.basicStyle = original.basicStyle ? structuredClone(original.basicStyle) : null;
    runtime.metadata.basicStyleReadyCycle = original.basicStyleReadyCycle ?? 0;
    runtime.metadata.basicStylePrimedInvisible = Boolean(original.basicStylePrimedInvisible);
    runtime.metadata.basicStyleSuccessfulHits = Math.max(0, Math.trunc(original.basicStyleSuccessfulHits ?? 0));
    markRuntimeActive(simulation, runtime);
  } else if (original.actionKind === ACTION_KIND.HOLD) {
    runtime.actionKind = ACTION_KIND.HOLD;
    runtime.actionId = original.actionId;
    runtime.state = ACTION_RUNTIME_STATE.PENDING;
    runtime.completed = false;
    runtime.interrupted = false;
    unmarkRuntimeActive(simulation, runtime);
  } else if ([ACTION_KIND.SPELL, ACTION_KIND.ABILITY, ACTION_KIND.ITEM].includes(original.actionKind)) {
    // Delayed actions interrupted by hard control are spent for the round; control
    // expiry never grants a free spell recast, physical-special restart, or item retry.
    runtime.actionKind = original.actionKind;
    runtime.actionId = original.actionId;
    runtime.state = ACTION_RUNTIME_STATE.INTERRUPTED;
    runtime.completed = false;
    runtime.interrupted = true;
    unmarkRuntimeActive(simulation, runtime);
  }

  simulation.trace.record('CONTROL_RUNTIME_RESTORE', {
    cycle,
    actorId: runtime.actorId,
    reason,
    actionKind: runtime.actionKind,
    declaredPrimaryTargetId: runtime.declaredPrimaryTargetId
  });
  delete runtime.metadata.controlOriginal;
  return null;
}

export function expireControlEffect(simulation, targetId, type, {
  cycle = simulation.state.round.initiativeCycle,
  reason = 'EXPIRED',
  parentEventId = null
} = {}) {
  invariant(Object.values(CONTROL_TYPE).includes(type), `Unknown control type: ${type}`);
  const unit = simulation.state.units[targetId];
  invariant(unit, `Unknown control target: ${targetId}`);
  const removed = removeStatus(unit, type);
  if (!removed) return { expired: false, reason: 'NOT_PRESENT' };

  const expire = emit(simulation, EVENT_TYPE.STATUS_EXPIRE, {
    initiativeCycle: cycle,
    actorId: removed.sourceId ?? null,
    targetId,
    parentEventId,
    payload: { key: removed.key, reason }
  });

  let restoreEvent = null;
  if (type === CONTROL_TYPE.TAUNT || type === CONTROL_TYPE.BERSERK) {
    restoreEvent = restoreRuntimeAfterForcedControl(simulation, runtimeForActor(simulation, targetId), {
      cycle,
      reason,
      parentEventId: expire.eventId
    });
  }
  simulation.trace.record('CONTROL_EXPIRE', { cycle, targetId, type, reason, eventId: expire.eventId });
  return { expired: true, expireEventId: expire.eventId, restoreEventId: restoreEvent?.eventId ?? null };
}

export function reconcileForcedControl(simulation, actorId, {
  cycle = simulation.state.round.initiativeCycle
} = {}) {
  const unit = simulation.state.units[actorId];
  const runtime = runtimeForActor(simulation, actorId);
  if (!unit || !runtime || unit.lifeState !== LIFE_STATE.ALIVE) return { forced: false, reason: 'NO_LIVING_ACTOR' };

  const taunt = findStatus(unit, CONTROL_TYPE.TAUNT);
  if (taunt) {
    const source = taunt.sourceId ? simulation.state.units[taunt.sourceId] : null;
    if (!source || source.lifeState !== LIFE_STATE.ALIVE) {
      expireControlEffect(simulation, actorId, CONTROL_TYPE.TAUNT, { cycle, reason: 'TAUNTER_DEAD' });
      return { forced: false, reason: 'TAUNTER_DEAD' };
    }
    if (runtime.currentForcedTargetId !== source.unitId) {
      if ([ACTION_KIND.SPELL, ACTION_KIND.ABILITY, ACTION_KIND.ITEM].includes(runtime.actionKind)) {
        captureOriginalRuntime(runtime);
        interruptRuntimeForControl(simulation, runtime, { cycle, reason: CONTROL_TYPE.TAUNT, parentEventId: null });
      }
      forceRuntimeToTarget(simulation, runtime, source.unitId, { cycle, controlType: CONTROL_TYPE.TAUNT, parentEventId: null });
    }
    return { forced: true, type: CONTROL_TYPE.TAUNT, targetId: source.unitId };
  }

  const berserk = findStatus(unit, CONTROL_TYPE.BERSERK);
  if (berserk) {
    const roundChanged = berserk.data?.targetRoundNumber !== simulation.state.roundNumber;
    let targetId = roundChanged ? null : runtime.currentForcedTargetId;
    const current = targetId ? simulation.state.units[targetId] : null;
    // Once acquired this round, invisibility does not break the existing legal lock.
    // A fresh acquisition is required only on a new round or after target death.
    const currentLockStillValid = current && current.lifeState === LIFE_STATE.ALIVE;

    if (roundChanged || !currentLockStillValid) {
      targetId = chooseBerserkTarget(simulation, actorId);
      berserk.data = {
        ...(berserk.data ?? {}),
        forcedTargetId: targetId,
        targetRoundNumber: simulation.state.roundNumber
      };
      if (!targetId) {
        runtime.currentForcedTargetId = null;
        return { forced: true, type: CONTROL_TYPE.BERSERK, targetId: null, reason: 'NO_ELIGIBLE_TARGET' };
      }
      if ([ACTION_KIND.SPELL, ACTION_KIND.ABILITY, ACTION_KIND.ITEM].includes(runtime.actionKind)) {
        captureOriginalRuntime(runtime);
        interruptRuntimeForControl(simulation, runtime, { cycle, reason: CONTROL_TYPE.BERSERK, parentEventId: null });
      }
      forceRuntimeToTarget(simulation, runtime, targetId, { cycle, controlType: CONTROL_TYPE.BERSERK, parentEventId: null });
      simulation.trace.record(roundChanged ? 'BERSERK_NEW_ROUND_TARGET' : 'BERSERK_RETARGET', {
        cycle, actorId, targetId, roundNumber: simulation.state.roundNumber
      });
    }
    return { forced: true, type: CONTROL_TYPE.BERSERK, targetId };
  }

  return { forced: false, reason: 'NO_FORCED_CONTROL' };
}

export function proactiveControlGate(simulation, actorId, { cycle = simulation.state.round.initiativeCycle } = {}) {
  const unit = simulation.state.units[actorId];
  if (!unit || unit.lifeState !== LIFE_STATE.ALIVE) return { allowed: false, reason: 'ACTOR_DEAD' };
  const runtime = runtimeForActor(simulation, actorId);
  if (runtimeHardControlBypass(simulation, runtime)) return { allowed: true, reason: 'HARD_CONTROL_BYPASS' };
  if (hasControlStatus(unit, CONTROL_TYPE.STUN)) return { allowed: false, reason: 'STUNNED' };
  const forced = reconcileForcedControl(simulation, actorId, { cycle });
  if (forced.forced && !forced.targetId) return { allowed: false, reason: forced.reason ?? 'NO_FORCED_TARGET' };
  return { allowed: true, reason: forced.forced ? forced.type : 'ALLOWED', forcedTargetId: forced.targetId ?? null };
}
