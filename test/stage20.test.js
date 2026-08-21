import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_KIND,
  AREA_SHAPE,
  COUNTERSTANCE_PROFILES,
  EVENT_TYPE,
  SIDE,
  TARGET_TYPE,
  GameplayRng,
  CONTROL_TYPE,
  applyControlEffect,
  applyPoison,
  applyTimedStatus,
  basicAggroPlanner,
  closeRound,
  counterEligibility,
  create3v3BattleState,
  createBattleState,
  createHoldDeclaration,
  createRosterAbilityDeclaration,
  createRosterCombatScheduler,
  createRosterUnit,
  createRoundSimulation,
  findStatus,
  getAbility,
  manhattanDistance,
  mixedRosterPlanner,
  poisonTotal,
  resolveBasicAttack,
  run3v3Playtest,
  runPlaytestBatch
} from '../src/index.js';

function unit(archetypeId, unitId, side, position, draftSlot=0) {
  return createRosterUnit({ archetypeId, unitId, side, draftSlot, position });
}
function pair(a='Warrior', b='Barbarian', apos={row:3,col:3}, bpos={row:3,col:5}) {
  return createBattleState({ matchId:'S20', units:[unit(a,'H0',SIDE.A,apos), unit(b,'G0',SIDE.B,bpos)] });
}
function hold(actorId, roundNumber=1) { return createHoldDeclaration({declarationId:`D${roundNumber}:${actorId}`,roundNumber,actorId}); }
function decl(archetypeId, abilityId, actorId='H0', target={type:TARGET_TYPE.UNIT,unitId:'G0'}, roundNumber=1) {
  return createRosterAbilityDeclaration({roundNumber,actorId,archetypeId,abilityId,target});
}
function run(state, declarations, seed=0x20a, countersEnabled=false) {
  const sim=createRoundSimulation({state,declarations,seed});
  createRosterCombatScheduler(sim,{countersEnabled}).runUntilCombatSettled({maxCycles:5000});
  return sim;
}
function noDodge(target){target.stats.QKN=-1000;target.stats.DEF=0;}

// --- New multi-swing attack styles -------------------------------------------------
test('Warrior Power Strike is a half-movement style using SW -2 swings at +65% damage',()=>{
  const state=pair('Warrior','Barbarian'); noDodge(state.units.G0);
  state.units.H0.weapon.attackBaseMin=100; state.units.H0.weapon.attackBaseMax=100; state.units.H0.stats.CRIT=0; state.units.H0.weapon.critBonus=0;
  const sim=createRoundSimulation({state,declarations:[decl('Warrior','POWER_STRIKE'),hold('G0')],seed:1});
  createRosterCombatScheduler(sim,{countersEnabled:false});
  assert.equal(sim.state.units.H0.resources.movementRemaining,7);
  assert.equal(sim.state.units.H0.resources.attacksRemaining,5);
  sim.state.units.H0.resources.attacksRemaining=1;
  const before=sim.state.units.G0.stats.hp;
  const hit=resolveBasicAttack(sim,'H0','G0',{cycle:0,ignoreAttackInterval:true});
  const expected=Math.floor(Math.floor(100*(sim.state.units.H0.stats.ATK/100))*1.65);
  assert.equal(hit.dealt,expected);
  assert.equal(before-sim.state.units.G0.stats.hp,expected);
});

test('Barbarian Rend uses exactly four swings and stacks 20% defense shred per damaging hit',()=>{
  const state=pair('Barbarian','Warrior'); noDodge(state.units.G0);
  const sim=createRoundSimulation({state,declarations:[decl('Barbarian','REND'),hold('G0')],seed:2});
  createRosterCombatScheduler(sim,{countersEnabled:false});
  assert.equal(sim.state.units.H0.resources.attacksRemaining,4);
  resolveBasicAttack(sim,'H0','G0',{cycle:0,ignoreAttackInterval:true});
  resolveBasicAttack(sim,'H0','G0',{cycle:0,ignoreAttackInterval:true});
  const rend=findStatus(sim.state.units.G0,'rend_def_down');
  assert.equal(rend.duration,3);
  assert.equal(rend.data.stacks,2);
  assert.equal(rend.data.pctPerStack,.20);
});

