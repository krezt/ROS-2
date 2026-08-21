import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_KIND,
  AI_DIFFICULTY,
  EVENT_TYPE,
  SIDE,
  TARGET_TYPE,
  GameplayRng,
  SinglePlayerOpponent,
  SinglePlayerRoundAuthority,
  applyTimedStatus,
  basicAggroPlanner,
  create3v3BattleState,
  createAiPlannerAdapter,
  createRosterAbilityDeclaration,
  createRosterCombatScheduler,
  createRoundSimulation,
  enumerateAiCandidates,
  markUnitDead,
  planAiDeclarations,
  run3v3Playtest
} from '../src/index.js';

function action(state, actorId, abilityId, target){
  const actor=state.units[actorId];
  return createRosterAbilityDeclaration({roundNumber:state.roundNumber,actorId,archetypeId:actor.archetypeId,abilityId,target});
}

function standardState(){
  return create3v3BattleState({teamA:['Warrior','Cleric','Archer'],teamB:['Barbarian','Monk','Mage'],matchId:'S21'});
}

test('same-boundary hard control can mutate a later spell runtime without spell resolver crashing',()=>{
  let observed=false;
  for(let seed=1;seed<=200&&!observed;seed++){
    const state=create3v3BattleState({teamA:['Warrior','Cleric','Archer'],teamB:['Mage','Monk','Barbarian'],matchId:`MUT${seed}`});
    const declarations=[
      action(state,'H0','INSULT',{type:TARGET_TYPE.UNIT,unitId:'G0'}),
      action(state,'H1','CLERIC_ATTACK',{type:TARGET_TYPE.UNIT,unitId:'G1'}),
      action(state,'H2','ARCHER_ATTACK',{type:TARGET_TYPE.UNIT,unitId:'G2'}),
      action(state,'G0','ARCANE_ECHO',{type:TARGET_TYPE.SELF}),
      action(state,'G1','MONK_ATTACK',{type:TARGET_TYPE.UNIT,unitId:'H1'}),
      action(state,'G2','BARBARIAN_ATTACK',{type:TARGET_TYPE.UNIT,unitId:'H2'})
    ];
    const sim=createRoundSimulation({state,declarations,seed});
    assert.doesNotThrow(()=>createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:5000}));
    if(sim.events.snapshot().some(e=>e.type===EVENT_TYPE.TAUNT&&e.targetId==='G0')){
      observed=true;
      assert.notEqual(sim.runtimes['R1:G0'].actionKind,ACTION_KIND.SPELL);
      assert.ok(sim.trace.snapshot().some(t=>t.kind==='SPELL_COMPLETION_SKIPPED_AFTER_RUNTIME_MUTATION'));
    }
  }
  assert.equal(observed,true,'Expected at least one deterministic seed to produce the same-boundary Taunt case.');
});

test('AI candidate generation produces only declarations for the requested living actor',()=>{
  const state=standardState();
  const c=enumerateAiCandidates({state,actorId:'G0'});
  assert.ok(c.length>0);
  assert.ok(c.every(x=>x.declaration.actorId==='G0'&&x.declaration.roundNumber===state.roundNumber));
});

test('Beginner AI is deterministic for the same decision seed',()=>{
  const state=standardState();
  const a=planAiDeclarations({state,side:SIDE.B,difficulty:AI_DIFFICULTY.BEGINNER,decisionRng:new GameplayRng(12345)});
  const b=planAiDeclarations({state,side:SIDE.B,difficulty:AI_DIFFICULTY.BEGINNER,decisionRng:new GameplayRng(12345)});
  assert.deepEqual(a,b);
  assert.equal(a.length,3);
});

test('Normal AI strongly prioritizes Resurrection when an ally is dead',()=>{
  const state=create3v3BattleState({teamA:['Cleric','Warrior','Archer'],teamB:['Barbarian','Rogue','Mage'],matchId:'RESAI'});
  markUnitDead(state,'H1');
  const plan=planAiDeclarations({state,side:SIDE.A,difficulty:AI_DIFFICULTY.NORMAL,decisionRng:new GameplayRng(9)});
  const cleric=plan.find(d=>d.actorId==='H0');
  assert.equal(cleric.actionId,'RESURRECTION');
  assert.equal(cleric.target.unitId,'H1');
});

test('Stunned Monk AI recognizes Second Wind as a hard-control bypass',()=>{
  const state=create3v3BattleState({teamA:['Monk','Warrior','Archer'],teamB:['Barbarian','Rogue','Mage'],matchId:'SWAI'});
  state.units.H0.statuses.push({key:'stun',duration:2,sourceId:'G0',data:{}});
  const plan=planAiDeclarations({state,side:SIDE.A,difficulty:AI_DIFFICULTY.NORMAL,decisionRng:new GameplayRng(10)});
  assert.equal(plan.find(d=>d.actorId==='H0').actionId,'SECOND_WIND');
});

