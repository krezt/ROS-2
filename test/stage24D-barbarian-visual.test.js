import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAMPION_ANIMATION_MANIFESTS, BARBARIAN_SHEET_COLUMNS } from '../client/champion-animation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

test('Stage 24D Barbarian keeps the 77-active-frame projectile animation/timing contract with frozen idle', () => {
  const m = CHAMPION_ANIMATION_MANIFESTS.Barbarian;
  assert.equal(m.frameWidth, 80);
  assert.equal(m.frameHeight, 96);
  assert.equal(m.renderScale, 1);
  assert.equal(m.sheetColumns, BARBARIAN_SHEET_COLUMNS);
  assert.deepEqual(m.hit, [68, 69, 70]);
  assert.deepEqual(m.ko, [71, 72, 73, 74, 75]);
  assert.deepEqual(m.resurrect, [76, 77, 78, 79, 80]);
  assert.deepEqual(m.projectile, [81, 82, 83, 84]);
  assert.equal(m.timing.attackImpactFrame, 3);
  assert.equal(m.timing.castReleaseFrame, 3);
  for (const dir of ['N', 'S', 'E', 'W']) {
    assert.equal(m.clips[dir].idle.length, 1);
    assert.equal(m.clips[dir].walk.length, 4);
    assert.equal(m.clips[dir].attack.length, 5);
    assert.equal(m.clips[dir].cast.length, 5);
  }
});

test('Stage 24D Barbarian generator, runtime assets, preview, projectile VFX, and docs are present', () => {
  for (const rel of [
    'tools/barbarian_stage24d_hd.py',
    'client/assets/champions/barbarian.png',
    'client/assets/champions/barbarian-preview.png',
    'client/assets/vfx/barbarian-axe-projectile.png',
    'docs/STAGE24D_BARBARIAN_VISUAL_UPDATE.md',
    'docs/concepts/stage24d-barbarian-approved-sprite-source.png',
    'docs/concepts/stage24d-barbarian-runtime-validation.png',
    'docs/concepts/stage24d-barbarian-warrior-scale-validation.png'
  ]) assert.equal(fs.existsSync(path.join(root, rel)), true, rel);
});

test('Stage 24D Barbarian uses the throwing-axe projectile attack presentation',()=>{
  const scene = fs.readFileSync(path.join(root,'client/ros2-scene.js'),'utf8');
  assert.match(scene,/load\.spritesheet\('vfx-barbarian-axe','assets\/vfx\/barbarian-axe-projectile\.png',\{frameWidth:80,frameHeight:96\}\)/);
  assert.match(scene,/if\(a\.unit\?\.archetypeId==='Barbarian'\)return this\.animateBarbarianAttack\(a,t\);/);
  assert.match(scene,/animateBarbarianAttack\(a,t\)\{/);
  assert.match(scene,/barbarian-axe-spin/);
});


test('Stage 24D Barbarian shared-state mirroring remains enabled where required',()=>{
  const scene = fs.readFileSync(path.join(root,'client/ros2-scene.js'),'utf8');
  assert.match(scene,/\['Barbarian','Electromancer','Cleric','Rogue','Mage','Shinobi'\]\.includes\(v\?\.unit\?\.archetypeId\) && direction==='W'/);
  assert.match(scene,/\['Barbarian','Electromancer','Cleric','Rogue','Mage','Shinobi'\]\.includes\(v\.unit\?\.archetypeId\)/);
});
