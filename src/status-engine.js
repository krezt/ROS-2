import { EVENT_TYPE, LIFE_STATE } from './constants.js';
import { invariant } from './errors.js';
import { expireControlEffect, CONTROL_TYPE } from './controls.js';
import { findStatus, removeStatus, statusKey, upsertStatus } from './status.js';
import { consumeWardForStatus } from './counterplay.js';
import { resolveAutonomousSummons } from './summons.js';

export const STATUS_STACK = Object.freeze({
  REPLACE: 'REPLACE',
  REFRESH: 'REFRESH',
  MAX_DURATION: 'MAX_DURATION'
});

export const STATUS_KEY = Object.freeze({
  POISON: 'poison',
  BLEED: 'bleed',
  INVISIBLE: 'invisible',
  STUN: 'stun',
  SILENCE: 'silence',
  TAUNT: 'taunt',
  BERSERK: 'berserk',
  ROOT: 'root',
  SUPPRESSION: 'suppression',
  WARD: 'ward',
  UNSTOPPABLE: 'unstoppable',
  SPELLBREAK: 'spellbreak',
  DETECTION: 'detection'
});

function sync(simulation) { simulation.state.round.eventSequence = simulation.events.length; }
function emit(simulation, type, options) {
  const event = simulation.events.emit(type, options);
  sync(simulation);
  return event;
}

function canonicalUnits(simulation) {
  return Object.values(simulation.state.units).sort((a, b) => a.unitId.localeCompare(b.unitId));
}

function updateBattleOutcomeAfterStatusDamage(state) {
  const livingA = Object.values(state.units).some((u) => u.side === 'A' && u.lifeState === LIFE_STATE.ALIVE && u.entityKind !== 'SUMMON');
  const livingB = Object.values(state.units).some((u) => u.side === 'B' && u.lifeState === LIFE_STATE.ALIVE && u.entityKind !== 'SUMMON');
  if (livingA && livingB) return;
  state.outcome.status = 'COMPLETE';
  state.outcome.winner = livingA ? 'A' : (livingB ? 'B' : null);
}

function markDeath(simulation, unit, { sourceId = null, parentEventId = null, cycle }) {
  if (unit.stats.hp > 0 || unit.lifeState === LIFE_STATE.DEAD) return null;
  unit.stats.hp = 0;
  unit.lifeState = LIFE_STATE.DEAD;
  updateBattleOutcomeAfterStatusDamage(simulation.state);
  const ko = emit(simulation, EVENT_TYPE.KO, {
    initiativeCycle: cycle,
    actorId: sourceId,
    targetId: unit.unitId,
    parentEventId,
    payload: { position: unit.position, source: 'STATUS_TICK' }
  });
  simulation.trace.record('STATUS_KO', { cycle, targetId: unit.unitId, sourceId, eventId: ko.eventId });
  return ko;
}

export function applyTimedStatus(simulation, targetId, {
  key,
  duration,
  sourceId = null,
  data = {},
  stack = STATUS_STACK.REPLACE,
  cycle = simulation.state.round.initiativeCycle,
  parentEventId = null
} = {}) {
  invariant(typeof key === 'string' && key.length > 0, 'Status key is required.');
  invariant(Number.isInteger(duration) && duration >= 1, 'Status duration must be an integer >= 1.');
  invariant(Object.values(STATUS_STACK).includes(stack), `Unknown status stack policy: ${stack}`);
  const unit = simulation.state.units[targetId];
  invariant(unit, `Unknown status target: ${targetId}`);

  const normalized = statusKey(key);
  const wardBlock = consumeWardForStatus(simulation, targetId, { sourceId, key: normalized, cycle, parentEventId });
  if (wardBlock) return null;
  const existing = findStatus(unit, normalized);
  let nextDuration = duration;
  if (existing && stack === STATUS_STACK.REFRESH) nextDuration = duration;
  else if (existing && stack === STATUS_STACK.MAX_DURATION) nextDuration = Math.max(existing.duration, duration);

  const status = {
    key: normalized,
    duration: nextDuration,
    sourceId,
    data: structuredClone(data ?? {})
  };
  upsertStatus(unit, status);
  const event = emit(simulation, EVENT_TYPE.STATUS_APPLY, {
    initiativeCycle: cycle,
    actorId: sourceId,
    targetId,
    parentEventId,
    payload: { ...status, stack }
  });
  simulation.trace.record('STATUS_APPLY_TIMED', { cycle, targetId, key: normalized, duration: nextDuration, sourceId, eventId: event.eventId });
  return status;
}


