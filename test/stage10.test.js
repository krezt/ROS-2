import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION_KIND,
  ACTION_RUNTIME_STATE,
  CONTROL_TYPE,
  DAMAGE_TYPE,
  EVENT_TYPE,
  SIDE,
  TARGET_TYPE,
  applyControlEffect,
  counterEligibility,
  createActionDeclaration,
  createBattleState,
  createHoldDeclaration,
  createRoundSimulation,
  createSpellCombatScheduler,
  createUnitState,
  hasControlStatus,
  snapshotRoundSimulation
} from '../src/index.js';

function unit({ unitId, side, position, qkn = 10, hp = 1000, attacksMax = 4, movementMax = 0, attackInterval = 1,
  weaponRange = 2, preferredRange = weaponRange, counterMoveMax = 1, damage = 10, mode = 'MELEE' }) {
  return createUnitState({
    unitId, side, draftSlot: 0, archetypeId: unitId,
    stats: { maxHP: Math.max(1, hp), hp, ATK: 100, DEF: 0, SDM: 100, CRIT: 0, QKN: qkn },
    position,
    combat: { movementMax, attacksMax, attackInterval },
    weapon: {
      weaponProfileId: `${unitId}-weapon`, mode, weaponRange, preferredRange, counterMoveMax,
      attackBaseMin: damage, attackBaseMax: damage, accuracy: 1, critBonus: 0, critMultiplier: 1.75,
      defensePenetration: 0, damageType: DAMAGE_TYPE.PHYSICAL, dodgeable: false
    }
  });
}
function spell(actorId, targetId, { delay = 3, amount = 0 } = {}) {
  return createActionDeclaration({
    declarationId: `D-${actorId}`, roundNumber: 1, actorId, actionId: 'SPELL', actionKind: ACTION_KIND.SPELL,
    target: { type: TARGET_TYPE.UNIT, unitId: targetId },
    payload: { spell: { completionDelayCycles: delay, castRange: 20, effect: amount ? { type: 'DAMAGE', amount } : null } }
  });
}
function attack(actorId, targetId) {
  return createActionDeclaration({ declarationId: `D-${actorId}`, roundNumber: 1, actorId, actionId: 'ATTACK', actionKind: ACTION_KIND.BASIC_ATTACK, target: { type: TARGET_TYPE.UNIT, unitId: targetId } });
}
function hold(actorId) { return createHoldDeclaration({ declarationId: `D-${actorId}`, roundNumber: 1, actorId }); }
function sim(units, declarations, seed = 1, board = { width: 14, height: 10 }) {
  return createRoundSimulation({ state: createBattleState({ matchId: 'stage10', roundNumber: 1, board, units }), declarations, seed });
}
function eventsOf(s, type) { return s.events.snapshot().filter((e) => e.type === type); }

for (const type of [CONTROL_TYPE.STUN, CONTROL_TYPE.SILENCE]) {
  test(`${type} immediately interrupts a charging spell`, () => {
    const s = sim([
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 } }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, attacksMax: 0 })
    ], [spell('H0', 'G0', { delay: 4 }), hold('G0')]);
    const scheduler = createSpellCombatScheduler(s);
    scheduler.advanceCycle();
    const out = applyControlEffect(s, 'H0', { type, sourceId: 'G0', cycle: 1 });
    assert.equal(out.interruptedCast, true);
    assert.equal(s.runtimes['R1:H0'].state, ACTION_RUNTIME_STATE.INTERRUPTED);
    assert.equal(eventsOf(s, EVENT_TYPE.CAST_INTERRUPT).length, 1);
    for (let i = 0; i < 5; i += 1) scheduler.advanceCycle();
    assert.equal(eventsOf(s, EVENT_TYPE.CAST_COMPLETE).length, 0);
  });
}

test('ordinary melee damage does NOT interrupt a charging spell', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 4 }, hp: 100 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, attacksMax: 1, damage: 10 })
  ], [spell('H0', 'G0', { delay: 3 }), attack('G0', 'H0')]);
  createSpellCombatScheduler(s).advanceCycle();
  assert.equal(s.state.units.H0.stats.hp, 90);
  assert.equal(s.runtimes['R1:H0'].state, ACTION_RUNTIME_STATE.CHARGING);
  assert.equal(eventsOf(s, EVENT_TYPE.CAST_INTERRUPT).length, 0);
});

