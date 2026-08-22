import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EVENT_TYPE, PRESENTATION_COMMAND, SIDE, TARGET_TYPE,
  buildPresentationTimeline, createBattleState, createHoldDeclaration,
  createRosterAbilityDeclaration, createRosterCombatScheduler, createRosterUnit,
  createRoundSimulation
} from '../src/index.js';

function unit(archetypeId,unitId,side,position,draftSlot=0){return createRosterUnit({archetypeId,unitId,side,draftSlot,position});}
function hold(actorId){return createHoldDeclaration({declarationId:`H:${actorId}`,roundNumber:1,actorId});}
function decl(archetypeId,abilityId,actorId,target){return createRosterAbilityDeclaration({declarationId:`D:${actorId}`,roundNumber:1,actorId,archetypeId,abilityId,target});}
function run(state,declarations,seed=25){const sim=createRoundSimulation({state,declarations,seed});createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:500});return sim;}

function wardedEnemy(archetypeId,unitId,row,slot){
  const u=unit(archetypeId,unitId,SIDE.B,{row,col:10},slot);
  u.statuses.push({key:'ward',duration:3,sourceId:'G0',data:{}});
  return u;
}

test('Plague Ward blocks across a protected team replay as one simultaneous BLOCK beat',()=>{
  const state=createBattleState({matchId:'PLAGUE-WARD-SIM',units:[
    unit('Necromancer','H0',SIDE.A,{row:5,col:2}),
    wardedEnemy('Paladin','G0',2,0),
    wardedEnemy('Cleric','G1',4,1),
    wardedEnemy('Shinobi','G2',6,2),
    wardedEnemy('Barbarian','G3',8,3)
  ]});
  const sim=run(state,[decl('Necromancer','PLAGUE','H0',{type:TARGET_TYPE.ALL_ENEMIES}),hold('G0'),hold('G1'),hold('G2'),hold('G3')],61);
  const blocks=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.BLOCK&&e.payload?.reason==='WARD'&&e.payload?.abilityId==='PLAGUE');
  assert.equal(blocks.length,4);
  const timeline=buildPresentationTimeline(sim.events.snapshot());
  const group=timeline.find(c=>c.type===PRESENTATION_COMMAND.SIMULTANEOUS_FEEDBACK&&c.payload?.events?.length===4&&c.payload.events.every(e=>e.type===EVENT_TYPE.BLOCK&&e.payload?.reason==='WARD'));
  assert.ok(group,'all four Plague Ward blocks should share one simultaneous presentation command');
});

test('Plague Detonation presentation keeps detonation damage first and reseeded Poison second',()=>{
  const enemies=[
    unit('Paladin','G0',SIDE.B,{row:2,col:10}),
    unit('Cleric','G1',SIDE.B,{row:4,col:10},1),
    unit('Shinobi','G2',SIDE.B,{row:6,col:10},2),
    unit('Barbarian','G3',SIDE.B,{row:8,col:10},3)
  ];
  for(const [i,u] of enemies.entries())u.statuses.push({key:'poison',duration:null,sourceId:'H0',data:{contributions:[{amount:80+i*20,sourceId:'H0'}]}});
  const state=createBattleState({matchId:'PLAGUE-DETONATE-TWO-BEAT',units:[unit('Necromancer','H0',SIDE.A,{row:5,col:2}),...enemies]});
  const sim=run(state,[decl('Necromancer','PLAGUE_DETONATION','H0',{type:TARGET_TYPE.ALL_ENEMIES}),hold('G0'),hold('G1'),hold('G2'),hold('G3')],62);
  const timeline=buildPresentationTimeline(sim.events.snapshot());
  const detIndex=timeline.findIndex(c=>c.type===PRESENTATION_COMMAND.SIMULTANEOUS_FEEDBACK&&c.payload?.events?.every(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.abilityId==='PLAGUE_DETONATION'));
  const reseedIndex=timeline.findIndex(c=>c.type===PRESENTATION_COMMAND.STATUS_FEEDBACK&&c.payload?.eventType===EVENT_TYPE.STATUS_APPLY&&c.payload?.abilityId==='PLAGUE_DETONATION'&&c.payload?.key==='poison');
  assert.ok(detIndex>=0,'detonation damage should be one simultaneous beat');
  assert.ok(reseedIndex>detIndex,'reseeded Poison should be presented after the detonation beat');
  assert.ok(Number(timeline[reseedIndex].payload?.contribution?.amount)>0);
});

test('client explicitly separates Plague Detonation reseed VFX/text from the consume beat',()=>{
  const scene=readFileSync(new URL('../client/ros2-scene.js',import.meta.url),'utf8');
  assert.match(scene,/plagueDetonationReseed/);
  assert.match(scene,/replayDuration\(180\)/);
  assert.match(scene,/vfx-necro-cloud/);
  assert.match(scene,/floatText\(id,'POISON'/);
  assert.match(scene,/`-\$\{Math\.floor\(poisonContribution\)\}`/);
});