export function applyRoot(simulation, targetId, { duration = 1, sourceId = null, cycle = simulation.state.round.initiativeCycle, parentEventId = null } = {}) {
  return applyTimedStatus(simulation, targetId, { key: STATUS_KEY.ROOT, duration, sourceId, cycle, parentEventId, stack: STATUS_STACK.REFRESH });
}

export function applySuppression(simulation, targetId, { duration = 1, sourceId = null, cycle = simulation.state.round.initiativeCycle, parentEventId = null } = {}) {
  return applyTimedStatus(simulation, targetId, { key: STATUS_KEY.SUPPRESSION, duration, sourceId, cycle, parentEventId, stack: STATUS_STACK.REFRESH });
}

export function applyWard(simulation, targetId, { duration = 2, sourceId = targetId, blockedStatusKeys = null, cycle = simulation.state.round.initiativeCycle, parentEventId = null } = {}) {
  return applyTimedStatus(simulation, targetId, { key: STATUS_KEY.WARD, duration, sourceId, data: blockedStatusKeys ? { blockedStatusKeys } : {}, cycle, parentEventId, stack: STATUS_STACK.REFRESH });
}

export function applyUnstoppable(simulation, targetId, { duration = 1, sourceId = targetId, blockedControls = null, cycle = simulation.state.round.initiativeCycle, parentEventId = null } = {}) {
  return applyTimedStatus(simulation, targetId, { key: STATUS_KEY.UNSTOPPABLE, duration, sourceId, data: blockedControls ? { blockedControls } : {}, cycle, parentEventId, stack: STATUS_STACK.REFRESH });
}

export function applySpellbreak(simulation, targetId, { duration = 2, sourceId = null, cycle = simulation.state.round.initiativeCycle, parentEventId = null } = {}) {
  return applyTimedStatus(simulation, targetId, { key: STATUS_KEY.SPELLBREAK, duration, sourceId, cycle, parentEventId, stack: STATUS_STACK.REFRESH });
}

export function applyDetection(simulation, targetId, { duration = 2, sourceId = targetId, cycle = simulation.state.round.initiativeCycle, parentEventId = null } = {}) {
  return applyTimedStatus(simulation, targetId, { key: STATUS_KEY.DETECTION, duration, sourceId, cycle, parentEventId, stack: STATUS_STACK.REFRESH });
}

export function applyBleed(simulation, targetId, {
  duration = 3,
  pct = 0.15,
  sourceId = null,
  cycle = simulation.state.round.initiativeCycle,
  parentEventId = null
} = {}) {
  invariant(Number.isFinite(pct) && pct > 0, 'Bleed pct must be > 0.');
  return applyTimedStatus(simulation, targetId, {
    key: STATUS_KEY.BLEED,
    duration,
    sourceId,
    data: { pct },
    stack: STATUS_STACK.REPLACE,
    cycle,
    parentEventId
  });
}

