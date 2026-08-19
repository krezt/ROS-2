import { EVENT_TYPE, LIFE_STATE, TARGET_TYPE } from './constants.js';
import { createActionRuntime } from './declarations.js';
import { invariant } from './errors.js';
import { EventRecorder } from './events.js';
import { hashCanonical } from './hash.js';
import { GameplayRng } from './rng.js';
import { cloneBattleState } from './state.js';
import { TraceRecorder } from './trace.js';
import { validateDeclarationTargetAcquisition } from './targeting.js';

function validateDeclarations(state, declarations) {
  invariant(Array.isArray(declarations), 'declarations must be an array.');

  const seenActors = new Set();
  const seenDeclarationIds = new Set();

  for (const declaration of declarations) {
    invariant(declaration.roundNumber === state.roundNumber,
      'Declaration round does not match battle round.', {
        declarationRound: declaration.roundNumber,
        battleRound: state.roundNumber,
        declarationId: declaration.declarationId
      });
    invariant(state.units[declaration.actorId], `Unknown declaration actorId: ${declaration.actorId}`);
    invariant(state.units[declaration.actorId].lifeState === LIFE_STATE.ALIVE,
      `Dead champions cannot submit a proactive declaration: ${declaration.actorId}`);
    invariant(!seenActors.has(declaration.actorId),
      `Only one declaration per actor is allowed: ${declaration.actorId}`);
    invariant(!seenDeclarationIds.has(declaration.declarationId),
      `Duplicate declarationId: ${declaration.declarationId}`);
    if (declaration.target?.type === TARGET_TYPE.UNIT) {
      invariant(state.units[declaration.target.unitId],
        `Unknown UNIT target: ${declaration.target.unitId}`);
      const acquisition = validateDeclarationTargetAcquisition(state, declaration);
      invariant(acquisition.legal,
        `Illegal direct target acquisition: ${declaration.actorId} -> ${declaration.target.unitId} (${acquisition.reason})`,
        { actorId: declaration.actorId, targetId: declaration.target.unitId, reason: acquisition.reason });
    }

    seenActors.add(declaration.actorId);
    seenDeclarationIds.add(declaration.declarationId);
  }

  const livingActorIds = Object.values(state.units)
    .filter((unit) => unit.lifeState === LIFE_STATE.ALIVE && unit.entityKind !== 'SUMMON')
    .map((unit) => unit.unitId);
  const missing = livingActorIds.filter((unitId) => !seenActors.has(unitId));
  invariant(missing.length === 0,
    'Every living champion must have exactly one declaration; use HOLD for no proactive action.', { missing });
}

function declarationOrder(state, declaration) {
  const unit = state.units[declaration.actorId];
  return [unit.side === 'A' ? 0 : 1, unit.draftSlot, unit.unitId];
}

function compareDeclarations(state, a, b) {
  const aa = declarationOrder(state, a);
  const bb = declarationOrder(state, b);
  for (let i = 0; i < aa.length; i += 1) {
    if (aa[i] < bb[i]) return -1;
    if (aa[i] > bb[i]) return 1;
  }
  return 0;
}

/**
 * Stage 1 entry point.
 *
 * This deliberately does NOT resolve combat yet. It proves the deterministic
 * data boundary the later scheduler will operate inside.
 */
export function createRoundSimulation({ state, declarations, seed }) {
  const workingState = cloneBattleState(state);
  validateDeclarations(workingState, declarations);

  const trace = new TraceRecorder();
  const events = new EventRecorder();
  const rng = new GameplayRng(seed, {
    onDraw: (draw) => trace.record('RNG_DRAW', draw)
  });

  // Canonical package order: Side A, then Side B; draft slot; stable unit ID.
  // This is serialization order, not combat initiative order.
  const orderedDeclarations = declarations.slice().sort((a, b) => compareDeclarations(workingState, a, b));
  const runtimes = {};
  for (const declaration of orderedDeclarations) {
    const runtime = createActionRuntime(declaration);
    invariant(!runtimes[runtime.runtimeId], `Duplicate runtimeId: ${runtime.runtimeId}`);
    runtimes[runtime.runtimeId] = runtime;
  }

  const startStateHash = hashCanonical(workingState);
  const declarationsHash = hashCanonical(orderedDeclarations);

  events.emit(EVENT_TYPE.ROUND_START, {
    initiativeCycle: 0,
    payload: {
      roundNumber: workingState.roundNumber,
      seed: rng.initialSeed,
      startStateHash,
      declarationsHash
    }
  });
  workingState.round.eventSequence = events.length;

  trace.record('ROUND_BOOTSTRAP', {
    roundNumber: workingState.roundNumber,
    seed: rng.initialSeed,
    startStateHash,
    declarationsHash,
    runtimeIds: Object.keys(runtimes).sort()
  });

  return {
    state: workingState,
    declarations: orderedDeclarations,
    runtimes,
    rng,
    events,
    trace,
    startStateHash,
    declarationsHash
  };
}

export function snapshotRoundSimulation(simulation) {
  const events = simulation.events.snapshot();
  const trace = simulation.trace.snapshot();
  return Object.freeze({
    stateHash: hashCanonical(simulation.state),
    declarationsHash: simulation.declarationsHash,
    eventHash: hashCanonical(events),
    rng: simulation.rng.snapshot(),
    events,
    trace
  });
}
