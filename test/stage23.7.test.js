import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  AI_DIFFICULTY,
  EVENT_TYPE,
  LIFE_STATE,
  PRESENTATION_COMMAND,
  SIDE,
  TARGET_TYPE,
  SinglePlayerOpponent,
  buildPresentationTimeline,
  closeRound,
  create3v3BattleState,
  createBattleState,
  createHoldDeclaration,
  createRosterAbilityDeclaration,
  createRosterCombatScheduler,
  createRosterUnit,
  createRoundSimulation,
  markUnitDead
} from '../src/index.js';

function unit(archetypeId,unitId,side,position,draftSlot=0){return createRosterUnit({archetypeId,unitId,side,draftSlot,position});}
function hold(actorId,roundNumber=1){return createHoldDeclaration({declarationId:`D${roundNumber}:${actorId}`,roundNumber,actorId});}
function decl(archetypeId,abilityId,actorId,target,roundNumber=1){return createRosterAbilityDeclaration({roundNumber,actorId,archetypeId,abilityId,target});}
function run(state,declarations,seed=123){const sim=createRoundSimulation({state,declarations,seed});createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:500});return sim;}

test('Electrical Storm stun lasts only the round in which the storm lands',()=>{
  let observed=null;
  for(let seed=1;seed<=100&&!observed;seed++){
    const electro=unit('Electromancer','H0',SIDE.A,{row:3,col:1});
    const enemy=unit('Mage','G0',SIDE.B,{row:3,col:8});
    enemy.stats.maxHP=10000;enemy.stats.hp=10000;enemy.stats.DEF=0;
    const state=createBattleState({matchId:`STORM-STUN-${seed}`,units:[electro,enemy]});
    const sim=run(state,[decl('Electromancer','ELECTRICAL_STORM','H0',{type:TARGET_TYPE.ALL_ENEMIES}),hold('G0')],seed);
    const stun=sim.state.units.G0.statuses.find(s=>s.key==='stun');
    if(stun)observed=sim;
  }
  assert.ok(observed,'expected a deterministic seed to proc Electrical Storm stun');
  assert.equal(observed.state.units.G0.statuses.find(s=>s.key==='stun')?.duration,1);
  closeRound(observed,{advanceRound:false});
  assert.equal(observed.state.units.G0.statuses.some(s=>s.key==='stun'),false,'storm stun expires at this round end');
});

test('Arcane Echo projects two visible spell projectiles for the two explicit Fireball resolutions',()=>{
  const mage=unit('Mage','H0',SIDE.A,{row:3,col:1});
  mage.statuses.push({key:'arcane_echo',duration:2,sourceId:'H0',data:{}});
  const enemy=unit('Barbarian','G0',SIDE.B,{row:5,col:8});enemy.stats.maxHP=10000;enemy.stats.hp=10000;enemy.stats.DEF=0;
  const state=createBattleState({matchId:'ECHO-PROJECTILES',units:[mage,enemy]});
  const sim=run(state,[decl('Mage','FIREBALL','H0',{type:TARGET_TYPE.GROUND,row:5,col:8}),hold('G0')],51);
  const resolutions=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.SPELL_RESOLUTION&&e.actorId==='H0');
  assert.equal(resolutions.length,2);
  const projectiles=buildPresentationTimeline(sim.events.snapshot()).filter(c=>c.type===PRESENTATION_COMMAND.SPELL_PROJECTILE&&c.actorId==='H0');
  assert.equal(projectiles.length,2);
  assert.deepEqual(projectiles.map(c=>c.payload.resolutionIndex),[1,2]);
});

test('Normal single-player AI does not settle into the old lone-survivor support loops',()=>{
  const state=create3v3BattleState({teamA:['Mage','Warrior','Rogue'],teamB:['Barbarian','Electromancer','Cleric'],matchId:'AI-LONE-MAGE'});
  markUnitDead(state,'H1');markUnitDead(state,'H2');
  const ai=new SinglePlayerOpponent({side:SIDE.B,difficulty:AI_DIFFICULTY.NORMAL,decisionSeed:0xA121B07});
  const byActor={G0:[],G1:[],G2:[]};
  for(let r=1;r<=6;r++){
    state.roundNumber=r;
    for(const d of ai.planRound(state))byActor[d.actorId].push(d.actionId);
  }
  assert.ok(byActor.G0.some(x=>['BARBARIAN_ATTACK','REND','SMASH','WAR_CRY'].includes(x)),'Barbarian should apply direct pressure');
  assert.ok(byActor.G1.includes('CHAIN_LIGHTNING')||byActor.G1.includes('ELECTRO_ATTACK'),'Electromancer should eventually choose real kill pressure');
  assert.ok(byActor.G2.includes('PIERCING_LIGHT')||byActor.G2.includes('CLERIC_ATTACK'),'Cleric should eventually contribute damage');
  assert.ok(new Set(byActor.G1).size>=2,'Electromancer should vary choices rather than repeat one spell forever');
  assert.ok(new Set(byActor.G2).size>=2,'Cleric should vary choices rather than repeat one shield forever');
});

test('AI history snapshot records recent actions without touching gameplay RNG state',()=>{
  const state=create3v3BattleState({teamA:['Mage','Warrior','Rogue'],teamB:['Barbarian','Electromancer','Cleric'],matchId:'AI-HISTORY'});
  const ai=new SinglePlayerOpponent({side:SIDE.B,difficulty:AI_DIFFICULTY.NORMAL,decisionSeed:77});
  ai.planRound(state);
  const snap=ai.snapshot();
  assert.ok(Object.keys(snap.actionHistory).length===3);
  assert.ok(Object.values(snap.actionHistory).every(h=>h.length===1));
  assert.equal(typeof snap.decisionRng.drawCount,'number');
});


test('lethal roster spell/ability damage immediately updates match outcome',()=>{
  const mage=unit('Mage','H0',SIDE.A,{row:3,col:1});
  const electro=unit('Electromancer','G0',SIDE.B,{row:3,col:8});
  mage.stats.hp=1;mage.stats.maxHP=Math.max(mage.stats.maxHP,1);mage.stats.DEF=0;
  const state=createBattleState({matchId:'ROSTER-KO-OUTCOME',units:[mage,electro]});
  const sim=run(state,[hold('H0'),decl('Electromancer','CHAIN_LIGHTNING','G0',{type:TARGET_TYPE.UNIT,unitId:'H0'})],7);
  assert.equal(sim.state.units.H0.lifeState,LIFE_STATE.DEAD);
  assert.equal(sim.state.outcome.status,'COMPLETE');
  assert.equal(sim.state.outcome.winner,'B');
});

test('Stage 23.7 round controls remain in the compact header while later UX may remove the inspection hint',()=>{
  const html=fs.readFileSync(new URL('../client/index.html',import.meta.url),'utf8');
  assert.match(html,/class="round-strip"/);
  assert.match(html,/id="roundNo"/);
  assert.match(html,/id="timer"/);
  assert.doesNotMatch(html,/Inspection never changes your planned action/);
});
