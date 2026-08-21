import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_KIND,
  ACTION_RUNTIME_STATE,
  CONTROL_TYPE,
  EVENT_TYPE,
  SIDE,
  TARGET_TYPE,
  applyControlEffect,
  createBattleState,
  createHoldDeclaration,
  createRosterAbilityDeclaration,
  createRosterCombatScheduler,
  createRosterUnit,
  createRoundSimulation,
  expireControlEffect,
  startPendingRosterActions
} from '../src/index.js';

function pair(a='Paladin', b='Barbarian', apos={row:3,col:3}, bpos={row:3,col:5}) {
  return createBattleState({
    matchId: 'S19_1',
    units: [
      createRosterUnit({ archetypeId:a, unitId:'H0', side:SIDE.A, draftSlot:0, position:apos }),
      createRosterUnit({ archetypeId:b, unitId:'G0', side:SIDE.B, draftSlot:0, position:bpos })
    ]
  });
}
function hold(id) {
  return createHoldDeclaration({ declarationId:`D1:${id}`, roundNumber:1, actorId:id });
}
function abilityDecl(archetypeId, abilityId, target={type:TARGET_TYPE.UNIT, unitId:'G0'}) {
  return createRosterAbilityDeclaration({ roundNumber:1, actorId:'H0', archetypeId, abilityId, target });
}
function makeSim(state, declaration, seed=0x191) {
  return createRoundSimulation({ state, declarations:[declaration, hold('G0')], seed });
}

// A status carried into a new round must gate a delayed physical action before it starts.
test('pre-existing STUN prevents pending physical ABILITY from starting', () => {
  const state = pair('Rogue','Barbarian');
  state.units.H0.statuses.push({ key:'stun', duration:2, sourceId:'G0', data:{} });
  const sim = makeSim(state, abilityDecl('Rogue','EXPOSE'));
  const scheduler = createRosterCombatScheduler(sim,{countersEnabled:false});
  scheduler.advanceCycle();
  const r = sim.runtimes['R1:H0'];
  assert.equal(r.state, ACTION_RUNTIME_STATE.INTERRUPTED);
  assert.equal(r.metadata.interruptReason, 'STUN');
  assert.equal(sim.events.snapshot().some(e => e.type===EVENT_TYPE.ACTION_START && e.actorId==='H0'), false);
  assert.equal(sim.events.snapshot().some(e => e.type===EVENT_TYPE.ACTION_INTERRUPT && e.actorId==='H0' && e.payload.preventedStart===true), true);
});

test('pre-existing STUN prevents ITEM start and does not spend its limited use', () => {
  const state = pair('Shinobi','Warrior');
  state.units.H0.statuses.push({ key:'stun', duration:2, sourceId:'G0', data:{} });
  const sim = makeSim(state, abilityDecl('Shinobi','REGEN_POTION',{type:TARGET_TYPE.SELF}));
  createRosterCombatScheduler(sim,{countersEnabled:false}).advanceCycle();
  const r = sim.runtimes['R1:H0'];
  assert.equal(r.state, ACTION_RUNTIME_STATE.INTERRUPTED);
  assert.equal(sim.state.units.H0.limitedUses.potion_regen, 3);
  assert.equal(sim.events.snapshot().some(e => e.type===EVENT_TYPE.ITEM_START && e.actorId==='H0'), false);
});

test('SILENCE does not prevent an ordinary physical ABILITY from charging', () => {
  const state = pair('Rogue','Barbarian');
  state.units.H0.statuses.push({ key:'silence', duration:2, sourceId:'G0', data:{} });
  const sim = makeSim(state, abilityDecl('Rogue','EXPOSE'));
  createRosterCombatScheduler(sim,{countersEnabled:false}).advanceCycle();
  const r = sim.runtimes['R1:H0'];
  assert.equal(r.actionKind, ACTION_KIND.ABILITY);
  assert.equal(r.state, ACTION_RUNTIME_STATE.CHARGING);
  assert.equal(sim.events.snapshot().some(e => e.type===EVENT_TYPE.ACTION_START && e.actorId==='H0'), true);
});

