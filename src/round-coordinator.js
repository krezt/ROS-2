import { canonicalStringify } from './canonical.js';
import { hashCanonical } from './hash.js';
import { compareRoundDigests } from './determinism.js';
import { invariant } from './errors.js';
import { PROTOCOL_VERSION, RULESET_VERSION } from './constants.js';

export const ROUND_COORDINATOR_STATUS = Object.freeze({
  COLLECTING: 'COLLECTING',
  RELEASED: 'RELEASED',
  CONFIRMED: 'CONFIRMED',
  DESYNC: 'DESYNC',
  HALTED: 'HALTED'
});

function defaultRandomBytes(length) {
  invariant(globalThis.crypto && typeof globalThis.crypto.getRandomValues === 'function', 'Secure random source unavailable.');
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}

export function generateServerRoundSeed(randomBytes = defaultRandomBytes) {
  const bytes = randomBytes(4);
  invariant(bytes && bytes.length >= 4, 'Server seed source must return at least 4 bytes.');
  const value = (((bytes[0] << 24) >>> 0) | (bytes[1] << 16) | (bytes[2] << 8) | bytes[3]) >>> 0;
  return value === 0 ? 1 : value;
}

function normalizeSide(side) {
  invariant(side === 'A' || side === 'B', 'side must be A or B.');
  return side;
}

function immutableJson(value) {
  return Object.freeze(JSON.parse(JSON.stringify(value)));
}

export class RoundCoordinator {
  constructor({
    protocolVersion = PROTOCOL_VERSION,
    rulesetVersion = RULESET_VERSION,
    matchId,
    seedFactory = generateServerRoundSeed,
    roundNumber = 1
  } = {}) {
    invariant(typeof matchId === 'string' && matchId.length > 0, 'matchId is required.');
    invariant(typeof seedFactory === 'function', 'seedFactory must be a function.');
    invariant(Number.isInteger(roundNumber) && roundNumber >= 1, 'roundNumber must be >= 1.');
    this.protocolVersion = protocolVersion;
    this.rulesetVersion = rulesetVersion;
    this.matchId = matchId;
    this.seedFactory = seedFactory;
    this.roundNumber = roundNumber;
    this.status = ROUND_COORDINATOR_STATUS.COLLECTING;
    this.submissions = new Map();
    this.digests = new Map();
    this.roundPackage = null;
    this.confirmation = null;
  }

  submitDeclarations(side, declarations, metadata = {}) {
    normalizeSide(side);
    invariant(this.status === ROUND_COORDINATOR_STATUS.COLLECTING,
      'Declarations are only accepted while collecting.');
    invariant(!this.submissions.has(side), `Side ${side} already submitted declarations this round.`);
    invariant(Array.isArray(declarations), 'declarations must be an array.');
    const submission = immutableJson({
      side,
      declarations,
      lockedAtServerSequence: metadata.lockedAtServerSequence ?? null
    });
    this.submissions.set(side, submission);
    return Object.freeze({
      accepted: true,
      side,
      waitingForOpponent: this.submissions.size < 2,
      released: this.submissions.size === 2
    });
  }

  canReleaseRound() {
    return this.status === ROUND_COORDINATOR_STATUS.COLLECTING &&
      this.submissions.has('A') && this.submissions.has('B');
  }

  releaseRoundPackage(extra = {}) {
    invariant(this.canReleaseRound(), 'Both sides must lock declarations before release.');
    const seed = this.seedFactory() >>> 0;
    invariant(seed !== 0, 'Server round seed must be non-zero.');
    const packageWithoutHash = {
      protocolVersion: this.protocolVersion,
      rulesetVersion: this.rulesetVersion,
      matchId: this.matchId,
      roundNumber: this.roundNumber,
      gameplaySeed: seed,
      declarationsA: this.submissions.get('A').declarations,
      declarationsB: this.submissions.get('B').declarations,
      deadlineMetadata: extra.deadlineMetadata ?? null
    };
    const packageHash = hashCanonical(packageWithoutHash);
    this.roundPackage = immutableJson({ ...packageWithoutHash, packageHash });
    this.status = ROUND_COORDINATOR_STATUS.RELEASED;
    return this.roundPackage;
  }

