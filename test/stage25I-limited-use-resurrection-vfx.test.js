import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

import {
  SIDE,
  TARGET_TYPE,
  LIFE_STATE,
  createBattleState,
  createHoldDeclaration,
  createRoundSimulation,
  createRosterAbilityDeclaration,
  createRosterCombatScheduler,
  createRosterUnit,
  getAbility,
  abilityUsesRemaining,
  abilityDetailModel
} from '../src/index.js';

function unit(archetypeId,unitId,side,draftSlot,position){
  return createRosterUnit({archetypeId,unitId,side,draftSlot,position});
}
function hold(roundNumber,actorId){
  return createHoldDeclaration({declarationId:`H${roundNumber}:${actorId}`,roundNumber,actorId});
}
function run(state,declarations,seed=123){
  const sim=createRoundSimulation({state,declarations,seed});
  createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:80});
  return sim;
}

test('limited-use counts are 3 Regen Potions, 1 God Tempest, and 2 Resurrections',()=>{
  const shinobi=unit('Shinobi','H0',SIDE.A,0,{row:4,col:2});
  const electro=unit('Electromancer','H1',SIDE.A,1,{row:5,col:2});
  const cleric=unit('Cleric','H2',SIDE.A,2,{row:6,col:2});
  assert.equal(abilityUsesRemaining(shinobi,getAbility('Shinobi','REGEN_POTION')),3);
  assert.equal(abilityUsesRemaining(electro,getAbility('Electromancer','GOD_TEMPEST')),1);
  assert.equal(abilityUsesRemaining(cleric,getAbility('Cleric','RESURRECTION')),2);
  shinobi.limitedUses.potion_regen=0;
  electro.limitedUses.god_tempest=0;
  cleric.limitedUses.resurrection=0;
  assert.equal(abilityUsesRemaining(shinobi,getAbility('Shinobi','REGEN_POTION')),0);
  assert.equal(abilityUsesRemaining(electro,getAbility('Electromancer','GOD_TEMPEST')),0);
  assert.equal(abilityUsesRemaining(cleric,getAbility('Cleric','RESURRECTION')),0);
});

test('Regen Potion is 35-60% max HP, cures Poison, and has 3 uses',()=>{
  const potion=getAbility('Shinobi','REGEN_POTION');
  const heal=potion.effects.find(e=>e.type==='HEAL_PERCENT_ROLL');
  assert.equal(heal.minPct,.35);
  assert.equal(heal.maxPct,.60);
  assert.deepEqual(potion.effects.find(e=>e.type==='CLEANSE').keys,['poison']);
  assert.equal(potion.usesMax,3);
});

test('Resurrection targets KO allied corpses only and never heals a living ally',()=>{
  const cleric=unit('Cleric','H0',SIDE.A,0,{row:5,col:2});
  const ally=unit('Warrior','H1',SIDE.A,1,{row:5,col:4});
  const enemy=unit('Barbarian','G0',SIDE.B,0,{row:5,col:10});
  ally.stats.hp=Math.floor(ally.stats.maxHP*.30);
  const before=ally.stats.hp;
  const state=createBattleState({matchId:'S25I-LIVING-RES',units:[cleric,ally,enemy]});
  const d=createRosterAbilityDeclaration({
    roundNumber:1,actorId:'H0',archetypeId:'Cleric',abilityId:'RESURRECTION',
    target:{type:TARGET_TYPE.UNIT,unitId:'H1'}
  });
  const sim=run(state,[d,hold(1,'H1'),hold(1,'G0')],42);
  assert.equal(sim.state.units.H1.lifeState,LIFE_STATE.ALIVE);
  assert.equal(sim.state.units.H1.stats.hp,before);
  assert.equal(sim.state.units.H0.limitedUses.resurrection,2);
  assert.ok(sim.events.snapshot().some(e=>e.type==='ACTION_INTERRUPT'&&e.actorId==='H0'&&e.payload?.reason==='TARGET_MUST_BE_KO_ALLY'));
  assert.equal(sim.events.snapshot().some(e=>e.type==='HEAL'&&e.actorId==='H0'&&e.targetId==='H1'),false);
});

test('Resurrection tooltip clearly states dead-only targeting and current charges',()=>{
  const cleric=unit('Cleric','H0',SIDE.A,0,{row:5,col:2});
  cleric.limitedUses.resurrection=1;
  const model=abilityDetailModel(cleric,getAbility('Cleric','RESURRECTION'));
  assert.equal(model.target,"KO'd allied corpse");
  assert.ok(model.lines.some(line=>/KO'd allied corpses only/i.test(line)));
  assert.ok(model.lines.some(line=>/1\/2 uses remaining this match/i.test(line)));
  assert.match(model.note,/Cannot target or heal living allies/i);
});

test('client disables exhausted limited-use buttons and Regen Potion ITEM_COMPLETE calls Shinobi D3 VFX',()=>{
  const scene=fs.readFileSync(new URL('../client/ros2-scene.js',import.meta.url),'utf8');
  assert.match(scene,/const exhausted=remaining===0/);
  assert.match(scene,/b\.disabled=this\.busy\|\|actor\.lifeState!==LIFE_STATE\.ALIVE\|\|exhausted/);
  assert.match(scene,/\[PRESENTATION_COMMAND\.ITEM_CUE\]:run\(c=>this\.animateItemCue\(c\)\)/);
  assert.match(scene,/eventType!=='ITEM_COMPLETE'/);
  assert.match(scene,/abilityId==='REGEN_POTION'/);
  assert.match(scene,/vfx-shinobi-regen/);
});
