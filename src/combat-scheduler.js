import { ACTION_KIND, ACTION_RUNTIME_STATE, EVENT_TYPE, LIFE_STATE } from './constants.js';
import { invariant } from './errors.js';
import {
  advanceBasicCombatRuntime,
  dumpRemainingBasicAttacks,
  getNonTerminalBasicRuntimes,
  reconcileDeadActorRuntimes,
  runtimeHasMeaningfulRangeMaintenance
} from './combat.js';
import { InitiativeScheduler } from './scheduler.js';
import { enqueueCounterForAttack, resolveCounterReaction } from './counters.js';
import { getNonTerminalSpellRuntimes, interruptSpell } from './spells.js';
import { proactiveControlGate, hasControlStatus, CONTROL_TYPE } from './controls.js';
import { applyBasicStyleActionStartOverrides, basicStyleReadyCycle } from './rule-overrides.js';

function runtimeForActor(simulation, actorId) {
  return Object.values(simulation.runtimes).find((runtime) => runtime.actorId === actorId) ?? null;
}

function markRuntimeActive(simulation, runtime) {
  const ids = new Set(simulation.state.round.activeRuntimeIds);
  ids.add(runtime.runtimeId);
  simulation.state.round.activeRuntimeIds = Array.from(ids).sort();
}

function ensureActionStarted(simulation, actorId, cycle) {
  const runtime = runtimeForActor(simulation, actorId);
  if (!runtime || runtime.state !== ACTION_RUNTIME_STATE.PENDING) return;
  runtime.state = ACTION_RUNTIME_STATE.ACTIVE;
  markRuntimeActive(simulation, runtime);
  const event = simulation.events.emit(EVENT_TYPE.ACTION_START, {
    initiativeCycle: cycle,
    actorId,
    targetId: runtime.declaredPrimaryTargetId,
    payload: {
      declarationId: runtime.declarationId,
      actionId: runtime.actionId,
      actionKind: runtime.actionKind
    }
  });
  simulation.state.round.eventSequence = simulation.events.length;
  runtime.metadata.actionStartEventId = event.eventId;
  applyBasicStyleActionStartOverrides(simulation, actorId, { cycle, parentEventId: event.eventId });
  simulation.trace.record('ACTION_START', {
    cycle,
    actorId,
    runtimeId: runtime.runtimeId,
    actionKind: runtime.actionKind,
    targetId: runtime.declaredPrimaryTargetId,
    eventId: event.eventId
  });
}

function combatAdvancer(simulation, actorId, { cycle, scheduler, countersEnabled = true }) {
  const runtime = runtimeForActor(simulation, actorId);
  invariant(runtime, `No runtime for actor: ${actorId}`);
  const actor = simulation.state.units[actorId];

  if (!actor || actor.lifeState !== LIFE_STATE.ALIVE) {
    return Object.freeze({ actorId, runtimeId: runtime.runtimeId, result: 'ACTOR_DEAD', moved: false, attacked: false });
  }
  if (runtime.actionKind !== ACTION_KIND.BASIC_ATTACK) {
    return Object.freeze({ actorId, runtimeId: runtime.runtimeId, result: 'UNSUPPORTED_ACTION', moved: false, attacked: false });
  }

  const gate = proactiveControlGate(simulation, actorId, { cycle });
  if (!gate.allowed) {
    simulation.trace.record('ORDINARY_CONTROL_SUPPRESSED', { cycle, actorId, reason: gate.reason });
    return Object.freeze({ actorId, runtimeId: runtime.runtimeId, result: gate.reason, moved: false, attacked: false });
  }

  const readyCycle = basicStyleReadyCycle(simulation, actorId);
  if (cycle < readyCycle) {
    simulation.trace.record('BASIC_STYLE_STARTUP_WAIT', { cycle, actorId, readyCycle });
    return Object.freeze({ actorId, runtimeId: runtime.runtimeId, result: 'WAIT_STARTUP_DELAY', moved: false, attacked: false, readyCycle });
  }

  ensureActionStarted(simulation, actorId, cycle);
  const result = advanceBasicCombatRuntime(simulation, actorId, { cycle });
  if (result.attack?.killed) {
    interruptSpell(simulation, result.attack.targetId, {
      cycle,
      reason: 'DEATH',
      parentEventId: result.attack.damageEventId ?? result.attack.impactEventId ?? result.attack.attackStartEventId
    });
  }
  if (countersEnabled && result.attack) enqueueCounterForAttack(scheduler, result.attack);
  return result;
}

