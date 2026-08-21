import { ACTION_KIND, ACTION_RUNTIME_STATE, EVENT_TYPE, LIFE_STATE, TARGET_TYPE } from './constants.js';
import { invariant } from './errors.js';
import { isInBounds, manhattanDistance } from './grid.js';
import { AREA_SHAPE, unitsInArea } from './area.js';
import { pullUnit, pushUnit } from './displacement.js';
import { findStatus, hasStatus, removeStatus } from './status.js';
import { getAbility } from './roster.js';
import { effectiveCompletionDelay } from './rule-overrides.js';
import { resolveRosterEffects } from './roster-effects.js';
import { consumeSpellbreak } from './counterplay.js';

export const SPELL_COMPLETION_RESULT = Object.freeze({
  COMPLETE: 'COMPLETE',
  FIZZLE: 'FIZZLE',
  INTERRUPTED: 'INTERRUPTED'
});

function sync(simulation) { simulation.state.round.eventSequence = simulation.events.length; }
function emit(simulation, type, options) {
  const event = simulation.events.emit(type, options);
  sync(simulation);
  return event;
}

function runtimeForActor(simulation, actorId) {
  return Object.values(simulation.runtimes).find((runtime) => runtime.actorId === actorId) ?? null;
}

function declarationForRuntime(simulation, runtime) {
  return simulation.declarations.find((d) => d.declarationId === runtime.declarationId) ?? null;
}

function pendingArcaneEchoForRuntime(simulation, runtime) {
  const actor = simulation.state.units[runtime?.actorId];
  if (!actor || !findStatus(actor, 'arcane_echo')) return false;
  const declaration = runtime ? declarationForRuntime(simulation, runtime) : null;
  const ref = declaration?.payload?.roster;
  return ref?.abilityId !== 'ARCANE_ECHO';
}

function consumeSpellbreakAgainstRuntime(simulation, runtime, { cycle, parentEventId = null } = {}) {
  const consumed = consumeSpellbreak(simulation, runtime.actorId, { cycle, parentEventId });
  if (!consumed) return { consumed: null, echoFirstResolutionOnly: false };
  if (pendingArcaneEchoForRuntime(simulation, runtime)) {
    runtime.metadata.spellbreakSuppressFirstResolution = true;
    simulation.trace.record('SPELLBREAK_SUPPRESSES_FIRST_ECHO_RESOLUTION', {
      cycle,
      actorId: runtime.actorId,
      runtimeId: runtime.runtimeId,
      spellbreakEventId: consumed.eventId
    });
    return { consumed, echoFirstResolutionOnly: true };
  }
  return { consumed, echoFirstResolutionOnly: false };
}

function markRuntimeActive(simulation, runtime) {
  const ids = new Set(simulation.state.round.activeRuntimeIds);
  ids.add(runtime.runtimeId);
  simulation.state.round.activeRuntimeIds = Array.from(ids).sort();
}

export function getSpellSpec(simulation, runtime) {
  invariant(runtime?.actionKind === ACTION_KIND.SPELL, 'Spell spec requested for non-spell runtime.');
  const declaration = declarationForRuntime(simulation, runtime);
  invariant(declaration, `Missing declaration for runtime ${runtime.runtimeId}`);
  const spec = declaration.payload?.spell ?? declaration.payload ?? {};
  const completionDelayCycles = spec.completionDelayCycles;
  invariant(Number.isInteger(completionDelayCycles) && completionDelayCycles >= 1,
    'SPELL requires payload.spell.completionDelayCycles as an integer >= 1.', { runtimeId: runtime.runtimeId, completionDelayCycles });
  const castRange = spec.castRange ?? 999;
  invariant(Number.isInteger(castRange) && castRange >= 0, 'spell.castRange must be an integer >= 0.');
  return {
    completionDelayCycles,
    castRange,
    effect: spec.effect ?? null,
    area: spec.area ?? null
  };
}

