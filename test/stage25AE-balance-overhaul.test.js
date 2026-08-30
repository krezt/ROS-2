import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_TYPE, SIDE, TARGET_TYPE,
  createBattleState, createHoldDeclaration, createRosterAbilityDeclaration, counterRulesFor,
  createRosterCombatScheduler, createRosterUnit, createRoundSimulation,
  findStatus, getAbility, getArchetype, getPhysicalDodgeChance,
  resolveBasicAttack, resolveRosterEffects
} from '../src/index.js';

function unit(archetypeId,unitId,side,pos,slot=0){return createRosterUnit({archetypeId,unitId,side,draftSlot:slot,position:pos});}
function hold(id,roundNumber=1){return createHoldDeclaration({declarationId:`H:${roundNumber}:${id}`,roundNumber,actorId:id});}
function decl(archetypeId,abilityId,actorId='H0',target={type:TARGET_TYPE.UNIT,unitId:'G0'},roundNumber=1){return createRosterAbilityDeclaration({roundNumber,actorId,archetypeId,abilityId,target});}

const HP={Warrior:2450,Barbarian:2250,Rogue:1850,Cleric:1900,Mage:1750,Paladin:1900,Archer:1800,Monk:1800,Necromancer:1800,Mystic:1700,Shinobi:1750,Electromancer:1750};

test('Stage25AE base HP and key weapon chassis values match the new balance pass',()=>{
  for(const [id,hp] of Object.entries(HP))assert.equal(getArchetype(id).stats.maxHP,hp,id);
  const archer=getArchetype('Archer');
  assert.equal(archer.combat.attacksMax,6);
  assert.deepEqual([archer.weapon.attackBaseMin,archer.weapon.attackBaseMax],[80,150]);
  assert.equal(getAbility('Archer','ARCHER_ATTACK').basicStyle,undefined);
  const barb=getArchetype('Barbarian');assert.deepEqual([barb.weapon.attackBaseMin,barb.weapon.attackBaseMax],[80,110]);
  const rogue=getArchetype('Rogue');assert.ok(Math.abs((rogue.stats.CRIT+rogue.weapon.critBonus)-.15)<1e-12);
  const electro=getArchetype('Electromancer');assert.deepEqual([electro.weapon.attackBaseMin,electro.weapon.attackBaseMax],[20,40]);
});

test('physical dodge rounds upward to whole percentages and Premonition adds +5 percentage points',()=>{
  const rogue=unit('Rogue','H0',SIDE.A,{row:5,col:3});
  const mystic=unit('Mystic','H1',SIDE.A,{row:6,col:3},1);
  const enemy=unit('Warrior','G0',SIDE.B,{row:5,col:10});
  assert.equal(getPhysicalDodgeChance(rogue),.12); // raw 11.5% -> 12%
  const sim=createRoundSimulation({state:createBattleState({matchId:'AE-PREM-DODGE',units:[rogue,mystic,enemy]}),declarations:[hold('H0'),hold('H1'),hold('G0')],seed:1});
  resolveRosterEffects(sim,{actorId:'H1',ability:getAbility('Mystic','PREMONITION'),validity:{},cycle:0});
  assert.equal(findStatus(sim.state.units.H0,'dodge_up')?.data?.bonus,.05);
  assert.equal(getPhysicalDodgeChance(sim.state.units.H0),.17); // raw 16.5% -> 17%
});

test('Dig In 15% Physical Shield stacks to two overlapping layers',()=>{
  const warrior=unit('Warrior','H0',SIDE.A,{row:5,col:3});
  const enemy=unit('Barbarian','G0',SIDE.B,{row:5,col:10});
  warrior.stats.hp=1000;
  const sim=createRoundSimulation({state:createBattleState({matchId:'AE-DIG-STACK',units:[warrior,enemy]}),declarations:[hold('H0'),hold('G0')],seed:2});
  const ability=getAbility('Warrior','DIG_IN');
  resolveRosterEffects(sim,{actorId:'H0',ability,validity:{target:sim.state.units.H0},cycle:0});
  assert.equal(findStatus(sim.state.units.H0,'physical_shield')?.data?.pct,.15);
  resolveRosterEffects(sim,{actorId:'H0',ability,validity:{target:sim.state.units.H0},cycle:1});
  const shield=findStatus(sim.state.units.H0,'physical_shield');
  assert.equal(shield?.data?.stacks,2);
  assert.equal(shield?.data?.pct,.30);
});

test('Mystic Guard Falter proc applies both DEF Down and RES Down for 3 rounds',()=>{
  let found=false;
  for(let seed=1;seed<=200&&!found;seed++){
    const mystic=unit('Mystic','H0',SIDE.A,{row:5,col:3});
    const target=unit('Warrior','G0',SIDE.B,{row:5,col:4});
    mystic.stats.CRIT=0;target.stats.QKN=-1000;target.stats.hp=target.stats.maxHP=99999;
    const sim=createRoundSimulation({state:createBattleState({matchId:`AE-GF-${seed}`,units:[mystic,target]}),declarations:[decl('Mystic','MYSTIC_ATTACK'),hold('G0')],seed});
    resolveBasicAttack(sim,'H0','G0',{cycle:0,ignoreAttackInterval:true});
    const def=findStatus(sim.state.units.G0,'def_down'),res=findStatus(sim.state.units.G0,'res_down');
    if(def&&res){assert.equal(def.duration,3);assert.equal(res.duration,3);found=true;}
  }
  assert.equal(found,true,'expected a deterministic seed to proc Guard Falter');
});

