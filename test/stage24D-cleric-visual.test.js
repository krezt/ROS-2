import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAMPION_ANIMATION_MANIFESTS } from '../client/champion-animation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

test('Stage 24D Cleric keeps the existing 85-frame animation/timing contract', () => {
  const m = CHAMPION_ANIMATION_MANIFESTS.Cleric;
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

test('Stage 24D Cleric authored generator, runtime assets, and optional VFX sheets are present', () => {
  for (const rel of [
    'tools/cleric_stage24d_hd.py',
    'client/assets/champions/cleric.png',
    'client/assets/champions/cleric-preview.png',
    'client/assets/vfx/cleric-vfx-sheet.png',
    'client/assets/vfx/cleric-defensive-aura.png',
    'client/assets/vfx/cleric-guardian-angel.png',
    'client/assets/vfx/cleric-piercing-light.png',
    'client/assets/vfx/cleric-enids-blessing.png',
    'client/assets/vfx/cleric-resurrection.png',
    'docs/STAGE24D_CLERIC_VISUAL_UPDATE.md',
    'docs/concepts/stage24d-cleric-approved-sprite-source.png',
    'docs/concepts/stage24d-cleric-approved-vfx-source.png'
  ]) assert.equal(fs.existsSync(path.join(root, rel)), true, rel);
});

test('Stage 24D Cleric client presentation uses holy signature FX for key support spells', () => {
  const scene = fs.readFileSync(path.join(root, 'client/ros2-scene.js'), 'utf8');
  assert.match(scene, /spawnClericSignatureFx\(v,abilityId,targetId=null,targetPos=null\)/);
  assert.match(scene, /DEFENSIVE_AURA/);
  assert.match(scene, /GUARDIAN_ANGEL/);
  assert.match(scene, /ENIDS_BLESSING/);
  assert.match(scene, /RESURRECTION/);
  assert.match(scene, /PIERCING_LIGHT/);
  assert.match(scene, /vfx-cleric-aura/);
  assert.match(scene, /vfx-cleric-angel/);
  assert.match(scene, /vfx-cleric-blessing/);
  assert.match(scene, /vfx-cleric-resurrection/);
});
