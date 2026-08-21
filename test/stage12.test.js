import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION_KIND,
  CONTROL_TYPE,
  DAMAGE_TYPE,
  EVENT_TYPE,
  SIDE,
  TARGET_TYPE,
  applyControlEffect,
  canAcquireDirectHostileTarget,
  canBeAffectedBySpatialTargeting,
  createActionDeclaration,
  createBattleState,
  createHoldDeclaration,
  createRoundSimulation,
  createSpellCombatScheduler,
  createUnitState,
  isInvisible,
  markUnitDead,
  reconcileForcedControl,
  selectReplacementTarget,
  snapshotRoundSimulation,
  upsertStatus
} from '../src/index.js';

function unit({ unitId, side, position, qkn = 10, hp = 1000, attacksMax = 4, movementMax = 8,
  attackInterval = 1, weaponRange = 2, preferredRange = weaponRange, counterMoveMax = 1,
  damage = 10, mode = 'MELEE', statuses = [] }) {
  return createUnitState({
    unitId, side, draftSlot: 0, archetypeId: unitId,
    stats: { maxHP: Math.max(1, hp), hp, ATK: 0, DEF: 0, SDM: 0, CRIT: 0, QKN: qkn },
    position,
    combat: { movementMax, attacksMax, attackInterval },
    weapon: {
      weaponProfileId: `${unitId}-weapon`, mode, weaponRange, preferredRange, counterMoveMax,
      attackBaseMin: damage, attackBaseMax: damage, accuracy: 1, critBonus: 0, critMultiplier: 1.75,
      defensePenetration: 0, damageType: DAMAGE_TYPE.PHYSICAL, dodgeable: false
    },
    statuses
  });
}
function attack(actorId, targetId, roundNumber = 1) {
  return createActionDeclaration({ declarationId: `D${roundNumber}-${actorId}`, roundNumber, actorId, actionId: 'ATTACK', actionKind: ACTION_KIND.BASIC_ATTACK, target: { type: TARGET_TYPE.UNIT, unitId: targetId } });
}
function spell(actorId, targetId, { roundNumber = 1, delay = 2, effect = { type: 'DAMAGE', amount: 10 }, hostile } = {}) {
  return createActionDeclaration({
    declarationId: `D${roundNumber}-${actorId}`, roundNumber, actorId, actionId: 'SPELL', actionKind: ACTION_KIND.SPELL,
    target: { type: TARGET_TYPE.UNIT, unitId: targetId },
    payload: { spell: { completionDelayCycles: delay, castRange: 20, effect }, ...(hostile === undefined ? {} : { targeting: { hostile } }) }
  });
}
function hold(actorId, roundNumber = 1) { return createHoldDeclaration({ declarationId: `D${roundNumber}-${actorId}`, roundNumber, actorId }); }
function state(units, roundNumber = 1) { return createBattleState({ matchId: 'stage12', roundNumber, board: { width: 14, height: 10 }, units }); }
function sim(units, declarations, seed = 1, roundNumber = 1) { return createRoundSimulation({ state: state(units, roundNumber), declarations, seed }); }
function invisibleStatus(duration = 2) { return { key: 'invisible', duration, sourceId: null, data: {} }; }
function eventsOf(s, type) { return s.events.snapshot().filter((e) => e.type === type); }

test('new direct basic attack cannot acquire an already invisible target', () => {
  const units = [
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 }, statuses: [invisibleStatus()] })
  ];
  assert.equal(canAcquireDirectHostileTarget(state(units), 'H0', 'G0'), false);
  assert.throws(() => sim(units, [attack('H0', 'G0'), hold('G0')]), /TARGET_INVISIBLE/);
});

test('new hostile unit-locked spell cannot acquire an already invisible target', () => {
  const units = [
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 }, statuses: [invisibleStatus()] })
  ];
  assert.throws(() => sim(units, [spell('H0', 'G0'), hold('G0')]), /TARGET_INVISIBLE/);
});

test('non-hostile direct spell may target an invisible ally', () => {
  const units = [
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 } }),
    unit({ unitId: 'H1', side: SIDE.A, position: { row: 3, col: 5 }, statuses: [invisibleStatus()] })
  ];
  const s = sim(units, [spell('H0', 'H1', { effect: { type: 'HEAL', amount: 10 }, hostile: false }), hold('H1')]);
  assert.ok(s.runtimes['R1:H0'].targetLock?.acquiredLegally);
});

test('existing melee target lock survives target becoming invisible mid-round', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 1 }, movementMax: 10 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 9 }, attacksMax: 0 })
  ], [attack('H0', 'G0'), hold('G0')]);
  upsertStatus(s.state.units.G0, invisibleStatus());
  assert.equal(isInvisible(s.state.units.G0), true);
  const scheduler = createSpellCombatScheduler(s, { countersEnabled: false });
  scheduler.advanceCycle();
  const move = eventsOf(s, EVENT_TYPE.MOVE).find((e) => e.actorId === 'H0');
  assert.equal(move.targetId, 'G0');
});

test('existing unit-locked hostile spell survives target becoming invisible while charging', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 }, attacksMax: 0 })
  ], [spell('H0', 'G0', { delay: 2, effect: { type: 'DAMAGE', amount: 25 } }), hold('G0')]);
  const scheduler = createSpellCombatScheduler(s, { countersEnabled: false });
  scheduler.advanceCycle();
  upsertStatus(s.state.units.G0, invisibleStatus());
  scheduler.advanceCycle();
  scheduler.advanceCycle();
  assert.equal(eventsOf(s, EVENT_TYPE.CAST_COMPLETE).filter((e) => e.actorId === 'H0').length, 1);
  assert.equal(s.state.units.G0.stats.hp, 975);
});