export function startPendingSpells(simulation, cycle) {
  const started = [];
  const runtimes = Object.values(simulation.runtimes)
    .filter((r) => r.actionKind === ACTION_KIND.SPELL && r.state === ACTION_RUNTIME_STATE.PENDING)
    .sort((a, b) => a.actorId.localeCompare(b.actorId));

  for (const runtime of runtimes) {
    const actor = simulation.state.units[runtime.actorId];
    if (!actor || actor.lifeState !== LIFE_STATE.ALIVE) {
      runtime.state = ACTION_RUNTIME_STATE.INTERRUPTED;
      runtime.interrupted = true;
      continue;
    }
    if (hasStatus(actor, 'silence')) {
      runtime.state = ACTION_RUNTIME_STATE.INTERRUPTED;
      runtime.interrupted = true;
      runtime.metadata.interruptReason = 'SILENCE';
      const blocked = emit(simulation, EVENT_TYPE.ACTION_INTERRUPT, {
        initiativeCycle: cycle,
        actorId: runtime.actorId,
        targetId: runtime.declaredPrimaryTargetId,
        payload: { reason: 'SILENCE', actionId: runtime.actionId, preventedCastStart: true }
      });
      simulation.trace.record('CAST_PREVENTED_BY_SILENCE', { cycle, actorId: runtime.actorId, eventId: blocked.eventId });
      continue;
    }
    if (hasStatus(actor, 'stun')) {
      runtime.state = ACTION_RUNTIME_STATE.INTERRUPTED;
      runtime.interrupted = true;
      runtime.metadata.interruptReason = 'STUN';
      const blocked = emit(simulation, EVENT_TYPE.ACTION_INTERRUPT, {
        initiativeCycle: cycle,
        actorId: runtime.actorId,
        targetId: runtime.declaredPrimaryTargetId,
        payload: { reason: 'STUN', actionId: runtime.actionId, preventedCastStart: true }
      });
      simulation.trace.record('CAST_PREVENTED_BY_STUN', { cycle, actorId: runtime.actorId, eventId: blocked.eventId });
      continue;
    }
    const baseSpec = getSpellSpec(simulation, runtime);
    const effectiveDelay = effectiveCompletionDelay(actor, baseSpec.completionDelayCycles);
    const spec = { ...baseSpec, completionDelayCycles: effectiveDelay };
    const rosterRef = declarationForRuntime(simulation, runtime).payload?.roster;
    if (rosterRef) {
      const rosterAbility = getAbility(rosterRef.archetypeId, rosterRef.abilityId);
      if (rosterAbility.deadTargetOnly === true) {
        const declaration = declarationForRuntime(simulation, runtime);
        const target = declaration.target?.type===TARGET_TYPE.UNIT ? simulation.state.units[declaration.target.unitId] : null;
        if (!target || target.side!==actor.side || target.lifeState!==LIFE_STATE.DEAD) {
          runtime.state = ACTION_RUNTIME_STATE.IMPOSSIBLE;
          runtime.interrupted = true;
          emit(simulation, EVENT_TYPE.ACTION_INTERRUPT, { initiativeCycle: cycle, actorId: runtime.actorId, targetId: runtime.declaredPrimaryTargetId, payload: { reason: 'TARGET_MUST_BE_KO_ALLY', actionId: runtime.actionId, preventedCastStart: true } });
          continue;
        }
      }
      if (rosterAbility.usesMax) {
        const key = rosterAbility.usesKey ?? rosterAbility.id;
        const left = actor.limitedUses[key] ?? rosterAbility.usesMax;
        if (left <= 0) {
          runtime.state = ACTION_RUNTIME_STATE.IMPOSSIBLE;
          runtime.interrupted = true;
          emit(simulation, EVENT_TYPE.ACTION_INTERRUPT, { initiativeCycle: cycle, actorId: runtime.actorId, targetId: runtime.declaredPrimaryTargetId, payload: { reason: 'NO_USES', actionId: runtime.actionId } });
          continue;
        }
        actor.limitedUses[key] = left - 1;
      }
    }
    runtime.state = ACTION_RUNTIME_STATE.CHARGING;
    runtime.castStartCycle = cycle;
    runtime.completionCycle = cycle + spec.completionDelayCycles;
    runtime.metadata.baseCompletionDelayCycles = baseSpec.completionDelayCycles;
    runtime.metadata.completionDelayCycles = spec.completionDelayCycles;
    runtime.metadata.castRange = spec.castRange;
    markRuntimeActive(simulation, runtime);

    const actionStart = emit(simulation, EVENT_TYPE.ACTION_START, {
      initiativeCycle: cycle,
      actorId: runtime.actorId,
      targetId: runtime.declaredPrimaryTargetId,
      payload: {
        declarationId: runtime.declarationId,
        actionId: runtime.actionId,
        actionKind: runtime.actionKind
      }
    });
    const castStart = emit(simulation, EVENT_TYPE.CAST_START, {
      initiativeCycle: cycle,
      actorId: runtime.actorId,
      targetId: runtime.declaredPrimaryTargetId,
      parentEventId: actionStart.eventId,
      payload: {
        completionDelayCycles: spec.completionDelayCycles,
        baseCompletionDelayCycles: baseSpec.completionDelayCycles,
        premonitionApplied: spec.completionDelayCycles !== baseSpec.completionDelayCycles,
        castStartCycle: cycle,
        completionCycle: runtime.completionCycle,
        castRange: spec.castRange,
        targetType: declarationForRuntime(simulation, runtime).target.type,
        groundLock: runtime.groundLock
      }
    });
    runtime.metadata.actionStartEventId = actionStart.eventId;
    runtime.metadata.castStartEventId = castStart.eventId;

    const spellbreak = consumeSpellbreakAgainstRuntime(simulation, runtime, { cycle, parentEventId: castStart.eventId });
    if (spellbreak.consumed && !spellbreak.echoFirstResolutionOnly) {
      interruptSpell(simulation, runtime.actorId, { cycle, reason: 'SPELLBREAK', parentEventId: spellbreak.consumed.eventId });
      simulation.trace.record('CAST_BROKEN_ON_START', { cycle, actorId: runtime.actorId, spellbreakEventId: spellbreak.consumed.eventId });
      started.push(runtime.actorId);
      continue;
    }

    simulation.trace.record('CAST_START', {
      cycle,
      actorId: runtime.actorId,
      runtimeId: runtime.runtimeId,
      completionDelayCycles: spec.completionDelayCycles,
      completionCycle: runtime.completionCycle,
      castRange: spec.castRange,
      eventId: castStart.eventId
    });
    started.push(runtime.actorId);
  }
  return started;
}

