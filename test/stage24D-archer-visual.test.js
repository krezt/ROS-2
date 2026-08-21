import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAMPION_ANIMATION_MANIFESTS } from '../client/champion-animation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

test('Stage 24D Archer keeps the existing 85-frame animation/timing contract', () => {
  const m = CHAMPION_ANIMATION_MANIFESTS.Archer;
  assert.equal(m.frameWidth, 80);
  assert.equal(m.frameHeight, 96);
  assert.equal(m.renderScale, 5/6);
  assert.deepEqual(m.hit, [72, 73, 74]);
  assert.deepEqual(m.ko, [75, 76, 77, 78, 79]);
  assert.deepEqual(m.resurrect, [80, 81, 82, 83, 84]);
  assert.equal(m.timing.attackImpactFrame, 3);
  assert.equal(m.timing.castReleaseFrame, 3);
  for (const dir of ['N', 'S', 'E', 'W']) {
    assert.equal(m.clips[dir].idle.length, 4);
    assert.equal(m.clips[dir].walk.length, 4);
    assert.equal(m.clips[dir].attack.length, 5);
    assert.equal(m.clips[dir].cast.length, 5);
  }
});

test('Stage 24D Archer authored generator, runtime assets, and optional VFX sheets are present', () => {
  for (const rel of [
    'tools/archer_stage24d_hd.py',
    'client/assets/champions/archer.png',
    'client/assets/champions/archer-preview.png',
    'client/assets/vfx/archer-vfx-sheet.png',
    'client/assets/vfx/archer-arrow-shot.png',
    'client/assets/vfx/archer-arrow-projectile.png',
    'client/assets/vfx/archer-hunters-mark.png',
    'client/assets/vfx/archer-volley-rain.png',
    'docs/STAGE24D_ARCHER_VISUAL_UPDATE.md',
    'docs/concepts/stage24d-archer-approved-sprite-source.png',
    'docs/concepts/stage24d-archer-approved-vfx-source.png'
  ]) assert.equal(fs.existsSync(path.join(root, rel)), true, rel);
});


test('Stage 24D Archer client presentation uses ranged projectile and Archer-only signature FX', () => {
  const scene=fs.readFileSync(path.join(root,'client/ros2-scene.js'),'utf8');
  assert.match(scene,/if\(a\.unit\?\.archetypeId==='Archer'\)return this\.animateArcherAttack\(a,t\)/);
  assert.match(scene,/animateArcherAttack\(a,t\)/);
  assert.match(scene,/spawnArcherSignatureFx\(v,abilityId,targetId=null,targetPos=null\)/);
  assert.match(scene,/this\.spawnArcherSignatureFx\(v,abilityId,command\.targetId,target\)/);
  assert.match(scene,/vfx-archer-arrow/);
  assert.match(scene,/vfx-archer-mark/);
});
