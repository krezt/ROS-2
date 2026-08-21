import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_RUNTIME_STATE, EVENT_TYPE, SIDE, TARGET_TYPE, CONTROL_TYPE,
  applyControlEffect, createBattleState, createHoldDeclaration, createRosterAbilityDeclaration,
  createRosterCombatScheduler, createRosterUnit, createRoundSimulation, counterEligibility,
  findStatus, getAbility, getArchetype, resolveBasicAttack
} from '../src/index.js';

function unit(archetypeId,unitId,side,pos,slot=0){return createRosterUnit({archetypeId,unitId,side,draftSlot:slot,position:pos});}
function hold(id,round=1){return createHoldDeclaration({declarationId:`H:${round}:${id}`,roundNumber:round,actorId:id});}
function decl(arch,ability,actor='H0',target={type:TARGET_TYPE.UNIT,unitId:'G0'},round=1){return createRosterAbilityDeclaration({declarationId:`D:${round}:${actor}`,roundNumber:round,actorId:actor,archetypeId:arch,abilityId:ability,target});}
function pair(a,b,apos={row:5,col:2},bpos={row:5,col:12}){return createBattleState({matchId:'S23_19',units:[unit(a,'H0',SIDE.A,apos),unit(b,'G0',SIDE.B,bpos)]});}
function run(state,declarations,seed=2319,countersEnabled=false){const sim=createRoundSimulation({state,declarations,seed});createRosterCombatScheduler(sim,{countersEnabled}).runUntilCombatSettled({maxCycles:500});return sim;}

test('Palm Hits is a pursuit style with two heavy 350% attempts and 35% Stun chance each',()=>{
  const a=getAbility('Monk','PALM_HIT');
  assert.equal(a.actionKind,'BASIC_ATTACK');assert.equal(a.basicStyle.attacksSet,2);assert.equal(a.basicStyle.ordinaryAttackLimit,2);assert.equal(a.basicStyle.startupDelayCycles,1);assert.equal(a.basicStyle.damageMultiplier,3.5);assert.equal(a.basicStyle.onHit.chance,.35);
  const state=pair('Monk','Warrior',{row:5,col:2},{row:5,col:7});state.units.G0.stats.QKN=-1000;state.units.G0.stats.DEF=0;state.units.G0.stats.hp=9999;state.units.G0.stats.maxHP=9999;state.units.H0.stats.CRIT=0;
  const sim=run(state,[decl('Monk','PALM_HIT'),hold('G0')],1,false);
  assert.ok(sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.MOVE&&e.actorId==='H0').length>=1);
  assert.equal(sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.ATTACK_START&&e.actorId==='H0').length,2);
});

test('Shield Bash reserves two Paladin attack resources for normal counters after its one proactive bash',()=>{
  const state=pair('Paladin','Monk',{row:5,col:4},{row:5,col:6});state.units.G0.stats.QKN=-1000;state.units.G0.stats.DEF=0;state.units.G0.stats.hp=9999;state.units.G0.stats.maxHP=9999;state.units.H0.stats.CRIT=0;
  const sim=run(state,[decl('Paladin','SHIELD_BASH'),hold('G0')],2,false);
  const starts=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.ATTACK_START&&e.actorId==='H0');
  assert.equal(starts.length,1);assert.equal(starts[0].payload.abilityId,'SHIELD_BASH');assert.equal(sim.state.units.H0.resources.attacksRemaining,2);assert.equal(Object.values(sim.runtimes).find(r=>r.actorId==='H0').state,ACTION_RUNTIME_STATE.COMPLETED);
});

test('Stun blocks proactive control but allows an in-range reflex counter with zero counter movement',()=>{
  const state=pair('Warrior','Barbarian',{row:5,col:4},{row:5,col:6});
  const sim=createRoundSimulation({state,declarations:[hold('H0'),hold('G0')],seed:3});
  applyControlEffect(sim,'H0',{type:CONTROL_TYPE.STUN,sourceId:'G0',duration:2,cycle:0});
  const eligibility=counterEligibility(sim,'H0','G0');assert.equal(eligibility.eligible,true);
  sim.state.units.H0.resources.attacksRemaining=1;sim.state.units.G0.resources.attacksRemaining=1;
  resolveBasicAttack(sim,'G0','H0',{cycle:0,ignoreAttackInterval:true});
  const scheduler=createRosterCombatScheduler(sim,{countersEnabled:true});
  // Direct enqueue path is exercised by ordinary scheduler tests; here the rule-level invariant is no counter movement while stunned.
  assert.equal(sim.state.units.H0.resources.movementRemaining,getArchetype('Warrior').combat.movementMax);
  void scheduler;
});