function spellTargetValidity(simulation, runtime, spec) {
  const actor = simulation.state.units[runtime.actorId];
  const declaration = declarationForRuntime(simulation, runtime);
  if (!actor || actor.lifeState !== LIFE_STATE.ALIVE) return { valid: false, reason: 'CASTER_DEAD' };

  switch (declaration.target.type) {
    case TARGET_TYPE.UNIT: {
      const target = simulation.state.units[runtime.targetLock?.unitId];
      if (!target) return { valid: false, reason: 'TARGET_DEAD_OR_MISSING' };
      const rosterRef = declaration.payload?.roster;
      const rosterAbility = rosterRef ? getAbility(rosterRef.archetypeId, rosterRef.abilityId) : null;
      if (rosterAbility?.deadTargetOnly === true) {
        if (target.lifeState !== LIFE_STATE.DEAD || target.side !== actor.side) return { valid: false, reason: 'TARGET_MUST_BE_KO_ALLY' };
      } else if (target.lifeState !== LIFE_STATE.ALIVE && !rosterAbility?.allowDeadTarget) {
        return { valid: false, reason: 'TARGET_DEAD_OR_MISSING' };
      }
      const distance = manhattanDistance(actor.position, target.position);
      if (distance > spec.castRange) return { valid: false, reason: 'OUT_OF_RANGE', distance };
      return { valid: true, target, distance };
    }
    case TARGET_TYPE.GROUND: {
      const ground = runtime.groundLock;
      if (!ground || !isInBounds(simulation.state.board, ground.row, ground.col)) return { valid: false, reason: 'GROUND_OUT_OF_BOUNDS' };
      const distance = manhattanDistance(actor.position, ground);
      if (distance > spec.castRange) return { valid: false, reason: 'OUT_OF_RANGE', distance };
      return { valid: true, ground, distance };
    }
    case TARGET_TYPE.SELF:
      return { valid: true, target: actor, distance: 0 };
    case TARGET_TYPE.ALL_ENEMIES:
    case TARGET_TYPE.ALL_ALLIES:
    case TARGET_TYPE.TEAM:
    case TARGET_TYPE.NONE:
      return { valid: true, distance: 0 };
    default:
      return { valid: false, reason: 'UNSUPPORTED_TARGET_TYPE' };
  }
}

