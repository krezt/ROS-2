import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_KIND,
  AI_DIFFICULTY,
  SIDE,
  TARGET_TYPE,
  ActionSelectionSession,
  GameplayRng,
  abilityIntent,
  create3v3BattleState,
  createAiPlannerAdapter,
  createHoldDeclaration,
  createRosterAbilityDeclaration,
  createRosterCombatScheduler,
  createRoundSimulation,
  describeAuthoritativeEvent,
  enumerateAiCandidates,
  getAbility,
  incomingDamageMultiplier,
  run3v3Playtest
} from '../src/index.js';

function decl(state, actorId, abilityId, target){
  const actor=state.units[actorId];
  return createRosterAbilityDeclaration({roundNumber:state.roundNumber,actorId,archetypeId:actor.archetypeId,abilityId,target});
}
function hold(state, actorId){return createHoldDeclaration({declarationId:`D${state.roundNumber}:${actorId}`,roundNumber:state.roundNumber,actorId});}

test('single-player selection clock can pause/resume without losing time and can be extended',()=>{
  const state=create3v3BattleState({teamA:['Warrior','Rogue','Mage'],teamB:['Barbarian','Electromancer','Cleric'],matchId:'TIMER'});
  let now=1_000_000;
  const session=new ActionSelectionSession({state,side:SIDE.A,durationMs:120000,now:()=>now});
  now+=30000;assert.equal(session.remainingMs(),90000);
  assert.equal(session.pause(),true);now+=45000;assert.equal(session.remainingMs(),90000);assert.equal(session.isPaused(),true);
  session.extend(60000);assert.equal(session.remainingMs(),150000);
  assert.equal(session.resume(),true);now+=10000;assert.equal(session.remainingMs(),140000);assert.equal(session.isPaused(),false);
});

test('all BASIC_ATTACK styles are classified as hostile regardless of empty effect list',()=>{
  for(const [archetype,abilityId] of [['Warrior','POWER_STRIKE'],['Barbarian','REND'],['Barbarian','SMASH'],['Archer','SNIPE'],['Archer','COVER_FIRE']]){
    const a=getAbility(archetype,abilityId);assert.equal(a.actionKind,ACTION_KIND.BASIC_ATTACK);assert.equal(abilityIntent(a),'ENEMY',`${archetype} ${abilityId}`);
  }
});

test('AI never offers Barbarian Rend against itself or an ally',()=>{
  const state=create3v3BattleState({teamA:['Warrior','Rogue','Mage'],teamB:['Barbarian','Electromancer','Cleric'],matchId:'AI-TARGET'});
  const rend=enumerateAiCandidates({state,actorId:'G0'}).filter(c=>c.ability.id==='REND');
  assert.ok(rend.length>0);
  assert.ok(rend.every(c=>state.units[c.target.unitId].side===SIDE.A));
});

test('previous self-Rend reproduction seed no longer produces self-damage',()=>{
  const planner=createAiPlannerAdapter(AI_DIFFICULTY.NORMAL);
  const result=run3v3Playtest({teamA:['Warrior','Rogue','Mage'],teamB:['Barbarian','Electromancer','Cleric'],maxRounds:8,matchSeed:0x123456,plannerSeed:0xabcdef,plannerA:planner,plannerB:planner,matchId:'SELF-REGRESSION'});
  const selfRend=result.rounds.flatMap(r=>r.digest.events).filter(e=>e.type==='DAMAGE'&&e.actorId&&e.actorId===e.targetId&&e.payload?.abilityId==='REND');
  assert.deepEqual(selfRend,[]);
});

test('Divine Shield is a 60% reduction rather than full immunity',()=>{
  const state=create3v3BattleState({teamA:['Warrior','Rogue','Mage'],teamB:['Cleric','Electromancer','Barbarian'],matchId:'DIVINE'});
  state.units.G0.statuses.push({key:'divine_shield',duration:2,sourceId:'G0',data:{pct:.60}});
  assert.equal(incomingDamageMultiplier(state.units.G0,'MAGICAL'),.4);
});

test('Guardian Angel before Fireball reduces damage but does not turn it into zero',()=>{
  const state=create3v3BattleState({teamA:['Mage','Warrior','Rogue'],teamB:['Cleric','Electromancer','Barbarian'],matchId:'GA-FIREBALL'});
  const target={...state.units.G0.position};
  const declarations=[
    decl(state,'H0','FIREBALL',{type:TARGET_TYPE.GROUND,row:target.row,col:target.col}),hold(state,'H1'),hold(state,'H2'),
    decl(state,'G0','GUARDIAN_ANGEL',{type:TARGET_TYPE.UNIT,unitId:'G0'}),hold(state,'G1'),hold(state,'G2')
  ];
  const sim=createRoundSimulation({state,declarations,seed:9234});
  createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:500});
  const damage=sim.events.snapshot().find(e=>e.type==='DAMAGE'&&e.actorId==='H0'&&e.targetId==='G0');
  assert.ok(damage,'Fireball should damage Cleric');
  assert.ok(damage.payload.amount>0,'Guardian Angel must not grant full damage immunity');
  assert.ok(damage.payload.mitigated>0,'Damage event should expose mitigation for player-facing clarity');
});

test('combat log shows mitigated damage when authoritative event provides it',()=>{
  const state=create3v3BattleState({teamA:['Mage','Warrior','Rogue'],teamB:['Cleric','Electromancer','Barbarian'],matchId:'LOG-MIT'});
  const text=describeAuthoritativeEvent({eventId:'E1',sequence:0,parentEventId:null,initiativeCycle:5,type:'DAMAGE',actorId:'H0',targetId:'G0',payload:{amount:80,mitigated:120,hpAfter:700,damageType:'MAGICAL'}},state);
  assert.match(text,/80 magical damage/);assert.match(text,/120 mitigated/);
});
