import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_TYPE,
  PRESENTATION_COMMAND,
  SIDE,
  TARGET_TYPE,
  buildPresentationTimeline,
  createBattleState,
  createHoldDeclaration,
  createRosterAbilityDeclaration,
  createRosterCombatScheduler,
  createRosterUnit,
  createRoundSimulation,
  getArchetype,
  getAbility,
  shouldFloatStatusFeedback,
  unitHudModel
} from '../src/index.js';

function unit(archetypeId,unitId,side,position,draftSlot=0){return createRosterUnit({archetypeId,unitId,side,draftSlot,position});}
function hold(actorId,roundNumber=1){return createHoldDeclaration({declarationId:`D${roundNumber}:${actorId}`,roundNumber,actorId});}
function decl(archetypeId,abilityId,actorId,target,roundNumber=1){return createRosterAbilityDeclaration({roundNumber,actorId,archetypeId,abilityId,target});}
function run(state,declarations,seed=123){const sim=createRoundSimulation({state,declarations,seed});createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:300});return sim;}

function setEasyTarget(u){u.stats.DEF=0;u.stats.QKN=-1000;u.stats.maxHP=10000;u.stats.hp=10000;return u;}

test('Fireball is true geometric friendly fire: allies standing in the 3x3 footprint are roasted too',()=>{
  const mage=unit('Mage','H0',SIDE.A,{row:3,col:1});
  const ally=setEasyTarget(unit('Warrior','H1',SIDE.A,{row:5,col:7},1));
  const enemy=setEasyTarget(unit('Barbarian','G0',SIDE.B,{row:5,col:8}));
  const state=createBattleState({matchId:'FF-FIREBALL',units:[mage,ally,enemy]});
  const sim=run(state,[decl('Mage','FIREBALL','H0',{type:TARGET_TYPE.GROUND,row:5,col:8}),hold('H1'),hold('G0')],9);
  const hits=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.abilityId==='FIREBALL');
  assert.deepEqual(new Set(hits.map(e=>e.targetId)),new Set(['H1','G0']));
  assert.equal(getAbility('Mage','FIREBALL').effects[0].hostileOnly,false);
});

test('Volley is true 5x5 friendly fire as well as enemy AoE',()=>{
  const archer=unit('Archer','H0',SIDE.A,{row:3,col:1});
  const ally=setEasyTarget(unit('Warrior','H1',SIDE.A,{row:5,col:7},1));
  const enemy=setEasyTarget(unit('Barbarian','G0',SIDE.B,{row:5,col:8}));
  const state=createBattleState({matchId:'FF-VOLLEY',units:[archer,ally,enemy]});
  const sim=run(state,[decl('Archer','VOLLEY','H0',{type:TARGET_TYPE.GROUND,row:5,col:8}),hold('H1'),hold('G0')],11);
  const hits=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.abilityId==='VOLLEY');
  assert.deepEqual(new Set(hits.map(e=>e.targetId)),new Set(['H1','G0']));
});

test('AoE damage events share a simultaneous presentation group and replay as one simultaneous feedback command',()=>{
  const mage=unit('Mage','H0',SIDE.A,{row:3,col:1});
  const ally=setEasyTarget(unit('Warrior','H1',SIDE.A,{row:5,col:7},1));
  const enemy=setEasyTarget(unit('Barbarian','G0',SIDE.B,{row:5,col:8}));
  const state=createBattleState({matchId:'AOE-SIMUL',units:[mage,ally,enemy]});
  const sim=run(state,[decl('Mage','FIREBALL','H0',{type:TARGET_TYPE.GROUND,row:5,col:8}),hold('H1'),hold('G0')],17);
  const hits=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.abilityId==='FIREBALL');
  assert.equal(hits.length,2);assert.ok(hits.every(e=>e.payload.simultaneousGroup===hits[0].payload.simultaneousGroup));
  const timeline=buildPresentationTimeline(sim.events.snapshot());
  const group=timeline.find(c=>c.type===PRESENTATION_COMMAND.SIMULTANEOUS_FEEDBACK&&c.payload?.simultaneousGroup===hits[0].payload.simultaneousGroup);
  assert.ok(group);assert.equal(group.payload.events.length,2);
});

