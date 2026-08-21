import {
  ACTION_KIND, DAMAGE_TYPE, SIDE, TARGET_TYPE,
  createActionDeclaration, createBattleState, createRoundDigest, createRoundSimulation,
  createSpellCombatScheduler, createUnitState, compareRoundDigests, replayDeterminism
} from '../src/index.js';

function unit(unitId, side, row, col, qkn) {
  return createUnitState({
    unitId, side, draftSlot: unitId.endsWith('0') ? 0 : 1, archetypeId: unitId,
    stats: { maxHP: 800, hp: 800, ATK: 45, DEF: 20, SDM: 50, CRIT: 0.1, QKN: qkn },
    position: { row, col },
    combat: { movementMax: 12, attacksMax: 4, attackInterval: 1 },
    weapon: { weaponRange: 2, preferredRange: 2, counterMoveMax: 1, attackBaseMin: 35, attackBaseMax: 70, accuracy: .92, critMultiplier: 1.75, damageType: DAMAGE_TYPE.PHYSICAL, dodgeable: true }
  });
}
function basic(actorId, targetId) {
  return createActionDeclaration({ declarationId: `D1:${actorId}`, roundNumber: 1, actorId, actionId: 'BASIC', actionKind: ACTION_KIND.BASIC_ATTACK, target: { type: TARGET_TYPE.UNIT, unitId: targetId } });
}
function spell(actorId, targetId) {
  return createActionDeclaration({ declarationId: `D1:${actorId}`, roundNumber: 1, actorId, actionId: 'ARC', actionKind: ACTION_KIND.SPELL, target: { type: TARGET_TYPE.UNIT, unitId: targetId }, payload: { spell: { completionDelayCycles: 4, castRange: 20, effect: { type: 'DAMAGE', amount: 90 } } } });
}
function make() {
  const state = createBattleState({ matchId: 'stage15-demo', board: { width: 14, height: 10 }, units: [
    unit('H0', SIDE.A, 3, 1, 16), unit('H1', SIDE.A, 6, 1, 14),
    unit('G0', SIDE.B, 3, 12, 17), unit('G1', SIDE.B, 6, 12, 14)
  ]});
  return createRoundSimulation({ state, declarations: [basic('H0','G0'), spell('H1','G1'), basic('G0','H0'), spell('G1','H1')], seed: 424242 });
}
function execute(sim) { createSpellCombatScheduler(sim).runUntilCombatSettled({ maxCycles: 200 }); }

const replay = replayDeterminism({ repetitions: 1000, createSimulation: make, execute });
const a = make(), b = make(); execute(a); execute(b);
const before = compareRoundDigests(createRoundDigest(a), createRoundDigest(b));
b.state.units.H0.stats.hp = Math.max(0, b.state.units.H0.stats.hp - 1);
const after = compareRoundDigests(createRoundDigest(a), createRoundDigest(b));

console.log('Stage 15 deterministic replay');
console.log('1000 identical runs:', replay.passed ? 'PASS' : 'FAIL');
console.log('Equivalent clients:', before.status);
console.log('After deliberate -1 HP mutation:', after.status);
console.log('Detected fields:', after.mismatches.map(x => x.field).join(', '));
console.log('Reference digest:', createRoundDigest(a));
