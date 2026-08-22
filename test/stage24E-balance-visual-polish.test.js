import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CONTROL_TYPE, EVENT_TYPE, PRESENTATION_COMMAND, SIDE, TARGET_TYPE,
  abilityDetailModel, applyControlEffect, commandsForEvent,
  createBattleState, createHoldDeclaration, createRosterAbilityDeclaration,
  createRosterCombatScheduler, createRosterUnit, createRoundSimulation,
  dumpRemainingBasicAttacks, getAbility, getArchetype, resolveRosterEffects
} from '../src/index.js';

function unit(archetypeId,unitId,side,position,slot=0){
  return createRosterUnit({archetypeId,unitId,side,draftSlot:slot,position});
}
function hold(actorId,roundNumber=1){
  return createHoldDeclaration({declarationId:`H:${roundNumber}:${actorId}`,roundNumber,actorId});
}
function declaration(archetypeId,abilityId,actorId,target,roundNumber=1){
  return createRosterAbilityDeclaration({declarationId:`D:${roundNumber}:${actorId}`,roundNumber,actorId,archetypeId,abilityId,target});
}

const EXPECTED_HP={Warrior:2126,Barbarian:1997,Rogue:1700,Cleric:1784,Mage:1700,Paladin:1827,Archer:1700,Monk:1614,Necromancer:1700,Mystic:1571,Shinobi:1658,Electromancer:1614};

test('system-wide HP, ARM/RES and requested movement baselines match the polish pass',()=>{
  for(const [id,hp] of Object.entries(EXPECTED_HP)){
    const archetype=getArchetype(id);
    assert.equal(archetype.stats.maxHP,hp,`${id} HP`);
    assert.equal(archetype.stats.DEF,35,`${id} ARM`);
    assert.equal(archetype.stats.RES,35,`${id} RES`);
  }
  assert.equal(getArchetype('Barbarian').combat.movementMax,15);
  assert.equal(getArchetype('Warrior').combat.movementMax,14);
  assert.equal(getArchetype('Paladin').combat.movementMax,14);
  assert.equal(getArchetype('Mage').combat.movementMax,13);
  assert.equal(getArchetype('Rogue').combat.movementMax,16);
});

test('requested ability tuning is authoritative in roster data',()=>{
  const life=getAbility('Necromancer','LIFE_DRAIN');
  assert.deepEqual([life.effects[0].min,life.effects[0].max],[150,300]);
  const bolt=getAbility('Necromancer','POISON_BOLT').effects.find(e=>e.type==='DAMAGE');
  assert.deepEqual([bolt.min,bolt.max],[150,200]);
  const plague=getAbility('Necromancer','PLAGUE');
  assert.equal(plague.completionDelayCycles,6);
  assert.deepEqual([plague.effects[0].min,plague.effects[0].max],[100,160]);

  assert.equal(getAbility('Barbarian','REND').basicStyle.attacksSet,4);
  assert.equal(getAbility('Warrior','POWER_STRIKE').basicStyle.attacksDelta,undefined);
  assert.equal(getAbility('Warrior','POWER_STRIKE').label,'Power Strikes');

  const focus=getAbility('Archer','RANGERS_FOCUS').effects.find(e=>e.type==='HEAL');
  assert.deepEqual([focus.min,focus.max],[50,100]);
  assert.equal(getAbility('Archer','HUNTERS_MARK').completionDelayCycles,4);
  const volley=getAbility('Archer','VOLLEY').effects.find(e=>e.type==='AOE_DAMAGE');
  assert.deepEqual([volley.min,volley.max],[132,240]);

  assert.equal(getAbility('Cleric','DEFENSIVE_AURA').completionDelayCycles,2);
  assert.equal(getAbility('Cleric','ENIDS_BLESSING').completionDelayCycles,7);
  const light=getAbility('Cleric','PIERCING_LIGHT');
  assert.equal(light.completionDelayCycles,3);
  assert.equal(light.area.shape,'SQUARE_7X7');
  assert.deepEqual([light.effects.find(e=>e.type==='AOE_DAMAGE').min,light.effects.find(e=>e.type==='AOE_DAMAGE').max],[150,250]);
  assert.equal(getAbility('Mage','FIREBALL').area.shape,'SQUARE_5X5');
  assert.equal(getAbility('Mystic','MENTAL_BREAKDOWN').completionDelayCycles,2);
  assert.equal(getAbility('Mystic','MENTAL_BREAKDOWN').label,'Spellbreak');
  assert.equal(getAbility('Mystic','MENTAL_BREAKDOWN').effects[0].chance,.80);
});

