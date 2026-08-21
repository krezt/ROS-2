import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  DAMAGE_TYPE, SIDE,
  ROSTER, createRosterUnit, createBattleState, createRoundSimulation, createHoldDeclaration,
  createRosterAbilityDeclaration, createRosterCombatScheduler,
  applyDamageMitigation, incomingDamageMultiplier, abilityDetailModel, findStatus
} from '../src/index.js';

function unit(archetypeId='Mage',unitId='H0',side=SIDE.A,position={row:3,col:1}){return createRosterUnit({archetypeId,unitId,side,draftSlot:0,position});}

function collectCoefficients(value,out=[]){
  if(Array.isArray(value)){for(const x of value)collectCoefficients(x,out);return out;}
  if(value&&typeof value==='object'){
    if(Object.hasOwn(value,'coef'))out.push(value.coef);
    for(const v of Object.values(value))collectCoefficients(v,out);
  }
  return out;
}

test('playable roster uses explicit direct baseline combat percentages rather than legacy STR/INT/TGH derivation',()=>{
  for(const [id,c] of Object.entries(ROSTER)){
    assert.equal(c.stats.ATK,100,`${id} ATK`);
    assert.equal(c.stats.SDM,100,`${id} SP`);
    assert.equal(c.stats.DEF,35,`${id} ARM`);
    assert.equal(c.stats.RES,35,`${id} RES`);
    assert.equal('attributes' in c,false,`${id} should not expose legacy attributes`);
  }
});

test('roster abilities no longer contain spell/heal scaling coefficients',()=>{
  const found=[];
  for(const c of Object.values(ROSTER))for(const a of c.abilities)collectCoefficients(a.effects,found);
  assert.deepEqual(found,[]);
});

test('ARM and RES are direct mitigation percentages and penetration reduces the relevant layer',()=>{
  const t=unit('Warrior','G0',SIDE.B,{row:3,col:4});
  t.stats.DEF=25;t.stats.RES=25;
  assert.equal(applyDamageMitigation(100,t,DAMAGE_TYPE.PHYSICAL,0),75);
  assert.equal(applyDamageMitigation(100,t,DAMAGE_TYPE.MAGICAL,0),75);
  assert.equal(applyDamageMitigation(100,t,DAMAGE_TYPE.PHYSICAL,.40),85);
  assert.equal(applyDamageMitigation(100,t,DAMAGE_TYPE.MAGICAL,.40),85);
});

test('physical ARM and magical RES are independent defensive axes',()=>{
  const t=unit('Warrior','G0',SIDE.B,{row:3,col:4});
  t.stats.DEF=50;t.stats.RES=10;
  assert.equal(applyDamageMitigation(100,t,DAMAGE_TYPE.PHYSICAL,0),50);
  assert.equal(applyDamageMitigation(100,t,DAMAGE_TYPE.MAGICAL,0),90);
});

test('shield layer still distinguishes physical and magical mitigation after ARM/RES',()=>{
  const t=unit('Warrior','G0',SIDE.B,{row:3,col:4});
  t.statuses=[{key:'magic_shield',duration:2,sourceId:'H0',data:{pct:.5}}];
  assert.equal(incomingDamageMultiplier(t,DAMAGE_TYPE.PHYSICAL),1);
  assert.equal(incomingDamageMultiplier(t,DAMAGE_TYPE.MAGICAL),.5);
  t.statuses=[{key:'physical_shield',duration:2,sourceId:'H0',data:{pct:.5}}];
  assert.equal(incomingDamageMultiplier(t,DAMAGE_TYPE.PHYSICAL),.5);
  assert.equal(incomingDamageMultiplier(t,DAMAGE_TYPE.MAGICAL),1);
  t.statuses=[{key:'divine_shield',duration:2,sourceId:'H0',data:{pct:.6}}];
  assert.ok(Math.abs(incomingDamageMultiplier(t,DAMAGE_TYPE.PHYSICAL)-.4)<1e-9);
  assert.ok(Math.abs(incomingDamageMultiplier(t,DAMAGE_TYPE.MAGICAL)-.4)<1e-9);
});

test('one ATK UP stack means a real 150% raw physical multiplier',()=>{
  const w=unit('Warrior','H0',SIDE.A,{row:3,col:2});
  const b=unit('Barbarian','G0',SIDE.B,{row:3,col:4});b.stats.DEF=0;b.stats.QKN=-1000;
  w.weapon.attackBaseMin=100;w.weapon.attackBaseMax=100;w.stats.CRIT=0;w.weapon.critBonus=0;
  w.statuses=[{key:'atk_up',duration:2,sourceId:'H0',data:{stacks:1}}];
  const state=createBattleState({matchId:'DIRECT-ATK',units:[w,b]});
  const declarations=[createRosterAbilityDeclaration({roundNumber:1,actorId:'H0',archetypeId:'Warrior',abilityId:'WARRIOR_ATTACK',target:{type:'UNIT',unitId:'G0'}}),createHoldDeclaration({declarationId:'D1:G0',roundNumber:1,actorId:'G0'})];
  const sim=createRoundSimulation({state,declarations,seed:1});w.resources.attacksRemaining=1;
  createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:20});
  const impact=sim.events.snapshot().find(e=>e.type==='ATTACK_IMPACT'&&e.actorId==='H0');
  assert.equal(impact.payload.rawDamage,150);
});

test('ability detail panel reports current direct scaling without coefficient language',()=>{
  const mage=unit('Mage');
  const fireball=ROSTER.Mage.abilities.find(a=>a.id==='FIREBALL');
  const d=abilityDetailModel(mage,fireball);
  assert.ok(d.lines.some(x=>x.includes('200–350 magical damage')));
  assert.ok(!`${d.note} ${d.lines.join(' ')}`.toLowerCase().includes('coefficient'));
  mage.statuses=[{key:'sdm_up',duration:2,sourceId:'H0',data:{stacks:1}}];
  const buffed=abilityDetailModel(mage,fireball);
  assert.ok(buffed.lines.some(x=>x.includes('300–525 magical damage')));
});

test('Stage 23.9 removes inspection hint and adds persistent battlefield-adjacent ability information',()=>{
  const html=fs.readFileSync(new URL('../client/index.html',import.meta.url),'utf8');
  const css=fs.readFileSync(new URL('../client/styles.css',import.meta.url),'utf8');
  assert.doesNotMatch(html,/Battlefield clicks inspect either team/);
  assert.match(html,/id="abilityInfoPanel"/);
  assert.match(html,/id="abilityInfoBody"/);
  assert.match(css,/grid-template-columns:repeat\(7,minmax\(0,1fr\)\)/);
});