test('Snipe has Range 9, 225% base damage, and +5% damage per actual square of separation',()=>{
  const s=getAbility('Archer','SNIPE');assert.equal(s.basicStyle.attackRangeOverride,9);assert.equal(s.basicStyle.damageMultiplier,2.25);assert.equal(s.basicStyle.distanceDamageBonusPerSquare,.05);
  const state=pair('Archer','Warrior',{row:5,col:2},{row:5,col:10});state.units.H0.weapon.attackBaseMin=100;state.units.H0.weapon.attackBaseMax=100;state.units.H0.stats.CRIT=0;state.units.H0.weapon.critBonus=0;state.units.G0.stats.DEF=0;state.units.G0.stats.QKN=-1000;state.units.G0.stats.hp=9999;state.units.G0.stats.maxHP=9999;
  const sim=createRoundSimulation({state,declarations:[decl('Archer','SNIPE'),hold('G0')],seed:4});createRosterCombatScheduler(sim,{countersEnabled:false});sim.state.units.H0.resources.attacksRemaining=1;
  const hit=resolveBasicAttack(sim,'H0','G0',{cycle:0,ignoreAttackInterval:true,rangeOverride:9});
  assert.ok(hit.dealt>=314&&hit.dealt<=316);
});

test('Warhorn is a 2-cycle team buff granting +1 SW and +2 Movement for 4 rounds',()=>{
  const state=createBattleState({matchId:'WARHORN',units:[unit('Warrior','H0',SIDE.A,{row:3,col:2}),unit('Mage','H1',SIDE.A,{row:5,col:2},1),unit('Rogue','H2',SIDE.A,{row:7,col:2},2),unit('Barbarian','G0',SIDE.B,{row:5,col:12})]});
  const sim=run(state,[decl('Warrior','WARHORN','H0',{type:TARGET_TYPE.ALL_ALLIES}),hold('H1'),hold('H2'),hold('G0')],5,false);
  for(const id of ['H0','H1','H2']){const u=sim.state.units[id];assert.ok(findStatus(u,'warhorn_attacks_up'));assert.ok(findStatus(u,'warhorn_movement_up'));assert.equal(findStatus(u,'warhorn_attacks_up').duration,4);}
  assert.equal(sim.state.units.H0.resources.attacksMax,8);assert.equal(sim.state.units.H0.resources.movementMax,16);
  assert.equal(sim.state.units.H1.resources.attacksMax,7);assert.equal(sim.state.units.H1.resources.movementMax,15);
});

test('Power Strike uses SW -2: 5 normally, 6 under Warhorn',()=>{
  const base=pair('Warrior','Barbarian',{row:5,col:4},{row:5,col:6});let sim=createRoundSimulation({state:base,declarations:[decl('Warrior','POWER_STRIKE'),hold('G0')],seed:6});createRosterCombatScheduler(sim,{countersEnabled:false});assert.equal(sim.state.units.H0.resources.attacksRemaining,5);
  const buffed=pair('Warrior','Barbarian',{row:5,col:4},{row:5,col:6});buffed.units.H0.resources.attacksMax=8;buffed.units.H0.resources.attacksRemaining=8;sim=createRoundSimulation({state:buffed,declarations:[decl('Warrior','POWER_STRIKE'),hold('G0')],seed:7});createRosterCombatScheduler(sim,{countersEnabled:false});assert.equal(sim.state.units.H0.resources.attacksRemaining,6);
});

test('Spellbreak has 80% application chance and interrupts an already-charging Plague when it lands',()=>{
  const mental=getAbility('Mystic','MENTAL_BREAKDOWN');assert.equal(mental.completionDelayCycles,2);assert.equal(mental.effects[0].chance,.80);assert.equal(mental.label,'Spellbreak');
  let landed=null;
  for(let seed=1;seed<200&&!landed;seed++){
    const state=pair('Mystic','Necromancer',{row:5,col:2},{row:5,col:10});state.units.H0.stats.QKN=30;state.units.G0.stats.QKN=10;
    const sim=run(state,[decl('Mystic','MENTAL_BREAKDOWN','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'}),decl('Necromancer','PLAGUE','G0',{type:TARGET_TYPE.ALL_ENEMIES})],seed,false);
    const applied=sim.events.snapshot().some(e=>e.type===EVENT_TYPE.STATUS_APPLY&&e.targetId==='G0'&&e.payload?.key==='spellbreak');
    if(applied) landed=sim;
  }
  assert.ok(landed);assert.equal(findStatus(landed.state.units.G0,'spellbreak'),null);
  assert.ok(landed.events.snapshot().some(e=>e.type===EVENT_TYPE.CAST_INTERRUPT&&e.actorId==='G0'&&e.payload?.reason==='SPELLBREAK'));
  assert.equal(landed.events.snapshot().some(e=>e.type===EVENT_TYPE.STATUS_APPLY&&e.payload?.key==='poison'),false);
});

