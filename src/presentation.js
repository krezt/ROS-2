import { EVENT_TYPE } from './constants.js';
import { invariant } from './errors.js';
import { canonicalStringify } from './canonical.js';

export const PRESENTATION_COMMAND = Object.freeze({
  ROUND_MARKER: 'ROUND_MARKER',
  ACTION_CUE: 'ACTION_CUE',
  MOVE_UNIT: 'MOVE_UNIT',
  ATTACK_CUE: 'ATTACK_CUE',
  ATTACK_IMPACT: 'ATTACK_IMPACT',
  COUNTER_CUE: 'COUNTER_CUE',
  CAST_CUE: 'CAST_CUE',
  CAST_COMPLETE: 'CAST_COMPLETE',
  SPELL_PROJECTILE: 'SPELL_PROJECTILE',
  CAST_INTERRUPT: 'CAST_INTERRUPT',
  CAST_FIZZLE: 'CAST_FIZZLE',
  ITEM_CUE: 'ITEM_CUE',
  DAMAGE_FEEDBACK: 'DAMAGE_FEEDBACK',
  HEAL_FEEDBACK: 'HEAL_FEEDBACK',
  SIMULTANEOUS_FEEDBACK: 'SIMULTANEOUS_FEEDBACK',
  MISS_FEEDBACK: 'MISS_FEEDBACK',
  DODGE_FEEDBACK: 'DODGE_FEEDBACK',
  BLOCK_FEEDBACK: 'BLOCK_FEEDBACK',
  CRIT_FEEDBACK: 'CRIT_FEEDBACK',
  STATUS_FEEDBACK: 'STATUS_FEEDBACK',
  DISPLACE_UNIT: 'DISPLACE_UNIT',
  KO_FEEDBACK: 'KO_FEEDBACK',
  RESURRECT_FEEDBACK: 'RESURRECT_FEEDBACK',
  ACTION_END: 'ACTION_END',
  INTERCEPT_CUE: 'INTERCEPT_CUE',
  SPELL_RESOLUTION: 'SPELL_RESOLUTION'
});

export const PRESENTATION_CHANNEL = Object.freeze({
  SYSTEM: 'SYSTEM',
  MOTION: 'MOTION',
  COMBAT: 'COMBAT',
  CAST: 'CAST',
  STATUS: 'STATUS',
  UI: 'UI'
});

function command(event, ordinal, type, channel, payload = {}) {
  return Object.freeze({
    commandId: `${event.eventId}:P${ordinal}`,
    sourceEventId: event.eventId,
    sourceSequence: event.sequence,
    parentEventId: event.parentEventId,
    initiativeCycle: event.initiativeCycle,
    actorId: event.actorId,
    targetId: event.targetId,
    type,
    channel,
    payload: structuredClone(payload)
  });
}

function movementPayload(event, kind) {
  return {
    kind,
    from: event.payload?.from ?? null,
    to: event.payload?.to ?? null,
    movementReason: event.payload?.movementReason ?? event.payload?.reason ?? null,
    distanceBefore: event.payload?.distanceBefore ?? null,
    distanceAfter: event.payload?.distanceAfter ?? null
  };
}

/**
 * Pure projection from one authoritative simulation event to presentation commands.
 * It never reads simulation state and never consumes gameplay RNG.
 */