function applyStage9SpellEffect(simulation, runtime, spec, validity, castCompleteEvent, cycle, { damageMultiplier = 1 } = {}) {
  if (!spec.effect) return [];
  if (spec.effect.type === 'ROSTER_EFFECTS') {
    const declaration = declarationForRuntime(simulation, runtime);
    const ref = declaration.payload?.roster;
    invariant(ref?.archetypeId && ref?.abilityId, 'ROSTER_EFFECTS requires payload.roster.');
    const ability = getAbility(ref.archetypeId, ref.abilityId);
    resolveRosterEffects(simulation, { actorId: runtime.actorId, ability, validity, cycle, parentEventId: castCompleteEvent.eventId, damageMultiplier });
    return [];
  }
  const emitted = [];
  if (spec.effect.type === 'DAMAGE' && validity.target) {
    const amount = Math.max(0, Math.trunc(spec.effect.amount ?? 0));
    const target = validity.target;
    const before = target.stats.hp;
    target.stats.hp = Math.max(0, target.stats.hp - amount);
    const damage = emit(simulation, EVENT_TYPE.DAMAGE, {
      initiativeCycle: cycle,
      actorId: runtime.actorId,
      targetId: target.unitId,
      parentEventId: castCompleteEvent.eventId,
      payload: { amount: before - target.stats.hp, hpBefore: before, hpAfter: target.stats.hp, source: 'SPELL' }
    });
    emitted.push(damage.eventId);
    if (target.stats.hp <= 0) {
      target.lifeState = LIFE_STATE.DEAD;
      const ko = emit(simulation, EVENT_TYPE.KO, {
        initiativeCycle: cycle,
        actorId: runtime.actorId,
        targetId: target.unitId,
        parentEventId: damage.eventId,
        payload: { position: target.position, source: 'SPELL' }
      });
      emitted.push(ko.eventId);
      interruptSpell(simulation, target.unitId, {
        cycle,
        reason: 'DEATH',
        parentEventId: ko.eventId
      });
    }
  }
  if (spec.effect.type === 'HEAL' && validity.target) {
    const amount = Math.max(0, Math.trunc(spec.effect.amount ?? 0));
    const target = validity.target;
    const before = target.stats.hp;
    const blockedByBleed = Boolean(findStatus(target, 'bleed'));
    if (!blockedByBleed) target.stats.hp = Math.min(target.stats.maxHP, target.stats.hp + amount);
    const heal = emit(simulation, EVENT_TYPE.HEAL, {
      initiativeCycle: cycle,
      actorId: runtime.actorId,
      targetId: target.unitId,
      parentEventId: castCompleteEvent.eventId,
      payload: { amount: target.stats.hp - before, hpBefore: before, hpAfter: target.stats.hp, source: 'SPELL', blockedByBleed }
    });
    emitted.push(heal.eventId);
  }
  if (spec.effect.type === 'AOE_DAMAGE') {
    const declaration = declarationForRuntime(simulation, runtime);
    const center = validity.ground ?? validity.target?.position ?? runtime.groundLock ?? simulation.state.units[runtime.actorId].position;
    const area = { ...(spec.area ?? spec.effect.area ?? { shape: AREA_SHAPE.SINGLE }), center };
    const amount = Math.max(0, Math.trunc(spec.effect.amount ?? 0));
    const targets = unitsInArea(simulation.state, runtime.actorId, area).filter((u) => u.unitId !== runtime.actorId || spec.effect.includeCaster);
    for (const target of targets) {
      if (spec.effect.hostileOnly !== false && target.side === simulation.state.units[runtime.actorId].side) continue;
      const before = target.stats.hp;
      target.stats.hp = Math.max(0, target.stats.hp - amount);
      const damage = emit(simulation, EVENT_TYPE.DAMAGE, {
        initiativeCycle: cycle, actorId: runtime.actorId, targetId: target.unitId, parentEventId: castCompleteEvent.eventId,
        payload: { amount: before - target.stats.hp, hpBefore: before, hpAfter: target.stats.hp, source: 'SPELL_AOE', areaShape: area.shape, center }
      });
      emitted.push(damage.eventId);
      if (target.stats.hp <= 0 && target.lifeState === LIFE_STATE.ALIVE) {
        target.lifeState = LIFE_STATE.DEAD;
        const ko = emit(simulation, EVENT_TYPE.KO, { initiativeCycle: cycle, actorId: runtime.actorId, targetId: target.unitId, parentEventId: damage.eventId, payload: { position: target.position, source: 'SPELL_AOE' } });
        emitted.push(ko.eventId);
        interruptSpell(simulation, target.unitId, { cycle, reason: 'DEATH', parentEventId: ko.eventId });
      }
    }
  }
  if (spec.effect.type === 'DISPLACE' && validity.target) {
    const distance = Math.max(0, Math.trunc(spec.effect.distance ?? 1));
    const anchor = simulation.state.units[runtime.actorId].position;
    const result = spec.effect.kind === 'PULL'
      ? pullUnit(simulation, validity.target.unitId, { sourceId: runtime.actorId, anchor, distance, cycle, parentEventId: castCompleteEvent.eventId })
      : pushUnit(simulation, validity.target.unitId, { sourceId: runtime.actorId, anchor, distance, cycle, parentEventId: castCompleteEvent.eventId });
    emitted.push(result.event.eventId);
  }
  return emitted;
}

