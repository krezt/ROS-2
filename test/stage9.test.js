import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION_KIND,
  ACTION_RUNTIME_STATE,
  DAMAGE_TYPE,
  EVENT_TYPE,
  SIDE,
  TARGET_TYPE,
  counterEligibility,
  createActionDeclaration,
  createBattleState,
  createHoldDeclaration,
  createRoundSimulation,
  createSpellCombatScheduler,
  createUnitState,
  interruptSpell,
  snapshotRoundSimulation
} from '../src/index.js';

function unit({ unitId, side, position, qkn = 10, hp = 1000, attacksMax = 4, movementMax = 0, weaponRange = 2, damage = 10 }) {
  return createUnitState({
    unitId, side, draftSlot: 0, archetypeId: unitId,
    stats: { maxHP: Math.max(1, hp), hp, ATK: 0, DEF: 0, SDM: 0, CRIT: 0, QKN: qkn },
    position,
    combat: { movementMax, attacksMax, attackInterval: 1 },
    weapon: {
      weaponProfileId: `${unitId}-weapon`, mode: 'MELEE', weaponRange, preferredRange: weaponRange, counterMoveMax: 1,
      attackBaseMin: damage, attackBaseMax: damage, accuracy: 1, critBonus: 0, critMultiplier: 1.75,
      defensePenetration: 0, damageType: DAMAGE_TYPE.PHYSICAL, dodgeable: false
    }
  });
}

function spell(actorId, targetId, { delay, castRange = 20, amount = 0, actionId = `SPELL-${delay}` } = {}) {
  return createActionDeclaration({
    declarationId: `D-${actorId}`,
    roundNumber: 1,
    actorId,
    actionId,
    actionKind: ACTION_KIND.SPELL,
    target: { type: TARGET_TYPE.UNIT, unitId: targetId },
    payload: { spell: { completionDelayCycles: delay, castRange, effect: amount ? { type: 'DAMAGE', amount } : null } }
  });
}

function groundSpell(actorId, row, col, { delay, castRange = 20 } = {}) {
  return createActionDeclaration({
    declarationId: `D-${actorId}`, roundNumber: 1, actorId, actionId: 'GROUND-SPELL', actionKind: ACTION_KIND.SPELL,
    target: { type: TARGET_TYPE.GROUND, row, col }, payload: { spell: { completionDelayCycles: delay, castRange } }
  });
}

function attack(actorId, targetId) {
  return createActionDeclaration({ declarationId: `D-${actorId}`, roundNumber: 1, actorId, actionId: 'ATTACK', actionKind: ACTION_KIND.BASIC_ATTACK, target: { type: TARGET_TYPE.UNIT, unitId: targetId } });
}
function hold(actorId) { return createHoldDeclaration({ declarationId: `D-${actorId}`, roundNumber: 1, actorId }); }
function sim(units, declarations, seed = 1, board = { width: 12, height: 8 }) {
  return createRoundSimulation({ state: createBattleState({ matchId: 'stage9', roundNumber: 1, board, units }), declarations, seed });
}
function eventsOf(s, type) { return s.events.snapshot().filter((e) => e.type === type); }

for (const delay of [1, 2, 3, 4, 5, 7]) {
  test(`numeric spell delay ${delay} completes exactly at cycle ${delay} boundary`, () => {
    const s = sim([
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 1 } }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 8 }, attacksMax: 0 })
    ], [spell('H0', 'G0', { delay }), hold('G0')]);
    const scheduler = createSpellCombatScheduler(s);
    for (let c = 0; c < delay; c += 1) {
      scheduler.advanceCycle();
      assert.equal(eventsOf(s, EVENT_TYPE.CAST_COMPLETE).length, 0);
    }
    scheduler.advanceCycle();
    const completes = eventsOf(s, EVENT_TYPE.CAST_COMPLETE);
    assert.equal(completes.length, 1);
    assert.equal(completes[0].initiativeCycle, delay);
    assert.equal(s.runtimes['R1:H0'].completionCycle, delay);
  });
}