export function applyPoison(simulation, targetId, amount, {
  sourceId = null,
  cycle = simulation.state.round.initiativeCycle,
  parentEventId = null,
  abilityId = null
} = {}) {
  invariant(Number.isFinite(amount) && amount > 0, 'Poison amount must be > 0.');
  const unit = simulation.state.units[targetId];
  invariant(unit, `Unknown poison target: ${targetId}`);
  const wardBlock = consumeWardForStatus(simulation, targetId, { sourceId, key: STATUS_KEY.POISON, cycle, parentEventId, blockedAmount: Math.max(1, Math.floor(amount)), abilityId });
  if (wardBlock) return null;
  let poison = unit.statuses.find((s) => s.key === STATUS_KEY.POISON);
  if (!poison) {
    poison = { key: STATUS_KEY.POISON, duration: null, sourceId: null, data: { contributions: [] } };
    unit.statuses.push(poison);
  }
  poison.data ??= {};
  poison.data.contributions ??= [];
  const contribution = { amount: Math.max(1, Math.floor(amount)), sourceId };
  poison.data.contributions.push(contribution);
  const event = emit(simulation, EVENT_TYPE.STATUS_APPLY, {
    initiativeCycle: cycle,
    actorId: sourceId,
    targetId,
    parentEventId,
    payload: { key: STATUS_KEY.POISON, contribution, total: poisonTotal(unit), abilityId }
  });
  simulation.trace.record('POISON_ADD', { cycle, targetId, amount: contribution.amount, total: poisonTotal(unit), sourceId, contributions: poison.data.contributions.length, eventId: event.eventId });
  return poison;
}

export function poisonTotal(unit) {
  const poison = unit?.statuses?.find((s) => s.key === STATUS_KEY.POISON);
  return (poison?.data?.contributions ?? []).reduce((sum, c) => sum + Math.max(0, Math.floor(c.amount ?? 0)), 0);
}

function tickPoison(simulation, unit, cycle) {
  const poison = unit.statuses.find((s) => s.key === STATUS_KEY.POISON);
  const contributions = poison?.data?.contributions;
  if (!poison || !Array.isArray(contributions) || contributions.length === 0 || unit.lifeState !== LIFE_STATE.ALIVE) return null;
  const totalBefore = poisonTotal(unit);
  if (totalBefore <= 0) { removeStatus(unit, STATUS_KEY.POISON); return null; }
  // Poison is deliberately volatile: each round it deals a synchronized random
  // 50–100% of the current stack, then every contribution decays independently.
  const tickPctInt = simulation.rng.nextInt(50, 100, `POISON_TICK_PCT:${unit.unitId}`);
  const tickPct = tickPctInt / 100;
  const amount = Math.max(1, Math.floor(totalBefore * tickPct));
  const before = unit.stats.hp;
  unit.stats.hp = Math.max(0, before - amount);
  const damage = emit(simulation, EVENT_TYPE.DAMAGE, {
    initiativeCycle: cycle,
    actorId: null,
    targetId: unit.unitId,
    parentEventId: null,
    payload: { amount, damageType: 'POISON', source: 'STATUS_TICK', hpBefore: before, hpAfter: unit.stats.hp, poisonTotalBefore: totalBefore, tickPct }
  });
  poison.data.contributions = contributions
    .map((c) => ({ ...c, amount: Math.floor((c.amount ?? 0) * 0.85) }))
    .filter((c) => c.amount >= 1);
  const remaining = poisonTotal(unit);
  const tick = emit(simulation, EVENT_TYPE.STATUS_TICK, {
    initiativeCycle: cycle,
    actorId: null,
    targetId: unit.unitId,
    parentEventId: damage.eventId,
    payload: { key: STATUS_KEY.POISON, amount, remaining, totalBefore, tickPct }
  });
  if (poison.data.contributions.length === 0) {
    removeStatus(unit, STATUS_KEY.POISON);
    emit(simulation, EVENT_TYPE.STATUS_EXPIRE, {
      initiativeCycle: cycle, actorId: null, targetId: unit.unitId, parentEventId: tick.eventId,
      payload: { key: STATUS_KEY.POISON, reason: 'DECAYED_TO_ZERO' }
    });
  }
  const ko = markDeath(simulation, unit, { parentEventId: damage.eventId, cycle });
  if (ko) removeStatus(unit, STATUS_KEY.POISON);
  simulation.trace.record('POISON_TICK', { cycle, targetId: unit.unitId, totalBefore, tickPct, amount, remaining, killed: Boolean(ko) });
  return { amount, remaining, killed: Boolean(ko) };
}

