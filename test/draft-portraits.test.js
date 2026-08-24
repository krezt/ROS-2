import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');
const champions=['Archer','Barbarian','Cleric','Electromancer','Mage','Monk','Mystic','Necromancer','Paladin','Rogue','Shinobi','Warrior'];

test('draft portrait bundle contains every roster champion',async()=>{
  for(const champion of champions){
    const file=path.join(root,'client','assets','draft_portraits',`${champion}.png`);
    const info=await stat(file);
    assert.ok(info.isFile(),`${champion} portrait should be a file`);
    assert.ok(info.size>1000,`${champion} portrait should contain image data`);
  }
});

test('local and network draft rendering use portrait-aware helpers',async()=>{
  const main=await readFile(path.join(root,'client','main.js'),'utf8');
  const css=await readFile(path.join(root,'client','styles.css'),'utf8');
  assert.match(main,/function createDraftOption\(/);
  assert.match(main,/function pickChip\(/);
  assert.match(main,/assets\/draft_portraits/);
  assert.match(css,/\.draft-option-portrait/);
  assert.match(css,/\.draft-chip-portrait/);
});