test('lethal melee damage interrupts cast with DEATH and prevents completion', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 4 }, hp: 5 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, attacksMax: 1, damage: 10 })
  ], [spell('H0', 'G0', { delay: 3 }), attack('G0', 'H0')]);
  const scheduler = createSpellCombatScheduler(s);
  scheduler.advanceCycle();
  assert.equal(s.state.units.H0.lifeState, 'DEAD');
  assert.equal(s.runtimes['R1:H0'].state, ACTION_RUNTIME_STATE.INTERRUPTED);
  assert.equal(s.runtimes['R1:H0'].metadata.interruptReason, 'DEATH');
  assert.equal(eventsOf(s, EVENT_TYPE.CAST_INTERRUPT).length, 1);
  scheduler.advanceCycle(); scheduler.advanceCycle(); scheduler.advanceCycle();
  assert.equal(eventsOf(s, EVENT_TYPE.CAST_COMPLETE).length, 0);
});

test('lethal spell damage interrupts another charging caster at the same boundary', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 }, qkn: 20, attacksMax: 0 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, qkn: 10, hp: 40, attacksMax: 0 })
  ], [spell('H0', 'G0', { delay: 2, amount: 50 }), spell('G0', 'H0', { delay: 2, amount: 50 })]);
  const scheduler = createSpellCombatScheduler(s);
  scheduler.advanceCycle(); scheduler.advanceCycle(); scheduler.advanceCycle();
  assert.equal(s.state.units.G0.lifeState, 'DEAD');
  assert.equal(s.runtimes['R1:G0'].state, ACTION_RUNTIME_STATE.INTERRUPTED);
  assert.equal(eventsOf(s, EVENT_TYPE.CAST_COMPLETE).filter((e) => e.actorId === 'G0').length, 0);
});

test('TAUNT interrupts a cast and converts runtime into forced basic attack at the taunter', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 }, movementMax: 4, attacksMax: 3 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 }, attacksMax: 0 }),
    unit({ unitId: 'G1', side: SIDE.B, position: { row: 6, col: 9 }, attacksMax: 0 })
  ], [spell('H0', 'G1', { delay: 5 }), hold('G0'), hold('G1')]);
  const scheduler = createSpellCombatScheduler(s);
  scheduler.advanceCycle();
  const before = { ...s.state.units.H0.resources };
  const out = applyControlEffect(s, 'H0', { type: CONTROL_TYPE.TAUNT, sourceId: 'G0', cycle: 1 });
  const r = s.runtimes['R1:H0'];
  assert.equal(out.forcedTargetId, 'G0');
  assert.equal(r.actionKind, ACTION_KIND.BASIC_ATTACK);
  assert.equal(r.currentForcedTargetId, 'G0');
  assert.equal(r.declaredPrimaryTargetId, 'G1');
  assert.equal(r.state, ACTION_RUNTIME_STATE.ACTIVE);
  assert.equal(s.state.units.H0.resources.movementRemaining, before.movementRemaining);
  assert.equal(s.state.units.H0.resources.attacksRemaining, before.attacksRemaining);
  scheduler.advanceCycle();
  assert.ok(eventsOf(s, EVENT_TYPE.ATTACK_START).some((e) => e.actorId === 'H0' && e.targetId === 'G0'));
});

test('BERSERK interrupts casting, uses synchronized RNG target selection, and preserves spent resources', () => {
  const make = () => sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 }, movementMax: 6, attacksMax: 4 }),
    unit({ unitId: 'H1', side: SIDE.A, position: { row: 1, col: 3 }, attacksMax: 0 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 }, attacksMax: 0 })
  ], [spell('H0', 'G0', { delay: 5 }), hold('H1'), hold('G0')], 0xabcdef);
  const a = make(), b = make();
  createSpellCombatScheduler(a).advanceCycle(); createSpellCombatScheduler(b).advanceCycle();
  a.state.units.H0.resources.movementRemaining = 4; b.state.units.H0.resources.movementRemaining = 4;
  a.state.units.H0.resources.attacksRemaining = 2; b.state.units.H0.resources.attacksRemaining = 2;
  const oa = applyControlEffect(a, 'H0', { type: CONTROL_TYPE.BERSERK, sourceId: 'G0', cycle: 1 });
  const ob = applyControlEffect(b, 'H0', { type: CONTROL_TYPE.BERSERK, sourceId: 'G0', cycle: 1 });
  assert.equal(oa.forcedTargetId, ob.forcedTargetId);
  assert.equal(a.runtimes['R1:H0'].actionKind, ACTION_KIND.BASIC_ATTACK);
  assert.equal(a.state.units.H0.resources.movementRemaining, 4);
  assert.equal(a.state.units.H0.resources.attacksRemaining, 2);
  assert.deepEqual(a.rng.snapshot(), b.rng.snapshot());
});

test('STUN permits an in-range reflex counter after cast is no longer charging', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 4 }, attacksMax: 3 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, attacksMax: 0 })
  ], [spell('H0', 'G0', { delay: 1 }), hold('G0')]);
  const scheduler = createSpellCombatScheduler(s);
  scheduler.advanceCycle(); scheduler.advanceCycle();
  applyControlEffect(s, 'H0', { type: CONTROL_TYPE.STUN, sourceId: 'G0', cycle: 2 });
  assert.equal(hasControlStatus(s.state.units.H0, CONTROL_TYPE.STUN), true);
  assert.equal(counterEligibility(s, 'H0', 'G0').reason, 'ELIGIBLE');
});