export function commandsForEvent(event) {
  invariant(event && typeof event === 'object', 'Presentation event must be an object.');
  const out = [];
  const push = (type, channel, payload = {}) => out.push(command(event, out.length, type, channel, payload));

  switch (event.type) {
    case EVENT_TYPE.ROUND_START:
    case EVENT_TYPE.ROUND_END:
      push(PRESENTATION_COMMAND.ROUND_MARKER, PRESENTATION_CHANNEL.SYSTEM, { eventType: event.type, ...event.payload });
      break;
    case EVENT_TYPE.ACTION_START:
      push(PRESENTATION_COMMAND.ACTION_CUE, PRESENTATION_CHANNEL.SYSTEM, { phase: 'START', ...event.payload });
      break;
    case EVENT_TYPE.ACTION_COMPLETE:
    case EVENT_TYPE.ACTION_INTERRUPT:
      push(PRESENTATION_COMMAND.ACTION_END, PRESENTATION_CHANNEL.SYSTEM, { eventType: event.type, ...event.payload });
      break;
    case EVENT_TYPE.MOVE:
      push(PRESENTATION_COMMAND.MOVE_UNIT, PRESENTATION_CHANNEL.MOTION, movementPayload(event, 'MOVE'));
      break;
    case EVENT_TYPE.COUNTER_MOVE:
      push(PRESENTATION_COMMAND.MOVE_UNIT, PRESENTATION_CHANNEL.MOTION, movementPayload(event, 'COUNTER_MOVE'));
      break;
    case EVENT_TYPE.PUSH:
    case EVENT_TYPE.PULL:
    case EVENT_TYPE.TELEPORT:
      push(PRESENTATION_COMMAND.DISPLACE_UNIT, PRESENTATION_CHANNEL.MOTION, { kind: event.type, ...event.payload });
      break;
    case EVENT_TYPE.INTERCEPT:
      push(PRESENTATION_COMMAND.INTERCEPT_CUE, PRESENTATION_CHANNEL.COMBAT, { ...event.payload });
      break;
    case EVENT_TYPE.ATTACK_START:
      push(PRESENTATION_COMMAND.ATTACK_CUE, PRESENTATION_CHANNEL.COMBAT, { ...event.payload });
      break;
    case EVENT_TYPE.ATTACK_IMPACT:
      push(PRESENTATION_COMMAND.ATTACK_IMPACT, PRESENTATION_CHANNEL.COMBAT, { ...event.payload });
      break;
    case EVENT_TYPE.COUNTER:
      push(PRESENTATION_COMMAND.COUNTER_CUE, PRESENTATION_CHANNEL.COMBAT, { ...event.payload });
      break;
    case EVENT_TYPE.CAST_START:
      push(PRESENTATION_COMMAND.CAST_CUE, PRESENTATION_CHANNEL.CAST, { phase: 'START', ...event.payload });
      break;
    case EVENT_TYPE.CAST_COMPLETE:
      push(PRESENTATION_COMMAND.CAST_COMPLETE, PRESENTATION_CHANNEL.CAST, { ...event.payload });
      if (event.payload?.resolutionCount !== 2 && event.payload?.casterPositionAtCompletion && event.payload?.targetPositionAtCompletion) {
        push(PRESENTATION_COMMAND.SPELL_PROJECTILE, PRESENTATION_CHANNEL.CAST, {
          from: event.payload.casterPositionAtCompletion,
          to: event.payload.targetPositionAtCompletion,
          effectType: event.payload.effectType ?? null,
          areaShape: event.payload.areaShape ?? null,
          abilityId: event.payload.abilityId ?? event.payload.actionId ?? null,
          groundLock: event.payload.groundLock ?? null
        });
      }
      break;
    case EVENT_TYPE.SPELL_RESOLUTION:
      // Resolution animation must precede any echoed projectile/impact presentation.
      push(PRESENTATION_COMMAND.SPELL_RESOLUTION, PRESENTATION_CHANNEL.CAST, { ...event.payload });
      if (event.payload?.echoed && !event.payload?.spellbroken && event.payload?.casterPositionAtCompletion && event.payload?.targetPositionAtCompletion) {
        push(PRESENTATION_COMMAND.SPELL_PROJECTILE, PRESENTATION_CHANNEL.CAST, {
          from: event.payload.casterPositionAtCompletion,
          to: event.payload.targetPositionAtCompletion,
          effectType: event.payload.effectType ?? null,
          areaShape: event.payload.areaShape ?? null,
          abilityId: event.payload.abilityId ?? event.payload.actionId ?? null,
          groundLock: event.payload.groundLock ?? null,
          echoed: true,
          resolutionIndex: event.payload.resolutionIndex ?? null,
          resolutionCount: event.payload.resolutionCount ?? null
        });
      }
      break;
    case EVENT_TYPE.CAST_INTERRUPT:
      push(PRESENTATION_COMMAND.CAST_INTERRUPT, PRESENTATION_CHANNEL.CAST, { ...event.payload });
      break;
    case EVENT_TYPE.CAST_FIZZLE:
      push(PRESENTATION_COMMAND.CAST_FIZZLE, PRESENTATION_CHANNEL.CAST, { ...event.payload });
      break;
    case EVENT_TYPE.ITEM_START:
    case EVENT_TYPE.ITEM_COMPLETE:
    case EVENT_TYPE.ITEM_INTERRUPT:
      push(PRESENTATION_COMMAND.ITEM_CUE, PRESENTATION_CHANNEL.CAST, { eventType: event.type, ...event.payload });
      break;
    case EVENT_TYPE.DAMAGE:
      push(PRESENTATION_COMMAND.DAMAGE_FEEDBACK, PRESENTATION_CHANNEL.UI, { ...event.payload });
      break;
    case EVENT_TYPE.HEAL:
      push(PRESENTATION_COMMAND.HEAL_FEEDBACK, PRESENTATION_CHANNEL.UI, { ...event.payload });
      break;
    case EVENT_TYPE.MISS:
      push(PRESENTATION_COMMAND.MISS_FEEDBACK, PRESENTATION_CHANNEL.UI, { ...event.payload });
      break;
    case EVENT_TYPE.DODGE:
      push(PRESENTATION_COMMAND.DODGE_FEEDBACK, PRESENTATION_CHANNEL.UI, { ...event.payload });
      break;
    case EVENT_TYPE.BLOCK:
      push(PRESENTATION_COMMAND.BLOCK_FEEDBACK, PRESENTATION_CHANNEL.UI, { ...event.payload });
      break;
    case EVENT_TYPE.CRIT:
      push(PRESENTATION_COMMAND.CRIT_FEEDBACK, PRESENTATION_CHANNEL.UI, { ...event.payload });
      break;
    case EVENT_TYPE.STATUS_APPLY:
    case EVENT_TYPE.STATUS_TICK:
    case EVENT_TYPE.STATUS_DURATION:
    case EVENT_TYPE.STATUS_REMOVE:
    case EVENT_TYPE.STATUS_EXPIRE:
    case EVENT_TYPE.STUN:
    case EVENT_TYPE.SILENCE:
    case EVENT_TYPE.TAUNT:
    case EVENT_TYPE.BERSERK:
      push(PRESENTATION_COMMAND.STATUS_FEEDBACK, PRESENTATION_CHANNEL.STATUS, { eventType: event.type, ...event.payload });
      break;
    case EVENT_TYPE.KO:
      push(PRESENTATION_COMMAND.KO_FEEDBACK, PRESENTATION_CHANNEL.UI, { ...event.payload });
      break;
    case EVENT_TYPE.RESURRECT:
      push(PRESENTATION_COMMAND.RESURRECT_FEEDBACK, PRESENTATION_CHANNEL.UI, { ...event.payload });
      break;
    default:
      // Unknown future events deliberately produce no presentation command rather than changing simulation semantics.
      break;
  }
  return Object.freeze(out);
}

