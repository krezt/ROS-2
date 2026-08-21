import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  CHAMPION_ANIMATION_MANIFESTS,
  LARGE_HD_RENDER_SCALE,
  ROGUE_RENDER_SCALE,
  COMPACT_SHEET_COLUMNS
} from '../client/champion-animation.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '..');

test('Stage 24D Rogue uses the new 73-frame visual contract', () => {
  const m = CHAMPION_ANIMATION_MANIFESTS.Rogue;
  assert.equal(m.frameWidth, 80);
  assert.equal(m.frameHeight, 96);
  assert.equal(m.sheetColumns, COMPACT_SHEET_COLUMNS);
  assert.equal(COMPACT_SHEET_COLUMNS, 15);
  assert.equal(m.renderScale, ROGUE_RENDER_SCALE);
  assert.ok(Math.abs(m.renderScale - 1.048) < 1e-12);

  const expected = {
    N:{idle:[0],walk:[1,2,3,4],attack:[5,6,7,8,9],cast:[10,11,12,13,14]},
    S:{idle:[15],walk:[16,17,18,19],attack:[20,21,22,23,24],cast:[25,26,27,28,29]},
    E:{idle:[30],walk:[31,32,33,34],attack:[35,36,37,38,39],cast:[40,41,42,43,44]},
    W:{idle:[45],walk:[46,47,48,49],attack:[50,51,52,53,54],cast:[55,56,57,58,59]},
  };
  for (const dir of ['N','S','E','W']) {
    assert.deepEqual(m.clips[dir].idle, expected[dir].idle);
    assert.deepEqual(m.clips[dir].walk, expected[dir].walk);
    assert.deepEqual(m.clips[dir].attack, expected[dir].attack);
    assert.deepEqual(m.clips[dir].cast, expected[dir].cast);
  }
  assert.deepEqual(m.hit, [60, 61, 62]);
  assert.deepEqual(m.ko, [63, 64, 65, 66, 67]);
  assert.deepEqual(m.resurrect, [68, 69, 70, 71, 72]);
  assert.equal(m.timing.attackImpactFrame, 3);
  assert.equal(m.timing.castReleaseFrame, 3);

  const active = [
    ...Object.values(m.clips).flatMap(d=>[...d.idle,...d.walk,...d.attack,...d.cast]),
    ...m.hit, ...m.ko, ...m.resurrect
  ];
  assert.equal(active.length, 73);
  assert.equal(new Set(active).size, 73);
  assert.deepEqual(active, Array.from({length:73},(_,i)=>i));
});

test('Stage 24D Rogue uses attacker-aware shared hit mirroring and W-facing shared mirroring', () => {
  const scene = fs.readFileSync(path.join(root, 'client/ros2-scene.js'), 'utf8');
  assert.match(scene, /\['Barbarian','Electromancer','Cleric','Rogue','Mage','Shinobi'\]\.includes\(v\?\.unit\?\.archetypeId\) && direction==='W'/);
  assert.match(scene, /\['Barbarian','Electromancer','Cleric','Rogue','Mage','Shinobi'\]\.includes\(v\.unit\?\.archetypeId\)/);
  assert.match(scene, /shouldMirrorHit=dc<0\|\|\(dc===0&&v\.facing==='W'\)/);
});

test('Stage 24D Rogue generator, validator, runtime assets, preview, source, and docs are present', () => {
  for (const rel of [
    'tools/rogue_stage24d_hd.py',
    'tools/validate_rogue_stage24d.py',
    'client/assets/champions/rogue.png',
    'client/assets/champions/rogue-preview.png',
    'docs/STAGE24D_ROGUE_VISUAL_UPDATE.md',
    'docs/concepts/stage24d-rogue-approved-sprite-source.png',
    'docs/concepts/stage24d-rogue-runtime-validation.png'
  ]) assert.equal(fs.existsSync(path.join(root, rel)), true, rel);

  assert.equal(fs.existsSync(path.join(root, 'docs/concepts/stage24d-rogue-approved-sprite-source-original.png')), false,
    'The superseded Rogue source must not ship as part of this clean-slate asset pipeline.');
});
