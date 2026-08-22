import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  CONTROL_TYPE, EVENT_TYPE, SIDE, TARGET_TYPE,
  applyControlEffect, applyPoison, applyTimedStatus, createBattleState,
  createHoldDeclaration, createRosterAbilityDeclaration, createRosterCombatScheduler,
  createRosterUnit, createRoundSimulation, findStatus, getAbility, getArchetype,
  poisonTotal, processEndOfRoundStatuses, startPendingRosterActions,
  statusDisplayModels
} from '../src/index.js';

function hold(id,round=1){return createHoldDeclaration({declarationId:`D${round}:${id}`,roundNumber:round,actorId:id});}
function decl(archetypeId,abilityId,actorId='H0',target={type:TARGET_TYPE.UNIT,unitId:'G0'},round=1){return createRosterAbilityDeclaration({roundNumber:round,actorId,archetypeId,abilityId,target,declarationId:`D${round}:${actorId}`});}
function pair(a='Necromancer',b='Paladin',apos={row:5,col:2},bpos={row:5,col:13}){
  return createBattleState({matchId:'S23_18',units:[
    createRosterUnit({archetypeId:a,unitId:'H0',side:SIDE.A,draftSlot:0,position:apos}),
    createRosterUnit({archetypeId:b,unitId:'G0',side:SIDE.B,draftSlot:0,position:bpos})
  ]});
}
function run(state,decs,seed=123,counters=false){const sim=createRoundSimulation({state,declarations:decs,seed});createRosterCombatScheduler(sim,{countersEnabled:counters}).runUntilCombatSettled({maxCycles:200});return sim;}

test('Poison ticks for synchronized random 50–100% of current total, then contribution decay happens',()=>{
  function once(seed){const state=pair();const sim=createRoundSimulation({state,declarations:[hold('H0'),hold('G0')],seed});applyPoison(sim,'G0',100,{sourceId:'H0'});processEndOfRoundStatuses(sim);return sim;}
  const a=once(0x2318),b=once(0x2318);
  const tick=a.events.snapshot().find(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.damageType==='POISON');
  assert.ok(tick);assert.equal(tick.payload.poisonTotalBefore,100);assert.ok(tick.payload.tickPct>=.5&&tick.payload.tickPct<=1);
  assert.equal(tick.payload.amount,Math.max(1,Math.floor(100*tick.payload.tickPct)));
  assert.equal(poisonTotal(a.state.units.G0),85);
  assert.deepEqual(a.events.snapshot(),b.events.snapshot());assert.equal(a.rng.state,b.rng.state);
});

test('Ward-blocked Plague Detonation reseed reports attempted Poison and leaves no reseeded stack',()=>{
  const state=pair('Necromancer','Paladin',{row:5,col:2},{row:5,col:8});
  state.units.G0.stats.hp=900;state.units.G0.stats.maxHP=1200;
  state.units.G0.statuses.push({key:'poison',duration:null,sourceId:'H0',data:{contributions:[{amount:100,sourceId:'H0'}]}},{key:'ward',duration:3,sourceId:'G0',data:{}});
  const sim=run(state,[decl('Necromancer','PLAGUE_DETONATION','H0',{type:TARGET_TYPE.ALL_ENEMIES}),hold('G0')],17,false);
  assert.equal(poisonTotal(sim.state.units.G0),0);
  const block=sim.events.snapshot().find(e=>e.type===EVENT_TYPE.BLOCK&&e.payload?.reason==='WARD');
  assert.ok(block);assert.equal(block.payload.blockedStatusKey,'poison');assert.equal(block.payload.blockedAmount,50);assert.equal(block.payload.abilityId,'PLAGUE_DETONATION');
});

