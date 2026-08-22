import test from 'node:test';
import assert from 'node:assert/strict';
import { getArchetype } from '../src/index.js';

test('Stage 23.15 restores Barbarian range 3 and reduces Mystic counter kite to 2',()=>{
  const barb=getArchetype('Barbarian');
  assert.equal(barb.weapon.weaponRange,3);
  assert.equal(barb.weapon.preferredRange,3);
  const mystic=getArchetype('Mystic');
  assert.equal(mystic.weapon.weaponRange,999);
  assert.equal(mystic.weapon.counterMoveMax,2);
});

test('Stage 23.15 proc tuning emphasizes support/caster identities without uncapping multi-swing procs',()=>{
  const proc=id=>getArchetype(id).abilities.find(a=>a.id.endsWith('_ATTACK')).basicProc;
  assert.deepEqual({chance:proc('Cleric').roundChance,min:proc('Cleric').min,max:proc('Cleric').max}, {chance:.80,min:100,max:250});
  assert.equal(proc('Mage').roundChance,.30);
  assert.equal(proc('Mage').key,'stun');
  assert.equal(proc('Monk').roundChance,.85);
  assert.deepEqual({chance:proc('Necromancer').roundChance,min:proc('Necromancer').min,max:proc('Necromancer').max}, {chance:.80,min:75,max:200});
  assert.deepEqual({chance:proc('Electromancer').roundChance,min:proc('Electromancer').min,max:proc('Electromancer').max}, {chance:.80,min:50,max:175});
  for(const id of ['Cleric','Mage','Monk','Mystic','Necromancer','Paladin','Electromancer']) assert.equal(proc(id).maxPerRound,3,id);
});