test('AI never directly acquires an invisible enemy',()=>{
  const state=create3v3BattleState({teamA:['Warrior','Cleric','Archer'],teamB:['Barbarian','Rogue','Monk'],matchId:'INVAI'});
  state.units.H0.statuses.push({key:'invisible',duration:2,sourceId:'H0',data:{}});
  const candidates=enumerateAiCandidates({state,actorId:'G0'});
  assert.ok(candidates.every(c=>!(c.target?.type===TARGET_TYPE.UNIT&&c.target.unitId==='H0')));
});

test('Normal Archer AI can identify a 5x5 Volley covering all three opening enemies',()=>{
  const state=create3v3BattleState({teamA:['Warrior','Cleric','Monk'],teamB:['Archer','Rogue','Mage'],matchId:'VOLLEYAI'});
  const plan=planAiDeclarations({state,side:SIDE.B,difficulty:AI_DIFFICULTY.NORMAL,decisionRng:new GameplayRng(11)});
  const archer=plan.find(d=>d.actorId==='G0');
  assert.equal(archer.actionId,'VOLLEY');
  assert.equal(archer.target.type,TARGET_TYPE.GROUND);
  assert.ok(archer.target.row>=3&&archer.target.row<=7);
});

test('Hard AI plans all three actors jointly and remains deterministic',()=>{
  const state=standardState();
  const a=planAiDeclarations({state,side:SIDE.B,difficulty:AI_DIFFICULTY.HARD,decisionRng:new GameplayRng(777)});
  const b=planAiDeclarations({state,side:SIDE.B,difficulty:AI_DIFFICULTY.HARD,decisionRng:new GameplayRng(777)});
  assert.deepEqual(a,b);
  assert.equal(new Set(a.map(d=>d.actorId)).size,3);
});

test('SinglePlayerOpponent only generates one side declarations',()=>{
  const state=standardState();
  const bot=new SinglePlayerOpponent({side:SIDE.B,difficulty:AI_DIFFICULTY.NORMAL,decisionSeed:44});
  const plan=bot.planRound(state);
  assert.equal(plan.length,3);
  assert.ok(plan.every(d=>state.units[d.actorId].side===SIDE.B));
});

test('single-player uses the normal RoundCoordinator and gameplay seed is independent of AI decision RNG',()=>{
  const state=standardState();
  const human=basicAggroPlanner({state,roundNumber:1,side:SIDE.A});
  const a=new SinglePlayerRoundAuthority({matchId:'SP-A',humanSide:SIDE.A,aiDifficulty:AI_DIFFICULTY.NORMAL,aiDecisionSeed:123,seedFactory:()=>111});
  const b=new SinglePlayerRoundAuthority({matchId:'SP-B',humanSide:SIDE.A,aiDifficulty:AI_DIFFICULTY.NORMAL,aiDecisionSeed:123,seedFactory:()=>222});
  const ra=a.lockRound({state,humanDeclarations:human});
  const rb=b.lockRound({state,humanDeclarations:human});
  assert.deepEqual(ra.aiDeclarations,rb.aiDeclarations);
  assert.equal(ra.roundPackage.gameplaySeed,111);
  assert.equal(rb.roundPackage.gameplaySeed,222);
  assert.notEqual(ra.roundPackage.gameplaySeed,rb.roundPackage.gameplaySeed);
});

test('single-player package contains human and AI declarations in the same PvP package fields',()=>{
  const state=standardState();
  const human=basicAggroPlanner({state,roundNumber:1,side:SIDE.A});
  const authority=new SinglePlayerRoundAuthority({matchId:'SP-PKG',seedFactory:()=>333,aiDecisionSeed:555});
  const {roundPackage,aiDeclarations}=authority.lockRound({state,humanDeclarations:human});
  assert.deepEqual(roundPackage.declarationsA,human);
  assert.deepEqual(roundPackage.declarationsB,aiDeclarations);
  assert.equal(roundPackage.gameplaySeed,333);
});

test('AI planner adapter plugs directly into the existing 3v3 harness',()=>{
  const opts={teamA:['Warrior','Cleric','Archer'],teamB:['Barbarian','Monk','Mage'],maxRounds:3,matchSeed:8080,plannerSeed:9090,plannerA:basicAggroPlanner,plannerB:createAiPlannerAdapter(AI_DIFFICULTY.NORMAL)};
  const a=run3v3Playtest(opts),b=run3v3Playtest(opts);
  assert.deepEqual(a.rounds.map(r=>r.digest),b.rounds.map(r=>r.digest));
  assert.deepEqual(a.finalState,b.finalState);
});

test('AI decision seed changes declarations without changing the gameplay rules contract',()=>{
  const state=standardState();
  const p1=planAiDeclarations({state,side:SIDE.B,difficulty:AI_DIFFICULTY.BEGINNER,decisionRng:new GameplayRng(1)});
  const p2=planAiDeclarations({state,side:SIDE.B,difficulty:AI_DIFFICULTY.BEGINNER,decisionRng:new GameplayRng(2)});
  assert.equal(p1.length,3);assert.equal(p2.length,3);
  assert.ok(p1.every(d=>d.roundNumber===1)&&p2.every(d=>d.roundNumber===1));
});
