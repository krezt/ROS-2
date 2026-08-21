import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAMPION_ANIMATION_MANIFESTS } from '../client/champion-animation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

test('Stage 24D Electromancer keeps the existing 85-frame animation/timing contract', () => {
  const m = CHAMPION_ANIMATION_MANIFESTS.Electromancer;
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

test('Stage 24D Electromancer authored generator, runtime assets, and optional VFX sheets are present', () => {
  for (const rel of [
    'tools/electromancer_stage24d_hd.py',
    'client/assets/champions/electromancer.png',
    'client/assets/champions/electromancer-preview.png',
    'client/assets/vfx/electromancer-vfx-sheet.png',
    'client/assets/vfx/electromancer-lightning-slash.png',
    'client/assets/vfx/electromancer-electrical-storm.png',
    'client/assets/vfx/electromancer-god-tempest.png',
    'docs/STAGE24D_ELECTROMANCER_VISUAL_UPDATE.md'
  ]) assert.equal(fs.existsSync(path.join(root, rel)), true, rel);
});
