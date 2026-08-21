import {
  ACTION_KIND,
  SIDE,
  TARGET_TYPE,
  createActionDeclaration,
  createBattleState,
  createRoundSimulation,
  createUnitState,
  snapshotRoundSimulation
} from '../src/index.js';

const warrior = createUnitState({
  unitId: 'H0', side: SIDE.A, draftSlot: 0, archetypeId: 'Warrior',
  stats: { maxHP: 300, hp: 300, ATK: 80, DEF: 60, SDM: 10, CRIT: 0.10, QKN: 17 },
  position: { row: 3, col: 0 },
  weaponProfileId: 'warrior_sword',
  weapon: { movementMax: 12, attacksMax: 7, attackInterval: 1, weaponRange: 2, preferredRange: 2, counterMoveMax: 1 }
});

const mage = createUnitState({
  unitId: 'G0', side: SIDE.B, draftSlot: 0, archetypeId: 'Mage',
  stats: { maxHP: 210, hp: 210, ATK: 20, DEF: 30, SDM: 100, CRIT: 0.05, QKN: 14 },
  position: { row: 3, col: 13 },
  weaponProfileId: 'mage_staff',
  weapon: { movementMax: 10, attacksMax: 4, attackInterval: 2, weaponRange: 2, preferredRange: 2, counterMoveMax: 1 }
});

const state = createBattleState({ matchId: 'demo-match', roundNumber: 1, units: [warrior, mage] });
const declarations = [
  createActionDeclaration({
    declarationId: 'D-H0-R1', roundNumber: 1, actorId: 'H0', actionId: 'ATTACK',
    actionKind: ACTION_KIND.BASIC_ATTACK,
    target: { type: TARGET_TYPE.UNIT, unitId: 'G0' }
  }),
  createActionDeclaration({
    declarationId: 'D-G0-R1', roundNumber: 1, actorId: 'G0', actionId: 'FIREBALL',
    actionKind: ACTION_KIND.SPELL,
    target: { type: TARGET_TYPE.GROUND, row: 3, col: 6 }
  })
];

const sim = createRoundSimulation({ state, declarations, seed: 0x1234abcd });

// Demonstrate deterministic, traceable gameplay RNG consumption without resolving combat yet.
sim.rng.chance(0.75, 'DEMO_HIT_ROLL');
sim.rng.chance(0.10, 'DEMO_CRIT_ROLL');

const snapshot = snapshotRoundSimulation(sim);
console.log(JSON.stringify({
  startStateHash: sim.startStateHash,
  declarationsHash: sim.declarationsHash,
  stateHash: snapshot.stateHash,
  eventHash: snapshot.eventHash,
  rng: snapshot.rng,
  events: snapshot.events,
  trace: snapshot.trace
}, null, 2));