test('MEDIUM legacy-equivalent delay 3 allows three Warrior attacks before boundary completion', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 4 }, qkn: 15, attacksMax: 3, weaponRange: 2 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, qkn: 16, attacksMax: 3, weaponRange: 2 })
  ], [spell('H0', 'G0', { delay: 3, amount: 1 }), attack('G0', 'H0')]);
  const scheduler = createSpellCombatScheduler(s, { countersEnabled: true });
  scheduler.advanceCycle(); // cycle 0 attack
  scheduler.advanceCycle(); // cycle 1 attack
  scheduler.advanceCycle(); // cycle 2 attack
  assert.equal(eventsOf(s, EVENT_TYPE.ATTACK_START).filter((e) => e.actorId === 'G0').length, 3);
  assert.equal(eventsOf(s, EVENT_TYPE.CAST_COMPLETE).length, 0);
  scheduler.advanceCycle(); // boundary 3 cast completes before ordinary cycle 3
  const cast = eventsOf(s, EVENT_TYPE.CAST_COMPLETE)[0];
  assert.equal(cast.initiativeCycle, 3);
});

test('caster cannot counter while CHARGING', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 4 }, attacksMax: 3 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, attacksMax: 1 })
  ], [spell('H0', 'G0', { delay: 3 }), attack('G0', 'H0')]);
  createSpellCombatScheduler(s).advanceCycle();
  assert.equal(s.runtimes['R1:H0'].state, ACTION_RUNTIME_STATE.CHARGING);
  assert.equal(eventsOf(s, EVENT_TYPE.COUNTER).filter((e) => e.actorId === 'H0').length, 0);
  assert.equal(counterEligibility(s, 'H0', 'G0').reason, 'CASTING');
});

test('successful caster regains normal counter eligibility after completion', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 4 }, attacksMax: 3 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, attacksMax: 0 })
  ], [spell('H0', 'G0', { delay: 1 }), hold('G0')]);
  const scheduler = createSpellCombatScheduler(s);
  scheduler.advanceCycle();
  scheduler.advanceCycle();
  assert.equal(s.runtimes['R1:H0'].state, ACTION_RUNTIME_STATE.COMPLETED);
  assert.equal(counterEligibility(s, 'H0', 'G0').eligible, true);
});

test('unit spell checks range at completion and FIZZLES when target is now too far', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 1 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 3 }, attacksMax: 0 })
  ], [spell('H0', 'G0', { delay: 2, castRange: 2, amount: 50 }), hold('G0')]);
  const scheduler = createSpellCombatScheduler(s);
  scheduler.advanceCycle();
  s.state.board.occupancy['3,3'] = undefined;
  delete s.state.board.occupancy['3,3'];
  s.state.units.G0.position = { row: 3, col: 8 };
  s.state.board.occupancy['3,8'] = 'G0';
  scheduler.advanceCycle();
  scheduler.advanceCycle();
  assert.equal(eventsOf(s, EVENT_TYPE.CAST_FIZZLE).length, 1);
  assert.equal(eventsOf(s, EVENT_TYPE.DAMAGE).length, 0);
  assert.equal(s.state.units.G0.stats.hp, 1000);
});

test('ground spell range is checked from caster current position to original locked cell', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 1 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 7, col: 11 }, attacksMax: 0 })
  ], [groundSpell('H0', 3, 4, { delay: 2, castRange: 3 }), hold('G0')]);
  const scheduler = createSpellCombatScheduler(s);
  scheduler.advanceCycle();
  delete s.state.board.occupancy['3,1'];
  s.state.units.H0.position = { row: 3, col: 0 };
  s.state.board.occupancy['3,0'] = 'H0';
  scheduler.advanceCycle();
  scheduler.advanceCycle();
  assert.equal(eventsOf(s, EVENT_TYPE.CAST_FIZZLE).length, 1);
  assert.deepEqual(s.runtimes['R1:H0'].groundLock, { row: 3, col: 4 });
});

