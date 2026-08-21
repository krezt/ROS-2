import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION_KIND,
  ACTION_RUNTIME_STATE,
  CONTROL_TYPE,
  DAMAGE_TYPE,
  EVENT_TYPE,
  LIFE_STATE,
  SIDE,
  TARGET_TYPE,
  applyControlEffect,
  createActionDeclaration,
  createBattleState,
  createHoldDeclaration,
  createRoundSimulation,
  createSpellCombatScheduler,
  createUnitState,
  expireControlEffect,
  hasControlStatus,
  markUnitDead,
  reconcileForcedControl,
  snapshotRoundSimulation
} from '../src/index.js';

function unit({ unitId, side, position, qkn = 10, hp = 1000, attacksMax = 4, movementMax = 6, attackInterval = 1,
  weaponRange = 2, preferredRange = weaponRange, counterMoveMax = 1, damage = 10, mode = 'MELEE' }) {
  return createUnitState({
    unitId, side, draftSlot: 0, archetypeId: unitId,
    stats: { maxHP: Math.max(1, hp), hp, ATK: 0, DEF: 0, SDM: 0, CRIT: 0, QKN: qkn },
    position,
    combat: { movementMax, attacksMax, attackInterval },
    weapon: {
      weaponProfileId: `${unitId}-weapon`, mode, weaponRange, preferredRange, counterMoveMax,
      attackBaseMin: damage, attackBaseMax: damage, accuracy: 1, critBonus: 0, critMultiplier: 1.75,
      defensePenetration: 0, damageType: DAMAGE_TYPE.PHYSICAL, dodgeable: false
    }
  });
}
function attack(actorId, targetId) {
  return createActionDeclaration({ declarationId: `D-${actorId}`, roundNumber: 1, actorId, actionId: 'ATTACK', actionKind: ACTION_KIND.BASIC_ATTACK, target: { type: TARGET_TYPE.UNIT, unitId: targetId } });
}
function spell(actorId, targetId, delay = 3) {
  return createActionDeclaration({ declarationId: `D-${actorId}`, roundNumber: 1, actorId, actionId: 'SPELL', actionKind: ACTION_KIND.SPELL, target: { type: TARGET_TYPE.UNIT, unitId: targetId }, payload: { spell: { completionDelayCycles: delay, castRange: 20 } } });
}
function hold(actorId) { return createHoldDeclaration({ declarationId: `D-${actorId}`, roundNumber: 1, actorId }); }
function sim(units, declarations, seed = 1) {
  return createRoundSimulation({ state: createBattleState({ matchId: 'stage11', roundNumber: 1, board: { width: 14, height: 10 }, units }), declarations, seed });
}
function eventsOf(s, type) { return s.events.snapshot().filter((e) => e.type === type); }


test('STUN halts an active basic pursuit for the current round', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 1 }, movementMax: 10 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 10 }, attacksMax: 0 })
  ], [attack('H0', 'G0'), hold('G0')]);
  const scheduler = createSpellCombatScheduler(s, { countersEnabled: false });
  scheduler.advanceCycle();
  const before = { ...s.state.units.H0.position };
  applyControlEffect(s, 'H0', { type: CONTROL_TYPE.STUN, sourceId: 'G0', cycle: 1 });
  assert.equal(s.runtimes['R1:H0'].state, ACTION_RUNTIME_STATE.INTERRUPTED);
  scheduler.advanceCycle();
  assert.deepEqual(s.state.units.H0.position, before);
  assert.equal(eventsOf(s, EVENT_TYPE.ACTION_INTERRUPT).some((e) => e.actorId === 'H0' && e.payload.reason === 'STUN'), true);
});

test('SILENCE present before initiative prevents a pending spell from starting', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, attacksMax: 0 })
  ], [spell('H0', 'G0', 2), hold('G0')]);
  applyControlEffect(s, 'H0', { type: CONTROL_TYPE.SILENCE, sourceId: 'G0', cycle: 0 });
  createSpellCombatScheduler(s).advanceCycle();
  assert.equal(eventsOf(s, EVENT_TYPE.CAST_START).filter((e) => e.actorId === 'H0').length, 0);
  assert.equal(s.runtimes['R1:H0'].state, ACTION_RUNTIME_STATE.INTERRUPTED);
});

test('STUN present before initiative prevents a pending spell from starting', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, attacksMax: 0 })
  ], [spell('H0', 'G0', 2), hold('G0')]);
  applyControlEffect(s, 'H0', { type: CONTROL_TYPE.STUN, sourceId: 'G0', cycle: 0 });
  createSpellCombatScheduler(s).advanceCycle();
  assert.equal(eventsOf(s, EVENT_TYPE.CAST_START).filter((e) => e.actorId === 'H0').length, 0);
});

