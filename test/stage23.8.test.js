import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { SIDE, createRosterUnit, playerFacingCombatStats, unitHudModel } from '../src/index.js';

function unit(archetypeId='Rogue'){return createRosterUnit({archetypeId,unitId:'H0',side:SIDE.A,draftSlot:0,position:{row:3,col:1}});}

test('player-facing ATK is expressed as a basic weapon damage percentage rather than an opaque raw number',()=>{
  const r=unit('Rogue');
  r.stats.ATK=132;
  const p=playerFacingCombatStats(r);
  assert.equal(p.attackPct,132);
  assert.equal(unitHudModel(r).playerStats.attackPct,132);
});

test('player-facing armor is now the direct physical mitigation percentage',()=>{
  const r=unit('Rogue');
  r.stats.DEF=34;
  const p=playerFacingCombatStats(r);
  assert.equal(p.armorMitigationPct,34);
});

test('player-facing Spell Power is a direct magical/healing multiplier percentage',()=>{
  const m=unit('Mage');
  m.stats.SDM=20;
  const p=playerFacingCombatStats(m);
  assert.equal(p.spellPowerPct,20);
});

test('combat log remains outside the command aside and may live beneath the battlefield',()=>{
  const html=fs.readFileSync(new URL('../client/index.html',import.meta.url),'utf8');
  const asideStart=html.indexOf('<aside>'),asideClose=html.indexOf('</aside>');
  const log=html.indexOf('id="logPanel"');
  assert.ok(asideStart>=0&&asideClose>asideStart&&log>=0&&!(log>asideStart&&log<asideClose));
  assert.match(html,/class="battle-column"/);
  assert.match(html,/class="round-separator">—<\/span>/);
  assert.doesNotMatch(html,/purple marker = control impaired/);
});

test('Stage 23.8 stylesheet defines desktop and Chromebook log placements while the inspector remains compact',()=>{
  const css=fs.readFileSync(new URL('../client/styles.css',import.meta.url),'utf8');
  assert.match(css,/grid-template-areas:"battle rail" "battle log"/);
  assert.match(css,/grid-template-areas:"battle rail" "log rail"/);
  assert.match(css,/grid-template-columns:repeat\([67],minmax\(0,1fr\)\)/);
});
