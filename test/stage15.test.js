import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_KIND, DAMAGE_TYPE, DIGEST_STATUS, EVENT_TYPE, SIDE, TARGET_TYPE, WEAPON_BEHAVIOR,
  GameplayRng, applyBleed, applyPoison, assertRoundDigestsMatch, canonicalTransportCheck,
  closeRound, compareRoundDigests, createActionDeclaration, createBattleState, createHoldDeclaration,
  createRoundDigest, createRoundSimulation, createSpellCombatScheduler, createUnitState,
  hashRoundPackage, replayDeterminism, seedSweepDeterminism
} from '../src/index.js';

function unit({ unitId, side, slot, row, col, qkn = 10, hp = 900, movement = 10, attacks = 4,
  interval = 1, range = 2, preferred = range, mode = 'MELEE', behavior = WEAPON_BEHAVIOR.STANDARD,
  damageMin = 35, damageMax = 65, accuracy = 0.92, crit = 0.08 }) {
  return createUnitState({
    unitId, side, draftSlot: slot, archetypeId: unitId,
    stats: { maxHP: 900, hp, ATK: 45, DEF: 22, SDM: 55, CRIT: crit, QKN: qkn },
    position: { row, col },
    combat: { movementMax: movement, attacksMax: attacks, attackInterval: interval },
    weapon: {
      mode, behavior, weaponRange: range, preferredRange: preferred,
      counterMoveMax: mode === 'RANGED' ? 3 : 1,
      attackBaseMin: damageMin, attackBaseMax: damageMax,
      accuracy, critMultiplier: 1.75, damageType: DAMAGE_TYPE.PHYSICAL, dodgeable: true
    }
  });
}

function basic(actorId, targetId, round = 1) {
  return createActionDeclaration({
    declarationId: `D${round}:${actorId}`, roundNumber: round, actorId,
    actionId: 'BASIC', actionKind: ACTION_KIND.BASIC_ATTACK,
    target: { type: TARGET_TYPE.UNIT, unitId: targetId }
  });
}
function spell(actorId, targetId, delay, amount, round = 1) {
  return createActionDeclaration({
    declarationId: `D${round}:${actorId}`, roundNumber: round, actorId,
    actionId: `SPELL_${actorId}`, actionKind: ACTION_KIND.SPELL,
    target: { type: TARGET_TYPE.UNIT, unitId: targetId },
    payload: { spell: { completionDelayCycles: delay, castRange: 20, effect: { type: 'DAMAGE', amount } } }
  });
}
function hold(actorId, round = 1) {
  return createHoldDeclaration({ declarationId: `D${round}:${actorId}`, roundNumber: round, actorId });
}

function fixedScenario({ seed = 424242, reverseUnits = false, reverseDeclarations = false } = {}) {
  let units = [
    unit({ unitId: 'H0', side: SIDE.A, slot: 0, row: 3, col: 1, qkn: 16, range: 2 }),
    unit({ unitId: 'H1', side: SIDE.A, slot: 1, row: 6, col: 1, qkn: 14, mode: 'RANGED', range: 8, preferred: 8, attacks: 2 }),
    unit({ unitId: 'G0', side: SIDE.B, slot: 0, row: 3, col: 12, qkn: 17, range: 3, preferred: 3 }),
    unit({ unitId: 'G1', side: SIDE.B, slot: 1, row: 6, col: 12, qkn: 14, mode: 'RANGED', range: 8, preferred: 8, attacks: 2 })
  ];
  let declarations = [
    basic('H0', 'G0'),
    spell('H1', 'G1', 4, 95),
    basic('G0', 'H0'),
    spell('G1', 'H1', 2, 80)
  ];
  if (reverseUnits) units = units.slice().reverse();
  if (reverseDeclarations) declarations = declarations.slice().reverse();
  const state = createBattleState({ matchId: 'stage15-fixed', board: { width: 14, height: 10 }, units });
  return createRoundSimulation({ state, declarations, seed });
}

function executeFixed(sim) {
  createSpellCombatScheduler(sim).runUntilCombatSettled({ maxCycles: 200 });
  if (sim.state.units.G0.lifeState === 'ALIVE') applyPoison(sim, 'G0', 31, { sourceId: 'H0' });
  if (sim.state.units.H0.lifeState === 'ALIVE') applyBleed(sim, 'H0', { duration: 3, pct: 0.15, sourceId: 'G0' });
  closeRound(sim);
}

