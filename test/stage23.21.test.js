import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_KIND, EVENT_TYPE, SIDE, TARGET_TYPE,
  cellsForArea, counterRulesFor, createBattleState, createHoldDeclaration,
  createRosterAbilityDeclaration, createRosterCombatScheduler, createRosterUnit,
  createRoundSimulation, closeRound, findStatus, getAbility, resolveRosterEffects,
  resolveShieldwallIntercept
} from '../src/index.js';

function unit(archetypeId,unitId,side,pos,slot=0){return createRosterUnit({archetypeId,unitId,side,draftSlot:slot,position:pos});}
function hold(id){return createHoldDeclaration({declarationId:`H:${id}`,roundNumber:1,actorId:id});}
function decl(archetypeId,abilityId,actorId='H0',target={type:TARGET_TYPE.UNIT,unitId:'G0'}){return createRosterAbilityDeclaration({roundNumber:1,actorId,archetypeId,abilityId,target});}
function run(state,declarations,seed=2321,countersEnabled=false){const sim=createRoundSimulation({state,declarations,seed});createRosterCombatScheduler(sim,{countersEnabled}).runUntilCombatSettled({maxCycles:1000});return sim;}

test('Bloodlust is a targeted modified basic attack with full Barbarian attack pool and one-round no-counter commitment',()=>{
  const ability=getAbility('Barbarian','BLOODLUST');
  assert.equal(ability.actionKind,ACTION_KIND.BASIC_ATTACK);
  assert.equal(ability.targetType,TARGET_TYPE.UNIT);
  const barb=unit('Barbarian','H0',SIDE.A,{row:5,col:5});
  const foe=unit('Warrior','G0',SIDE.B,{row:5,col:7}); foe.stats.maxHP=99999;foe.stats.hp=99999;foe.stats.QKN=-1000;
  const sim=run(createBattleState({matchId:'BLOODLUST-STYLE',units:[barb,foe]}),[decl('Barbarian','BLOODLUST'),hold('G0')],7,false);
  const hits=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.actorId==='H0'&&e.payload?.abilityId==='BLOODLUST');
  assert.equal(hits.length,7);
  const bloodlust=findStatus(sim.state.units.H0,'bloodlust');
  assert.ok(bloodlust);
  assert.equal(counterRulesFor(sim.state.units.H0).disabled,true);
  assert.equal(bloodlust.data.incomingDamageMultiplier,1.25);
});

test('Shieldwall never redirects an attacker own friendly-fire attack back onto that same attacker',()=>{
  const w=unit('Warrior','H0',SIDE.A,{row:5,col:5}), ally=unit('Cleric','H1',SIDE.A,{row:5,col:6}), foe=unit('Mystic','G0',SIDE.B,{row:5,col:10});
  w.statuses.push({key:'shield_redirect',duration:1,sourceId:'H0',data:{remaining:5,meleeOnly:true}});
  const sim=createRoundSimulation({state:createBattleState({matchId:'NO-SELF-INTERCEPT',units:[w,ally,foe]}),declarations:[hold('H0'),hold('H1'),hold('G0')],seed:1});
  const out=resolveShieldwallIntercept(sim,'H0','H1',{cycle:0});
  assert.equal(out.intercepted,false);
  assert.equal(out.targetId,'H1');
});

test('Fireball is a true-friendly-fire 5x5 AoE with 200-350 raw damage',()=>{
  const f=getAbility('Mage','FIREBALL');
  assert.equal(f.area.shape,'SQUARE_5X5');
  assert.deepEqual([f.effects[0].min,f.effects[0].max],[200,350]);
  assert.equal(f.effects[0].hostileOnly,false);
  assert.equal(cellsForArea({width:16,height:11},{shape:'SQUARE_5X5',center:{row:5,col:8}}).length,25);
});

test('Piercing Light is a 7x7 hostile AoE that removes Invisibility from enemies but does not damage allies',()=>{
  const cleric=unit('Cleric','H0',SIDE.A,{row:5,col:2}), ally=unit('Warrior','H1',SIDE.A,{row:5,col:8}), enemy=unit('Rogue','G0',SIDE.B,{row:5,col:9});
  enemy.statuses.push({key:'invisible',duration:3,sourceId:'G0',data:{}});
  enemy.stats.DEF=0; enemy.stats.RES=0; ally.stats.RES=0;
  const beforeAlly=ally.stats.hp,beforeEnemy=enemy.stats.hp;
  const sim=run(createBattleState({matchId:'PL-7X7',units:[cleric,ally,enemy]}),[decl('Cleric','PIERCING_LIGHT','H0',{type:TARGET_TYPE.GROUND,row:5,col:8}),hold('H1'),hold('G0')],9,false);
  assert.equal(getAbility('Cleric','PIERCING_LIGHT').area.shape,'SQUARE_7X7');
  assert.equal(cellsForArea({width:16,height:11},{shape:'SQUARE_7X7',center:{row:5,col:8}}).length,49);
  assert.equal(sim.state.units.H1.stats.hp,beforeAlly);
  assert.ok(sim.state.units.G0.stats.hp<beforeEnemy);
  assert.equal(findStatus(sim.state.units.G0,'invisible'),null);
});