test('TAUNT persists across cycles and repeatedly forces the taunter target', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 1 }, movementMax: 10 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 }, attacksMax: 0 }),
    unit({ unitId: 'G1', side: SIDE.B, position: { row: 7, col: 10 }, attacksMax: 0 })
  ], [attack('H0', 'G1'), hold('G0'), hold('G1')]);
  applyControlEffect(s, 'H0', { type: CONTROL_TYPE.TAUNT, sourceId: 'G0', duration: 2, cycle: 0 });
  const scheduler = createSpellCombatScheduler(s, { countersEnabled: false });
  scheduler.advanceCycle(); scheduler.advanceCycle();
  assert.equal(s.runtimes['R1:H0'].currentForcedTargetId, 'G0');
  const moves = eventsOf(s, EVENT_TYPE.MOVE).filter((e) => e.actorId === 'H0');
  assert.ok(moves.length >= 1);
  assert.ok(moves.every((e) => e.targetId === 'G0'));
});

test('TAUNT expiry restores original declared basic target without restoring resources', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 1 }, movementMax: 10, attacksMax: 5 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 }, attacksMax: 0 }),
    unit({ unitId: 'G1', side: SIDE.B, position: { row: 7, col: 10 }, attacksMax: 0 })
  ], [attack('H0', 'G1'), hold('G0'), hold('G1')]);
  applyControlEffect(s, 'H0', { type: CONTROL_TYPE.TAUNT, sourceId: 'G0', cycle: 0 });
  const scheduler = createSpellCombatScheduler(s, { countersEnabled: false });
  scheduler.advanceCycle();
  const resources = { ...s.state.units.H0.resources };
  expireControlEffect(s, 'H0', CONTROL_TYPE.TAUNT, { cycle: 1 });
  assert.equal(s.runtimes['R1:H0'].currentForcedTargetId, null);
  assert.equal(s.runtimes['R1:H0'].declaredPrimaryTargetId, 'G1');
  assert.deepEqual(s.state.units.H0.resources, resources);
  scheduler.advanceCycle();
  assert.equal(eventsOf(s, EVENT_TYPE.MOVE).filter((e) => e.actorId === 'H0').at(-1).targetId, 'G1');
});

test('TAUNT automatically ends when the taunter dies and original target resumes', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 1 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 }, attacksMax: 0 }),
    unit({ unitId: 'G1', side: SIDE.B, position: { row: 7, col: 10 }, attacksMax: 0 })
  ], [attack('H0', 'G1'), hold('G0'), hold('G1')]);
  applyControlEffect(s, 'H0', { type: CONTROL_TYPE.TAUNT, sourceId: 'G0', cycle: 0 });
  markUnitDead(s.state, 'G0');
  const out = reconcileForcedControl(s, 'H0', { cycle: 1 });
  assert.equal(out.reason, 'TAUNTER_DEAD');
  assert.equal(hasControlStatus(s.state.units.H0, CONTROL_TYPE.TAUNT), false);
  assert.equal(s.runtimes['R1:H0'].currentForcedTargetId, null);
});

test('BERSERK persists and retargets with synchronized RNG when forced target dies', () => {
  const make = () => sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 } }),
    unit({ unitId: 'H1', side: SIDE.A, position: { row: 1, col: 3 }, attacksMax: 0 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, attacksMax: 0 }),
    unit({ unitId: 'G1', side: SIDE.B, position: { row: 7, col: 6 }, attacksMax: 0 })
  ], [attack('H0', 'G0'), hold('H1'), hold('G0'), hold('G1')], 0x99887766);
  const a = make(), b = make();
  const oa = applyControlEffect(a, 'H0', { type: CONTROL_TYPE.BERSERK, sourceId: 'G0', cycle: 0 });
  const ob = applyControlEffect(b, 'H0', { type: CONTROL_TYPE.BERSERK, sourceId: 'G0', cycle: 0 });
  assert.equal(oa.forcedTargetId, ob.forcedTargetId);
  markUnitDead(a.state, oa.forcedTargetId); markUnitDead(b.state, ob.forcedTargetId);
  const ra = reconcileForcedControl(a, 'H0', { cycle: 1 });
  const rb = reconcileForcedControl(b, 'H0', { cycle: 1 });
  assert.equal(ra.targetId, rb.targetId);
  assert.notEqual(ra.targetId, oa.forcedTargetId);
  assert.deepEqual(a.rng.snapshot(), b.rng.snapshot());
});

test('BERSERK expiry restores original basic target', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, attacksMax: 0 }),
    unit({ unitId: 'G1', side: SIDE.B, position: { row: 7, col: 6 }, attacksMax: 0 })
  ], [attack('H0', 'G0'), hold('G0'), hold('G1')], 42);
  applyControlEffect(s, 'H0', { type: CONTROL_TYPE.BERSERK, sourceId: 'G1', cycle: 0 });
  expireControlEffect(s, 'H0', CONTROL_TYPE.BERSERK, { cycle: 1 });
  assert.equal(s.runtimes['R1:H0'].declaredPrimaryTargetId, 'G0');
  assert.equal(s.runtimes['R1:H0'].currentForcedTargetId, null);
});

