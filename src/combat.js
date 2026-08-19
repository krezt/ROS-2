import { ACTION_KIND, ACTION_RUNTIME_STATE, DAMAGE_TYPE, EVENT_TYPE, LIFE_STATE, RETARGET_POLICY, WEAPON_BEHAVIOR } from './constants.js';
import { invariant } from './errors.js';
import { markUnitDead, manhattanDistance } from './grid.js';
import { canAcquireDirectHostileTarget } from './targeting.js';
import { findStatus } from './status.js';
import { effectiveStat, incomingDamageMultiplier } from './modifiers.js';
import { applyBasicAttackAttemptOverrides, applyBasicHitOverrides, basicDamageMultiplier, basicStyleAttackContext, basicUsesOrdinaryKite, blindWhiffChance, consumePhysicalAttackBreakingInvisibility, currentBasicStyle, effectiveCritMultiplier, recordBasicStyleSuccessfulHit, resolvePostMeleeHitOverrides, resolveShieldwallIntercept } from './rule-overrides.js';
import {
  advancePursuitOneStep,
  advanceRangeMaintenanceOneStep,
  advanceThreatRetreatOneStep,
  hasBeneficialRangeMaintenanceStep,
  hasLegalThreatRetreatStep,
  KITE_RESULT,
  PURSUIT_RESULT,
  RANGE_MAINTENANCE_RESULT
} from './movement.js';

export const COMBAT_ADVANCE_RESULT = Object.freeze({
  MOVED: 'MOVED',
  MOVED_AND_ATTACKED: 'MOVED_AND_ATTACKED',
  RANGE_MAINTAINED: 'RANGE_MAINTAINED',
  RANGE_MAINTAINED_AND_ATTACKED: 'RANGE_MAINTAINED_AND_ATTACKED',
  KITED: 'KITED',
  KITED_AND_ATTACKED: 'KITED_AND_ATTACKED',
  ATTACKED: 'ATTACKED',
  WAIT_ATTACK_INTERVAL: 'WAIT_ATTACK_INTERVAL',
  COMPLETED_NO_ATTACKS: 'COMPLETED_NO_ATTACKS',
  COMPLETED_TARGET_DEAD: 'COMPLETED_TARGET_DEAD',
  IMPOSSIBLE_NO_MOVEMENT: 'IMPOSSIBLE_NO_MOVEMENT',
  IMPOSSIBLE_NO_PATH: 'IMPOSSIBLE_NO_PATH',
  ACTOR_DEAD: 'ACTOR_DEAD',
  HOLD: 'HOLD',
  UNSUPPORTED_ACTION: 'UNSUPPORTED_ACTION',
  TERMINAL_RUNTIME: 'TERMINAL_RUNTIME'
});

export const ATTACK_OUTCOME = Object.freeze({
  HIT: 'HIT',
  MISS: 'MISS',
  DODGE: 'DODGE'
});

export const BASIC_COMBAT_RULES = Object.freeze({
  mitigationCap: 0.95,
  dodgeBase: 0.025,
  dodgeQknFactor: 0.003,
  dodgeCap: 0.25
});

