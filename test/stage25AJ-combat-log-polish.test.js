import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  ACTION_KIND, EVENT_TYPE, PRESENTATION_COMMAND, SIDE,
  buildPlayerCombatLogPlan, buildPresentationTimeline,
  createBattleState, createRosterUnit
} from '../src/index.js';

const ROOT=path.resolve(path.dirname(new URL(import.meta.url).pathname),'..');
const unit=(archetypeId,unitId,side,position)=>createRosterUnit({archetypeId,unitId,side,draftSlot:0,position});
const flatten=(plan,events)=>events.flatMap(e=>plan.get(e.eventId)??[]).map(x=>x.text);

test('Stage 25AJ hides declarations until resolution and condenses Rampage into one player-facing line',()=>{
  const s=createBattleState({matchId:'LOG-RAMPAGE',units:[unit('Barbarian','H0',SIDE.A,{row:3,col:3}),unit('Mage','G0',SIDE.B,{row:3,col:8})]});
  const events=[
    {eventId:'E1',sequence:0,parentEventId:null,initiativeCycle:0,type:EVENT_TYPE.ROUND_START,actorId:null,targetId:null,payload:{roundNumber:1}},
    {eventId:'E2',sequence:1,parentEventId:null,initiativeCycle:0,type:EVENT_TYPE.ACTION_START,actorId:'H0',targetId:'H0',payload:{actionId:'RAMPAGE',actionKind:ACTION_KIND.ABILITY}},
    {eventId:'E3',sequence:2,parentEventId:'E2',initiativeCycle:5,type:EVENT_TYPE.ACTION_COMPLETE,actorId:'H0',targetId:'H0',payload:{actionId:'RAMPAGE',actionKind:ACTION_KIND.ABILITY}},
    {eventId:'E4',sequence:3,parentEventId:'E3',initiativeCycle:5,type:EVENT_TYPE.STATUS_APPLY,actorId:'H0',targetId:'H0',payload:{abilityId:'RAMPAGE',key:'atk_up',duration:5}},
    {eventId:'E5',sequence:4,parentEventId:'E3',initiativeCycle:5,type:EVENT_TYPE.STATUS_APPLY,actorId:'H0',targetId:'H0',payload:{abilityId:'RAMPAGE',key:'atk_up',duration:5}},
    {eventId:'E6',sequence:5,parentEventId:'E3',initiativeCycle:5,type:EVENT_TYPE.STATUS_APPLY,actorId:'H0',targetId:'H0',payload:{abilityId:'RAMPAGE',key:'def_down',duration:4}},
    {eventId:'E7',sequence:6,parentEventId:'E3',initiativeCycle:5,type:EVENT_TYPE.STATUS_APPLY,actorId:'H0',targetId:'H0',payload:{abilityId:'RAMPAGE',key:'def_down',duration:4}}
  ];
  const lines=flatten(buildPlayerCombatLogPlan(events,s),events);
  assert.deepEqual(lines,['— ROUND 1 —','Barbarian uses Rampage. Barbarian becomes more aggressive and vulnerable to attacks.']);
});