test('Electrical Storm packages ally heals and enemy damage into the same simultaneous presentation beat',()=>{
  const e=unit('Electromancer','H0',SIDE.A,{row:3,col:1});e.stats.hp-=100;
  const ally=unit('Warrior','H1',SIDE.A,{row:5,col:1},1);ally.stats.hp-=100;
  const enemy=setEasyTarget(unit('Barbarian','G0',SIDE.B,{row:3,col:8}));
  const state=createBattleState({matchId:'STORM-SIMUL',units:[e,ally,enemy]});
  const sim=run(state,[decl('Electromancer','ELECTRICAL_STORM','H0',{type:TARGET_TYPE.ALL_ENEMIES}),hold('H1'),hold('G0')],31);
  const consequences=sim.events.snapshot().filter(e=>(e.type===EVENT_TYPE.DAMAGE||e.type===EVENT_TYPE.HEAL)&&e.payload?.abilityId==='ELECTRICAL_STORM');
  assert.equal(consequences.length,3);
  assert.equal(new Set(consequences.map(e=>e.payload.simultaneousGroup)).size,1);
  const group=buildPresentationTimeline(sim.events.snapshot()).find(c=>c.type===PRESENTATION_COMMAND.SIMULTANEOUS_FEEDBACK&&c.payload?.simultaneousGroup===consequences[0].payload.simultaneousGroup);
  assert.equal(group?.payload?.events?.length,3);
});

test('Chain Lightning remains sequential rather than being tagged as simultaneous AoE',()=>{
  const e=unit('Electromancer','H0',SIDE.A,{row:3,col:1});
  const ally=setEasyTarget(unit('Warrior','H1',SIDE.A,{row:5,col:1},1));
  const enemy=setEasyTarget(unit('Barbarian','G0',SIDE.B,{row:3,col:8}));
  const state=createBattleState({matchId:'CHAIN-SEQUENTIAL',units:[e,ally,enemy]});
  const sim=run(state,[decl('Electromancer','CHAIN_LIGHTNING','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'}),hold('H1'),hold('G0')],2);
  const hits=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.abilityId==='CHAIN_LIGHTNING');
  assert.ok(hits.length>=1);assert.ok(hits.every(e=>!e.payload.simultaneousGroup));
});

test('regular Attack is first in every archetype ability list',()=>{
  for(const id of ['Warrior','Barbarian','Rogue','Cleric','Mage','Paladin','Archer','Monk','Necromancer','Mystic','Shinobi','Electromancer']){
    assert.equal(getArchetype(id).abilities[0].label,'Attack',id);
  }
});

test('current movement tuning includes the Warrior, Barbarian and Paladin buffs',()=>{
  const expected={Warrior:14,Barbarian:15,Rogue:16,Cleric:11,Mage:13,Paladin:14,Archer:12,Monk:15,Necromancer:11,Mystic:13,Shinobi:16,Electromancer:12};
  for(const [id,movementMax] of Object.entries(expected))assert.equal(getArchetype(id).combat.movementMax,movementMax,id);
});

test('Selected Champion HUD exposes QKN plus effective ATK/SDM/DEF modifiers',()=>{
  const w=unit('Warrior','H0',SIDE.A,{row:3,col:1});
  w.statuses.push({key:'atk_up',duration:2,sourceId:'H0',data:{stacks:1}},{key:'def_down',duration:2,sourceId:'G0',data:{stacks:1}});
  const h=unitHudModel(w);
  assert.equal(h.qkn,w.stats.QKN);assert.ok(h.atkStat.effective>h.atkStat.base);assert.ok(h.atkStat.pct>0);assert.ok(h.defStat.effective<h.defStat.base);assert.ok(h.defStat.pct<0);
});

