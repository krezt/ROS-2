import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

import {
  SIDE,
  LIFE_STATE,
  createTeamBattleState,
  createSnakeDraftOrder,
  standardStartingPosition,
  ActionSelectionSession,
  validatePlaytestTeams,
  createHoldDeclaration,
  createRoundSimulation,
  resolveBasicAttack,
  ROSTER_IDS,
  LocalSinglePlayerMatch
} from '../src/index.js';

const expectedFormations={
  1:{A:[{row:5,col:2}],B:[{row:5,col:13}]},
  2:{A:[{row:4,col:2},{row:6,col:1}],B:[{row:6,col:13},{row:4,col:14}]},
  3:{A:[{row:3,col:2},{row:5,col:1},{row:7,col:2}],B:[{row:3,col:13},{row:5,col:14},{row:7,col:13}]},
  4:{A:[{row:3,col:2},{row:5,col:1},{row:7,col:2},{row:1,col:3}],B:[{row:3,col:13},{row:5,col:14},{row:7,col:13},{row:9,col:12}]},
  5:{A:[{row:3,col:2},{row:5,col:1},{row:7,col:2},{row:1,col:3},{row:9,col:3}],B:[{row:3,col:13},{row:5,col:14},{row:7,col:13},{row:9,col:12},{row:1,col:12}]}
};

const expectedDraftOrders={
  1:['A','B'],
  2:['A','B','B','A'],
  3:['A','B','B','A','A','B'],
  4:['A','B','B','A','A','B','B','A'],
  5:['A','B','B','A','A','B','B','A','A','B']
};

function teams(n){return {teamA:ROSTER_IDS.slice(0,n),teamB:ROSTER_IDS.slice(n,n*2)};}

test('Stage25A default-board spawns exactly match approved 1v1 through 5v5 coordinates',()=>{
  for(const n of [1,2,3,4,5]){
    for(const side of [SIDE.A,SIDE.B]){
      const expected=expectedFormations[n][side];
      for(let slot=0;slot<n;slot++)assert.deepEqual(standardStartingPosition({side,draftSlot:slot,teamSize:n}),expected[slot],`${n}v${n} ${side}${slot}`);
    }
  }
});

test('Stage25A creates 1v1 through 5v5 battle states with dynamic unit counts and deterministic draft slots',()=>{
  for(const n of [1,2,3,4,5]){
    const {teamA,teamB}=teams(n);
    const state=createTeamBattleState({teamA,teamB,matchId:`TEAM-${n}`});
    assert.equal(Object.keys(state.units).length,n*2);
    assert.equal(Object.keys(state.board.occupancy).length,n*2);
    for(let i=0;i<n;i++){
      assert.deepEqual(state.units[`H${i}`].position,expectedFormations[n].A[i]);
      assert.deepEqual(state.units[`G${i}`].position,expectedFormations[n].B[i]);
      assert.equal(state.units[`H${i}`].draftSlot,i);
      assert.equal(state.units[`G${i}`].draftSlot,i);
    }
  }
});

test('Stage25A snake draft order scales from 1v1 through 5v5',()=>{
  for(const n of [1,2,3,4,5])assert.deepEqual([...createSnakeDraftOrder(n)],expectedDraftOrders[n]);
});

test('Stage25A roster validation accepts equal unique teams from one through five and rejects unequal sizes',()=>{
  for(const n of [1,2,3,4,5]){
    const {teamA,teamB}=teams(n);
    const result=validatePlaytestTeams(teamA,teamB,ROSTER_IDS,{teamSize:n});
    assert.equal(result.ok,true,result.error);
    assert.equal(result.teamSize,n);
  }
  assert.equal(validatePlaytestTeams(ROSTER_IDS.slice(0,2),ROSTER_IDS.slice(2,5),ROSTER_IDS).ok,false);
});

