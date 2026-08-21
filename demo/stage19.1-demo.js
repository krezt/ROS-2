import {
  ACTION_RUNTIME_STATE, CONTROL_TYPE, SIDE, TARGET_TYPE,
  applyControlEffect, createBattleState, createHoldDeclaration,
  createRosterAbilityDeclaration, createRosterUnit, createRoundSimulation,
  expireControlEffect, startPendingRosterActions
} from '../src/index.js';

const state=createBattleState({matchId:'S19.1-DEMO',units:[
  createRosterUnit({archetypeId:'Warrior',unitId:'H0',side:SIDE.A,draftSlot:0,position:{row:3,col:3}}),
  createRosterUnit({archetypeId:'Barbarian',unitId:'G0',side:SIDE.B,draftSlot:0,position:{row:3,col:5}})
]});
const powerStrike=createRosterAbilityDeclaration({roundNumber:1,actorId:'H0',archetypeId:'Warrior',abilityId:'POWER_STRIKE',target:{type:TARGET_TYPE.UNIT,unitId:'G0'}});
const hold=createHoldDeclaration({declarationId:'D1:G0',roundNumber:1,actorId:'G0'});
const sim=createRoundSimulation({state,declarations:[powerStrike,hold],seed:0x191});
startPendingRosterActions(sim,0);
console.log('Power Strike after start:',sim.runtimes['R1:H0'].state);
applyControlEffect(sim,'H0',{type:CONTROL_TYPE.TAUNT,sourceId:'G0',duration:2,cycle:0});
console.log('After Taunt:',sim.runtimes['R1:H0'].actionKind,sim.runtimes['R1:H0'].state,'forced target',sim.runtimes['R1:H0'].currentForcedTargetId);
expireControlEffect(sim,'H0',CONTROL_TYPE.TAUNT,{cycle:1});
console.log('After Taunt expires:',sim.runtimes['R1:H0'].actionKind,sim.runtimes['R1:H0'].state);
console.log('Interrupted for round:',sim.runtimes['R1:H0'].state===ACTION_RUNTIME_STATE.INTERRUPTED);
console.log('Events:',sim.events.snapshot().map(e=>`${e.type}:${e.payload.reason??e.payload.actionId??''}`).join(' -> '));