test('Life Drain heals Necromancer for exactly the actual damage dealt',()=>{
  const necro=unit('Necromancer','H0',SIDE.A,{row:5,col:4});
  const target=unit('Warrior','G0',SIDE.B,{row:5,col:6});
  necro.stats.hp=500;necro.stats.CRIT=0;
  target.stats.RES=0;target.stats.hp=target.stats.maxHP=9999;
  const sim=createRoundSimulation({
    state:createBattleState({matchId:'LIFE-DRAIN-FIX',units:[necro,target]}),
    declarations:[hold('H0'),hold('G0')],seed:5
  });
  const before=sim.state.units.H0.stats.hp;
  resolveRosterEffects(sim,{actorId:'H0',ability:getAbility('Necromancer','LIFE_DRAIN'),validity:{target:sim.state.units.G0},cycle:0});
  const events=sim.events.snapshot();
  const damage=events.find(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.abilityId==='LIFE_DRAIN'&&e.targetId==='G0');
  const heal=events.find(e=>e.type===EVENT_TYPE.HEAL&&e.payload?.abilityId==='LIFE_DRAIN'&&e.targetId==='H0');
  assert.ok(damage);assert.ok(heal);
  assert.equal(heal.payload.amount,damage.payload.amount);
  assert.equal(sim.state.units.H0.stats.hp-before,damage.payload.amount);
});

test('Power Strikes now executes the normal seven-swing Warrior attack pool',()=>{
  const warrior=unit('Warrior','H0',SIDE.A,{row:5,col:5});
  const target=unit('Barbarian','G0',SIDE.B,{row:5,col:6});
  warrior.stats.CRIT=0;warrior.weapon.attackBaseMin=warrior.weapon.attackBaseMax=100;
  target.stats.hp=target.stats.maxHP=99999;target.stats.DEF=0;target.stats.QKN=-1000;
  const sim=createRoundSimulation({
    state:createBattleState({matchId:'POWER-STRIKES-SEVEN',units:[warrior,target]}),
    declarations:[declaration('Warrior','POWER_STRIKE','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'}),hold('G0')],seed:1
  });
  createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:100});
  const hits=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.actorId==='H0'&&e.payload?.abilityId==='POWER_STRIKE');
  assert.equal(hits.length,7);
  assert.equal(sim.state.units.H0.resources.attacksRemaining,0);
});

test('a Stun received during an end-of-round Rend dump stops all remaining swings immediately',()=>{
  const barb=unit('Barbarian','H0',SIDE.A,{row:5,col:5});
  const mage=unit('Mage','G0',SIDE.B,{row:5,col:7});
  mage.stats.hp=mage.stats.maxHP=99999;mage.stats.QKN=-1000;mage.stats.DEF=0;
  const sim=createRoundSimulation({
    state:createBattleState({matchId:'STUN-DURING-DUMP',units:[barb,mage]}),
    declarations:[declaration('Barbarian','REND','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'}),hold('G0')],seed:1
  });
  createRosterCombatScheduler(sim,{countersEnabled:false});
  const runtime=sim.runtimes['R1:H0'];
  let landed=0;
  const attacks=dumpRemainingBasicAttacks(sim,runtime,{afterEachAttack:()=>{
    landed+=1;
    if(landed===1)applyControlEffect(sim,'H0',{type:CONTROL_TYPE.STUN,sourceId:'G0',duration:2,cycle:0});
  }});
  assert.equal(attacks.length,1);
  assert.equal(sim.state.units.H0.resources.attacksRemaining,3);
  assert.equal(runtime.interrupted,true);
});

