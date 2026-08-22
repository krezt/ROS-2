import { ACTION_KIND, DAMAGE_TYPE, EVENT_TYPE, LIFE_STATE } from './constants.js';
import { assertBattlefieldInvariants, cellKey, isCellOpen, isInBounds, manhattanDistance, markUnitDead } from './grid.js';
import { applyBleed, applyPoison, applyTimedStatus, STATUS_STACK } from './status-engine.js';
import { findStatus, removeStatus } from './status.js';
import { getAbility, getArchetype } from './roster.js';
import { applyControlEffect, CONTROL_TYPE } from './controls.js';
import { effectiveStat, incomingDamageMultiplier } from './modifiers.js';

const RESISTIBLE_STYLE_STATUS = new Set(['stun','silence','taunt','berserk','root','suppression','spellbreak','blind']);


function syncEventSequence(simulation) {
  simulation.state.round.eventSequence = simulation.events.length;
}

function emitRuleEvent(simulation, type, options) {
  const event = simulation.events.emit(type, options);
  syncEventSequence(simulation);
  return event;
}

function updateBattleOutcomeFromProc(state) {
  const livingA = Object.values(state.units).some((u) => u.side === 'A' && u.lifeState === LIFE_STATE.ALIVE && u.entityKind !== 'SUMMON');
  const livingB = Object.values(state.units).some((u) => u.side === 'B' && u.lifeState === LIFE_STATE.ALIVE && u.entityKind !== 'SUMMON');
  if (livingA && livingB) return;
  state.outcome.status = 'COMPLETE';
  state.outcome.winner = livingA ? 'A' : (livingB ? 'B' : null);
}

function procPerHitChance(proc) {
  if (Number.isFinite(proc?.chance)) return Math.max(0, Math.min(1, Number(proc.chance)));
  if (Number.isFinite(proc?.roundChance)) {
    const roundChance = Math.max(0, Math.min(1, Number(proc.roundChance)));
    const swings = Math.max(1, Math.trunc(proc.referenceSwings ?? 1));
    return 1 - Math.pow(1 - roundChance, 1 / swings);
  }
  return 1;
}

function procRoundCounter(simulation, actorId) {
  simulation.state.round.basicProcCounts ??= {};
  const counts = simulation.state.round.basicProcCounts;
  counts[actorId] = Math.max(0, Math.trunc(counts[actorId] ?? 0));
  return counts;
}

function rollProc(simulation, actorId, targetId, proc) {
  const counts = procRoundCounter(simulation, actorId);
  const max = Number.isFinite(proc?.maxPerRound) ? Math.max(0, Math.trunc(proc.maxPerRound)) : Infinity;
  if (counts[actorId] >= max) return false;
  const chance = procPerHitChance(proc);
  const triggered = chance >= 1 || simulation.rng.chance(chance, `BASIC_PROC:${proc?.label ?? proc?.key ?? proc?.type}:${actorId}->${targetId}`);
  if (triggered) counts[actorId] += 1;
  return triggered;
}

function procScaledRoll(simulation, actor, proc) {
  const min = Math.max(0, Math.trunc(proc.min ?? 0));
  const max = Math.max(min, Math.trunc(proc.max ?? min));
  const base = min === max ? min : simulation.rng.nextInt(min, max, `BASIC_PROC_POWER:${proc.label ?? proc.type}:${actor.unitId}`);
  const stat = proc.scalesWith === 'ATK' ? 'ATK' : proc.scalesWith === 'SDM' ? 'SDM' : null;
  return stat ? Math.max(0, Math.floor(base * Math.max(0, effectiveStat(actor, stat)) / 100)) : base;
}

