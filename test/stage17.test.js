import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_TYPE } from '../src/constants.js';
import {
  PRESENTATION_COMMAND,
  RecordingPresentationAdapter,
  PhaserPresentationAdapter,
  ReplayController,
  buildPresentationTimeline,
  commandsForEvent,
  validateAuthoritativeEventStream
} from '../src/presentation.js';
import { canonicalStringify } from '../src/canonical.js';

function ev(sequence, type, overrides = {}) {
  return Object.freeze({
    eventId: `E${String(sequence + 1).padStart(6, '0')}`,
    sequence,
    parentEventId: null,
    initiativeCycle: 2,
    type,
    actorId: 'H0',
    targetId: 'G0',
    payload: {},
    ...overrides
  });
}

test('MOVE becomes presentation-only MOVE_UNIT command', () => {
  const [c] = commandsForEvent(ev(0, EVENT_TYPE.MOVE, { payload: { from: { row: 3, col: 1 }, to: { row: 3, col: 2 } } }));
  assert.equal(c.type, PRESENTATION_COMMAND.MOVE_UNIT);
  assert.deepEqual(c.payload.to, { row: 3, col: 2 });
});

test('COUNTER_MOVE uses the same motion command with counter kind', () => {
  const [c] = commandsForEvent(ev(0, EVENT_TYPE.COUNTER_MOVE));
  assert.equal(c.type, PRESENTATION_COMMAND.MOVE_UNIT);
  assert.equal(c.payload.kind, 'COUNTER_MOVE');
});

test('damage/heal/crit/ko map to feedback commands', () => {
  assert.equal(commandsForEvent(ev(0, EVENT_TYPE.DAMAGE))[0].type, PRESENTATION_COMMAND.DAMAGE_FEEDBACK);
  assert.equal(commandsForEvent(ev(0, EVENT_TYPE.HEAL))[0].type, PRESENTATION_COMMAND.HEAL_FEEDBACK);
  assert.equal(commandsForEvent(ev(0, EVENT_TYPE.CRIT))[0].type, PRESENTATION_COMMAND.CRIT_FEEDBACK);
  assert.equal(commandsForEvent(ev(0, EVENT_TYPE.KO))[0].type, PRESENTATION_COMMAND.KO_FEEDBACK);
});

test('cast lifecycle maps without altering authoritative event', () => {
  const e = ev(0, EVENT_TYPE.CAST_START, { payload: { completionCycle: 5 } });
  const before = canonicalStringify(e);
  const [c] = commandsForEvent(e);
  assert.equal(c.type, PRESENTATION_COMMAND.CAST_CUE);
  assert.equal(c.payload.completionCycle, 5);
  assert.equal(canonicalStringify(e), before);
});

test('push/pull/teleport map to displacement commands', () => {
  for (const type of [EVENT_TYPE.PUSH, EVENT_TYPE.PULL, EVENT_TYPE.TELEPORT]) {
    const [c] = commandsForEvent(ev(0, type));
    assert.equal(c.type, PRESENTATION_COMMAND.DISPLACE_UNIT);
    assert.equal(c.payload.kind, type);
  }
});

test('status events share status presentation channel', () => {
  for (const type of [EVENT_TYPE.STATUS_APPLY, EVENT_TYPE.STATUS_TICK, EVENT_TYPE.STATUS_EXPIRE, EVENT_TYPE.TAUNT, EVENT_TYPE.BERSERK]) {
    const [c] = commandsForEvent(ev(0, type));
    assert.equal(c.type, PRESENTATION_COMMAND.STATUS_FEEDBACK);
  }
});

test('timeline preserves authoritative event sequence exactly', () => {
  const events = [ev(0, EVENT_TYPE.ATTACK_START), ev(1, EVENT_TYPE.ATTACK_IMPACT, { parentEventId: 'E000001' }), ev(2, EVENT_TYPE.DAMAGE, { parentEventId: 'E000002' })];
  const timeline = buildPresentationTimeline(events);
  assert.deepEqual(timeline.map(c => c.sourceEventId), ['E000001', 'E000002', 'E000003']);
});

