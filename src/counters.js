import { ACTION_RUNTIME_STATE, EVENT_TYPE, LIFE_STATE, WEAPON_BEHAVIOR } from './constants.js';
import { invariant } from './errors.js';
import { manhattanDistance } from './grid.js';
import { advanceCounterEscapeOneStep, advancePursuitOneStep, advanceThreatRetreatOneStep, COUNTER_ESCAPE_RESULT, KITE_RESULT, PURSUIT_RESULT } from './movement.js';
import { isWithinWeaponRange, resolveBasicAttack } from './combat.js';
import { hasControlStatus, CONTROL_TYPE } from './controls.js';
import { interruptSpell } from './spells.js';
import { counterRulesFor } from './rule-overrides.js';
import { isRooted, isSuppressed } from './counterplay.js';

export const REACTION_TYPE = Object.freeze({ COUNTER: 'COUNTER' });

function sync(simulation) { simulation.state.round.eventSequence = simulation.events.length; }
function emit(simulation, type, options) {
  const event = simulation.events.emit(type, options);
  sync(simulation);
  return event;
}

export function counterEligibility(simulation, defenderId, aggressorId) {
  const defenderRuntime = Object.values(simulation.runtimes).find((runtime) => runtime.actorId === defenderId) ?? null;
  const defender = simulation.state.units[defenderId];
  const aggressor = simulation.state.units[aggressorId];
  if (!defender || !aggressor) return { eligible: false, reason: 'MISSING_UNIT' };
  if (defender.lifeState !== LIFE_STATE.ALIVE) return { eligible: false, reason: 'DEFENDER_DEAD' };
  if (aggressor.lifeState !== LIFE_STATE.ALIVE) return { eligible: false, reason: 'AGGRESSOR_DEAD' };
  if (defenderRuntime?.state === ACTION_RUNTIME_STATE.CHARGING) return { eligible: false, reason: 'CASTING' };
  if (isSuppressed(defender)) return { eligible: false, reason: 'SUPPRESSED' };
  const rules = counterRulesFor(defender);
  if (rules.disabled) return { eligible: false, reason: rules.reason ?? 'COUNTER_DISABLED', rules };
  if (rules.attackCost > 0 && defender.resources.attacksRemaining < rules.attackCost) return { eligible: false, reason: 'NO_ATTACKS', rules };
  const distance = manhattanDistance(defender.position, aggressor.position);
  if (!isWithinWeaponRange(defender, aggressor)) {
    const maxReachAfterPursuit = defender.weapon.weaponRange + Math.min(rules.pursuitMoveMax, defender.resources.movementRemaining);
    if (!rules.allowPursuit || distance > maxReachAfterPursuit) {
      return { eligible: false, reason: 'AGGRESSOR_OUT_OF_RANGE', distance, rules };
    }
    return { eligible: true, reason: 'COUNTERSTANCE_PURSUIT_ELIGIBLE', distance, rules };
  }
  return { eligible: true, reason: 'ELIGIBLE', distance, rules };
}

export function enqueueCounterForAttack(scheduler, attack) {
  if (!attack || attack.attackReason === 'COUNTER') return null;
  const { simulation } = scheduler;
  const eligibility = counterEligibility(simulation, attack.targetId, attack.actorId);
  simulation.trace.record('COUNTER_ELIGIBILITY', {
    cycle: simulation.state.round.initiativeCycle,
    defenderId: attack.targetId,
    aggressorId: attack.actorId,
    attackStartEventId: attack.attackStartEventId,
    ...eligibility
  });
  if (!eligibility.eligible) return null;
  return scheduler.reactions.enqueue({
    type: REACTION_TYPE.COUNTER,
    actorId: attack.targetId,
    targetId: attack.actorId,
    parentEventId: attack.attackStartEventId,
    payload: { sourceAttackReason: attack.attackReason }
  });
}

