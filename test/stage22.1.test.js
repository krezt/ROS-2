import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_TYPE,
  SIDE,
  TARGET_TYPE,
  applyTimedStatus,
  closeRound,
  createBattleState,
  createHoldDeclaration,
  createRosterAbilityDeclaration,
  createRosterCombatScheduler,
  createRosterUnit,
  createRoundSimulation,
  enumerateAiCandidates,
  findStatus,
  getAbility,
  resolveBasicAttack
} from '../src/index.js';

function unit(archetypeId, unitId, side, position, draftSlot=0) {
  return createRosterUnit({ archetypeId, unitId, side, draftSlot, position });
}
function hold(actorId, roundNumber=1) {
  return createHoldDeclaration({declarationId:`D${roundNumber}:${actorId}`,roundNumber,actorId});
}
function decl(archetypeId, abilityId, actorId='H0', target={type:TARGET_TYPE.UNIT,unitId:'G0'}, roundNumber=1) {
  return createRosterAbilityDeclaration({roundNumber,actorId,archetypeId,abilityId,target});
}
function pair(a='Rogue', b='Warrior', apos={row:3,col:3}, bpos={row:3,col:5}) {
  return createBattleState({matchId:'S22.1',units:[unit(a,'H0',SIDE.A,apos),unit(b,'G0',SIDE.B,bpos)]});
}
function run(state,declarations,seed=0x221,countersEnabled=false){
  const sim=createRoundSimulation({state,declarations,seed});
  createRosterCombatScheduler(sim,{countersEnabled}).runUntilCombatSettled({maxCycles:5000});
  return sim;
}
function noDodge(u){u.stats.QKN=-1000;u.stats.DEF=0;}

// Rogue combo ----------------------------------------------------------------------
test('Shadowstep stealth breaks on the Rogue first physical basic attack but the crit-amplifier remains',()=>{
  const setup=run(pair('Rogue','Warrior',{row:3,col:4},{row:3,col:5}),[decl('Rogue','SHADOWSTEP','H0',{type:TARGET_TYPE.SELF}),hold('G0')],1,false);
  assert.equal(findStatus(setup.state.units.H0,'invisible')?.duration,3);
  setup.state.units.H0.resources.attacksRemaining=1;
  noDodge(setup.state.units.G0);
  resolveBasicAttack(setup,'H0','G0',{cycle:setup.state.round.initiativeCycle,ignoreAttackInterval:true});
  assert.equal(findStatus(setup.state.units.H0,'invisible'),null);
  assert.ok(findStatus(setup.state.units.H0,'shadowstep_crit'));
  const reveal=setup.events.snapshot().find(e=>e.type===EVENT_TYPE.STATUS_REMOVE&&e.actorId==='H0'&&e.payload?.reason==='PHYSICAL_ATTACK_REVEAL');
  assert.ok(reveal);
});

test('Backstab pursues like a basic attack and the first landed strike receives the primed Shadowstep finisher bonus',()=>{
  const state=pair('Rogue','Warrior',{row:3,col:2},{row:3,col:8});
  const rogue=state.units.H0,target=state.units.G0;
  noDodge(target); target.stats.hp=5000; target.stats.maxHP=5000;
  rogue.weapon.attackBaseMin=100; rogue.weapon.attackBaseMax=100; rogue.stats.CRIT=.25; // .25 base + .25 Backstab + .50 stealth = 100%
  rogue.statuses.push({key:'invisible',duration:3,sourceId:'H0',data:{breakOnPhysicalAttack:true,sourceAbility:'SHADOWSTEP'}});
  rogue.statuses.push({key:'shadowstep_crit',duration:3,sourceId:'H0',data:{multiplier:2.0}});
  target.statuses.push({key:'marked',duration:2,sourceId:'H0',data:{}});
  const sim=run(state,[decl('Rogue','BACKSTAB'),hold('G0')],2,false);
  const events=sim.events.snapshot();
  const startEvent=events.find(e=>e.type===EVENT_TYPE.ACTION_START&&e.actorId==='H0'&&e.payload?.actionId==='BACKSTAB');
  assert.ok(startEvent);assert.equal(startEvent.initiativeCycle,1,'Backstab should wait one cycle before proactive pursuit begins');
  const moves=events.filter(e=>e.type===EVENT_TYPE.MOVE&&e.actorId==='H0');
  assert.ok(moves.length>0,'Backstab should pursue rather than striking from cast range');
  const damages=events.filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.actorId==='H0');
  assert.ok(damages.length>=1);
  assert.ok(damages[0].payload.amount>1000,'full setup first landed Backstab should be a massive finisher');
  assert.equal(events.filter(e=>e.type===EVENT_TYPE.CRIT&&e.actorId==='H0').length>=1,true);
  assert.equal(findStatus(sim.state.units.H0,'invisible'),null);
});

