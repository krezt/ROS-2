import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_KIND, DAMAGE_TYPE, EVENT_TYPE, SIDE, TARGET_TYPE,
  createActionDeclaration, createBattleState, createCombatScheduler, createHoldDeclaration,
  createRoundSimulation, createUnitState, snapshotRoundSimulation
} from '../src/index.js';

function unit({ unitId, side, position, qkn=10, hp=1000, movementMax=10, attacksMax=5, attackInterval=1, weaponRange=2, preferredRange=weaponRange, counterMoveMax=1, damage=10, mode='MELEE' }) {
  return createUnitState({ unitId, side, draftSlot:0, archetypeId:unitId,
    stats:{maxHP:hp,hp,ATK:100,DEF:0,SDM:100,CRIT:0,QKN:qkn}, position,
    combat:{movementMax,attacksMax,attackInterval},
    weapon:{weaponProfileId:`${unitId}-w`,mode,weaponRange,preferredRange,counterMoveMax,attackBaseMin:damage,attackBaseMax:damage,accuracy:1,critBonus:0,critMultiplier:1.75,defensePenetration:0,damageType:DAMAGE_TYPE.PHYSICAL,dodgeable:false}
  });
}
function attack(a,t){return createActionDeclaration({declarationId:`D-${a}`,roundNumber:1,actorId:a,actionId:'ATTACK',actionKind:ACTION_KIND.BASIC_ATTACK,target:{type:TARGET_TYPE.UNIT,unitId:t}})}
function hold(a){return createHoldDeclaration({declarationId:`D-${a}-H`,roundNumber:1,actorId:a})}
function sim(units,declarations,seed=1){return createRoundSimulation({state:createBattleState({matchId:'s7',roundNumber:1,board:{width:12,height:8},units}),declarations,seed})}
const ev=(s,t)=>s.events.snapshot().filter(e=>e.type===t);

test('in-range defender immediately counters and consumes one attack',()=>{
 const s=sim([unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2},attacksMax:1}),unit({unitId:'G0',side:SIDE.B,position:{row:3,col:4},attacksMax:2})],[attack('H0','G0'),hold('G0')]);
 createCombatScheduler(s).advanceCycle();
 assert.equal(ev(s,EVENT_TYPE.COUNTER).length,1); assert.equal(s.state.units.G0.resources.attacksRemaining,1); assert.equal(s.state.units.H0.stats.hp,990);
});

test('counter does not change ordinary attack cadence',()=>{
 const s=sim([unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2},qkn:20}),unit({unitId:'G0',side:SIDE.B,position:{row:3,col:4},attackInterval:4})],[attack('H0','G0'),attack('G0','H0')]);
 s.state.units.G0.resources.nextOrdinaryAttackCycle=3;
 createCombatScheduler(s).advanceCycle();
 assert.equal(s.state.units.G0.resources.nextOrdinaryAttackCycle,3);
});

test('Range-3 defender counter-maintains from distance 2 to 3 then counters',()=>{
 const s=sim([unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2},weaponRange:2}),unit({unitId:'G0',side:SIDE.B,position:{row:3,col:4},weaponRange:3,preferredRange:3,counterMoveMax:1})],[attack('H0','G0'),hold('G0')],7);
 createCombatScheduler(s).advanceCycle();
 assert.equal(ev(s,EVENT_TYPE.COUNTER_MOVE).length,1);
 const d=Math.abs(s.state.units.G0.position.row-s.state.units.H0.position.row)+Math.abs(s.state.units.G0.position.col-s.state.units.H0.position.col);
 assert.equal(d,3); assert.equal(ev(s,EVENT_TYPE.COUNTER).length,1);
});

test('Range-2 defender cannot counter Range-3 attack made from distance 3',()=>{
 const s=sim([unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2},weaponRange:3,preferredRange:3}),unit({unitId:'G0',side:SIDE.B,position:{row:3,col:5},weaponRange:2,counterMoveMax:1})],[attack('H0','G0'),hold('G0')]);
 createCombatScheduler(s).advanceCycle();
 assert.equal(ev(s,EVENT_TYPE.COUNTER).length,0); assert.equal(s.state.units.G0.resources.attacksRemaining,5);
});

test('zero movement still allows counter when aggressor already in range',()=>{
 const s=sim([unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2},attacksMax:1}),unit({unitId:'G0',side:SIDE.B,position:{row:3,col:4},movementMax:0,weaponRange:3,preferredRange:3})],[attack('H0','G0'),hold('G0')]);
 createCombatScheduler(s).advanceCycle(); assert.equal(ev(s,EVENT_TYPE.COUNTER).length,1); assert.equal(ev(s,EVENT_TYPE.COUNTER_MOVE).length,0);
});

