import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_KIND, DAMAGE_TYPE, EVENT_TYPE, SIDE, TARGET_TYPE,
  CONTROL_TYPE, STATUS_KEY, STATUS_STACK,
  applyBleed, applyControlEffect, applyPoison, applyTimedStatus,
  closeRound, createActionDeclaration, createBattleState, createHoldDeclaration,
  createRoundSimulation, createUnitState, findStatus, poisonTotal,
  processEndOfRoundStatuses, snapshotRoundSimulation
} from '../src/index.js';

function unit({ unitId, side, position, hp = 1000, statuses = [] }) {
  return createUnitState({
    unitId, side, draftSlot: 0, archetypeId: unitId,
    stats: { maxHP: 1000, hp, ATK: 0, DEF: 0, SDM: 0, CRIT: 0, QKN: 10 },
    position, combat: { movementMax: 8, attacksMax: 4, attackInterval: 1 },
    weapon: { weaponRange: 2, preferredRange: 2, counterMoveMax: 1, attackBaseMin: 10, attackBaseMax: 10, accuracy: 1, critMultiplier: 1.75, damageType: DAMAGE_TYPE.PHYSICAL, dodgeable: false },
    statuses
  });
}
function hold(actorId, roundNumber = 1) { return createHoldDeclaration({ declarationId: `D-${roundNumber}-${actorId}`, roundNumber, actorId }); }
function basic(actorId, targetId, roundNumber = 1) {
  return createActionDeclaration({
    declarationId: `D-${roundNumber}-${actorId}`, roundNumber, actorId, actionId: 'BASIC', actionKind: ACTION_KIND.BASIC_ATTACK,
    target: { type: TARGET_TYPE.UNIT, unitId: targetId }
  });
}
function makeSim({ units, declarations, seed = 1, roundNumber = 1 }) {
  const state = createBattleState({ matchId: 'stage14', roundNumber, board: { width: 14, height: 10 }, units });
  return createRoundSimulation({ state, declarations, seed });
}
function duo(declarations = null) {
  const units = [
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 } })
  ];
  return makeSim({ units, declarations: declarations ?? [hold('H0'), hold('G0')] });
}

test('duration 3 applied mid-round decrements at that same round end', () => {
  const s = duo();
  applyTimedStatus(s, 'G0', { key: 'def_down', duration: 3, sourceId: 'H0' });
  processEndOfRoundStatuses(s);
  assert.equal(findStatus(s.state.units.G0, 'def_down').duration, 2);
});

test('duration 3 expires after exactly three round-end decrements', () => {
  const s = duo();
  applyTimedStatus(s, 'G0', { key: 'def_down', duration: 3, sourceId: 'H0' });
  processEndOfRoundStatuses(s);
  assert.equal(findStatus(s.state.units.G0, 'def_down').duration, 2);
  processEndOfRoundStatuses(s);
  assert.equal(findStatus(s.state.units.G0, 'def_down').duration, 1);
  processEndOfRoundStatuses(s);
  assert.equal(findStatus(s.state.units.G0, 'def_down'), null);
  assert.ok(s.events.snapshot().some(e => e.type === EVENT_TYPE.STATUS_EXPIRE && e.payload.key === 'def_down'));
});

test('MAX_DURATION stacking keeps the longer remaining duration', () => {
  const s = duo();
  applyTimedStatus(s, 'G0', { key: 'def_up', duration: 4, sourceId: 'H0' });
  applyTimedStatus(s, 'G0', { key: 'def_up', duration: 2, sourceId: 'H0', stack: STATUS_STACK.MAX_DURATION });
  assert.equal(findStatus(s.state.units.G0, 'def_up').duration, 4);
});

test('Bleed deals 15% of current HP then decrements duration', () => {
  const s = duo();
  applyBleed(s, 'G0', { duration: 3, pct: 0.15, sourceId: 'H0' });
  processEndOfRoundStatuses(s);
  assert.equal(s.state.units.G0.stats.hp, 850);
  assert.equal(findStatus(s.state.units.G0, STATUS_KEY.BLEED).duration, 2);
  processEndOfRoundStatuses(s);
  assert.equal(s.state.units.G0.stats.hp, 723); // floor(850 * .15) = 127
  assert.equal(findStatus(s.state.units.G0, STATUS_KEY.BLEED).duration, 1);
});

test('Bleed duration 3 expires after third tick', () => {
  const s = duo();
  applyBleed(s, 'G0', { duration: 3, sourceId: 'H0' });
  processEndOfRoundStatuses(s);
  processEndOfRoundStatuses(s);
  processEndOfRoundStatuses(s);
  assert.equal(findStatus(s.state.units.G0, STATUS_KEY.BLEED), null);
  assert.equal(s.events.snapshot().filter(e => e.type === EVENT_TYPE.STATUS_TICK && e.payload.key === STATUS_KEY.BLEED).length, 3);
});

test('Poison stacks independent contributions, ticks for 50–100% of the total, then decays', () => {
  const s = duo();
  applyPoison(s, 'G0', 100, { sourceId: 'H0' });
  applyPoison(s, 'G0', 50, { sourceId: 'H0' });
  assert.equal(poisonTotal(s.state.units.G0), 150);
  processEndOfRoundStatuses(s);
  const tick=s.events.snapshot().find(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.damageType==='POISON');
  assert.ok(tick);
  assert.equal(tick.payload.poisonTotalBefore,150);
  assert.ok(tick.payload.tickPct>=.50&&tick.payload.tickPct<=1);
  assert.equal(s.state.units.G0.stats.hp,1000-tick.payload.amount);
  assert.equal(poisonTotal(s.state.units.G0), 127); // 85 + 42 decay after the randomized tick
});