function tickBleed(simulation, unit, cycle) {
  const bleed = findStatus(unit, STATUS_KEY.BLEED);
  if (!bleed || unit.lifeState !== LIFE_STATE.ALIVE) return null;
  const pct = Number.isFinite(bleed.data?.pct) ? bleed.data.pct : 0.15;
  const before = unit.stats.hp;
  const amount = Math.max(1, Math.floor(before * pct));
  unit.stats.hp = Math.max(0, before - amount);
  const damage = emit(simulation, EVENT_TYPE.DAMAGE, {
    initiativeCycle: cycle,
    actorId: bleed.sourceId ?? null,
    targetId: unit.unitId,
    parentEventId: null,
    payload: { amount, damageType: 'BLEED', source: 'STATUS_TICK', hpBefore: before, hpAfter: unit.stats.hp }
  });
  emit(simulation, EVENT_TYPE.STATUS_TICK, {
    initiativeCycle: cycle,
    actorId: bleed.sourceId ?? null,
    targetId: unit.unitId,
    parentEventId: damage.eventId,
    payload: { key: STATUS_KEY.BLEED, amount, pct }
  });
  const ko = markDeath(simulation, unit, { sourceId: bleed.sourceId ?? null, parentEventId: damage.eventId, cycle });
  if (ko) removeStatus(unit, STATUS_KEY.BLEED);
  simulation.trace.record('BLEED_TICK', { cycle, targetId: unit.unitId, amount, pct, killed: Boolean(ko) });
  return { amount, killed: Boolean(ko) };
}


function tickRegen(simulation, unit, cycle) {
  const regen = findStatus(unit, 'regen');
  if (!regen || unit.lifeState !== LIFE_STATE.ALIVE) return null;
  const pct = Number.isFinite(regen.data?.pct) ? regen.data.pct : 0.10;
  const before = unit.stats.hp;
  const amount = Math.max(1, Math.floor(unit.stats.maxHP * pct));
  const blockedByBleed = Boolean(findStatus(unit, STATUS_KEY.BLEED));
  if (!blockedByBleed) unit.stats.hp = Math.min(unit.stats.maxHP, before + amount);
  const healed = unit.stats.hp - before;
  const heal = emit(simulation, EVENT_TYPE.HEAL, {
    initiativeCycle: cycle, actorId: regen.sourceId ?? unit.unitId, targetId: unit.unitId, parentEventId: null,
    payload: { amount: healed, hpBefore: before, hpAfter: unit.stats.hp, source: 'STATUS_TICK', statusKey: 'regen', blockedByBleed }
  });
  emit(simulation, EVENT_TYPE.STATUS_TICK, { initiativeCycle: cycle, actorId: regen.sourceId ?? unit.unitId, targetId: unit.unitId, parentEventId: heal.eventId, payload: { key: 'regen', amount: healed, pct, blockedByBleed } });
  return { amount: healed, pct, blockedByBleed };
}

function expireTimedStatus(simulation, unit, status, cycle) {
  const upper = status.key.toUpperCase();
  if (upper === CONTROL_TYPE.TAUNT || upper === CONTROL_TYPE.BERSERK) {
    return expireControlEffect(simulation, unit.unitId, upper, { cycle, reason: 'DURATION_EXPIRED' });
  }
  const removed = removeStatus(unit, status.key);
  if (!removed) return null;
  if (removed.key === 'attacks_max_up' || removed.data?.resource === 'ATTACKS_MAX') {
    const amount = Math.max(0, Math.trunc(removed.data?.amount ?? 0));
    unit.resources.attacksMax = Math.max(0, unit.resources.attacksMax - amount);
    unit.resources.attacksRemaining = Math.min(unit.resources.attacksRemaining, unit.resources.attacksMax);
  }
  if (removed.key === 'movement_max_up' || removed.data?.resource === 'MOVEMENT_MAX') {
    const amount = Math.max(0, Math.trunc(removed.data?.amount ?? 0));
    unit.resources.movementMax = Math.max(0, unit.resources.movementMax - amount);
    unit.resources.movementRemaining = Math.min(unit.resources.movementRemaining, unit.resources.movementMax);
  }
  const event = emit(simulation, EVENT_TYPE.STATUS_EXPIRE, {
    initiativeCycle: cycle,
    actorId: removed.sourceId ?? null,
    targetId: unit.unitId,
    parentEventId: null,
    payload: { key: removed.key, reason: 'DURATION_EXPIRED' }
  });
  simulation.trace.record('STATUS_EXPIRE_DURATION', { cycle, targetId: unit.unitId, key: removed.key, eventId: event.eventId });
  return event;
}

