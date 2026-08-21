import test from 'node:test';
import assert from 'node:assert/strict';
import { getAbility } from '../src/roster.js';

test('Power Surge buffs both ATK and SDM for five rounds',()=>{
  const a=getAbility('Electromancer','POWER_SURGE');
  const statuses=a.effects.filter(e=>e.type==='APPLY_STATUS');
  assert.deepEqual(statuses.map(e=>e.key).sort(),['atk_up','sdm_up']);
  assert.ok(statuses.every(e=>e.duration===5&&e.to==='ALL_ALLIES'));
});

test('Volley receives the requested additional 20% damage increase',()=>{
  const e=getAbility('Archer','VOLLEY').effects[0];
  assert.deepEqual([e.min,e.max],[132,240]);
});

test('Rend strips twenty percent ARM per successful hit and retains three-round stacking duration',()=>{
  const style=getAbility('Barbarian','REND').basicStyle;
  assert.equal(style.onHit.defenseShredPct,.20);
  assert.equal(style.onHit.duration,3);
});

test("Enid's Blessing heals each ally for 100-250 and still cleanses Poison",()=>{
  const a=getAbility('Cleric','ENIDS_BLESSING');
  const h=a.effects.find(e=>e.type==='HEAL');
  const c=a.effects.find(e=>e.type==='CLEANSE');
  assert.deepEqual([h.min,h.max,h.to],[100,250,'ALL_ALLIES']);
  assert.deepEqual(c.keys,['poison']);
});

test('Guardian Angel heals 100-175 and Divine Shield lasts only the current round',()=>{
  const a=getAbility('Cleric','GUARDIAN_ANGEL');
  const h=a.effects.find(e=>e.type==='HEAL');
  const s=a.effects.find(e=>e.type==='APPLY_STATUS'&&e.key==='divine_shield');
  assert.deepEqual([h.min,h.max],[100,175]);
  assert.equal(s.duration,1);
  assert.equal(s.data.pct,.60);
});