test('TAUNT explicitly interrupts charging physical ABILITY then forces basic engagement', () => {
  const state = pair('Rogue','Barbarian');
  const sim = makeSim(state, abilityDecl('Rogue','EXPOSE'));
  startPendingRosterActions(sim,0);
  assert.equal(sim.runtimes['R1:H0'].state, ACTION_RUNTIME_STATE.CHARGING);
  const out = applyControlEffect(sim,'H0',{type:CONTROL_TYPE.TAUNT,sourceId:'G0',duration:2,cycle:0});
  const r = sim.runtimes['R1:H0'];
  assert.ok(out.actionInterruptEventId);
  assert.equal(r.actionKind, ACTION_KIND.BASIC_ATTACK);
  assert.equal(r.state, ACTION_RUNTIME_STATE.ACTIVE);
  assert.equal(r.currentForcedTargetId,'G0');
  assert.equal(sim.events.snapshot().some(e => e.type===EVENT_TYPE.ACTION_INTERRUPT && e.actorId==='H0' && e.payload.reason==='TAUNT'), true);
});

test('TAUNT expiry does not restart an interrupted physical ABILITY', () => {
  const state = pair('Rogue','Barbarian');
  const sim = makeSim(state, abilityDecl('Rogue','EXPOSE'));
  startPendingRosterActions(sim,0);
  applyControlEffect(sim,'H0',{type:CONTROL_TYPE.TAUNT,sourceId:'G0',duration:2,cycle:0});
  expireControlEffect(sim,'H0',CONTROL_TYPE.TAUNT,{cycle:1});
  const r = sim.runtimes['R1:H0'];
  assert.equal(r.actionKind,ACTION_KIND.ABILITY);
  assert.equal(r.actionId,'EXPOSE');
  assert.equal(r.state,ACTION_RUNTIME_STATE.INTERRUPTED);
  assert.equal(r.interrupted,true);
});

test('STUN interrupts a charging ITEM with ITEM_INTERRUPT and charge remains spent', () => {
  const state = pair('Shinobi','Warrior');
  state.units.H0.stats.hp -= 200;
  const sim = makeSim(state, abilityDecl('Shinobi','REGEN_POTION',{type:TARGET_TYPE.SELF}));
  startPendingRosterActions(sim,0);
  assert.equal(sim.state.units.H0.limitedUses.potion_regen,2);
  applyControlEffect(sim,'H0',{type:CONTROL_TYPE.STUN,sourceId:'G0',duration:1,cycle:0});
  const r=sim.runtimes['R1:H0'];
  assert.equal(r.state,ACTION_RUNTIME_STATE.INTERRUPTED);
  assert.equal(sim.state.units.H0.limitedUses.potion_regen,2);
  const events=sim.events.snapshot();
  const itemInterrupt=events.find(e=>e.type===EVENT_TYPE.ITEM_INTERRUPT&&e.actorId==='H0');
  const actionInterrupt=events.find(e=>e.type===EVENT_TYPE.ACTION_INTERRUPT&&e.actorId==='H0'&&e.payload.reason==='STUN');
  assert.ok(itemInterrupt);
  assert.ok(actionInterrupt);
  assert.equal(actionInterrupt.parentEventId,itemInterrupt.eventId);
});

test('pre-existing TAUNT prevents delayed ABILITY start and converts it before scheduler start pass', () => {
  const state=pair('Rogue','Barbarian');
  state.units.H0.statuses.push({key:'taunt',duration:2,sourceId:'G0',data:{}});
  const sim=makeSim(state,abilityDecl('Rogue','EXPOSE'));
  createRosterCombatScheduler(sim,{countersEnabled:false}).advanceCycle();
  const r=sim.runtimes['R1:H0'];
  assert.equal(r.actionKind,ACTION_KIND.BASIC_ATTACK);
  assert.equal(r.currentForcedTargetId,'G0');
  assert.equal(sim.events.snapshot().some(e=>e.type===EVENT_TYPE.ACTION_START&&e.actorId==='H0'&&e.payload.actionId==='EXPOSE'),false);
  assert.equal(sim.events.snapshot().some(e=>e.type===EVENT_TYPE.ACTION_INTERRUPT&&e.actorId==='H0'&&e.payload.reason==='TAUNT'),true);
});

test('same hard-control patch scenario replays deterministically', () => {
  function run(seed){
    const state=pair('Rogue','Barbarian');
    const sim=makeSim(state,abilityDecl('Rogue','EXPOSE'),seed);
    startPendingRosterActions(sim,0);
    applyControlEffect(sim,'H0',{type:CONTROL_TYPE.BERSERK,sourceId:'G0',duration:2,cycle:0});
    return sim;
  }
  const a=run(0x9911), b=run(0x9911);
  assert.deepEqual(a.state,b.state);
  assert.deepEqual(a.events.snapshot(),b.events.snapshot());
  assert.equal(a.rng.drawCount,b.rng.drawCount);
  assert.equal(a.rng.state,b.rng.state);
});
