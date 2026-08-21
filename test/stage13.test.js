import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_KIND, AREA_SHAPE, DAMAGE_TYPE, EVENT_TYPE, SIDE, TARGET_TYPE,
  cellsForArea, createActionDeclaration, createBattleState, createHoldDeclaration,
  createRoundSimulation, createSpellCombatScheduler, createUnitState,
  getOccupantId, pullUnit, pushUnit, snapshotRoundSimulation, unitsInArea
} from '../src/index.js';

function unit({ unitId, side, position, hp = 1000, qkn = 10, statuses = [] }) {
  return createUnitState({
    unitId, side, draftSlot: 0, archetypeId: unitId,
    stats: { maxHP: 1000, hp, ATK: 0, DEF: 0, SDM: 0, CRIT: 0, QKN: qkn },
    position, combat: { movementMax: 8, attacksMax: 2, attackInterval: 1 },
    weapon: { weaponRange: 2, preferredRange: 2, counterMoveMax: 1, attackBaseMin: 10, attackBaseMax: 10, accuracy: 1, critMultiplier: 1.75, damageType: DAMAGE_TYPE.PHYSICAL, dodgeable: false },
    statuses
  });
}
function hold(actorId) { return createHoldDeclaration({ declarationId: `D-${actorId}`, roundNumber: 1, actorId }); }
function groundSpell(actorId, center, spell) {
  return createActionDeclaration({
    declarationId: `D-${actorId}`, roundNumber: 1, actorId, actionId: 'SPELL', actionKind: ACTION_KIND.SPELL,
    target: { type: TARGET_TYPE.GROUND, row: center.row, col: center.col }, payload: { spell }
  });
}
function unitSpell(actorId, targetId, spell) {
  return createActionDeclaration({
    declarationId: `D-${actorId}`, roundNumber: 1, actorId, actionId: 'SPELL', actionKind: ACTION_KIND.SPELL,
    target: { type: TARGET_TYPE.UNIT, unitId: targetId }, payload: { spell }
  });
}
function makeState(units) { return createBattleState({ matchId: 'stage13', board: { width: 14, height: 10 }, units }); }
function sim(units, declarations, seed = 1) { return createRoundSimulation({ state: makeState(units), declarations, seed }); }
function invisible() { return { key: 'invisible', duration: 2, sourceId: null, data: {} }; }

test('SINGLE returns exactly the center cell', () => {
  assert.deepEqual(cellsForArea({ width: 14, height: 10 }, { shape: AREA_SHAPE.SINGLE, center: { row: 3, col: 4 } }), [{ row: 3, col: 4 }]);
});

test('3x3 area clips safely at board edge', () => {
  const cells = cellsForArea({ width: 14, height: 10 }, { shape: AREA_SHAPE.SQUARE_3X3, center: { row: 0, col: 0 } });
  assert.equal(cells.length, 4);
});

test('CROSS contains center and four orthogonal cells', () => {
  const cells = cellsForArea({ width: 14, height: 10 }, { shape: AREA_SHAPE.CROSS, center: { row: 4, col: 4 } });
  assert.equal(cells.length, 5);
});

test('Manhattan radius 2 contains 13 cells away from edges', () => {
  assert.equal(cellsForArea({ width: 14, height: 10 }, { shape: AREA_SHAPE.MANHATTAN_RADIUS, center: { row: 4, col: 4 }, radius: 2 }).length, 13);
});

test('orthogonal LINE produces deterministic ordered cells', () => {
  assert.deepEqual(cellsForArea({ width: 14, height: 10 }, { shape: AREA_SHAPE.LINE, origin: { row: 3, col: 2 }, direction: { dr: 0, dc: 1 }, length: 3 }), [
    { row: 3, col: 3 }, { row: 3, col: 4 }, { row: 3, col: 5 }
  ]);
});

test('ALL_ENEMIES and ALL_ALLIES select by side rather than visibility', () => {
  const st = makeState([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 1, col: 1 } }),
    unit({ unitId: 'H1', side: SIDE.A, position: { row: 2, col: 1 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 4 }, statuses: [invisible()] })
  ]);
  assert.deepEqual(unitsInArea(st, 'H0', { shape: AREA_SHAPE.ALL_ENEMIES }).map(u => u.unitId), ['G0']);
  assert.deepEqual(unitsInArea(st, 'H0', { shape: AREA_SHAPE.ALL_ALLIES }).map(u => u.unitId), ['H0','H1']);
});

test('spatial area includes invisible champions by live position', () => {
  const st = makeState([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 1, col: 1 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 4, col: 4 }, statuses: [invisible()] })
  ]);
  assert.deepEqual(unitsInArea(st, 'H0', { shape: AREA_SHAPE.SINGLE, center: { row: 4, col: 4 } }).map(u => u.unitId), ['G0']);
});

test('push moves stepwise and updates occupancy immediately', () => {
  const s = sim([unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 } }), unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 4 } })], [hold('H0'), hold('G0')]);
  const out = pushUnit(s, 'G0', { sourceId: 'H0', anchor: { row: 3, col: 2 }, distance: 2 });
  assert.equal(out.movedDistance, 2);
  assert.deepEqual(s.state.units.G0.position, { row: 3, col: 6 });
  assert.equal(getOccupantId(s.state, 3, 4), null);
  assert.equal(getOccupantId(s.state, 3, 6), 'G0');
});