function procDamage(simulation, actor, target, proc, { cycle, parentEventId, abilityId }) {
  let raw = procScaledRoll(simulation, actor, proc);
  const critChance = Math.max(0, Math.min(1, Number(actor.stats.CRIT ?? 0) + Number(proc.critBonus ?? 0)));
  const crit = proc.canCrit === false ? false : (critChance >= 1 || (critChance > 0 && simulation.rng.chance(critChance, `BASIC_PROC_CRIT:${proc.label ?? proc.type}:${actor.unitId}->${target.unitId}`)));
  if (crit) raw *= 2;
  const damageType = proc.damageType ?? DAMAGE_TYPE.MAGICAL;
  const defenseKey = damageType === DAMAGE_TYPE.MAGICAL ? 'RES' : 'DEF';
  const pen = Math.max(0, Math.min(1, Number(proc.defensePenetration ?? 0)));
  const mitigation = Math.max(0, Math.min(.95, (Math.max(0, effectiveStat(target, defenseKey)) / 100) * (1 - pen)));
  const beforeIncoming = Math.max(1, Math.floor(raw * (1 - mitigation)));
  const incomingMultiplier = incomingDamageMultiplier(target, damageType);
  const dealt = Math.max(0, Math.floor(beforeIncoming * incomingMultiplier));
  const hpBefore = target.stats.hp;
  target.stats.hp = Math.max(0, hpBefore - dealt);
  const damage = emitRuleEvent(simulation, EVENT_TYPE.DAMAGE, {
    initiativeCycle: cycle,
    actorId: actor.unitId,
    targetId: target.unitId,
    parentEventId,
    payload: {
      amount: dealt,
      abilityId,
      proc: true,
      procLabel: proc.label ?? 'Basic proc',
      hpBefore,
      hpAfter: target.stats.hp,
      damageType,
      rawDamage: raw,
      defensePenetration: pen,
      preIncomingDamage: beforeIncoming,
      incomingDamageMultiplier: incomingMultiplier,
      mitigated: Math.max(0, raw - dealt)
    }
  });
  if (crit) emitRuleEvent(simulation, EVENT_TYPE.CRIT, {
    initiativeCycle: cycle,
    actorId: actor.unitId,
    targetId: target.unitId,
    parentEventId: damage.eventId,
    payload: { multiplier: 2, abilityId, proc: true, procLabel: proc.label ?? 'Basic proc' }
  });
  let killed = false;
  if (target.stats.hp <= 0 && target.lifeState === LIFE_STATE.ALIVE) {
    markUnitDead(simulation.state, target.unitId);
    updateBattleOutcomeFromProc(simulation.state);
    killed = true;
    emitRuleEvent(simulation, EVENT_TYPE.KO, {
      initiativeCycle: cycle,
      actorId: actor.unitId,
      targetId: target.unitId,
      parentEventId: damage.eventId,
      payload: { corpsePosition: { ...target.position }, proc: true, procLabel: proc.label ?? 'Basic proc' }
    });
  }
  return { dealt, crit, killed, damageEventId: damage.eventId };
}

function procHealSelf(simulation, actor, proc, { cycle, parentEventId, abilityId }) {
  const amount = procScaledRoll(simulation, actor, proc);
  const hpBefore = actor.stats.hp;
  const blockedByBleed = Boolean(findStatus(actor, 'bleed'));
  if (!blockedByBleed) actor.stats.hp = Math.min(actor.stats.maxHP, hpBefore + amount);
  const healed = actor.stats.hp - hpBefore;
  emitRuleEvent(simulation, EVENT_TYPE.HEAL, {
    initiativeCycle: cycle,
    actorId: actor.unitId,
    targetId: actor.unitId,
    parentEventId,
    payload: { amount: healed, abilityId, proc: true, procLabel: proc.label ?? 'Basic proc', hpBefore, hpAfter: actor.stats.hp, blockedByBleed }
  });
  return healed;
}

export const COUNTERSTANCE_PROFILES = Object.freeze({
  FREE_COUNTERS: Object.freeze({ profile: 'FREE_COUNTERS', attackCost: 0, allowPursuit: false, pursuitMoveMax: 0 }),
  PURSUIT: Object.freeze({ profile: 'PURSUIT', attackCost: 1, allowPursuit: true, pursuitMoveMax: 2 }),
  HYBRID: Object.freeze({ profile: 'HYBRID', attackCost: 0, allowPursuit: true, pursuitMoveMax: 2 })
});

function runtimeForActor(simulation, actorId) {
  return Object.values(simulation.runtimes).find((r) => r.actorId === actorId) ?? null;
}

function declarationForActor(simulation, actorId) {
  const runtime = runtimeForActor(simulation, actorId);
  return simulation.declarations.find((d) => d.declarationId === runtime?.declarationId) ?? null;
}

export function declaredRosterAbility(simulation, actorId) {
  const declaration = declarationForActor(simulation, actorId);
  const ref = declaration?.payload?.roster;
  if (!ref) return null;
  return getAbility(ref.archetypeId, ref.abilityId);
}