test('Psychic Pulse replaces Fear on Mystic and applies Blind on a damage spell',()=>{
  const pulse=getAbility('Mystic','MIND_SHATTER');assert.equal(pulse.label,'Psychic Pulse');assert.deepEqual(pulse.effects.map(e=>e.type),['DAMAGE','APPLY_STATUS']);assert.equal(pulse.effects[1].key,'blind');
});

test('Regen Potion is explicitly heal plus Poison cure',()=>{
  const potion=getAbility('Shinobi','REGEN_POTION');const heal=potion.effects.find(e=>e.type==='HEAL_PERCENT_ROLL');assert.equal(heal?.minPct,.35);assert.equal(heal?.maxPct,.60);assert.equal(potion.usesMax,3);assert.deepEqual(potion.effects.find(e=>e.type==='CLEANSE')?.keys,['poison']);assert.match(potion.note,/cure Poison/i);
});

test('Dispel can target either team, deals no damage, and preserves Poison/Bleed only',()=>{
  const shinobi=createRosterUnit({archetypeId:'Shinobi',unitId:'H0',side:SIDE.A,draftSlot:0,position:{row:5,col:2}});
  const ally=createRosterUnit({archetypeId:'Warrior',unitId:'H1',side:SIDE.A,draftSlot:1,position:{row:5,col:3}});
  const enemy=createRosterUnit({archetypeId:'Mage',unitId:'G0',side:SIDE.B,draftSlot:0,position:{row:5,col:10}});
  ally.statuses.push({key:'atk_up',duration:3,sourceId:'H1',data:{}},{key:'poison',duration:null,sourceId:'G0',data:{contributions:[{amount:30,sourceId:'G0'}]}},{key:'bleed',duration:3,sourceId:'G0',data:{pct:.15}});
  const state=createBattleState({matchId:'DISPEL_ANY',units:[shinobi,ally,enemy]});
  const d=decl('Shinobi','DISPEL','H0',{type:TARGET_TYPE.UNIT,unitId:'H1'});
  const sim=run(state,[d,hold('H1'),hold('G0')],22,false);
  assert.equal(getAbility('Shinobi','DISPEL').targeting.anyUnit,true);
  assert.equal(findStatus(sim.state.units.H1,'atk_up'),null);assert.ok(findStatus(sim.state.units.H1,'poison'));assert.ok(findStatus(sim.state.units.H1,'bleed'));
  assert.equal(sim.events.snapshot().some(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.abilityId==='DISPEL'),false);
});

test('Berserk-forced Basic Attacks do not inherit interrupted spell names',()=>{
  const state=pair('Shinobi','Warrior',{row:5,col:4},{row:5,col:6});
  state.units.G0.stats.QKN=-1000;state.units.G0.stats.DEF=0;state.units.G0.stats.RES=0;
  const sim=createRoundSimulation({state,declarations:[decl('Shinobi','INVISIBILITY','H0',{type:TARGET_TYPE.SELF}),hold('G0')],seed:33});
  startPendingRosterActions(sim,0);applyControlEffect(sim,'H0',{type:CONTROL_TYPE.BERSERK,sourceId:'G0',duration:3,cycle:0});
  createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:100});
  const hits=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.actorId==='H0');
  assert.ok(hits.length>0);assert.ok(hits.every(e=>e.payload?.abilityId==='SHINOBI_ATTACK'));assert.ok(hits.every(e=>e.payload?.abilityId!=='INVISIBILITY'));
});

test('Shield Bash pursues from distance, then makes one 300% attack attempt and braces',()=>{
  const state=pair('Paladin','Warrior',{row:5,col:2},{row:5,col:10});
  state.units.G0.stats.QKN=-1000;state.units.G0.stats.DEF=0;state.units.G0.stats.hp=9999;state.units.G0.stats.maxHP=9999;
  state.units.H0.stats.CRIT=0;state.units.H0.weapon.attackBaseMin=100;state.units.H0.weapon.attackBaseMax=100;
  const sim=run(state,[decl('Paladin','SHIELD_BASH'),hold('G0')],44,false);
  const moves=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.MOVE&&e.actorId==='H0');
  const dmg=sim.events.snapshot().find(e=>e.type===EVENT_TYPE.DAMAGE&&e.actorId==='H0'&&e.payload?.abilityId==='SHIELD_BASH');
  assert.ok(moves.length>=1);assert.ok(dmg);assert.ok(dmg.payload.amount>=225); // 300 raw through baseline 25% ARM
  assert.equal(findStatus(sim.state.units.H0,'physical_shield')?.data?.pct,.20);
});