test('invisible aggressor can still be counterattacked reactively', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 }, qkn: 20, attacksMax: 2 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 }, qkn: 10, attacksMax: 2 })
  ], [attack('H0', 'G0'), attack('G0', 'H0')]);
  upsertStatus(s.state.units.H0, invisibleStatus());
  createSpellCombatScheduler(s, { countersEnabled: true }).advanceCycle();
  assert.ok(eventsOf(s, EVENT_TYPE.COUNTER).some((e) => e.actorId === 'G0' && e.targetId === 'H0'));
});

test('invisible champion remains eligible for spatial/AoE effects', () => {
  const u = unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 }, statuses: [invisibleStatus()] });
  assert.equal(isInvisible(u), true);
  assert.equal(canBeAffectedBySpatialTargeting(u), true);
});

test('automatic replacement acquisition skips invisible enemies', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 }, weaponRange: 4 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 4 } }),
    unit({ unitId: 'G1', side: SIDE.B, position: { row: 3, col: 5 }, statuses: [invisibleStatus()] }),
    unit({ unitId: 'G2', side: SIDE.B, position: { row: 4, col: 5 } })
  ], [attack('H0', 'G0'), hold('G0'), hold('G1'), hold('G2')]);
  // Make the original legally declared target die after acquisition, then replace.
  markUnitDead(s.state, 'G0');
  assert.equal(selectReplacementTarget(s, 'H0'), 'G2');
});

test('BERSERK new acquisition excludes invisible candidates', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, statuses: [invisibleStatus()], attacksMax: 0 }),
    unit({ unitId: 'G1', side: SIDE.B, position: { row: 7, col: 6 }, attacksMax: 0 })
  ], [hold('H0'), hold('G0'), hold('G1')]);
  const out = applyControlEffect(s, 'H0', { type: CONTROL_TYPE.BERSERK, sourceId: 'G1', duration: 3, cycle: 0 });
  assert.equal(out.forcedTargetId, 'G1');
});

test('BERSERK existing same-round lock survives target becoming invisible', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, attacksMax: 0 })
  ], [hold('H0'), hold('G0')]);
  const out = applyControlEffect(s, 'H0', { type: CONTROL_TYPE.BERSERK, sourceId: 'G0', duration: 3, cycle: 0 });
  upsertStatus(s.state.units.G0, invisibleStatus());
  const reconciled = reconcileForcedControl(s, 'H0', { cycle: 1 });
  assert.equal(reconciled.targetId, out.forcedTargetId);
});

test('BERSERK rolls a fresh target acquisition on every new battle round', () => {
  const round1 = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, attacksMax: 0 }),
    unit({ unitId: 'G1', side: SIDE.B, position: { row: 7, col: 6 }, attacksMax: 0 })
  ], [hold('H0'), hold('G0'), hold('G1')], 0x12345678);
  applyControlEffect(round1, 'H0', { type: CONTROL_TYPE.BERSERK, sourceId: 'G0', duration: 3, cycle: 0 });
  const persistedUnits = Object.values(round1.state.units);
  const round2 = createRoundSimulation({
    state: state(persistedUnits, 2),
    declarations: [hold('H0', 2), hold('G0', 2), hold('G1', 2)],
    seed: 0x87654321
  });
  const beforeDraws = round2.rng.drawCount;
  const out = reconcileForcedControl(round2, 'H0', { cycle: 0 });
  const berserk = round2.state.units.H0.statuses.find((x) => x.key === 'berserk');
  assert.equal(berserk.data.targetRoundNumber, 2);
  assert.ok(out.targetId === 'G0' || out.targetId === 'G1');
  assert.equal(round2.rng.drawCount, beforeDraws + 1);
  assert.ok(round2.trace.snapshot().some((x) => x.kind === 'BERSERK_NEW_ROUND_TARGET'));
});

test('BERSERK new-round acquisition ignores a now-invisible prior target', () => {
  const berserkStatus = { key: 'berserk', duration: 2, sourceId: 'G0', data: { forcedTargetId: 'G0', targetRoundNumber: 1 } };
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 }, statuses: [berserkStatus] }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, statuses: [invisibleStatus()], attacksMax: 0 }),
    unit({ unitId: 'G1', side: SIDE.B, position: { row: 7, col: 6 }, attacksMax: 0 })
  ], [hold('H0', 2), hold('G0', 2), hold('G1', 2)], 77, 2);
  const out = reconcileForcedControl(s, 'H0', { cycle: 0 });
  assert.equal(out.targetId, 'G1');
});

test('Stage-12 targeting and new-round Berserk replay deterministically', () => {
  const make = () => sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 3 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, attacksMax: 0 }),
    unit({ unitId: 'G1', side: SIDE.B, position: { row: 7, col: 6 }, attacksMax: 0 })
  ], [hold('H0'), hold('G0'), hold('G1')], 0xAABBCCDD);
  const a = make(), b = make();
  applyControlEffect(a, 'H0', { type: CONTROL_TYPE.BERSERK, sourceId: 'G0', duration: 3, cycle: 0 });
  applyControlEffect(b, 'H0', { type: CONTROL_TYPE.BERSERK, sourceId: 'G0', duration: 3, cycle: 0 });
  assert.deepEqual(snapshotRoundSimulation(a), snapshotRoundSimulation(b));
});
