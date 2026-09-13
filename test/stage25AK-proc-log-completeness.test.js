import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_TYPE, SIDE, TARGET_TYPE,
  buildPlayerCombatLogPlan,
  createBattleState, createHoldDeclaration, createRosterAbilityDeclaration,
  createRosterCombatScheduler, createRosterUnit, createRoundSimulation, getArchetype
} from '../src/index.js';

const PASSIVES={
  Cleric:'Prayer Mend',
  Mage:'Arc Shock',
  Monk:'Opening',
  Necromancer:'Life Drip',
  Mystic:'Guard Falter',
  Paladin:'Resolve',
  Electromancer:'Lightning Bolt'
};

const basicId=(id)=>getArchetype(id).abilities.find(a=>a.id.endsWith('_ATTACK')).id;
const flatten=(plan,events)=>events.flatMap(e=>plan.get(e.eventId)??[]).map(x=>x.text);

function procTrial(archetypeId,seed,{ward=false}={}){
  const actor=createRosterUnit({archetypeId,unitId:'H0',side:SIDE.A,draftSlot:0,position:{row:5,col:5}});
  const target=createRosterUnit({archetypeId:'Warrior',unitId:'G0',side:SIDE.B,draftSlot:0,position:{row:5,col:6}});
  target.stats.QKN=-1000;target.stats.DEF=0;target.stats.RES=0;target.stats.maxHP=99999;target.stats.hp=99999;
  if(ward)target.statuses.push({key:'ward',duration:3,sourceId:'G0',data:{}});
  const roundNumber=1;
  const declarations=[
    createRosterAbilityDeclaration({roundNumber,actorId:'H0',archetypeId,abilityId:basicId(archetypeId),target:{type:TARGET_TYPE.UNIT,unitId:'G0'}}),
    createHoldDeclaration({declarationId:'D:G0',roundNumber,actorId:'G0'})
  ];
  const state=createBattleState({matchId:`AK-PROC:${archetypeId}:${seed}:${ward?'WARD':'OPEN'}`,units:[actor,target]});
  const sim=createRoundSimulation({state,declarations,seed});
  createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:500});
  return sim;
}

function eventProcLabel(e){return e?.payload?.procLabel??e?.payload?.data?.procLabel??null;}

function findProcTrial(archetypeId,label,{ward=false,maxSeed=500}={}){
  for(let seed=1;seed<=maxSeed;seed++){
    const sim=procTrial(archetypeId,seed,{ward});
    const events=sim.events.snapshot();
    const lines=flatten(buildPlayerCombatLogPlan(events,sim.state),events);
    if(events.some(e=>eventProcLabel(e)===label)||lines.some(line=>line.toLowerCase().includes(label.toLowerCase())))return {sim,events,seed,lines};
  }
  return null;
}

test('Stage25AK simple combat log explicitly narrates every current passive/basic proc family',()=>{
  for(const [archetypeId,label] of Object.entries(PASSIVES)){
    const found=findProcTrial(archetypeId,label);
    assert.ok(found,`expected deterministic ${label} proc for ${archetypeId}`);
    const lines=flatten(buildPlayerCombatLogPlan(found.events,found.sim.state),found.events);
    assert.ok(lines.some(line=>line.toLowerCase().includes(label.toLowerCase())),`${label} missing from simple log: ${lines.join(' | ')}`);
  }
});

test('Stage25AK Prayer Mend remains visible even when the proc produces zero effective healing at full HP',()=>{
  const found=findProcTrial('Cleric','Prayer Mend');
  assert.ok(found);
  const procHeal=found.events.find(e=>e.type===EVENT_TYPE.HEAL&&e.payload?.procLabel==='Prayer Mend');
  assert.ok(procHeal,'expected Prayer Mend HEAL event');
  assert.equal(procHeal.payload.amount,0,'test actor begins at full HP so proc should overheal for zero');
  const lines=flatten(buildPlayerCombatLogPlan(found.events,found.sim.state),found.events);
  assert.ok(lines.some(line=>/Prayer Mend procs.*full HP/i.test(line)),lines.join(' | '));
});

test('Stage25AK Arc Shock is identified as a proc through basic-attack context without mutating authoritative event payloads',()=>{
  const found=findProcTrial('Mage','Arc Shock');
  assert.ok(found);
  const status=found.events.find(e=>e.type===EVENT_TYPE.STATUS_APPLY&&e.payload?.key==='stun');
  assert.ok(status,'expected Arc Shock Stun status event');
  assert.equal(status.payload?.data?.procLabel,undefined,'control event payload remains mechanics-authoritative and presentation-neutral');
  const lines=flatten(buildPlayerCombatLogPlan(found.events,found.sim.state),found.events);
  assert.ok(lines.some(line=>/Arc Shock procs.*Stunned/i.test(line)),lines.join(' | '));
});

test('Stage25AK Ward-blocked Arc Shock still tells the player that the proc occurred',()=>{
  let found=null;
  for(let seed=1;seed<=800&&!found;seed++){
    const sim=procTrial('Mage',seed,{ward:true});
    const events=sim.events.snapshot();
    const block=events.find(e=>e.type===EVENT_TYPE.BLOCK&&e.payload?.reason==='WARD'&&e.payload?.blockedStatusKey==='stun');
    if(block)found={sim,events,block};
  }
  assert.ok(found,'expected a deterministic Arc Shock proc consumed by Ward');
  const lines=flatten(buildPlayerCombatLogPlan(found.events,found.sim.state),found.events);
  assert.ok(lines.some(line=>/Arc Shock procs.*Ward blocks Stun/i.test(line)),lines.join(' | '));
});

test('Stage25AK critical passive damage is attached to the proc damage event even when CRIT is emitted afterward',()=>{
  let found=null;
  for(let seed=1;seed<=1200&&!found;seed++){
    const sim=procTrial('Electromancer',seed);
    const events=sim.events.snapshot();
    const crit=events.find(e=>e.type===EVENT_TYPE.CRIT&&e.payload?.procLabel==='Lightning Bolt');
    if(crit){
      const damage=events.find(e=>e.eventId===crit.parentEventId&&e.type===EVENT_TYPE.DAMAGE&&e.payload?.procLabel==='Lightning Bolt');
      if(damage)found={sim,events,damage};
    }
  }
  assert.ok(found,'expected a critical Lightning Bolt proc');
  const lines=flatten(buildPlayerCombatLogPlan(found.events,found.sim.state),found.events);
  assert.ok(lines.some(line=>/^CRITICAL! Electromancer's Lightning Bolt procs/i.test(line)),lines.join(' | '));
});
