import {
  ACTION_KIND, AREA_SHAPE, DAMAGE_TYPE, SIDE, TARGET_TYPE,
  createActionDeclaration, createBattleState, createHoldDeclaration,
  createRoundSimulation, createSpellCombatScheduler, createUnitState,
  pushUnit, hashCanonical
} from '../src/index.js';

function unit(unitId, side, position, statuses = []) {
  return createUnitState({
    unitId, side, draftSlot: 0, archetypeId: unitId,
    stats: { maxHP: 500, hp: 500, ATK: 0, DEF: 0, SDM: 0, CRIT: 0, QKN: 10 },
    position, combat: { movementMax: 8, attacksMax: 2, attackInterval: 1 },
    weapon: { weaponRange: 2, preferredRange: 2, counterMoveMax: 1, attackBaseMin: 10, attackBaseMax: 10, accuracy: 1, critMultiplier: 1.75, damageType: DAMAGE_TYPE.PHYSICAL, dodgeable: false },
    statuses
  });
}
const invis = { key: 'invisible', duration: 2, sourceId: null, data: {} };
const units = [
  unit('H0', SIDE.A, { row: 3, col: 1 }),
  unit('G0', SIDE.B, { row: 4, col: 5 }, [invis]),
  unit('G1', SIDE.B, { row: 5, col: 4 })
];
const declarations = [
  createActionDeclaration({
    declarationId: 'D-H0', roundNumber: 1, actorId: 'H0', actionId: 'BLAST', actionKind: ACTION_KIND.SPELL,
    target: { type: TARGET_TYPE.GROUND, row: 4, col: 4 },
    payload: { spell: { completionDelayCycles: 1, castRange: 20, area: { shape: AREA_SHAPE.SQUARE_3X3 }, effect: { type: 'AOE_DAMAGE', amount: 50 } } }
  }),
  createHoldDeclaration({ declarationId: 'D-G0', roundNumber: 1, actorId: 'G0' }),
  createHoldDeclaration({ declarationId: 'D-G1', roundNumber: 1, actorId: 'G1' })
];
const simulation = createRoundSimulation({
  state: createBattleState({ matchId: 'stage13-demo', board: { width: 14, height: 10 }, units }),
  declarations, seed: 0x13001300
});
const scheduler = createSpellCombatScheduler(simulation, { countersEnabled: false });
scheduler.advanceCycle();
scheduler.advanceCycle();
console.log('AoE HP:', { G0: simulation.state.units.G0.stats.hp, G1: simulation.state.units.G1.stats.hp });
const pushed = pushUnit(simulation, 'G0', { sourceId: 'H0', anchor: simulation.state.units.H0.position, distance: 3 });
console.log('Push:', { moved: pushed.movedDistance, stopReason: pushed.stopReason, to: pushed.to });
console.log('State hash:', hashCanonical(simulation.state));
console.log('Event hash:', hashCanonical(simulation.events.snapshot()));
console.log('RNG draws:', simulation.rng.drawCount);
