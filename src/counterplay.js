import { EVENT_TYPE } from './constants.js';
import { findStatus, removeStatus, statusKey } from './status.js';

export const COUNTERPLAY_STATUS = Object.freeze({
  ROOT: 'root',
  SUPPRESSION: 'suppression',
  WARD: 'ward',
  UNSTOPPABLE: 'unstoppable',
  SPELLBREAK: 'spellbreak',
  DETECTION: 'detection'
});

export const DEFAULT_UNSTOPPABLE_CONTROLS = Object.freeze([
  'stun',
  'taunt',
  'berserk'
]);

// These are effects whose application is hostile by definition in the current
// ruleset. The set is intentionally centralized and extensible; beneficial
// statuses should never burn a Ward merely because they came from an ally.
const HOSTILE_STATUS_KEYS = new Set([
  'stun','silence','taunt','berserk',
  'root','suppression','spellbreak',
  'poison','bleed','blind','marked','def_down','rend_def_down'
]);

function sync(simulation) { simulation.state.round.eventSequence = simulation.events.length; }
function emit(simulation, type, options) {
  const event = simulation.events.emit(type, options);
  sync(simulation);
  return event;
}

function hostileSource(simulation, sourceId, targetId) {
  if (!sourceId || sourceId === targetId) return false;
  const source = simulation.state.units[sourceId];
  const target = simulation.state.units[targetId];
  return Boolean(source && target && source.side !== target.side);
}

export function isRooted(unit) {
  return Boolean(findStatus(unit, COUNTERPLAY_STATUS.ROOT));
}

export function isSuppressed(unit) {
  return Boolean(findStatus(unit, COUNTERPLAY_STATUS.SUPPRESSION));
}

export function hasDetection(unit) {
  return Boolean(findStatus(unit, COUNTERPLAY_STATUS.DETECTION));
}

export function unstoppableBlocksControl(unit, controlType) {
  const status = findStatus(unit, COUNTERPLAY_STATUS.UNSTOPPABLE);
  if (!status) return false;
  const blocked = Array.isArray(status.data?.blockedControls)
    ? status.data.blockedControls.map(statusKey)
    : DEFAULT_UNSTOPPABLE_CONTROLS;
  return blocked.includes(statusKey(controlType));
}

export function wardCanBlockStatus(simulation, targetId, {
  sourceId = null,
  key,
  hostile = null
} = {}) {
  const target = simulation.state.units[targetId];
  const ward = findStatus(target, COUNTERPLAY_STATUS.WARD);
  if (!ward) return false;
  const normalized = statusKey(key);
  if (normalized === COUNTERPLAY_STATUS.WARD || normalized === COUNTERPLAY_STATUS.UNSTOPPABLE || normalized === COUNTERPLAY_STATUS.DETECTION) return false;
  const isHostile = hostile ?? (hostileSource(simulation, sourceId, targetId) && HOSTILE_STATUS_KEYS.has(normalized));
  if (!isHostile) return false;
  const configured = ward.data?.blockedStatusKeys;
  if (Array.isArray(configured) && configured.length) {
    return configured.map(statusKey).includes(normalized);
  }
  return HOSTILE_STATUS_KEYS.has(normalized);
}

/**
 * Consume a Ward for one hostile status/debuff/CC application.
 * Returns a BLOCK event when consumed; otherwise null.
 */
export function consumeWardForStatus(simulation, targetId, {
  sourceId = null,
  key,
  cycle = simulation.state.round.initiativeCycle,
  parentEventId = null,
  hostile = null,
  blockedAmount = null,
  abilityId = null
} = {}) {
  if (!wardCanBlockStatus(simulation, targetId, { sourceId, key, hostile })) return null;
  const target = simulation.state.units[targetId];
  const ward = removeStatus(target, COUNTERPLAY_STATUS.WARD);
  const block = emit(simulation, EVENT_TYPE.BLOCK, {
    initiativeCycle: cycle,
    actorId: targetId,
    targetId,
    parentEventId,
    payload: {
      reason: 'WARD',
      blockedStatusKey: statusKey(key),
      hostileSourceId: sourceId,
      wardSourceId: ward?.sourceId ?? null,
      blockedAmount: Number.isFinite(blockedAmount) ? blockedAmount : null,
      abilityId
    }
  });
  emit(simulation, EVENT_TYPE.STATUS_REMOVE, {
    initiativeCycle: cycle,
    actorId: targetId,
    targetId,
    parentEventId: block.eventId,
    payload: { key: COUNTERPLAY_STATUS.WARD, reason: 'CONSUMED_BLOCKING_STATUS' }
  });
  simulation.trace.record('WARD_CONSUMED', {
    cycle,
    targetId,
    sourceId,
    blockedStatusKey: statusKey(key),
    eventId: block.eventId
  });
  return block;
}

/** Consume Spellbreak when the afflicted unit actually starts a spell. */
export function consumeSpellbreak(simulation, actorId, {
  cycle = simulation.state.round.initiativeCycle,
  parentEventId = null
} = {}) {
  const actor = simulation.state.units[actorId];
  const status = findStatus(actor, COUNTERPLAY_STATUS.SPELLBREAK);
  if (!status) return null;
  removeStatus(actor, COUNTERPLAY_STATUS.SPELLBREAK);
  const block = emit(simulation, EVENT_TYPE.BLOCK, {
    initiativeCycle: cycle,
    actorId: status.sourceId,
    targetId: actorId,
    parentEventId,
    payload: {
      reason: 'SPELLBREAK',
      blockedActionKind: 'SPELL',
      sourceId: status.sourceId ?? null
    }
  });
  emit(simulation, EVENT_TYPE.STATUS_REMOVE, {
    initiativeCycle: cycle,
    actorId: actorId,
    targetId: actorId,
    parentEventId: block.eventId,
    payload: { key: COUNTERPLAY_STATUS.SPELLBREAK, reason: 'CONSUMED_BY_SPELL_ATTEMPT' }
  });
  simulation.trace.record('SPELLBREAK_CONSUMED', { cycle, actorId, sourceId: status.sourceId ?? null, eventId: block.eventId });
  return block;
}