function generatedScenario(seed) {
  const r = new GameplayRng(seed ^ 0x9e3779b9);
  const q = () => r.nextInt(11, 19, 'SCENARIO_QKN');
  const dmg = () => r.nextInt(25, 55, 'SCENARIO_DAMAGE');
  const delay = () => r.nextInt(1, 6, 'SCENARIO_DELAY');
  const units = [
    unit({ unitId: 'H0', side: SIDE.A, slot: 0, row: 2, col: 1, qkn: q(), attacks: 3, damageMin: dmg(), damageMax: 75 }),
    unit({ unitId: 'H1', side: SIDE.A, slot: 1, row: 7, col: 1, qkn: q(), mode: 'RANGED', range: 9, preferred: 9, attacks: 2, interval: 2 }),
    unit({ unitId: 'G0', side: SIDE.B, slot: 0, row: 2, col: 12, qkn: q(), attacks: 3, range: r.chance(.5) ? 2 : 3, damageMin: dmg(), damageMax: 75 }),
    unit({ unitId: 'G1', side: SIDE.B, slot: 1, row: 7, col: 12, qkn: q(), mode: 'RANGED', range: 9, preferred: 9, attacks: 2, interval: 2 })
  ];
  const declarations = [
    basic('H0', 'G0'),
    spell('H1', 'G1', delay(), r.nextInt(45, 120, 'SCENARIO_SPELL_DMG')),
    basic('G0', 'H0'),
    spell('G1', 'H1', delay(), r.nextInt(45, 120, 'SCENARIO_SPELL_DMG'))
  ];
  return { units, declarations };
}

function generatedPair(seed) {
  const scenario = generatedScenario(seed);
  const make = () => createRoundSimulation({
    state: createBattleState({ matchId: `sweep-${seed}`, board: { width: 14, height: 10 }, units: structuredClone(scenario.units) }),
    declarations: structuredClone(scenario.declarations),
    seed
  });
  return [make(), make()];
}

function executeGenerated(sim, seed) {
  createSpellCombatScheduler(sim).runUntilCombatSettled({ maxCycles: 250 });
  const aliveH0 = sim.state.units.H0.lifeState === 'ALIVE';
  const aliveG0 = sim.state.units.G0.lifeState === 'ALIVE';
  if (aliveG0 && seed % 3 === 0) applyPoison(sim, 'G0', 20 + (seed % 41), { sourceId: aliveH0 ? 'H0' : null });
  if (aliveH0 && seed % 5 === 0) applyBleed(sim, 'H0', { duration: 3, sourceId: aliveG0 ? 'G0' : null });
  closeRound(sim);
}

test('round digest contains the exact server-comparison fields and matches equivalent runs', () => {
  const a = fixedScenario(), b = fixedScenario();
  executeFixed(a); executeFixed(b);
  const da = createRoundDigest(a), db = createRoundDigest(b);
  assert.deepEqual(da, db);
  assert.equal(compareRoundDigests(da, db).status, DIGEST_STATUS.MATCH);
  assert.deepEqual(Object.keys(da), [
    'protocolVersion','rulesetVersion','matchId','roundNumber','declarationsHash','finalStateHash',
    'eventStreamHash','gameplayRngDrawCount','finalGameplayRngState'
  ]);
});

test('digest comparison identifies exact state-hash desync field', () => {
  const s = fixedScenario(); executeFixed(s);
  const d = createRoundDigest(s);
  const altered = { ...d, finalStateHash: '0000000000000000' };
  const c = compareRoundDigests(d, altered);
  assert.equal(c.status, DIGEST_STATUS.DESYNC);
  assert.deepEqual(c.mismatches.map(x => x.field), ['finalStateHash']);
});

test('digest comparison detects event/RNG divergence even when state hash is unchanged', () => {
  const s = fixedScenario(); executeFixed(s);
  const d = createRoundDigest(s);
  const altered = { ...d, eventStreamHash: 'bad', gameplayRngDrawCount: d.gameplayRngDrawCount + 1, finalGameplayRngState: d.finalGameplayRngState ^ 1 };
  const c = compareRoundDigests(d, altered);
  assert.equal(c.status, DIGEST_STATUS.DESYNC);
  assert.deepEqual(c.mismatches.map(x => x.field), ['eventStreamHash','gameplayRngDrawCount','finalGameplayRngState']);
});