function orderMaturedSpellRuntimes(simulation, runtimes, cycle) {
  const groups = new Map();
  for (const runtime of runtimes) {
    const qkn = simulation.state.units[runtime.actorId].stats.QKN;
    if (!groups.has(qkn)) groups.set(qkn, []);
    groups.get(qkn).push(runtime);
  }
  const qknValues = Array.from(groups.keys()).sort((a, b) => b - a);
  const ordered = [];
  for (const qkn of qknValues) {
    const group = groups.get(qkn).slice().sort((a, b) => a.actorId.localeCompare(b.actorId));
    for (let i = group.length - 1; i > 0; i -= 1) {
      const j = simulation.rng.nextInt(0, i, `SPELL_COMPLETION_QKN_TIE:C${cycle}:QKN${qkn}:slot${i}`);
      [group[i], group[j]] = [group[j], group[i]];
    }
    ordered.push(...group);
  }
  return ordered;
}

export function resolveMaturedSpells(simulation, cycle) {
  const matured = Object.values(simulation.runtimes).filter((runtime) =>
    runtime.actionKind === ACTION_KIND.SPELL &&
    runtime.state === ACTION_RUNTIME_STATE.CHARGING &&
    runtime.completionCycle === cycle
  );
  const ordered = orderMaturedSpellRuntimes(simulation, matured, cycle);
  const results = [];

  for (const runtime of ordered) {
    // A same-boundary earlier resolution may hard-control this caster and convert
    // its mutable runtime away from SPELL. Revalidate the live runtime before
    // treating the precomputed ordering snapshot as a spell completion.
    if (runtime.actionKind !== ACTION_KIND.SPELL ||
        runtime.state !== ACTION_RUNTIME_STATE.CHARGING ||
        runtime.completionCycle !== cycle) {
      simulation.trace.record('SPELL_COMPLETION_SKIPPED_AFTER_RUNTIME_MUTATION', {
        cycle, actorId: runtime.actorId, actionKind: runtime.actionKind, state: runtime.state, completionCycle: runtime.completionCycle
      });
      continue;
    }
    const caster = simulation.state.units[runtime.actorId];
    if (!caster || caster.lifeState !== LIFE_STATE.ALIVE) {
      const interrupted = interruptSpell(simulation, runtime.actorId, { cycle, reason: 'DEATH' });
      results.push({ actorId: runtime.actorId, result: SPELL_COMPLETION_RESULT.INTERRUPTED, reason: 'DEATH', eventId: interrupted.eventId ?? null });
      continue;
    }
    // Re-check Spellbreak at the exact completion boundary. A faster spell may
    // apply Spellbreak earlier in this same cycle; that must interrupt this
    // still-charging spell before its effects resolve.
    if (findStatus(caster, 'spellbreak')) {
      const spellbreak = consumeSpellbreakAgainstRuntime(simulation, runtime, { cycle, parentEventId: runtime.metadata?.castStartEventId ?? null });
      if (spellbreak.consumed && !spellbreak.echoFirstResolutionOnly) {
        const interrupted = interruptSpell(simulation, runtime.actorId, { cycle, reason: 'SPELLBREAK', parentEventId: spellbreak.consumed.eventId });
        results.push({ actorId: runtime.actorId, result: SPELL_COMPLETION_RESULT.INTERRUPTED, reason: 'SPELLBREAK', eventId: interrupted.eventId ?? null });
        continue;
      }
    }
    const spec = getSpellSpec(simulation, runtime);
    const validity = spellTargetValidity(simulation, runtime, spec);
    if (!validity.valid) {
      runtime.state = ACTION_RUNTIME_STATE.COMPLETED;
      runtime.completed = true;
      runtime.metadata.fizzled = true;
      runtime.metadata.fizzleReason = validity.reason;
      const fizzle = emit(simulation, EVENT_TYPE.CAST_FIZZLE, {
        initiativeCycle: cycle,
        actorId: runtime.actorId,
        targetId: runtime.declaredPrimaryTargetId,
        parentEventId: runtime.metadata.castStartEventId,
        payload: { reason: validity.reason, distance: validity.distance ?? null, castRange: spec.castRange }
      });
      emit(simulation, EVENT_TYPE.ACTION_COMPLETE, {
        initiativeCycle: cycle,
        actorId: runtime.actorId,
        targetId: runtime.declaredPrimaryTargetId,
        parentEventId: fizzle.eventId,
        payload: { actionId: runtime.actionId, result: 'FIZZLE' }
      });
      simulation.trace.record('CAST_FIZZLE', { cycle, actorId: runtime.actorId, reason: validity.reason, eventId: fizzle.eventId });
      results.push({ actorId: runtime.actorId, result: SPELL_COMPLETION_RESULT.FIZZLE, reason: validity.reason });
      continue;
    }

    runtime.state = ACTION_RUNTIME_STATE.COMPLETED;
    runtime.completed = true;
    runtime.metadata.fizzled = false;
    const declaration = declarationForRuntime(simulation, runtime);
    const rosterRef = declaration?.payload?.roster;
    const rosterAbility = rosterRef ? getAbility(rosterRef.archetypeId, rosterRef.abilityId) : null;
    const echoStatus = rosterAbility?.id !== 'ARCANE_ECHO' ? findStatus(caster, 'arcane_echo') : null;
    const complete = emit(simulation, EVENT_TYPE.CAST_COMPLETE, {
      initiativeCycle: cycle,
      actorId: runtime.actorId,
      targetId: runtime.declaredPrimaryTargetId,
      parentEventId: runtime.metadata.castStartEventId,
      payload: {
        completionDelayCycles: spec.completionDelayCycles,
        castStartCycle: runtime.castStartCycle,
        completionCycle: cycle,
        castRange: spec.castRange,
        distanceAtCompletion: validity.distance ?? null,
        groundLock: runtime.groundLock,
        casterPositionAtCompletion: caster.position ? { ...caster.position } : null,
        targetPositionAtCompletion: validity.target?.position ? { ...validity.target.position } : (validity.ground ? { ...validity.ground } : null),
        effectType: spec.effect?.type ?? null,
        areaShape: spec.area?.shape ?? spec.effect?.area?.shape ?? null,
        resolutionCount: echoStatus ? 2 : 1,
        echoed: !!echoStatus
      }
    });
    let effectEventIds = [];
    if (echoStatus) {
      removeStatus(caster, 'arcane_echo');
      emit(simulation, EVENT_TYPE.STATUS_REMOVE, {
        initiativeCycle: cycle,
        actorId: runtime.actorId,
        targetId: runtime.actorId,
        parentEventId: complete.eventId,
        payload: { key: 'arcane_echo', reason: 'CONSUMED_BY_NEXT_SPELL', abilityId: rosterAbility?.id ?? runtime.actionId }
      });
      const suppressFirstResolution = runtime.metadata.spellbreakSuppressFirstResolution === true;
      for (let resolutionIndex = 1; resolutionIndex <= 2; resolutionIndex += 1) {
        const spellbroken = suppressFirstResolution && resolutionIndex === 1;
        const resolution = emit(simulation, EVENT_TYPE.SPELL_RESOLUTION, {
          initiativeCycle: cycle,
          actorId: runtime.actorId,
          targetId: runtime.declaredPrimaryTargetId,
          parentEventId: complete.eventId,
          payload: {
            actionId: runtime.actionId,
            abilityId: rosterAbility?.id ?? runtime.actionId,
            resolutionIndex,
            resolutionCount: 2,
            echoed: true,
            spellbroken,
            damageMultiplier: resolutionIndex === 2 ? 1.5 : 1,
            groundLock: runtime.groundLock,
            casterPositionAtCompletion: caster.position ? { ...caster.position } : null,
            targetPositionAtCompletion: validity.target?.position ? { ...validity.target.position } : (validity.ground ? { ...validity.ground } : null),
            effectType: spec.effect?.type ?? null,
            areaShape: spec.area?.shape ?? spec.effect?.area?.shape ?? null
          }
        });
        effectEventIds.push(resolution.eventId);
        if (!spellbroken) effectEventIds.push(...applyStage9SpellEffect(simulation, runtime, spec, validity, resolution, cycle, { damageMultiplier: resolutionIndex === 2 ? 1.5 : 1 }));
      }
      simulation.trace.record('ARCANE_ECHO_RESOLVE', { cycle, actorId: runtime.actorId, abilityId: rosterAbility?.id ?? runtime.actionId, resolutionCount: 2 });
    } else {
      effectEventIds = applyStage9SpellEffect(simulation, runtime, spec, validity, complete, cycle);
    }
    const actionComplete = emit(simulation, EVENT_TYPE.ACTION_COMPLETE, {
      initiativeCycle: cycle,
      actorId: runtime.actorId,
      targetId: runtime.declaredPrimaryTargetId,
      parentEventId: complete.eventId,
      payload: { actionId: runtime.actionId, result: 'COMPLETE' }
    });
    simulation.trace.record('CAST_COMPLETE', {
      cycle,
      actorId: runtime.actorId,
      completionDelayCycles: spec.completionDelayCycles,
      eventId: complete.eventId,
      effectEventIds,
      actionCompleteEventId: actionComplete.eventId
    });
    results.push({ actorId: runtime.actorId, result: SPELL_COMPLETION_RESULT.COMPLETE, eventId: complete.eventId, effectEventIds });
  }
  return results;
}