test('counter cannot trigger a counter',()=>{
 const s=sim([unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2},attacksMax:1}),unit({unitId:'G0',side:SIDE.B,position:{row:3,col:4},attacksMax:4})],[attack('H0','G0'),hold('G0')]);
 createCombatScheduler(s).advanceCycle(); assert.equal(ev(s,EVENT_TYPE.COUNTER).length,1); assert.equal(ev(s,EVENT_TYPE.ATTACK_START).length,2);
});

test('HOLD champion can counter',()=>{
 const s=sim([unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2}}),unit({unitId:'G0',side:SIDE.B,position:{row:3,col:4}})],[attack('H0','G0'),hold('G0')]);
 createCombatScheduler(s).advanceCycle(); assert.equal(ev(s,EVENT_TYPE.COUNTER).at(0).actorId,'G0');
});

test('counter preserves defender proactive primary target',()=>{
 const s=sim([unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2}}),unit({unitId:'G0',side:SIDE.B,position:{row:3,col:4}}),unit({unitId:'G1',side:SIDE.B,position:{row:5,col:4}})],[attack('H0','G0'),attack('G0','H0'),hold('G1')]);
 const before=s.runtimes['R1:G0'].declaredPrimaryTargetId; createCombatScheduler(s).advanceCycle(); assert.equal(s.runtimes['R1:G0'].declaredPrimaryTargetId,before);
});

test('ranged counter can spend up to three movement squares toward preferred range',()=>{
 const s=sim([unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2}}),unit({unitId:'G0',side:SIDE.B,position:{row:3,col:4},weaponRange:6,preferredRange:6,counterMoveMax:3,mode:'RANGED',movementMax:5})],[attack('H0','G0'),hold('G0')],123);
 createCombatScheduler(s).advanceCycle(); assert.equal(ev(s,EVENT_TYPE.COUNTER_MOVE).length,3); assert.equal(s.state.units.G0.resources.movementRemaining,2);
});

test('multiple aggressors drain separate defender attacks through counters',()=>{
 const s=sim([unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2},qkn:20}),unit({unitId:'H1',side:SIDE.A,position:{row:4,col:3},qkn:19}),unit({unitId:'G0',side:SIDE.B,position:{row:3,col:4},attacksMax:2,movementMax:0})],[attack('H0','G0'),attack('H1','G0'),hold('G0')]);
 createCombatScheduler(s).advanceCycle(); assert.equal(ev(s,EVENT_TYPE.COUNTER).length,2); assert.equal(s.state.units.G0.resources.attacksRemaining,0);
});

test('defender with no attacks cannot counter',()=>{
 const s=sim([unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2}}),unit({unitId:'G0',side:SIDE.B,position:{row:3,col:4},attacksMax:0})],[attack('H0','G0'),hold('G0')]);
 createCombatScheduler(s).advanceCycle(); assert.equal(ev(s,EVENT_TYPE.COUNTER).length,0);
});

test('lethal incoming attack prevents counter',()=>{
 const s=sim([unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2},damage:100}),unit({unitId:'G0',side:SIDE.B,position:{row:3,col:4},hp:50})],[attack('H0','G0'),hold('G0')]);
 createCombatScheduler(s).advanceCycle(); assert.equal(ev(s,EVENT_TYPE.COUNTER).length,0);
});


test('attack dump drains counter reactions between dumped swings',()=>{
 const s=sim([unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2},attacksMax:3}),unit({unitId:'G0',side:SIDE.B,position:{row:3,col:4},attacksMax:2,movementMax:0})],[attack('H0','G0'),hold('G0')]);
 createCombatScheduler(s).advanceCycle();
 assert.equal(ev(s,EVENT_TYPE.COUNTER).length,2);
 assert.equal(s.state.units.G0.resources.attacksRemaining,0);
 assert.equal(ev(s,EVENT_TYPE.ATTACK_START).filter(e=>e.actorId==='H0').length,3);
});

test('Stage-7 deterministic counter replay produces identical state/events/RNG',()=>{
 const make=()=>sim([unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2},qkn:16,attacksMax:3}),unit({unitId:'G0',side:SIDE.B,position:{row:3,col:4},qkn:17,weaponRange:3,preferredRange:3,attacksMax:3})],[attack('H0','G0'),attack('G0','H0')],0xabc123);
 const a=make(),b=make(); createCombatScheduler(a).runUntilCombatSettled({maxCycles:50}); createCombatScheduler(b).runUntilCombatSettled({maxCycles:50}); assert.deepEqual(snapshotRoundSimulation(a),snapshotRoundSimulation(b));
});
