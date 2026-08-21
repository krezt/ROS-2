import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_KIND,
  ACTION_RUNTIME_STATE,
  CONTROL_TYPE,
  DAMAGE_TYPE,
  EVENT_TYPE,
  SIDE,
  TARGET_TYPE,
  applyControlEffect,
  applyDetection,
  applyPoison,
  applyRoot,
  applySpellbreak,
  applySuppression,
  applyTimedStatus,
  applyUnstoppable,
  applyWard,
  canAcquireDirectHostileTarget,
  createActionDeclaration,
  createBattleState,
  createCombatScheduler,
  createHoldDeclaration,
  createRoundSimulation,
  createSpellCombatScheduler,
  createUnitState,
  findStatus,
  snapshotRoundSimulation
} from '../src/index.js';

function unit({ unitId, side, position, qkn=10, hp=1000, movementMax=8, attacksMax=3, weaponRange=2, preferredRange=weaponRange, counterMoveMax=1, damage=10, mode='MELEE', statuses=[] }) {
  return createUnitState({
    unitId, side, draftSlot:0, archetypeId:unitId,
    stats:{maxHP:hp,hp,ATK:0,DEF:0,SDM:0,CRIT:0,QKN:qkn},
    position,
    combat:{movementMax,attacksMax,attackInterval:1},
    weapon:{weaponProfileId:`${unitId}-w`,mode,weaponRange,preferredRange,counterMoveMax,attackBaseMin:damage,attackBaseMax:damage,accuracy:1,critBonus:0,critMultiplier:1.75,defensePenetration:0,damageType:DAMAGE_TYPE.PHYSICAL,dodgeable:false},
    statuses
  });
}
function attack(a,t){return createActionDeclaration({declarationId:`D-${a}`,roundNumber:1,actorId:a,actionId:'ATTACK',actionKind:ACTION_KIND.BASIC_ATTACK,target:{type:TARGET_TYPE.UNIT,unitId:t}});}
function hold(a){return createHoldDeclaration({declarationId:`D-${a}-H`,roundNumber:1,actorId:a});}
function spell(a,t,{delay=2,amount=100}={}){return createActionDeclaration({declarationId:`D-${a}`,roundNumber:1,actorId:a,actionId:'TEST_SPELL',actionKind:ACTION_KIND.SPELL,target:{type:TARGET_TYPE.UNIT,unitId:t},payload:{targeting:{hostile:true},spell:{completionDelayCycles:delay,castRange:20,effect:{type:'DAMAGE',amount}}}});}
function state(units){return createBattleState({matchId:'stage22',roundNumber:1,board:{width:14,height:10},units});}
function sim(units,declarations,seed=1){return createRoundSimulation({state:state(units),declarations,seed});}
const events=(s,type)=>s.events.snapshot().filter(e=>e.type===type);

test('Root prevents pursuit and makes an out-of-range basic action impossible without spending Movement',()=>{
  const s=sim([
    unit({unitId:'H0',side:SIDE.A,position:{row:3,col:1},movementMax:8,weaponRange:1}),
    unit({unitId:'G0',side:SIDE.B,position:{row:3,col:6}})
  ],[attack('H0','G0'),hold('G0')]);
  applyRoot(s,'H0',{duration:2,sourceId:'G0'});
  const before=s.state.units.H0.resources.movementRemaining;
  createCombatScheduler(s).advanceCycle();
  assert.equal(s.state.units.H0.resources.movementRemaining,before);
  assert.deepEqual(s.state.units.H0.position,{row:3,col:1});
  assert.equal(s.runtimes['R1:H0'].state,ACTION_RUNTIME_STATE.IMPOSSIBLE);
});

test('Rooted defender can still counter when already in range but cannot counter-move',()=>{
  const s=sim([
    unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2},attacksMax:1}),
    unit({unitId:'G0',side:SIDE.B,position:{row:3,col:4},weaponRange:3,preferredRange:3,counterMoveMax:1,attacksMax:2})
  ],[attack('H0','G0'),hold('G0')]);
  applyRoot(s,'G0',{duration:2,sourceId:'H0'});
  createCombatScheduler(s).advanceCycle();
  assert.equal(events(s,EVENT_TYPE.COUNTER).length,1);
  assert.equal(events(s,EVENT_TYPE.COUNTER_MOVE).length,0);
  assert.equal(s.state.units.G0.resources.attacksRemaining,1);
});

test('Suppression blocks counters without interrupting the defender proactive runtime',()=>{
  const s=sim([
    unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2},qkn:20,attacksMax:1}),
    unit({unitId:'G0',side:SIDE.B,position:{row:3,col:4},qkn:10,attacksMax:2})
  ],[attack('H0','G0'),attack('G0','H0')]);
  applySuppression(s,'G0',{duration:2,sourceId:'H0'});
  createCombatScheduler(s).advanceCycle();
  assert.equal(events(s,EVENT_TYPE.COUNTER).filter(e=>e.actorId==='G0').length,0);
  assert.notEqual(s.runtimes['R1:G0'].state,ACTION_RUNTIME_STATE.INTERRUPTED);
  assert.ok(events(s,EVENT_TYPE.ATTACK_START).some(e=>e.actorId==='G0'));
});

test('Ward consumes itself to block the next hostile control/status, then a second application lands',()=>{
  const s=sim([
    unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2}}),
    unit({unitId:'G0',side:SIDE.B,position:{row:3,col:4}})
  ],[hold('H0'),hold('G0')]);
  applyWard(s,'H0',{duration:3});
  const first=applyRoot(s,'H0',{duration:2,sourceId:'G0'});
  assert.equal(first,null);
  assert.equal(findStatus(s.state.units.H0,'ward'),null);
  assert.equal(findStatus(s.state.units.H0,'root'),null);
  assert.equal(events(s,EVENT_TYPE.BLOCK).at(-1)?.payload?.reason,'WARD');
  const second=applyRoot(s,'H0',{duration:2,sourceId:'G0'});
  assert.ok(second);
  assert.ok(findStatus(s.state.units.H0,'root'));
});

