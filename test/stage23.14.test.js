import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_TYPE, SIDE, TARGET_TYPE,
  createBattleState, createHoldDeclaration, createRosterAbilityDeclaration,
  createRosterCombatScheduler, createRosterUnit, createRoundSimulation,
  findStatus, getArchetype
} from '../src/index.js';

const RANGE_TABLE = {
  Warrior:2, Barbarian:3, Rogue:1, Cleric:2, Mage:3, Paladin:2,
  Archer:6, Monk:1, Necromancer:3, Mystic:999, Shinobi:1, Electromancer:2
};

function basicId(archetypeId){
  return getArchetype(archetypeId).abilities.find(a=>a.id.endsWith('_ATTACK'))?.id;
}

function trial(archetypeId, seed){
  const actor=createRosterUnit({archetypeId,unitId:'H0',side:SIDE.A,draftSlot:0,position:{row:5,col:5}});
  const target=createRosterUnit({archetypeId:'Warrior',unitId:'G0',side:SIDE.B,draftSlot:0,position:{row:5,col:6}});
  target.stats.QKN=-1000; target.stats.DEF=0; target.stats.RES=0;
  if(archetypeId==='Cleric'||archetypeId==='Necromancer') actor.stats.hp=Math.floor(actor.stats.maxHP/2);
  const roundNumber=1;
  const declarations=[
    createRosterAbilityDeclaration({roundNumber,actorId:'H0',archetypeId,abilityId:basicId(archetypeId),target:{type:TARGET_TYPE.UNIT,unitId:'G0'}}),
    createHoldDeclaration({declarationId:'D:G0',roundNumber,actorId:'G0'})
  ];
  const sim=createRoundSimulation({state:createBattleState({matchId:`PROC:${archetypeId}:${seed}`,units:[actor,target]}),declarations,seed});
  createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:500});
  return sim;
}

function findProcAcrossSeeds(archetypeId, predicate){
  for(let seed=1;seed<=60;seed++){
    const sim=trial(archetypeId,seed);
    if(predicate(sim)) return sim;
  }
  return null;
}

test('Stage 23.14 weapon ranges match the explicit archetype range table',()=>{
  for(const [id,range] of Object.entries(RANGE_TABLE)){
    const c=getArchetype(id);
    assert.equal(c.weapon.weaponRange,range,`${id} weaponRange`);
    assert.equal(c.weapon.preferredRange,range,`${id} preferredRange`);
  }
});

test('legacy basic passive proc identities are executable under the multi-swing engine',()=>{
  const cleric=findProcAcrossSeeds('Cleric',sim=>sim.events.snapshot().some(e=>e.type===EVENT_TYPE.HEAL&&e.actorId==='H0'&&e.payload?.procLabel==='Prayer Mend'));
  assert.ok(cleric,'Cleric Prayer Mend proc should occur');

  const mage=findProcAcrossSeeds('Mage',sim=>sim.events.snapshot().some(e=>e.type===EVENT_TYPE.STUN&&e.actorId==='H0'));
  assert.ok(mage,'Mage Arc Shock stun proc should occur');

  const monk=findProcAcrossSeeds('Monk',sim=>Boolean(findStatus(sim.state.units.H0,'atk_up')));
  assert.ok(monk,'Monk ATK-up proc should occur');

  const mystic=findProcAcrossSeeds('Mystic',sim=>Boolean(findStatus(sim.state.units.G0,'def_down')));
  assert.ok(mystic,'Mystic DEF-down proc should occur');

  const necro=findProcAcrossSeeds('Necromancer',sim=>sim.events.snapshot().some(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.procLabel==='Life Drip'));
  assert.ok(necro,'Necromancer Life Drip proc should occur');
  assert.ok(necro.events.snapshot().some(e=>e.type===EVENT_TYPE.HEAL&&e.payload?.procLabel==='Life Drip'),'Life Drip should heal the Necromancer');

  const paladin=findProcAcrossSeeds('Paladin',sim=>Boolean(findStatus(sim.state.units.H0,'def_up')));
  assert.ok(paladin,'Paladin DEF-up proc should occur');
});

test('basic passive procs use round-level chances with a three-proc volatility cap',()=>{
  for(const id of ['Cleric','Mage','Monk','Mystic','Necromancer','Paladin','Electromancer']){
    const proc=getArchetype(id).abilities.find(a=>a.id.endsWith('_ATTACK')).basicProc;
    assert.ok(proc.roundChance>0 && proc.roundChance<1);
    assert.equal(proc.maxPerRound,3);
    assert.ok(proc.referenceSwings>=5);
    assert.equal(proc.chance,undefined);
  }
});

test('Mage owns the stun proc and Electromancer owns the stronger Lightning Bolt proc',()=>{
  const mage=getArchetype('Mage').abilities.find(a=>a.id==='MAGE_ATTACK').basicProc;
  assert.equal(mage.type,'STATUS');
  assert.equal(mage.key,'stun');
  assert.equal(mage.roundChance,.30);
  assert.equal(mage.maxPerRound,3);
  const electro=getArchetype('Electromancer').abilities.find(a=>a.id==='ELECTRO_ATTACK').basicProc;
  assert.equal(electro.type,'DAMAGE');
  assert.equal(electro.label,'Lightning Bolt');
  assert.equal(electro.roundChance,.80);
  assert.deepEqual([electro.min,electro.max],[50,175]);
  assert.equal(electro.maxPerRound,3);
});

test('Electromancer Lightning Bolt proc is impactful magical direct-stat damage',()=>{
  const sim=findProcAcrossSeeds('Electromancer',sim=>sim.events.snapshot().some(e=>e.payload?.procLabel==='Lightning Bolt'));
  const event=sim.events.snapshot().find(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.procLabel==='Lightning Bolt');
  assert.equal(event.payload.damageType,'MAGICAL');
  assert.equal(event.payload.proc,true);
  assert.ok(event.payload.rawDamage>=50 && event.payload.rawDamage<=350); // may crit for 2x
});
