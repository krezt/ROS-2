import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EVENT_TYPE, SIDE, TARGET_TYPE,
  createBattleState, createHoldDeclaration, createRosterAbilityDeclaration,
  createRosterCombatScheduler, createRosterUnit, createRoundSimulation,
  findStatus, getAbility, resolveBasicAttack, resolveRosterEffects
} from '../src/index.js';

function unit(archetypeId,unitId,side,position,slot=0){
  return createRosterUnit({archetypeId,unitId,side,draftSlot:slot,position});
}
function hold(actorId,roundNumber=1){
  return createHoldDeclaration({declarationId:`H:${roundNumber}:${actorId}`,roundNumber,actorId});
}
function decl(archetypeId,abilityId,actorId,target,roundNumber=1){
  return createRosterAbilityDeclaration({declarationId:`D:${roundNumber}:${actorId}`,roundNumber,actorId,archetypeId,abilityId,target});
}
function noDodge(u){u.stats.QKN=-1000;}

test('Stage25AG Shieldwall redirects Mystic throwing-dagger physical hits',()=>{
  const warrior=unit('Warrior','H0',SIDE.A,{row:5,col:4});
  const ally=unit('Cleric','H1',SIDE.A,{row:5,col:5},1);
  const mystic=unit('Mystic','G0',SIDE.B,{row:5,col:9});
  noDodge(ally);noDodge(warrior);
  warrior.stats.hp=warrior.stats.maxHP=99999;ally.stats.hp=ally.stats.maxHP=99999;
  warrior.statuses.push({key:'shield_redirect',duration:1,sourceId:'H0',data:{remaining:5,physicalOnly:true}});
  const sim=createRoundSimulation({
    state:createBattleState({matchId:'AG-SHIELDWALL-DAGGER',units:[warrior,ally,mystic]}),
    declarations:[hold('H0'),hold('H1'),decl('Mystic','MYSTIC_ATTACK','G0',{type:TARGET_TYPE.UNIT,unitId:'H1'})],seed:41
  });
  createRosterCombatScheduler(sim,{countersEnabled:false});
  mystic.resources.attacksRemaining=1;
  const hit=resolveBasicAttack(sim,'G0','H1',{cycle:0,ignoreAttackInterval:true});
  assert.equal(hit.targetId,'H0');
  const intercept=sim.events.snapshot().find(e=>e.type===EVENT_TYPE.INTERCEPT&&e.actorId==='H0');
  assert.ok(intercept);
  const damage=sim.events.snapshot().find(e=>e.type===EVENT_TYPE.DAMAGE&&e.actorId==='G0');
  assert.equal(damage.targetId,'H0');
});

test('Stage25AG Mystic throwing daggers trigger Shift',()=>{
  const mystic=unit('Mystic','H0',SIDE.A,{row:5,col:3});
  const electro=unit('Electromancer','G0',SIDE.B,{row:5,col:8});
  noDodge(electro);electro.statuses.push({key:'shift',duration:2,sourceId:'G0',data:{}});
  const sim=createRoundSimulation({
    state:createBattleState({matchId:'AG-DAGGER-SHIFT',units:[mystic,electro]}),
    declarations:[decl('Mystic','MYSTIC_ATTACK','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'}),hold('G0')],seed:52
  });
  createRosterCombatScheduler(sim,{countersEnabled:false});
  mystic.resources.attacksRemaining=1;
  resolveBasicAttack(sim,'H0','G0',{cycle:0,ignoreAttackInterval:true});
  assert.ok(sim.events.snapshot().some(e=>e.type===EVENT_TYPE.TELEPORT&&e.targetId==='G0'&&e.payload?.reason==='SHIFT_THROWING_DAGGER_REACTION'));
});