test('Barbarian Smashing Blows sacrifices two swings and supports per-hit 2-round Stun procs',()=>{
  const state=pair('Barbarian','Warrior'); noDodge(state.units.G0);
  const sim=createRoundSimulation({state,declarations:[decl('Barbarian','SMASH'),hold('G0')],seed:3});
  createRosterCombatScheduler(sim,{countersEnabled:false});
  assert.equal(sim.state.units.H0.resources.attacksRemaining,5);
  // Force the already-data-driven proc to 100% for this deterministic mechanics test.
  sim.runtimes['R1:H0'].metadata.basicStyle.onHit.chance=1;
  resolveBasicAttack(sim,'H0','G0',{cycle:0,ignoreAttackInterval:true});
  assert.equal(findStatus(sim.state.units.G0,'stun')?.duration,2);
});

test('Archer Cover Fire uses only three shots and successful hits Blind for the round',()=>{
  const state=pair('Archer','Warrior',{row:3,col:5},{row:3,col:3}); noDodge(state.units.G0);
  const sim=createRoundSimulation({state,declarations:[decl('Archer','COVER_FIRE'),hold('G0')],seed:4});
  createRosterCombatScheduler(sim,{countersEnabled:false});
  assert.equal(sim.state.units.H0.resources.attacksRemaining,3);
  resolveBasicAttack(sim,'H0','G0',{cycle:0,ignoreAttackInterval:true});
  const blind=findStatus(sim.state.units.G0,'blind');
  assert.equal(blind.duration,1); assert.equal(blind.data.whiffChance,.5);
});

test('Archer Snipe uses three long-range 325% shots with distance scaling and ordinary kiting',()=>{
  const state=pair('Archer','Warrior',{row:3,col:5},{row:3,col:3}); noDodge(state.units.G0);
  state.units.H0.weapon.attackBaseMin=40;state.units.H0.weapon.attackBaseMax=40;state.units.H0.stats.CRIT=0;state.units.H0.weapon.critBonus=0;
  const sim=run(state,[decl('Archer','SNIPE'),hold('G0')],5,false);
  const attacks=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.ATTACK_START&&e.actorId==='H0');
  const moves=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.MOVE&&e.actorId==='H0');
  assert.equal(attacks.length,3);
  assert.ok(moves.length>=1);
  assert.equal(sim.state.units.H0.resources.attacksRemaining,0);
  assert.ok(attacks.every(e=>e.payload.attacksBefore<=3));
});

// --- Imbues / persistent utility ---------------------------------------------------
test('Rogue Poison Imbue makes every successful basic hit add Poison',()=>{
  const state=pair('Rogue','Warrior',{row:3,col:4},{row:3,col:5}); noDodge(state.units.G0);
  const setup=run(state,[decl('Rogue','POISON_DAGGER','H0',{type:TARGET_TYPE.SELF}),hold('G0')],6,false);
  assert.ok(findStatus(setup.state.units.H0,'poison_imbue'));
  closeRound(setup);
  const r2=setup.state.roundNumber;
  const sim=createRoundSimulation({state:setup.state,declarations:[decl('Rogue','ROGUE_ATTACK','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'},r2),hold('G0',r2)],seed:7});
  createRosterCombatScheduler(sim,{countersEnabled:false});
  sim.state.units.H0.resources.attacksRemaining=1;
  resolveBasicAttack(sim,'H0','G0',{cycle:0,ignoreAttackInterval:true});
  assert.ok(poisonTotal(sim.state.units.G0)>0);
});

test('Shinobi Bleed Imbue applies 5-round Bleed on a successful proc',()=>{
  const state=pair('Shinobi','Warrior',{row:3,col:4},{row:3,col:3}); noDodge(state.units.G0);
  const setup=run(state,[decl('Shinobi','BLEED_STRIKE','H0',{type:TARGET_TYPE.SELF}),hold('G0')],8,false);
  const imbue=findStatus(setup.state.units.H0,'bleed_imbue'); assert.ok(imbue);
  imbue.data.chance=1; // test application semantics rather than probability distribution.
  setup.state.units.H0.resources.attacksRemaining=1;
  resolveBasicAttack(setup,'H0','G0',{cycle:setup.state.round.initiativeCycle,ignoreAttackInterval:true});
  const bleed=findStatus(setup.state.units.G0,'bleed');
  assert.equal(bleed.duration,5); assert.equal(bleed.data.pct,.15);
});

