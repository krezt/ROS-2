import test from 'node:test';
import assert from 'node:assert/strict';
import { SIDE, TARGET_TYPE } from '../src/constants.js';
import { create3v3BattleState } from '../src/playtest-harness.js';
import { createRosterAbilityDeclaration } from '../src/roster.js';
import { PRESENTATION_COMMAND } from '../src/presentation.js';
import {
  ACTION_SELECTION_MS,
  ActionSelectionSession,
  areaPreviewForAbility,
  commandSpatialEndpoints,
  gridToWorld,
  unitHudModel,
  worldToGrid
} from '../src/client-foundation.js';
import { LocalSinglePlayerMatch, simulateRosterRoundPackage } from '../src/client-match.js';
import { RoundCoordinator } from '../src/round-coordinator.js';

function state(){return create3v3BattleState({teamA:['Warrior','Rogue','Mage'],teamB:['Barbarian','Electromancer','Cleric'],matchId:'STAGE23-TEST'});}

test('grid/world transforms round-trip authoritative board cells',()=>{
 const board=state().board;for(const cell of [{row:0,col:0},{row:3,col:5},{row:9,col:13}]){const p=gridToWorld(cell);assert.deepEqual(worldToGrid(p,board),cell);}
});

test('worldToGrid rejects points outside authoritative board',()=>{assert.equal(worldToGrid({x:-100,y:-100},state().board),null);});

test('Fireball preview exposes all twenty-five cells of a 5x5 footprint',()=>{
 const cells=areaPreviewForAbility(state().board,'Mage','FIREBALL',{row:5,col:6});assert.equal(cells.length,25);assert(cells.some(c=>c.row===4&&c.col===5));assert(cells.some(c=>c.row===7&&c.col===8));
});

test('Volley preview exposes all twenty-five cells of centered 5x5 footprint',()=>{assert.equal(areaPreviewForAbility(state().board,'Archer','VOLLEY',{row:5,col:6}).length,25);});

test('AoE previews clip cleanly at battlefield edges',()=>{assert.equal(areaPreviewForAbility(state().board,'Mage','FIREBALL',{row:0,col:0}).length,9);});

test('HUD projection exposes HP, Movement, attacks and statuses without mutating unit',()=>{
 const s=state();const u=s.units.H0;u.statuses.push({key:'ward',duration:2});const before=JSON.stringify(u);const h=unitHudModel(u);assert.equal(h.hp,u.stats.hp);assert.equal(h.attacksMax,u.resources.attacksMax);assert.equal(h.statuses[0].key,'ward');assert.equal(JSON.stringify(u),before);
});

test('action selection defaults to shared 120-second three-champion timer',()=>{let now=1000;const session=new ActionSelectionSession({state:state(),side:SIDE.A,now:()=>now});assert.equal(session.deadlineAt-session.startedAt,ACTION_SELECTION_MS);assert.deepEqual(session.actorIds,['H0','H1','H2']);});

test('setting a champion declaration replaces only that champion selection',()=>{
 const s=state();const session=new ActionSelectionSession({state:s,side:SIDE.A});const d1=createRosterAbilityDeclaration({roundNumber:1,actorId:'H0',archetypeId:'Warrior',abilityId:'WARRIOR_ATTACK',target:{type:TARGET_TYPE.UNIT,unitId:'G0'}});const d2=createRosterAbilityDeclaration({roundNumber:1,actorId:'H0',archetypeId:'Warrior',abilityId:'DIG_IN',target:{type:TARGET_TYPE.SELF}});session.setDeclaration(d1);session.setDeclaration(d2);assert.equal(session.get('H0').actionId,'DIG_IN');assert.deepEqual(session.missingActorIds(),['H1','H2']);
});

test('locking selection fills only missing champions with HOLD',()=>{
 const s=state();const session=new ActionSelectionSession({state:s,side:SIDE.A});session.setDeclaration(createRosterAbilityDeclaration({roundNumber:1,actorId:'H0',archetypeId:'Warrior',abilityId:'DIG_IN',target:{type:TARGET_TYPE.SELF}}));const locked=session.lock();assert.equal(locked.length,3);assert.equal(locked.find(d=>d.actorId==='H0').actionId,'DIG_IN');assert.equal(locked.find(d=>d.actorId==='H1').actionId,'HOLD');assert.equal(locked.find(d=>d.actorId==='H2').actionId,'HOLD');
});

test('timeout lock converts missing actions to HOLD deterministically',()=>{let now=0;const session=new ActionSelectionSession({state:state(),side:SIDE.A,durationMs:10,now:()=>now});now=11;const locked=session.lockOnTimeout();assert.deepEqual(locked.map(d=>d.actionId),['HOLD','HOLD','HOLD']);});

test('selection rejects enemy actor declarations',()=>{
 const s=state();const session=new ActionSelectionSession({state:s,side:SIDE.A});const d=createRosterAbilityDeclaration({roundNumber:1,actorId:'G0',archetypeId:'Barbarian',abilityId:'BARBARIAN_ATTACK',target:{type:TARGET_TYPE.UNIT,unitId:'H0'}});assert.throws(()=>session.setDeclaration(d),/not selectable/);
});

test('presentation spatial endpoint helper preserves board-space projectile coordinates',()=>{const e=commandSpatialEndpoints({type:PRESENTATION_COMMAND.SPELL_PROJECTILE,payload:{from:{row:3,col:1},to:{row:5,col:11}}});assert.deepEqual(e,{from:{row:3,col:1},to:{row:5,col:11}});});

test('current RoundCoordinator source works with deterministic browser-style byte seed factory',()=>{
 const c=new RoundCoordinator({matchId:'BROWSER-SEED',seedFactory:()=>0x01020304});
 // RoundCoordinator seedFactory returns integer; this test guards the isomorphic import path itself.
 assert.equal(c.matchId,'BROWSER-SEED');
});

test('single-player client match uses same coordinator/package/digest contract and confirms round',()=>{
 const s=state();const match=new LocalSinglePlayerMatch({state:s,seedFactory:()=>0x12345678,aiDecisionSeed:123});const session=new ActionSelectionSession({state:s,side:SIDE.A});const human=session.lock();const result=match.resolveRound(human);assert.equal(result.roundPackage.gameplaySeed,0x12345678);assert.equal(result.confirmation.kind,'round_confirmed');assert(result.events.length>0);assert(result.timeline.length>0);
});

test('roster package simulation is deterministic for identical state/package',()=>{
 const s=state();const authority=new LocalSinglePlayerMatch({state:s,seedFactory:()=>0x22222222,aiDecisionSeed:222});const human=new ActionSelectionSession({state:s,side:SIDE.A}).lock();const r=authority.resolveRound(human);const again=simulateRosterRoundPackage({baseState:s,roundPackage:r.roundPackage});assert.equal(again.digest.finalStateHash,r.digest.finalStateHash);assert.equal(again.digest.eventStreamHash,r.digest.eventStreamHash);assert.equal(again.digest.finalGameplayRngState,r.digest.finalGameplayRngState);
});