test('event stream rejects out-of-order sequences', () => {
  assert.throws(() => validateAuthoritativeEventStream([ev(1, EVENT_TYPE.MOVE), ev(0, EVENT_TYPE.MOVE)]), /strictly increasing/);
});

test('event stream rejects parent that appears after child', () => {
  const child = ev(0, EVENT_TYPE.DAMAGE, { parentEventId: 'E000002' });
  const parent = ev(1, EVENT_TYPE.ATTACK_IMPACT);
  assert.throws(() => validateAuthoritativeEventStream([child, parent]), /parent not yet seen/);
});

test('replay controller executes commands serially in authoritative order', async () => {
  const events = [ev(0, EVENT_TYPE.MOVE), ev(1, EVENT_TYPE.ATTACK_START), ev(2, EVENT_TYPE.DAMAGE)];
  const adapter = new RecordingPresentationAdapter();
  const replay = new ReplayController({ events, adapter });
  await replay.playAll();
  assert.equal(replay.state, 'COMPLETE');
  assert.deepEqual(adapter.executed.map(c => c.sourceSequence), [0,1,2]);
});

test('replay step supports pause/advance without changing command order', async () => {
  const adapter = new RecordingPresentationAdapter();
  const replay = new ReplayController({ events: [ev(0, EVENT_TYPE.MOVE), ev(1, EVENT_TYPE.DAMAGE)], adapter });
  await replay.step();
  assert.equal(replay.cursor, 1);
  assert.equal(replay.state, 'PLAYING');
  await replay.step();
  assert.equal(replay.state, 'COMPLETE');
});

test('async Phaser handler duration cannot reorder presentation commands', async () => {
  const seen = [];
  const adapter = new PhaserPresentationAdapter({ handlers: {
    [PRESENTATION_COMMAND.MOVE_UNIT]: async ({ command }) => { await new Promise(r => setTimeout(r, 5)); seen.push(command.sourceEventId); },
    [PRESENTATION_COMMAND.DAMAGE_FEEDBACK]: async ({ command }) => { seen.push(command.sourceEventId); }
  }});
  const replay = new ReplayController({ events: [ev(0, EVENT_TYPE.MOVE), ev(1, EVENT_TYPE.DAMAGE)], adapter });
  await replay.playAll();
  assert.deepEqual(seen, ['E000001', 'E000002']);
});

test('presentation replay consumes no gameplay RNG because it receives no RNG object', async () => {
  let rngCalls = 0;
  const fakeGameplayRng = { nextFloat(){ rngCalls++; return .5; } };
  const adapter = new RecordingPresentationAdapter();
  const replay = new ReplayController({ events: [ev(0, EVENT_TYPE.DAMAGE)], adapter });
  await replay.playAll();
  assert.equal(rngCalls, 0);
  assert.equal(typeof replay.rng, 'undefined');
  void fakeGameplayRng;
});

test('unknown future event type can be ignored by projection without mutating it', () => {
  const e = { ...ev(0, EVENT_TYPE.MOVE), type: 'FUTURE_EVENT' };
  const before = canonicalStringify(e);
  assert.deepEqual(commandsForEvent(e), []);
  assert.equal(canonicalStringify(e), before);
});

test('timeline construction is deterministic across repeated projections', () => {
  const events = [ev(0, EVENT_TYPE.CAST_START), ev(1, EVENT_TYPE.CAST_COMPLETE, { parentEventId: 'E000001' }), ev(2, EVENT_TYPE.HEAL, { parentEventId: 'E000002', payload: { amount: 55 } })];
  assert.equal(canonicalStringify(buildPresentationTimeline(events)), canonicalStringify(buildPresentationTimeline(structuredClone(events))));
});
