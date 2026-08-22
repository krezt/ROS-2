import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_TYPE, SIDE, TARGET_TYPE,
  createBattleState, createHoldDeclaration, createRosterAbilityDeclaration,
  createRosterCombatScheduler, createRosterUnit, createRoundSimulation,
  findStatus, getAbility, getArchetype, processEndOfRoundStatuses, resolveRosterEffects
} from '../src/index.js';

function unit(archetypeId,unitId,side,position,slot=0){
  return createRosterUnit({archetypeId,unitId,side,draftSlot:slot,position});
}
function hold(actorId,roundNumber=1){
  return createHoldDeclaration({declarationId:`H:${roundNumber}:${actorId}`,roundNumber,actorId});
}
function decl(archetypeId,abilityId,actorId,target,roundNumber=1){
  return createRosterAbilityDeclaration({declarationId:`D:${roundNumber}:${actorId}`,roundNumber,actorId,archetypeId,abilityId,target});
}

test('Stage 25G roster balance values match the requested update',()=>{
  assert.equal(getArchetype('Mage').combat.movementMax,13);
  assert.equal(getArchetype('Rogue').combat.movementMax,16);
  assert.equal(getArchetype('Paladin').combat.movementMax,14);

  const archer=getArchetype('Archer');
  assert.deepEqual([archer.weapon.attackBaseMin,archer.weapon.attackBaseMax],[69,106]);

  const spellbreak=getAbility('Mystic','MENTAL_BREAKDOWN');
  assert.equal(spellbreak.label,'Spellbreak');
  assert.equal(spellbreak.effects[0].chance,.80);

  const necroProc=getAbility('Necromancer','NECRO_ATTACK').basicProc;
  assert.deepEqual([necroProc.min,necroProc.max],[75,200]);
  const clericProc=getAbility('Cleric','CLERIC_ATTACK').basicProc;
  assert.deepEqual([clericProc.min,clericProc.max],[100,250]);

  const drain=getAbility('Necromancer','LIFE_DRAIN').effects[0];
  assert.deepEqual([drain.min,drain.max],[150,300]);
  const bolt=getAbility('Necromancer','POISON_BOLT').effects.find(e=>e.type==='DAMAGE');
  assert.deepEqual([bolt.min,bolt.max],[150,200]);

  const aura=getAbility('Cleric','DEFENSIVE_AURA').effects.find(e=>e.type==='HEAL_PERCENT_ROLL');
  assert.deepEqual([aura.minPct,aura.maxPct],[.40,.60]);

  const judgment=getAbility('Paladin','JUDGMENT').effects[0];
  assert.deepEqual([judgment.min,judgment.max],[200,300]);
  assert.equal(judgment.afflictedMultiplier,2.0);
  assert.equal(getAbility('Paladin','PALADIN_ATTACK').basicProc.roundChance,.90);

  const storm=getAbility('Electromancer','ELECTRICAL_STORM').effects[0];
  assert.deepEqual([storm.damage.min,storm.damage.max],[25,125]);
  assert.deepEqual([storm.heal.min,storm.heal.max],[25,125]);

  const light=getAbility('Cleric','PIERCING_LIGHT');
  assert.equal(light.area.shape,'SQUARE_7X7');
  const lightDamage=light.effects.find(e=>e.type==='AOE_DAMAGE');
  assert.deepEqual([lightDamage.min,lightDamage.max],[150,250]);
});

test('same-cycle faster Spellbreak interrupts Cleric Defensive Aura before heal or DEF bonus resolves',()=>{
  const mystic=unit('Mystic','H0',SIDE.A,{row:5,col:4});
  const cleric=unit('Cleric','G0',SIDE.B,{row:5,col:8});
  cleric.stats.hp=100;
  const sim=createRoundSimulation({
    state:createBattleState({matchId:'STAGE25G-SAME-CYCLE-SPELLBREAK',units:[mystic,cleric]}),
    declarations:[
      decl('Mystic','MENTAL_BREAKDOWN','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'}),
      decl('Cleric','DEFENSIVE_AURA','G0',{type:TARGET_TYPE.SELF})
    ],
    seed:1
  });
  createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:50});
  const events=sim.events.snapshot();
  assert.ok(events.some(e=>e.type===EVENT_TYPE.STATUS_APPLY&&e.targetId==='G0'&&e.payload?.key==='spellbreak'));
  assert.ok(events.some(e=>e.type===EVENT_TYPE.CAST_INTERRUPT&&e.actorId==='G0'&&e.payload?.reason==='SPELLBREAK'));
  assert.equal(events.some(e=>e.type===EVENT_TYPE.HEAL&&e.actorId==='G0'&&e.payload?.abilityId==='DEFENSIVE_AURA'),false);
  assert.equal(findStatus(sim.state.units.G0,'def_up'),null);
  assert.equal(sim.state.units.G0.stats.hp,100);
});