export function abilityForRuntime(simulation, runtime) {
  const declaration = simulation.declarations.find((d) => d.declarationId === runtime?.declarationId);
  const ref = declaration?.payload?.roster;
  return ref ? getAbility(ref.archetypeId, ref.abilityId) : null;
}


function baseAttackAbilityForActor(simulation, actorId) {
  const actor = simulation.state.units[actorId];
  if (!actor?.archetypeId) return null;
  let archetype;
  try { archetype = getArchetype(actor.archetypeId); } catch { return null; }
  return archetype.abilities.find((ability) => ability.actionKind === ACTION_KIND.BASIC_ATTACK && !ability.basicStyle) ??
    archetype.abilities.find((ability) => ability.actionKind === ACTION_KIND.BASIC_ATTACK) ?? null;
}

function isPlainBasicAttackReason(attackReason, runtime) {
  return attackReason === 'COUNTER' || Boolean(runtime?.metadata?.forcedByControl);
}

export function runtimeBypassesHardControl(simulation, runtime) {
  return abilityForRuntime(simulation, runtime)?.hardControlBypass === true;
}

/** Apply declaration-scoped basic-attack styles exactly once per round simulation. */
export function prepareRoundRuleOverrides(simulation) {
  for (const runtime of Object.values(simulation.runtimes).sort((a,b)=>a.actorId.localeCompare(b.actorId))) {
    if (runtime.metadata?.ruleOverridesPrepared) continue;
    const ability = abilityForRuntime(simulation, runtime);
    const style = ability?.basicStyle ?? null;
    runtime.metadata.ruleOverridesPrepared = true;
    if (!style) continue;
    const actor = simulation.state.units[runtime.actorId];
    if (!actor || actor.lifeState !== LIFE_STATE.ALIVE) continue;

    const before = {
      movementRemaining: actor.resources.movementRemaining,
      attacksRemaining: actor.resources.attacksRemaining
    };
    if (Number.isFinite(style.movementMultiplier)) {
      actor.resources.movementRemaining = Math.max(0, Math.floor(actor.resources.movementRemaining * style.movementMultiplier));
    }
    if (Number.isInteger(style.attacksSet)) {
      actor.resources.attacksRemaining = Math.max(0, Math.min(actor.resources.attacksRemaining, style.attacksSet));
    } else if (Number.isFinite(style.attacksFractionOfMax)) {
      actor.resources.attacksRemaining = Math.max(0, Math.min(actor.resources.attacksRemaining, Math.floor(actor.resources.attacksMax * Math.max(0, Number(style.attacksFractionOfMax)))));
    } else if (Number.isInteger(style.attacksDelta)) {
      actor.resources.attacksRemaining = Math.max(0, actor.resources.attacksRemaining + style.attacksDelta);
    } else if (Number.isFinite(style.attacksMultiplier)) {
      actor.resources.attacksRemaining = Math.max(0, Math.floor(actor.resources.attacksRemaining * style.attacksMultiplier));
    }
    runtime.metadata.basicStyle = structuredClone(style);
    runtime.metadata.basicStyleReadyCycle = simulation.state.round.initiativeCycle + Math.max(0, Math.trunc(style.startupDelayCycles ?? 0));
    runtime.metadata.basicStylePrimedInvisible = style.captureInvisibilityAtStart === true && Boolean(findStatus(actor, 'invisible'));
    runtime.metadata.basicStyleSuccessfulHits = 0;
    simulation.trace.record('ROUND_BASIC_STYLE_APPLY', {
      actorId: runtime.actorId,
      actionId: ability.id,
      style,
      before,
      after: {
        movementRemaining: actor.resources.movementRemaining,
        attacksRemaining: actor.resources.attacksRemaining
      }
    });
  }
}

export function currentBasicStyle(simulation, actorId) {
  return runtimeForActor(simulation, actorId)?.metadata?.basicStyle ?? null;
}

export function basicDamageMultiplier(simulation, actorId) {
  return Number(currentBasicStyle(simulation, actorId)?.damageMultiplier ?? 1);
}

export function basicStyleReadyCycle(simulation, actorId) {
  const runtime=runtimeForActor(simulation, actorId);
  return Math.max(0, Math.trunc(runtime?.metadata?.basicStyleReadyCycle ?? 0));
}

