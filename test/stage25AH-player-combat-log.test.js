import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { EVENT_TYPE, SIDE, buildPlayerCombatLogPlan, createBattleState, createRosterUnit } from '../src/index.js';

const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
function unit(archetypeId,unitId,side,position){return createRosterUnit({archetypeId,unitId,side,draftSlot:0,position});}
function state(){return createBattleState({matchId:'LOG',units:[unit('Mystic','H0',SIDE.A,{row:3,col:3}),unit('Mage','G0',SIDE.B,{row:3,col:8})]});}
function flatten(plan,events){return events.flatMap(e=>plan.get(e.eventId)??[]).map(x=>x.text);}

test('Stage 25AH player log turns cast bookkeeping into concise action + outcome language',()=>{
  const s=state();
  const events=[
    {eventId:'E1',sequence:0,parentEventId:null,initiativeCycle:0,type:EVENT_TYPE.ROUND_START,actorId:null,targetId:null,payload:{roundNumber:1}},
    {eventId:'E2',sequence:1,parentEventId:null,initiativeCycle:0,type:EVENT_TYPE.ACTION_START,actorId:'H0',targetId:'G0',payload:{actionId:'MYSTIC_STUN',actionKind:'SPELL'}},
    {eventId:'E3',sequence:2,parentEventId:'E2',initiativeCycle:0,type:EVENT_TYPE.CAST_START,actorId:'H0',targetId:'G0',payload:{abilityId:'MYSTIC_STUN'}},
    {eventId:'E4',sequence:3,parentEventId:'E3',initiativeCycle:1,type:EVENT_TYPE.CAST_COMPLETE,actorId:'H0',targetId:'G0',payload:{abilityId:'MYSTIC_STUN'}},
    {eventId:'E5',sequence:4,parentEventId:'E4',initiativeCycle:1,type:EVENT_TYPE.BLOCK,actorId:'G0',targetId:'G0',payload:{reason:'STATUS_RESIST',blockedStatusKey:'stun',hostileSourceId:'H0'}},
    {eventId:'E6',sequence:5,parentEventId:null,initiativeCycle:2,type:EVENT_TYPE.ROUND_END,actorId:null,targetId:null,payload:{roundNumber:1}}
  ];
  const lines=flatten(buildPlayerCombatLogPlan(events,s),events);
  assert.deepEqual(lines,['— ROUND 1 —','Mystic casts Stun on Mage — Mage resists!']);
  assert.equal(lines.some(x=>/\[C\d+\]|\(H0\)|\(G0\)|completes|ROUND CONFIRMED/i.test(x)),false);
});

test('Stage 25AI player log preserves every hit, dodge and crit as its own ordered line',()=>{
  const s=state();
  const events=[
    {eventId:'E1',sequence:0,parentEventId:null,initiativeCycle:0,type:EVENT_TYPE.ACTION_START,actorId:'H0',targetId:'G0',payload:{actionId:'MYSTIC_ATTACK',actionKind:'BASIC_ATTACK'}},
    {eventId:'E2',sequence:1,parentEventId:'E1',initiativeCycle:0,type:EVENT_TYPE.ATTACK_START,actorId:'H0',targetId:'G0',payload:{abilityId:'MYSTIC_ATTACK'}},
    {eventId:'E3',sequence:2,parentEventId:'E2',initiativeCycle:0,type:EVENT_TYPE.ATTACK_IMPACT,actorId:'H0',targetId:'G0',payload:{abilityId:'MYSTIC_ATTACK'}},
    {eventId:'E4',sequence:3,parentEventId:'E3',initiativeCycle:0,type:EVENT_TYPE.CRIT,actorId:'H0',targetId:'G0',payload:{abilityId:'MYSTIC_ATTACK',multiplier:2}},
    {eventId:'E5',sequence:4,parentEventId:'E3',initiativeCycle:0,type:EVENT_TYPE.DAMAGE,actorId:'H0',targetId:'G0',payload:{abilityId:'MYSTIC_ATTACK',amount:80,damageType:'PHYSICAL',hpAfter:1620}},
    {eventId:'E6',sequence:5,parentEventId:'E1',initiativeCycle:1,type:EVENT_TYPE.ATTACK_START,actorId:'H0',targetId:'G0',payload:{abilityId:'MYSTIC_ATTACK'}},
    {eventId:'E7',sequence:6,parentEventId:'E6',initiativeCycle:1,type:EVENT_TYPE.DODGE,actorId:'H0',targetId:'G0',payload:{abilityId:'MYSTIC_ATTACK'}},
    {eventId:'E8',sequence:7,parentEventId:'E1',initiativeCycle:2,type:EVENT_TYPE.ATTACK_START,actorId:'H0',targetId:'G0',payload:{abilityId:'MYSTIC_ATTACK'}},
    {eventId:'E9',sequence:8,parentEventId:'E8',initiativeCycle:2,type:EVENT_TYPE.ATTACK_IMPACT,actorId:'H0',targetId:'G0',payload:{abilityId:'MYSTIC_ATTACK'}},
    {eventId:'E10',sequence:9,parentEventId:'E9',initiativeCycle:2,type:EVENT_TYPE.DAMAGE,actorId:'H0',targetId:'G0',payload:{abilityId:'MYSTIC_ATTACK',amount:42,damageType:'PHYSICAL',hpAfter:1578}}
  ];
  const lines=flatten(buildPlayerCombatLogPlan(events,s),events);
  assert.deepEqual(lines,[
    'CRITICAL! Mystic attacks Mage for 80 physical damage.',
    "Mage dodges Mystic's attack.",
    'Mystic attacks Mage for 42 physical damage.'
  ]);
});

test('Stage 25AH combat log UI defaults to concise and exposes an optional Detailed checkbox',()=>{
  const html=fs.readFileSync(path.join(ROOT,'client/index.html'),'utf8');
  const main=fs.readFileSync(path.join(ROOT,'client/main.js'),'utf8');
  const scene=fs.readFileSync(path.join(ROOT,'client/ros2-scene.js'),'utf8');
  assert.match(html,/id="combatLogDetailedToggle"[^>]*type="checkbox"/);
  assert.match(main,/combatLogDetailedToggle[\s\S]*setCombatLogDetailed/);
  assert.match(main,/\[NET\][\s\S]*visibility:'detailed'/);
  assert.match(scene,/buildPlayerCombatLogPlan/);
  assert.match(scene,/visibility:'concise'/);
  assert.match(scene,/describeAuthoritativeEvent[\s\S]*visibility:'detailed'/);
});
