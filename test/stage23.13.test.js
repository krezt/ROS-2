import test from 'node:test';
import assert from 'node:assert/strict';
import {
  CONTROL_TYPE, EVENT_TYPE, SIDE, TARGET_TYPE,
  applyControlEffect, createBattleState, createHoldDeclaration,
  createRosterAbilityDeclaration, createRosterCombatScheduler,
  createRosterUnit, createRoundSimulation, startPendingRosterActions,
  describeAuthoritativeEvent
} from '../src/index.js';

test('Taunt conversion keeps spending remaining resources against the forced target after interrupting a spell', () => {
  const state=createBattleState({matchId:'S23_13_TAUNT',units:[
    createRosterUnit({archetypeId:'Electromancer',unitId:'G1',side:SIDE.B,draftSlot:1,position:{row:5,col:14}}),
    createRosterUnit({archetypeId:'Warrior',unitId:'H0',side:SIDE.A,draftSlot:0,position:{row:5,col:7}}),
    createRosterUnit({archetypeId:'Mage',unitId:'H2',side:SIDE.A,draftSlot:2,position:{row:1,col:2}})
  ]});
  const spell=createRosterAbilityDeclaration({roundNumber:1,actorId:'G1',archetypeId:'Electromancer',abilityId:'CHAIN_LIGHTNING',target:{type:TARGET_TYPE.UNIT,unitId:'H2'}});
  const sim=createRoundSimulation({state,declarations:[
    spell,
    createHoldDeclaration({declarationId:'D:H0',roundNumber:1,actorId:'H0'}),
    createHoldDeclaration({declarationId:'D:H2',roundNumber:1,actorId:'H2'})
  ],seed:0x2313});
  startPendingRosterActions(sim,0);
  applyControlEffect(sim,'G1',{type:CONTROL_TYPE.TAUNT,sourceId:'H0',duration:3,cycle:0});
  createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:100});
  const events=sim.events.snapshot();
  const moves=events.filter(e=>e.type===EVENT_TYPE.MOVE&&e.actorId==='G1');
  const attacks=events.filter(e=>e.type===EVENT_TYPE.ATTACK_START&&e.actorId==='G1');
  assert.ok(moves.length>1,'taunted caster should continue pursuing beyond a single square');
  assert.ok(moves.every(e=>e.targetId==='H0'),'all forced pursuit must remain on the taunter');
  assert.ok(attacks.length>0,'taunted caster should attack once it reaches the taunter');
  assert.ok(attacks.every(e=>e.targetId==='H0'),'forced attacks must not fall back to the original spell target');
  assert.equal(sim.state.units.G1.resources.attacksRemaining,0,'remaining swings should be spent once engagement is established');
});

test('cleanse combat-log line names the cleansing ability', () => {
  const state=createBattleState({matchId:'S23_13_LOG',units:[
    createRosterUnit({archetypeId:'Electromancer',unitId:'G1',side:SIDE.B,draftSlot:1,position:{row:5,col:14}})
  ]});
  const line=describeAuthoritativeEvent({type:EVENT_TYPE.STATUS_REMOVE,initiativeCycle:3,actorId:'G1',targetId:'G1',payload:{key:'marked',reason:'CLEANSE',abilityId:'GOD_TEMPEST'}},state);
  assert.equal(line,'[C03] Electromancer (G1) cleanses MARKED from Electromancer (G1) with God Tempest.');
});