  submitDigest(side, digest) {
    normalizeSide(side);
    invariant(this.status === ROUND_COORDINATOR_STATUS.RELEASED,
      'Round digests are only accepted after package release and before confirmation.');
    invariant(!this.digests.has(side), `Side ${side} already submitted a digest this round.`);
    invariant(digest && typeof digest === 'object', 'digest is required.');
    invariant(digest.matchId === this.matchId, 'Digest matchId mismatch.');
    invariant(digest.roundNumber === this.roundNumber, 'Digest roundNumber mismatch.');
    invariant(digest.protocolVersion === this.protocolVersion, 'Digest protocolVersion mismatch.');
    invariant(digest.rulesetVersion === this.rulesetVersion, 'Digest rulesetVersion mismatch.');
    this.digests.set(side, immutableJson(digest));

    if (this.digests.size < 2) {
      return Object.freeze({ accepted: true, side, waitingForOpponent: true });
    }

    const comparison = compareRoundDigests(this.digests.get('A'), this.digests.get('B'));
    if (!comparison.match) {
      this.status = ROUND_COORDINATOR_STATUS.DESYNC;
      this.confirmation = Object.freeze({
        kind: 'round_desync',
        matchId: this.matchId,
        roundNumber: this.roundNumber,
        mismatches: comparison.mismatches
      });
      return this.confirmation;
    }

    this.status = ROUND_COORDINATOR_STATUS.CONFIRMED;
    this.confirmation = Object.freeze({
      kind: 'round_confirmed',
      matchId: this.matchId,
      roundNumber: this.roundNumber,
      finalStateHash: this.digests.get('A').finalStateHash,
      eventStreamHash: this.digests.get('A').eventStreamHash,
      gameplayRngDrawCount: this.digests.get('A').gameplayRngDrawCount,
      finalGameplayRngState: this.digests.get('A').finalGameplayRngState
    });
    return this.confirmation;
  }

  nextRound() {
    invariant(this.status === ROUND_COORDINATOR_STATUS.CONFIRMED,
      'Cannot advance until the current round is confirmed.');
    this.roundNumber += 1;
    this.status = ROUND_COORDINATOR_STATUS.COLLECTING;
    this.submissions.clear();
    this.digests.clear();
    this.roundPackage = null;
    this.confirmation = null;
    return this.roundNumber;
  }

  halt(reason = 'HALTED_BY_SERVER') {
    this.status = ROUND_COORDINATOR_STATUS.HALTED;
    return Object.freeze({ kind: 'match_halted', matchId: this.matchId, roundNumber: this.roundNumber, reason });
  }

  snapshot() {
    return Object.freeze(JSON.parse(canonicalStringify({
      protocolVersion: this.protocolVersion,
      rulesetVersion: this.rulesetVersion,
      matchId: this.matchId,
      roundNumber: this.roundNumber,
      status: this.status,
      submittedSides: [...this.submissions.keys()].sort(),
      digestSides: [...this.digests.keys()].sort(),
      roundPackage: this.roundPackage,
      confirmation: this.confirmation
    })));
  }
}

export class MatchRoom {
  constructor({ id, maxPlayers = 2 } = {}) {
    invariant(typeof id === 'string' && id.length > 0, 'Room id is required.');
    invariant(maxPlayers === 2, 'ROS 2.0 active match rooms are capped at two players.');
    this.id = id;
    this.maxPlayers = maxPlayers;
    this.players = new Map();
  }

  addPlayer(playerId) {
    invariant(typeof playerId === 'string' && playerId.length > 0, 'playerId is required.');
    invariant(!this.players.has(playerId), 'Player already in room.');
    invariant(this.players.size < this.maxPlayers, 'ROOM_FULL');
    const side = this.players.size === 0 ? 'A' : 'B';
    this.players.set(playerId, side);
    return side;
  }

  removePlayer(playerId) {
    const side = this.players.get(playerId) ?? null;
    this.players.delete(playerId);
    return side;
  }

  sideOf(playerId) {
    return this.players.get(playerId) ?? null;
  }

  isReady() {
    return this.players.size === 2;
  }
}
