import test from 'node:test';
import assert from 'node:assert/strict';
import {
  SIDE,
  getAbility,
  getArchetype,
  createRosterUnit
} from '../src/index.js';
import { abilityDetailModel } from '../src/client-foundation.js';

const proc=(id)=>getArchetype(id).abilities.find(a=>a.id.endsWith('_ATTACK')).basicProc;

test('Stage25AB passive proc chances are explicit per successful hit',()=>{
  const expected={
    Cleric:.15,
    Necromancer:.15,
    Mystic:.15,
    Electromancer:.30,
    Monk:.20,
    Paladin:.25,
    Mage:.06
  };
  for(const [id,chance] of Object.entries(expected)){
    assert.equal(proc(id).chance,chance,id);
    assert.equal(proc(id).roundChance,undefined,id);
    assert.equal(proc(id).referenceSwings,undefined,id);
    assert.equal(proc(id).maxPerRound,undefined,id);
  }
});

test('Stage25AB Barbarian and Rogue balance values match the requested tuning',()=>{
  const smash=getAbility('Barbarian','SMASH');
  assert.equal(smash.basicStyle.onHit.chance,.15);
  const rend=getAbility('Barbarian','REND');
  assert.equal(rend.basicStyle.onHit.defenseShredPct,.25);
  const poison=getAbility('Rogue','POISON_DAGGER');
  assert.equal(poison.effects[0].data.damageRatio,.85);
});

test('Stage25AB Shield Bash tooltip reports one proactive bash and two counter resources',()=>{
  const paladin=createRosterUnit({archetypeId:'Paladin',unitId:'H0',side:SIDE.A,draftSlot:0,position:{row:5,col:5}});
  const bash=getAbility('Paladin','SHIELD_BASH');
  const detail=abilityDetailModel(paladin,bash);
  assert.ok(detail.lines.some(line=>/^1 swing\b/.test(line)),detail.lines.join('\n'));
  assert.ok(detail.lines.some(line=>/2 remaining attack resources reserved for normal counters/.test(line)),detail.lines.join('\n'));
  assert.ok(detail.note.includes('one 350% weapon attack'));
});

test('Stage25AB tooltips expose new per-hit proc and on-hit tuning',()=>{
  const cases=[
    ['Cleric','CLERIC_ATTACK','15% per successful hit'],
    ['Necromancer','NECRO_ATTACK','15% per successful hit'],
    ['Mystic','MYSTIC_ATTACK','15% per successful hit'],
    ['Electromancer','ELECTRO_ATTACK','30% per successful hit'],
    ['Monk','MONK_ATTACK','20% per successful hit'],
    ['Paladin','PALADIN_ATTACK','25% per successful hit'],
    ['Mage','MAGE_ATTACK','6% per successful hit']
  ];
  for(const [id,abilityId,text] of cases){
    const actor=createRosterUnit({archetypeId:id,unitId:'H0',side:SIDE.A,draftSlot:0,position:{row:5,col:5}});
    const detail=abilityDetailModel(actor,getAbility(id,abilityId));
    assert.ok(detail.lines.some(line=>line.includes(text)),`${id}: ${detail.lines.join(' | ')}`);
  }
  const barbarian=createRosterUnit({archetypeId:'Barbarian',unitId:'H1',side:SIDE.A,draftSlot:0,position:{row:5,col:5}});
  const rendDetail=abilityDetailModel(barbarian,getAbility('Barbarian','REND'));
  assert.ok(rendDetail.lines.some(line=>line.includes('25% multiplicative DEF reduction')),rendDetail.lines.join(' | '));
  const smashDetail=abilityDetailModel(barbarian,getAbility('Barbarian','SMASH'));
  assert.ok(smashDetail.lines.some(line=>line.includes('stun (15%)')),smashDetail.lines.join(' | '));
  const rogue=createRosterUnit({archetypeId:'Rogue',unitId:'H2',side:SIDE.A,draftSlot:0,position:{row:5,col:5}});
  const poisonDetail=abilityDetailModel(rogue,getAbility('Rogue','POISON_DAGGER'));
  assert.ok(poisonDetail.lines.some(line=>line.includes('85% of hit damage')),poisonDetail.lines.join(' | '));
  assert.match(getAbility('Barbarian','SMASH').note,/15%/);
  assert.match(getAbility('Barbarian','REND').note,/25% DEF reduction/);
  assert.match(getAbility('Rogue','POISON_DAGGER').note,/85%/);
});
