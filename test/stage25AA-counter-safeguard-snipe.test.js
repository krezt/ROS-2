import test from 'node:test';
import assert from 'node:assert/strict';
import {
  COUNTERSTANCE_PROFILES,
  EVENT_TYPE,
  SIDE,
  TARGET_TYPE,
  counterEligibility,
  createBattleState,
  createHoldDeclaration,
  createRosterAbilityDeclaration,
  createRosterCombatScheduler,
  createRosterUnit,
  createRoundSimulation,
  getAbility,
  markUnitDead
} from '../src/index.js';

function unit(archetypeId,unitId,side,position,slot=0){
  return createRosterUnit({archetypeId,unitId,side,draftSlot:slot,position});
}
function hold(actorId,roundNumber=1){
  return createHoldDeclaration({declarationId:`D${roundNumber}:${actorId}`,roundNumber,actorId});
}
function attack(archetypeId,abilityId,actorId,targetId,roundNumber=1){
  return createRosterAbilityDeclaration({
    roundNumber,actorId,archetypeId,abilityId,
    target:{type:TARGET_TYPE.UNIT,unitId:targetId}
  });
}
function counterstance(monk){
  monk.statuses.push({key:'counterstance',duration:3,sourceId:monk.unitId,data:{...COUNTERSTANCE_PROFILES.HYBRID}});
}

test('Stage25AA Counterstance uses real path length and rejects pursuit blocked beyond two steps',()=>{
  const state=createBattleState({matchId:'S25AA-BLOCKED',units:[
    unit('Monk','H0',SIDE.A,{row:6,col:5}),
    unit('Paladin','G0',SIDE.B,{row:6,col:3}),
    unit('Cleric','G1',SIDE.B,{row:6,col:4},1)
  ]});
  markUnitDead(state,'G1'); // Corpses intentionally remain solid battlefield occupants.
  counterstance(state.units.H0);

  const eligibility=counterEligibility({state,runtimes:{}},'H0','G0');
  assert.equal(eligibility.eligible,false);
  assert.equal(eligibility.reason,'AGGRESSOR_UNREACHABLE_WITH_PURSUIT');
  assert.equal(eligibility.shortestStepsToEngagement,3);
  assert.equal(eligibility.pursuitAllowance,2);

  // The same geometry used to pass the Manhattan-only gate and could later throw
  // "Target is outside weapon range". It must now finish the attack/reaction cleanly.
  state.units.H0.stats.QKN=-1000;
  const sim=createRoundSimulation({
    state,
    declarations:[hold('H0'),attack('Paladin','PALADIN_ATTACK','G0','H0')],
    seed:0x25aa01
  });
  assert.doesNotThrow(()=>createRosterCombatScheduler(sim,{countersEnabled:true}).runUntilCombatSettled({maxCycles:5000}));
  const monkCounters=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.COUNTER&&e.actorId==='H0');
  assert.equal(monkCounters.length,0);
});

test('Stage25AA zero-cost Counterstance pursuit still works with zero ordinary attacks',()=>{
  const state=createBattleState({matchId:'S25AA-FREE-PURSUIT',units:[
    unit('Monk','H0',SIDE.A,{row:6,col:5}),
    unit('Paladin','G0',SIDE.B,{row:6,col:3})
  ]});
  counterstance(state.units.H0);
  state.units.H0.resources.attacksRemaining=0;
  state.units.H0.stats.QKN=-1000;

  const eligibility=counterEligibility({state,runtimes:{}},'H0','G0');
  assert.equal(eligibility.eligible,true);
  assert.equal(eligibility.shortestStepsToEngagement,1);

  const sim=createRoundSimulation({
    state,
    declarations:[hold('H0'),attack('Paladin','PALADIN_ATTACK','G0','H0')],
    seed:0x25aa02
  });
  assert.doesNotThrow(()=>createRosterCombatScheduler(sim,{countersEnabled:true}).runUntilCombatSettled({maxCycles:5000}));
  const pursuit=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.COUNTER_MOVE&&e.actorId==='H0'&&e.payload?.movementReason==='COUNTERSTANCE_PURSUIT');
  const counters=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.COUNTER&&e.actorId==='H0');
  assert.ok(pursuit.length>=1);
  assert.ok(counters.length>=1);
  assert.equal(sim.state.units.H0.resources.attacksRemaining,0);
});

test('Stage25AA Snipe base damage multiplier is reduced by ten percent',()=>{
  const snipe=getAbility('Archer','SNIPE');
  assert.equal(snipe.basicStyle.attackRangeOverride,7);
  assert.equal(snipe.basicStyle.damageMultiplier,2.025);
  assert.equal(snipe.basicStyle.distanceDamageBonusPerSquare,.05);
});