export function processEndOfRoundStatuses(simulation, {
  cycle = simulation.state.round.initiativeCycle
} = {}) {
  const summary = [];
  for (const unit of canonicalUnits(simulation)) {
    const poison = tickPoison(simulation, unit, cycle);
    const bleed = tickBleed(simulation, unit, cycle);
    const regen = tickRegen(simulation, unit, cycle);

    // Standard timed statuses always lose one round at round end, even if they
    // were applied partway through the round. Poison is contribution-decay based.
    const timed = [...unit.statuses]
      .filter((s) => s.key !== STATUS_KEY.POISON && Number.isInteger(s.duration));
    for (const status of timed) {
      status.duration -= 1;
      emit(simulation, EVENT_TYPE.STATUS_DURATION, {
        initiativeCycle: cycle,
        actorId: status.sourceId ?? null,
        targetId: unit.unitId,
        parentEventId: null,
        payload: { key: status.key, durationRemaining: Math.max(0, status.duration) }
      });
      if (status.duration <= 0) expireTimedStatus(simulation, unit, status, cycle);
    }
    summary.push({ unitId: unit.unitId, poison, bleed, regen, statuses: unit.statuses.map((s) => ({ key: s.key, duration: s.duration ?? null })) });
  }
  simulation.trace.record('ROUND_STATUS_LIFECYCLE', { roundNumber: simulation.state.roundNumber, cycle, summary });
  return summary;
}

export function advanceClosedRound(simulation, { parentEventId = null } = {}) {
  invariant(simulation.state.outcome.status !== 'COMPLETE', 'Cannot advance a completed battle to a new round.');
  simulation.state.roundNumber += 1;
  simulation.state.round.initiativeCycle = 0;
  simulation.state.round.activeRuntimeIds = [];
  for (const unit of canonicalUnits(simulation)) {
    unit.resources.movementRemaining = unit.resources.movementMax;
    unit.resources.attacksRemaining = unit.resources.attacksMax;
    unit.resources.nextOrdinaryAttackCycle = 0;
  }
  const start = emit(simulation, EVENT_TYPE.ROUND_START, {
    initiativeCycle: 0,
    actorId: null,
    targetId: null,
    parentEventId,
    payload: { roundNumber: simulation.state.roundNumber }
  });
  return { roundStartEventId: start.eventId, roundNumber: simulation.state.roundNumber };
}

export function closeRound(simulation, { advanceRound = true } = {}) {
  const cycle = simulation.state.round.initiativeCycle;
  const summons = resolveAutonomousSummons(simulation, { cycle });
  const end = emit(simulation, EVENT_TYPE.ROUND_END, {
    initiativeCycle: cycle,
    actorId: null,
    targetId: null,
    parentEventId: null,
    payload: { roundNumber: simulation.state.roundNumber }
  });
  const statuses = processEndOfRoundStatuses(simulation, { cycle });
  if (advanceRound && simulation.state.outcome.status !== 'COMPLETE') {
    advanceClosedRound(simulation, { parentEventId: end.eventId });
  }
  return { roundEndEventId: end.eventId, summons, statuses, roundNumber: simulation.state.roundNumber };
}