test('Bleed blocks ability healing and Life Drain healing while leaving non-heal effects intact',()=>{
  const cleric=unit('Cleric','H0',SIDE.A,{row:5,col:4});
  const enemy=unit('Warrior','G0',SIDE.B,{row:5,col:8});
  cleric.stats.hp=200;
  cleric.statuses.push({key:'bleed',duration:3,sourceId:'G0',data:{pct:.01}});
  let sim=createRoundSimulation({
    state:createBattleState({matchId:'STAGE25G-BLEED-AURA',units:[cleric,enemy]}),
    declarations:[hold('H0'),hold('G0')],seed:7
  });
  resolveRosterEffects(sim,{actorId:'H0',ability:getAbility('Cleric','DEFENSIVE_AURA'),validity:{target:sim.state.units.H0},cycle:0});
  const auraHeal=sim.events.snapshot().find(e=>e.type===EVENT_TYPE.HEAL&&e.payload?.abilityId==='DEFENSIVE_AURA');
  assert.ok(auraHeal);assert.equal(auraHeal.payload.amount,0);assert.equal(auraHeal.payload.blockedByBleed,true);
  assert.equal(sim.state.units.H0.stats.hp,200);
  assert.ok(findStatus(sim.state.units.H0,'def_up'));

  const necro=unit('Necromancer','N0',SIDE.A,{row:5,col:4});
  const target=unit('Warrior','W0',SIDE.B,{row:5,col:6});
  necro.stats.hp=300;necro.statuses.push({key:'bleed',duration:3,sourceId:'W0',data:{pct:.01}});
  target.stats.RES=0;target.stats.hp=target.stats.maxHP=9999;
  sim=createRoundSimulation({state:createBattleState({matchId:'STAGE25G-BLEED-DRAIN',units:[necro,target]}),declarations:[hold('N0'),hold('W0')],seed:8});
  resolveRosterEffects(sim,{actorId:'N0',ability:getAbility('Necromancer','LIFE_DRAIN'),validity:{target:sim.state.units.W0},cycle:0});
  const events=sim.events.snapshot();
  const damage=events.find(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.abilityId==='LIFE_DRAIN');
  const heal=events.find(e=>e.type===EVENT_TYPE.HEAL&&e.payload?.abilityId==='LIFE_DRAIN');
  assert.ok(damage?.payload.amount>0);
  assert.ok(heal);assert.equal(heal.payload.amount,0);assert.equal(heal.payload.blockedByBleed,true);
  assert.equal(sim.state.units.N0.stats.hp,300);
});

test('Bleed blocks Regen HP gain at end of round',()=>{
  const monk=unit('Monk','H0',SIDE.A,{row:5,col:4});
  const enemy=unit('Warrior','G0',SIDE.B,{row:5,col:8});
  monk.stats.hp=800;
  monk.statuses.push(
    {key:'bleed',duration:3,sourceId:'G0',data:{pct:.01}},
    {key:'regen',duration:3,sourceId:'H0',data:{pct:.10}}
  );
  const sim=createRoundSimulation({state:createBattleState({matchId:'STAGE25G-BLEED-REGEN',units:[monk,enemy]}),declarations:[hold('H0'),hold('G0')],seed:9});
  processEndOfRoundStatuses(sim,{cycle:0});
  const bleedDamage=sim.events.snapshot().find(e=>e.type===EVENT_TYPE.DAMAGE&&e.targetId==='H0'&&e.payload?.damageType==='BLEED');
  const regenHeal=sim.events.snapshot().find(e=>e.type===EVENT_TYPE.HEAL&&e.targetId==='H0'&&e.payload?.statusKey==='regen');
  assert.ok(bleedDamage?.payload.amount>0);
  assert.ok(regenHeal);assert.equal(regenHeal.payload.amount,0);assert.equal(regenHeal.payload.blockedByBleed,true);
  assert.equal(sim.state.units.H0.stats.hp,800-bleedDamage.payload.amount);
});
