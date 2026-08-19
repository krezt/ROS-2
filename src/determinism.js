import { canonicalStringify } from './canonical.js';
import { invariant } from './errors.js';
import { hashCanonical } from './hash.js';
import { snapshotRoundSimulation } from './simulation.js';

export const DIGEST_STATUS = Object.freeze({
  MATCH: 'MATCH',
  DESYNC: 'DESYNC'
});

/**
 * Canonical round digest intended to be small enough for the relay/server to
 * compare without understanding combat semantics.
 */
export function createRoundDigest(simulation) {
  const snap = snapshotRoundSimulation(simulation);
  return Object.freeze({
    protocolVersion: simulation.state.protocolVersion,
    rulesetVersion: simulation.state.rulesetVersion,
    matchId: simulation.state.matchId,
    roundNumber: simulation.state.roundNumber,
    declarationsHash: snap.declarationsHash,
    finalStateHash: snap.stateHash,
    eventStreamHash: snap.eventHash,
    gameplayRngDrawCount: snap.rng.drawCount,
    finalGameplayRngState: snap.rng.state
  });
}

export function compareRoundDigests(a, b) {
  invariant(a && b, 'Two round digests are required.');
  const fields = [
    'protocolVersion',
    'rulesetVersion',
    'matchId',
    'roundNumber',
    'declarationsHash',
    'finalStateHash',
    'eventStreamHash',
    'gameplayRngDrawCount',
    'finalGameplayRngState'
  ];
  const mismatches = [];
  for (const field of fields) {
    if (a[field] !== b[field]) mismatches.push(Object.freeze({ field, a: a[field], b: b[field] }));
  }
  return Object.freeze({
    status: mismatches.length === 0 ? DIGEST_STATUS.MATCH : DIGEST_STATUS.DESYNC,
    match: mismatches.length === 0,
    mismatches
  });
}

export function assertRoundDigestsMatch(a, b) {
  const comparison = compareRoundDigests(a, b);
  invariant(comparison.match, 'DESYNC: round digests do not match.', { mismatches: comparison.mismatches });
  return comparison;
}

/**
 * Hash a round package independently of object insertion order. This is the
 * payload both clients should receive before simulation begins.
 */
export function hashRoundPackage(roundPackage) {
  return hashCanonical(roundPackage);
}

/**
 * Validate that a value can cross the authoritative boundary and reproduce
 * byte-identical canonical serialization after JSON transport.
 */
export function canonicalTransportCheck(value) {
  const before = canonicalStringify(value);
  const transported = JSON.parse(JSON.stringify(value));
  const after = canonicalStringify(transported);
  return Object.freeze({
    match: before === after,
    beforeHash: hashCanonical(value),
    afterHash: hashCanonical(transported),
    canonical: before
  });
}

/**
 * Replay the same factory/executor repeatedly. The factory must return a fresh
 * simulation each time. Stops at the first mismatch and reports its index.
 */
export function replayDeterminism({ repetitions, createSimulation, execute }) {
  invariant(Number.isInteger(repetitions) && repetitions >= 2, 'repetitions must be an integer >= 2.');
  invariant(typeof createSimulation === 'function', 'createSimulation must be a function.');
  invariant(typeof execute === 'function', 'execute must be a function.');

  let baseline = null;
  for (let i = 0; i < repetitions; i += 1) {
    const simulation = createSimulation(i);
    execute(simulation, i);
    const digest = createRoundDigest(simulation);
    if (baseline === null) {
      baseline = digest;
      continue;
    }
    const comparison = compareRoundDigests(baseline, digest);
    if (!comparison.match) {
      return Object.freeze({
        passed: false,
        repetitionsRequested: repetitions,
        repetitionsCompleted: i + 1,
        mismatchAt: i,
        baseline,
        digest,
        comparison
      });
    }
  }
  return Object.freeze({
    passed: true,
    repetitionsRequested: repetitions,
    repetitionsCompleted: repetitions,
    mismatchAt: null,
    baseline
  });
}

/**
 * Run paired simulations over a sequence of seeds. Useful for high-volume
 * deterministic stress tests while still varying gameplay decisions.
 */
export function seedSweepDeterminism({ seeds, createPair, execute }) {
  invariant(Array.isArray(seeds) && seeds.length > 0, 'seeds must be a non-empty array.');
  invariant(typeof createPair === 'function', 'createPair must be a function.');
  invariant(typeof execute === 'function', 'execute must be a function.');
  const failures = [];
  let totalRngDraws = 0;
  let totalEvents = 0;

  for (const seed of seeds) {
    const pair = createPair(seed);
    invariant(Array.isArray(pair) && pair.length === 2, 'createPair(seed) must return [simulationA, simulationB].');
    const [a, b] = pair;
    execute(a, seed);
    execute(b, seed);
    totalRngDraws += a.rng.drawCount + b.rng.drawCount;
    totalEvents += a.events.length + b.events.length;
    const comparison = compareRoundDigests(createRoundDigest(a), createRoundDigest(b));
    if (!comparison.match) failures.push(Object.freeze({ seed, comparison }));
  }

  return Object.freeze({
    passed: failures.length === 0,
    seedsTested: seeds.length,
    failures,
    totalRngDraws,
    totalEvents
  });
}
