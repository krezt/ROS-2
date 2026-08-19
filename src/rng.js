import { invariant } from './errors.js';

/**
 * Deterministic xorshift32 gameplay RNG.
 *
 * This intentionally preserves the algorithm family used by ROS 1.x while
 * removing global state and adding draw accounting. Gameplay code should
 * receive an instance explicitly; presentation code must never consume it.
 */
export class GameplayRng {
  #initialSeed;
  #state;
  #drawCount = 0;
  #onDraw;

  constructor(seed, { onDraw = null } = {}) {
    const normalized = Number(seed) >>> 0;
    this.#initialSeed = normalized || 1;
    this.#state = this.#initialSeed;
    this.#onDraw = typeof onDraw === 'function' ? onDraw : null;
  }

  get initialSeed() { return this.#initialSeed; }
  get state() { return this.#state >>> 0; }
  get drawCount() { return this.#drawCount; }

  nextFloat(reason = 'UNSPECIFIED') {
    let x = this.#state >>> 0;
    x ^= (x << 13) >>> 0;
    x ^= x >>> 17;
    x ^= (x << 5) >>> 0;
    this.#state = x >>> 0;
    this.#drawCount += 1;
    const value = (this.#state >>> 0) / 0x100000000;

    this.#onDraw?.({
      draw: this.#drawCount,
      reason,
      state: this.state,
      value
    });

    return value;
  }

  nextInt(min, max, reason = 'UNSPECIFIED_INT') {
    invariant(Number.isInteger(min) && Number.isInteger(max) && max >= min,
      'GameplayRng.nextInt requires integer min/max with max >= min.', { min, max });
    return Math.floor(this.nextFloat(reason) * (max - min + 1)) + min;
  }

  chance(probability, reason = 'UNSPECIFIED_CHANCE') {
    invariant(typeof probability === 'number' && probability >= 0 && probability <= 1,
      'GameplayRng.chance probability must be between 0 and 1.', { probability });
    return this.nextFloat(reason) < probability;
  }

  choose(items, reason = 'UNSPECIFIED_CHOICE') {
    invariant(Array.isArray(items) && items.length > 0, 'GameplayRng.choose requires a non-empty array.');
    return items[this.nextInt(0, items.length - 1, reason)];
  }

  snapshot() {
    return Object.freeze({
      initialSeed: this.initialSeed,
      state: this.state,
      drawCount: this.drawCount
    });
  }
}
