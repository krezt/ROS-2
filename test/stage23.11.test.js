import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_TYPE,
  SIDE,
  combatLogClassForEvent,
  createRosterUnit,
  getAbility,
  playerFacingCombatStats,
  statusDisplayModels
} from '../src/index.js';

function unit(archetypeId='Mage'){
  return createRosterUnit({archetypeId,unitId:'H0',side:SIDE.A,draftSlot:0,position:{row:5,col:5}});
}

test('Magic Shield is reflected in effective RES without mutating the raw RES stat',()=>{
  const u=unit('Mage');
  assert.equal(u.stats.RES,35);
  u.statuses.push({key:'magic_shield',duration:3,sourceId:'H0',data:{pct:.50}});
  const ps=playerFacingCombatStats(u);
  assert.equal(ps.resistanceBasePct,35);
  assert.equal(ps.resistanceMitigationPct,68); // 35% base, then 50% of remainder
  assert.equal(ps.magicShieldPct,50);
  assert.equal(u.stats.RES,35);
});

test('Physical Shield and Divine Shield contribute to effective ARM/RES as separate multiplicative layers',()=>{
  const u=unit('Warrior');
  u.statuses.push({key:'physical_shield',duration:1,sourceId:'H0',data:{pct:.20}});
  u.statuses.push({key:'divine_shield',duration:1,sourceId:'H0',data:{pct:.60}});
  const ps=playerFacingCombatStats(u);
  assert.equal(ps.armorMitigationPct,79); // 1 - .65*.80*.40
  assert.equal(ps.resistanceMitigationPct,74); // 1 - .65*.40
});

test('status inspector colors ordinary debuffs red, hard control purple, Poison green, Bleed red, and buffs green',()=>{
  const u=unit('Barbarian');
  u.statuses=[
    {key:'rend_def_down',duration:3,sourceId:'H0',data:{stacks:2,pctPerStack:.1}},
    {key:'stun',duration:1,sourceId:'G0',data:{}},
    {key:'poison',duration:null,sourceId:'G0',data:{contributions:[{amount:20}]}},
    {key:'bleed',duration:5,sourceId:'G0',data:{pct:.15}},
    {key:'atk_up',duration:2,sourceId:'H0',data:{}}
  ];
  const tones=Object.fromEntries(statusDisplayModels(u).map(s=>[s.key,s.tone]));
  assert.deepEqual(tones,{rend_def_down:'negative',stun:'control',poison:'poison',bleed:'bleed',atk_up:'positive'});
});

test('combat-log semantic classes distinguish Poison/Bleed damage and hard-control status',()=>{
  const base={eventId:'E1',sequence:0,parentEventId:null,initiativeCycle:3,actorId:'H0',targetId:'G0'};
  assert.equal(combatLogClassForEvent({...base,type:EVENT_TYPE.DAMAGE,payload:{damageType:'POISON'}}),'combat poison');
  assert.equal(combatLogClassForEvent({...base,type:EVENT_TYPE.DAMAGE,payload:{damageType:'BLEED'}}),'combat bleed');
  assert.equal(combatLogClassForEvent({...base,type:EVENT_TYPE.STATUS_APPLY,payload:{key:'root'}}),'status control');
  assert.equal(combatLogClassForEvent({...base,type:EVENT_TYPE.STATUS_APPLY,payload:{key:'rend_def_down'}}),'status negative');
});

test('Backstab is now a pursuit basic-attack style with a one-cycle tell and three attempts',()=>{
  const a=getAbility('Rogue','BACKSTAB');
  assert.equal(a.actionKind,'BASIC_ATTACK');
  assert.equal(a.basicStyle.attacksSet,3);
  assert.equal(a.basicStyle.startupDelayCycles,1);
  assert.equal(a.basicStyle.firstSuccessfulHit.damageMultiplier,2.5);
  assert.equal(a.basicStyle.firstSuccessfulHit.stealthDamageMultiplier,3.75);
  assert.equal(a.basicStyle.firstSuccessfulHit.critBonus+a.basicStyle.firstSuccessfulHit.stealthCritBonus,.75);
  assert.equal(a.basicStyle.firstSuccessfulHit.defensePenetration,.35);
});
