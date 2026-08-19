import { createCombatScheduler } from './combat-scheduler.js';
import { getNonTerminalBasicRuntimes, reconcileDeadActorRuntimes } from './combat.js';
import { getNonTerminalSpellRuntimes, resolveMaturedSpells, startPendingSpells } from './spells.js';
import { invariant } from './errors.js';

export class SpellCombatScheduler {
  #simulation;
  #combat;

  constructor(simulation, options = {}) {
    this.#simulation = simulation;
    this.#combat = createCombatScheduler(simulation, options);
  }

  get simulation() { return this.#simulation; }
  get reactions() { return this.#combat.reactions; }

  drainReactions(options = {}) { return this.#combat.drainReactions(options); }

  advanceCycle() {
    const cycle = this.#simulation.state.round.initiativeCycle;
    const startedSpells = startPendingSpells(this.#simulation, cycle);
    // Completion is resolved at the boundary BEFORE ordinary actions of this cycle.
    const spellCompletions = resolveMaturedSpells(this.#simulation, cycle);
    const combatCycle = this.#combat.advanceCycle();
    reconcileDeadActorRuntimes(this.#simulation);
    return Object.freeze({
      ...combatCycle,
      startedSpells: startedSpells.slice(),
      spellCompletions: spellCompletions.slice(),
      spellCompletionCount: spellCompletions.length,
      madeCombatProgress: combatCycle.madeCombatProgress || startedSpells.length > 0 || spellCompletions.length > 0
    });
  }

  runUntilCombatSettled({ maxCycles = 10000 } = {}) {
    invariant(Number.isInteger(maxCycles) && maxCycles > 0, 'maxCycles must be a positive integer.');
    const cycles = [];
    for (let i = 0; i < maxCycles; i += 1) {
      reconcileDeadActorRuntimes(this.#simulation);
      const basics = getNonTerminalBasicRuntimes(this.#simulation);
      const spells = getNonTerminalSpellRuntimes(this.#simulation);
      if (basics.length === 0 && spells.length === 0) {
        return Object.freeze({ settled: true, cycles, finalInitiativeCycle: this.#simulation.state.round.initiativeCycle });
      }
      cycles.push(this.advanceCycle());
    }
    throw new Error(`Stage-9 combat watchdog exceeded ${maxCycles} cycles without settling.`);
  }
}

export function createSpellCombatScheduler(simulation, options = {}) {
  return new SpellCombatScheduler(simulation, options);
}
