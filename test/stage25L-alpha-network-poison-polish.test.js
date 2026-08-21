import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  EVENT_TYPE, PRESENTATION_COMMAND, SIDE, TARGET_TYPE,
  applyPoison, buildPresentationTimeline, createBattleState, createHoldDeclaration,
  createRosterAbilityDeclaration, createRosterCombatScheduler, createRosterUnit,
  createRoundSimulation, getAbility, processEndOfRoundStatuses
} from '../src/index.js';

function unit(archetypeId,unitId,side,position,draftSlot=0){return createRosterUnit({archetypeId,unitId,side,draftSlot,position});}
function hold(actorId){return createHoldDeclaration({declarationId:`H:${actorId}`,roundNumber:1,actorId});}
function decl(archetypeId,abilityId,actorId,target){return createRosterAbilityDeclaration({declarationId:`D:${actorId}`,roundNumber:1,actorId,archetypeId,abilityId,target});}
function run(state,declarations,seed=25){const sim=createRoundSimulation({state,declarations,seed});createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:500});return sim;}

test('Plague poison applications replay as one simultaneous status beat',()=>{
  const state=createBattleState({matchId:'PLAGUE-SIM',units:[
    unit('Necromancer','H0',SIDE.A,{row:5,col:2}),
    unit('Warrior','G0',SIDE.B,{row:3,col:10}),
    unit('Paladin','G1',SIDE.B,{row:7,col:10},1)
  ]});
  const sim=run(state,[decl('Necromancer','PLAGUE','H0',{type:TARGET_TYPE.ALL_ENEMIES}),hold('G0'),hold('G1')],31);
  const poison=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.STATUS_APPLY&&e.payload?.key==='poison'&&e.payload?.abilityId==='PLAGUE');
  assert.equal(poison.length,2);
  const group=buildPresentationTimeline(sim.events.snapshot()).find(c=>c.type===PRESENTATION_COMMAND.SIMULTANEOUS_FEEDBACK&&c.payload?.events?.every(e=>e.type===EVENT_TYPE.STATUS_APPLY&&e.payload?.abilityId==='PLAGUE'));
  assert.ok(group);assert.equal(group.payload.events.length,2);
});

test('end-of-round Poison damage across multiple champions replays simultaneously',()=>{
  const state=createBattleState({matchId:'POISON-TICK-SIM',units:[
    unit('Necromancer','H0',SIDE.A,{row:5,col:2}),
    unit('Warrior','G0',SIDE.B,{row:3,col:10}),
    unit('Paladin','G1',SIDE.B,{row:7,col:10},1)
  ]});
  const sim=createRoundSimulation({state,declarations:[hold('H0'),hold('G0'),hold('G1')],seed:44});
  applyPoison(sim,'G0',120,{sourceId:'H0'});applyPoison(sim,'G1',140,{sourceId:'H0'});
  processEndOfRoundStatuses(sim);
  const tickDamage=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.damageType==='POISON'&&e.payload?.source==='STATUS_TICK');
  assert.equal(tickDamage.length,2);
  const group=buildPresentationTimeline(sim.events.snapshot()).find(c=>c.type===PRESENTATION_COMMAND.SIMULTANEOUS_FEEDBACK&&c.payload?.events?.every(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.source==='STATUS_TICK'));
  assert.ok(group);assert.equal(group.payload.events.length,2);
});

test('current Snipe tuning is Range 9 with 5% distance bonus',()=>{
  const snipe=getAbility('Archer','SNIPE');
  assert.equal(snipe.basicStyle.attackRangeOverride,9);
  assert.equal(snipe.basicStyle.distanceDamageBonusPerSquare,.05);
});

test('Alpha client auto-connects production coordinator and exposes synchronized replay speed controls',()=>{
  const html=readFileSync(new URL('../client/index.html',import.meta.url),'utf8');
  const main=readFileSync(new URL('../client/main.js',import.meta.url),'utf8');
  const scene=readFileSync(new URL('../client/ros2-scene.js',import.meta.url),'utf8');
  assert.doesNotMatch(html,/id="wsUrl"|id="connectBtn"/);
  assert.match(main,/wss:\/\/ros2-coordinator\.onrender\.com\/ws/);
  for(const speed of ['0.25','0.33','0.5'])assert.match(html,new RegExp(`data-network-replay-speed="${speed.replace('.','\\.')}"`));
  assert.match(scene,/this\.replaySpeed=0\.33/);
  assert.match(scene,/replaySpeedLocked/);
  assert.match(html,/opponentWaitIndicator/);
});

test('status-dot and poison presentation hooks are present',()=>{
  const scene=readFileSync(new URL('../client/ros2-scene.js',import.meta.url),'utf8');
  assert.match(scene,/buffDot/);assert.match(scene,/afflictDot/);assert.match(scene,/controlDot/);
  assert.match(scene,/POISON.*contribution|poisonContribution/s);
  assert.match(scene,/PLAGUE_DETONATION/);
  assert.match(scene,/scale:\.289/);
});