export function resolveCounterReaction(reaction, { simulation, cycle }) {
  invariant(reaction.type === REACTION_TYPE.COUNTER, `Unsupported Stage-7 reaction: ${reaction.type}`);
  const defender = simulation.state.units[reaction.actorId];
  const aggressor = simulation.state.units[reaction.targetId];
  const eligibility = counterEligibility(simulation, reaction.actorId, reaction.targetId);
  if (!eligibility.eligible) {
    simulation.trace.record('COUNTER_CANCELLED', { cycle, reactionId: reaction.reactionId, defenderId: reaction.actorId, aggressorId: reaction.targetId, reason: eligibility.reason });
    return { resolved: false, reason: eligibility.reason };
  }

  const counterRules = eligibility.rules ?? counterRulesFor(defender);
  const counterEvent = emit(simulation, EVENT_TYPE.COUNTER, {
    initiativeCycle: cycle,
    actorId: defender.unitId,
    targetId: aggressor.unitId,
    parentEventId: reaction.parentEventId,
    payload: {
      reactionId: reaction.reactionId,
      attacksBefore: defender.resources.attacksRemaining,
      movementBefore: defender.resources.movementRemaining,
      counterMoveMax: defender.weapon.counterMoveMax,
      distanceBefore: manhattanDistance(defender.position, aggressor.position),
      counterAttackCost: counterRules.attackCost,
      counterstanceProfile: counterRules.profile ?? null
    }
  });

  const movementEvents = [];
  // Counterstance may explicitly break the normal rule and pursue an out-of-range aggressor.
  const stunned = hasControlStatus(defender, CONTROL_TYPE.STUN);
  const pursuitSteps = (isRooted(defender) || stunned) ? 0 : Math.min(counterRules.allowPursuit ? counterRules.pursuitMoveMax : 0, defender.resources.movementRemaining);
  for (let i = 0; i < pursuitSteps && !isWithinWeaponRange(defender, aggressor); i += 1) {
    const move = advancePursuitOneStep(simulation.state, defender.unitId, aggressor.unitId, { rng: simulation.rng, range: defender.weapon.weaponRange });
    if (move.result !== PURSUIT_RESULT.MOVE && move.result !== PURSUIT_RESULT.MOVE_AND_ENTER_RANGE) break;
    const moveEvent = emit(simulation, EVENT_TYPE.COUNTER_MOVE, {
      initiativeCycle: cycle,
      actorId: defender.unitId,
      targetId: aggressor.unitId,
      parentEventId: counterEvent.eventId,
      payload: {
        step: movementEvents.length + 1,
        movementReason: 'COUNTERSTANCE_PURSUIT',
        from: move.from,
        to: move.to,
        movementBefore: move.movementBefore,
        movementAfter: move.movementAfter,
        distanceBefore: move.targetDistanceBefore,
        distanceAfter: move.targetDistanceAfter,
        counterstanceProfile: counterRules.profile ?? null
      }
    });
    movementEvents.push(moveEvent.eventId);
  }

  const maxSteps = (isRooted(defender) || stunned) ? 0 : Math.min(defender.weapon.counterMoveMax, defender.resources.movementRemaining);
  for (let i = 0; i < maxSteps; i += 1) {
    if (!isWithinWeaponRange(defender, aggressor)) break;
    const throwingDagger = defender.weapon.behavior === WEAPON_BEHAVIOR.THROWING_DAGGER;
    const move = throwingDagger
      ? advanceThreatRetreatOneStep(simulation.state, defender.unitId, aggressor.unitId, { rng: simulation.rng })
      : advanceCounterEscapeOneStep(simulation.state, defender.unitId, aggressor.unitId, { rng: simulation.rng });
    const moved = throwingDagger ? move.result === KITE_RESULT.MOVE : move.result === COUNTER_ESCAPE_RESULT.MOVE;
    if (!moved) break;
    const distanceBefore = throwingDagger ? move.threatDistanceBefore : move.targetDistanceBefore;
    const distanceAfter = throwingDagger ? move.threatDistanceAfter : move.targetDistanceAfter;
    const moveEvent = emit(simulation, EVENT_TYPE.COUNTER_MOVE, {
      initiativeCycle: cycle,
      actorId: defender.unitId,
      targetId: aggressor.unitId,
      parentEventId: counterEvent.eventId,
      payload: {
        step: movementEvents.length + 1,
        movementReason: throwingDagger ? 'THROWING_DAGGER_COUNTER_KITE' : (move.escapeMode === 'ESCAPE_SETUP' ? 'COUNTER_ESCAPE_SETUP' : 'COUNTER_RANGE_MAINTENANCE'),
        from: move.from,
        to: move.to,
        movementBefore: move.movementBefore,
        movementAfter: move.movementAfter,
        distanceBefore,
        distanceAfter,
        preferredRange: throwingDagger ? defender.weapon.preferredRange : move.preferredRange,
        directRetreat: throwingDagger ? move.directRetreat : false,
        escapeMode: throwingDagger ? null : move.escapeMode ?? null,
        escapeQuality: throwingDagger ? null : move.chosenEscapeQuality ?? null,
        tieBroken: move.tieBroken
      }
    });
    movementEvents.push(moveEvent.eventId);
  }

  const afterMove = counterEligibility(simulation, defender.unitId, aggressor.unitId);
  if (!afterMove.eligible) {
    simulation.trace.record('COUNTER_CANCELLED_AFTER_MOVE', { cycle, defenderId: defender.unitId, aggressorId: aggressor.unitId, reason: afterMove.reason });
    return { resolved: false, reason: afterMove.reason, counterEventId: counterEvent.eventId, movementEvents };
  }

  const nextOrdinaryBefore = defender.resources.nextOrdinaryAttackCycle;
  const attack = resolveBasicAttack(simulation, defender.unitId, aggressor.unitId, {
    cycle,
    parentEventId: counterEvent.eventId,
    ignoreAttackInterval: true,
    attackReason: 'COUNTER',
    attackCost: counterRules.attackCost
  });
  if (attack.killed) {
    interruptSpell(simulation, aggressor.unitId, { cycle, reason: 'DEATH', parentEventId: attack.damageEventId ?? attack.impactEventId ?? counterEvent.eventId });
  }
  defender.resources.nextOrdinaryAttackCycle = nextOrdinaryBefore;

  simulation.trace.record('COUNTER_RESOLVED', {
    cycle,
    reactionId: reaction.reactionId,
    defenderId: defender.unitId,
    aggressorId: aggressor.unitId,
    counterEventId: counterEvent.eventId,
    movementSteps: movementEvents.length,
    attacksRemaining: defender.resources.attacksRemaining,
    nextOrdinaryAttackCycle: defender.resources.nextOrdinaryAttackCycle,
    attackOutcome: attack.outcome
  });

  return { resolved: true, counterEventId: counterEvent.eventId, movementEvents, attack };
}