test('Stage 25AJ associates Chain Lightning crits with only the exact individual bounce that critted',()=>{
  const s=createBattleState({matchId:'LOG-CHAIN',units:[
    unit('Electromancer','H0',SIDE.A,{row:3,col:3}),
    unit('Barbarian','G0',SIDE.B,{row:3,col:8}),
    unit('Paladin','G1',SIDE.B,{row:5,col:8}),
    unit('Mage','G2',SIDE.B,{row:7,col:8})
  ]});
  const events=[
    {eventId:'E1',sequence:0,parentEventId:null,initiativeCycle:0,type:EVENT_TYPE.ACTION_START,actorId:'H0',targetId:'G0',payload:{actionId:'CHAIN_LIGHTNING',actionKind:ACTION_KIND.SPELL}},
    {eventId:'E2',sequence:1,parentEventId:'E1',initiativeCycle:3,type:EVENT_TYPE.CAST_COMPLETE,actorId:'H0',targetId:'G0',payload:{abilityId:'CHAIN_LIGHTNING'}},
    {eventId:'E3',sequence:2,parentEventId:'E2',initiativeCycle:3,type:EVENT_TYPE.DAMAGE,actorId:'H0',targetId:'G0',payload:{abilityId:'CHAIN_LIGHTNING',amount:210,damageType:'MAGICAL'}},
    {eventId:'E4',sequence:3,parentEventId:'E2',initiativeCycle:3,type:EVENT_TYPE.CRIT,actorId:'H0',targetId:'G1',payload:{abilityId:'CHAIN_LIGHTNING',multiplier:2}},
    {eventId:'E5',sequence:4,parentEventId:'E2',initiativeCycle:3,type:EVENT_TYPE.DAMAGE,actorId:'H0',targetId:'G1',payload:{abilityId:'CHAIN_LIGHTNING',amount:480,damageType:'MAGICAL'}},
    {eventId:'E6',sequence:5,parentEventId:'E2',initiativeCycle:3,type:EVENT_TYPE.DAMAGE,actorId:'H0',targetId:'G2',payload:{abilityId:'CHAIN_LIGHTNING',amount:225,damageType:'MAGICAL'}},
    {eventId:'E7',sequence:6,parentEventId:'E2',initiativeCycle:3,type:EVENT_TYPE.CRIT,actorId:'H0',targetId:'G0',payload:{abilityId:'CHAIN_LIGHTNING',multiplier:2}},
    {eventId:'E8',sequence:7,parentEventId:'E2',initiativeCycle:3,type:EVENT_TYPE.DAMAGE,actorId:'H0',targetId:'G0',payload:{abilityId:'CHAIN_LIGHTNING',amount:510,damageType:'MAGICAL'}}
  ];
  const lines=flatten(buildPlayerCombatLogPlan(events,s),events);
  assert.deepEqual(lines,[
    'Electromancer casts Chain Lightning on Barbarian.',
    "Electromancer's Chain Lightning hits Barbarian for 210 magical damage.",
    "CRITICAL! Electromancer's Chain Lightning hits Paladin for 480 magical damage.",
    "Electromancer's Chain Lightning hits Mage for 225 magical damage.",
    "CRITICAL! Electromancer's Chain Lightning hits Barbarian for 510 magical damage."
  ]);
});

test('Stage 25AJ replay keeps CRIT available for detailed logging but uses only the matching yellow damage number visually',()=>{
  const events=[
    {eventId:'E1',sequence:0,parentEventId:null,initiativeCycle:3,type:EVENT_TYPE.CAST_COMPLETE,actorId:'H0',targetId:'G0',payload:{abilityId:'CHAIN_LIGHTNING'}},
    {eventId:'E2',sequence:1,parentEventId:'E1',initiativeCycle:3,type:EVENT_TYPE.DAMAGE,actorId:'H0',targetId:'G0',payload:{abilityId:'CHAIN_LIGHTNING',amount:200,damageType:'MAGICAL'}},
    {eventId:'E3',sequence:2,parentEventId:'E1',initiativeCycle:3,type:EVENT_TYPE.CRIT,actorId:'H0',targetId:'G1',payload:{abilityId:'CHAIN_LIGHTNING',multiplier:2}},
    {eventId:'E4',sequence:3,parentEventId:'E1',initiativeCycle:3,type:EVENT_TYPE.DAMAGE,actorId:'H0',targetId:'G1',payload:{abilityId:'CHAIN_LIGHTNING',amount:500,damageType:'MAGICAL'}}
  ];
  const timeline=buildPresentationTimeline(events);
  assert.equal(timeline.some(c=>c.type===PRESENTATION_COMMAND.CRIT_FEEDBACK),true,'CRIT event remains present for Detailed log replay');
  const damage=timeline.filter(c=>c.type===PRESENTATION_COMMAND.DAMAGE_FEEDBACK);
  assert.deepEqual(damage.map(c=>c.payload.critical===true),[false,true]);
  const scene=fs.readFileSync(path.join(ROOT,'client/ros2-scene.js'),'utf8');
  assert.match(scene,/critical\?'#ffe36d'/);
  assert.match(scene,/PRESENTATION_COMMAND\.CRIT_FEEDBACK\]:logOnly/);
});
