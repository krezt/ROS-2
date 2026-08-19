import { clonePlain, deepFreeze } from './util.js';

export class TraceRecorder {
  #entries = [];
  #nextId = 1;

  record(kind, payload = {}) {
    const entry = deepFreeze({
      traceId: `T${String(this.#nextId).padStart(6, '0')}`,
      kind,
      payload: clonePlain(payload)
    });
    this.#entries.push(entry);
    this.#nextId += 1;
    return entry;
  }

  snapshot() {
    return this.#entries.slice();
  }

  toText() {
    return this.#entries.map((entry) => `${entry.traceId} ${entry.kind} ${JSON.stringify(entry.payload)}`).join('\n');
  }
}
