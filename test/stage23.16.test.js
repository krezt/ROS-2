import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_TYPE, SIDE, TARGET_TYPE,
  createBattleState, createHoldDeclaration, createRosterAbilityDeclaration,
  createRosterCombatScheduler, createRosterUnit, createRoundSimulation, getArchetype
} from '../src/index.js';

const proc=id=>getArchetype(id).abilities.find(a=>a.id.endsWith('_ATTACK')).basicProc;
const basicId=id=>getArchetype(id).abilities.find(a=>a.id.endsWith('_ATTACK')).id;

function procTrial(archetypeId, seed){
  const actor=createRosterUnit({archetypeId,unitId:'H0',side:SIDE.A,draftSlot:0,position:{row:5,col:5}});
  const target=createRosterUnit({archetypeId:'Warrior',unitId:'G0',side:SIDE.B,draftSlot:0,position:{row:5,col:6}});
  target.stats.QKN=-1000; target.stats.DEF=0; target.stats.RES=0; target.stats.maxHP=99999; target.stats.hp=99999;
  const roundNumber=1;
  const declarations=[
    createRosterAbilityDeclaration({roundNumber,actorId:'H0',archetypeId,abilityId:basicId(archetypeId),target:{type:TARGET_TYPE.UNIT,unitId:'G0'}}),
    createHoldDeclaration({declarationId:'D:G0',roundNumber,actorId:'G0'})
  ];
  const sim=createRoundSimulation({state:createBattleState({matchId:`MULTIPROC:${archetypeId}:${seed}`,units:[actor,target]}),declarations,seed});
  createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:500});
  return sim;
}

test('Stage 23.16 passive procs allow up to three successes per round',()=>{
  for(const id of ['Cleric','Mage','Monk','Mystic','Necromancer','Paladin','Electromancer']) {
    assert.equal(proc(id).maxPerRound,3,id);
  }
});

test('Stage 23.16 retains independent per-hit chance derived from roundChance/referenceSwings',()=>{
  const monk=proc('Monk');
  const p=1-Math.pow(1-monk.roundChance,1/monk.referenceSwings);
  assert.ok(p>0 && p<1);
  assert.ok(p>.23 && p<.25,`unexpected Monk per-hit chance ${p}`);
});

test('Stage 23.16 can produce multiple passive procs in a single attack round',()=>{
  let found=null;
  for(let seed=1;seed<=500;seed++){
    const sim=procTrial('Electromancer',seed);
    const bolts=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.procLabel==='Lightning Bolt');
    if(bolts.length>=2){ found=bolts.length; break; }
  }
  assert.ok(found>=2,'expected at least one deterministic seed with 2+ Lightning Bolt procs in one round');
  assert.ok(found<=3,'passive proc volatility cap must remain 3');
});
