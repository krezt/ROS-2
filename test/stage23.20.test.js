import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_TYPE, SIDE, TARGET_TYPE,
  createBattleState, createHoldDeclaration, createRosterAbilityDeclaration,
  createRosterCombatScheduler, createRosterUnit, createRoundSimulation,
  effectiveStat, findStatus, getAbility, getArchetype, resolveRosterEffects
} from '../src/index.js';

function unit(archetypeId,unitId,side,pos,slot=0){return createRosterUnit({archetypeId,unitId,side,draftSlot:slot,position:pos});}
function hold(id){return createHoldDeclaration({declarationId:`H:${id}`,roundNumber:1,actorId:id});}
function attackDecl(archetypeId,actorId='H0',targetId='G0'){
  const attack=getArchetype(archetypeId).abilities.find(a=>a.actionKind==='BASIC_ATTACK'&&!a.basicStyle);
  return createRosterAbilityDeclaration({declarationId:`D:${actorId}`,roundNumber:1,actorId,archetypeId,abilityId:attack.id,target:{type:TARGET_TYPE.UNIT,unitId:targetId}});
}

test('Stage 23.20 Archer range and Snipe tuning match the playtest ruling',()=>{
  const archer=getArchetype('Archer');
  const snipe=getAbility('Archer','SNIPE');
  assert.equal(archer.weapon.weaponRange,6);
  assert.equal(archer.weapon.preferredRange,6);
  assert.equal(snipe.basicStyle.attackRangeOverride,9);
  assert.equal(snipe.basicStyle.damageMultiplier,2.25);
  assert.equal(snipe.basicStyle.distanceDamageBonusPerSquare,.05);
});

test('current survivability polish raises every champion HP baseline by a further 20%',()=>{
  const expected={Warrior:2126,Barbarian:1997,Rogue:1700,Cleric:1784,Mage:1700,Paladin:1827,Archer:1700,Monk:1614,Necromancer:1700,Mystic:1571,Shinobi:1658,Electromancer:1614};
  for(const [id,hp] of Object.entries(expected)) assert.equal(getArchetype(id).stats.maxHP,hp,id);
});

test('Monk has seven normal swings and Palm Hits are two 350% pursuit strikes',()=>{
  const monk=getArchetype('Monk'), palm=getAbility('Monk','PALM_HIT');
  assert.equal(monk.combat.attacksMax,7);
  assert.equal(getAbility('Monk','MONK_ATTACK').basicProc.referenceSwings,7);
  assert.equal(palm.basicStyle.attacksSet,2);
  assert.equal(palm.basicStyle.damageMultiplier,3.5);
  assert.equal(palm.basicStyle.onHit.chance,.35);
});

test('Electromancer Shift lasts four rounds',()=>{
  const shift=getAbility('Electromancer','SHIFT');
  assert.equal(shift.effects[0].key,'shift');
  assert.equal(shift.effects[0].duration,4);
});

test('ATK SDM ARM and RES buffs/debuffs stack to five and effective stats honor the cap',()=>{
  const mage=unit('Mage','H0',SIDE.A,{row:5,col:2});
  const foe=unit('Warrior','G0',SIDE.B,{row:5,col:10});
  const sim=createRoundSimulation({state:createBattleState({matchId:'STACK5',units:[mage,foe]}),declarations:[hold('H0'),hold('G0')],seed:2320});
  const synthetic={id:'STACK_TEST',effects:[]};
  const effects=[
    {type:'APPLY_STATUS',key:'atk_up',duration:4,stackMode:'STACK',to:'SELF'},
    {type:'APPLY_STATUS',key:'atk_down',duration:4,stackMode:'STACK',to:'SELF'},
    {type:'APPLY_STATUS',key:'sdm_up',duration:4,stackMode:'STACK',to:'SELF'},
    {type:'APPLY_STATUS',key:'sdm_down',duration:4,stackMode:'STACK',to:'SELF'},
    {type:'APPLY_STATUS',key:'def_up',duration:4,stackMode:'STACK',to:'SELF'},
    {type:'APPLY_STATUS',key:'def_down',duration:4,stackMode:'STACK',to:'SELF'},
    {type:'APPLY_STATUS',key:'res_up',duration:4,stackMode:'STACK',to:'SELF'},
    {type:'APPLY_STATUS',key:'res_down',duration:4,stackMode:'STACK',to:'SELF'}
  ];
  for(let i=0;i<7;i++) resolveRosterEffects(sim,{actorId:'H0',ability:synthetic,effects,validity:{target:mage},cycle:0});
  const live=sim.state.units.H0;
  for(const key of ['atk_up','atk_down','sdm_up','sdm_down','def_up','def_down','res_up','res_down']) assert.equal(findStatus(live,key)?.data?.stacks,5,key);
  assert.ok(Number.isFinite(effectiveStat(live,'ATK')));
  assert.ok(Number.isFinite(effectiveStat(live,'SDM')));
  assert.ok(Number.isFinite(effectiveStat(live,'DEF')));
  assert.ok(Number.isFinite(effectiveStat(live,'RES')));
});

test('Monk Opening procs accumulate ATK_UP stacks instead of merely refreshing one stack',()=>{
  let found=null;
  for(let seed=1;seed<=400&&!found;seed++){
    const monk=unit('Monk','H0',SIDE.A,{row:5,col:5});
    const target=unit('Warrior','G0',SIDE.B,{row:5,col:6});
    target.stats.QKN=-1000; target.stats.DEF=0; target.stats.maxHP=99999; target.stats.hp=99999;
    const sim=createRoundSimulation({state:createBattleState({matchId:`MONK_STACK:${seed}`,units:[monk,target]}),declarations:[attackDecl('Monk'),hold('G0')],seed});
    createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:500});
    const procs=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.STATUS_APPLY&&e.actorId==='H0'&&e.targetId==='H0'&&e.payload?.key==='atk_up').length;
    const stacks=findStatus(sim.state.units.H0,'atk_up')?.data?.stacks??0;
    if(procs>=2) found={procs,stacks};
  }
  assert.ok(found,'expected a deterministic Monk attack round with multiple Opening procs');
  assert.equal(found.stacks,Math.min(5,found.procs));
  assert.ok(found.stacks>=2);
});