export function basicStyleAttackContext(simulation, actorId, { attackReason = 'ORDINARY', distance = null } = {}) {
  const runtime=runtimeForActor(simulation, actorId);
  const plainBasic = isPlainBasicAttackReason(attackReason, runtime);
  const ability = plainBasic ? baseAttackAbilityForActor(simulation, actorId) : (runtime ? abilityForRuntime(simulation, runtime) : null);
  const style=plainBasic ? null : (runtime?.metadata?.basicStyle ?? null);
  const successfulHits=Math.max(0, Math.trunc(runtime?.metadata?.basicStyleSuccessfulHits ?? 0));
  const firstSuccessfulActive=Boolean(style?.firstSuccessfulHit && successfulHits===0);
  const primedInvisible=Boolean(runtime?.metadata?.basicStylePrimedInvisible);
  const baseDamageMultiplier = firstSuccessfulActive
      ? Number((primedInvisible ? style?.firstSuccessfulHit?.stealthDamageMultiplier : null) ?? style?.firstSuccessfulHit?.damageMultiplier ?? style?.damageMultiplier ?? 1)
      : Number(style?.damageMultiplier ?? 1);
  const distanceMultiplier = Number.isFinite(distance) && Number.isFinite(style?.distanceDamageBonusPerSquare)
      ? 1 + Math.max(0, Number(distance)) * Math.max(0, Number(style.distanceDamageBonusPerSquare))
      : 1;
  return Object.freeze({
    abilityId: ability?.id ?? (runtime?.metadata?.forcedByControl ? runtime.actionId : null), style, successfulHits, firstSuccessfulActive, primedInvisible, plainBasic,
    damageMultiplier: baseDamageMultiplier * distanceMultiplier,
    distanceMultiplier,
    critBonus:firstSuccessfulActive
      ? Number(style?.firstSuccessfulHit?.critBonus ?? 0) + (primedInvisible ? Number(style?.firstSuccessfulHit?.stealthCritBonus ?? 0) : 0)
      : Number(style?.critBonus ?? 0),
    defensePenetration:firstSuccessfulActive
      ? Number(style?.firstSuccessfulHit?.defensePenetration ?? style?.defensePenetration ?? 0)
      : Number(style?.defensePenetration ?? 0)
  });
}

export function recordBasicStyleSuccessfulHit(simulation, actorId) {
  const runtime=runtimeForActor(simulation, actorId);
  if(!runtime?.metadata?.basicStyle)return 0;
  runtime.metadata.basicStyleSuccessfulHits=Math.max(0,Math.trunc(runtime.metadata.basicStyleSuccessfulHits??0))+1;
  return runtime.metadata.basicStyleSuccessfulHits;
}

export function basicUsesOrdinaryKite(simulation, actorId) {
  return currentBasicStyle(simulation, actorId)?.ordinaryKite === true;
}

export function effectiveCritMultiplier(unit, explicitMultiplier = null) {
  const shadow = findStatus(unit, 'shadowstep_crit');
  if (shadow && Number.isFinite(shadow.data?.multiplier)) return Math.max(1, shadow.data.multiplier);
  if (Number.isFinite(explicitMultiplier)) return Math.max(1, explicitMultiplier);
  return 2;
}

export function blindWhiffChance(unit) {
  const blind = findStatus(unit, 'blind');
  if (!blind) return 0;
  return Math.max(0, Math.min(1, Number(blind.data?.whiffChance ?? 0.50)));
}



/** Numeric action-timing override. Premonition only affects actions that START while active. */
export function effectiveCompletionDelay(unit, baseDelay) {
  const base = Math.max(1, Math.trunc(baseDelay));
  const premonition = findStatus(unit, 'premonition');
  if (!premonition) return base;
  const reduction = Math.max(0, Math.trunc(premonition.data?.cycleReduction ?? 3));
  return Math.max(1, base - reduction);
}

/**
 * Shadowstep-style stealth can opt into breaking on the actor's first physical
 * attack without redefining global Invisibility. Returns whether stealth was
 * active before the attack and whether this attack consumed it.
 */