export function interruptChargingSpellsBySpellbreak(simulation, cycle = simulation.state.round.initiativeCycle) {
  const interrupted = [];
  const runtimes = Object.values(simulation.runtimes)
    .filter((runtime) => runtime.actionKind === ACTION_KIND.SPELL && runtime.state === ACTION_RUNTIME_STATE.CHARGING)
    .sort((a, b) => a.actorId.localeCompare(b.actorId));
  for (const runtime of runtimes) {
    const actor = simulation.state.units[runtime.actorId];
    if (!actor || !findStatus(actor, 'spellbreak')) continue;
    const consumed = consumeSpellbreakAgainstRuntime(simulation, runtime, { cycle, parentEventId: runtime.metadata?.castStartEventId ?? null });
    if (!consumed.consumed) continue;
    if (consumed.echoFirstResolutionOnly) {
      interrupted.push({ actorId: runtime.actorId, consumedEventId: consumed.consumed.eventId, result: { interrupted: false, reason: 'ARCANE_ECHO_FIRST_RESOLUTION_ONLY' } });
      continue;
    }
    const result = interruptSpell(simulation, runtime.actorId, { cycle, reason: 'SPELLBREAK', parentEventId: consumed.consumed.eventId });
    interrupted.push({ actorId: runtime.actorId, consumedEventId: consumed.consumed.eventId, result });
  }
  return interrupted;
}