test('HOLD is overridden by TAUNT and returns to HOLD when TAUNT expires', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 }, attacksMax: 3 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 }, attacksMax: 0 })
  ], [hold('H0'), hold('G0')]);
  applyControlEffect(s, 'H0', { type: CONTROL_TYPE.TAUNT, sourceId: 'G0', cycle: 0 });
  assert.equal(s.runtimes['R1:H0'].actionKind, ACTION_KIND.BASIC_ATTACK);
  createSpellCombatScheduler(s, { countersEnabled: false }).advanceCycle();
  assert.ok(eventsOf(s, EVENT_TYPE.ATTACK_START).some((e) => e.actorId === 'H0' && e.targetId === 'G0'));
  expireControlEffect(s, 'H0', CONTROL_TYPE.TAUNT, { cycle: 1 });
  assert.equal(s.runtimes['R1:H0'].actionKind, ACTION_KIND.HOLD);
  assert.equal(s.runtimes['R1:H0'].state, ACTION_RUNTIME_STATE.PENDING);
});

test('HOLD is overridden by BERSERK', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 }, attacksMax: 3 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 }, attacksMax: 0 })
  ], [hold('H0'), hold('G0')]);
  applyControlEffect(s, 'H0', { type: CONTROL_TYPE.BERSERK, sourceId: 'G0', cycle: 0 });
  assert.equal(s.runtimes['R1:H0'].actionKind, ACTION_KIND.BASIC_ATTACK);
  createSpellCombatScheduler(s, { countersEnabled: false }).advanceCycle();
  assert.ok(eventsOf(s, EVENT_TYPE.ATTACK_START).some((e) => e.actorId === 'H0'));
});

test('Taunted interrupted spell does not restart when TAUNT expires', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 }, attacksMax: 0 })
  ], [spell('H0', 'G0', 5), hold('G0')]);
  const scheduler = createSpellCombatScheduler(s);
  scheduler.advanceCycle();
  applyControlEffect(s, 'H0', { type: CONTROL_TYPE.TAUNT, sourceId: 'G0', cycle: 1 });
  expireControlEffect(s, 'H0', CONTROL_TYPE.TAUNT, { cycle: 2 });
  assert.equal(s.runtimes['R1:H0'].actionKind, ACTION_KIND.SPELL);
  assert.equal(s.runtimes['R1:H0'].state, ACTION_RUNTIME_STATE.INTERRUPTED);
  for (let i = 0; i < 6; i += 1) scheduler.advanceCycle();
  assert.equal(eventsOf(s, EVENT_TYPE.CAST_COMPLETE).filter((e) => e.actorId === 'H0').length, 0);
});

test('forced control preserves movement and attacks already spent', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 }, movementMax: 8, attacksMax: 6 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 }, attacksMax: 0 }),
    unit({ unitId: 'G1', side: SIDE.B, position: { row: 7, col: 9 }, attacksMax: 0 })
  ], [attack('H0', 'G1'), hold('G0'), hold('G1')]);
  s.state.units.H0.resources.movementRemaining = 3;
  s.state.units.H0.resources.attacksRemaining = 2;
  applyControlEffect(s, 'H0', { type: CONTROL_TYPE.TAUNT, sourceId: 'G0', cycle: 0 });
  assert.equal(s.state.units.H0.resources.movementRemaining, 3);
  assert.equal(s.state.units.H0.resources.attacksRemaining, 2);
});

test('Stage-11 integrated control replay is deterministic', () => {
  const make = () => sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 }, qkn: 15, attacksMax: 4, movementMax: 8 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, qkn: 16, attacksMax: 0 }),
    unit({ unitId: 'G1', side: SIDE.B, position: { row: 6, col: 7 }, qkn: 14, attacksMax: 0 })
  ], [attack('H0', 'G1'), hold('G0'), hold('G1')], 0x1234abcd);
  const a = make(), b = make();
  applyControlEffect(a, 'H0', { type: CONTROL_TYPE.BERSERK, sourceId: 'G0', cycle: 0 });
  applyControlEffect(b, 'H0', { type: CONTROL_TYPE.BERSERK, sourceId: 'G0', cycle: 0 });
  const sa = createSpellCombatScheduler(a, { countersEnabled: false });
  const sb = createSpellCombatScheduler(b, { countersEnabled: false });
  sa.advanceCycle(); sb.advanceCycle();
  const fa = a.runtimes['R1:H0'].currentForcedTargetId;
  const fb = b.runtimes['R1:H0'].currentForcedTargetId;
  assert.equal(fa, fb);
  markUnitDead(a.state, fa); markUnitDead(b.state, fb);
  sa.advanceCycle(); sb.advanceCycle();
  expireControlEffect(a, 'H0', CONTROL_TYPE.BERSERK, { cycle: 2 });
  expireControlEffect(b, 'H0', CONTROL_TYPE.BERSERK, { cycle: 2 });
  const da = snapshotRoundSimulation(a), db = snapshotRoundSimulation(b);
  assert.equal(da.stateHash, db.stateHash);
  assert.equal(da.eventHash, db.eventHash);
  assert.deepEqual(da.rng, db.rng);
});
