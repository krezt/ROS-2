import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { abilityDetailModel, createRosterUnit, getAbility, SIDE } from '../src/index.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=path=>readFileSync(resolve(root,path),'utf8');

function pngSize(path){
  const b=readFileSync(resolve(root,path));
  assert.equal(b.toString('ascii',1,4),'PNG');
  return {width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
}

test('Stage25W Monk VFX assets are isolated runtime images and preloaded',()=>{
  const scene=source('client/ros2-scene.js');
  const assets=[
    ['vfx-monk-palm','client/assets/vfx/monk-palm-strike.png'],
    ['vfx-monk-flurry','client/assets/vfx/monk-flurry.png'],
    ['vfx-monk-chi-wave','client/assets/vfx/monk-chi-wave.png'],
    ['vfx-monk-counterstance','client/assets/vfx/monk-counterstance.png'],
    ['vfx-monk-second-wind','client/assets/vfx/monk-second-wind.png']
  ];
  for(const [key,path] of assets){
    assert.ok(existsSync(resolve(root,path)),`${path} should exist`);
    assert.ok(statSync(resolve(root,path)).size>10000,`${path} should contain a real cut VFX asset`);
    const {width,height}=pngSize(path);
    assert.ok(width>=250&&width<=330&&height>=250&&height<=330,`${path} should remain a clean, compact single-cell crop`);
    assert.match(scene,new RegExp(`this\\.load\\.image\\('${key}'`));
  }
});

test('Stage25W maps the approved Monk VFX to Palm Hits, Flurry, Chi Wave, Counterstance and Second Wind',()=>{
  const scene=source('client/ros2-scene.js');
  assert.match(scene,/if\(id==='PALM_HIT'\)[\s\S]*'vfx-monk-palm'/);
  assert.match(scene,/if\(id==='FLURRY'\)[\s\S]*'vfx-monk-flurry'/);
  assert.match(scene,/if\(id==='CHI_WAVE'\)[\s\S]*ally\?\.unit\?\.side!==v\.unit\.side[\s\S]*'vfx-monk-chi-wave'/);
  assert.match(scene,/if\(id==='COUNTERSTANCE'\)[\s\S]*'vfx-monk-counterstance'/);
  assert.match(scene,/if\(id==='SECOND_WIND'\)[\s\S]*'vfx-monk-second-wind'/);
  assert.match(scene,/animateMonkPalmHit\(a,t\)\{\s*this\.spawnMonkSignatureFx\(a,'PALM_HIT'/);
  assert.match(scene,/\['FLURRY','COUNTERSTANCE','SECOND_WIND'\]\.includes\(abilityId\)[\s\S]*spawnMonkSignatureFx/);
  assert.match(scene,/spawnMysticSignatureFx[\s\S]*spawnMonkSignatureFx[\s\S]*spawnMageSignatureFx/);
});

test('Stage25W Second Wind restores 20% max HP per round for 3 rounds',()=>{
  const ability=getAbility('Monk','SECOND_WIND');
  const regen=ability.effects.find(e=>e.type==='APPLY_STATUS'&&e.key==='regen');
  assert.equal(regen.duration,3);
  assert.equal(regen.data?.pct,.20);
  const monk=createRosterUnit({archetypeId:'Monk',unitId:'H0',side:SIDE.A,draftSlot:0,position:{row:2,col:2}});
  const detail=abilityDetailModel(monk,ability);
  assert.ok(detail.lines.includes('Regen 360 HP/round (20% max HP) • 3 rounds'));
  assert.match(detail.note,/20%.*360 HP\/round/);
});