export function interruptSpell(simulation, actorId, { cycle = simulation.state.round.initiativeCycle, reason = 'INTERRUPTED', parentEventId = null } = {}) {
  const runtime = runtimeForActor(simulation, actorId);
  if (!runtime || runtime.actionKind !== ACTION_KIND.SPELL || runtime.state !== ACTION_RUNTIME_STATE.CHARGING) {
    return { interrupted: false, reason: 'NOT_CHARGING' };
  }
  runtime.state = ACTION_RUNTIME_STATE.INTERRUPTED;
  runtime.interrupted = true;
  runtime.metadata.interruptReason = reason;
  const event = emit(simulation, EVENT_TYPE.CAST_INTERRUPT, {
    initiativeCycle: cycle,
    actorId,
    targetId: runtime.declaredPrimaryTargetId,
    parentEventId,
    payload: { reason, completionCycle: runtime.completionCycle }
  });
  emit(simulation, EVENT_TYPE.ACTION_INTERRUPT, {
    initiativeCycle: cycle,
    actorId,
    targetId: runtime.declaredPrimaryTargetId,
    parentEventId: event.eventId,
    payload: { reason, actionId: runtime.actionId }
  });
  simulation.trace.record('CAST_INTERRUPT', { cycle, actorId, reason, eventId: event.eventId });
  return { interrupted: true, eventId: event.eventId };
}

export function getNonTerminalSpellRuntimes(simulation) {
  return Object.values(simulation.runtimes).filter((runtime) =>
    runtime.actionKind === ACTION_KIND.SPELL &&
    !runtime.completed && !runtime.interrupted &&
    runtime.state !== ACTION_RUNTIME_STATE.IMPOSSIBLE
  );
}
