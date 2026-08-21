import {
  ACTION_KIND, DAMAGE_TYPE, SIDE, TARGET_TYPE,
  createActionDeclaration, createBattleState, createRoundSimulation,
  createSpellCombatScheduler, createUnitState, snapshotRoundSimulation
} from '../src/index.js';

function u(unitId, side, qkn, col, attacksMax = 0) {
  return createUnitState({
    unitId, side, draftSlot: 0, archetypeId: unitId,
    stats: { maxHP: 500, hp: 500, ATK: 0, DEF: 0, SDM: 0, CRIT: 0, QKN: qkn },
    position: { row: 3, col }, combat: { movementMax: 0, attacksMax, attackInterval: 1 },
    weapon: { weaponProfileId: `${unitId}-w`, mode: 'MELEE', weaponRange: 2, preferredRange: 2, counterMoveMax: 1,
      attackBaseMin: 20, attackBaseMax: 20, accuracy: 1, critBonus: 0, defensePenetration: 0,
      damageType: DAMAGE_TYPE.PHYSICAL, dodgeable: false }
  });
}

const state = createBattleState({ matchId: 'stage9-demo', roundNumber: 1, board: { width: 10, height: 8 }, units: [
  u('H0', SIDE.A, 15, 4, 3),
  u('G0', SIDE.B, 16, 6, 3)
]});
const declarations = [
  createActionDeclaration({ declarationId: 'D-H0', roundNumber: 1, actorId: 'H0', actionId: 'ARCANE_BOLT_4', actionKind: ACTION_KIND.SPELL,
    target: { type: TARGET_TYPE.UNIT, unitId: 'G0' }, payload: { spell: { completionDelayCycles: 4, castRange: 6, effect: { type: 'DAMAGE', amount: 75 } } } }),
  createActionDeclaration({ declarationId: 'D-G0', roundNumber: 1, actorId: 'G0', actionId: 'ATTACK', actionKind: ACTION_KIND.BASIC_ATTACK,
    target: { type: TARGET_TYPE.UNIT, unitId: 'H0' } })
];
const sim = createRoundSimulation({ state, declarations, seed: 0x9090 });
const scheduler = createSpellCombatScheduler(sim);
for (let i = 0; i < 5; i += 1) {
  const c = scheduler.advanceCycle();
  console.log(`Cycle ${c.cycle}: spell completions=${c.spellCompletionCount}, ordinary=${c.advancements.map(a => `${a.actorId}:${a.result}`).join(' | ')}`);
}
console.log('\nEvents:');
for (const e of sim.events.snapshot()) console.log(`${e.eventId} C${e.initiativeCycle} ${e.type} ${e.actorId ?? ''}->${e.targetId ?? ''}`);
const digest = snapshotRoundSimulation(sim);
console.log('\nState hash:', digest.stateHash);
console.log('Event hash:', digest.eventHash);
console.log('RNG draws:', digest.rng.drawCount);
console.log('RNG final state:', digest.rng.state);
