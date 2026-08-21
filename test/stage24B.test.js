import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  CHAMPION_ANIMATION_IDS,
  CHAMPION_ANIMATION_MANIFESTS,
  WARRIOR_ANIMATION_MANIFEST,
  animationKey,
  directionFromCells,
  directionFromDelta
} from '../client/champion-animation.js';

test('Stage 24D preserves the full animation contract while allowing per-champion native frame sizes',()=>{
  assert.equal(CHAMPION_ANIMATION_IDS.length,12);
  for(const archetypeId of CHAMPION_ANIMATION_IDS){
    const manifest=CHAMPION_ANIMATION_MANIFESTS[archetypeId];
    assert.ok(manifest,`${archetypeId} manifest missing`);
    for(const dir of ['N','S','E','W']){
      assert.equal(manifest.clips[dir].idle.length,['Rogue','Mage','Shinobi','Barbarian','Monk','Mystic'].includes(archetypeId)?1:4,`${archetypeId} idle contract`);
      assert.equal(manifest.clips[dir].walk.length,4,`${archetypeId} walk contract`);
      assert.equal(manifest.clips[dir].attack.length,5,`${archetypeId} attack contract`);
      assert.equal(manifest.clips[dir].cast.length,5,`${archetypeId} cast contract`);
    }
    assert.equal(manifest.hit.length,3);
    assert.equal(manifest.ko.length,5);
    assert.equal(manifest.resurrect.length,5);
    const asset=path.resolve('client',manifest.assetPath);
    assert.ok(fs.existsSync(asset),`${archetypeId} spritesheet must ship with build.`);
    assert.ok(fs.statSync(asset).size>500,`${archetypeId} spritesheet must be non-empty.`);
    const png=fs.readFileSync(asset);
    assert.equal(png.readUInt32BE(16),(manifest.sheetColumns??18)*manifest.frameWidth,`${archetypeId} spritesheet width must match its manifest column contract.`);
    assert.equal(png.readUInt32BE(20),5*manifest.frameHeight,`${archetypeId} spritesheet height must match its 5-row frame contract.`);
  }
  assert.equal(WARRIOR_ANIMATION_MANIFEST.timing.attackImpactFrame,3);
  assert.equal(WARRIOR_ANIMATION_MANIFEST.timing.castReleaseFrame,3);
});

test('Stage 24B facing remains presentation-only and deterministic from geometry',()=>{
  assert.equal(directionFromDelta(4,1),'E');
  assert.equal(directionFromDelta(-4,1),'W');
  assert.equal(directionFromDelta(1,-4),'N');
  assert.equal(directionFromDelta(1,4),'S');
  assert.equal(directionFromCells({row:4,col:4},{row:4,col:7}),'E');
  assert.equal(animationKey('Mage','attack','W'),'mage-attack-W');
});

test('Stage 24B scene preloads the full roster, enlarges sprites, softens selection rings, and hides battlefield ids',()=>{
  const scene=fs.readFileSync(path.resolve('client/ros2-scene.js'),'utf8');
  assert.match(scene,/for\(const archetypeId of CHAMPION_ANIMATION_IDS\)\{/);
  assert.match(scene,/for\(const archetypeId of CHAMPION_ANIMATION_IDS\)registerChampionAnimations\(this,archetypeId\)/);
  assert.match(scene,/setStrokeStyle\(3,0x8fd4ff,.26\)/);
  assert.match(scene,/setScale\(manifest\.renderScale\?\?2\.0\)/);
  assert.match(scene,/const id=this\.add\.text\([^\n]+unit\.unitId[^\n]+\)\.setOrigin\(\.5\)\.setVisible\(false\)/);
});

test('Stage 24B browser chrome identifies the full-roster build',()=>{
  const html=fs.readFileSync(path.resolve('client/index.html'),'utf8');
  const main=fs.readFileSync(path.resolve('client/main.js'),'utf8');
  assert.match(html,/Stage 24[BCD]/);
  assert.match(html,/(Full Roster Pixel Animation Pass|Resolution-Timed Spell VFX \+ Sprite Polish|Mystic Visual Update|Mystic \+ Warrior Visual Update)/);
  assert.doesNotMatch(html,/Warrior Pixel Animation Prototype/);
  assert.match(main,/Stage 24[BCD] client/);
});

test('Stage 24B presentation stays non-authoritative',()=>{
  const animationSource=fs.readFileSync(path.resolve('client/champion-animation.js'),'utf8');
  assert.doesNotMatch(animationSource,/Math\.random|gameplaySeed|rng\./);
  assert.doesNotMatch(animationSource,/stats\.hp\s*[+\-*\/]?=/);
  assert.doesNotMatch(animationSource,/statuses\s*[+\-*\/]?=/);
});
