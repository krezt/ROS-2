import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_TYPE,
  LIFE_STATE,
  SIDE,
  TARGET_TYPE,
  RoundCoordinator,
  abilityIntent,
  advanceClosedRound,
  createBattleState,
  createHoldDeclaration,
  createRosterAbilityDeclaration,
  createRosterCombatScheduler,
  createRosterUnit,
  createRoundSimulation,
  describeAuthoritativeEvent,
  findStatus,
  getAbility,
  planCounterEscapeStep,
  poisonTotal,
  simulateRosterRoundPackage
} from '../src/index.js';

function unit(archetypeId,unitId,side,position,draftSlot=0){return createRosterUnit({archetypeId,unitId,side,draftSlot,position});}
function hold(actorId,roundNumber=1){return createHoldDeclaration({declarationId:`D${roundNumber}:${actorId}`,roundNumber,actorId});}
function decl(archetypeId,abilityId,actorId,target,roundNumber=1){return createRosterAbilityDeclaration({roundNumber,actorId,archetypeId,abilityId,target});}
function packageFor(state,declarationsA,declarationsB,seed=0x235235){const c=new RoundCoordinator({matchId:state.matchId,roundNumber:state.roundNumber,seedFactory:()=>seed});c.submitDeclarations('A',declarationsA);c.submitDeclarations('B',declarationsB);return c.releaseRoundPackage();}

test('Rogue Backstab is classified as hostile and therefore exposes enemy target selection',()=>{
  assert.equal(abilityIntent(getAbility('Rogue','BACKSTAB')),'ENEMY');
});

test('Meteor is battlefield-range and resolves against a far diagonal target',()=>{
  const mage=unit('Mage','H0',SIDE.A,{row:3,col:0});
  const cleric=unit('Cleric','G0',SIDE.B,{row:7,col:13});
  cleric.stats.DEF=0;cleric.stats.QKN=-1000;
  const state=createBattleState({matchId:'METEOR-RANGE',units:[mage,cleric]});
  const sim=createRoundSimulation({state,declarations:[decl('Mage','METEOR','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'}),hold('G0')],seed:55});
  createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:100});
  assert.equal(sim.events.snapshot().some(e=>e.type===EVENT_TYPE.CAST_FIZZLE&&e.actorId==='H0'),false);
  assert.ok(sim.events.snapshot().some(e=>e.type===EVENT_TYPE.DAMAGE&&e.actorId==='H0'&&e.targetId==='G0'&&e.payload?.abilityId==='METEOR'));
});

test('Rogue Poison Imbue applications tick visibly as authoritative end-of-round damage',()=>{
  const rogue=unit('Rogue','H0',SIDE.A,{row:3,col:3});
  const target=unit('Warrior','G0',SIDE.B,{row:3,col:5});
  target.stats.maxHP=10000;target.stats.hp=10000;target.stats.DEF=0;target.stats.QKN=-1000;
  rogue.statuses.push({key:'poison_imbue',duration:3,sourceId:'H0',data:{damageRatio:.65}});
  const state=createBattleState({matchId:'POISON-ROUND',units:[rogue,target]});
  const pkg=packageFor(state,[decl('Rogue','ROGUE_ATTACK','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'})],[hold('G0')],123456);
  const result=simulateRosterRoundPackage({baseState:state,roundPackage:pkg});
  const applied=result.events.filter(e=>e.type===EVENT_TYPE.STATUS_APPLY&&e.targetId==='G0'&&e.payload?.key==='poison');
  const ticks=result.events.filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.targetId==='G0'&&e.payload?.source==='STATUS_TICK'&&e.payload?.damageType==='POISON');
  assert.ok(applied.length>0,'imbued hits should add poison contributions');
  assert.equal(ticks.length,1,'poison should tick once at the authoritative end of the round');
  assert.ok(ticks[0].payload.amount>0);
  const hpAfterTick=result.sim.state.units.G0.stats.hp;
  const poisonAfterTick=poisonTotal(result.sim.state.units.G0);
  advanceClosedRound(result.sim);
  assert.equal(result.sim.state.units.G0.stats.hp,hpAfterTick,'advancing to next round must not tick poison a second time');
  assert.equal(poisonTotal(result.sim.state.units.G0),poisonAfterTick,'advance should not decay poison twice');
});

test('status-tick poison damage has explicit player-facing combat-log wording',()=>{
  const state=createBattleState({matchId:'POISON-LOG',units:[unit('Rogue','H0',SIDE.A,{row:3,col:3}),unit('Warrior','G0',SIDE.B,{row:3,col:5})]});
  const text=describeAuthoritativeEvent({eventId:'E1',sequence:0,parentEventId:null,initiativeCycle:12,type:EVENT_TYPE.DAMAGE,actorId:null,targetId:'G0',payload:{amount:44,damageType:'POISON',source:'STATUS_TICK',hpAfter:600}},state);
  assert.equal(text,'[C12] POISON ticks Warrior (G0) for 44 damage (600 HP).');
});

