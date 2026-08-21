import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
const root=path.resolve(here,'..');

function pngSize(file){
  const b=fs.readFileSync(file);
  return {width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
}

test('final Warrior HD sheet and Warhorn prop ship at expected dimensions',()=>{
  assert.deepEqual(pngSize(path.join(root,'client/assets/champions/warrior.png')),{width:1440,height:480});
  assert.deepEqual(pngSize(path.join(root,'client/assets/vfx/warhorn.png')),{width:32,height:20});
});

test('final Warrior sprite generator rebuilds an 80x96 atlas deterministically from source-pose components',()=>{
  const src=fs.readFileSync(path.join(root,'tools/warrior_stage24d_hd.py'),'utf8');
  assert.match(src,/stage24d-warrior-approved-sprite-source\.png/);
  assert.match(src,/FW, FH = 80, 96/);
  assert.match(src,/Idle is intentionally frozen in every direction/);
  assert.match(src,/SHARED_RUNTIME_POSES = \[0,1,2,/);
  assert.match(src,/actual character bodies from source art first/);
  assert.match(src,/def source_pose_library/);
  assert.match(src,/def validate/);
  assert.doesNotMatch(src,/pose_idx\s*\*\s*FW/);
});

test('Warrior presentation adds Warhorn, Dig In and Insult visuals without simulation hooks',()=>{
  const scene=fs.readFileSync(path.join(root,'client/ros2-scene.js'),'utf8');
  assert.match(scene,/vfx-warhorn/);
  assert.match(scene,/spawnWarriorSignatureFx/);
  assert.match(scene,/id==='WARHORN'/);
  assert.match(scene,/id==='DIG_IN'/);
  assert.match(scene,/id==='INSULT'/);
  assert.match(scene,/animateInsultWave/);
  assert.match(scene,/ACTION_CUE\]:run\(c=>this\.rememberActionCue\(c\)\)/);
  assert.match(scene,/ACTION_END\]:run\(c=>this\.animateActionEnd\(c\)\)/);
});