export function validateAuthoritativeEventStream(events) {
  invariant(Array.isArray(events), 'events must be an array.');
  const seen = new Set();
  let lastSequence = -1;
  for (const event of events) {
    invariant(Number.isInteger(event.sequence) && event.sequence > lastSequence,
      `Event sequence must be strictly increasing: ${event.eventId}`);
    invariant(typeof event.eventId === 'string' && !seen.has(event.eventId), `Duplicate eventId: ${event.eventId}`);
    if (event.parentEventId !== null) invariant(seen.has(event.parentEventId), `Presentation event parent not yet seen: ${event.parentEventId}`);
    seen.add(event.eventId);
    lastSequence = event.sequence;
  }
  return true;
}

function simultaneousFeedbackCommand(groupEvents) {
  const first=groupEvents[0];
  return Object.freeze({
    commandId:`${first.eventId}:SIMULTANEOUS`,
    sourceEventId:first.eventId,
    sourceEventIds:Object.freeze(groupEvents.map(e=>e.eventId)),
    sourceSequence:first.sequence,
    parentEventId:first.parentEventId,
    initiativeCycle:first.initiativeCycle,
    actorId:first.actorId,
    targetId:null,
    type:PRESENTATION_COMMAND.SIMULTANEOUS_FEEDBACK,
    channel:PRESENTATION_CHANNEL.UI,
    payload:Object.freeze({
      simultaneousGroup:first.payload?.simultaneousGroup,
      events:Object.freeze(groupEvents.map(e=>Object.freeze({
        eventId:e.eventId,type:e.type,actorId:e.actorId,targetId:e.targetId,initiativeCycle:e.initiativeCycle,payload:structuredClone(e.payload)
      })))
    })
  });
}

