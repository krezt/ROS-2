import {
  ACTION_KIND, CONTROL_TYPE, DAMAGE_TYPE, SIDE, TARGET_TYPE,
  applyControlEffect, createActionDeclaration, createBattleState,
  createHoldDeclaration, createRoundSimulation, createSpellCombatScheduler,
  createUnitState, expireControlEffect, markUnitDead, snapshotRoundSimulation
} from '../src/index.js';

function unit(unitId, side, row, col, qkn = 10, attacksMax = 4) {
  return createUnitState({
    unitId, side, draftSlot: 0, archetypeId: unitId,
    stats: { maxHP: 500, hp: 500, ATK: 0, DEF: 0, SDM: 0, CRIT: 0, QKN: qkn },
    position: { row, col },
    combat: { movementMax: 10, attacksMax, attackInterval: 1 },
    weapon: {
      weaponProfileId: `${unitId}-weapon`, mode: 'MELEE', weaponRange: 2, preferredRange: 2, counterMoveMax: 1,
      attackBaseMin: 10, attackBaseMax: 10, accuracy: 1, critBonus: 0, critMultiplier: 1.75,
      defensePenetration: 0, damageType: DAMAGE_TYPE.PHYSICAL, dodgeable: false
    }
  });
}
const attack = (actorId, targetId) => createActionDeclaration({
  declarationId: `D-${actorId}`, roundNumber: 1, actorId, actionId: 'ATTACK', actionKind: ACTION_KIND.BASIC_ATTACK,
  target: { type: TARGET_TYPE.UNIT, unitId: targetId }
});
const hold = (actorId) => createHoldDeclaration({ declarationId: `D-${actorId}`, roundNumber: 1, actorId });

const simulation = createRoundSimulation({
  state: createBattleState({ matchId: 'stage11-demo', roundNumber: 1, board: { width: 14, height: 10 }, units: [
    unit('H0', SIDE.A, 3, 1, 15),
    unit('G0', SIDE.B, 3, 6, 16, 0),
    unit('G1', SIDE.B, 7, 10, 14, 0)
  ] }),
  declarations: [attack('H0', 'G1'), hold('G0'), hold('G1')],
  seed: 0x11001100
});

const scheduler = createSpellCombatScheduler(simulation, { countersEnabled: false });
console.log('Declared H0 target:', simulation.runtimes['R1:H0'].declaredPrimaryTargetId);

applyControlEffect(simulation, 'H0', { type: CONTROL_TYPE.TAUNT, sourceId: 'G0', cycle: 0 });
console.log('Taunted target:', simulation.runtimes['R1:H0'].currentForcedTargetId);
scheduler.advanceCycle();
console.log('After Taunt cycle H0 position:', simulation.state.units.H0.position);

expireControlEffect(simulation, 'H0', CONTROL_TYPE.TAUNT, { cycle: 1 });
console.log('After Taunt expiry forced target:', simulation.runtimes['R1:H0'].currentForcedTargetId);
scheduler.advanceCycle();
console.log('Resumed declared target:', simulation.runtimes['R1:H0'].declaredPrimaryTargetId);

applyControlEffect(simulation, 'H0', { type: CONTROL_TYPE.BERSERK, sourceId: 'G0', cycle: 2 });
const firstBerserk = simulation.runtimes['R1:H0'].currentForcedTargetId;
console.log('Berserk target:', firstBerserk);
markUnitDead(simulation.state, firstBerserk);
scheduler.advanceCycle();
console.log('Berserk retarget after death:', simulation.runtimes['R1:H0'].currentForcedTargetId);

const digest = snapshotRoundSimulation(simulation);
console.log('State hash:', digest.stateHash);
console.log('Event hash:', digest.eventHash);
console.log('RNG draws:', digest.rng.drawCount);
console.log('RNG final state:', digest.rng.state);
