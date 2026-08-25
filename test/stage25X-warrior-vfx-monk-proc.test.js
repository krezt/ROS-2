import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EVENT_TYPE, SIDE, TARGET_TYPE,
  createBattleState, createHoldDeclaration, createRosterAbilityDeclaration,
  createRosterCombatScheduler, createRosterUnit, createRoundSimulation,
  getArchetype
} from '../src/index.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const source=path=>readFileSync(resolve(root,path),'utf8');

function pngSize(path){
  const b=readFileSync(resolve(root,path));
  assert.equal(b.toString('ascii',1,4),'PNG');
  return {width:b.readUInt32BE(16),height:b.readUInt32BE(20)};
}
function unit(archetypeId,unitId,side,pos){return createRosterUnit({archetypeId,unitId,side,draftSlot:0,position:pos});}
function hold(id){return createHoldDeclaration({declarationId:`H:${id}`,roundNumber:1,actorId:id});}
function attackDecl(archetypeId,actorId='H0',targetId='G0'){
  const attack=getArchetype(archetypeId).abilities.find(a=>a.actionKind==='BASIC_ATTACK'&&!a.basicStyle);
  return createRosterAbilityDeclaration({declarationId:`D:${actorId}`,roundNumber:1,actorId,archetypeId,abilityId:attack.id,target:{type:TARGET_TYPE.UNIT,unitId:targetId}});
}

test('Stage25X Warrior and Monk proc VFX assets are isolated runtime cuts and preloaded',()=>{
  const scene=source('client/ros2-scene.js');
  const assets=[
    ['vfx-warrior-power-strikes','client/assets/vfx/warrior-power-strikes-priority.png'],
    ['vfx-warrior-insult','client/assets/vfx/warrior-insult-cast.png'],
    ['vfx-warrior-shieldwall-redirect','client/assets/vfx/warrior-shieldwall-redirect.png'],
    ['vfx-warrior-warhorn-cast','client/assets/vfx/warrior-warhorn-cast.png'],
    ['vfx-warrior-shieldwall-cast','client/assets/vfx/warrior-shieldwall-cast.png'],
    ['vfx-warrior-warhorn-allies','client/assets/vfx/warrior-warhorn-allies.png'],
    ['vfx-warrior-dig-in','client/assets/vfx/warrior-dig-in.png'],
    ['vfx-monk-basic-proc','client/assets/vfx/monk-basic-proc.png']
  ];
  for(const [key,path] of assets){
    assert.ok(existsSync(resolve(root,path)),`${path} should exist`);
    assert.ok(statSync(resolve(root,path)).size>10000,`${path} should contain a real isolated VFX`);
    const {width,height}=pngSize(path);
    assert.ok(width>=280&&width<=340&&height>=280&&height<=340,`${path} should be a compact single-effect crop`);
    assert.match(scene,new RegExp(`this\\.load\\.image\\('${key}'`));
  }
});

test('Stage25X maps Warrior Warhorn, Insult, Shieldwall, Dig In and Power Strikes to approved image VFX',()=>{
  const scene=source('client/ros2-scene.js');
  assert.match(scene,/if\(id==='WARHORN'\)[\s\S]*vfx-warrior-warhorn-cast[\s\S]*delayedCall[\s\S]*vfx-warrior-warhorn-allies/);
  assert.match(scene,/if\(id==='INSULT'\)[\s\S]*vfx-warrior-insult[\s\S]*flipX:\(v\.facing\?\?'S'\)==='W'/);
  assert.match(scene,/if\(id==='SHIELDWALL'\)[\s\S]*vfx-warrior-shieldwall-cast/);
  assert.match(scene,/if\(id==='DIG_IN'\)[\s\S]*vfx-warrior-dig-in/);
  assert.match(scene,/if\(id==='POWER_STRIKE'\)[\s\S]*vfx-warrior-power-strikes/);
  assert.match(scene,/PRESENTATION_COMMAND\.INTERCEPT_CUE\]:run\(c=>this\.animateInterceptCue\(c\)\)/);
  assert.match(scene,/animateInterceptCue\(command\)[\s\S]*intendedTargetId[\s\S]*vfx-warrior-shieldwall-redirect/);
});

test('Stage25X Power Strikes priority VFX is guarded to the first ordinary movement/attack priority per Warrior replay',()=>{
  const scene=source('client/ros2-scene.js');
  assert.match(scene,/this\.powerStrikesPriorityFxShown=new Set\(\)/);
  assert.match(scene,/maybeShowPowerStrikesPriorityFx\(v,command\)[\s\S]*actionId!=='POWER_STRIKE'[\s\S]*kind==='COUNTER_MOVE'[\s\S]*attackReason==='COUNTER'/);
  assert.match(scene,/powerStrikesPriorityFxShown\.has\(command\.actorId\)[\s\S]*add\(command\.actorId\)[\s\S]*spawnWarriorSignatureFx\(v,'POWER_STRIKE'/);
  assert.match(scene,/animateMove\(command\)[\s\S]*maybeShowPowerStrikesPriorityFx\(v,command\)/);
  assert.match(scene,/animateAttack\(command\)[\s\S]*maybeShowPowerStrikesPriorityFx\(a,command\)/);
});

test('Stage25X preserves the existing Insult projectile while mirroring its cast portrait west',()=>{
  const scene=source('client/ros2-scene.js');
  assert.match(scene,/if\(ability==='INSULT'\)return this\.animateInsultWave\(a,b\)/);
  assert.match(scene,/vfx-warrior-insult[\s\S]*flipX:\(v\.facing\?\?'S'\)==='W'/);
  assert.match(scene,/pulseImageFx\(key,px,py,\{[\s\S]*flipX=false[\s\S]*setFlipX\(Boolean\(flipX\)\)/);
});

test('Stage25X Monk B1 fires from a successful MONK_ATTACK Opening proc',()=>{
  const scene=source('client/ros2-scene.js');
  assert.match(scene,/monkBasicProcFx[\s\S]*source\?\.unit\?\.archetypeId==='Monk'[\s\S]*raw==='atk_up'[\s\S]*ability==='MONK_ATTACK'[\s\S]*data\?\.proc===true/);
  assert.match(scene,/if\(monkBasicProcFx\)[\s\S]*'vfx-monk-basic-proc'/);

  let procEvent=null;
  for(let seed=1;seed<=300&&!procEvent;seed++){
    const monk=unit('Monk','H0',SIDE.A,{row:5,col:5});
    const foe=unit('Warrior','G0',SIDE.B,{row:5,col:6});
    foe.stats.QKN=-1000; foe.stats.maxHP=99999; foe.stats.hp=99999; foe.stats.DEF=0;
    const sim=createRoundSimulation({state:createBattleState({matchId:`MONK_PROC_VFX:${seed}`,units:[monk,foe]}),declarations:[attackDecl('Monk'),hold('G0')],seed});
    createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:500});
    procEvent=sim.events.snapshot().find(e=>e.type===EVENT_TYPE.STATUS_APPLY&&e.actorId==='H0'&&e.targetId==='H0'&&e.payload?.key==='atk_up'&&e.payload?.data?.proc===true)??null;
  }
  assert.ok(procEvent,'expected a deterministic successful Monk basic Opening proc');
});