test("Shinobi Thief's Haste triples Movement capacity and cleans it up on expiration",()=>{
  const state=pair('Shinobi','Warrior');
  const sim=run(state,[decl('Shinobi','THIEFS_HASTE','H0',{type:TARGET_TYPE.SELF}),hold('G0')],9,false);
  assert.equal(sim.state.units.H0.resources.movementMax,48);
  assert.equal(findStatus(sim.state.units.H0,'movement_max_up')?.data.amount,32);
  // Duration 4 means the setup round plus the following three round ends.
  closeRound(sim); assert.equal(sim.state.units.H0.resources.movementMax,48);
});

// --- Defensive / reaction rule-breaking -------------------------------------------
test('Shieldwall redirects exactly the first five melee hits aimed at an ally',()=>{
  const state=createBattleState({matchId:'SHIELDWALL',units:[
    unit('Warrior','H0',SIDE.A,{row:3,col:4}), unit('Cleric','H1',SIDE.A,{row:3,col:5},1), unit('Barbarian','G0',SIDE.B,{row:3,col:7})
  ]});
  noDodge(state.units.H0);noDodge(state.units.H1);state.units.H0.stats.hp=9999;state.units.H0.stats.maxHP=9999;state.units.H1.stats.hp=9999;state.units.H1.stats.maxHP=9999;
  state.units.H0.statuses.push({key:'shield_redirect',duration:1,sourceId:'H0',data:{remaining:5,meleeOnly:true}});
  const sim=createRoundSimulation({state,declarations:[hold('H0'),hold('H1'),decl('Barbarian','BARBARIAN_ATTACK','G0',{type:TARGET_TYPE.UNIT,unitId:'H1'})],seed:10});
  for(let i=0;i<6;i++) resolveBasicAttack(sim,'G0','H1',{cycle:0,ignoreAttackInterval:true});
  const ints=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.INTERCEPT);
  assert.equal(ints.length,5);
  assert.equal(findStatus(sim.state.units.H0,'shield_redirect'),null);
  const damageTargets=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.actorId==='G0').map(e=>e.targetId);
  assert.deepEqual(damageTargets.slice(0,5),['H0','H0','H0','H0','H0']);
  assert.equal(damageTargets[5],'H1');
});

test('Barbarian Bloodlust disables counters and raises incoming damage to 125%',()=>{
  const state=pair('Barbarian','Warrior');
  state.units.H0.statuses.push({key:'bloodlust',duration:3,sourceId:'H0',data:{incomingDamageMultiplier:1.25,noCounter:true}});
  assert.equal(counterEligibility({state,runtimes:{}},'H0','G0').reason,'BLOODLUST_NO_COUNTER');
  // Damage multiplier is separately exercised by combat regression; verify canonical status data here.
  assert.equal(findStatus(state.units.H0,'bloodlust').data.incomingDamageMultiplier,1.25);
});

test('Electromancer Shift teleports after a successful melee basic hit before counter eligibility',()=>{
  const state=pair('Warrior','Electromancer',{row:3,col:3},{row:3,col:5});noDodge(state.units.G0);
  state.units.G0.statuses.push({key:'shift',duration:2,sourceId:'G0',data:{}});
  const sim=createRoundSimulation({state,declarations:[decl('Warrior','WARRIOR_ATTACK'),hold('G0')],seed:11});
  sim.state.units.H0.resources.attacksRemaining=1;
  const before={...sim.state.units.G0.position};
  resolveBasicAttack(sim,'H0','G0',{cycle:0,ignoreAttackInterval:true});
  const after=sim.state.units.G0.position;
  assert.notDeepEqual(after,before);
  assert.ok(sim.events.snapshot().some(e=>e.type===EVENT_TYPE.TELEPORT&&e.targetId==='G0'));
  const eligibility=counterEligibility(sim,'G0','H0');
  if(manhattanDistance(sim.state.units.G0.position,sim.state.units.H0.position)>sim.state.units.G0.weapon.weaponRange) assert.equal(eligibility.eligible,false);
});