test('Stage25AG Snipe is Range 10, retreats up to three squares before firing, and triggers Shift on hit',()=>{
  const snipe=getAbility('Archer','SNIPE');
  assert.equal(snipe.basicStyle.attackRangeOverride,10);
  assert.equal(snipe.basicStyle.damageMultiplier,2.10);
  assert.equal(snipe.basicStyle.preAttackRetreatSteps,3);
  assert.ok(Math.abs((2.10*(1+10*.05))-(2.25*(1+8*.05)))<1e-12,'new max-range scalar should equal the old Range-8 scalar');

  const archer=unit('Archer','H0',SIDE.A,{row:5,col:4});
  const target=unit('Warrior','G0',SIDE.B,{row:5,col:10});
  noDodge(target);target.stats.hp=target.stats.maxHP=99999;target.stats.QKN=-1000;
  const sim=createRoundSimulation({
    state:createBattleState({matchId:'AG-SNIPE-RETREAT',units:[archer,target]}),
    declarations:[decl('Archer','SNIPE','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'}),hold('G0')],seed:61
  });
  createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:100});
  const moves=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.MOVE&&e.actorId==='H0'&&e.payload?.movementReason==='STYLE_PRE_ATTACK_RETREAT');
  const starts=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.ATTACK_START&&e.actorId==='H0'&&e.payload?.abilityId==='SNIPE');
  assert.equal(moves.length,3);
  assert.equal(starts.length,3);
  assert.deepEqual(sim.state.units.H0.position,{row:5,col:1});

  const archer2=unit('Archer','A0',SIDE.A,{row:5,col:2});
  const electro=unit('Electromancer','E0',SIDE.B,{row:5,col:12});
  noDodge(electro);electro.statuses.push({key:'shift',duration:2,sourceId:'E0',data:{}});
  const sim2=createRoundSimulation({
    state:createBattleState({matchId:'AG-SNIPE-SHIFT',units:[archer2,electro]}),
    declarations:[decl('Archer','SNIPE','A0',{type:TARGET_TYPE.UNIT,unitId:'E0'}),hold('E0')],seed:62
  });
  createRosterCombatScheduler(sim2,{countersEnabled:false});
  archer2.resources.attacksRemaining=1;
  resolveBasicAttack(sim2,'A0','E0',{cycle:0,ignoreAttackInterval:true,rangeOverride:10});
  assert.ok(sim2.events.snapshot().some(e=>e.type===EVENT_TYPE.TELEPORT&&e.targetId==='E0'&&e.payload?.reason==='SHIFT_SNIPE_REACTION'));
});

test('Stage25AG Arcane Surge grants Shift for a deterministic 50/50 one-or-two-round roll',()=>{
  const surge=getAbility('Mage','ARCANE_SURGE');
  const shiftEffect=surge.effects.find(e=>e.key==='shift');
  assert.deepEqual([shiftEffect.durationMin,shiftEffect.durationMax],[1,2]);
  const seen=new Set();
  for(let seed=1;seed<=16;seed++){
    const mage=unit('Mage','H0',SIDE.A,{row:5,col:4});
    const enemy=unit('Warrior','G0',SIDE.B,{row:5,col:10});
    const sim=createRoundSimulation({state:createBattleState({matchId:`AG-SURGE-${seed}`,units:[mage,enemy]}),declarations:[hold('H0'),hold('G0')],seed});
    resolveRosterEffects(sim,{actorId:'H0',ability:surge,validity:{target:sim.state.units.H0},cycle:0});
    seen.add(findStatus(sim.state.units.H0,'shift')?.duration);
  }
  assert.deepEqual([...seen].sort(),[1,2]);
});

test('Stage25AG War Cry heals the Barbarian for 10–15% maximum HP in addition to its enemy pressure',()=>{
  const barb=unit('Barbarian','H0',SIDE.A,{row:5,col:3});
  const enemy=unit('Warrior','G0',SIDE.B,{row:5,col:10});
  barb.stats.hp=1000;enemy.stats.hp=enemy.stats.maxHP=99999;enemy.stats.QKN=-1000;
  const sim=createRoundSimulation({
    state:createBattleState({matchId:'AG-WARCRY-HEAL',units:[barb,enemy]}),
    declarations:[decl('Barbarian','WAR_CRY','H0',{type:TARGET_TYPE.ALL_ENEMIES}),hold('G0')],seed:73
  });
  createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:50});
  const heal=sim.events.snapshot().find(e=>e.type===EVENT_TYPE.HEAL&&e.actorId==='H0'&&e.payload?.abilityId==='WAR_CRY');
  assert.ok(heal);
  assert.ok(heal.payload.amount>=Math.floor(2250*.10));
  assert.ok(heal.payload.amount<=Math.ceil(2250*.15));
});

test('Stage25AG active spectatable matches are discoverable with a SPECTATE button from both 2P lobby modes',()=>{
  const main=readFileSync(new URL('../client/main.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../client/index.html',import.meta.url),'utf8');
  assert.match(html,/id="pvpButton"[^>]*>2P DRAFT</);
  assert.match(html,/id="rankedButton"[^>]*>2P RANKED</);
  assert.match(main,/Boolean\(room\.ranked\)===networkRankedMode\|\|room\.spectatable===true/);
  assert.match(main,/spectate\.textContent='SPECTATE'/);
  assert.match(main,/spectate\.disabled=!room\.spectatable/);
  assert.match(main,/socket\?\.spectateRoom\(room\.id\)/);
});
