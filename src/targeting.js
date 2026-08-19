import { ACTION_KIND, LIFE_STATE, TARGET_TYPE } from './constants.js';
import { hasStatus } from './status.js';
import { hasDetection } from './counterplay.js';

export const TARGET_ACQUISITION_RESULT = Object.freeze({
  LEGAL: 'LEGAL',
  MISSING_ACTOR: 'MISSING_ACTOR',
  MISSING_TARGET: 'MISSING_TARGET',
  TARGET_DEAD: 'TARGET_DEAD',
  TARGET_INVISIBLE: 'TARGET_INVISIBLE'
});

export function isInvisible(unit) {
  return Boolean(unit && hasStatus(unit, 'INVISIBLE'));
}

/**
 * Invisibility blocks NEW direct hostile target acquisition only.
 * Existing legal locks, counters, and spatial/AoE effects are separate rules.
 */
export function directHostileTargetAcquisition(state, actorId, targetId) {
  const actor = state.units?.[actorId];
  const target = state.units?.[targetId];
  if (!actor) return Object.freeze({ legal: false, reason: TARGET_ACQUISITION_RESULT.MISSING_ACTOR });
  if (!target) return Object.freeze({ legal: false, reason: TARGET_ACQUISITION_RESULT.MISSING_TARGET });
  if (target.lifeState !== LIFE_STATE.ALIVE) return Object.freeze({ legal: false, reason: TARGET_ACQUISITION_RESULT.TARGET_DEAD });
  if (isInvisible(target) && !hasDetection(actor)) return Object.freeze({ legal: false, reason: TARGET_ACQUISITION_RESULT.TARGET_INVISIBLE });
  return Object.freeze({ legal: true, reason: TARGET_ACQUISITION_RESULT.LEGAL });
}

export function canAcquireDirectHostileTarget(state, actorId, targetId) {
  return directHostileTargetAcquisition(state, actorId, targetId).legal;
}

/** Spatial effects do not acquire the champion directly. */
export function canBeAffectedBySpatialTargeting(unit) {
  return Boolean(unit && unit.lifeState === LIFE_STATE.ALIVE);
}

/**
 * Determine whether a declaration represents a NEW direct hostile unit lock.
 * BASIC_ATTACK is always hostile. Stage-9 proof spells infer hostility from a
 * DAMAGE effect, while explicit payload.targeting.hostile can override future
 * ability/spell data without teaching this module ability semantics.
 */
export function declarationRequiresVisibleDirectTarget(declaration) {
  if (!declaration || declaration.target?.type !== TARGET_TYPE.UNIT) return false;
  if (declaration.payload?.targeting?.hostile === true) return true;
  if (declaration.payload?.targeting?.hostile === false) return false;
  if (declaration.actionKind === ACTION_KIND.BASIC_ATTACK) return true;
  if (declaration.actionKind === ACTION_KIND.SPELL || declaration.actionKind === ACTION_KIND.ABILITY) {
    return declaration.payload?.spell?.effect?.type === 'DAMAGE' || declaration.payload?.spellSpec?.effect?.type === 'DAMAGE' || declaration.payload?.effect?.type === 'DAMAGE';
  }
  return false;
}

export function validateDeclarationTargetAcquisition(state, declaration) {
  if (!declarationRequiresVisibleDirectTarget(declaration)) {
    return Object.freeze({ legal: true, reason: TARGET_ACQUISITION_RESULT.LEGAL });
  }
  if (declaration.payload?.targeting?.allowInvisible === true) {
    const actor = state.units?.[declaration.actorId];
    const target = state.units?.[declaration.target.unitId];
    if (!actor) return Object.freeze({ legal: false, reason: TARGET_ACQUISITION_RESULT.MISSING_ACTOR });
    if (!target) return Object.freeze({ legal: false, reason: TARGET_ACQUISITION_RESULT.MISSING_TARGET });
    if (target.lifeState !== LIFE_STATE.ALIVE) return Object.freeze({ legal: true, reason: TARGET_ACQUISITION_RESULT.LEGAL });
    return Object.freeze({ legal: true, reason: TARGET_ACQUISITION_RESULT.LEGAL });
  }
  const result = directHostileTargetAcquisition(state, declaration.actorId, declaration.target.unitId);
  // Preserve the pre-Stage-12 bootstrap contract that a declaration may retain
  // a now-dead unit lock for deterministic replacement/fizzle handling. Stage
  // 12 adds invisibility acquisition blocking; it does not redefine death.
  if (result.reason === TARGET_ACQUISITION_RESULT.TARGET_DEAD) {
    return Object.freeze({ legal: true, reason: TARGET_ACQUISITION_RESULT.LEGAL });
  }
  return result;
}
