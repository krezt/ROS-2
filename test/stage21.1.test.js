import test from 'node:test';
import assert from 'node:assert/strict';
import {
  EVENT_TYPE,
  SIDE,
  TARGET_TYPE,
  LIFE_STATE,
  create3v3BattleState,
  createBattleState,
  createHoldDeclaration,
  createRosterAbilityDeclaration,
  createRosterCombatScheduler,
  createRosterUnit,
  createRoundSimulation,
  findStatus,
  getAbility,
  resolveBasicAttack
} from '../src/index.js';

function unit(archetypeId, unitId, side, position, draftSlot=0) {
  return createRosterUnit({ archetypeId, unitId, side, draftSlot, position });
}
function hold(actorId, roundNumber=1) {
  return createHoldDeclaration({ declarationId:`D${roundNumber}:${actorId}`, roundNumber, actorId });
}
function decl(archetypeId, abilityId, actorId='H0', target={type:TARGET_TYPE.UNIT,unitId:'G0'}, roundNumber=1) {
  return createRosterAbilityDeclaration({ roundNumber, actorId, archetypeId, abilityId, target });
}
function noDodge(target){ target.stats.QKN=-1000; target.stats.DEF=0; }

function run(state, declarations, seed=0x211, countersEnabled=false) {
  const sim=createRoundSimulation({state,declarations,seed});
  createRosterCombatScheduler(sim,{countersEnabled}).runUntilCombatSettled({maxCycles:5000});
  return sim;
}

test('Shinobi is now a Range-1 melee dagger user with twelve attacks and no throwing-dagger kite behavior',()=>{
  const shinobi=createRosterUnit({archetypeId:'Shinobi',unitId:'H0',side:SIDE.A,draftSlot:0,position:{row:3,col:0}});
  assert.equal(shinobi.weapon.mode,'MELEE');
  assert.equal(shinobi.weapon.weaponRange,1);
  assert.equal(shinobi.weapon.preferredRange,1);
  assert.equal(shinobi.weapon.counterMoveMax,1);
  assert.equal(shinobi.resources.attacksMax,12);
  assert.notEqual(shinobi.weapon.behavior,'THROWING_DAGGER');
});

test("Thief's Haste is deliberately obnoxious: baseline Movement 16 becomes 48",()=>{
  const state=createBattleState({matchId:'HASTE48',units:[
    unit('Shinobi','H0',SIDE.A,{row:3,col:3}),
    unit('Warrior','G0',SIDE.B,{row:3,col:5})
  ]});
  const sim=run(state,[decl('Shinobi','THIEFS_HASTE','H0',{type:TARGET_TYPE.SELF}),hold('G0')],0x212,false);
  assert.equal(sim.state.units.H0.resources.movementMax,48);
  assert.equal(sim.state.units.H0.resources.movementRemaining,48);
});

test('Bleed Imbue refreshes a single Bleed status rather than stacking independent Bleeds',()=>{
  const state=createBattleState({matchId:'BLEED-REFRESH',units:[
    unit('Shinobi','H0',SIDE.A,{row:3,col:4}),
    unit('Warrior','G0',SIDE.B,{row:3,col:3})
  ]});
  noDodge(state.units.G0);
  const sim=createRoundSimulation({state,declarations:[decl('Shinobi','SHINOBI_ATTACK'),hold('G0')],seed:0x213});
  sim.state.units.H0.statuses.push({key:'bleed_imbue',duration:3,sourceId:'H0',data:{chance:1,bleedDuration:5,pct:.15}});
  sim.state.units.H0.resources.attacksRemaining=2;
  resolveBasicAttack(sim,'H0','G0',{cycle:0,ignoreAttackInterval:true});
  const first=findStatus(sim.state.units.G0,'bleed');
  assert.equal(first.duration,5);
  first.duration=2;
  resolveBasicAttack(sim,'H0','G0',{cycle:0,ignoreAttackInterval:true});
  const bleeds=sim.state.units.G0.statuses.filter(s=>s.key==='bleed');
  assert.equal(bleeds.length,1);
  assert.equal(bleeds[0].duration,5);
  assert.equal(bleeds[0].data.pct,.15);
});

