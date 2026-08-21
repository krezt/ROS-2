import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CHAMPION_ANIMATION_MANIFESTS } from '../client/champion-animation.js';

const root=new URL('../',import.meta.url);
const read=p=>fs.readFileSync(new URL(p,root),'utf8');
const exists=p=>fs.existsSync(new URL(p,root));

test('Stage 24D Monk uses exact 77-active-frame 80x96 contract',()=>{
  const m=CHAMPION_ANIMATION_MANIFESTS.Monk;
  assert.equal(m.frameWidth,80); assert.equal(m.frameHeight,96); assert.equal(m.sheetColumns,17); assert.equal(m.renderScale,1);
  for(const d of ['N','S','E','W']){
    assert.equal(m.clips[d].idle.length,1); assert.equal(m.clips[d].walk.length,4); assert.equal(m.clips[d].attack.length,5); assert.equal(m.clips[d].cast.length,5);
  }
  assert.deepEqual(m.hit,[68,69,70]);
  assert.deepEqual(m.ko,[71,72,73,74,75]);
  assert.deepEqual(m.resurrect,[76,77,78,79,80]);
  assert.deepEqual(m.palmHit,[81,82,83,84]);
  assert.equal(m.timing.attackImpactFrame,3); assert.equal(m.timing.castReleaseFrame,3);
  const populated=4*(1+4+5+5)+3+5+5+4; assert.equal(populated,77);
});

test('Stage 24D Monk generator, source, runtime, preview, validation, and docs are present',()=>{
  for(const p of ['tools/monk_stage24d_hd.py','docs/concepts/stage24d-monk-approved-sprite-source.png','client/assets/champions/monk.png','client/assets/champions/monk-preview.png','docs/concepts/stage24d-monk-runtime-validation.png','docs/concepts/stage24d-monk-warrior-scale-validation.png','docs/STAGE24D_MONK_VISUAL_UPDATE.md']) assert.ok(exists(p),p);
});

test('Stage 24D Monk Palm Hit presentation uses shared palm-hit clip without changing mechanics',()=>{
  const anim=read('client/champion-animation.js'); const scene=read('client/ros2-scene.js');
  assert.match(anim,/palmHit:monkContract/);
  assert.match(anim,/animationKey\(archetypeId,'palm-hit'\)/);
  assert.match(scene,/archetypeId==='Monk'&&actionId==='PALM_HIT'/);
  assert.match(scene,/animateMonkPalmHit/);
});
