import { ACTION_KIND, ACTION_RUNTIME_STATE, EVENT_TYPE, LIFE_STATE } from './constants.js';
import { invariant } from './errors.js';
import { advancePursuitOneStep, PURSUIT_RESULT } from './movement.js';
import { clonePlain, deepFreeze } from './util.js';

export const ORDINARY_ADVANCE_RESULT = Object.freeze({
  MOVED: 'MOVED',
  READY_TO_ATTACK: 'READY_TO_ATTACK',
  HOLD: 'HOLD',
  ACTOR_DEAD: 'ACTOR_DEAD',
  NO_MOVEMENT: 'NO_MOVEMENT',
  NO_ATTACKS: 'NO_ATTACKS',
  NO_PATH: 'NO_PATH',
  TARGET_DEAD: 'TARGET_DEAD',
  UNSUPPORTED_ACTION: 'UNSUPPORTED_ACTION',
  TERMINAL_RUNTIME: 'TERMINAL_RUNTIME'
});

const TERMINAL_RUNTIME_STATES = new Set([
  ACTION_RUNTIME_STATE.COMPLETED,
  ACTION_RUNTIME_STATE.INTERRUPTED,
  ACTION_RUNTIME_STATE.IMPOSSIBLE
]);

function runtimeForActor(simulation, actorId) {
  return Object.values(simulation.runtimes).find((runtime) => runtime.actorId === actorId) ?? null;
}

function assertSimulationShape(simulation) {
  invariant(simulation && simulation.state && simulation.rng && simulation.events && simulation.trace,
    'Initiative scheduler requires a Stage-1+ round simulation object.');
  invariant(simulation.runtimes && typeof simulation.runtimes === 'object',
    'Simulation runtimes are required.');
}

/**
 * Deterministic FIFO reaction container.
 *
 * Stage 4 does not yet implement combat reactions such as counters. It does,
 * however, establish the scheduling boundary: pending reactions MUST be fully
 * drained before unrelated ordinary initiative may continue.
 */
export class ReactionQueue {
  #items = [];
  #nextId = 1;

  enqueue({
    type,
    actorId = null,
    targetId = null,
    parentEventId = null,
    payload = {}
  }) {
    invariant(typeof type === 'string' && type.length > 0, 'Reaction type is required.');
    const reaction = deepFreeze({
      reactionId: `Q${String(this.#nextId).padStart(6, '0')}`,
      type,
      actorId,
      targetId,
      parentEventId,
      payload: clonePlain(payload)
    });
    this.#items.push(reaction);
    this.#nextId += 1;
    return reaction;
  }

  dequeue() {
    return this.#items.shift() ?? null;
  }

  snapshot() {
    return this.#items.slice();
  }

  get length() {
    return this.#items.length;
  }

  get hasPending() {
    return this.#items.length > 0;
  }
}