export function consumePhysicalAttackBreakingInvisibility(simulation, actorId, {
  cycle = simulation.state.round.initiativeCycle,
  parentEventId = null,
  reason = 'PHYSICAL_ATTACK'
} = {}) {
  const actor = simulation.state.units[actorId];
  const invisible = actor ? findStatus(actor, 'invisible') : null;
  const wasInvisible = Boolean(invisible);
  const breakOnPhysicalAttack = Boolean(invisible?.data?.breakOnPhysicalAttack);
  if (!actor || !breakOnPhysicalAttack) return { wasInvisible, consumed: false, status: invisible };
  const removed = removeStatus(actor, 'invisible');
  const event = simulation.events.emit(EVENT_TYPE.STATUS_REMOVE, {
    initiativeCycle: cycle,
    actorId,
    targetId: actorId,
    parentEventId,
    payload: {
      key: 'invisible',
      reason: 'PHYSICAL_ATTACK_REVEAL',
      trigger: reason,
      sourceAbility: removed?.data?.sourceAbility ?? null
    }
  });
  simulation.state.round.eventSequence = simulation.events.length;
  simulation.trace.record('PHYSICAL_ATTACK_BREAKS_INVISIBILITY', { cycle, actorId, reason, eventId: event.eventId });
  return { wasInvisible, consumed: true, status: removed, eventId: event.eventId };
}

export function counterRulesFor(unit) {
  if (findStatus(unit, 'bloodlust')) {
    return { disabled: true, reason: 'BLOODLUST_NO_COUNTER', attackCost: 1, allowPursuit: false, pursuitMoveMax: 0 };
  }
  const stance = findStatus(unit, 'counterstance');
  if (!stance) return { disabled: false, attackCost: 1, allowPursuit: false, pursuitMoveMax: 0, profile: null };
  const named = COUNTERSTANCE_PROFILES[stance.data?.profile] ?? null;
  return {
    disabled: false,
    attackCost: Math.max(0, Math.trunc(stance.data?.attackCost ?? named?.attackCost ?? 1)),
    allowPursuit: Boolean(stance.data?.allowPursuit ?? named?.allowPursuit ?? false),
    pursuitMoveMax: Math.max(0, Math.trunc(stance.data?.pursuitMoveMax ?? named?.pursuitMoveMax ?? 0)),
    profile: stance.data?.profile ?? named?.profile ?? 'CUSTOM'
  };
}

function emitStatusApply(simulation, actorId, targetId, key, duration, data, parentEventId, cycle) {
  const normalizedKey = String(key).toLowerCase();
  const control = { stun: CONTROL_TYPE.STUN, silence: CONTROL_TYPE.SILENCE, taunt: CONTROL_TYPE.TAUNT, berserk: CONTROL_TYPE.BERSERK }[normalizedKey];
  if (control) return applyControlEffect(simulation, targetId, { type: control, sourceId: actorId, duration, cycle, parentEventId });
  const stackingStatKeys = new Set(['atk_up','atk_down','sdm_up','sdm_down','def_up','def_down','res_up','res_down']);
  if (stackingStatKeys.has(normalizedKey)) {
    const target = simulation.state.units[targetId];
    const existing = findStatus(target, normalizedKey);
    const stacks = Math.min(5, Math.max(0, Math.trunc(existing?.data?.stacks ?? 0)) + 1);
    return applyTimedStatus(simulation, targetId, {
      key: normalizedKey, duration, sourceId: actorId, data: { ...(data ?? {}), stacks }, stack: STATUS_STACK.REFRESH, cycle, parentEventId
    });
  }
  return applyTimedStatus(simulation, targetId, {
    key: normalizedKey, duration, sourceId: actorId, data, stack: STATUS_STACK.REFRESH, cycle, parentEventId
  });
}

/** Apply declaration-scoped self statuses when a modified basic action actually starts. */
export function applyBasicStyleActionStartOverrides(simulation, actorId, {
  cycle = simulation.state.round.initiativeCycle,
  parentEventId = null
} = {}) {
  const runtime = runtimeForActor(simulation, actorId);
  const actor = simulation.state.units[actorId];
  const style = runtime?.metadata?.basicStyle ?? null;
  if (!runtime || !actor || !style || runtime.metadata.basicStyleStartOverridesApplied) return [];
  runtime.metadata.basicStyleStartOverridesApplied = true;
  const cfg = style.selfStatusOnStart;
  if (!cfg?.statusKey) return [];
  applyTimedStatus(simulation, actorId, {
    key: cfg.statusKey,
    duration: Math.max(1, Math.trunc(cfg.duration ?? 1)),
    sourceId: actorId,
    data: structuredClone(cfg.data ?? {}),
    stack: STATUS_STACK.REFRESH,
    cycle,
    parentEventId
  });
  return [cfg.statusKey];
}

