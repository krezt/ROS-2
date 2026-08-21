import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAMPION_ANIMATION_MANIFESTS } from '../client/champion-animation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

test('Stage 24D Necromancer keeps the existing 85-frame animation/timing contract', () => {
  const m = CHAMPION_ANIMATION_MANIFESTS.Necromancer;
  assert.equal(m.frameWidth, 80);
  assert.equal(m.frameHeight, 96);
  assert.equal(m.renderScale, 5/6);
  assert.deepEqual(m.hit, [72, 73, 74]);
  assert.deepEqual(m.ko, [75, 76, 77, 78, 79]);
  assert.deepEqual(m.resurrect, [80, 81, 82, 83, 84]);
  assert.equal(m.renderScale, 5/6);
  assert.equal(m.timing.attackImpactFrame, 3);
  assert.equal(m.timing.castReleaseFrame, 3);
  for (const dir of ['N', 'S', 'E', 'W']) {
    assert.equal(m.clips[dir].idle.length, 4);
    assert.equal(m.clips[dir].walk.length, 4);
    assert.equal(m.clips[dir].attack.length, 5);
    assert.equal(m.clips[dir].cast.length, 5);
  }
});

test('Stage 24D Necromancer authored generator, runtime assets, and optional VFX sheets are present', () => {
  for (const rel of [
    'tools/necromancer_stage24d_hd.py',
    'client/assets/champions/necromancer.png',
    'client/assets/champions/necromancer-preview.png',
    'client/assets/vfx/necromancer-vfx-sheet.png',
    'client/assets/vfx/necromancer-scythe-slash.png',
    'client/assets/vfx/necromancer-poison-cloud.png',
    'client/assets/vfx/necromancer-raise-dead.png',
    'docs/STAGE24D_NECROMANCER_VISUAL_UPDATE.md'
  ]) assert.equal(fs.existsSync(path.join(root, rel)), true, rel);
});