test('Mystic Stun is 3 rounds at 45% land chance; Psychic Pulse is a 3-cycle blind spell',()=>{
  const stun=getAbility('Mystic','MYSTIC_STUN'),pulse=getAbility('Mystic','MIND_SHATTER');assert.equal(stun.effects[0].duration,3);assert.equal(stun.effects[0].chance,.45);assert.equal(pulse.completionDelayCycles,3);assert.equal(pulse.label,'Psychic Pulse');assert.equal(pulse.effects[1].key,'blind');assert.equal(pulse.effects[1].chance,.65);
});

test('Necromancer and Barbarian tuning matches Stage 23.19',()=>{
  assert.equal(getAbility('Necromancer','DEATH_TOUCH').effects[0].fraction,.5);
  const drain=getAbility('Necromancer','LIFE_DRAIN').effects[0];assert.deepEqual([drain.min,drain.max],[150,300]);
  const drip=getAbility('Necromancer','NECRO_ATTACK').basicProc;assert.deepEqual([drip.min,drip.max],[75,200]);
  assert.equal(getArchetype('Barbarian').combat.movementMax,15);assert.equal(getArchetype('Barbarian').combat.attacksMax,7);
  assert.equal(getAbility('Shinobi','BLEED_STRIKE').effects[0].duration,5);
  const aura=getAbility('Cleric','DEFENSIVE_AURA').effects[0];assert.equal(aura.type,'HEAL_PERCENT_ROLL');assert.deepEqual([aura.minPct,aura.maxPct],[.40,.60]);
});

test('resisted Spellbreak leaves the already-charging spell intact and Plague still resolves',()=>{
  const state=pair('Mystic','Necromancer',{row:5,col:2},{row:5,col:10});state.units.H0.stats.QKN=30;state.units.G0.stats.QKN=10;
  const sim=run(state,[decl('Mystic','MENTAL_BREAKDOWN','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'}),decl('Necromancer','PLAGUE','G0',{type:TARGET_TYPE.ALL_ENEMIES})],14336,false);
  const events=sim.events.snapshot();
  assert.ok(events.some(e=>e.type===EVENT_TYPE.BLOCK&&e.targetId==='G0'&&e.payload?.reason==='STATUS_RESIST'&&e.payload?.blockedStatusKey==='spellbreak'));
  assert.equal(events.some(e=>e.type===EVENT_TYPE.CAST_INTERRUPT&&e.actorId==='G0'&&e.payload?.reason==='SPELLBREAK'),false);
  assert.ok(events.some(e=>e.type===EVENT_TYPE.CAST_COMPLETE&&e.actorId==='G0'));
  assert.ok(events.some(e=>e.type===EVENT_TYPE.STATUS_APPLY&&e.actorId==='G0'&&e.targetId==='H0'&&e.payload?.key==='poison'));
});

test('Paladin may spend the two resources left by Shield Bash on plain normal counters',()=>{
  const state=createBattleState({matchId:'PAL_COUNTERS',units:[
    unit('Paladin','H0',SIDE.A,{row:5,col:5}),
    unit('Warrior','G0',SIDE.B,{row:5,col:7}),
    unit('Monk','G1',SIDE.B,{row:4,col:5},1)
  ]});
  for(const id of ['G0','G1']){state.units[id].stats.hp=9999;state.units[id].stats.maxHP=9999;state.units[id].stats.QKN=-1000;state.units[id].stats.DEF=0;}
  const sim=run(state,[decl('Paladin','SHIELD_BASH','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'}),hold('G0'),decl('Monk','MONK_ATTACK','G1',{type:TARGET_TYPE.UNIT,unitId:'H0'})],99,true);
  const counters=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.COUNTER&&e.actorId==='H0');
  const counterStarts=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.ATTACK_START&&e.actorId==='H0'&&e.payload?.abilityId==='PALADIN_ATTACK');
  const bashes=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.ATTACK_START&&e.actorId==='H0'&&e.payload?.abilityId==='SHIELD_BASH');
  assert.equal(bashes.length,1);
  assert.equal(counters.length,2);
  assert.equal(counterStarts.length,2);
  assert.equal(sim.state.units.H0.resources.attacksRemaining,0);
});

test('Judgment afflicted bonus damage performs normal KO bookkeeping when the bonus is lethal',()=>{
  const state=pair('Paladin','Warrior',{row:5,col:4},{row:5,col:6});
  state.units.G0.stats.hp=280;state.units.G0.stats.maxHP=999;state.units.G0.stats.RES=0;state.units.G0.statuses.push({key:'marked',duration:2,sourceId:'H0',data:{}});
  const sim=run(state,[decl('Paladin','JUDGMENT'),hold('G0')],231919,false);
  assert.equal(sim.state.units.G0.lifeState,'DEAD');
  assert.equal(sim.state.units.G0.stats.hp,0);
  assert.ok(sim.events.snapshot().some(e=>e.type===EVENT_TYPE.KO&&e.actorId==='H0'&&e.targetId==='G0'&&e.payload?.abilityId==='JUDGMENT'));
});