test('dead unit-locked target causes FIZZLE at completion', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 1 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 3 }, attacksMax: 0 })
  ], [spell('H0', 'G0', { delay: 1, amount: 50 }), hold('G0')]);
  const scheduler = createSpellCombatScheduler(s);
  scheduler.advanceCycle();
  s.state.units.G0.stats.hp = 0;
  s.state.units.G0.lifeState = 'DEAD';
  scheduler.advanceCycle();
  assert.equal(eventsOf(s, EVENT_TYPE.CAST_FIZZLE).length, 1);
});

test('manual interruption cancels a charging spell and prevents later completion', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 1 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 3 }, attacksMax: 0 })
  ], [spell('H0', 'G0', { delay: 3 }), hold('G0')]);
  const scheduler = createSpellCombatScheduler(s);
  scheduler.advanceCycle();
  const out = interruptSpell(s, 'H0', { cycle: 1, reason: 'TEST_STUN' });
  assert.equal(out.interrupted, true);
  scheduler.advanceCycle(); scheduler.advanceCycle(); scheduler.advanceCycle();
  assert.equal(eventsOf(s, EVENT_TYPE.CAST_COMPLETE).length, 0);
  assert.equal(eventsOf(s, EVENT_TYPE.CAST_INTERRUPT).length, 1);
});

test('charging spell prevents premature end-of-round attack dump', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 4 }, attacksMax: 0 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, attacksMax: 4, weaponRange: 2 })
  ], [spell('H0', 'G0', { delay: 3 }), attack('G0', 'H0')]);
  const scheduler = createSpellCombatScheduler(s, { countersEnabled: false });
  const c0 = scheduler.advanceCycle();
  assert.equal(c0.dumpedAttackCount, 0);
  assert.equal(eventsOf(s, EVENT_TYPE.ATTACK_START).filter((e) => e.actorId === 'G0').length, 1);
});

test('same-boundary spell completions resolve by QKN, tied QKN uses synchronized RNG', () => {
  const make = () => sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 1, col: 1 }, qkn: 20 }),
    unit({ unitId: 'H1', side: SIDE.A, position: { row: 3, col: 1 }, qkn: 10 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 1, col: 8 }, qkn: 20 }),
    unit({ unitId: 'G1', side: SIDE.B, position: { row: 3, col: 8 }, qkn: 5 })
  ], [spell('H0', 'G1', { delay: 2 }), spell('H1', 'G1', { delay: 2 }), spell('G0', 'H1', { delay: 2 }), hold('G1')], 0x9999);
  const a = make(), b = make();
  const sa = createSpellCombatScheduler(a), sb = createSpellCombatScheduler(b);
  sa.advanceCycle(); sb.advanceCycle();
  sa.advanceCycle(); sb.advanceCycle();
  sa.advanceCycle(); sb.advanceCycle();
  const oa = eventsOf(a, EVENT_TYPE.CAST_COMPLETE).map((e) => e.actorId);
  const ob = eventsOf(b, EVENT_TYPE.CAST_COMPLETE).map((e) => e.actorId);
  assert.deepEqual(oa, ob);
  assert.ok(['H0', 'G0'].includes(oa[0]) && ['H0', 'G0'].includes(oa[1]));
  assert.equal(oa[2], 'H1');
});

test('identical Stage-9 spell simulation produces identical state/event/RNG digest', () => {
  const make = () => sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 1 }, qkn: 15 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 4 }, qkn: 16, hp: 500, attacksMax: 0 })
  ], [spell('H0', 'G0', { delay: 4, castRange: 6, amount: 77 }), hold('G0')], 0x12345678);
  const a = make(), b = make();
  createSpellCombatScheduler(a).runUntilCombatSettled({ maxCycles: 20 });
  createSpellCombatScheduler(b).runUntilCombatSettled({ maxCycles: 20 });
  const da = snapshotRoundSimulation(a), db = snapshotRoundSimulation(b);
  assert.equal(da.stateHash, db.stateHash);
  assert.equal(da.eventHash, db.eventHash);
  assert.deepEqual(da.rng, db.rng);
});