/** Per-attack-attempt style hooks that should happen even on a miss/dodge. */
export function applyBasicAttackAttemptOverrides(simulation, {
  actorId,
  attackReason = 'ORDINARY',
  cycle = simulation.state.round.initiativeCycle,
  parentEventId = null
} = {}) {
  const runtime = runtimeForActor(simulation, actorId);
  const actor = simulation.state.units[actorId];
  const style = isPlainBasicAttackReason(attackReason, runtime) ? null : (runtime?.metadata?.basicStyle ?? null);
  if (!runtime || !actor || !style) return [];
  runtime.metadata.basicStyleAttempts = Math.max(0, Math.trunc(runtime.metadata.basicStyleAttempts ?? 0)) + 1;
  const out = [];
  if (runtime.metadata.basicStyleAttempts === 1 && style.selfOnFirstAttack?.statusKey) {
    const cfg = style.selfOnFirstAttack;
    applyTimedStatus(simulation, actorId, {
      key: cfg.statusKey,
      duration: Math.max(1, Math.trunc(cfg.duration ?? 1)),
      sourceId: actorId,
      data: structuredClone(cfg.data ?? {}),
      stack: STATUS_STACK.REFRESH,
      cycle,
      parentEventId
    });
    out.push(cfg.statusKey);
  }
  return out;
}

