import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  AI_DIFFICULTY, DAMAGE_TYPE, GameplayRng, SIDE,
  createBattleState, createRosterUnit, effectiveCritMultiplier,
  getAbility, getArchetype, incomingDamageMultiplier, planAiDeclarations
} from '../src/index.js';

function unit(archetypeId,unitId,side,position,slot=0){
  return createRosterUnit({archetypeId,unitId,side,draftSlot:slot,position});
}
function stateOf(units,matchId='S25Z'){return createBattleState({matchId,units});}
function tactical(state,side=SIDE.A,seed=0x25a){
  return planAiDeclarations({state,side,difficulty:AI_DIFFICULTY.TACTICAL,decisionRng:new GameplayRng(seed)});
}

test('Stage 25Z requested balance tuning is authoritative',()=>{
  const marked=unit('Warrior','G0',SIDE.B,{row:4,col:6});
  marked.statuses.push({key:'marked',duration:2,sourceId:'H0',data:{}});
  assert.equal(incomingDamageMultiplier(marked,DAMAGE_TYPE.PHYSICAL),1.65);
  assert.equal(incomingDamageMultiplier(marked,DAMAGE_TYPE.MAGICAL),1.65);

  const rogue=getArchetype('Rogue');
  assert.equal(rogue.combat.movementMax,17);
  const shadow=getAbility('Rogue','SHADOWSTEP').effects.find(e=>e.type==='APPLY_STATUS'&&e.key==='shadowstep_crit');
  assert.equal(shadow.data.multiplier,2.5);
  const rogueUnit=unit('Rogue','H0',SIDE.A,{row:4,col:3});
  rogueUnit.statuses.push({key:'shadowstep_crit',duration:2,sourceId:'H0',data:{multiplier:2.5}});
  assert.equal(effectiveCritMultiplier(rogueUnit),2.5);

  assert.equal(getAbility('Archer','SNIPE').basicStyle.attackRangeOverride,8);
  const barbarian=getArchetype('Barbarian');
  assert.deepEqual([barbarian.weapon.attackBaseMin,barbarian.weapon.attackBaseMax],[80,110]);
});

test('1P client opts into Tactical AI without changing PvP',()=>{
  assert.equal(AI_DIFFICULTY.TACTICAL,'TACTICAL');
  const scene=readFileSync(new URL('../client/ros2-scene.js',import.meta.url),'utf8');
  assert.match(scene,/LocalSinglePlayerMatch\(\{state,aiDifficulty:'TACTICAL'\}\)/);
});

test('Tactical Mystic does not treat Premonition as a blanket maintenance spell',()=>{
  const state=stateOf([
    unit('Mystic','H0',SIDE.A,{row:4,col:3}),
    unit('Warrior','G0',SIDE.B,{row:4,col:8})
  ],'S25Z-MYSTIC');
  const plan=tactical(state);
  const mystic=plan.find(d=>d.actorId==='H0');
  assert.ok(mystic);
  assert.notEqual(mystic.actionId,'PREMONITION');
});

test('Tactical Shinobi ignores a trivial self debuff but dispels an ally in real control danger',()=>{
  let state=stateOf([
    unit('Shinobi','H0',SIDE.A,{row:4,col:3}),
    unit('Warrior','G0',SIDE.B,{row:4,col:8})
  ],'S25Z-SHINOBI-TRIVIAL');
  state.units.H0.statuses.push({key:'def_down',duration:2,sourceId:'G0',data:{stacks:1}});
  let plan=tactical(state);
  assert.notEqual(plan.find(d=>d.actorId==='H0')?.actionId,'DISPEL');

  state=stateOf([
    unit('Shinobi','H0',SIDE.A,{row:4,col:3}),
    unit('Archer','H1',SIDE.A,{row:6,col:3},1),
    unit('Warrior','G0',SIDE.B,{row:4,col:8}),
    unit('Barbarian','G1',SIDE.B,{row:6,col:8},1)
  ],'S25Z-SHINOBI-RESCUE');
  state.units.H1.statuses.push(
    {key:'stun',duration:2,sourceId:'G0',data:{}},
    {key:'marked',duration:2,sourceId:'G1',data:{}}
  );
  state.units.H1.stats.hp=Math.floor(state.units.H1.stats.maxHP*.35);
  plan=tactical(state, SIDE.A, 0x25b);
  const shinobi=plan.find(d=>d.actorId==='H0');
  assert.equal(shinobi?.actionId,'DISPEL');
  assert.equal(shinobi?.target?.unitId,'H1');
});

test('Tactical Mage breaks offense to defend against immediate melee pressure',()=>{
  const state=stateOf([
    unit('Mage','H0',SIDE.A,{row:4,col:4}),
    unit('Barbarian','G0',SIDE.B,{row:4,col:6})
  ],'S25Z-MAGE');
  state.units.H0.stats.hp=Math.floor(state.units.H0.stats.maxHP*.45);
  const plan=tactical(state, SIDE.A, 0x25c);
  const mage=plan.find(d=>d.actorId==='H0');
  assert.ok(['ARCANE_SURGE','METEOR'].includes(mage?.actionId),`unexpected defensive choice ${mage?.actionId}`);
});
