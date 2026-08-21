import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { CHAMPION_ANIMATION_MANIFESTS } from '../client/champion-animation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

test('Stage 24D Paladin keeps the existing 85-frame animation/timing contract', () => {
  const m = CHAMPION_ANIMATION_MANIFESTS.Paladin;
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

test('Stage 24D Paladin authored generator, runtime assets, and optional VFX sheets are present', () => {
  for (const rel of [
    'tools/paladin_stage24d_hd.py',
    'tools/validate_paladin_stage24d.py',
    'client/assets/champions/paladin.png',
    'client/assets/champions/paladin-preview.png',
    'client/assets/vfx/paladin-vfx-sheet.png',
    'client/assets/vfx/paladin-shield-bash.png',
    'client/assets/vfx/paladin-divine-shield.png',
    'client/assets/vfx/paladin-cleanse.png',
    'client/assets/vfx/paladin-sanctify-ground.png',
    'client/assets/vfx/paladin-judgment-beam.png',
    'docs/STAGE24D_PALADIN_VISUAL_UPDATE.md',
    'docs/concepts/stage24d-paladin-approved-sprite-source.png',
    'docs/concepts/stage24d-paladin-approved-vfx-source.png',
    'docs/concepts/stage24d-paladin-runtime-validation.png'
  ]) assert.equal(fs.existsSync(path.join(root, rel)), true, rel);
});

test('Stage 24D Paladin client presentation uses holy signature FX for key Paladin abilities', () => {
  const scene = fs.readFileSync(path.join(root, 'client/ros2-scene.js'), 'utf8');
  assert.match(scene, /spawnPaladinSignatureFx\(v,abilityId,targetId=null,targetPos=null\)/);
  assert.match(scene, /animatePaladinShieldBashAttack\(a,t,targetId=null\)/);
  assert.match(scene, /DIVINE_SHIELD/);
  assert.match(scene, /CLEANSE/);
  assert.match(scene, /SANCTIFY/);
  assert.match(scene, /JUDGMENT/);
  assert.match(scene, /vfx-paladin-bash/);
  assert.match(scene, /vfx-paladin-divine/);
  assert.match(scene, /vfx-paladin-cleanse/);
  assert.match(scene, /vfx-paladin-sanctify/);
  assert.match(scene, /vfx-paladin-judgment/);
});