/** Per-successful-basic-hit style + imbue hooks. */
export function applyBasicHitOverrides(simulation, {
  actorId,
  targetId,
  dealt,
  crit = false,
  attackReason = 'ORDINARY',
  cycle = simulation.state.round.initiativeCycle,
  parentEventId = null
}) {
  if (!(dealt > 0)) return [];
  const actor = simulation.state.units[actorId];
  const target = simulation.state.units[targetId];
  if (!actor || !target || target.lifeState !== LIFE_STATE.ALIVE) return [];
  const applied = [];
  const runtime = runtimeForActor(simulation, actorId);
  const plainBasic = isPlainBasicAttackReason(attackReason, runtime);
  const style = plainBasic ? null : currentBasicStyle(simulation, actorId);
  const ability = plainBasic ? baseAttackAbilityForActor(simulation, actorId) : declaredRosterAbility(simulation, actorId);

  // Basic passive procs are data-driven. Legacy one-attack 75% procs use
  // roundChance/referenceSwings so ROS2's multi-swing economy does not turn them
  // into near-guaranteed multi-proc explosions.
  const basicProc = ability?.basicProc;
  if (basicProc && rollProc(simulation, actorId, targetId, basicProc)) {
    if (basicProc.type === 'STATUS') {
      emitStatusApply(simulation, actorId, targetId, basicProc.key, basicProc.duration ?? 1, { ...(basicProc.data ?? {}), proc:true, procLabel:basicProc.label ?? basicProc.key }, parentEventId, cycle);
      applied.push(basicProc.key);
    } else if (basicProc.type === 'STATUS_SELF') {
      emitStatusApply(simulation, actorId, actorId, basicProc.key, basicProc.duration ?? 1, { ...(basicProc.data ?? {}), proc:true, procLabel:basicProc.label ?? basicProc.key }, parentEventId, cycle);
      applied.push(basicProc.key);
    } else if (basicProc.type === 'HEAL_SELF') {
      procHealSelf(simulation, actor, basicProc, { cycle, parentEventId, abilityId: ability?.id ?? null });
      applied.push(`PROC:${basicProc.label ?? basicProc.type}`);
    } else if (basicProc.type === 'DAMAGE') {
      procDamage(simulation, actor, target, basicProc, { cycle, parentEventId, abilityId: ability?.id ?? null });
      applied.push(`PROC:${basicProc.label ?? basicProc.type}`);
    } else if (basicProc.type === 'LIFE_DRAIN') {
      const result = procDamage(simulation, actor, target, basicProc, { cycle, parentEventId, abilityId: ability?.id ?? null });
      if (result.dealt > 0) procHealSelf(simulation, actor, { ...basicProc, min: result.dealt, max: result.dealt, scalesWith: null }, { cycle, parentEventId: result.damageEventId, abilityId: ability?.id ?? null });
      applied.push(`PROC:${basicProc.label ?? basicProc.type}`);
    }
  }

  if (style?.onHit?.defenseShredPct) {
    const key = style.onHit.statusKey ?? 'rend_def_down';
    const existing = findStatus(target, key);
    const stacks = Math.min(5, Math.max(1, (existing?.data?.stacks ?? 0) + 1));
    applyTimedStatus(simulation, targetId, {
      key,
      duration: style.onHit.duration ?? 3,
      sourceId: actorId,
      data: { stacks, pctPerStack: style.onHit.defenseShredPct },
      stack: STATUS_STACK.REFRESH,
      cycle,
      parentEventId
    });
    applied.push(key);
  }
  if (style?.onHit?.statusKey && !style?.onHit?.defenseShredPct) {
    const chance = style.onHit.chance ?? 1;
    const landed = chance >= 1 || simulation.rng.chance(chance, `STYLE_PROC:${style.onHit.statusKey}:${actorId}->${targetId}`);
    if (landed) {
      emitStatusApply(simulation, actorId, targetId, style.onHit.statusKey, style.onHit.duration ?? 1, style.onHit.data ?? {}, parentEventId, cycle);
      applied.push(style.onHit.statusKey);
    } else if (RESISTIBLE_STYLE_STATUS.has(String(style.onHit.statusKey).toLowerCase())) {
      emitRuleEvent(simulation, EVENT_TYPE.BLOCK, {
        initiativeCycle: cycle, actorId: targetId, targetId, parentEventId,
        payload: { reason:'STATUS_RESIST', blockedStatusKey:String(style.onHit.statusKey).toLowerCase(), hostileSourceId:actorId }
      });
    }
  }

  const bleedImbue = findStatus(actor, 'bleed_imbue');
  if (bleedImbue) {
    const chance = Number(bleedImbue.data?.chance ?? 0.15);
    if (chance >= 1 || simulation.rng.chance(chance, `BLEED_IMBUE:${actorId}->${targetId}`)) {
      applyBleed(simulation, targetId, {
        duration: Math.max(1, Math.trunc(bleedImbue.data?.bleedDuration ?? 5)),
        pct: Number(bleedImbue.data?.pct ?? 0.15),
        sourceId: actorId,
        cycle,
        parentEventId
      });
      applied.push('bleed');
    }
  }

  const poisonImbue = findStatus(actor, 'poison_imbue');
  if (poisonImbue) {
    const ratio = Number(poisonImbue.data?.damageRatio ?? 0.65);
    applyPoison(simulation, targetId, Math.max(1, Math.floor(dealt * ratio)), {
      sourceId: actorId,
      cycle,
      parentEventId,
      abilityId: ability?.id ?? null
    });
    applied.push('poison');
  }
  return applied;
}

export function defensiveBuffKeys() {
  return new Set(['def_up','guard','magic_shield','divine_shield','physical_shield','shield_redirect','shift','counterstance']);
}

export function stripOneDefensiveBuff(simulation, actorId, targetId, { cycle, parentEventId = null } = {}) {
  const target = simulation.state.units[targetId];
  if (!target) return null;
  const keys = defensiveBuffKeys();
  const status = [...target.statuses].filter((s)=>keys.has(s.key)).sort((a,b)=>a.key.localeCompare(b.key))[0];
  if (!status) return null;
  removeStatus(target, status.key);
  const event = simulation.events.emit(EVENT_TYPE.STATUS_REMOVE, {
    initiativeCycle: cycle,
    actorId,
    targetId,
    parentEventId,
    payload: { key: status.key, reason: 'STRIP_DEFENSIVE_BUFF' }
  });
  simulation.state.round.eventSequence = simulation.events.length;
  return event;
}