test('status-float policy hides countdown spam but keeps loss-of-control and poison/bleed acquisition/expiry',()=>{
  assert.equal(shouldFloatStatusFeedback({payload:{eventType:EVENT_TYPE.STATUS_DURATION,key:'atk_down'}}),false);
  assert.equal(shouldFloatStatusFeedback({payload:{eventType:EVENT_TYPE.STATUS_EXPIRE,key:'atk_down'}}),false);
  assert.equal(shouldFloatStatusFeedback({payload:{eventType:EVENT_TYPE.STATUS_APPLY,key:'stun'}}),true);
  assert.equal(shouldFloatStatusFeedback({payload:{eventType:EVENT_TYPE.STATUS_EXPIRE,key:'stun'}}),true);
  assert.equal(shouldFloatStatusFeedback({payload:{eventType:EVENT_TYPE.STATUS_APPLY,key:'poison'}}),true);
  assert.equal(shouldFloatStatusFeedback({payload:{eventType:EVENT_TYPE.STATUS_APPLY,key:'atk_up'}}),false);
});

test('Fireball can roast its own caster when the locked 3x3 footprint contains the Mage',()=>{
  const mage=setEasyTarget(unit('Mage','H0',SIDE.A,{row:5,col:5}));
  const enemy=setEasyTarget(unit('Barbarian','G0',SIDE.B,{row:5,col:6}));
  const state=createBattleState({matchId:'FF-FIREBALL-SELF',units:[mage,enemy]});
  const sim=run(state,[decl('Mage','FIREBALL','H0',{type:TARGET_TYPE.GROUND,row:5,col:5}),hold('G0')],29);
  const hits=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.abilityId==='FIREBALL');
  assert.ok(hits.some(e=>e.targetId==='H0'),'caster standing in the blast must take friendly-fire damage');
  assert.ok(hits.some(e=>e.targetId==='G0'));
});

test('Chain Lightning can bounce back into the Electromancer himself',()=>{
  let selfHit=false;
  for(let seed=1;seed<=20&&!selfHit;seed++){
    const electro=setEasyTarget(unit('Electromancer','H0',SIDE.A,{row:3,col:2}));
    const enemy=setEasyTarget(unit('Warrior','G0',SIDE.B,{row:3,col:8}));
    const state=createBattleState({matchId:`CHAIN-SELF-${seed}`,units:[electro,enemy]});
    const sim=run(state,[decl('Electromancer','CHAIN_LIGHTNING','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'}),hold('G0')],seed);
    const hits=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.abilityId==='CHAIN_LIGHTNING');
    selfHit=hits.some(e=>e.targetId==='H0');
  }
  assert.equal(selfHit,true,'with one enemy and the caster left, a successful bounce must be able to electrocute the caster');
});

test('War Cry damage and defense reduction both apply across all living enemies',()=>{
  const barb=unit('Barbarian','H0',SIDE.A,{row:3,col:1});
  const e0=setEasyTarget(unit('Warrior','G0',SIDE.B,{row:3,col:8}));
  const e1=setEasyTarget(unit('Cleric','G1',SIDE.B,{row:5,col:8},1));
  const state=createBattleState({matchId:'WARCRY-GLOBAL',units:[barb,e0,e1]});
  const sim=run(state,[decl('Barbarian','WAR_CRY','H0',{type:TARGET_TYPE.ALL_ENEMIES}),hold('G0'),hold('G1')],41);
  const hits=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.abilityId==='WAR_CRY');
  assert.deepEqual(new Set(hits.map(e=>e.targetId)),new Set(['G0','G1']));
  assert.ok(sim.state.units.G0.statuses.some(s=>s.key==='def_down'));
  assert.ok(sim.state.units.G1.statuses.some(s=>s.key==='def_down'));
  assert.equal(new Set(hits.map(e=>e.payload.simultaneousGroup)).size,1);
});