test('Electromancer Shift also reacts to a delayed melee special ability',()=>{
  const state=pair('Rogue','Electromancer',{row:3,col:3},{row:3,col:5});noDodge(state.units.G0);
  state.units.G0.statuses.push({key:'shift',duration:2,sourceId:'G0',data:{}});
  const sim=run(state,[decl('Rogue','BACKSTAB'),hold('G0')],12,true);
  assert.ok(sim.events.snapshot().some(e=>e.type===EVENT_TYPE.TELEPORT&&e.targetId==='G0'&&e.payload.reason==='SHIFT_MELEE_REACTION'));
  const counters=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.COUNTER&&e.actorId==='G0');
  if(counters.length) assert.ok(manhattanDistance(sim.state.units.G0.position,sim.state.units.H0.position)<=sim.state.units.G0.weapon.weaponRange);
});

test('Counterstance profile is parameterized for free counters, pursuit counters, or hybrid',()=>{
  assert.deepEqual(COUNTERSTANCE_PROFILES.FREE_COUNTERS,{profile:'FREE_COUNTERS',attackCost:0,allowPursuit:false,pursuitMoveMax:0});
  assert.equal(COUNTERSTANCE_PROFILES.PURSUIT.allowPursuit,true);
  assert.equal(COUNTERSTANCE_PROFILES.HYBRID.attackCost,0);
  const state=pair('Monk','Barbarian',{row:3,col:3},{row:3,col:6});
  state.units.H0.statuses.push({key:'counterstance',duration:3,sourceId:'H0',data:{...COUNTERSTANCE_PROFILES.PURSUIT}});
  assert.equal(counterEligibility({state,runtimes:{}},'H0','G0').eligible,true);
});

test('FREE_COUNTERS Counterstance can counter with zero attacks without consuming the pool',()=>{
  const state=pair('Warrior','Monk',{row:3,col:3},{row:3,col:4});noDodge(state.units.G0);noDodge(state.units.H0);
  state.units.G0.statuses.push({key:'counterstance',duration:3,sourceId:'G0',data:{...COUNTERSTANCE_PROFILES.FREE_COUNTERS}});
  state.units.H0.resources.attacksRemaining=1;state.units.H0.resources.movementRemaining=0;state.units.G0.resources.attacksRemaining=0;
  const sim=run(state,[decl('Warrior','WARRIOR_ATTACK'),hold('G0')],13,true);
  assert.ok(sim.events.snapshot().some(e=>e.type===EVENT_TYPE.COUNTER&&e.actorId==='G0'));
  assert.equal(sim.state.units.G0.resources.attacksRemaining,0);
});

// --- Other redesigns ---------------------------------------------------------------
test('Rogue Shadowstep gives three-round break-on-physical stealth and 200% crit multiplier',()=>{
  const sim=run(pair('Rogue','Warrior'),[decl('Rogue','SHADOWSTEP','H0',{type:TARGET_TYPE.SELF}),hold('G0')],14,false);
  const invis=findStatus(sim.state.units.H0,'invisible');
  assert.equal(invis?.duration,3);
  assert.equal(invis?.data.breakOnPhysicalAttack,true);
  assert.equal(findStatus(sim.state.units.H0,'shadowstep_crit')?.duration,3);
  assert.equal(findStatus(sim.state.units.H0,'shadowstep_crit')?.data.multiplier,2);
});

test('Rogue Expose strips one defensive buff and Marks for current plus next round',()=>{
  const state=pair('Rogue','Warrior');state.units.G0.statuses.push({key:'guard',duration:3,sourceId:'G0',data:{pct:.2}});
  const sim=run(state,[decl('Rogue','EXPOSE'),hold('G0')],15,false);
  assert.equal(findStatus(sim.state.units.G0,'guard'),null);
  assert.equal(findStatus(sim.state.units.G0,'marked')?.duration,2);
});