export class CombatScheduler {
  #simulation;
  #initiative;

  constructor(simulation, { reactionResolver = resolveCounterReaction, countersEnabled = true } = {}) {
    this.#simulation = simulation;
    this.countersEnabled = countersEnabled;
    this.#initiative = new InitiativeScheduler(simulation, {
      reactionResolver,
      ordinaryAdvancer: (sim, actorId, ctx) => combatAdvancer(sim, actorId, { ...ctx, countersEnabled })
    });
  }

  get simulation() { return this.#simulation; }
  get reactions() { return this.#initiative.reactions; }

  drainReactions(options = {}) {
    return this.#initiative.drainReactions(options);
  }

  advanceCycle() {
    const result = this.#initiative.advanceCycle();
    reconcileDeadActorRuntimes(this.#simulation);

    const nonTerminal = getNonTerminalBasicRuntimes(this.#simulation);
    let dumpedAttacks = [];

    // Attack Interval has no tactical purpose once exactly one proactive basic
    // runtime remains AND no meaningful preferred-range movement remains.
    // Then finish in-range swings atomically, draining future reactions after
    // every attack.
    if (nonTerminal.length === 1 && getNonTerminalSpellRuntimes(this.#simulation).length === 0) {
      const runtime = nonTerminal[0];
      // Stage 6: do not collapse attackInterval while a real preferred-range
      // movement decision is still available. Movement changes the final board
      // state, so it is meaningful work rather than empty timing.
      const actor = this.#simulation.state.units[runtime.actorId];
      const styleReady = result.cycle >= basicStyleReadyCycle(this.#simulation, runtime.actorId);
      if (styleReady && !hasControlStatus(actor, CONTROL_TYPE.STUN) && !runtimeHasMeaningfulRangeMaintenance(this.#simulation, runtime)) {
        dumpedAttacks = dumpRemainingBasicAttacks(this.#simulation, runtime, {
          cycle: result.cycle,
          afterEachAttack: (attack) => {
            if (attack?.killed) {
              interruptSpell(this.#simulation, attack.targetId, {
                cycle: result.cycle,
                reason: 'DEATH',
                parentEventId: attack.damageEventId ?? attack.impactEventId ?? attack.attackStartEventId
              });
            }
            if (this.countersEnabled) enqueueCounterForAttack(this.#initiative, attack);
            this.#initiative.drainReactions({ cycle: result.cycle });
          }
        });
        reconcileDeadActorRuntimes(this.#simulation);
      }
    }

    const attackCount = result.advancements.filter((x) => x.attacked).length + dumpedAttacks.length;
    return Object.freeze({
      ...result,
      attackCount,
      dumpedAttackCount: dumpedAttacks.length,
      dumpedAttacks: dumpedAttacks.slice(),
      madeCombatProgress: result.movementCount > 0 || attackCount > 0
    });
  }

  runUntilCombatSettled({ maxCycles = 10000 } = {}) {
    invariant(Number.isInteger(maxCycles) && maxCycles > 0, 'maxCycles must be a positive integer.');
    const cycles = [];

    for (let i = 0; i < maxCycles; i += 1) {
      reconcileDeadActorRuntimes(this.#simulation);
      if (getNonTerminalBasicRuntimes(this.#simulation).length === 0) {
        return Object.freeze({
          settled: true,
          cycles,
          finalInitiativeCycle: this.#simulation.state.round.initiativeCycle
        });
      }

      const cycle = this.advanceCycle();
      cycles.push(cycle);
    }

    throw new Error(`Stage-7 combat watchdog exceeded ${maxCycles} cycles without settling.`);
  }
}

export function createCombatScheduler(simulation, options = {}) {
  return new CombatScheduler(simulation, options);
}