test('Arcane Surge grants one-round Shift and Arcane Ward is a 4-cycle five-round Magic Shield',()=>{
  const surge=getAbility('Mage','ARCANE_SURGE'), ward=getAbility('Mage','ARCANE_WARD');
  assert.equal(surge.effects.find(e=>e.key==='shift')?.duration,1);
  assert.equal(ward.completionDelayCycles,4);
  assert.equal(ward.effects.find(e=>e.key==='magic_shield')?.duration,5);
});

test('Arcane Echo marks its second explicit spell resolution as 150% damage',()=>{
  const mage=unit('Mage','H0',SIDE.A,{row:5,col:2}), enemy=unit('Warrior','G0',SIDE.B,{row:5,col:8});enemy.stats.QKN=-1000;
  const setup=run(createBattleState({matchId:'ECHO-SET',units:[mage,enemy]}),[decl('Mage','ARCANE_ECHO','H0',{type:TARGET_TYPE.SELF}),hold('G0')],10,false);
  closeRound(setup);
  const roundNumber=setup.state.roundNumber;
  const d=createRosterAbilityDeclaration({roundNumber,actorId:'H0',archetypeId:'Mage',abilityId:'FIREBALL',target:{type:TARGET_TYPE.GROUND,row:5,col:8}});
  const h=createHoldDeclaration({declarationId:`H${roundNumber}:G0`,roundNumber,actorId:'G0'});
  const sim=createRoundSimulation({state:setup.state,declarations:[d,h],seed:11});createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:100});
  const resolutions=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.SPELL_RESOLUTION&&e.actorId==='H0');
  assert.equal(resolutions.length,2);
  assert.equal(resolutions[0].payload.damageMultiplier,1);
  assert.equal(resolutions[1].payload.damageMultiplier,1.5);
});

test('Chain Lightning bounce chance is 80%, Shift lasts four rounds, Resurrection has 2 uses, and Regen Potion has 3',()=>{
  assert.equal(getAbility('Electromancer','CHAIN_LIGHTNING').effects[0].bounceChance,.80);
  assert.equal(getAbility('Electromancer','SHIFT').effects[0].duration,4);
  assert.equal(getAbility('Cleric','RESURRECTION').usesMax,2);
  assert.equal(getAbility('Shinobi','REGEN_POTION').usesMax,3);
});

test('A four-swing Rend can add at most four stacks in one action while the global stack cap remains higher',()=>{
  const barb=unit('Barbarian','H0',SIDE.A,{row:5,col:5}), target=unit('Mage','G0',SIDE.B,{row:5,col:7});target.stats.QKN=-1000;target.stats.maxHP=99999;target.stats.hp=99999;
  const sim=run(createBattleState({matchId:'REND5',units:[barb,target]}),[decl('Barbarian','REND'),hold('G0')],12,false);
  assert.equal(findStatus(sim.state.units.G0,'rend_def_down')?.data?.stacks,4);
});

test('resolveRosterEffects damageMultiplier scales direct damage for echoed second resolution semantics',()=>{
  const mage=unit('Mage','H0',SIDE.A,{row:5,col:5}), target=unit('Warrior','G0',SIDE.B,{row:5,col:7});target.stats.RES=0;mage.stats.SDM=100;mage.stats.CRIT=0;
  const sim=createRoundSimulation({state:createBattleState({matchId:'ECHO-SCALE',units:[mage,target]}),declarations:[hold('H0'),hold('G0')],seed:1});
  const synthetic={id:'SYNTH_ECHO',effects:[{type:'DAMAGE',min:100,max:100,damageType:'MAGICAL',scalesWith:'SDM',dodgeable:false}]};
  const before=sim.state.units.G0.stats.hp;
  resolveRosterEffects(sim,{actorId:'H0',ability:synthetic,validity:{target:sim.state.units.G0},cycle:0,damageMultiplier:1.5});
  assert.equal(before-sim.state.units.G0.stats.hp,150);
});