test('Bloodlust preserves Barbarian SW by disabling counterattacks while active',()=>{
  const barb=unit('Barbarian','H0',SIDE.A,{row:5,col:5});
  const enemy=unit('Warrior','G0',SIDE.B,{row:5,col:6});
  barb.statuses.push({key:'bloodlust',duration:1,sourceId:'H0',data:{incomingDamageMultiplier:1.25,noCounter:true}});
  const sim=createRoundSimulation({state:createBattleState({matchId:'AE-BLOODLUST-NOCOUNTER',units:[barb,enemy]}),declarations:[hold('H0'),hold('G0')],seed:3});
  const before=sim.state.units.H0.resources.attacksRemaining;
  resolveBasicAttack(sim,'G0','H0',{cycle:0,ignoreAttackInterval:true});
  assert.equal(counterRulesFor(sim.state.units.H0).disabled,true);
  assert.equal(sim.state.units.H0.resources.attacksRemaining,before);
});

test('Chain Lightning may revisit a champion once, never consecutively, and never more than twice',()=>{
  let repeated=null;
  for(let seed=1;seed<=500&&!repeated;seed++){
    const electro=unit('Electromancer','H0',SIDE.A,{row:5,col:2});
    const enemy=unit('Warrior','G0',SIDE.B,{row:5,col:10});
    for(const u of [electro,enemy]){u.stats.hp=u.stats.maxHP=99999;u.stats.RES=0;u.stats.CRIT=0;}
    const sim=createRoundSimulation({state:createBattleState({matchId:`AE-CHAIN-${seed}`,units:[electro,enemy]}),declarations:[decl('Electromancer','CHAIN_LIGHTNING','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'}),hold('G0')],seed});
    createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:50});
    const targets=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.abilityId==='CHAIN_LIGHTNING').map(e=>e.targetId);
    const counts=targets.reduce((m,id)=>(m[id]=(m[id]??0)+1,m),{});
    assert.ok(Object.values(counts).every(n=>n<=2));
    for(let i=1;i<targets.length;i++)assert.notEqual(targets[i],targets[i-1]);
    if(Object.values(counts).some(n=>n===2))repeated=targets;
  }
  assert.ok(repeated,'expected at least one seed where Chain Lightning revisits a living champion');
});

test('Stage25AE updated special ability values are authoritative',()=>{
  const smash=getAbility('Barbarian','SMASH').basicStyle;assert.deepEqual([smash.attacksSet,smash.damageMultiplier,smash.onHit.chance],[5,1.25,.10]);
  const rend=getAbility('Barbarian','REND').basicStyle;assert.equal(rend.damageMultiplier,1.25);
  assert.deepEqual([getAbility('Barbarian','WAR_CRY').effects[0].min,getAbility('Barbarian','WAR_CRY').effects[0].max],[75,100]);
  assert.equal(getAbility('Rogue','SHADOWSTEP').effects[0].duration,4);
  const smoke=getAbility('Rogue','SMOKE_BOMB');const smokeHeal=smoke.effects.find(e=>e.type==='HEAL_PERCENT_ROLL');assert.deepEqual([smokeHeal.minPct,smokeHeal.maxPct],[.15,.25]);
  const aura=getAbility('Cleric','DEFENSIVE_AURA');assert.deepEqual([aura.effects[0].minPct,aura.effects[0].maxPct],[.35,.55]);assert.ok(aura.effects.some(e=>e.key==='res_up'&&e.duration===3));
  assert.equal(getAbility('Mage','ARCANE_WARD').effects[0].data.pct,.30);assert.deepEqual([getAbility('Mage','FIREBALL').effects[0].min,getAbility('Mage','FIREBALL').effects[0].max],[200,400]);
  const bash=getAbility('Paladin','SHIELD_BASH').basicStyle;assert.equal(bash.damageMultiplier,4);assert.equal(bash.selfOnFirstAttack.data.pct,.10);assert.equal(getAbility('Paladin','PALADIN_ATTACK').basicProc.duration,3);
  const cover=getAbility('Archer','COVER_FIRE').basicStyle;assert.equal(cover.attacksSet,4);assert.equal(getAbility('Archer','VOLLEY').completionDelayCycles,4);assert.equal(getAbility('Archer','SNIPE').basicStyle.damageMultiplier,2.25);
  const second=getAbility('Monk','SECOND_WIND');assert.equal(second.effects.find(e=>e.key==='regen').data.pct,.20);assert.ok(second.effects.some(e=>e.key==='def_up'&&e.duration===3));
  const bolt=getAbility('Necromancer','POISON_BOLT');assert.equal(bolt.effects.find(e=>e.type==='DAMAGE').critBonus,.25);assert.equal(bolt.effects.find(e=>e.type==='POISON_FROM_LAST_DAMAGE').ratio,1);
  const proc=getAbility('Electromancer','ELECTRO_ATTACK').basicProc;assert.equal(proc.defensePenetration,.25);assert.ok(Math.abs((.05+proc.critBonus)-.15)<1e-12);assert.deepEqual([getAbility('Electromancer','CHAIN_LIGHTNING').effects[0].min,getAbility('Electromancer','CHAIN_LIGHTNING').effects[0].max],[200,300]);
});
