import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  EVENT_TYPE, SIDE, TARGET_TYPE,
  buildPresentationTimeline, createBattleState, createHoldDeclaration,
  createRosterAbilityDeclaration, createRosterCombatScheduler, createRosterUnit,
  createRoundSimulation, getArchetype
} from '../src/index.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const scene=readFileSync(resolve(root,'client/ros2-scene.js'),'utf8');
function unit(archetypeId,unitId,side,pos){return createRosterUnit({archetypeId,unitId,side,draftSlot:0,position:pos});}
function hold(id){return createHoldDeclaration({declarationId:`H:${id}`,roundNumber:1,actorId:id});}

test('Stage25Y Shieldwall B1 redirect VFX appears on Warrior and intended ally at 20% smaller scale',()=>{
  assert.match(scene,/animateInterceptCue\(command\)[\s\S]*const redirectFx=[\s\S]*vfx-warrior-shieldwall-redirect[\s\S]*scale:\.272[\s\S]*scaleTo:\.352/);
  assert.match(scene,/redirectFx\(intended\);\s*redirectFx\(warrior\);/);
});

test('Stage25Y Electromancer Lightning Bolt proc remains an explicit damage-feedback command with proc metadata',()=>{
  let found=null;
  for(let seed=1;seed<=300&&!found;seed++){
    const electro=unit('Electromancer','H0',SIDE.A,{row:5,col:5});
    const foe=unit('Warrior','G0',SIDE.B,{row:5,col:6});
    foe.stats.maxHP=99999;foe.stats.hp=99999;foe.stats.DEF=0;foe.stats.RES=0;foe.stats.QKN=-1000;
    const decl=createRosterAbilityDeclaration({
      declarationId:'D:H0',roundNumber:1,actorId:'H0',archetypeId:'Electromancer',abilityId:'ELECTRO_ATTACK',
      target:{type:TARGET_TYPE.UNIT,unitId:'G0'}
    });
    const sim=createRoundSimulation({state:createBattleState({matchId:`ELECTRO_PROC_UI:${seed}`,units:[electro,foe]}),declarations:[decl,hold('G0')],seed});
    createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:500});
    const damage=sim.events.snapshot().find(e=>e.type===EVENT_TYPE.DAMAGE&&e.actorId==='H0'&&e.payload?.proc===true&&e.payload?.abilityId==='ELECTRO_ATTACK');
    if(!damage)continue;
    const cmd=buildPresentationTimeline(sim.events.snapshot()).find(c=>c.type==='DAMAGE_FEEDBACK'&&c.sourceEventId===damage.eventId);
    if(cmd)found={damage,cmd};
  }
  assert.ok(found,'expected a deterministic Electromancer basic Lightning Bolt proc');
  assert.equal(found.cmd.payload.proc,true);
  assert.equal(found.cmd.payload.amount,found.damage.payload.amount);
  assert.equal(found.cmd.targetId,'G0');
  assert.match(scene,/electroProc=Boolean\(command\.payload\?\.proc===true&&attacker\?\.unit\?\.archetypeId==='Electromancer'&&ability==='ELECTRO_ATTACK'\)/);
  assert.match(scene,/electroProc\?'#66ddff'/);
  assert.match(scene,/electroProc&&!critical\?\{yOffset:8,duration:380\}:\{\}/);
});
