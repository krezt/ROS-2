import test from 'node:test';
import assert from 'node:assert/strict';
import { EVENT_TYPE } from '../src/constants.js';
import { create3v3BattleState } from '../src/playtest-harness.js';
import { combatLogClassForEvent, describeAuthoritativeEvent } from '../src/client-foundation.js';

function state(){return create3v3BattleState({teamA:['Warrior','Rogue','Mage'],teamB:['Barbarian','Electromancer','Cleric'],matchId:'STAGE23.2-TEST'});}
function event(type,{actorId='H0',targetId='G0',initiativeCycle=3,payload={}}={}){return {eventId:'E1',sequence:0,parentEventId:null,initiativeCycle,type,actorId,targetId,payload};}

test('combat log names roster abilities and champions from authoritative ACTION_START',()=>{
  const text=describeAuthoritativeEvent(event(EVENT_TYPE.ACTION_START,{payload:{actionId:'POWER_STRIKE',actionKind:'BASIC_ATTACK'}}),state());
  assert.match(text,/Warrior \(H0\) uses Power Strikes/);
  assert.match(text,/Barbarian \(G0\)/);
});

test('combat log exposes damage amount and remaining HP',()=>{
  const text=describeAuthoritativeEvent(event(EVENT_TYPE.DAMAGE,{payload:{amount:87,hpAfter:513,damageType:'PHYSICAL'}}),state());
  assert.match(text,/87 physical damage/);
  assert.match(text,/513 HP/);
  assert.equal(combatLogClassForEvent(event(EVENT_TYPE.DAMAGE)),'combat physical');
});

test('combat log makes status application visible',()=>{
  const text=describeAuthoritativeEvent(event(EVENT_TYPE.STATUS_APPLY,{payload:{key:'stun',duration:2}}),state());
  assert.match(text,/STUN/);assert.match(text,/2 rounds/);
  assert.equal(combatLogClassForEvent(event(EVENT_TYPE.STATUS_APPLY,{payload:{key:'stun',duration:2}})),'status control');
});

test('combat log makes resurrection explicit',()=>{
  const text=describeAuthoritativeEvent(event(EVENT_TYPE.RESURRECT,{actorId:'G2',targetId:'G0',payload:{hp:526}}),state());
  assert.match(text,/Cleric \(G2\) RESURRECTS Barbarian \(G0\)/);
  assert.match(text,/526 HP/);
  assert.equal(combatLogClassForEvent(event(EVENT_TYPE.RESURRECT)),'heal');
});

test('low-value movement noise is omitted from prose log',()=>{
  assert.equal(describeAuthoritativeEvent(event(EVENT_TYPE.MOVE,{payload:{from:{row:1,col:1},to:{row:1,col:2}}}),state()),null);
});