test('push stops at board edge without wrapping', () => {
  const s = sim([unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 10 } }), unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 12 } })], [hold('H0'), hold('G0')]);
  const out = pushUnit(s, 'G0', { sourceId: 'H0', anchor: { row: 3, col: 10 }, distance: 3 });
  assert.equal(out.movedDistance, 1);
  assert.equal(out.stopReason, 'EDGE');
  assert.deepEqual(s.state.units.G0.position, { row: 3, col: 13 });
});

test('corpse blocks displacement', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 } }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 4 } }),
    unit({ unitId: 'G1', side: SIDE.B, position: { row: 3, col: 5 }, hp: 0 })
  ], [hold('H0'), hold('G0')]);
  const out = pushUnit(s, 'G0', { sourceId: 'H0', anchor: { row: 3, col: 2 }, distance: 2 });
  assert.equal(out.movedDistance, 0);
  assert.equal(out.stopReason, 'BLOCKED');
});

test('pull moves target toward source and stops before occupied source square', () => {
  const s = sim([unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 } }), unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 6 } })], [hold('H0'), hold('G0')]);
  const out = pullUnit(s, 'G0', { sourceId: 'H0', anchor: { row: 3, col: 2 }, distance: 5 });
  assert.equal(out.movedDistance, 3);
  assert.deepEqual(s.state.units.G0.position, { row: 3, col: 3 });
  assert.equal(out.stopReason, 'BLOCKED');
});

test('diagonal push axis tie uses synchronized gameplay RNG', () => {
  const make = () => sim([unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 2 } }), unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 3 } })], [hold('H0'), hold('G0')], 0x1234);
  const a = make(), b = make();
  pushUnit(a, 'G0', { sourceId: 'H0', anchor: { row: 2, col: 2 }, distance: 1 });
  pushUnit(b, 'G0', { sourceId: 'H0', anchor: { row: 2, col: 2 }, distance: 1 });
  assert.deepEqual(a.state.units.G0.position, b.state.units.G0.position);
  assert.equal(a.rng.drawCount, 1);
  assert.equal(b.rng.drawCount, 1);
});

test('ground AoE spell resolves against live completion positions and hits invisible enemy', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 1 }, qkn: 20 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 4, col: 5 }, statuses: [invisible()] }),
    unit({ unitId: 'G1', side: SIDE.B, position: { row: 8, col: 8 } })
  ], [
    groundSpell('H0', { row: 4, col: 4 }, { completionDelayCycles: 1, castRange: 20, area: { shape: AREA_SHAPE.SQUARE_3X3 }, effect: { type: 'AOE_DAMAGE', amount: 25 } }),
    hold('G0'), hold('G1')
  ]);
  const scheduler = createSpellCombatScheduler(s, { countersEnabled: false });
  scheduler.advanceCycle();
  // Move G1 into the locked area after cast start; AoE must use the live completion position.
  s.state.board.occupancy['8,8'] = undefined;
  delete s.state.board.occupancy['8,8'];
  s.state.units.G1.position = { row: 5, col: 4 };
  s.state.board.occupancy['5,4'] = 'G1';
  scheduler.advanceCycle();
  assert.equal(s.state.units.G0.stats.hp, 975);
  assert.equal(s.state.units.G1.stats.hp, 975);
  assert.equal(s.events.snapshot().filter(e => e.type === EVENT_TYPE.DAMAGE && e.payload.source === 'SPELL_AOE').length, 2);
});

test('unit spell can push on completion and emits PUSH causally under CAST_COMPLETE', () => {
  const s = sim([
    unit({ unitId: 'H0', side: SIDE.A, position: { row: 3, col: 2 }, qkn: 20 }),
    unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 5 } })
  ], [unitSpell('H0', 'G0', { completionDelayCycles: 1, castRange: 20, effect: { type: 'DISPLACE', kind: 'PUSH', distance: 2 } }), hold('G0')]);
  const scheduler = createSpellCombatScheduler(s, { countersEnabled: false });
  scheduler.advanceCycle(); scheduler.advanceCycle();
  assert.deepEqual(s.state.units.G0.position, { row: 3, col: 7 });
  const push = s.events.snapshot().find(e => e.type === EVENT_TYPE.PUSH);
  const complete = s.events.snapshot().find(e => e.type === EVENT_TYPE.CAST_COMPLETE);
  assert.equal(push.parentEventId, complete.eventId);
});

test('Stage-13 AoE and displacement replay deterministically', () => {
  const make = () => sim([unit({ unitId: 'H0', side: SIDE.A, position: { row: 2, col: 2 } }), unit({ unitId: 'G0', side: SIDE.B, position: { row: 3, col: 3 } })], [hold('H0'), hold('G0')], 0xCAFEBABE);
  const a = make(), b = make();
  pushUnit(a, 'G0', { sourceId: 'H0', anchor: { row: 2, col: 2 }, distance: 2 });
  pushUnit(b, 'G0', { sourceId: 'H0', anchor: { row: 2, col: 2 }, distance: 2 });
  assert.deepEqual(snapshotRoundSimulation(a), snapshotRoundSimulation(b));
});
