import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  SIDE,
  DEFAULT_BOARD,
  standardStartingPosition,
  create3v3BattleState,
  getArchetype,
  getAbility,
  effectiveCritMultiplier,
  compactAbilitySummary,
  createUnitState,
  createBattleState,
  createHoldDeclaration,
  createRoundSimulation,
  resolveBasicAttack,
  DAMAGE_TYPE
} from '../src/index.js';

test('Stage 23.10 default battlefield is 16x11 with B/N opening columns',()=>{
  assert.deepEqual(DEFAULT_BOARD,{width:16,height:11});
  assert.deepEqual(standardStartingPosition({side:SIDE.A,draftSlot:0}),{row:3,col:2});
  assert.deepEqual(standardStartingPosition({side:SIDE.A,draftSlot:1}),{row:5,col:1});
  assert.deepEqual(standardStartingPosition({side:SIDE.A,draftSlot:2}),{row:7,col:2});
  assert.deepEqual(standardStartingPosition({side:SIDE.B,draftSlot:0}),{row:3,col:13});
  assert.deepEqual(standardStartingPosition({side:SIDE.B,draftSlot:1}),{row:5,col:14});
  assert.deepEqual(standardStartingPosition({side:SIDE.B,draftSlot:2}),{row:7,col:13});
  const state=create3v3BattleState({teamA:['Warrior','Rogue','Mage'],teamB:['Barbarian','Cleric','Monk']});
  assert.equal(state.board.width,16);assert.equal(state.board.height,11);
});

test('normal critical hits use universal 2x damage regardless of legacy weapon multiplier fields',()=>{
  const dummy={statuses:[]};
  assert.equal(effectiveCritMultiplier(dummy),2);
  assert.equal(effectiveCritMultiplier(dummy,1.6),1.6,'explicit ability override remains supported');
});


test('actual basic crit damage ignores a legacy per-weapon critMultiplier and lands at 2x',()=>{
  const actor=createUnitState({unitId:'H0',side:SIDE.A,draftSlot:0,archetypeId:'Test',stats:{maxHP:500,hp:500,ATK:100,SDM:100,DEF:0,RES:0,CRIT:1,QKN:10},position:{row:1,col:1},combat:{movementMax:0,attacksMax:1,attackInterval:1},weapon:{weaponProfileId:'test',mode:'MELEE',weaponRange:1,preferredRange:1,counterMoveMax:0,attackBaseMin:100,attackBaseMax:100,accuracy:1,critBonus:0,critMultiplier:1.1,defensePenetration:0,damageType:DAMAGE_TYPE.PHYSICAL,dodgeable:false}});
  const target=createUnitState({unitId:'G0',side:SIDE.B,draftSlot:0,archetypeId:'Test',stats:{maxHP:500,hp:500,ATK:100,SDM:100,DEF:0,RES:0,CRIT:0,QKN:0},position:{row:1,col:2},combat:{movementMax:0,attacksMax:1,attackInterval:1},weapon:{weaponProfileId:'test2',mode:'MELEE',weaponRange:1,preferredRange:1,counterMoveMax:0,attackBaseMin:1,attackBaseMax:1,accuracy:1,damageType:DAMAGE_TYPE.PHYSICAL,dodgeable:false}});
  const state=createBattleState({matchId:'CRIT2X',board:{width:4,height:3},units:[actor,target]});
  const sim=createRoundSimulation({state,declarations:[createHoldDeclaration({declarationId:'D1:H0',roundNumber:1,actorId:'H0'}),createHoldDeclaration({declarationId:'D1:G0',roundNumber:1,actorId:'G0'})],seed:1});
  const out=resolveBasicAttack(sim,'H0','G0',{ignoreAttackInterval:true});
  assert.equal(out.crit,true);
  assert.equal(out.dealt,200);
});

test('Shadowstep-style explicit crit override still takes precedence over universal crit',()=>{
  const dummy={statuses:[{key:'shadowstep_crit',duration:2,data:{multiplier:2.5}}]};
  assert.equal(effectiveCritMultiplier(dummy),2.5);
});

test('active roster no longer uses generic Guard statuses',()=>{
  for(const c of Object.values(Object.fromEntries(['Warrior','Paladin'].map(id=>[id,getArchetype(id)])))){
    for(const a of c.abilities) for(const e of a.effects??[]) assert.notEqual(e.key,'guard',`${c.id}/${a.id}`);
  }
  assert.equal(getAbility('Warrior','SHIELDWALL').effects[0].key,'physical_shield');
  assert.equal(getAbility('Warrior','DIG_IN').effects.find(e=>e.type==='APPLY_STATUS'&&e.key==='physical_shield')?.data.pct,.20);
  assert.equal(getAbility('Paladin','SHIELD_BASH').basicStyle?.selfOnFirstAttack?.data?.pct,.20);
});

test('action selector summaries are intentionally one-line and glanceable',()=>{
  assert.equal(compactAbilitySummary(getAbility('Warrior','WARRIOR_ATTACK')),'Single-target attack');
  assert.equal(compactAbilitySummary(getAbility('Mage','FIREBALL')),'Damaging AoE spell');
  assert.equal(compactAbilitySummary(getAbility('Warrior','POWER_STRIKE')),'Modified attack style');
});

test('ability detail panel is beneath action buttons and combat log is beneath battlefield column',()=>{
  const html=fs.readFileSync(new URL('../client/index.html',import.meta.url),'utf8');
  assert.ok(html.indexOf('id="abilityButtons"') < html.indexOf('id="abilityInfoPanel"'));
  const battleStart=html.indexOf('class="battle-column"'),battleEnd=html.indexOf('</section>\n\n    <aside>',battleStart),log=html.indexOf('id="logPanel"');
  assert.ok(battleStart>=0&&log>battleStart&&log<battleEnd);
});

test('desktop CSS differentiates attack/spell/ability buttons and physical/magical detail text',()=>{
  const css=fs.readFileSync(new URL('../client/styles.css',import.meta.url),'utf8');
  assert.match(css,/\.ability\.kind-attack/);
  assert.match(css,/\.ability\.kind-spell/);
  assert.match(css,/\.ability\.kind-ability/);
  assert.match(css,/\.ability-detail-line\.physical/);
  assert.match(css,/\.ability-detail-line\.magical/);
});