test('Spellbreak cancels only the first Arcane Echo resolution and the echoed second cast still resolves',()=>{
  const mage=unit('Mage','H0',SIDE.A,{row:5,col:2});
  const target=unit('Warrior','G0',SIDE.B,{row:5,col:8});
  mage.stats.CRIT=0;
  mage.statuses.push(
    {key:'arcane_echo',duration:2,sourceId:'H0',data:{}},
    {key:'spellbreak',duration:3,sourceId:'G0',data:{}}
  );
  target.stats.RES=0;target.stats.hp=target.stats.maxHP=99999;
  const sim=createRoundSimulation({
    state:createBattleState({matchId:'SPELLBREAK-ECHO',units:[mage,target]}),
    declarations:[declaration('Mage','FIREBALL','H0',{type:TARGET_TYPE.GROUND,row:5,col:8}),hold('G0')],seed:2
  });
  createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:100});
  const events=sim.events.snapshot();
  assert.equal(events.some(e=>e.type===EVENT_TYPE.CAST_INTERRUPT&&e.actorId==='H0'),false);
  const resolutions=events.filter(e=>e.type===EVENT_TYPE.SPELL_RESOLUTION&&e.actorId==='H0');
  assert.equal(resolutions.length,2);
  assert.equal(resolutions[0].payload.spellbroken,true);
  assert.equal(resolutions[1].payload.spellbroken,false);
  const damages=events.filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.actorId==='H0'&&e.targetId==='G0'&&e.payload?.abilityId==='FIREBALL');
  assert.equal(damages.length,1);
  assert.equal(damages[0].payload.amount>=300&&damages[0].payload.amount<=525,true);
  assert.deepEqual(commandsForEvent(resolutions[0]).map(c=>c.type),[PRESENTATION_COMMAND.SPELL_RESOLUTION]);
  assert.ok(commandsForEvent(resolutions[1]).some(c=>c.type===PRESENTATION_COMMAND.SPELL_PROJECTILE));
});

test('ability detail models and notes expose the new timing, damage, heal and footprint values',()=>{
  const actor=id=>unit(id,`H-${id}`,SIDE.A,{row:5,col:2});
  const detail=(id,abilityId)=>abilityDetailModel(actor(id),getAbility(id,abilityId));
  assert.equal(detail('Cleric','DEFENSIVE_AURA').timing,'2 cycles');
  assert.equal(detail('Cleric','ENIDS_BLESSING').timing,'7 cycles');
  const light=detail('Cleric','PIERCING_LIGHT');assert.equal(light.timing,'3 cycles');assert.ok(light.lines.includes('Area: SQUARE 7X7'));
  assert.ok(detail('Mage','FIREBALL').lines.includes('Area: SQUARE 5X5'));
  assert.equal(detail('Mystic','MENTAL_BREAKDOWN').timing,'2 cycles');
  assert.equal(detail('Archer','HUNTERS_MARK').timing,'4 cycles');
  assert.equal(detail('Necromancer','PLAGUE').timing,'6 cycles');
  assert.ok(detail('Archer','RANGERS_FOCUS').lines.some(l=>l.includes('Heal 50–100')));
  assert.ok(detail('Archer','VOLLEY').lines.some(l=>l.includes('132–240 physical damage')));
  assert.ok(detail('Necromancer','LIFE_DRAIN').lines.some(l=>l.includes('150–300 magical damage and heal for damage dealt')));
  assert.ok(detail('Necromancer','POISON_BOLT').lines.some(l=>l.includes('150–200 magical damage')));
});

test('battlefield render depth follows grid row continuously instead of unit creation order',()=>{
  const scene=fs.readFileSync(new URL('../client/ros2-scene.js',import.meta.url),'utf8');
  assert.match(scene,/unitDepthFor\(unit,position=unit\?\.position\)/);
  assert.match(scene,/return -500\+row\+\(slot\*\.001\)\+sideTie/);
  assert.match(scene,/syncUnitDepth\(view,unit\.position\)/);
  assert.match(scene,/onUpdate:\(\)=>this\.syncUnitDepthFromWorldY\(v\)/);
  assert.match(scene,/gridGraphics=this\.add\.graphics\(\)\.setDepth\(-1000\)/);
});
