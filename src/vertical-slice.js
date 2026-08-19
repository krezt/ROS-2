import { PROTOCOL_VERSION, RULESET_VERSION } from './constants.js';
import { invariant } from './errors.js';
import { hashCanonical } from './hash.js';
import { createRoundSimulation } from './simulation.js';
import { createSpellCombatScheduler } from './spell-combat-scheduler.js';
import { createRoundDigest } from './determinism.js';
import { buildPresentationTimeline, RecordingPresentationAdapter, ReplayController } from './presentation.js';

export function verifyRoundPackage(pkg) {
  invariant(pkg && typeof pkg === 'object', 'Round package required.');
  invariant(pkg.protocolVersion === PROTOCOL_VERSION, 'Round package protocolVersion mismatch.');
  invariant(pkg.rulesetVersion === RULESET_VERSION, 'Round package rulesetVersion mismatch.');
  invariant(Number.isInteger(pkg.gameplaySeed) && pkg.gameplaySeed > 0, 'Round package must contain a non-zero server gameplaySeed.');
  const { packageHash, ...withoutHash } = pkg;
  invariant(packageHash === hashCanonical(withoutHash), 'Round package hash mismatch.');
  invariant(Array.isArray(pkg.declarationsA) && Array.isArray(pkg.declarationsB), 'Round package declarations missing.');
  return true;
}

export class VerticalSliceClient {
  constructor({ side, baseState, replayAdapter = new RecordingPresentationAdapter() }) {
    invariant(side === 'A' || side === 'B', 'Client side must be A or B.');
    this.side = side;
    this.baseState = structuredClone(baseState);
    this.replayAdapter = replayAdapter;
    this.lastPackage = null;
    this.lastSimulation = null;
    this.lastDigest = null;
    this.lastTimeline = null;
    this.replayed = false;
  }

  simulateRound(pkg) {
    verifyRoundPackage(pkg);
    invariant(pkg.matchId === this.baseState.matchId, 'Client base-state matchId mismatch.');
    invariant(pkg.roundNumber === this.baseState.roundNumber, 'Client base-state round mismatch.');
    const declarations = [...pkg.declarationsA, ...pkg.declarationsB];
    const state = structuredClone(this.baseState);
    state.protocolVersion = pkg.protocolVersion;
    state.rulesetVersion = pkg.rulesetVersion;
    const sim = createRoundSimulation({ state, declarations, seed: pkg.gameplaySeed });
    createSpellCombatScheduler(sim).runUntilCombatSettled({ maxCycles: 300 });
    const digest = createRoundDigest(sim);
    const events = sim.events.snapshot();
    this.lastPackage = structuredClone(pkg);
    this.lastSimulation = sim;
    this.lastDigest = digest;
    this.lastTimeline = buildPresentationTimeline(events);
    this.replayed = false;
    return Object.freeze({ digest, events, timeline: this.lastTimeline });
  }

  async replayConfirmedRound() {
    invariant(this.lastSimulation, 'No simulated round to replay.');
    const controller = new ReplayController({ events: this.lastSimulation.events.snapshot(), adapter: this.replayAdapter });
    await controller.playAll();
    this.replayed = true;
    return controller;
  }
}

/** Dependency-free in-memory transport that exercises the same message ordering as WebSocket. */
export class InMemoryMatchTransport {
  constructor({ coordinator, clientA, clientB }) {
    this.coordinator = coordinator;
    this.clients = { A: clientA, B: clientB };
    this.log = [];
  }
  lock(side, declarations) {
    const ack = this.coordinator.submitDeclarations(side, declarations);
    this.log.push({ kind: 'round_declarations_locked', side, waitingForOpponent: ack.waitingForOpponent });
    if (!this.coordinator.canReleaseRound()) return null;
    const pkg = this.coordinator.releaseRoundPackage();
    this.log.push({ kind: 'round_package', packageHash: pkg.packageHash, gameplaySeed: pkg.gameplaySeed });
    return pkg;
  }
  simulateBoth(pkg) {
    const a = this.clients.A.simulateRound(pkg);
    const b = this.clients.B.simulateRound(pkg);
    const ra = this.coordinator.submitDigest('A', a.digest);
    this.log.push({ kind: 'round_digest_received', side: 'A' });
    const rb = this.coordinator.submitDigest('B', b.digest);
    this.log.push(rb);
    return { a, b, confirmation: rb };
  }
  async replayBothAfterConfirmation() {
    invariant(this.coordinator.status === 'CONFIRMED', 'Cannot replay unconfirmed round.');
    await Promise.all([this.clients.A.replayConfirmedRound(), this.clients.B.replayConfirmedRound()]);
  }
}