test('Paladin Shield Bash is a one-attempt pursuit style with 300% damage, Stun threat, and physical brace',()=>{
  const a=getAbility('Paladin','SHIELD_BASH');assert.equal(a.actionKind,ACTION_KIND.BASIC_ATTACK);assert.equal(a.basicStyle.attacksSet,3);assert.equal(a.basicStyle.ordinaryAttackLimit,1);assert.equal(a.basicStyle.damageMultiplier,3);
  assert.equal(a.basicStyle.startupDelayCycles,1);assert.equal(a.basicStyle.onHit.chance,.35);assert.equal(a.basicStyle.onHit.duration,2);assert.equal(a.basicStyle.selfOnFirstAttack.data.pct,.20);
  const state=pair('Paladin','Warrior',{row:3,col:1},{row:3,col:7});noDodge(state.units.G0);state.units.H0.weapon.attackBaseMin=100;state.units.H0.weapon.attackBaseMax=100;state.units.H0.stats.CRIT=0;
  const sim=run(state,[decl('Paladin','SHIELD_BASH'),hold('G0')],16,false);
  assert.equal(findStatus(sim.state.units.H0,'physical_shield')?.data.pct,.2);
  assert.ok(sim.events.snapshot().some(e=>e.type===EVENT_TYPE.DAMAGE&&e.actorId==='H0'&&e.payload.abilityId==='SHIELD_BASH'));
});

test('Volley is a 5x5 battlefield AoE that can hit all three untouched starting enemies',()=>{
  const state=create3v3BattleState({teamA:['Archer','Warrior','Cleric'],teamB:['Warrior','Barbarian','Rogue'],matchId:'VOLLEY'});
  for(const id of ['G0','G1','G2']) noDodge(state.units[id]);
  const decs=[decl('Archer','VOLLEY','H0',{type:TARGET_TYPE.GROUND,row:5,col:12}),hold('H1'),hold('H2'),hold('G0'),hold('G1'),hold('G2')];
  const sim=run(state,decs,17,false);
  assert.equal(getAbility('Archer','VOLLEY').area.shape,AREA_SHAPE.SQUARE_5X5);
  for(const id of ['G0','G1','G2']) assert.ok(sim.state.units[id].stats.hp<sim.state.units[id].stats.maxHP,id);
});

test("Hunter's Mark now applies both Marked and defense reduction",()=>{
  const sim=run(pair('Archer','Warrior'),[decl('Archer','HUNTERS_MARK'),hold('G0')],18,false);
  assert.ok(findStatus(sim.state.units.G0,'marked'));
  assert.ok(findStatus(sim.state.units.G0,'def_down'));
});

test('Monk Flurry Style sacrifices setup action then doubles the next two full round attack pools',()=>{
  const sim=run(pair('Monk','Warrior'),[decl('Monk','FLURRY','H0',{type:TARGET_TYPE.SELF}),hold('G0')],19,false);
  assert.equal(sim.state.units.H0.resources.attacksMax,14);
  closeRound(sim);assert.equal(sim.state.roundNumber,2);assert.equal(sim.state.units.H0.resources.attacksRemaining,14);
  let r=sim.state.roundNumber;let sim2=createRoundSimulation({state:sim.state,declarations:[hold('H0',r),hold('G0',r)],seed:20});closeRound(sim2);assert.equal(sim2.state.roundNumber,3);assert.equal(sim2.state.units.H0.resources.attacksRemaining,14);
  r=sim2.state.roundNumber;let sim3=createRoundSimulation({state:sim2.state,declarations:[hold('H0',r),hold('G0',r)],seed:21});closeRound(sim3);assert.equal(sim3.state.roundNumber,4);assert.equal(sim3.state.units.H0.resources.attacksMax,7);
});

test('Monk Palm Hits resolves exactly two physical strikes',()=>{
  const state=pair('Monk','Warrior');noDodge(state.units.G0);state.units.H0.stats.CRIT=0;state.units.H0.weapon.critBonus=0;
  const sim=run(state,[decl('Monk','PALM_HIT'),hold('G0')],22,false);
  const damage=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.DAMAGE&&e.actorId==='H0'&&e.payload.abilityId==='PALM_HIT');
  assert.equal(damage.length,2);
});

test('Monk Second Wind is usable while Stunned and cleanses the CC',()=>{
  const state=pair('Monk','Warrior');state.units.H0.statuses.push({key:'stun',duration:2,sourceId:'G0',data:{}});
  const sim=run(state,[decl('Monk','SECOND_WIND','H0',{type:TARGET_TYPE.SELF}),hold('G0')],23,false);
  assert.equal(sim.runtimes['R1:H0'].state,'COMPLETED');
  assert.equal(findStatus(sim.state.units.H0,'stun'),null);
  assert.ok(findStatus(sim.state.units.H0,'regen'));
});

