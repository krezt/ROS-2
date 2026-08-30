import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EVENT_TYPE,
  SIDE,
  TARGET_TYPE,
  abilityDetailModel,
  closeRound,
  createBattleState,
  createHoldDeclaration,
  createRosterAbilityDeclaration,
  createRosterCombatScheduler,
  createRosterUnit,
  createRoundSimulation,
  findStatus,
  getAbility
} from '../src/index.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=path=>readFileSync(resolve(root,path),'utf8');
const unit=(archetypeId,unitId,side,position)=>createRosterUnit({archetypeId,unitId,side,draftSlot:0,position});
const hold=(actorId,roundNumber)=>createHoldDeclaration({declarationId:`D${roundNumber}:${actorId}`,roundNumber,actorId});

test('Stage25V boots to an idle board and waits for an explicit mode selection',()=>{
  const html=source('client/index.html'),scene=source('client/ros2-scene.js'),main=source('client/main.js');
  assert.match(scene,/this\.mode='IDLE'/);
  assert.match(scene,/this\.enterIdleState\(\{startup:true\}\)/);
  assert.doesNotMatch(html,/id="rosterButton"[^>]*class="[^"]*active/);
  assert.match(html,/Select a game mode from the top bar to begin\./);
  assert.match(html,/id="roundNo">—<\/strong>/);
  assert.match(html,/id="timer">--:--<\/div>/);
  assert.match(main,/activateTopButton\(null\);/);
});

test('Stage25V centralizes match cleanup before local, network, and rematch starts',()=>{
  const scene=source('client/ros2-scene.js'),main=source('client/main.js');
  assert.match(scene,/cleanupMatchState\(\{clearBattlefield=true,clearCombatLog=false,dispatchReset=true\}=\{\}\)/);
  assert.match(scene,/prepareForNewMatch\(\)[\s\S]*clearCombatLog:true/);
  assert.match(scene,/startSinglePlayer\([^)]*\)[\s\S]*this\.prepareForNewMatch\(\)/);
  assert.match(scene,/beginNetworkMatch\([^)]*\)[\s\S]*this\.prepareForNewMatch\(\)/);
  assert.match(scene,/prepareNetworkRematch\(\)[\s\S]*this\.prepareForNewMatch\(\)/);
  assert.match(scene,/finalizeCompletedMatch\(\)/);
  assert.match(main,/prepareLocalModeSelection\(\)[\s\S]*socket\.leaveRoom\(\)[\s\S]*scene\.enterIdleState/);
});

test('Stage25V 2P chat can collapse/expand while retaining unread behavior',()=>{
  const html=source('client/index.html'),main=source('client/main.js'),css=source('client/styles.css');
  assert.match(html,/id="chatCollapseButton"[^>]*>COLLAPSE<\/button>/);
  assert.match(main,/function setChatCollapsed\(collapsed\)/);
  assert.match(main,/chatCollapsed\?'EXPAND':'COLLAPSE'/);
  assert.match(main,/activeLogTab!=='chat'\|\|chatCollapsed/);
  assert.match(css,/\.combat-log-panel\.chat-collapsed/);
});

test('Stage25V Counterstance grants +5 Movement, free counters, and two-square pursuit',()=>{
  let state=createBattleState({matchId:'S25V-CS',units:[
    unit('Monk','H0',SIDE.A,{row:3,col:3}),
    unit('Barbarian','G0',SIDE.B,{row:3,col:6})
  ]});
  const cast=createRosterAbilityDeclaration({roundNumber:1,actorId:'H0',archetypeId:'Monk',abilityId:'COUNTERSTANCE',target:{type:TARGET_TYPE.SELF}});
  let sim=createRoundSimulation({state,declarations:[cast,hold('G0',1)],seed:2501});
  createRosterCombatScheduler(sim,{countersEnabled:true}).runUntilCombatSettled({maxCycles:5000});
  const monk=sim.state.units.H0;
  assert.equal(monk.resources.movementMax,20);
  assert.equal(findStatus(monk,'counterstance')?.data?.profile,'HYBRID');
  assert.equal(findStatus(monk,'counterstance')?.data?.attackCost,0);
  assert.equal(findStatus(monk,'counterstance')?.data?.pursuitMoveMax,2);
  assert.equal(findStatus(monk,'counterstance_movement_up')?.data?.amount,5);

  closeRound(sim);state=sim.state;
  const r=state.roundNumber;
  const attack=createRosterAbilityDeclaration({roundNumber:r,actorId:'G0',archetypeId:'Barbarian',abilityId:'BARBARIAN_ATTACK',target:{type:TARGET_TYPE.UNIT,unitId:'H0'}});
  sim=createRoundSimulation({state,declarations:[hold('H0',r),attack],seed:2502});
  createRosterCombatScheduler(sim,{countersEnabled:true}).runUntilCombatSettled({maxCycles:5000});
  const pursuit=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.COUNTER_MOVE&&e.actorId==='H0'&&e.payload?.movementReason==='COUNTERSTANCE_PURSUIT');
  const counters=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.COUNTER&&e.actorId==='H0');
  assert.ok(pursuit.length>=2,'Monk should pursue a range-3 Barbarian to answer with counters');
  assert.ok(counters.length>=1,'Monk should actually counter after pursuit');
  assert.equal(sim.state.units.H0.resources.attacksRemaining,7,'Counterstance counters remain free');
});

test('Stage25V Counterstance movement bonus expires with the stance',()=>{
  let state=createBattleState({matchId:'S25V-CS-EXP',units:[unit('Monk','H0',SIDE.A,{row:3,col:3}),unit('Warrior','G0',SIDE.B,{row:3,col:5})]});
  const cast=createRosterAbilityDeclaration({roundNumber:1,actorId:'H0',archetypeId:'Monk',abilityId:'COUNTERSTANCE',target:{type:TARGET_TYPE.SELF}});
  let sim=createRoundSimulation({state,declarations:[cast,hold('G0',1)],seed:2510});createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:1000});
  for(let n=0;n<3;n++){
    closeRound(sim);
    if(n<2){const r=sim.state.roundNumber;sim=createRoundSimulation({state:sim.state,declarations:[hold('H0',r),hold('G0',r)],seed:2511+n});createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:1000});}
  }
  assert.equal(sim.state.units.H0.resources.movementMax,15);
  assert.equal(findStatus(sim.state.units.H0,'counterstance'),null);
  assert.equal(findStatus(sim.state.units.H0,'counterstance_movement_up'),null);
});

test('Stage25V Second Wind ability details state its latest per-round Regen amount',()=>{
  const monk=unit('Monk','H0',SIDE.A,{row:2,col:2});
  const detail=abilityDetailModel(monk,getAbility('Monk','SECOND_WIND'));
  assert.ok(detail.lines.includes('Regen 360 HP/round (20% max HP) • 3 rounds'));
  assert.match(detail.note,/360 HP\/round/);
});