export function teleportToRandomOpenCell(simulation, unitId, {
  cycle = simulation.state.round.initiativeCycle,
  parentEventId = null,
  reason = 'RANDOM_TELEPORT'
} = {}) {
  const unit = simulation.state.units[unitId];
  if (!unit || unit.lifeState !== LIFE_STATE.ALIVE || !unit.position) return null;
  const candidates = [];
  for (let row = 0; row < simulation.state.board.height; row += 1) {
    for (let col = 0; col < simulation.state.board.width; col += 1) {
      if (row === unit.position.row && col === unit.position.col) continue;
      if (isCellOpen(simulation.state, row, col, { ignoreUnitId: unitId })) candidates.push({ row, col });
    }
  }
  if (!candidates.length) return null;
  const to = candidates.length === 1 ? candidates[0] : simulation.rng.choose(candidates, `${reason}:${unitId}`);
  const from = { ...unit.position };
  delete simulation.state.board.occupancy[cellKey(from.row, from.col)];
  unit.position = { ...to };
  simulation.state.board.occupancy[cellKey(to.row, to.col)] = unitId;
  assertBattlefieldInvariants(simulation.state);
  const event = simulation.events.emit(EVENT_TYPE.TELEPORT, {
    initiativeCycle: cycle,
    actorId: unitId,
    targetId: unitId,
    parentEventId,
    payload: { reason, from, to: { ...to } }
  });
  simulation.state.round.eventSequence = simulation.events.length;
  simulation.trace.record('RANDOM_TELEPORT', { cycle, unitId, reason, from, to, eventId: event.eventId });
  return { event, from, to };
}

/** Reactive defender hooks that occur after a successful melee hit but before counter eligibility. */
export function resolvePostMeleeHitOverrides(simulation, {
  attackerId,
  defenderId,
  dealt,
  cycle = simulation.state.round.initiativeCycle,
  parentEventId = null,
  source = 'BASIC_ATTACK'
}) {
  if (!(dealt > 0)) return [];
  const attacker = simulation.state.units[attackerId];
  const defender = simulation.state.units[defenderId];
  if (!attacker || !defender || defender.lifeState !== LIFE_STATE.ALIVE) return [];
  if (attacker.weapon?.mode !== 'MELEE') return [];
  const results = [];
  if (findStatus(defender, 'shift')) {
    const tele = teleportToRandomOpenCell(simulation, defenderId, { cycle, parentEventId, reason: 'SHIFT_MELEE_REACTION' });
    if (tele) results.push({ type: 'SHIFT', ...tele });
  }
  return results;
}

/** Determine whether a successful melee hit should be intercepted by Shieldwall. */
export function resolveShieldwallIntercept(simulation, attackerId, intendedTargetId, {
  cycle = simulation.state.round.initiativeCycle,
  parentEventId = null
} = {}) {
  const attacker = simulation.state.units[attackerId];
  const target = simulation.state.units[intendedTargetId];
  if (!attacker || !target || attacker.weapon?.mode !== 'MELEE') return { targetId: intendedTargetId, intercepted: false };
  const interceptors = Object.values(simulation.state.units)
    .filter((u)=>u.side===target.side && u.unitId!==target.unitId && u.unitId!==attackerId && u.lifeState===LIFE_STATE.ALIVE)
    .map((u)=>({ unit:u, status:findStatus(u,'shield_redirect') }))
    .filter((x)=>x.status && (x.status.data?.remaining ?? 0) > 0)
    .sort((a,b)=>a.unit.unitId.localeCompare(b.unit.unitId));
  if (!interceptors.length) return { targetId: intendedTargetId, intercepted: false };
  const { unit: interceptor, status } = interceptors[0];
  status.data.remaining = Math.max(0, Math.trunc(status.data.remaining ?? 0) - 1);
  const event = simulation.events.emit(EVENT_TYPE.INTERCEPT, {
    initiativeCycle: cycle,
    actorId: interceptor.unitId,
    targetId: intendedTargetId,
    parentEventId,
    payload: { attackerId, intendedTargetId, interceptorId: interceptor.unitId, remaining: status.data.remaining }
  });
  simulation.state.round.eventSequence = simulation.events.length;
  if (status.data.remaining <= 0) {
    removeStatus(interceptor,'shield_redirect');
    const expired = simulation.events.emit(EVENT_TYPE.STATUS_EXPIRE, {
      initiativeCycle: cycle, actorId: interceptor.unitId, targetId: interceptor.unitId, parentEventId:event.eventId,
      payload:{key:'shield_redirect',reason:'INTERCEPTS_EXHAUSTED'}
    });
    simulation.state.round.eventSequence = simulation.events.length;
  }
  return { targetId: interceptor.unitId, intercepted: true, interceptorId: interceptor.unitId, eventId: event.eventId };
}