test('Stage25A action selection requires exactly one action per living champion, regardless of original team size',()=>{
  for(const n of [1,2,3,4,5]){
    const {teamA,teamB}=teams(n);
    const state=createTeamBattleState({teamA,teamB,matchId:`ACTIONS-${n}`});
    const session=new ActionSelectionSession({state,side:SIDE.A,now:()=>0});
    assert.equal(session.actorIds.length,n);
    state.units.H0.lifeState=LIFE_STATE.DEAD;state.units.H0.stats.hp=0;
    const afterKo=new ActionSelectionSession({state,side:SIDE.A,now:()=>0});
    assert.equal(afterKo.actorIds.length,Math.max(0,n-1));
  }
});



test('Stage25A local 1P authority can resolve a complete round at every supported team size',()=>{
  for(const n of [1,2,3,4,5]){
    const {teamA,teamB}=teams(n);
    const state=createTeamBattleState({teamA,teamB,matchId:`LOCAL-ROUND-${n}`});
    const match=new LocalSinglePlayerMatch({state});
    const declarations=Object.values(state.units)
      .filter(u=>u.side===SIDE.A&&u.lifeState===LIFE_STATE.ALIVE)
      .sort((a,b)=>a.draftSlot-b.draftSlot)
      .map(u=>createHoldDeclaration({declarationId:`R1:${u.unitId}`,roundNumber:1,actorId:u.unitId}));
    const result=match.resolveRound(declarations);
    assert.equal(result.roundPackage.declarationsA.length,n);
    assert.equal(result.roundPackage.declarationsB.length,n);
    assert.equal(result.confirmation.kind,'round_confirmed');
  }
});

test('Stage25A victory completes only when the final opposing champion is KO in a 5v5 state',()=>{
  const {teamA,teamB}=teams(5);
  const state=createTeamBattleState({teamA,teamB,matchId:'VICTORY-5'});
  for(let i=0;i<4;i++){state.units[`G${i}`].lifeState=LIFE_STATE.DEAD;state.units[`G${i}`].stats.hp=0;}
  state.units.G4.stats.hp=1;
  state.units.H0.weapon.attackBaseMin=9999;state.units.H0.weapon.attackBaseMax=9999;state.units.H0.weapon.accuracy=1;state.units.H0.weapon.dodgeable=false;state.units.H0.weapon.weaponRange=99;
  const living=Object.values(state.units).filter(u=>u.lifeState===LIFE_STATE.ALIVE);
  const declarations=living.map(u=>createHoldDeclaration({declarationId:`D1:${u.unitId}`,roundNumber:1,actorId:u.unitId}));
  const sim=createRoundSimulation({state,declarations,seed:1234});
  resolveBasicAttack(sim,'H0','G4',{ignoreAttackInterval:true,attackCost:0});
  assert.equal(sim.state.units.G4.lifeState,LIFE_STATE.DEAD);
  assert.equal(sim.state.outcome.status,'COMPLETE');
  assert.equal(sim.state.outcome.winner,SIDE.A);
});

test('Stage25A client exposes quick sandbox/roster plus 1P vs AI and 2P Battle, with dynamic action counter',()=>{
  const html=readFileSync(new URL('../client/index.html',import.meta.url),'utf8');
  const scene=readFileSync(new URL('../client/ros2-scene.js',import.meta.url),'utf8');
  for(const label of ['1P SANDBOX','1P ROSTER','1P vs AI','2P BATTLE','1v1','2v2','3v3','4v4','5v5'])assert.match(html,new RegExp(label.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));
  assert.match(html,/assignedCount[^>]*>0 \/ 0</);
  for(let i=0;i<5;i++){assert.match(html,new RegExp(`id=\"teamA${i}\"`));assert.match(html,new RegExp(`id=\"teamB${i}\"`));}
  for(const n of [1,2,3,4,5])assert.match(html,new RegExp(`data-roster-team-size=\"${n}\"`));
  assert.doesNotMatch(scene,/Choose three actions|choose your three actions/i);
});
