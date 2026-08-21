import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAMPION_ANIMATION_MANIFESTS } from '../client/champion-animation.js';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');

test('Stage 24D Shinobi keeps the new 73-frame 80x96 animation/timing contract',()=>{
  const m=CHAMPION_ANIMATION_MANIFESTS.Shinobi;
  assert.equal(m.frameWidth,80);
  assert.equal(m.frameHeight,96);
  assert.equal(m.renderScale,1);
  assert.equal(m.sheetColumns,15);
  assert.deepEqual(m.hit,[60,61,62]);
  assert.deepEqual(m.ko,[63,64,65,66,67]);
  assert.deepEqual(m.resurrect,[68,69,70,71,72]);
  assert.equal(m.timing.attackImpactFrame,3);
  assert.equal(m.timing.castReleaseFrame,3);
  for(const dir of ['N','S','E','W']){
    assert.equal(m.clips[dir].idle.length,1);
    assert.equal(m.clips[dir].walk.length,4);
    assert.equal(m.clips[dir].attack.length,5);
    assert.equal(m.clips[dir].cast.length,5);
  }
});

test('Stage 24D Shinobi shared-state mirroring is enabled where needed',()=>{
  const scene=fs.readFileSync(path.join(root,'client/ros2-scene.js'),'utf8');
  assert.match(scene,/\['Barbarian','Electromancer','Cleric','Rogue','Mage','Shinobi'\]\.includes\(v\?\.unit\?\.archetypeId\) && direction==='W'/);
  assert.match(scene,/\['Barbarian','Electromancer','Cleric','Rogue','Mage','Shinobi'\]\.includes\(v\.unit\?\.archetypeId\)/);
});

test('Stage 24D Shinobi authored generator and runtime assets are present',()=>{
  for(const rel of [
    'tools/shinobi_stage24d_hd.py',
    'client/assets/champions/shinobi.png',
    'client/assets/champions/shinobi-preview.png',
    'docs/STAGE24D_SHINOBI_VISUAL_UPDATE.md',
    'docs/concepts/stage24d-shinobi-approved-sprite-source.png',
    'docs/concepts/stage24d-shinobi-runtime-validation.png',
    'docs/concepts/stage24d-shinobi-warrior-scale-validation.png',
    'docs/concepts/stage24d-shinobi-mage-scale-validation.png'
  ]) assert.equal(fs.existsSync(path.join(root,rel)),true,rel);
});