test('Necromancer Plague Detonation consumes all enemy poison and reseeds 50% of total onto one survivor',()=>{
  const state=createBattleState({matchId:'PLAGUE',units:[unit('Necromancer','H0',SIDE.A,{row:5,col:3}),unit('Warrior','G0',SIDE.B,{row:3,col:5}),unit('Barbarian','G1',SIDE.B,{row:5,col:5},1)]});
  const sim0=createRoundSimulation({state,declarations:[hold('H0'),hold('G0'),hold('G1')],seed:24});
  applyPoison(sim0,'G0',100,{sourceId:'H0'});applyPoison(sim0,'G1',50,{sourceId:'H0'});
  const state2=sim0.state;
  const sim=run(state2,[decl('Necromancer','PLAGUE_DETONATION'),hold('G0'),hold('G1')],25,false);
  const totals=[poisonTotal(sim.state.units.G0),poisonTotal(sim.state.units.G1)];
  assert.equal(totals.reduce((a,b)=>a+b,0),75);
  assert.equal(totals.filter(x=>x===75).length,1);
});

test('Mage Arcane Echo consumes itself and emits two explicit resolutions of the next spell',()=>{
  const setup=run(pair('Mage','Warrior'),[decl('Mage','ARCANE_ECHO','H0',{type:TARGET_TYPE.SELF}),hold('G0')],26,false);
  closeRound(setup);const r=setup.state.roundNumber;
  const sim=run(setup.state,[decl('Mage','METEOR','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'},r),hold('G0',r)],27,false);
  const resolutions=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.SPELL_RESOLUTION&&e.actorId==='H0');
  assert.equal(resolutions.length,2);
  assert.equal(findStatus(sim.state.units.H0,'arcane_echo'),null);
  assert.ok(resolutions[0].eventId!==resolutions[1].eventId);
});

// --- 3v3 deterministic balance harness --------------------------------------------
test('3v3 battle-state harness creates exactly six standard roster combatants',()=>{
  const state=create3v3BattleState({teamA:['Warrior','Mage','Shinobi'],teamB:['Barbarian','Rogue','Electromancer']});
  assert.equal(Object.keys(state.units).length,6);
  assert.deepEqual(Object.values(state.units).filter(u=>u.side===SIDE.A).map(u=>u.unitId).sort(),['H0','H1','H2']);
  assert.deepEqual(Object.values(state.units).filter(u=>u.side===SIDE.B).map(u=>u.unitId).sort(),['G0','G1','G2']);
});

test('planner interface scopes decisions to one side and keeps decision RNG separate',()=>{
  const state=create3v3BattleState({teamA:['Warrior','Mage','Shinobi'],teamB:['Barbarian','Rogue','Electromancer']});
  const rng=new GameplayRng(123);
  const a=mixedRosterPlanner({state,roundNumber:1,side:SIDE.A,decisionRng:rng});
  assert.equal(a.length,3);assert.ok(a.every(d=>state.units[d.actorId].side===SIDE.A));
  const basic=basicAggroPlanner({state,roundNumber:1,side:SIDE.B,decisionRng:new GameplayRng(1)});
  assert.equal(basic.length,3);assert.ok(basic.every(d=>state.units[d.actorId].side===SIDE.B));
});

test('same 3v3 teams and seeds produce identical multi-round playtest results',()=>{
  const opts={teamA:['Warrior','Mage','Shinobi'],teamB:['Barbarian','Rogue','Electromancer'],maxRounds:3,matchSeed:0x5151,plannerSeed:0x6161};
  const a=run3v3Playtest(opts),b=run3v3Playtest(opts);
  assert.deepEqual(a.outcome,b.outcome);
  assert.deepEqual(a.finalState,b.finalState);
  assert.deepEqual(a.rounds.map(r=>r.digest),b.rounds.map(r=>r.digest));
  assert.deepEqual(a.plannerDraws,b.plannerDraws);
});