test('assertRoundDigestsMatch fails loudly instead of selecting a client', () => {
  const s = fixedScenario(); executeFixed(s);
  const d = createRoundDigest(s);
  assert.throws(() => assertRoundDigestsMatch(d, { ...d, finalStateHash: 'desync' }), /DESYNC/);
});

test('round-package hash is independent of object property insertion order', () => {
  const a = { matchId: 'M', roundNumber: 7, seed: 123, declarations: [{ actorId: 'H0', action: 'A' }], metadata: { deadline: 99, protocol: 2 } };
  const b = { metadata: { protocol: 2, deadline: 99 }, declarations: [{ action: 'A', actorId: 'H0' }], seed: 123, roundNumber: 7, matchId: 'M' };
  assert.equal(hashRoundPackage(a), hashRoundPackage(b));
});

test('canonical authoritative payload survives JSON transport unchanged', () => {
  const payload = { z: [3, { q: true, a: null }], a: { y: 'ROS', x: -0 }, n: 4.25 };
  const check = canonicalTransportCheck(payload);
  assert.equal(check.match, true);
  assert.equal(check.beforeHash, check.afterHash);
});

test('1000 identical full executions produce one identical digest', () => {
  const result = replayDeterminism({ repetitions: 1000, createSimulation: () => fixedScenario(), execute: executeFixed });
  assert.equal(result.passed, true);
  assert.equal(result.repetitionsCompleted, 1000);
});

test('250-seed paired sweep reproduces state/events/RNG across varied battles', () => {
  const seeds = Array.from({ length: 250 }, (_, i) => i + 1);
  const result = seedSweepDeterminism({ seeds, createPair: generatedPair, execute: executeGenerated });
  assert.equal(result.passed, true, JSON.stringify(result.failures.slice(0, 3)));
  assert.equal(result.seedsTested, 250);
  assert.ok(result.totalEvents > 1000);
  assert.ok(result.totalRngDraws > 1000);
});

test('reversed unit and declaration insertion order does not change full result', () => {
  const a = fixedScenario({ seed: 98765 });
  const b = fixedScenario({ seed: 98765, reverseUnits: true, reverseDeclarations: true });
  executeFixed(a); executeFixed(b);
  assertRoundDigestsMatch(createRoundDigest(a), createRoundDigest(b));
});

test('single authoritative state mutation is detected even if events and RNG are untouched', () => {
  const a = fixedScenario({ seed: 5 }), b = fixedScenario({ seed: 5 });
  executeFixed(a); executeFixed(b);
  b.state.units.H0.stats.hp = Math.max(0, b.state.units.H0.stats.hp - 1);
  const c = compareRoundDigests(createRoundDigest(a), createRoundDigest(b));
  assert.equal(c.match, false);
  assert.ok(c.mismatches.some(x => x.field === 'finalStateHash'));
});

test('single event-stream mutation is detected even when authoritative battle state stays equal', () => {
  const a = fixedScenario({ seed: 6 }), b = fixedScenario({ seed: 6 });
  executeFixed(a); executeFixed(b);
  b.events.emit(EVENT_TYPE.STATUS_REMOVE, { initiativeCycle: b.state.round.initiativeCycle, payload: { diagnosticMutation: true } });
  const c = compareRoundDigests(createRoundDigest(a), createRoundDigest(b));
  assert.equal(c.match, false);
  assert.ok(c.mismatches.some(x => x.field === 'eventStreamHash'));
});

test('extra gameplay RNG consumption is detected even if it does not mutate state', () => {
  const a = fixedScenario({ seed: 7 }), b = fixedScenario({ seed: 7 });
  executeFixed(a); executeFixed(b);
  b.rng.nextFloat('DELIBERATE_DESYNC_INJECTION');
  const c = compareRoundDigests(createRoundDigest(a), createRoundDigest(b));
  assert.equal(c.match, false);
  assert.ok(c.mismatches.some(x => x.field === 'gameplayRngDrawCount'));
  assert.ok(c.mismatches.some(x => x.field === 'finalGameplayRngState'));
});

test('different gameplay seeds normally produce a different deterministic digest', () => {
  const a = fixedScenario({ seed: 101 }), b = fixedScenario({ seed: 202 });
  executeFixed(a); executeFixed(b);
  const c = compareRoundDigests(createRoundDigest(a), createRoundDigest(b));
  assert.equal(c.status, DIGEST_STATUS.DESYNC);
  assert.ok(c.mismatches.length >= 1);
});