export function buildPresentationTimeline(events) {
  validateAuthoritativeEventStream(events);
  const grouped=new Map();
  for(const event of events){
    const group=event.payload?.simultaneousGroup;
    if(group && (event.type===EVENT_TYPE.DAMAGE||event.type===EVENT_TYPE.HEAL)){
      if(!grouped.has(group))grouped.set(group,[]);
      grouped.get(group).push(event);
    }
  }
  const emittedGroups=new Set(),commands=[];
  for(const event of events){
    const group=event.payload?.simultaneousGroup;
    if(group && (event.type===EVENT_TYPE.DAMAGE||event.type===EVENT_TYPE.HEAL)){
      if(emittedGroups.has(group))continue;
      emittedGroups.add(group);
      const members=grouped.get(group)??[event];
      if(members.length>1){commands.push(simultaneousFeedbackCommand(members));continue;}
    }
    commands.push(...commandsForEvent(event));
  }
  return Object.freeze(commands);
}

export function presentationTimelineHashInput(events) {
  return canonicalStringify(buildPresentationTimeline(events));
}

export class ReplayController {
  #timeline;
  #adapter;
  #cursor = 0;
  #state = 'READY';

  constructor({ events, adapter }) {
    invariant(adapter && typeof adapter.execute === 'function', 'Replay adapter must implement execute(command).');
    this.#timeline = buildPresentationTimeline(events);
    this.#adapter = adapter;
  }

  get cursor() { return this.#cursor; }
  get length() { return this.#timeline.length; }
  get state() { return this.#state; }
  get timeline() { return this.#timeline; }

  async step() {
    if (this.#cursor >= this.#timeline.length) {
      this.#state = 'COMPLETE';
      return null;
    }
    this.#state = 'PLAYING';
    const cmd = this.#timeline[this.#cursor];
    await this.#adapter.execute(cmd);
    this.#cursor += 1;
    if (this.#cursor >= this.#timeline.length) this.#state = 'COMPLETE';
    return cmd;
  }

  async playAll() {
    while (this.#cursor < this.#timeline.length) await this.step();
    return this.#cursor;
  }
}

/**
 * Headless/reference adapter used by tests and non-Phaser tools.
 */
export class RecordingPresentationAdapter {
  executed = [];
  async execute(commandValue) {
    this.executed.push(structuredClone(commandValue));
  }
}

/**
 * Phaser-facing bridge. `handlers` are presentation-only callbacks keyed by command type.
 * Each callback may return a Promise (for tween/VFX completion). No callback result is read
 * by simulation code, so animation duration can never affect combat outcomes.
 */
export class PhaserPresentationAdapter {
  constructor({ scene = null, handlers = {} } = {}) {
    this.scene = scene;
    this.handlers = { ...handlers };
  }

  async execute(commandValue) {
    const handler = this.handlers[commandValue.type] ?? this.handlers['*'];
    if (!handler) return;
    await handler({ scene: this.scene, command: commandValue });
  }
}

/** Suggested bridge to the existing ROS1-style VFX helpers. */
export function createLegacyVfxHandlers(vfx = {}) {
  const call = (name, fallback = null) => async ({ command }) => {
    const fn = vfx[name] ?? (fallback ? vfx[fallback] : null);
    if (typeof fn === 'function') await fn(command);
  };
  return Object.freeze({
    [PRESENTATION_COMMAND.ACTION_CUE]: call('vfxActCue'),
    [PRESENTATION_COMMAND.ATTACK_IMPACT]: call('vfxDamage'),
    [PRESENTATION_COMMAND.DAMAGE_FEEDBACK]: call('vfxFloatText'),
    [PRESENTATION_COMMAND.HEAL_FEEDBACK]: call('vfxHeal'),
    [PRESENTATION_COMMAND.DODGE_FEEDBACK]: call('vfxDodge'),
    [PRESENTATION_COMMAND.KO_FEEDBACK]: call('vfxKO'),
    [PRESENTATION_COMMAND.CAST_CUE]: call('vfxCastToTargets'),
    [PRESENTATION_COMMAND.COUNTER_CUE]: call('vfxActCue')
  });
}