function shuffleTieGroup(group, rng, { cycle, qkn }) {
  const out = group.slice().sort((a, b) => a.actorId.localeCompare(b.actorId));
  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = rng.nextInt(0, i, `QKN_TIE:C${cycle}:QKN${qkn}:slot${i}`);
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

/**
 * Return the ordinary initiative order for the CURRENT cycle.
 *
 * QKN is the only champion initiative stat. Stable actor IDs are used only to
 * canonicalize the input to seeded tie shuffling, never as the final gameplay
 * tiebreaker.
 */
export function orderOrdinaryActorsForCycle(simulation, actorIds, { cycle = simulation.state.round.initiativeCycle } = {}) {
  assertSimulationShape(simulation);
  invariant(Array.isArray(actorIds), 'actorIds must be an array.');

  const candidates = actorIds.map((actorId) => {
    const unit = simulation.state.units[actorId];
    invariant(unit, `Unknown initiative actorId: ${actorId}`);
    return { actorId, qkn: unit.stats.QKN };
  });

  candidates.sort((a, b) => b.qkn - a.qkn || a.actorId.localeCompare(b.actorId));

  const ordered = [];
  let i = 0;
  while (i < candidates.length) {
    let j = i + 1;
    while (j < candidates.length && candidates[j].qkn === candidates[i].qkn) j += 1;
    const group = candidates.slice(i, j);
    if (group.length === 1) ordered.push(group[0]);
    else ordered.push(...shuffleTieGroup(group, simulation.rng, { cycle, qkn: group[0].qkn }));
    i = j;
  }

  return ordered.map(({ actorId }) => actorId);
}

export function isRuntimeTerminal(runtime) {
  return TERMINAL_RUNTIME_STATES.has(runtime.state) || runtime.completed || runtime.interrupted;
}

/**
 * Stage-4 ordinary eligibility. HOLD is intentionally excluded: it has no
 * proactive opportunity but remains available to future reaction systems.
 */
export function getOrdinaryEligibleActorIds(simulation) {
  assertSimulationShape(simulation);
  const ids = [];

  for (const runtime of Object.values(simulation.runtimes)) {
    const unit = simulation.state.units[runtime.actorId];
    if (!unit || unit.lifeState !== LIFE_STATE.ALIVE) continue;
    if (isRuntimeTerminal(runtime)) continue;
    if (runtime.actionKind !== ACTION_KIND.BASIC_ATTACK) continue;
    ids.push(runtime.actorId);
  }

  return ids;
}

function syncEventSequence(simulation) {
  simulation.state.round.eventSequence = simulation.events.length;
}

function markRuntimeActive(simulation, runtime) {
  const ids = new Set(simulation.state.round.activeRuntimeIds);
  ids.add(runtime.runtimeId);
  simulation.state.round.activeRuntimeIds = Array.from(ids).sort();
}

function startRuntimeIfNeeded(simulation, runtime, cycle) {
  if (runtime.state !== ACTION_RUNTIME_STATE.PENDING) return null;
  runtime.state = ACTION_RUNTIME_STATE.ACTIVE;
  markRuntimeActive(simulation, runtime);
  const event = simulation.events.emit(EVENT_TYPE.ACTION_START, {
    initiativeCycle: cycle,
    actorId: runtime.actorId,
    targetId: runtime.declaredPrimaryTargetId,
    payload: {
      declarationId: runtime.declarationId,
      actionId: runtime.actionId,
      actionKind: runtime.actionKind
    }
  });
  syncEventSequence(simulation);
  simulation.trace.record('ACTION_START', {
    cycle,
    actorId: runtime.actorId,
    runtimeId: runtime.runtimeId,
    actionKind: runtime.actionKind,
    targetId: runtime.declaredPrimaryTargetId,
    eventId: event.eventId
  });
  return event;
}

function stage4BasicAttackAdvance(simulation, runtime, cycle) {
  const actor = simulation.state.units[runtime.actorId];
  const targetId = runtime.currentForcedTargetId ?? runtime.declaredPrimaryTargetId;

  invariant(runtime.targetLock && runtime.targetLock.unitId,
    'Stage-4 BASIC_ATTACK requires a UNIT target lock.', { runtimeId: runtime.runtimeId });
  invariant(targetId && simulation.state.units[targetId],
    'Stage-4 BASIC_ATTACK target is missing.', { runtimeId: runtime.runtimeId, targetId });

  const result = advancePursuitOneStep(simulation.state, actor.unitId, targetId, { rng: simulation.rng });
  runtime.metadata.lastOrdinaryCycle = cycle;
  runtime.metadata.lastPursuitResult = result.result;

  if (result.result === PURSUIT_RESULT.MOVE) {
    runtime.metadata.lastStage4Result = ORDINARY_ADVANCE_RESULT.MOVED;
    const event = simulation.events.emit(EVENT_TYPE.MOVE, {
      initiativeCycle: cycle,
      actorId: actor.unitId,
      targetId,
      payload: {
        from: result.from,
        to: result.to,
        movementBefore: result.movementBefore,
        movementAfter: result.movementAfter,
        targetDistanceBefore: result.targetDistanceBefore,
        targetDistanceAfter: result.targetDistanceAfter,
        nowInRange: result.nowInRange,
        pursuitTargetId: targetId
      }
    });

    syncEventSequence(simulation);
    simulation.trace.record('ORDINARY_MOVE', {
      cycle,
      actorId: actor.unitId,
      targetId,
      qkn: actor.stats.QKN,
      from: result.from,
      to: result.to,
      movementBefore: result.movementBefore,
      movementAfter: result.movementAfter,
      targetDistanceAfter: result.targetDistanceAfter,
      nowInRange: result.nowInRange,
      eventId: event.eventId
    });

    return Object.freeze({
      actorId: actor.unitId,
      runtimeId: runtime.runtimeId,
      result: ORDINARY_ADVANCE_RESULT.MOVED,
      pursuitResult: result.result,
      moved: true,
      eventId: event.eventId,
      from: result.from,
      to: result.to,
      nowInRange: result.nowInRange
    });
  }

  const mapped = {
    [PURSUIT_RESULT.ALREADY_IN_RANGE]: ORDINARY_ADVANCE_RESULT.READY_TO_ATTACK,
    [PURSUIT_RESULT.NO_MOVEMENT]: ORDINARY_ADVANCE_RESULT.NO_MOVEMENT,
    [PURSUIT_RESULT.NO_ATTACKS]: ORDINARY_ADVANCE_RESULT.NO_ATTACKS,
    [PURSUIT_RESULT.NO_PATH]: ORDINARY_ADVANCE_RESULT.NO_PATH,
    [PURSUIT_RESULT.TARGET_DEAD]: ORDINARY_ADVANCE_RESULT.TARGET_DEAD
  }[result.result];

  invariant(mapped, `Unhandled pursuit result: ${result.result}`);
  runtime.metadata.lastStage4Result = mapped;
  simulation.trace.record('ORDINARY_NO_MOVE', {
    cycle,
    actorId: actor.unitId,
    targetId,
    qkn: actor.stats.QKN,
    result: mapped,
    pursuitResult: result.result,
    movementRemaining: actor.resources.movementRemaining,
    attacksRemaining: actor.resources.attacksRemaining,
    targetDistance: result.targetDistanceAfter
  });

  return Object.freeze({
    actorId: actor.unitId,
    runtimeId: runtime.runtimeId,
    result: mapped,
    pursuitResult: result.result,
    moved: false,
    eventId: null,
    from: result.from,
    to: null,
    nowInRange: result.result === PURSUIT_RESULT.ALREADY_IN_RANGE
  });
}

export function advanceOrdinaryRuntime(simulation, actorId, { cycle = simulation.state.round.initiativeCycle } = {}) {
  assertSimulationShape(simulation);
  const actor = simulation.state.units[actorId];
  invariant(actor, `Unknown ordinary actor: ${actorId}`);
  const runtime = runtimeForActor(simulation, actorId);
  invariant(runtime, `No runtime for actor: ${actorId}`);

  if (actor.lifeState !== LIFE_STATE.ALIVE) {
    return Object.freeze({ actorId, runtimeId: runtime.runtimeId, result: ORDINARY_ADVANCE_RESULT.ACTOR_DEAD, moved: false });
  }
  if (isRuntimeTerminal(runtime)) {
    return Object.freeze({ actorId, runtimeId: runtime.runtimeId, result: ORDINARY_ADVANCE_RESULT.TERMINAL_RUNTIME, moved: false });
  }
  if (runtime.actionKind === ACTION_KIND.HOLD) {
    return Object.freeze({ actorId, runtimeId: runtime.runtimeId, result: ORDINARY_ADVANCE_RESULT.HOLD, moved: false });
  }

  startRuntimeIfNeeded(simulation, runtime, cycle);

  if (runtime.actionKind === ACTION_KIND.BASIC_ATTACK) {
    invariant(runtime.targetLock?.unitId && runtime.targetLock.unitId === runtime.declaredPrimaryTargetId,
      'BASIC_ATTACK declaration/runtime target lock mismatch.', { runtimeId: runtime.runtimeId });
    return stage4BasicAttackAdvance(simulation, runtime, cycle);
  }

  // Spell/item/ability advancement belongs to later stages. They remain valid
  // runtimes but Stage 4 deliberately does not invent timing semantics for them.
  runtime.metadata.lastOrdinaryCycle = cycle;
  runtime.metadata.lastStage4Result = ORDINARY_ADVANCE_RESULT.UNSUPPORTED_ACTION;
  simulation.trace.record('ORDINARY_UNSUPPORTED_STAGE4', {
    cycle,
    actorId,
    actionKind: runtime.actionKind,
    actionId: runtime.actionId
  });
  return Object.freeze({
    actorId,
    runtimeId: runtime.runtimeId,
    result: ORDINARY_ADVANCE_RESULT.UNSUPPORTED_ACTION,
    moved: false
  });
}

export class InitiativeScheduler {
  #simulation;
  #reactionResolver;
  #ordinaryAdvancer;

  constructor(simulation, { reactionResolver = null, ordinaryAdvancer = advanceOrdinaryRuntime } = {}) {
    assertSimulationShape(simulation);
    invariant(typeof ordinaryAdvancer === 'function', 'ordinaryAdvancer must be a function.');
    this.#simulation = simulation;
    this.reactions = new ReactionQueue();
    this.#reactionResolver = reactionResolver;
    this.#ordinaryAdvancer = ordinaryAdvancer;
  }

  get simulation() {
    return this.#simulation;
  }

  drainReactions({ cycle = this.#simulation.state.round.initiativeCycle } = {}) {
    let count = 0;
    while (this.reactions.hasPending) {
      invariant(typeof this.#reactionResolver === 'function',
        'Pending reactions require a reactionResolver before ordinary initiative may continue.');
      const reaction = this.reactions.dequeue();
      this.#simulation.trace.record('REACTION_BEGIN', {
        cycle,
        reactionId: reaction.reactionId,
        type: reaction.type,
        actorId: reaction.actorId,
        targetId: reaction.targetId,
        parentEventId: reaction.parentEventId
      });
      this.#reactionResolver(reaction, {
        simulation: this.#simulation,
        scheduler: this,
        cycle
      });
      this.#simulation.trace.record('REACTION_END', {
        cycle,
        reactionId: reaction.reactionId,
        type: reaction.type
      });
      count += 1;
    }
    return count;
  }

  advanceCycle() {
    const simulation = this.#simulation;
    const cycle = simulation.state.round.initiativeCycle;
    const reactionsBefore = this.drainReactions({ cycle });

    const eligibleAtCycleStart = getOrdinaryEligibleActorIds(simulation);
    const order = orderOrdinaryActorsForCycle(simulation, eligibleAtCycleStart, { cycle });

    simulation.trace.record('CYCLE_START', {
      cycle,
      eligibleActorIds: eligibleAtCycleStart.slice().sort(),
      initiativeOrder: order.slice()
    });

    const advancements = [];
    let reactionsResolved = reactionsBefore;
    let movementCount = 0;

    for (const actorId of order) {
      // A prior actor's future Stage-5+ reaction may have changed this actor's
      // state. Re-evaluate the actor immediately before its ordinary chance.
      const runtime = runtimeForActor(simulation, actorId);
      const unit = simulation.state.units[actorId];
      if (!runtime || !unit || unit.lifeState !== LIFE_STATE.ALIVE || isRuntimeTerminal(runtime)) {
        simulation.trace.record('ORDINARY_SKIPPED_AFTER_REEVALUATION', { cycle, actorId });
        continue;
      }

      const advancement = this.#ordinaryAdvancer(simulation, actorId, { cycle, scheduler: this });
      advancements.push(advancement);
      if (advancement.moved) movementCount += 1;

      // The reaction contract is already enforced even though Stage 4 itself
      // does not yet generate counters/procs.
      reactionsResolved += this.drainReactions({ cycle });
    }

    simulation.trace.record('CYCLE_END', {
      cycle,
      initiativeOrder: order.slice(),
      movementCount,
      reactionsResolved,
      advancementResults: advancements.map((x) => ({ actorId: x.actorId, result: x.result }))
    });

    simulation.state.round.initiativeCycle += 1;

    return Object.freeze({
      cycle,
      initiativeOrder: order.slice(),
      advancements: advancements.slice(),
      movementCount,
      reactionsResolved,
      madeStage4Progress: movementCount > 0
    });
  }

  /**
   * Run movement-era initiative until a complete cycle makes no movement.
   * This is a Stage-4 helper, NOT the final ROS round-completion rule. Stage 5+
   * will continue from READY_TO_ATTACK and other unresolved action states.
   */
  runUntilMovementStalled({ maxCycles = 1000 } = {}) {
    invariant(Number.isInteger(maxCycles) && maxCycles > 0, 'maxCycles must be a positive integer.');
    const cycles = [];
    for (let i = 0; i < maxCycles; i += 1) {
      const result = this.advanceCycle();
      cycles.push(result);
      if (!result.madeStage4Progress) {
        return Object.freeze({
          stalled: true,
          cycles,
          finalInitiativeCycle: this.#simulation.state.round.initiativeCycle
        });
      }
    }
    throw new Error(`Stage-4 initiative watchdog exceeded ${maxCycles} cycles without stalling.`);
  }
}

export function createInitiativeScheduler(simulation, options = {}) {
  return new InitiativeScheduler(simulation, options);
}