// Mystic counterplay ---------------------------------------------------------------
test('Mental Breakdown remains pure Spellbreak and Mind Shatter is now Psychic Pulse damage plus Blind',()=>{
  const breakdown=getAbility('Mystic','MENTAL_BREAKDOWN');
  const shatter=getAbility('Mystic','MIND_SHATTER');
  assert.deepEqual(breakdown.effects.map(e=>e.type),['APPLY_STATUS']);
  assert.equal(breakdown.effects[0].key,'spellbreak');
  assert.equal(breakdown.effects[0].duration,3);
  assert.equal(shatter.label,'Psychic Pulse');
  assert.deepEqual(shatter.effects.map(e=>e.type),['DAMAGE','APPLY_STATUS']);
  assert.equal(shatter.effects[0].min,75);
  assert.equal(shatter.effects[0].max,200);
  assert.equal(shatter.effects[1].key,'blind');
  assert.equal(shatter.effects[1].duration,2);
  assert.equal(shatter.effects[1].chance,.65);

  const a=run(pair('Mystic','Mage'),[decl('Mystic','MENTAL_BREAKDOWN'),hold('G0')],3,false);
  assert.ok(findStatus(a.state.units.G0,'spellbreak'));
  let landed=null;
  for(let seed=1;seed<200&&!landed;seed++){
    const b=run(pair('Mystic','Warrior'),[decl('Mystic','MIND_SHATTER'),hold('G0')],seed,false);
    if(findStatus(b.state.units.G0,'blind')) landed=b;
  }
  assert.ok(landed);
  assert.ok(landed.events.snapshot().some(e=>e.type===EVENT_TYPE.DAMAGE&&e.actorId==='H0'&&e.targetId==='G0'&&e.payload?.abilityId==='MIND_SHATTER'));
});

// Paladin / Warrior ----------------------------------------------------------------
test('Sanctify is slow, deals no damage, and grants a Ward charge to every living ally',()=>{
  const state=createBattleState({matchId:'SANCTIFY',units:[
    unit('Paladin','H0',SIDE.A,{row:3,col:2}),unit('Warrior','H1',SIDE.A,{row:5,col:2},1),unit('Rogue','H2',SIDE.A,{row:7,col:2},2),
    unit('Barbarian','G0',SIDE.B,{row:3,col:11})
  ]});
  const hp=state.units.G0.stats.hp;
  const sim=run(state,[decl('Paladin','SANCTIFY','H0',{type:TARGET_TYPE.ALL_ALLIES}),hold('H1'),hold('H2'),hold('G0')],5,false);
  assert.equal(getAbility('Paladin','SANCTIFY').completionDelayCycles,5);
  assert.equal(sim.state.units.G0.stats.hp,hp);
  for(const id of ['H0','H1','H2']) assert.ok(findStatus(sim.state.units[id],'ward'),id);
});

test('Dig In restores 20% max HP while preserving its defensive statuses',()=>{
  const state=pair('Warrior','Barbarian');
  const w=state.units.H0; w.stats.hp=Math.floor(w.stats.maxHP*.40); const before=w.stats.hp;
  const sim=run(state,[decl('Warrior','DIG_IN','H0',{type:TARGET_TYPE.SELF}),hold('G0')],6,false);
  assert.equal(sim.state.units.H0.stats.hp-before,Math.floor(w.stats.maxHP*.20));
  assert.ok(findStatus(sim.state.units.H0,'def_up'));
  assert.ok(findStatus(sim.state.units.H0,'physical_shield'));
});