test('Cover Fire distributes its three shots across all three living enemies before repeating anyone',()=>{
  const state=create3v3BattleState({teamA:['Archer','Warrior','Cleric'],teamB:['Warrior','Barbarian','Rogue'],matchId:'COVER-3'});
  for(const id of ['G0','G1','G2']) noDodge(state.units[id]);
  const sim=run(state,[
    decl('Archer','COVER_FIRE','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'}),
    hold('H1'),hold('H2'),hold('G0'),hold('G1'),hold('G2')
  ],0x214,false);
  const attacks=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.ATTACK_START&&e.actorId==='H0');
  assert.equal(attacks.length,3);
  assert.equal(new Set(attacks.map(e=>e.targetId)).size,3);
  for(const id of ['G0','G1','G2']) assert.ok(findStatus(sim.state.units[id],'blind'),id);
});

test('Cover Fire with only two living enemies hits both before synchronized RNG assigns the third shot',()=>{
  const state=create3v3BattleState({teamA:['Archer','Warrior','Cleric'],teamB:['Warrior','Barbarian','Rogue'],matchId:'COVER-2'});
  for(const id of ['G0','G1']) noDodge(state.units[id]);
  state.units.G2.stats.hp=0;
  state.units.G2.lifeState=LIFE_STATE.DEAD;
  const sim=run(state,[
    decl('Archer','COVER_FIRE','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'}),
    hold('H1'),hold('H2'),hold('G0'),hold('G1')
  ],0x215,false);
  const targets=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.ATTACK_START&&e.actorId==='H0').map(e=>e.targetId);
  assert.equal(targets.length,3);
  assert.equal(targets[0],'G0');
  assert.equal(new Set(targets.slice(0,2)).size,2);
  const counts=targets.reduce((m,id)=>(m[id]=(m[id]??0)+1,m),{});
  assert.deepEqual(Object.values(counts).sort(),[1,2]);
  assert.ok(['G0','G1'].includes(targets[2]));
});

test('Shield Bash keeps 300% burst, 35% two-round Stun threat, and 20% physical brace as a pursuit style',()=>{
  const bash=getAbility('Paladin','SHIELD_BASH');
  assert.equal(bash.basicStyle?.damageMultiplier,3);
  assert.equal(bash.basicStyle?.attacksSet,3);
  assert.equal(bash.basicStyle?.ordinaryAttackLimit,1);
  assert.equal(bash.basicStyle?.startupDelayCycles,1);
  assert.equal(bash.basicStyle?.onHit?.chance,.35);
  assert.equal(bash.basicStyle?.onHit?.duration,2);
  assert.equal(bash.basicStyle?.selfOnFirstAttack?.data?.pct,.20);
});

test('Defensive Aura heals a randomized 40–60% max HP as focus-fire counterplay and reinforces DEF',()=>{
  const state=createBattleState({matchId:'AURA40',units:[
    unit('Cleric','H0',SIDE.A,{row:3,col:3}),
    unit('Warrior','G0',SIDE.B,{row:3,col:5})
  ]});
  const cleric=state.units.H0;
  cleric.stats.hp=Math.floor(cleric.stats.maxHP*.20);
  const before=cleric.stats.hp;
  const minExpected=Math.floor(cleric.stats.maxHP*.40);
  const maxExpected=Math.floor(cleric.stats.maxHP*.60);
  const sim=run(state,[decl('Cleric','DEFENSIVE_AURA','H0',{type:TARGET_TYPE.SELF}),hold('G0')],0x216,false);
  const healed=sim.state.units.H0.stats.hp-before;
  assert.ok(healed>=minExpected && healed<=maxExpected,`heal ${healed} should be within ${minExpected}–${maxExpected}`);
  assert.ok(findStatus(sim.state.units.H0,'def_up'));
});
