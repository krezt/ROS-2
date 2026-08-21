import test from 'node:test';
import assert from 'node:assert/strict';
import { CHAMPION_ANIMATION_MANIFESTS } from '../client/champion-animation.js';

test('Stage 24J Barbarian-method Mystic uses native 80x96 frames at 1x with the compact 17-column runtime contract',()=>{
  const m=CHAMPION_ANIMATION_MANIFESTS.Mystic;
  assert.equal(m.frameWidth,80);
  assert.equal(m.frameHeight,96);
  assert.equal(m.sheetColumns,17);
  assert.equal(m.renderScale,1);
  assert.equal(m.timing.attackImpactFrame,3);
  assert.equal(m.timing.castReleaseFrame,3);
});

test('Stage 24D Archer, Cleric, Paladin, Necromancer, and Electromancer use larger 80x96 native frames scaled down to maintain gameplay footprint',()=>{
  for(const id of ['Archer','Cleric','Paladin','Necromancer','Electromancer']){
    const m=CHAMPION_ANIMATION_MANIFESTS[id];
    assert.equal(m.frameWidth,80);
    assert.equal(m.frameHeight,96);
    assert.equal(m.renderScale,5/6);
  }
});

test('Stage 24D Warrior, Barbarian, Mage, Shinobi, and Monk use 80x96 native frames with a fitted 1x battlefield footprint',()=>{
  for(const id of ['Warrior','Barbarian','Mage','Shinobi','Monk','Mystic']){
    const m=CHAMPION_ANIMATION_MANIFESTS[id];
    assert.equal(m.frameWidth,80);
    assert.equal(m.frameHeight,96);
    assert.equal(m.renderScale,1);
    assert.equal(m.timing.attackImpactFrame,3);
    assert.equal(m.timing.castReleaseFrame,3);
  }
});

test('legacy champions retain 32x40 frames rendered at 2x until upgraded',()=>{
  for(const [id,m] of Object.entries(CHAMPION_ANIMATION_MANIFESTS)){
    if(id==='Mystic'||id==='Mage'||id==='Shinobi'||id==='Archer'||id==='Cleric'||id==='Paladin'||id==='Necromancer'||id==='Electromancer'||id==='Barbarian'||id==='Warrior'||id==='Rogue'||id==='Monk')continue;
    assert.equal(m.frameWidth,32);
    assert.equal(m.frameHeight,40);
    assert.equal(m.renderScale,2);
  }
});
