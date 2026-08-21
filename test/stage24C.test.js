import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { commandsForEvent, PRESENTATION_COMMAND } from '../src/presentation.js';
import { EVENT_TYPE } from '../src/constants.js';

function ev(type,payload={},overrides={}){
  return {eventId:`E-${type}`,sequence:1,parentEventId:null,initiativeCycle:3,actorId:'H0',targetId:'G0',type,payload,...overrides};
}

test('Stage 24C delayed spells present charge at start and full cast at resolution handlers',()=>{
  const scene=fs.readFileSync(path.resolve('client/ros2-scene.js'),'utf8');
  assert.match(scene,/\[PRESENTATION_COMMAND\.CAST_CUE\]:run\(c=>this\.animateChargeStart\(c\)\)/);
  assert.match(scene,/\[PRESENTATION_COMMAND\.CAST_COMPLETE\]:run\(c=>this\.animateSpellResolution\(c\)\)/);
  assert.match(scene,/\[PRESENTATION_COMMAND\.SPELL_RESOLUTION\]:run\(c=>this\.animateSpellResolution\(c\)\)/);
  assert.match(scene,/Declaration gets only a restrained charging tell/);
  assert.match(scene,/setScale\(manifest\.renderScale\?\?2\.0\)/);
});

test('Stage 24C echoed spell resolution cast precedes its projectile',()=>{
  const cmds=commandsForEvent(ev(EVENT_TYPE.SPELL_RESOLUTION,{
    actionId:'FIREBALL',echoed:true,resolutionIndex:2,resolutionCount:2,
    casterPositionAtCompletion:{row:5,col:2},targetPositionAtCompletion:{row:5,col:10},areaShape:'SQUARE_4X4'
  }));
  assert.deepEqual(cmds.map(c=>c.type),[PRESENTATION_COMMAND.SPELL_RESOLUTION,PRESENTATION_COMMAND.SPELL_PROJECTILE]);
  assert.equal(cmds[1].payload.abilityId,'FIREBALL');
});

test('Stage 24C non-echo spell complete cast precedes projectile',()=>{
  const cmds=commandsForEvent(ev(EVENT_TYPE.CAST_COMPLETE,{
    resolutionCount:1,casterPositionAtCompletion:{row:5,col:2},targetPositionAtCompletion:{row:5,col:10},effectType:'DAMAGE',areaShape:'SINGLE'
  }));
  assert.deepEqual(cmds.map(c=>c.type),[PRESENTATION_COMMAND.CAST_COMPLETE,PRESENTATION_COMMAND.SPELL_PROJECTILE]);
});

test('Stage 24C ships first universal/signature VFX layer without gameplay authority',()=>{
  const scene=fs.readFileSync(path.resolve('client/ros2-scene.js'),'utf8');
  for(const fn of ['animateMagicProjectile','animateLightningArc','animateMeteor','animateAreaBurst','spawnImpactVfx','spawnStatusBurst'])assert.match(scene,new RegExp(`${fn}\\(`));
  assert.match(scene,/ability==='FIREBALL'/);
  assert.match(scene,/ability==='CHAIN_LIGHTNING'/);
  assert.match(scene,/ability==='PIERCING_LIGHT'/);
  assert.match(scene,/ability==='METEOR'/);
  const vfxSection=scene.slice(scene.indexOf('  animateMagicProjectile('),scene.indexOf('  flashUnit('));
  assert.doesNotMatch(vfxSection,/Math\.random|gameplaySeed|rng\./);
});

test('Stage 24C sprite generator emphasizes class weapon silhouettes',()=>{
  const src=fs.readFileSync(path.resolve('tools/generate-roster-sprites.py'),'utf8');
  assert.match(src,/'mage':\s*\{[\s\S]*?'weapon':'greatsword'/);
  assert.match(src,/'barbarian':\s*\{[\s\S]*?'weapon':'axe'/);
  assert.match(src,/'necromancer':\s*\{[\s\S]*?'weapon':'staff-skull-long'/);
  assert.match(src,/Short, bright blade with a dark hilt/);
  assert.match(src,/massive two-handed battlefield weapon/);
});
