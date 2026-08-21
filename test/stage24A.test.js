import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  WARRIOR_ANIMATION_MANIFEST,
  animationKey,
  directionFromCells,
  directionFromDelta
} from '../client/champion-animation.js';

test('Stage 24A Warrior animation contract has four directional core clips',()=>{
  for(const dir of ['N','S','E','W']){
    assert.equal(WARRIOR_ANIMATION_MANIFEST.clips[dir].idle.length,4);
    assert.equal(WARRIOR_ANIMATION_MANIFEST.clips[dir].walk.length,4);
    assert.equal(WARRIOR_ANIMATION_MANIFEST.clips[dir].attack.length,5);
    assert.equal(WARRIOR_ANIMATION_MANIFEST.clips[dir].cast.length,5);
  }
  assert.equal(WARRIOR_ANIMATION_MANIFEST.hit.length,3);
  assert.equal(WARRIOR_ANIMATION_MANIFEST.ko.length,5);
  assert.equal(WARRIOR_ANIMATION_MANIFEST.resurrect.length,5);
  assert.equal(WARRIOR_ANIMATION_MANIFEST.timing.attackImpactFrame,3);
  assert.equal(WARRIOR_ANIMATION_MANIFEST.timing.castReleaseFrame,3);
});

test('Stage 24A facing remains presentation-only and deterministic from geometry',()=>{
  assert.equal(directionFromDelta(4,1),'E');
  assert.equal(directionFromDelta(-4,1),'W');
  assert.equal(directionFromDelta(1,-4),'N');
  assert.equal(directionFromDelta(1,4),'S');
  assert.equal(directionFromCells({row:4,col:4},{row:4,col:7}),'E');
  assert.equal(animationKey('Warrior','attack','W'),'warrior-attack-W');
});

test('Stage 24A/24D ships the current Warrior spritesheet and scene preload bridge',()=>{
  const asset=path.resolve('client/assets/champions/warrior.png');
  assert.ok(fs.existsSync(asset),'Warrior spritesheet must ship with build.');
  assert.ok(fs.statSync(asset).size>500,'Warrior spritesheet must be non-empty.');
  const png=fs.readFileSync(asset);
  assert.equal(png.readUInt32BE(16),1440,'Stage 24D Warrior spritesheet width must match 18×80 frames.');
  assert.equal(png.readUInt32BE(20),480,'Stage 24D Warrior spritesheet height must match 5×96 rows.');
  const scene=fs.readFileSync(path.resolve('client/ros2-scene.js'),'utf8');
  assert.match(scene,/load\.spritesheet\(m\.textureKey,m\.assetPath/);
  assert.match(scene,/registerChampionAnimations\(this,archetypeId\)/);
  assert.match(scene,/PRESENTATION_COMMAND\.ATTACK_CUE.*animateAttack/s);
  assert.match(scene,/PRESENTATION_COMMAND\.CAST_CUE.*animateCast/s);
});

test('Stage 24A presentation stays non-authoritative',()=>{
  const animationSource=fs.readFileSync(path.resolve('client/champion-animation.js'),'utf8');
  assert.doesNotMatch(animationSource,/Math\.random|gameplaySeed|rng\./);
  assert.doesNotMatch(animationSource,/stats\.hp\s*[+\-*/]?=/);
  assert.doesNotMatch(animationSource,/statuses\s*[+\-*/]?=/);
});