test('Volley is buffed by 20% to a 132–240 physical 5x5 AoE',()=>{
  const volley=getAbility('Archer','VOLLEY'),effect=volley.effects[0];assert.equal(effect.min,132);assert.equal(effect.max,240);assert.equal(volley.area.shape,'SQUARE_5X5');
});

test('all champion max HP values reflect the later Stage 23.20 survivability pass',()=>{
  const expected={Warrior:2126,Barbarian:1997,Rogue:1700,Cleric:1784,Mage:1700,Paladin:1827,Archer:1700,Monk:1614,Necromancer:1700,Mystic:1571,Shinobi:1658,Electromancer:1614};
  for(const [id,hp] of Object.entries(expected))assert.equal(getArchetype(id).stats.maxHP,hp,id);
});

test('status inspector tooltips explain volatile Poison and Bleed while Poison remains a negative-colored chip',()=>{
  const u=createRosterUnit({archetypeId:'Rogue',unitId:'H0',side:SIDE.A,draftSlot:0,position:{row:5,col:2}});
  u.statuses.push({key:'poison',duration:null,sourceId:'G0',data:{contributions:[{amount:80,sourceId:'G0'}]}},{key:'bleed',duration:4,sourceId:'G0',data:{pct:.15}});
  const models=statusDisplayModels(u),poison=models.find(s=>s.key==='poison'),bleed=models.find(s=>s.key==='bleed');
  assert.equal(poison.tone,'poison');assert.match(poison.tooltip,/50–100%/);assert.match(poison.tooltip,/decays by 15%/);assert.match(bleed.tooltip,/current HP/);
});


test('counters after completed non-basic actions use plain Attack identity rather than the declaration ability',()=>{
  const shinobi=createRosterUnit({archetypeId:'Shinobi',unitId:'H0',side:SIDE.A,draftSlot:0,position:{row:5,col:5}});
  const monk=createRosterUnit({archetypeId:'Monk',unitId:'G0',side:SIDE.B,draftSlot:0,position:{row:5,col:6}});
  shinobi.stats.DEF=0;monk.stats.DEF=0;shinobi.stats.CRIT=0;monk.stats.CRIT=0;
  const state=createBattleState({matchId:'COUNTER_IDENTITY',units:[shinobi,monk]});
  const sim=run(state,[decl('Shinobi','REGEN_POTION','H0',{type:TARGET_TYPE.SELF}),decl('Monk','PALM_HIT','G0',{type:TARGET_TYPE.UNIT,unitId:'H0'})],0x2318,true);
  const counterDamage=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.actorId==='H0'&&e.payload?.abilityId==='SHINOBI_ATTACK');
  assert.ok(counterDamage.length>0,'Shinobi should counter using its plain Attack identity');
  assert.equal(sim.events.snapshot().some(e=>e.type===EVENT_TYPE.DAMAGE&&e.actorId==='H0'&&e.payload?.abilityId==='REGEN_POTION'),false);
});

test('top mode buttons are ordered 1P Sandbox, 1P Roster, then 2P Network',()=>{
  const html=fs.readFileSync(new URL('../client/index.html',import.meta.url),'utf8');
  assert.ok(html.indexOf('1P SANDBOX')<html.indexOf('1P ROSTER'));assert.ok(html.indexOf('1P ROSTER')<html.indexOf('2P NETWORK'));
});