test('successful melee-capable caster can counter with post-cast movement', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 4 }, attacksMax: 3, movementMax: 3, weaponRange: 3, preferredRange: 3, counterMoveMax: 1 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, attacksMax: 2, attackInterval: 2, weaponRange: 2 })
  ], [spell('H0', 'G0', { delay: 1 }), attack('G0', 'H0')]);
  const scheduler = createSpellCombatScheduler(s, { countersEnabled: true });
  scheduler.advanceCycle(); // G0 attacks while H0 charging -> no counter
  scheduler.advanceCycle(); // cast completes, G0 cooling down
  scheduler.advanceCycle(); // G0 attacks again -> H0 can move+counter
  assert.equal(eventsOf(s, EVENT_TYPE.COUNTER).filter((e) => e.actorId === 'H0').length, 1);
  assert.equal(eventsOf(s, EVENT_TYPE.COUNTER_MOVE).filter((e) => e.actorId === 'H0').length, 1);
});

test('successful ranged caster receives full 3-square post-cast counter movement allowance', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 4 }, attacksMax: 3, movementMax: 5, weaponRange: 8, preferredRange: 8, counterMoveMax: 3, mode: 'RANGED' }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, attacksMax: 2, attackInterval: 2, weaponRange: 2 })
  ], [spell('H0', 'G0', { delay: 1 }), attack('G0', 'H0')]);
  const scheduler = createSpellCombatScheduler(s, { countersEnabled: true });
  scheduler.advanceCycle(); scheduler.advanceCycle(); scheduler.advanceCycle();
  const moves = eventsOf(s, EVENT_TYPE.COUNTER_MOVE).filter((e) => e.actorId === 'H0');
  assert.equal(moves.length, 3);
  assert.equal(s.state.units.H0.resources.movementRemaining, 2);
  assert.equal(eventsOf(s, EVENT_TYPE.COUNTER).filter((e) => e.actorId === 'H0').length, 1);
});

test('counter after successful cast consumes an attack but does not alter ordinary attack cadence', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 4 }, attacksMax: 3, movementMax: 0, weaponRange: 3, attackInterval: 4 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, attacksMax: 2, attackInterval: 2, weaponRange: 2 })
  ], [spell('H0', 'G0', { delay: 1 }), attack('G0', 'H0')]);
  const scheduler = createSpellCombatScheduler(s);
  scheduler.advanceCycle(); scheduler.advanceCycle();
  const nextBefore = s.state.units.H0.resources.nextOrdinaryAttackCycle;
  scheduler.advanceCycle();
  assert.equal(s.state.units.H0.resources.attacksRemaining, 2);
  assert.equal(s.state.units.H0.resources.nextOrdinaryAttackCycle, nextBefore);
});

test('control interruption events preserve causal parentage', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, attacksMax: 0 })
  ], [spell('H0', 'G0', { delay: 4 }), hold('G0')]);
  const scheduler = createSpellCombatScheduler(s);
  scheduler.advanceCycle();
  const out = applyControlEffect(s, 'H0', { type: CONTROL_TYPE.SILENCE, sourceId: 'G0', cycle: 1 });
  const all = s.events.snapshot();
  const status = all.find((e) => e.eventId === out.statusEventId);
  const interrupt = eventsOf(s, EVENT_TYPE.CAST_INTERRUPT)[0];
  assert.equal(interrupt.parentEventId, status.eventId);
});

test('identical Stage-10 control/cast/counter scenario produces identical deterministic digest', () => {
  const make = () => sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 }, qkn: 15, attacksMax: 3, movementMax: 4, weaponRange: 3 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, qkn: 16, attacksMax: 0 })
  ], [spell('H0', 'G0', { delay: 4 }), hold('G0')], 0x10203040);
  const a = make(), b = make();
  const sa = createSpellCombatScheduler(a), sb = createSpellCombatScheduler(b);
  sa.advanceCycle(); sb.advanceCycle();
  applyControlEffect(a, 'H0', { type: CONTROL_TYPE.BERSERK, sourceId: 'G0', cycle: 1 });
  applyControlEffect(b, 'H0', { type: CONTROL_TYPE.BERSERK, sourceId: 'G0', cycle: 1 });
  sa.runUntilCombatSettled({ maxCycles: 20 });
  sb.runUntilCombatSettled({ maxCycles: 20 });
  const da = snapshotRoundSimulation(a), db = snapshotRoundSimulation(b);
  assert.equal(da.stateHash, db.stateHash);
  assert.equal(da.eventHash, db.eventHash);
  assert.deepEqual(da.rng, db.rng);
});