function syncEventSequence(simulation) {
  simulation.state.round.eventSequence = simulation.events.length;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function requireUnit(state, unitId, label = 'unit') {
  const unit = state.units[unitId];
  invariant(unit, `Unknown ${label} unitId: ${unitId}`);
  return unit;
}

function emit(simulation, type, options) {
  const event = simulation.events.emit(type, options);
  syncEventSequence(simulation);
  return event;
}

export function isWithinWeaponRange(actor, target) {
  invariant(actor?.position && target?.position, 'Range check requires battlefield positions.');
  return manhattanDistance(actor.position, target.position) <= actor.weapon.weaponRange;
}

export function getPhysicalDodgeChance(defender, rules = BASIC_COMBAT_RULES) {
  return clamp(rules.dodgeBase + (defender.stats.QKN * rules.dodgeQknFactor), 0, rules.dodgeCap);
}

export function mitigationFraction(defender, damageType, defensePenetration = 0, rules = BASIC_COMBAT_RULES) {
  const pen = clamp(defensePenetration, 0, 1);
  const statKey = damageType === DAMAGE_TYPE.MAGICAL ? 'RES' : 'DEF';
  const directPct = Math.max(0, effectiveStat(defender, statKey));
  return clamp((directPct / 100) * (1 - pen), 0, rules.mitigationCap);
}

export function applyDamageMitigation(rawDamage, defender, damageType = DAMAGE_TYPE.PHYSICAL, defensePenetration = 0, rules = BASIC_COMBAT_RULES) {
  invariant(Number.isFinite(rawDamage) && rawDamage >= 0, 'rawDamage must be a non-negative number.');
  const reduction = mitigationFraction(defender, damageType, defensePenetration, rules);
  return Math.max(1, Math.floor(rawDamage * (1 - reduction)));
}

export function applyPhysicalDefense(rawDamage, defender, defensePenetration = 0, rules = BASIC_COMBAT_RULES) {
  return applyDamageMitigation(rawDamage, defender, DAMAGE_TYPE.PHYSICAL, defensePenetration, rules);
}

export function applyMagicalResistance(rawDamage, defender, defensePenetration = 0, rules = BASIC_COMBAT_RULES) {
  return applyDamageMitigation(rawDamage, defender, DAMAGE_TYPE.MAGICAL, defensePenetration, rules);
}

function rollBasePower(simulation, actor) {
  const min = actor.weapon.attackBaseMin;
  const max = actor.weapon.attackBaseMax;
  if (min === max) return min;
  return simulation.rng.nextInt(min, max, `BASIC_DAMAGE:${actor.unitId}`);
}

function rollAccuracy(simulation, actor, target) {
  const blindChance = actor.weapon.damageType === DAMAGE_TYPE.PHYSICAL ? blindWhiffChance(actor) : 0;
  if (blindChance > 0 && simulation.rng.chance(blindChance, `BLIND_WHIF:${actor.unitId}->${target.unitId}`)) return false;
  const accuracy = clamp(actor.weapon.accuracy, 0, 1);
  if (accuracy >= 1) return true;
  if (accuracy <= 0) return false;
  return simulation.rng.chance(accuracy, `BASIC_ACCURACY:${actor.unitId}->${target.unitId}`);
}

function rollDodge(simulation, actor, target) {
  if (actor.weapon.damageType !== DAMAGE_TYPE.PHYSICAL || !actor.weapon.dodgeable) return false;
  const chance = getPhysicalDodgeChance(target);
  if (chance <= 0) return false;
  return simulation.rng.chance(chance, `BASIC_DODGE:${target.unitId}<-${actor.unitId}`);
}

function rollCrit(simulation, actor, target, bonus = 0) {
  const probability = clamp(actor.stats.CRIT + actor.weapon.critBonus + Number(bonus ?? 0), 0, 1);
  if (probability <= 0) return false;
  if (probability >= 1) return true;
  return simulation.rng.chance(probability, `BASIC_CRIT:${actor.unitId}->${target.unitId}`);
}

function updateBattleOutcome(state) {
  const livingA = Object.values(state.units).some((u) => u.side === 'A' && u.lifeState === LIFE_STATE.ALIVE && u.entityKind !== 'SUMMON');
  const livingB = Object.values(state.units).some((u) => u.side === 'B' && u.lifeState === LIFE_STATE.ALIVE && u.entityKind !== 'SUMMON');
  if (livingA && livingB) return;
  state.outcome.status = 'COMPLETE';
  state.outcome.winner = livingA ? 'A' : (livingB ? 'B' : null);
}

/**
 * Resolve one normal basic attack. This is pure simulation: all consequences
 * happen synchronously and presentation will replay the resulting events.
 *
 * Counter generation intentionally belongs to Stage 7. Stage 5 only resolves
 * the attack itself and its immediate hit/dodge/crit/damage/death results.
 */
function maybeTerminateBasicStyleAfterAttempt(simulation, actorId, attackReason) {
  if (attackReason === 'COUNTER') return false;
  const runtime = Object.values(simulation.runtimes).find((r) => r.actorId === actorId) ?? null;
  const limit = runtime?.metadata?.basicStyle?.ordinaryAttackLimit;
  if (!runtime || !Number.isInteger(limit) || limit < 1) return false;
  const attempts = Math.max(0, Math.trunc(runtime.metadata.basicStyleAttempts ?? 0));
  if (attempts < limit) return false;
  if (![ACTION_RUNTIME_STATE.COMPLETED, ACTION_RUNTIME_STATE.INTERRUPTED, ACTION_RUNTIME_STATE.IMPOSSIBLE].includes(runtime.state)) {
    markRuntimeTerminal(simulation, runtime, ACTION_RUNTIME_STATE.COMPLETED, 'BASIC_STYLE_ORDINARY_LIMIT_REACHED');
  }
  return true;
}

export function resolveBasicAttack(simulation, actorId, targetId, {
  cycle = simulation.state.round.initiativeCycle,
  parentEventId = null,
  ignoreAttackInterval = false,
  attackReason = 'ORDINARY',
  attackCost = 1,
  rangeOverride = null
} = {}) {
  const actor = requireUnit(simulation.state, actorId, 'attacker');
  const target = requireUnit(simulation.state, targetId, 'target');

  invariant(actor.lifeState === LIFE_STATE.ALIVE, 'Dead champion cannot attack.', { actorId });
  invariant(target.lifeState === LIFE_STATE.ALIVE, 'Cannot attack a dead target.', { targetId });
  invariant(Number.isInteger(attackCost) && attackCost >= 0, 'attackCost must be an integer >= 0.', { attackCost });
  if (attackCost > 0) invariant(actor.resources.attacksRemaining >= attackCost, 'Champion has no attacks remaining.', { actorId, attackCost, attacksRemaining: actor.resources.attacksRemaining });
  const effectiveWeaponRange = Number.isFinite(rangeOverride) ? Math.max(0, Number(rangeOverride)) : actor.weapon.weaponRange;
  invariant(manhattanDistance(actor.position, target.position) <= effectiveWeaponRange, 'Target is outside weapon range.', {
    actorId,
    targetId,
    weaponRange: effectiveWeaponRange,
    baseWeaponRange: actor.weapon.weaponRange,
    rangeOverride: Number.isFinite(rangeOverride) ? rangeOverride : null,
    distance: manhattanDistance(actor.position, target.position)
  });
  if (!ignoreAttackInterval) {
    invariant(cycle >= actor.resources.nextOrdinaryAttackCycle,
      'Ordinary attack is not yet eligible under attackInterval.', {
        actorId,
        cycle,
        nextOrdinaryAttackCycle: actor.resources.nextOrdinaryAttackCycle
      });
  }

  const attackDistance = manhattanDistance(actor.position, target.position);
  const styleContext = basicStyleAttackContext(simulation, actorId, { attackReason, distance: attackDistance });
  const attacksBefore = actor.resources.attacksRemaining;
  const nextAttackBefore = actor.resources.nextOrdinaryAttackCycle;
  actor.resources.attacksRemaining -= attackCost;
  if (!ignoreAttackInterval) {
    actor.resources.nextOrdinaryAttackCycle = cycle + actor.resources.attackInterval;
  }

  const attackStart = emit(simulation, EVENT_TYPE.ATTACK_START, {
    initiativeCycle: cycle,
    actorId,
    targetId,
    parentEventId,
    payload: {
      attackReason,
      abilityId: styleContext.abilityId,
      weaponProfileId: actor.weapon.weaponProfileId,
      weaponRange: effectiveWeaponRange,
      baseWeaponRange: actor.weapon.weaponRange,
      rangeOverride: Number.isFinite(rangeOverride) ? rangeOverride : null,
      distance: manhattanDistance(actor.position, target.position),
      attacksBefore,
      attacksAfter: actor.resources.attacksRemaining,
      attackCost,
      attackInterval: actor.resources.attackInterval,
      nextOrdinaryAttackCycleBefore: nextAttackBefore,
      nextOrdinaryAttackCycleAfter: actor.resources.nextOrdinaryAttackCycle,
      ignoreAttackInterval
    }
  });

  consumePhysicalAttackBreakingInvisibility(simulation, actorId, {
    cycle,
    parentEventId: attackStart.eventId,
    reason: attackReason === 'COUNTER' ? 'COUNTER_ATTACK' : 'BASIC_ATTACK'
  });

  simulation.trace.record('BASIC_ATTACK_START', {
    cycle,
    actorId,
    targetId,
    attackReason,
    attackCost,
    attacksBefore,
    attacksAfter: actor.resources.attacksRemaining,
    nextOrdinaryAttackCycle: actor.resources.nextOrdinaryAttackCycle,
    eventId: attackStart.eventId
  });

  if (!rollAccuracy(simulation, actor, target)) {
    const miss = emit(simulation, EVENT_TYPE.MISS, {
      initiativeCycle: cycle,
      actorId,
      targetId,
      parentEventId: attackStart.eventId,
      payload: { attackReason, abilityId: styleContext.abilityId }
    });
    simulation.trace.record('BASIC_ATTACK_MISS', { cycle, actorId, targetId, eventId: miss.eventId });
    applyBasicAttackAttemptOverrides(simulation, { actorId, attackReason, cycle, parentEventId: miss.eventId });
    maybeTerminateBasicStyleAfterAttempt(simulation, actorId, attackReason);
    return Object.freeze({
      outcome: ATTACK_OUTCOME.MISS,
      actorId,
      targetId,
      dealt: 0,
      crit: false,
      killed: false,
      attackStartEventId: attackStart.eventId,
      attackReason,
      impactEventId: null
    });
  }

  if (rollDodge(simulation, actor, target)) {
    const dodge = emit(simulation, EVENT_TYPE.DODGE, {
      initiativeCycle: cycle,
      actorId,
      targetId,
      parentEventId: attackStart.eventId,
      payload: {
        attackReason,
        abilityId: styleContext.abilityId,
        dodgeChance: getPhysicalDodgeChance(target)
      }
    });
    simulation.trace.record('BASIC_ATTACK_DODGED', { cycle, actorId, targetId, eventId: dodge.eventId });
    applyBasicAttackAttemptOverrides(simulation, { actorId, attackReason, cycle, parentEventId: dodge.eventId });
    maybeTerminateBasicStyleAfterAttempt(simulation, actorId, attackReason);
    return Object.freeze({
      outcome: ATTACK_OUTCOME.DODGE,
      actorId,
      targetId,
      dealt: 0,
      crit: false,
      killed: false,
      attackStartEventId: attackStart.eventId,
      attackReason,
      impactEventId: null
    });
  }

  const intercept = resolveShieldwallIntercept(simulation, actorId, targetId, {
    cycle,
    parentEventId: attackStart.eventId
  });
  const damageTarget = intercept.intercepted ? requireUnit(simulation.state, intercept.targetId, 'interceptor') : target;
  const actualTargetId = damageTarget.unitId;
  const basePower = rollBasePower(simulation, actor);
  let rawDamage = Math.max(0, Math.floor(basePower * Math.max(0, effectiveStat(actor, 'ATK')) / 100));
  rawDamage = Math.max(0, Math.floor(rawDamage * (styleContext.damageMultiplier ?? basicDamageMultiplier(simulation, actorId))));
  const crit = rollCrit(simulation, actor, damageTarget, styleContext.critBonus);
  const critMultiplier = effectiveCritMultiplier(actor);
  if (crit) rawDamage = Math.floor(rawDamage * critMultiplier);

  const defensePenetration = Math.max(0, Math.min(1, Number(actor.weapon.defensePenetration ?? 0) + Number(styleContext.defensePenetration ?? 0)));
  let dealt = applyDamageMitigation(rawDamage, damageTarget, actor.weapon.damageType, defensePenetration);
  const preIncomingDamage = dealt;
  const incomingMultiplier = incomingDamageMultiplier(damageTarget, actor.weapon.damageType);
  dealt = Math.max(0, Math.floor(dealt * incomingMultiplier));

  const hpBefore = damageTarget.stats.hp;
  damageTarget.stats.hp = Math.max(0, damageTarget.stats.hp - dealt);

  const impact = emit(simulation, EVENT_TYPE.ATTACK_IMPACT, {
    initiativeCycle: cycle,
    actorId,
    targetId: actualTargetId,
    parentEventId: intercept.eventId ?? attackStart.eventId,
    payload: {
      attackReason,
      abilityId: styleContext.abilityId,
      intendedTargetId: targetId,
      intercepted: intercept.intercepted,
      damageType: actor.weapon.damageType,
      basePower,
      rawDamage,
      defensePenetration
    }
  });

  if (crit) {
    emit(simulation, EVENT_TYPE.CRIT, {
      initiativeCycle: cycle,
      actorId,
      targetId: actualTargetId,
      parentEventId: impact.eventId,
      payload: { multiplier: critMultiplier, abilityId: styleContext.abilityId }
    });
  }

  const damage = emit(simulation, EVENT_TYPE.DAMAGE, {
    initiativeCycle: cycle,
    actorId,
    targetId: actualTargetId,
    parentEventId: impact.eventId,
    payload: {
      amount: dealt,
      abilityId: styleContext.abilityId,
      hpBefore,
      hpAfter: damageTarget.stats.hp,
      damageType: actor.weapon.damageType,
      intendedTargetId: targetId,
      intercepted: intercept.intercepted,
      preIncomingDamage,
      incomingDamageMultiplier: incomingMultiplier,
      mitigated: Math.max(0, preIncomingDamage - dealt)
    }
  });

  applyBasicAttackAttemptOverrides(simulation, { actorId, attackReason, cycle, parentEventId: damage.eventId });
  maybeTerminateBasicStyleAfterAttempt(simulation, actorId, attackReason);
  if (attackReason !== 'COUNTER') recordBasicStyleSuccessfulHit(simulation, actorId);

  let killed = false;
  if (damageTarget.stats.hp <= 0) {
    markUnitDead(simulation.state, actualTargetId);
    updateBattleOutcome(simulation.state);
    killed = true;
    emit(simulation, EVENT_TYPE.KO, {
      initiativeCycle: cycle,
      actorId,
      targetId: actualTargetId,
      parentEventId: damage.eventId,
      payload: { corpsePosition: { ...damageTarget.position }, intendedTargetId: targetId }
    });
  }
  const onHitEffects = applyBasicHitOverrides(simulation, {
    actorId,
    targetId: actualTargetId,
    dealt,
    crit,
    attackReason,
    cycle,
    parentEventId: damage.eventId
  });
  const postHitReactions = resolvePostMeleeHitOverrides(simulation, {
    attackerId: actorId,
    defenderId: actualTargetId,
    dealt,
    cycle,
    parentEventId: damage.eventId,
    source: 'BASIC_ATTACK'
  });

  simulation.trace.record('BASIC_ATTACK_RESOLVED', {
    cycle,
    actorId,
    targetId,
    attackReason,
    basePower,
    rawDamage,
    dealt,
    crit,
    hpBefore,
    hpAfter: damageTarget.stats.hp,
    killed,
    impactEventId: impact.eventId,
    damageEventId: damage.eventId
  });

  return Object.freeze({
    outcome: ATTACK_OUTCOME.HIT,
    actorId,
    targetId: actualTargetId,
    intendedTargetId: targetId,
    dealt,
    crit,
    killed,
    onHitEffects,
    postHitReactions,
    attackStartEventId: attackStart.eventId,
    attackReason,
    impactEventId: impact.eventId,
    damageEventId: damage.eventId
  });
}

export function selectNearestInRangeEnemy(simulation, actorId, { reason = 'REPLACEMENT_TARGET' } = {}) {
  const actor = requireUnit(simulation.state, actorId, 'actor');
  const candidates = Object.values(simulation.state.units)
    .filter((unit) => unit.side !== actor.side && unit.lifeState === LIFE_STATE.ALIVE)
    .filter((unit) => canAcquireDirectHostileTarget(simulation.state, actorId, unit.unitId))
    .map((unit) => ({ unit, distance: manhattanDistance(actor.position, unit.position) }))
    .filter(({ distance }) => distance <= actor.weapon.weaponRange);

  if (candidates.length === 0) return null;
  const minDistance = Math.min(...candidates.map((x) => x.distance));
  const nearest = candidates
    .filter((x) => x.distance === minDistance)
    .map((x) => x.unit)
    .sort((a, b) => a.unitId.localeCompare(b.unitId));

  if (nearest.length === 1) return nearest[0].unitId;
  return simulation.rng.choose(nearest, `${reason}:${actorId}:D${minDistance}`).unitId;
}


export function selectRandomInRangeEnemy(simulation, actorId, { reason = 'RANDOM_REPLACEMENT_TARGET' } = {}) {
  const actor = requireUnit(simulation.state, actorId, 'actor');
  const candidates = Object.values(simulation.state.units)
    .filter((unit) => unit.side !== actor.side && unit.lifeState === LIFE_STATE.ALIVE)
    .filter((unit) => canAcquireDirectHostileTarget(simulation.state, actorId, unit.unitId))
    .filter((unit) => manhattanDistance(actor.position, unit.position) <= actor.weapon.weaponRange)
    .sort((a, b) => a.unitId.localeCompare(b.unitId));
  if (candidates.length === 0) return null;
  if (candidates.length === 1) return candidates[0].unitId;
  return simulation.rng.choose(candidates, `${reason}:${actorId}`).unitId;
}

export function selectReplacementTarget(simulation, actorId, { reason = 'REPLACEMENT_TARGET' } = {}) {
  const actor = requireUnit(simulation.state, actorId, 'actor');
  if (actor.weapon.retargetPolicy === RETARGET_POLICY.IN_RANGE_RANDOM) {
    return selectRandomInRangeEnemy(simulation, actorId, { reason });
  }
  return selectNearestInRangeEnemy(simulation, actorId, { reason });
}

export function isThrowingDaggerWeapon(actor) {
  return actor?.weapon?.behavior === WEAPON_BEHAVIOR.THROWING_DAGGER;
}

function markRuntimeTerminal(simulation, runtime, state, reason) {
  runtime.state = state;
  runtime.completed = state === ACTION_RUNTIME_STATE.COMPLETED;
  runtime.interrupted = state === ACTION_RUNTIME_STATE.INTERRUPTED;
  runtime.metadata.terminalReason = reason;
  const ids = new Set(simulation.state.round.activeRuntimeIds);
  ids.delete(runtime.runtimeId);
  simulation.state.round.activeRuntimeIds = Array.from(ids).sort();
  simulation.trace.record('ACTION_RUNTIME_TERMINAL', {
    actorId: runtime.actorId,
    runtimeId: runtime.runtimeId,
    state,
    reason
  });
}

function selectStyleAttackTarget(simulation, runtime, fallbackTargetId, { reason = 'STYLE_TARGET' } = {}) {
  const style = currentBasicStyle(simulation, runtime.actorId);
  if (style?.targetDistribution !== 'BALANCED_LIVING_ENEMIES') return fallbackTargetId;
  if (runtime.currentForcedTargetId) return fallbackTargetId; // hard control always wins.

  const actor = simulation.state.units[runtime.actorId];
  if (!actor) return fallbackTargetId;
  runtime.metadata.distributedTargetCounts ??= {};
  const counts = runtime.metadata.distributedTargetCounts;

  const declaredLockId = runtime.declaredPrimaryTargetId;
  const effectiveRange = Number.isFinite(style.attackRangeOverride) ? Math.max(0, Number(style.attackRangeOverride)) : actor.weapon.weaponRange;
  const candidates = Object.values(simulation.state.units)
    .filter((unit) => unit.side !== actor.side && unit.lifeState === LIFE_STATE.ALIVE)
    .filter((unit) => manhattanDistance(actor.position, unit.position) <= effectiveRange)
    .filter((unit) => unit.unitId === declaredLockId || canAcquireDirectHostileTarget(simulation.state, actor.unitId, unit.unitId))
    .sort((a, b) => a.unitId.localeCompare(b.unitId));
  if (!candidates.length) return fallbackTargetId;

  // The declared target receives the first covering shot when still legal.
  const shotsTaken = Object.values(counts).reduce((sum, n) => sum + Math.max(0, Math.trunc(n ?? 0)), 0);
  let chosen = null;
  if (shotsTaken === 0) {
    chosen = candidates.find((unit) => unit.unitId === fallbackTargetId) ?? candidates.find((unit) => unit.unitId === declaredLockId) ?? null;
  }
  if (!chosen) {
    const minCount = Math.min(...candidates.map((unit) => Math.max(0, Math.trunc(counts[unit.unitId] ?? 0))));
    const leastUsed = candidates.filter((unit) => Math.max(0, Math.trunc(counts[unit.unitId] ?? 0)) === minCount);
    chosen = leastUsed.length === 1
      ? leastUsed[0]
      : simulation.rng.choose(leastUsed, `${reason}:${runtime.actorId}:SHOT${shotsTaken + 1}:COUNT${minCount}`);
  }

  counts[chosen.unitId] = Math.max(0, Math.trunc(counts[chosen.unitId] ?? 0)) + 1;
  simulation.trace.record('BASIC_STYLE_TARGET_DISTRIBUTION', {
    actorId: runtime.actorId,
    actionId: runtime.actionId,
    chosenTargetId: chosen.unitId,
    shotNumber: shotsTaken + 1,
    counts: structuredClone(counts),
    livingCandidateIds: candidates.map((unit) => unit.unitId)
  });
  return chosen.unitId;
}

function styleAttackRangeOverride(simulation, actorId) {
  const value = currentBasicStyle(simulation, actorId)?.attackRangeOverride;
  return Number.isFinite(value) ? Math.max(0, Number(value)) : null;
}

function currentAttackTarget(simulation, runtime) {
  const actor = simulation.state.units[runtime.actorId];
  const forcedId = runtime.currentForcedTargetId;
  if (forcedId) {
    const forced = simulation.state.units[forcedId];
    if (forced?.lifeState === LIFE_STATE.ALIVE) return forcedId;
  }

  const primaryId = runtime.declaredPrimaryTargetId;
  const primary = primaryId ? simulation.state.units[primaryId] : null;
  if (primary?.lifeState === LIFE_STATE.ALIVE) return primaryId;

  return selectNearestInRangeEnemy(simulation, actor.unitId);
}

function emitMove(simulation, runtime, targetId, cycle, result) {
  const actor = simulation.state.units[runtime.actorId];
  const event = emit(simulation, EVENT_TYPE.MOVE, {
    initiativeCycle: cycle,
    actorId: actor.unitId,
    targetId,
    parentEventId: runtime.metadata.actionStartEventId ?? null,
    payload: {
      from: result.from,
      to: result.to,
      movementBefore: result.movementBefore,
      movementAfter: result.movementAfter,
      targetDistanceBefore: result.targetDistanceBefore,
      targetDistanceAfter: result.targetDistanceAfter,
      nowInRange: result.nowInRange,
      pursuitTargetId: targetId
    }
  });
  simulation.trace.record('ORDINARY_MOVE', {
    cycle,
    actorId: actor.unitId,
    targetId,
    qkn: actor.stats.QKN,
    from: result.from,
    to: result.to,
    movementBefore: result.movementBefore,
    movementAfter: result.movementAfter,
    targetDistanceAfter: result.targetDistanceAfter,
    nowInRange: result.nowInRange,
    eventId: event.eventId
  });
  return event;
}

function emitRangeMaintenanceMove(simulation, runtime, targetId, cycle, result) {
  const actor = simulation.state.units[runtime.actorId];
  const event = emit(simulation, EVENT_TYPE.MOVE, {
    initiativeCycle: cycle,
    actorId: actor.unitId,
    targetId,
    parentEventId: runtime.metadata.actionStartEventId ?? null,
    payload: {
      movementReason: 'RANGE_MAINTENANCE',
      from: result.from,
      to: result.to,
      movementBefore: result.movementBefore,
      movementAfter: result.movementAfter,
      targetDistanceBefore: result.targetDistanceBefore,
      targetDistanceAfter: result.targetDistanceAfter,
      preferredRange: result.preferredRange,
      weaponRange: result.weaponRange,
      atPreferredRange: result.atPreferredRange
    }
  });
  simulation.trace.record('RANGE_MAINTENANCE_MOVE', {
    cycle,
    actorId: actor.unitId,
    targetId,
    qkn: actor.stats.QKN,
    from: result.from,
    to: result.to,
    movementBefore: result.movementBefore,
    movementAfter: result.movementAfter,
    targetDistanceBefore: result.targetDistanceBefore,
    targetDistanceAfter: result.targetDistanceAfter,
    preferredRange: result.preferredRange,
    tieBroken: result.tieBroken,
    eventId: event.eventId
  });
  return event;
}


function emitKiteMove(simulation, runtime, targetId, cycle, result, { parentEventId = null, movementReason = 'THROWING_DAGGER_KITE' } = {}) {
  const actor = simulation.state.units[runtime.actorId];
  const event = emit(simulation, EVENT_TYPE.MOVE, {
    initiativeCycle: cycle,
    actorId: actor.unitId,
    targetId,
    parentEventId: parentEventId ?? runtime.metadata.actionStartEventId ?? null,
    payload: {
      movementReason,
      from: result.from,
      to: result.to,
      movementBefore: result.movementBefore,
      movementAfter: result.movementAfter,
      targetDistanceBefore: result.threatDistanceBefore,
      targetDistanceAfter: result.threatDistanceAfter,
      directRetreat: result.directRetreat,
      tieBroken: result.tieBroken
    }
  });
  simulation.trace.record('THROWING_DAGGER_KITE_MOVE', {
    cycle,
    actorId: actor.unitId,
    targetId,
    from: result.from,
    to: result.to,
    movementBefore: result.movementBefore,
    movementAfter: result.movementAfter,
    distanceBefore: result.threatDistanceBefore,
    distanceAfter: result.threatDistanceAfter,
    directRetreat: result.directRetreat,
    tieBroken: result.tieBroken,
    eventId: event.eventId
  });
  return event;
}

function maybeThrowingDaggerKite(simulation, runtime, targetId, cycle, { parentEventId = null, movementReason = 'THROWING_DAGGER_KITE' } = {}) {
  const actor = simulation.state.units[runtime.actorId];
  const throwingDagger = isThrowingDaggerWeapon(actor);
  if (!throwingDagger && !basicUsesOrdinaryKite(simulation, runtime.actorId)) return { moved: false, result: null, moveEvent: null };
  const styleRange = styleAttackRangeOverride(simulation, runtime.actorId);
  if (!throwingDagger && Number.isFinite(styleRange)) {
    const target = simulation.state.units[targetId];
    if (target && manhattanDistance(actor.position, target.position) >= styleRange) {
      return { moved: false, result: Object.freeze({ result: 'MAX_STYLE_RANGE' }), moveEvent: null };
    }
  }
  const retreat = advanceThreatRetreatOneStep(simulation.state, actor.unitId, targetId, { rng: simulation.rng });
  runtime.metadata.lastKiteResult = retreat.result;
  if (retreat.result !== KITE_RESULT.MOVE) return { moved: false, result: retreat, moveEvent: null };
  const moveEvent = emitKiteMove(simulation, runtime, targetId, cycle, retreat, { parentEventId, movementReason });
  return { moved: true, result: retreat, moveEvent };
}

/**
 * Used by the Stage-6 scheduler before attack dumping. This is intentionally a
 * pure query and consumes no RNG: if a real preferred-range move is still
 * possible, that movement remains meaningful and attackInterval must not be
 * collapsed yet.
 */
export function runtimeHasMeaningfulRangeMaintenance(simulation, runtime) {
  if (!runtime || runtime.actionKind !== ACTION_KIND.BASIC_ATTACK) return false;
  const actor = simulation.state.units[runtime.actorId];
  const targetId = runtime.currentForcedTargetId ?? runtime.declaredPrimaryTargetId;
  const target = simulation.state.units[targetId];
  if (!actor || !target) return false;
  if (actor.lifeState !== LIFE_STATE.ALIVE || target.lifeState !== LIFE_STATE.ALIVE) return false;
  if (actor.resources.attacksRemaining <= 0 || actor.resources.movementRemaining <= 0) return false;
  if (!isWithinWeaponRange(actor, target)) return false;
  if ((isThrowingDaggerWeapon(actor) || basicUsesOrdinaryKite(simulation, runtime.actorId)) && hasLegalThreatRetreatStep(simulation.state, actor.unitId, target.unitId)) return true;
  if (actor.weapon.mode !== 'MELEE') return false;
  return hasBeneficialRangeMaintenanceStep(simulation.state, actor.unitId, target.unitId);
}

/**
 * Stage-6 ordinary BASIC_ATTACK advancement. One proactive opportunity may:
 * - move one square; and, if that step establishes range and cadence permits,
 *   immediately make one normal attack;
 * - attack once when already in range;
 * - wait for attackInterval;
 * - terminate/impossible when no legal proactive work remains.
 */
export function advanceBasicCombatRuntime(simulation, actorId, {
  cycle = simulation.state.round.initiativeCycle
} = {}) {
  const actor = requireUnit(simulation.state, actorId, 'actor');
  const runtime = Object.values(simulation.runtimes).find((r) => r.actorId === actorId);
  invariant(runtime, `No runtime for actor: ${actorId}`);

  if (actor.lifeState !== LIFE_STATE.ALIVE) {
    markRuntimeTerminal(simulation, runtime, ACTION_RUNTIME_STATE.INTERRUPTED, 'ACTOR_DEAD');
    return Object.freeze({ actorId, runtimeId: runtime.runtimeId, result: COMBAT_ADVANCE_RESULT.ACTOR_DEAD, moved: false, attacked: false });
  }
  if (runtime.completed || runtime.interrupted || [ACTION_RUNTIME_STATE.COMPLETED, ACTION_RUNTIME_STATE.INTERRUPTED, ACTION_RUNTIME_STATE.IMPOSSIBLE].includes(runtime.state)) {
    return Object.freeze({ actorId, runtimeId: runtime.runtimeId, result: COMBAT_ADVANCE_RESULT.TERMINAL_RUNTIME, moved: false, attacked: false });
  }
  if (runtime.actionKind === ACTION_KIND.HOLD) {
    return Object.freeze({ actorId, runtimeId: runtime.runtimeId, result: COMBAT_ADVANCE_RESULT.HOLD, moved: false, attacked: false });
  }
  if (runtime.actionKind !== ACTION_KIND.BASIC_ATTACK) {
    return Object.freeze({ actorId, runtimeId: runtime.runtimeId, result: COMBAT_ADVANCE_RESULT.UNSUPPORTED_ACTION, moved: false, attacked: false });
  }

  runtime.metadata.lastOrdinaryCycle = cycle;

  if (actor.resources.attacksRemaining <= 0) {
    markRuntimeTerminal(simulation, runtime, ACTION_RUNTIME_STATE.COMPLETED, 'ATTACKS_EXHAUSTED');
    return Object.freeze({ actorId, runtimeId: runtime.runtimeId, result: COMBAT_ADVANCE_RESULT.COMPLETED_NO_ATTACKS, moved: false, attacked: false });
  }

  const forced = runtime.currentForcedTargetId ? simulation.state.units[runtime.currentForcedTargetId] : null;
  if (runtime.currentForcedTargetId && (!forced || forced.lifeState !== LIFE_STATE.ALIVE)) {
    runtime.currentForcedTargetId = null;
  }
  const primaryTargetId = runtime.currentForcedTargetId ?? runtime.declaredPrimaryTargetId;
  const primary = simulation.state.units[primaryTargetId];
  if (!primary || primary.lifeState !== LIFE_STATE.ALIVE) {
    const replacementId = selectReplacementTarget(simulation, actorId);
    if (!replacementId) {
      markRuntimeTerminal(simulation, runtime, ACTION_RUNTIME_STATE.COMPLETED, 'PRIMARY_TARGET_DEAD_NO_IN_RANGE_REPLACEMENT');
      return Object.freeze({ actorId, runtimeId: runtime.runtimeId, result: COMBAT_ADVANCE_RESULT.COMPLETED_TARGET_DEAD, moved: false, attacked: false });
    }
    if (cycle < actor.resources.nextOrdinaryAttackCycle) {
      return Object.freeze({
        actorId,
        runtimeId: runtime.runtimeId,
        result: COMBAT_ADVANCE_RESULT.WAIT_ATTACK_INTERVAL,
        moved: false,
        attacked: false,
        targetId: replacementId,
        nextOrdinaryAttackCycle: actor.resources.nextOrdinaryAttackCycle
      });
    }
    const attackTargetId = selectStyleAttackTarget(simulation, runtime, replacementId, { reason: 'IN_RANGE_REPLACEMENT_STYLE_TARGET' });
    const kite = maybeThrowingDaggerKite(simulation, runtime, attackTargetId, cycle, { movementReason: 'THROWING_DAGGER_RETARGET_KITE' });
    const attack = resolveBasicAttack(simulation, actorId, attackTargetId, {
      cycle,
      parentEventId: kite.moveEvent?.eventId ?? runtime.metadata.actionStartEventId ?? null,
      attackReason: 'IN_RANGE_REPLACEMENT',
      rangeOverride: styleAttackRangeOverride(simulation, actorId)
    });
    if (actor.resources.attacksRemaining <= 0) markRuntimeTerminal(simulation, runtime, ACTION_RUNTIME_STATE.COMPLETED, 'ATTACKS_EXHAUSTED');
    return Object.freeze({ actorId, runtimeId: runtime.runtimeId, result: kite.moved ? COMBAT_ADVANCE_RESULT.KITED_AND_ATTACKED : COMBAT_ADVANCE_RESULT.ATTACKED, moved: kite.moved, attacked: true, targetId: replacementId, moveEventId: kite.moveEvent?.eventId ?? null, kite: kite.result, attack });
  }

  const rangeOverride = styleAttackRangeOverride(simulation, actorId);
  const overrideAlreadyInRange = Number.isFinite(rangeOverride) && manhattanDistance(actor.position, primary.position) <= rangeOverride;
  const pursuit = overrideAlreadyInRange
    ? Object.freeze({ result: PURSUIT_RESULT.ALREADY_IN_RANGE })
    : advancePursuitOneStep(simulation.state, actorId, primary.unitId, { rng: simulation.rng, range: rangeOverride });
  runtime.metadata.lastPursuitResult = pursuit.result;

  if (pursuit.result === PURSUIT_RESULT.MOVE) {
    const moveEvent = emitMove(simulation, runtime, primary.unitId, cycle, pursuit);
    if (pursuit.nowInRange && cycle >= actor.resources.nextOrdinaryAttackCycle && actor.resources.attacksRemaining > 0) {
      const attackTargetId = selectStyleAttackTarget(simulation, runtime, primary.unitId, { reason: 'MOVE_AND_ATTACK_STYLE_TARGET' });
      const attack = resolveBasicAttack(simulation, actorId, attackTargetId, {
        cycle,
        parentEventId: moveEvent.eventId,
        attackReason: 'MOVE_AND_ATTACK',
        rangeOverride: styleAttackRangeOverride(simulation, actorId)
      });
      if (actor.resources.attacksRemaining <= 0) markRuntimeTerminal(simulation, runtime, ACTION_RUNTIME_STATE.COMPLETED, 'ATTACKS_EXHAUSTED');
      return Object.freeze({
        actorId,
        runtimeId: runtime.runtimeId,
        result: COMBAT_ADVANCE_RESULT.MOVED_AND_ATTACKED,
        moved: true,
        attacked: true,
        targetId: primary.unitId,
        moveEventId: moveEvent.eventId,
        attack
      });
    }
    return Object.freeze({
      actorId,
      runtimeId: runtime.runtimeId,
      result: COMBAT_ADVANCE_RESULT.MOVED,
      moved: true,
      attacked: false,
      targetId: primary.unitId,
      moveEventId: moveEvent.eventId
    });
  }

  if (pursuit.result === PURSUIT_RESULT.ALREADY_IN_RANGE) {
    // Stage 8: Throwing Dagger owns a weapon-specific pre-attack retreat rule.
    // It only kites when the ordinary attack is actually cadence-eligible; it
    // does not spend free movement during attackInterval cooldown cycles.
    if (isThrowingDaggerWeapon(actor) || basicUsesOrdinaryKite(simulation, actorId)) {
      if (cycle < actor.resources.nextOrdinaryAttackCycle) {
        return Object.freeze({
          actorId,
          runtimeId: runtime.runtimeId,
          result: COMBAT_ADVANCE_RESULT.WAIT_ATTACK_INTERVAL,
          moved: false,
          attacked: false,
          targetId: primary.unitId,
          nextOrdinaryAttackCycle: actor.resources.nextOrdinaryAttackCycle
        });
      }
      const attackTargetId = selectStyleAttackTarget(simulation, runtime, primary.unitId, { reason: 'KITE_STYLE_TARGET' });
      const kite = maybeThrowingDaggerKite(simulation, runtime, attackTargetId, cycle);
      const attack = resolveBasicAttack(simulation, actorId, attackTargetId, {
        cycle,
        parentEventId: kite.moveEvent?.eventId ?? runtime.metadata.actionStartEventId ?? null,
        attackReason: kite.moved ? 'THROWING_DAGGER_KITE_AND_ATTACK' : 'ORDINARY',
        rangeOverride: styleAttackRangeOverride(simulation, actorId)
      });
      if (actor.resources.attacksRemaining <= 0) markRuntimeTerminal(simulation, runtime, ACTION_RUNTIME_STATE.COMPLETED, 'ATTACKS_EXHAUSTED');
      return Object.freeze({
        actorId,
        runtimeId: runtime.runtimeId,
        result: kite.moved ? COMBAT_ADVANCE_RESULT.KITED_AND_ATTACKED : COMBAT_ADVANCE_RESULT.ATTACKED,
        moved: kite.moved,
        attacked: true,
        targetId: primary.unitId,
        moveEventId: kite.moveEvent?.eventId ?? null,
        kite: kite.result,
        attack
      });
    }

    // Stage 6: being inside weaponRange is not necessarily tactically settled.
    // If the actor is closer than preferredRange, spend at most one normal
    // Movement step attempting to restore favourable maximum reach BEFORE the
    // ordinary attack. This remains meaningful even while attackInterval is
    // cooling down because Movement and Attacks are independent resources.
    const maintenance = actor.weapon.mode === 'MELEE'
      ? advanceRangeMaintenanceOneStep(simulation.state, actorId, primary.unitId, { rng: simulation.rng })
      : Object.freeze({ result: RANGE_MAINTENANCE_RESULT.SATISFIED });
    runtime.metadata.lastRangeMaintenanceResult = maintenance.result;

    if (maintenance.result === RANGE_MAINTENANCE_RESULT.MOVE) {
      const moveEvent = emitRangeMaintenanceMove(simulation, runtime, primary.unitId, cycle, maintenance);

      if (cycle >= actor.resources.nextOrdinaryAttackCycle && actor.resources.attacksRemaining > 0) {
        const attackTargetId = selectStyleAttackTarget(simulation, runtime, primary.unitId, { reason: 'RANGE_MAINTENANCE_STYLE_TARGET' });
        const attack = resolveBasicAttack(simulation, actorId, attackTargetId, {
          cycle,
          parentEventId: moveEvent.eventId,
          attackReason: 'RANGE_MAINTENANCE_AND_ATTACK',
          rangeOverride: styleAttackRangeOverride(simulation, actorId)
        });
        if (actor.resources.attacksRemaining <= 0) markRuntimeTerminal(simulation, runtime, ACTION_RUNTIME_STATE.COMPLETED, 'ATTACKS_EXHAUSTED');
        return Object.freeze({
          actorId,
          runtimeId: runtime.runtimeId,
          result: COMBAT_ADVANCE_RESULT.RANGE_MAINTAINED_AND_ATTACKED,
          moved: true,
          attacked: true,
          targetId: primary.unitId,
          moveEventId: moveEvent.eventId,
          rangeMaintenance: maintenance,
          attack
        });
      }

      return Object.freeze({
        actorId,
        runtimeId: runtime.runtimeId,
        result: COMBAT_ADVANCE_RESULT.RANGE_MAINTAINED,
        moved: true,
        attacked: false,
        targetId: primary.unitId,
        moveEventId: moveEvent.eventId,
        rangeMaintenance: maintenance,
        nextOrdinaryAttackCycle: actor.resources.nextOrdinaryAttackCycle
      });
    }

    if (cycle < actor.resources.nextOrdinaryAttackCycle) {
      simulation.trace.record('ATTACK_INTERVAL_WAIT', {
        cycle,
        actorId,
        targetId: primary.unitId,
        nextOrdinaryAttackCycle: actor.resources.nextOrdinaryAttackCycle,
        rangeMaintenanceResult: maintenance.result
      });
      return Object.freeze({
        actorId,
        runtimeId: runtime.runtimeId,
        result: COMBAT_ADVANCE_RESULT.WAIT_ATTACK_INTERVAL,
        moved: false,
        attacked: false,
        targetId: primary.unitId,
        rangeMaintenanceResult: maintenance.result,
        nextOrdinaryAttackCycle: actor.resources.nextOrdinaryAttackCycle
      });
    }
    const attackTargetId = selectStyleAttackTarget(simulation, runtime, primary.unitId, { reason: 'ORDINARY_STYLE_TARGET' });
    const attack = resolveBasicAttack(simulation, actorId, attackTargetId, {
      cycle,
      parentEventId: runtime.metadata.actionStartEventId ?? null,
      attackReason: 'ORDINARY',
      rangeOverride: styleAttackRangeOverride(simulation, actorId)
    });
    if (actor.resources.attacksRemaining <= 0) markRuntimeTerminal(simulation, runtime, ACTION_RUNTIME_STATE.COMPLETED, 'ATTACKS_EXHAUSTED');
    return Object.freeze({
      actorId,
      runtimeId: runtime.runtimeId,
      result: COMBAT_ADVANCE_RESULT.ATTACKED,
      moved: false,
      attacked: true,
      targetId: primary.unitId,
      rangeMaintenanceResult: maintenance.result,
      attack
    });
  }

  if (pursuit.result === PURSUIT_RESULT.NO_ATTACKS) {
    markRuntimeTerminal(simulation, runtime, ACTION_RUNTIME_STATE.COMPLETED, 'ATTACKS_EXHAUSTED');
    return Object.freeze({ actorId, runtimeId: runtime.runtimeId, result: COMBAT_ADVANCE_RESULT.COMPLETED_NO_ATTACKS, moved: false, attacked: false });
  }
  if (pursuit.result === PURSUIT_RESULT.NO_MOVEMENT) {
    markRuntimeTerminal(simulation, runtime, ACTION_RUNTIME_STATE.IMPOSSIBLE, 'NO_MOVEMENT_OUT_OF_RANGE');
    return Object.freeze({ actorId, runtimeId: runtime.runtimeId, result: COMBAT_ADVANCE_RESULT.IMPOSSIBLE_NO_MOVEMENT, moved: false, attacked: false });
  }
  if (pursuit.result === PURSUIT_RESULT.NO_PATH) {
    markRuntimeTerminal(simulation, runtime, ACTION_RUNTIME_STATE.IMPOSSIBLE, 'NO_PATH_TO_PRIMARY_TARGET');
    return Object.freeze({ actorId, runtimeId: runtime.runtimeId, result: COMBAT_ADVANCE_RESULT.IMPOSSIBLE_NO_PATH, moved: false, attacked: false });
  }
  if (pursuit.result === PURSUIT_RESULT.TARGET_DEAD) {
    // Defensive fallback; target death is handled before pursuit above.
    const replacementId = selectReplacementTarget(simulation, actorId);
    if (!replacementId) {
      markRuntimeTerminal(simulation, runtime, ACTION_RUNTIME_STATE.COMPLETED, 'PRIMARY_TARGET_DEAD_NO_IN_RANGE_REPLACEMENT');
      return Object.freeze({ actorId, runtimeId: runtime.runtimeId, result: COMBAT_ADVANCE_RESULT.COMPLETED_TARGET_DEAD, moved: false, attacked: false });
    }
  }

  throw new Error(`Unhandled Stage-5 pursuit result: ${pursuit.result}`);
}

export function getNonTerminalBasicRuntimes(simulation) {
  return Object.values(simulation.runtimes).filter((runtime) => {
    if (runtime.actionKind !== ACTION_KIND.BASIC_ATTACK) return false;
    const actor = simulation.state.units[runtime.actorId];
    if (!actor || actor.lifeState !== LIFE_STATE.ALIVE) return false;
    return !runtime.completed
      && !runtime.interrupted
      && ![ACTION_RUNTIME_STATE.COMPLETED, ACTION_RUNTIME_STATE.INTERRUPTED, ACTION_RUNTIME_STATE.IMPOSSIBLE].includes(runtime.state);
  });
}

/**
 * End-of-round attack dump for ONE remaining meaningful proactive runtime.
 * attackInterval is intentionally ignored, but every attack is still resolved
 * atomically and callers may drain reactions between attacks in later stages.
 */
export function dumpRemainingBasicAttacks(simulation, runtime, {
  cycle = simulation.state.round.initiativeCycle,
  afterEachAttack = null
} = {}) {
  const actor = simulation.state.units[runtime.actorId];
  const attacks = [];
  if (!actor || actor.lifeState !== LIFE_STATE.ALIVE || runtime.actionKind !== ACTION_KIND.BASIC_ATTACK) return attacks;

  while (actor.resources.attacksRemaining > 0 && actor.lifeState === LIFE_STATE.ALIVE && !findStatus(actor, 'stun') && !runtime.interrupted && ![ACTION_RUNTIME_STATE.INTERRUPTED, ACTION_RUNTIME_STATE.IMPOSSIBLE].includes(runtime.state)) {
    let targetId = null;
    const primaryTargetId = runtime.currentForcedTargetId ?? runtime.declaredPrimaryTargetId;
    const primary = simulation.state.units[primaryTargetId];
    if (primary?.lifeState === LIFE_STATE.ALIVE && isWithinWeaponRange(actor, primary)) {
      targetId = primary.unitId;
    } else if (!primary || primary.lifeState !== LIFE_STATE.ALIVE) {
      targetId = selectReplacementTarget(simulation, actor.unitId, { reason: 'ATTACK_DUMP_REPLACEMENT' });
    }

    if (!targetId) break;
    targetId = selectStyleAttackTarget(simulation, runtime, targetId, { reason: 'ATTACK_DUMP_STYLE_TARGET' });
    const kite = maybeThrowingDaggerKite(simulation, runtime, targetId, cycle, { movementReason: 'THROWING_DAGGER_DUMP_KITE' });
    const attack = resolveBasicAttack(simulation, actor.unitId, targetId, {
      cycle,
      parentEventId: kite.moveEvent?.eventId ?? runtime.metadata.actionStartEventId ?? null,
      ignoreAttackInterval: true,
      attackReason: 'END_OF_ROUND_DUMP',
      rangeOverride: styleAttackRangeOverride(simulation, actor.unitId)
    });
    attacks.push(attack);
    afterEachAttack?.(attack);

    if (actor.resources.attacksRemaining <= 0) break;
  }

  if (actor.resources.attacksRemaining <= 0) {
    markRuntimeTerminal(simulation, runtime, ACTION_RUNTIME_STATE.COMPLETED, 'ATTACKS_EXHAUSTED_DURING_DUMP');
  } else {
    const primaryTargetId = runtime.currentForcedTargetId ?? runtime.declaredPrimaryTargetId;
    const primary = simulation.state.units[primaryTargetId];
    if (!primary || primary.lifeState !== LIFE_STATE.ALIVE) {
      const replacement = selectReplacementTarget(simulation, actor.unitId, { reason: 'POST_DUMP_REPLACEMENT_CHECK' });
      if (!replacement) markRuntimeTerminal(simulation, runtime, ACTION_RUNTIME_STATE.COMPLETED, 'NO_IN_RANGE_TARGET_AFTER_DUMP');
    }
  }

  simulation.trace.record('ATTACK_DUMP', {
    cycle,
    actorId: actor.unitId,
    attackCount: attacks.length,
    attacksRemaining: actor.resources.attacksRemaining
  });
  return attacks;
}

export function reconcileDeadActorRuntimes(simulation) {
  for (const runtime of Object.values(simulation.runtimes)) {
    const actor = simulation.state.units[runtime.actorId];
    if (!actor || actor.lifeState === LIFE_STATE.ALIVE) continue;
    if (runtime.completed || runtime.interrupted || [ACTION_RUNTIME_STATE.COMPLETED, ACTION_RUNTIME_STATE.INTERRUPTED, ACTION_RUNTIME_STATE.IMPOSSIBLE].includes(runtime.state)) continue;
    markRuntimeTerminal(simulation, runtime, ACTION_RUNTIME_STATE.INTERRUPTED, 'ACTOR_DEAD');
  }
}
