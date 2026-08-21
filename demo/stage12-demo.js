import {
  ACTION_KIND, CONTROL_TYPE, DAMAGE_TYPE, EVENT_TYPE, SIDE, TARGET_TYPE,
  applyControlEffect, createActionDeclaration, createBattleState, createHoldDeclaration,
  createRoundSimulation, createSpellCombatScheduler, createUnitState,
  reconcileForcedControl, snapshotRoundSimulation, upsertStatus
} from '../src/index.js';

function unit({ unitId, side, row, col, attacksMax = 3, statuses = [] }) {
  return createUnitState({
    unitId, side, draftSlot: 0, archetypeId: unitId,
    stats: { maxHP: 500, hp: 500, ATK: 0, DEF: 0, SDM: 0, CRIT: 0, QKN: unitId === 'H0' ? 15 : 10 },
    position: { row, col }, combat: { movementMax: 8, attacksMax, attackInterval: 1 },
    weapon: { weaponProfileId: `${unitId}-w`, mode: 'MELEE', weaponRange: 2, preferredRange: 2, counterMoveMax: 1,
      attackBaseMin: 10, attackBaseMax: 10, accuracy: 1, critBonus: 0, critMultiplier: 1.75,
      defensePenetration: 0, damageType: DAMAGE_TYPE.PHYSICAL, dodgeable: false }, statuses
  });
}
const hold = (actorId, roundNumber) => createHoldDeclaration({ declarationId: `D${roundNumber}-${actorId}`, roundNumber, actorId });
const attack = (actorId, targetId, roundNumber) => createActionDeclaration({ declarationId: `D${roundNumber}-${actorId}`, roundNumber, actorId,
  actionId: 'ATTACK', actionKind: ACTION_KIND.BASIC_ATTACK, target: { type: TARGET_TYPE.UNIT, unitId: targetId } });

console.log('--- Existing lock survives invisibility ---');
const r1State = createBattleState({ matchId: 'stage12-demo', roundNumber: 1, units: [
  unit({ unitId: 'H0', side: SIDE.A, row: 3, col: 1 }),
  unit({ unitId: 'G0', side: SIDE.B, row: 3, col: 9, attacksMax: 0 }),
  unit({ unitId: 'G1', side: SIDE.B, row: 7, col: 9, attacksMax: 0 }),
  unit({ unitId: 'G2', side: SIDE.B, row: 5, col: 11, attacksMax: 0 })
]});
const r1 = createRoundSimulation({ state: r1State, declarations: [attack('H0', 'G0', 1), hold('G0', 1), hold('G1', 1), hold('G2', 1)], seed: 0x12AB34CD });
upsertStatus(r1.state.units.G0, { key: 'invisible', duration: 3, sourceId: null, data: {} });
createSpellCombatScheduler(r1, { countersEnabled: false }).advanceCycle();
const move = r1.events.snapshot().find((e) => e.type === EVENT_TYPE.MOVE && e.actorId === 'H0');
console.log(`G0 becomes invisible after legal lock; H0 still pursues G0: ${move?.targetId}`);

console.log('\n--- Berserk fresh target each battle round ---');
applyControlEffect(r1, 'H0', { type: CONTROL_TYPE.BERSERK, sourceId: 'G2', duration: 3, cycle: 1 });
const berserk1 = r1.state.units.H0.statuses.find((s) => s.key === 'berserk');
console.log(`Round 1 Berserk target: ${berserk1.data.forcedTargetId}`);

// Start Round 2 from persisted unit state. Make the prior target invisible to
// demonstrate that the fresh acquisition uses the Round-2 legal pool.
const priorTarget = berserk1.data.forcedTargetId;
upsertStatus(r1.state.units[priorTarget], { key: 'invisible', duration: 2, sourceId: null, data: {} });
const r2State = createBattleState({ matchId: 'stage12-demo', roundNumber: 2, units: Object.values(r1.state.units) });
const r2 = createRoundSimulation({ state: r2State, declarations: [hold('H0', 2), hold('G0', 2), hold('G1', 2), hold('G2', 2)], seed: 0xBEEF1200 });
const refreshed = reconcileForcedControl(r2, 'H0', { cycle: 0 });
console.log(`Round 2 fresh Berserk target: ${refreshed.targetId}`);
console.log(`Prior target (${priorTarget}) is invisible and excluded from the new acquisition.`);
console.log(`Berserk targetRoundNumber: ${r2.state.units.H0.statuses.find((s) => s.key === 'berserk').data.targetRoundNumber}`);

const digest = snapshotRoundSimulation(r2);
console.log('\nRound 2 deterministic digest:');
console.log(`State hash: ${digest.stateHash}`);
console.log(`Event hash: ${digest.eventHash}`);
console.log(`RNG draws: ${digest.rng.drawCount}`);
console.log(`RNG final state: ${digest.rng.state}`);