// Piercing Light -------------------------------------------------------------------
test('Piercing Light ground AoE damages and reveals an Invisible enemy caught inside its 4x4 area',()=>{
  const state=pair('Cleric','Rogue');
  state.units.G0.statuses.push({key:'invisible',duration:3,sourceId:'G0',data:{}});
  noDodge(state.units.G0); const before=state.units.G0.stats.hp;
  const declaration=decl('Cleric','PIERCING_LIGHT','H0',{type:TARGET_TYPE.GROUND,row:state.units.G0.position.row,col:state.units.G0.position.col});
  const sim=run(state,[declaration,hold('G0')],7,false);
  assert.ok(sim.state.units.G0.stats.hp<before);
  assert.equal(findStatus(sim.state.units.G0,'invisible'),null);
  assert.ok(sim.events.snapshot().some(e=>e.type===EVENT_TYPE.STATUS_REMOVE&&e.targetId==='G0'&&e.payload?.reason==='PIERCING_LIGHT_REVEAL'));
});

test('AI can place Piercing Light ground AoE over an Invisible enemy while direct Cleric Attack cannot acquire it',()=>{
  const state=pair('Cleric','Rogue');
  state.units.G0.statuses.push({key:'invisible',duration:3,sourceId:'G0',data:{}});
  const candidates=enumerateAiCandidates({state,actorId:'H0',roundNumber:1});
  assert.ok(candidates.some(c=>c.ability.id==='PIERCING_LIGHT'&&c.target?.type===TARGET_TYPE.GROUND));
  assert.ok(!candidates.some(c=>c.ability.id==='CLERIC_ATTACK'&&c.target?.unitId==='G0'));
});

// Premonition ----------------------------------------------------------------------
test('Premonition reduces newly started non-basic action delays by 3 cycles, minimum 1',()=>{
  const state=pair('Mage','Warrior');
  const sim=createRoundSimulation({state,declarations:[decl('Mage','FIREBALL','H0',{type:TARGET_TYPE.GROUND,row:3,col:5}),hold('G0')],seed:8});
  applyTimedStatus(sim,'H0',{key:'premonition',duration:3,sourceId:'H0',data:{cycleReduction:3}});
  const scheduler=createRosterCombatScheduler(sim,{countersEnabled:false});
  scheduler.advanceCycle();
  const r=sim.runtimes['R1:H0'];
  assert.equal(r.metadata.baseCompletionDelayCycles,5);
  assert.equal(r.metadata.completionDelayCycles,2);
  assert.equal(r.completionCycle,2);

  const state2=pair('Monk','Warrior');
  const sim2=createRoundSimulation({state:state2,declarations:[decl('Monk','COUNTERSTANCE','H0',{type:TARGET_TYPE.SELF}),hold('G0')],seed:9});
  applyTimedStatus(sim2,'H0',{key:'premonition',duration:3,sourceId:'H0',data:{cycleReduction:3}});
  const scheduler2=createRosterCombatScheduler(sim2,{countersEnabled:false}); scheduler2.advanceCycle();
  assert.equal(sim2.runtimes['R1:H0'].metadata.baseCompletionDelayCycles,1);
  assert.equal(sim2.runtimes['R1:H0'].metadata.completionDelayCycles,1);
});

test('Premonition applied after a spell starts does not retroactively change its completion cycle',()=>{
  const state=pair('Mage','Warrior');
  const sim=createRoundSimulation({state,declarations:[decl('Mage','FIREBALL','H0',{type:TARGET_TYPE.GROUND,row:3,col:5}),hold('G0')],seed:10});
  const scheduler=createRosterCombatScheduler(sim,{countersEnabled:false});
  scheduler.advanceCycle();
  assert.equal(sim.runtimes['R1:H0'].completionCycle,5);
  applyTimedStatus(sim,'H0',{key:'premonition',duration:3,sourceId:'H0',data:{cycleReduction:3}});
  scheduler.advanceCycle();
  assert.equal(sim.runtimes['R1:H0'].completionCycle,5);
});
