import { EVENT_TYPE } from './constants.js';
import { invariant } from './errors.js';
import { clonePlain, deepFreeze } from './util.js';

export class EventRecorder {
  #events = [];
  #nextId = 1;

  emit(type, {
    initiativeCycle = 0,
    actorId = null,
    targetId = null,
    parentEventId = null,
    payload = {}
  } = {}) {
    invariant(Object.values(EVENT_TYPE).includes(type), `Unknown event type: ${type}`);
    invariant(Number.isInteger(initiativeCycle) && initiativeCycle >= 0,
      'initiativeCycle must be a non-negative integer.');

    if (parentEventId !== null) {
      invariant(this.#events.some((event) => event.eventId === parentEventId),
        `parentEventId does not exist: ${parentEventId}`);
    }

    const event = deepFreeze({
      eventId: `E${String(this.#nextId).padStart(6, '0')}`,
      sequence: this.#nextId - 1,
      parentEventId,
      initiativeCycle,
      type,
      actorId,
      targetId,
      payload: clonePlain(payload)
    });

    this.#events.push(event);
    this.#nextId += 1;
    return event;
  }

  snapshot() {
    return this.#events.slice();
  }

  get length() {
    return this.#events.length;
  }
}
