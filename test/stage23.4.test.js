import test from 'node:test';
import assert from 'node:assert/strict';
import {
  TARGET_TYPE,
  actionSummary,
  boardCellLabel,
  create3v3BattleState,
  createRosterAbilityDeclaration,
  statusDisplayModels
} from '../src/index.js';

test('board cell labels use player-friendly A1 notation',()=>{
  assert.equal(boardCellLabel({row:0,col:0}),'A1');
  assert.equal(boardCellLabel({row:3,col:7}),'H4');
  assert.equal(boardCellLabel({row:9,col:13}),'N10');
});

test('planned ground action names the selected ability and human-readable cell',()=>{
  const state=create3v3BattleState({teamA:['Warrior','Rogue','Mage'],teamB:['Barbarian','Electromancer','Cleric'],matchId:'UI-ACTION'});
  const d=createRosterAbilityDeclaration({roundNumber:state.roundNumber,actorId:'H2',archetypeId:'Mage',abilityId:'FIREBALL',target:{type:TARGET_TYPE.GROUND,row:3,col:7}});
  assert.equal(actionSummary(d,state),'Fireball → H4');
});

test('planned unit action names the target archetype instead of only the network id',()=>{
  const state=create3v3BattleState({teamA:['Warrior','Rogue','Mage'],teamB:['Barbarian','Electromancer','Cleric'],matchId:'UI-TARGET'});
  const d=createRosterAbilityDeclaration({roundNumber:state.roundNumber,actorId:'H1',archetypeId:'Rogue',abilityId:'EXPOSE',target:{type:TARGET_TYPE.UNIT,unitId:'G0'}});
  assert.equal(actionSummary(d,state),'Expose → Barbarian');
});

test('status inspector exposes duration, stacks, poison amount, and positive/negative tone',()=>{
  const state=create3v3BattleState({teamA:['Warrior','Rogue','Mage'],teamB:['Barbarian','Electromancer','Cleric'],matchId:'UI-STATUS'});
  const unit=state.units.G0;
  unit.statuses=[
    {key:'stun',duration:2,sourceId:'H0',data:{}},
    {key:'atk_up',duration:3,sourceId:'G0',data:{stacks:2}},
    {key:'poison',duration:null,sourceId:null,data:{contributions:[{amount:40},{amount:18}]}}
  ];
  const models=statusDisplayModels(unit);
  assert.deepEqual(models.map(s=>[s.key,s.detail,s.tone]),[
    ['stun','2R','control'],
    ['atk_up','×2 • 3R','positive'],
    ['poison','58','poison']
  ]);
});
