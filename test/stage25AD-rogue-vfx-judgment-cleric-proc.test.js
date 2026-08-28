import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import {
  SIDE,
  createBattleState,
  createHoldDeclaration,
  createRoundSimulation,
  createRosterUnit,
  getAbility,
  resolveRosterEffects,
  EVENT_TYPE
} from '../src/index.js';

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');

function unit(archetypeId, unitId, side, position, slot=0){
  return createRosterUnit({archetypeId, unitId, side, draftSlot:slot, position});
}
function hold(actorId, roundNumber=1){
  return createHoldDeclaration({declarationId:`H:${roundNumber}:${actorId}`, roundNumber, actorId});
}

function damageTotalForJudgment({afflicted=false, seed=11}={}){
  const paladin=unit('Paladin','H0',SIDE.A,{row:5,col:4});
  const target=unit('Warrior','G0',SIDE.B,{row:5,col:8});
  paladin.stats.SDM=100;
  target.stats.RES=0;
  target.stats.hp=target.stats.maxHP=99999;
  if(afflicted){
    target.statuses.push({key:'poison',duration:2,sourceId:'H0',data:{contributions:[{amount:25}]}});
  }
  const sim=createRoundSimulation({
    state:createBattleState({matchId:`JUDGMENT-${afflicted?'AFFLICTED':'PLAIN'}`,units:[paladin,target]}),
    declarations:[hold('H0'),hold('G0')],
    seed
  });
  resolveRosterEffects(sim,{actorId:'H0',ability:getAbility('Paladin','JUDGMENT'),validity:{target:sim.state.units.G0},cycle:0});
  return sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.targetId==='G0'&&e.payload?.abilityId==='JUDGMENT').reduce((n,e)=>n+Number(e.payload?.amount??0),0);
}

test('Stage 25AD Rogue VFX assets exist and scene wires every requested cue',()=>{
  const vfxRoot=path.join(ROOT,'client/assets/vfx');
  for(const file of [
    'rogue-vfx-sheet.png',
    'rogue-poison-dagger-hit.png',
    'rogue-expose.png',
    'rogue-smoke-bomb-cast.png',
    'rogue-smoke-bomb-blind.png',
    'rogue-poison-imbue.png',
    'rogue-backstab-hit.png',
    'rogue-shadowstep.png',
    'rogue-poison-tick.png'
  ]){
    assert.equal(fs.existsSync(path.join(vfxRoot,file)), true, file);
  }
  const scene=fs.readFileSync(path.join(ROOT,'client/ros2-scene.js'),'utf8');
  for(const key of [
    "this.load.image('vfx-rogue-poison-hit'",
    "this.load.image('vfx-rogue-expose'",
    "this.load.image('vfx-rogue-smoke-cast'",
    "this.load.image('vfx-rogue-smoke-blind'",
    "this.load.image('vfx-rogue-imbue'",
    "this.load.image('vfx-rogue-backstab'",
    "this.load.image('vfx-rogue-shadowstep'",
    "this.load.image('vfx-rogue-poison-tick'"
  ]) assert.match(scene, new RegExp(key.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')));

  assert.match(scene,/if\(id==='SHADOWSTEP'\)\{[\s\S]*vfx-rogue-shadowstep/);
  assert.match(scene,/if\(id==='POISON_DAGGER'\)\{[\s\S]*vfx-rogue-imbue/);
  assert.match(scene,/if\(id==='EXPOSE'\)\{[\s\S]*vfx-rogue-expose/);
  assert.match(scene,/if\(id==='SMOKE_BOMB'\)\{[\s\S]*vfx-rogue-smoke-cast/);
  assert.match(scene,/rogueSmokeBlindFx[\s\S]*vfx-rogue-smoke-blind/);
  assert.match(scene,/roguePoisonHitFx[\s\S]*vfx-rogue-poison-hit/);
  assert.match(scene,/rogueBackstabFx[\s\S]*vfx-rogue-backstab/);
  assert.match(scene,/roguePoisonTickFx[\s\S]*vfx-rogue-poison-tick/);
  assert.match(scene,/paladinBasicProcFx[\s\S]*vfx-paladin-proc/);
});

test('Stage 25AD balance values reflect the requested Cleric and Paladin tuning',()=>{
  const clericProc=getAbility('Cleric','CLERIC_ATTACK').basicProc;
  assert.deepEqual([clericProc.min,clericProc.max],[85,213]);
  const judgment=getAbility('Paladin','JUDGMENT').effects[0];
  assert.equal(judgment.afflictedMultiplier,3.5);
});

test('Stage 25AD Judgment deals 350% total damage to afflicted targets',()=>{
  const plain=damageTotalForJudgment({afflicted:false,seed:23});
  const afflicted=damageTotalForJudgment({afflicted:true,seed:23});
  assert.ok(plain>0);
  assert.equal(afflicted, plain + Math.floor(plain*2.5));
});
