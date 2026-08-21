import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { SIDE, TARGET_TYPE, EVENT_TYPE } from '../src/constants.js';
import { createRosterUnit, createRosterAbilityDeclaration } from '../src/roster.js';
import { createBattleState } from '../src/state.js';
import { createHoldDeclaration } from '../src/declarations.js';
import { createRoundSimulation } from '../src/simulation.js';
import { createRosterCombatScheduler } from '../src/roster-combat-scheduler.js';
import { buildPresentationTimeline, PRESENTATION_COMMAND } from '../src/presentation.js';

test('Stage 24D Mystic counter still establishes distance before the counter attack',()=>{
  const mystic=createRosterUnit({archetypeId:'Mystic',unitId:'H0',side:SIDE.A,draftSlot:0,position:{row:5,col:5}});
  const warrior=createRosterUnit({archetypeId:'Warrior',unitId:'G0',side:SIDE.B,draftSlot:0,position:{row:5,col:7}});
  const state=createBattleState({matchId:'STAGE24D-MYSTIC-COUNTER',board:{width:16,height:11},units:[mystic,warrior]});
  const declarations=[
    createHoldDeclaration({declarationId:'D1:H0',roundNumber:1,actorId:'H0'}),
    createRosterAbilityDeclaration({roundNumber:1,actorId:'G0',archetypeId:'Warrior',abilityId:'WARRIOR_ATTACK',target:{type:TARGET_TYPE.UNIT,unitId:'H0'}})
  ];
  const sim=createRoundSimulation({state,declarations,seed:12345});
  createRosterCombatScheduler(sim).advanceCycle();
  const events=sim.events.snapshot();
  const counter=events.find(e=>e.type===EVENT_TYPE.COUNTER&&e.actorId==='H0'&&e.targetId==='G0');
  assert.ok(counter,'Mystic should receive a native counter reaction.');
  const moves=events.filter(e=>e.type===EVENT_TYPE.COUNTER_MOVE&&e.actorId==='H0');
  assert.equal(moves.length,2,'Mystic counterMoveMax=2 should produce two retreat steps when both are legal.');
  assert.deepEqual(moves.map(e=>[e.payload.distanceBefore,e.payload.distanceAfter]),[[2,3],[3,4]]);
  assert.ok(moves.every(e=>e.payload.movementReason==='THROWING_DAGGER_COUNTER_KITE'));
  const counterAttack=events.find(e=>e.type===EVENT_TYPE.ATTACK_START&&e.actorId==='H0'&&e.payload?.attackReason==='COUNTER');
  assert.ok(counterAttack,'Mystic should throw only after counter movement has resolved.');
  assert.ok(moves.at(-1).sequence<counterAttack.sequence,'Authoritative counter movement must precede counter ATTACK_START.');

  const timeline=buildPresentationTimeline(events);
  const cueIndex=timeline.findIndex(c=>c.type===PRESENTATION_COMMAND.COUNTER_CUE&&c.actorId==='H0');
  const moveIndices=timeline.map((c,i)=>({c,i})).filter(x=>x.c.type===PRESENTATION_COMMAND.MOVE_UNIT&&x.c.actorId==='H0').map(x=>x.i);
  const attackIndex=timeline.findIndex(c=>c.type===PRESENTATION_COMMAND.ATTACK_CUE&&c.actorId==='H0'&&c.payload?.attackReason==='COUNTER');
  assert.equal(moveIndices.length,2);
  assert.ok(cueIndex>=0&&cueIndex<moveIndices[0]);
  assert.ok(moveIndices[0]<moveIndices[1]&&moveIndices[1]<attackIndex,'Replay should show cue → retreat → retreat → dagger throw.');
});

test('Stage 24D client does not animate the COUNTER marker as the attack itself',()=>{
  const scene=fs.readFileSync(path.resolve('client/ros2-scene.js'),'utf8');
  assert.match(scene,/\[PRESENTATION_COMMAND\.COUNTER_CUE\]:run\(c=>this\.animateCounterCue\(c\)\)/);
  assert.doesNotMatch(scene,/\[PRESENTATION_COMMAND\.COUNTER_CUE\]:run\(c=>this\.animateAttack\(c\)\)/);
  assert.match(scene,/COUNTER is an authoritative reaction marker, not the counter attack itself/);
});