test('Ward does not burn on a beneficial allied status',()=>{
  const s=sim([
    unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2}}),
    unit({unitId:'H1',side:SIDE.A,position:{row:4,col:2}}),
    unit({unitId:'G0',side:SIDE.B,position:{row:3,col:5}})
  ],[hold('H0'),hold('H1'),hold('G0')]);
  applyWard(s,'H0',{duration:3});
  const buff=applyTimedStatus(s,'H0',{key:'atk_up',duration:2,sourceId:'H1'});
  assert.ok(buff);
  assert.ok(findStatus(s.state.units.H0,'ward'));
  assert.ok(findStatus(s.state.units.H0,'atk_up'));
});

test('Ward also blocks a hostile Poison application',()=>{
  const s=sim([
    unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2}}),
    unit({unitId:'G0',side:SIDE.B,position:{row:3,col:5}})
  ],[hold('H0'),hold('G0')]);
  applyWard(s,'H0',{duration:3});
  assert.equal(applyPoison(s,'H0',100,{sourceId:'G0'}),null);
  assert.equal(findStatus(s.state.units.H0,'poison'),null);
  assert.equal(findStatus(s.state.units.H0,'ward'),null);
});

test('Unstoppable blocks hard CC before Ward, preserving Ward; default Unstoppable does not cover Silence',()=>{
  const s=sim([
    unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2}}),
    unit({unitId:'G0',side:SIDE.B,position:{row:3,col:5}})
  ],[hold('H0'),hold('G0')]);
  applyWard(s,'H0',{duration:3});
  applyUnstoppable(s,'H0',{duration:2});
  const stun=applyControlEffect(s,'H0',{type:CONTROL_TYPE.STUN,sourceId:'G0',duration:2});
  assert.equal(stun.applied,false);
  assert.equal(stun.reason,'UNSTOPPABLE');
  assert.ok(findStatus(s.state.units.H0,'ward'));
  assert.equal(findStatus(s.state.units.H0,'stun'),null);
  const silence=applyControlEffect(s,'H0',{type:CONTROL_TYPE.SILENCE,sourceId:'G0',duration:2});
  assert.equal(silence.applied,false);
  assert.equal(silence.reason,'WARD');
  assert.equal(findStatus(s.state.units.H0,'ward'),null);
  assert.equal(findStatus(s.state.units.H0,'silence'),null);
});

test('Spellbreak consumes itself on the next spell attempt and interrupts that spell before effect resolution',()=>{
  const s=sim([
    unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2},attacksMax:0}),
    unit({unitId:'G0',side:SIDE.B,position:{row:3,col:5},attacksMax:0})
  ],[spell('H0','G0',{delay:2,amount:200}),hold('G0')]);
  applySpellbreak(s,'H0',{duration:3,sourceId:'G0'});
  const before=s.state.units.G0.stats.hp;
  createSpellCombatScheduler(s).runUntilCombatSettled({maxCycles:20});
  assert.equal(s.state.units.G0.stats.hp,before);
  assert.equal(findStatus(s.state.units.H0,'spellbreak'),null);
  assert.equal(s.runtimes['R1:H0'].state,ACTION_RUNTIME_STATE.INTERRUPTED);
  assert.ok(events(s,EVENT_TYPE.CAST_START).some(e=>e.actorId==='H0'));
  assert.ok(events(s,EVENT_TYPE.CAST_INTERRUPT).some(e=>e.actorId==='H0'&&e.payload.reason==='SPELLBREAK'));
  assert.equal(events(s,EVENT_TYPE.CAST_COMPLETE).filter(e=>e.actorId==='H0').length,0);
});

test('Detection permits a new direct acquisition of an Invisible enemy without removing Invisibility',()=>{
  const units=[
    unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2},statuses:[{key:'detection',duration:2,sourceId:'H0',data:{}}]}),
    unit({unitId:'G0',side:SIDE.B,position:{row:3,col:5},statuses:[{key:'invisible',duration:2,sourceId:'G0',data:{}}]})
  ];
  const st=state(units);
  assert.equal(canAcquireDirectHostileTarget(st,'H0','G0'),true);
  const s=createRoundSimulation({state:st,declarations:[attack('H0','G0'),hold('G0')],seed:7});
  assert.ok(findStatus(s.state.units.G0,'invisible'));
});

test('without Detection the same new Invisible acquisition remains illegal',()=>{
  const st=state([
    unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2}}),
    unit({unitId:'G0',side:SIDE.B,position:{row:3,col:5},statuses:[{key:'invisible',duration:2,sourceId:'G0',data:{}}]})
  ]);
  assert.equal(canAcquireDirectHostileTarget(st,'H0','G0'),false);
});

test('Stage-22 counterplay replay remains deterministic',()=>{
  const make=()=>{
    const s=sim([
      unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2},qkn:16,attacksMax:3}),
      unit({unitId:'G0',side:SIDE.B,position:{row:3,col:4},qkn:17,attacksMax:3})
    ],[attack('H0','G0'),attack('G0','H0')],0x220022);
    applySuppression(s,'G0',{duration:2,sourceId:'H0'});
    applyRoot(s,'H0',{duration:2,sourceId:'G0'});
    return s;
  };
  const a=make(),b=make();
  createCombatScheduler(a).runUntilCombatSettled({maxCycles:50});
  createCombatScheduler(b).runUntilCombatSettled({maxCycles:50});
  assert.deepEqual(snapshotRoundSimulation(a),snapshotRoundSimulation(b));
});
