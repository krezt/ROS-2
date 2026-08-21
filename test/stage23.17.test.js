import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { ROSTER, ROSTER_IDS } from '../src/roster.js';
import { validatePlaytestTeams, abilityDetailModel } from '../src/client-foundation.js';

function effect(classId, abilityId, type){
  const ability=ROSTER[classId].abilities.find(a=>a.id===abilityId);
  assert.ok(ability,`${classId}/${abilityId} exists`);
  const out=(ability.effects??[]).find(e=>e.type===type);
  assert.ok(out,`${classId}/${abilityId} has ${type}`);
  return out;
}

test('Stage 23.17 direct-damage spell pass raises the intended raw damage bands',()=>{
  assert.deepEqual([effect('Barbarian','WAR_CRY','DAMAGE').min,effect('Barbarian','WAR_CRY','DAMAGE').max],[70,90]);
  assert.deepEqual([effect('Cleric','PIERCING_LIGHT','AOE_DAMAGE').min,effect('Cleric','PIERCING_LIGHT','AOE_DAMAGE').max],[150,250]);
  assert.deepEqual([effect('Mage','METEOR','DAMAGE').min,effect('Mage','METEOR','DAMAGE').max],[130,190]);
  assert.deepEqual([effect('Mage','FIREBALL','AOE_DAMAGE').min,effect('Mage','FIREBALL','AOE_DAMAGE').max],[200,350]);
  assert.deepEqual([effect('Paladin','JUDGMENT','CONDITIONAL_DAMAGE').min,effect('Paladin','JUDGMENT','CONDITIONAL_DAMAGE').max],[200,300]);
  assert.deepEqual([effect('Necromancer','LIFE_DRAIN','LIFE_DRAIN').min,effect('Necromancer','LIFE_DRAIN','LIFE_DRAIN').max],[150,300]);
  assert.deepEqual([effect('Necromancer','POISON_BOLT','DAMAGE').min,effect('Necromancer','POISON_BOLT','DAMAGE').max],[150,200]);
  const storm=effect('Electromancer','ELECTRICAL_STORM','HYBRID_STORM');
  assert.deepEqual([storm.damage.min,storm.damage.max],[25,125]);
  assert.deepEqual([effect('Electromancer','CHAIN_LIGHTNING','CHAIN_LIGHTNING').min,effect('Electromancer','CHAIN_LIGHTNING','CHAIN_LIGHTNING').max],[190,290]);
});

test('percentage and control spells retain their rules while the requested Plague tuning is applied',()=>{
  assert.equal(effect('Necromancer','DEATH_TOUCH','CURRENT_HP_DAMAGE').fraction,.50);
  assert.deepEqual([effect('Necromancer','PLAGUE','POISON_FLAT_ROLL').min,effect('Necromancer','PLAGUE','POISON_FLAT_ROLL').max],[100,160]);
  assert.equal(effect('Mystic','MENTAL_BREAKDOWN','APPLY_STATUS').key,'spellbreak');
});

test('ability details automatically expose the new raw spell values',()=>{
  const mage={...structuredClone({stats:ROSTER.Mage.stats,statuses:[]})};
  const fireball=ROSTER.Mage.abilities.find(a=>a.id==='FIREBALL');
  const detail=abilityDetailModel(mage,fireball);
  assert.ok(detail.lines.some(line=>line.includes('200–350 magical damage')));
});

test('1P roster lab accepts any six unique roster archetypes and rejects duplicates',()=>{
  const chosen=ROSTER_IDS.slice(0,6);
  const ok=validatePlaytestTeams(chosen.slice(0,3),chosen.slice(3,6),ROSTER_IDS);
  assert.equal(ok.ok,true);
  const bad=validatePlaytestTeams([chosen[0],chosen[0],chosen[1]],chosen.slice(3,6),ROSTER_IDS);
  assert.equal(bad.ok,false);
  assert.match(bad.error,/duplicate/i);
});

test('browser client exposes the roster picker without replacing the compact command rail',()=>{
  const html=fs.readFileSync(new URL('../client/index.html',import.meta.url),'utf8');
  const css=fs.readFileSync(new URL('../client/styles.css',import.meta.url),'utf8');
  const main=fs.readFileSync(new URL('../client/main.js',import.meta.url),'utf8');
  assert.match(html,/id="rosterButton"/);
  assert.match(html,/id="rosterModal"/);
  assert.match(html,/id="teamA0"/);
  assert.match(html,/id="teamB2"/);
  assert.match(main,/configureSinglePlayerTeams/);
  assert.match(css,/\.roster-modal/);
});