test('Poison contributions decay independently by floor(amount * 0.85)', () => {
  const s = duo();
  applyPoison(s, 'G0', 10, { sourceId: 'H0' });
  applyPoison(s, 'G0', 3, { sourceId: 'H0' });
  processEndOfRoundStatuses(s);
  const p = findStatus(s.state.units.G0, STATUS_KEY.POISON);
  assert.deepEqual(p.data.contributions.map(c => c.amount), [8, 2]);
});

test('Poison removes itself when all contributions decay below 1', () => {
  const s = duo();
  applyPoison(s, 'G0', 1, { sourceId: 'H0' });
  processEndOfRoundStatuses(s);
  assert.equal(findStatus(s.state.units.G0, STATUS_KEY.POISON), null);
  assert.ok(s.events.snapshot().some(e => e.type === EVENT_TYPE.STATUS_EXPIRE && e.payload.key === STATUS_KEY.POISON));
});

test('Poison resolves before Bleed, so Bleed uses post-poison current HP', () => {
  const s = duo();
  applyPoison(s, 'G0', 100, { sourceId: 'H0' });
  applyBleed(s, 'G0', { duration: 2, pct: 0.15, sourceId: 'H0' });
  processEndOfRoundStatuses(s);
  const poison=s.events.snapshot().find(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.damageType==='POISON');
  assert.ok(poison);
  const afterPoison=1000-poison.payload.amount;
  const expected=afterPoison-Math.floor(afterPoison*.15);
  assert.equal(s.state.units.G0.stats.hp, expected);
});

test('status tick lethal damage creates a corpse and KO event', () => {
  const units = [
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 }, hp: 1 })
  ];
  const s = makeSim({ units, declarations: [hold('H0'), hold('G0')] });
  applyBleed(s, 'G0', { duration: 2, pct: 0.15, sourceId: 'H0' });
  processEndOfRoundStatuses(s);
  assert.equal(s.state.units.G0.lifeState, 'DEAD');
  assert.deepEqual(s.state.units.G0.position, { row: 3, col: 6 });
  assert.ok(s.events.snapshot().some(e => e.type === EVENT_TYPE.KO && e.targetId === 'G0'));
});

test('Invisibility expires through the unified timed-status lifecycle', () => {
  const s = duo();
  applyTimedStatus(s, 'G0', { key: STATUS_KEY.INVISIBLE, duration: 1, sourceId: 'G0' });
  processEndOfRoundStatuses(s);
  assert.equal(findStatus(s.state.units.G0, STATUS_KEY.INVISIBLE), null);
});

test('Taunt duration expiry uses control cleanup and restores original target', () => {
  const s = makeSim({
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 } }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 } }),
      unit({ unitId: 'G1', side: SIDE.B, position: { row: 5, col: 5 } })
    ],
    declarations: [basic('H0', 'G1'), hold('G0'), hold('G1')]
  });
  applyControlEffect(s, 'H0', { type: CONTROL_TYPE.TAUNT, sourceId: 'G0', duration: 1 });
  const runtime = Object.values(s.runtimes).find(r => r.actorId === 'H0');
  assert.equal(runtime.currentForcedTargetId, 'G0');
  processEndOfRoundStatuses(s);
  assert.equal(findStatus(s.state.units.H0, STATUS_KEY.TAUNT), null);
  assert.equal(runtime.currentForcedTargetId, null);
  assert.equal(runtime.declaredPrimaryTargetId, 'G1');
});

test('Berserk duration expiry goes through unified control cleanup', () => {
  const s = makeSim({
    units: [
      unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 } }),
      unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 } })
    ],
    declarations: [hold('H0'), hold('G0')], seed: 7
  });
  applyControlEffect(s, 'H0', { type: CONTROL_TYPE.BERSERK, duration: 1 });
  assert.ok(findStatus(s.state.units.H0, STATUS_KEY.BERSERK));
  processEndOfRoundStatuses(s);
  assert.equal(findStatus(s.state.units.H0, STATUS_KEY.BERSERK), null);
});

test('closeRound advances round number and refreshes movement/attack resources', () => {
  const s = duo();
  s.state.units.H0.resources.movementRemaining = 2;
  s.state.units.H0.resources.attacksRemaining = 1;
  closeRound(s);
  assert.equal(s.state.roundNumber, 2);
  assert.equal(s.state.round.initiativeCycle, 0);
  assert.equal(s.state.units.H0.resources.movementRemaining, s.state.units.H0.resources.movementMax);
  assert.equal(s.state.units.H0.resources.attacksRemaining, s.state.units.H0.resources.attacksMax);
  assert.equal(s.state.units.H0.resources.nextOrdinaryAttackCycle, 0);
});

test('Stage-14 status lifecycle is deterministic across equivalent simulations', () => {
  const make = () => duo();
  const a = make(), b = make();
  for (const s of [a, b]) {
    applyPoison(s, 'G0', 47, { sourceId: 'H0' });
    applyPoison(s, 'G0', 21, { sourceId: 'H0' });
    applyBleed(s, 'G0', { duration: 3, sourceId: 'H0' });
    applyTimedStatus(s, 'H0', { key: 'sdm_up', duration: 2, sourceId: 'H0' });
    processEndOfRoundStatuses(s);
  }
  assert.deepEqual(snapshotRoundSimulation(a), snapshotRoundSimulation(b));
});