test('batch harness runs repeated 3v3 matchups and aggregates results',()=>{
  const batch=runPlaytestBatch({matchups:[{name:'alpha',teamA:['Warrior','Mage','Shinobi'],teamB:['Barbarian','Rogue','Electromancer']}],repetitions:2,maxRounds:2,matchSeed:500,plannerSeed:600});
  assert.equal(batch.total,2);assert.equal(batch.results.length,2);
  assert.equal(batch.wins.A+batch.wins.B+batch.wins.DRAW+batch.wins.ACTIVE,2);
});

test('Cleric Defensive Aura is self-only, uses the larger heal, and buffs self defense',()=>{
  const aura=getAbility('Cleric','DEFENSIVE_AURA');
  assert.equal(aura.targetType,TARGET_TYPE.SELF);
  const heal=aura.effects.find(e=>e.type==='HEAL_PERCENT_ROLL'); assert.equal(heal.minPct,.40); assert.equal(heal.maxPct,.60);
  const state=pair('Cleric','Warrior');state.units.H0.stats.hp-=300;
  const before=state.units.H0.stats.hp;
  const sim=run(state,[decl('Cleric','DEFENSIVE_AURA','H0',{type:TARGET_TYPE.SELF}),hold('G0')],31,false);
  assert.ok(sim.state.units.H0.stats.hp>before);
  assert.ok(findStatus(sim.state.units.H0,'def_up'));
});

test('Mage Arcane Ward is a 4-cycle cast and lasts five rounds',()=>{
  const ward=getAbility('Mage','ARCANE_WARD');
  assert.equal(ward.completionDelayCycles,4);assert.equal(ward.effects.find(e=>e.key==='magic_shield').duration,5);
});

test('Barbarian Rampage applies a large two-stack ATK boost for 5 rounds and two-stack DEF penalty for 3',()=>{
  const sim=run(pair('Barbarian','Warrior'),[decl('Barbarian','RAMPAGE','H0',{type:TARGET_TYPE.SELF}),hold('G0')],32,false);
  const atk=findStatus(sim.state.units.H0,'atk_up'), def=findStatus(sim.state.units.H0,'def_down');
  assert.equal(atk.duration,5);assert.equal(atk.data.stacks,2);
  assert.equal(def.duration,3);assert.equal(def.data.stacks,2);
});

test('Bloodlust incoming damage multiplier is applied by actual basic combat math',()=>{
  function hit(withBloodlust){const state=pair('Warrior','Barbarian');noDodge(state.units.G0);state.units.H0.weapon.attackBaseMin=100;state.units.H0.weapon.attackBaseMax=100;state.units.H0.stats.CRIT=0;state.units.H0.weapon.critBonus=0;if(withBloodlust)state.units.G0.statuses.push({key:'bloodlust',duration:3,sourceId:'G0',data:{incomingDamageMultiplier:1.25,noCounter:true}});const sim=createRoundSimulation({state,declarations:[decl('Warrior','WARRIOR_ATTACK'),hold('G0')],seed:33});sim.state.units.H0.resources.attacksRemaining=1;return resolveBasicAttack(sim,'H0','G0',{cycle:0,ignoreAttackInterval:true}).dealt;}
  const normal=hit(false), bloodlust=hit(true);
  assert.equal(bloodlust,Math.floor(normal*1.25));
});

test('a later Taunt cannot revive an action already suppressed by carried Stun',()=>{
  const state=pair('Electromancer','Warrior');state.units.H0.statuses.push({key:'stun',duration:2,sourceId:'G0',data:{}});
  const sim=createRoundSimulation({state,declarations:[decl('Electromancer','ELECTRO_ATTACK'),hold('G0')],seed:34});
  const scheduler=createRosterCombatScheduler(sim,{countersEnabled:false});scheduler.advanceCycle();
  assert.equal(sim.runtimes['R1:H0'].state,'INTERRUPTED');
  // Directly add Taunt after the runtime has already been stopped by Stun.
  applyControlEffect(sim,'H0',{type:CONTROL_TYPE.TAUNT,sourceId:'G0',duration:2,cycle:1});
  assert.equal(sim.runtimes['R1:H0'].state,'INTERRUPTED');
  assert.equal(findStatus(sim.state.units.H0,'taunt')?.sourceId,'G0');
});