test('end-of-round Poison KO can decide the match before a new round is opened',()=>{
  const a=unit('Rogue','H0',SIDE.A,{row:3,col:3});
  const b=unit('Warrior','G0',SIDE.B,{row:3,col:5});b.stats.hp=5;
  b.statuses.push({key:'poison',duration:null,sourceId:null,data:{contributions:[{amount:10,sourceId:'H0'}]}});
  const state=createBattleState({matchId:'POISON-KO',units:[a,b]});
  const pkg=packageFor(state,[hold('H0')],[hold('G0')],444);
  const result=simulateRosterRoundPackage({baseState:state,roundPackage:pkg});
  assert.equal(result.sim.state.units.G0.lifeState,LIFE_STATE.DEAD);
  assert.equal(result.sim.state.outcome.status,'COMPLETE');
  assert.equal(result.sim.state.outcome.winner,SIDE.A);
});

test('blocked long-reach counter may reposition through a worse immediate distance to open a future escape lane',()=>{
  const barb=unit('Necromancer','H0',SIDE.A,{row:2,col:2});
  const warrior=unit('Warrior','G0',SIDE.B,{row:2,col:4});
  const blockers=[unit('Cleric','X0',SIDE.A,{row:2,col:1},1),unit('Cleric','X1',SIDE.A,{row:1,col:2},2),unit('Cleric','X2',SIDE.A,{row:3,col:2},3)];
  for(const b of blockers){b.lifeState=LIFE_STATE.DEAD;b.stats.hp=0;}
  const state=createBattleState({matchId:'COUNTER-ESCAPE',units:[barb,warrior,...blockers]});
  const plan=planCounterEscapeStep(state,'H0','G0',{rng:{choose:(xs)=>xs[0]}});
  assert.equal(plan.result,'MOVE');
  assert.equal(plan.escapeMode,'ESCAPE_SETUP');
  assert.deepEqual(plan.to,{row:2,col:3});
  assert.equal(plan.targetDistanceBefore,2);
  assert.equal(plan.targetDistanceAfter,1,'temporary closure is allowed only because it opens a better future route');

  warrior.weapon.attackBaseMin=1;warrior.weapon.attackBaseMax=1;warrior.stats.CRIT=0;barb.stats.DEF=0;
  const sim=createRoundSimulation({state,declarations:[hold('H0'),decl('Warrior','WARRIOR_ATTACK','G0',{type:TARGET_TYPE.UNIT,unitId:'H0'})],seed:42});
  createRosterCombatScheduler(sim,{countersEnabled:true}).runUntilCombatSettled({maxCycles:30});
  const firstCounterMove=sim.events.snapshot().find(e=>e.type===EVENT_TYPE.COUNTER_MOVE&&e.actorId==='H0');
  assert.equal(firstCounterMove?.payload?.movementReason,'COUNTER_ESCAPE_SETUP');
  assert.ok(sim.events.snapshot().some(e=>e.type===EVENT_TYPE.ATTACK_START&&e.actorId==='H0'&&e.payload?.attackReason==='COUNTER'));
});

test('Chain Lightning bounce pool deliberately includes allies and caster after the initial hostile target',()=>{
  const electro=unit('Electromancer','H0',SIDE.A,{row:3,col:3});
  const ally=unit('Warrior','H1',SIDE.A,{row:5,col:3},1);
  const e0=unit('Warrior','G0',SIDE.B,{row:3,col:6});
  const e1=unit('Cleric','G1',SIDE.B,{row:5,col:6},1);
  for(const u of [electro,ally,e0,e1]){u.stats.maxHP=10000;u.stats.hp=10000;u.stats.DEF=0;u.stats.QKN=-1000;}
  let friendlyHit=false;
  for(let seed=1;seed<=200&&!friendlyHit;seed++){
    const st=createBattleState({matchId:`CHAIN-RISK-${seed}`,units:[structuredClone(electro),structuredClone(ally),structuredClone(e0),structuredClone(e1)]});
    const declarations=[decl('Electromancer','CHAIN_LIGHTNING','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'}),hold('H1'),hold('G0'),hold('G1')];
    const sim=createRoundSimulation({state:st,declarations,seed});
    createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:100});
    const chainDamage=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.abilityId==='CHAIN_LIGHTNING');
    assert.equal(chainDamage[0]?.targetId,'G0','initial Chain Lightning target remains the chosen enemy');
    friendlyHit=chainDamage.slice(1).some(e=>sim.state.units[e.targetId].side===SIDE.A);
  }
  assert.equal(friendlyHit,true,'some synchronized seeds should bounce Chain Lightning into an ally or the caster');
});

test('Mystic disruption abilities remain hostile target intent, never ally support',()=>{
  for(const id of ['MENTAL_BREAKDOWN','MIND_SHATTER']) assert.equal(abilityIntent(getAbility('Mystic',id)),'ENEMY',id);
});

test('targeted spells default to battlefield range while physical abilities keep explicit/non-spell range rules',()=>{
  assert.equal(getAbility('Mystic','MYSTIC_STUN').castRange,999);
  assert.equal(getAbility('Mage','FIREBALL').castRange,999);
  assert.equal(getAbility('Electromancer','CHAIN_LIGHTNING').castRange,999);
  assert.equal(getAbility('Archer','VOLLEY').castRange,999);
  assert.equal(getAbility('Rogue','BACKSTAB').castRange,14);
});
