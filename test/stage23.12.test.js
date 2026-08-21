import test from 'node:test';
import assert from 'node:assert/strict';
import { SIDE, EVENT_TYPE } from '../src/constants.js';
import { create3v3BattleState } from '../src/playtest-harness.js';
import { standardStartingPosition } from '../src/grid.js';
import { createHoldDeclaration } from '../src/declarations.js';
import { createRoundSimulation } from '../src/simulation.js';
import { applyPoison, closeRound } from '../src/status-engine.js';
import { describeAuthoritativeEvent, ActionSelectionSession } from '../src/client-foundation.js';
import { summonFaery, resolveAutonomousSummons } from '../src/summons.js';
import { GameplayRng } from '../src/rng.js';
import { planAiDeclarations, AI_DIFFICULTY } from '../src/ai-planner.js';
import { getAbility } from '../src/roster.js';

function state(){return create3v3BattleState({teamA:['Warrior','Rogue','Mage'],teamB:['Barbarian','Electromancer','Cleric'],matchId:'stage23.12'});}
function holds(s){return Object.values(s.units).filter(u=>u.entityKind!=='SUMMON'&&u.lifeState==='ALIVE').map(u=>createHoldDeclaration({declarationId:`D${s.roundNumber}:${u.unitId}`,roundNumber:s.roundNumber,actorId:u.unitId}));}
function sim(){const s=state();return createRoundSimulation({state:s,declarations:holds(s),seed:0x2312});}

test('Stage 23.12 opening formation is C4/B6/C8 vs N4/O6/N8',()=>{
  assert.deepEqual(standardStartingPosition({side:SIDE.A,draftSlot:0}),{row:3,col:2});
  assert.deepEqual(standardStartingPosition({side:SIDE.A,draftSlot:1}),{row:5,col:1});
  assert.deepEqual(standardStartingPosition({side:SIDE.A,draftSlot:2}),{row:7,col:2});
  assert.deepEqual(standardStartingPosition({side:SIDE.B,draftSlot:0}),{row:3,col:13});
  assert.deepEqual(standardStartingPosition({side:SIDE.B,draftSlot:1}),{row:5,col:14});
  assert.deepEqual(standardStartingPosition({side:SIDE.B,draftSlot:2}),{row:7,col:13});
});

test('Poison application event exposes both contribution and total stack',()=>{
  const s=sim();
  applyPoison(s,'G1',12,{sourceId:'H1',cycle:2});
  applyPoison(s,'G1',17,{sourceId:'H1',cycle:3});
  const ev=s.events.snapshot().filter(e=>e.type===EVENT_TYPE.STATUS_APPLY&&e.payload.key==='poison').at(-1);
  assert.equal(ev.payload.contribution.amount,17);
  assert.equal(ev.payload.total,29);
  assert.match(describeAuthoritativeEvent(ev,s.state),/\+17 Poison/);
  assert.match(describeAuthoritativeEvent(ev,s.state),/29 total/);
});

test('cleanse status removal log says cleanses instead of looking like expiry',()=>{
  const s=state();
  const ev={type:EVENT_TYPE.STATUS_REMOVE,initiativeCycle:3,actorId:'G1',targetId:'G1',payload:{key:'marked',reason:'CLEANSE'}};
  assert.equal(describeAuthoritativeEvent(ev,s),'[C03] Electromancer (G1) cleanses MARKED from Electromancer (G1).');
});

test('damage log names the ability when authoritative damage carries abilityId',()=>{
  const s=state();
  const ev={type:EVENT_TYPE.DAMAGE,initiativeCycle:5,actorId:'H2',targetId:'G2',payload:{abilityId:'FIREBALL',amount:128,damageType:'MAGICAL',hpAfter:700,mitigated:20}};
  assert.match(describeAuthoritativeEvent(ev,s),/Mage \(H2\) hits Cleric \(G2\) with Fireball for 128 magical damage/);
});

test('Faery prototype occupies a real adjacent square and has 100 HP',()=>{
  const s=sim();const owner=s.state.units.H2;
  const f=summonFaery(s,{ownerId:'H2',targetId:'G0',cycle:1});
  assert.equal(f.entityKind,'SUMMON');assert.equal(f.stats.hp,100);assert.equal(f.ownerId,'H2');
  assert.equal(s.state.board.occupancy[`${f.position.row},${f.position.col}`],f.unitId);
  assert.equal(Math.abs(f.position.row-owner.position.row)+Math.abs(f.position.col-owner.position.col),1);
});

test('Faery begins one weak autonomous magical shot per round starting next round',()=>{
  const s=sim();const f=summonFaery(s,{ownerId:'H2',targetId:'G0',cycle:1});
  assert.deepEqual(resolveAutonomousSummons(s,{cycle:9}),[],'new summon should not fire immediately');
  s.state.roundNumber=2;
  const before=s.state.units.G0.stats.hp;const shots=resolveAutonomousSummons(s,{cycle:9});
  assert.equal(shots.length,1);assert.equal(shots[0].summonId,f.unitId);assert.ok(s.state.units.G0.stats.hp<before);
  assert.deepEqual(resolveAutonomousSummons(s,{cycle:10}),[],'same Faery cannot fire twice in one round');
});

test('summons never become player action rows or required declarations',()=>{
  const s=sim();summonFaery(s,{ownerId:'H2',targetId:'G0',cycle:1});
  const session=new ActionSelectionSession({state:s.state,side:SIDE.A});
  assert.deepEqual(session.actorIds,['H0','H1','H2']);
  // New round bootstrap still requires only the three living champions per side.
  s.state.roundNumber=2;
  const decls=Object.values(s.state.units).filter(u=>u.entityKind!=='SUMMON'&&u.lifeState==='ALIVE').map(u=>createHoldDeclaration({declarationId:`D2:${u.unitId}`,roundNumber:2,actorId:u.unitId}));
  assert.doesNotThrow(()=>createRoundSimulation({state:s.state,declarations:decls,seed:4}));
});

test('Normal Cleric AI avoids Guardian Angel on healthy already-safe allies',()=>{
  const s=state();
  const plan=planAiDeclarations({state:s,side:SIDE.B,difficulty:AI_DIFFICULTY.NORMAL,decisionRng:new GameplayRng(0xCAFE)});
  const cleric=plan.find(d=>d.actorId==='G2');
  assert.ok(cleric);assert.notEqual(cleric.actionId,'GUARDIAN_ANGEL');
});


test('round close automatically resolves eligible Faery bolts',()=>{
  const s=sim();summonFaery(s,{ownerId:'H2',targetId:'G0',cycle:1});
  s.state.roundNumber=2;const before=s.state.units.G0.stats.hp;
  const closed=closeRound(s,{advanceRound:false});
  assert.equal(closed.summons.length,1);assert.ok(s.state.units.G0.stats.hp<before);
});

test('Summon Faery is preserved as a hidden Cleric prototype rather than a live seventh button',()=>{
  const a=getAbility('Cleric','SUMMON_FAERY');
  assert.equal(a.playable,false);assert.equal(a.experimental,true);assert.equal(a.effects[0].type,'SUMMON_FAERY');
});
