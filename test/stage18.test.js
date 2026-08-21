import test from 'node:test';
import assert from 'node:assert/strict';
import {
  ACTION_KIND, AREA_SHAPE, DAMAGE_TYPE, PRESENTATION_COMMAND, PROTOCOL_VERSION, RULESET_VERSION,
  SIDE, TARGET_TYPE, RoundCoordinator, VerticalSliceClient, InMemoryMatchTransport,
  RecordingPresentationAdapter, createActionDeclaration, createBattleState, createHoldDeclaration,
  createUnitState, verifyRoundPackage, compareRoundDigests
} from '../src/index.js';

function unit(unitId, side, slot, row, col, qkn, range = 2) {
  return createUnitState({ unitId, side, draftSlot: slot, archetypeId: unitId,
    stats: { maxHP: 700, hp: 700, ATK: 45, DEF: 20, SDM: 55, CRIT: .08, QKN: qkn },
    position: { row, col }, combat: { movementMax: 12, attacksMax: 4, attackInterval: 1 },
    weapon: { weaponRange: range, preferredRange: range, counterMoveMax: 1, attackBaseMin: 35, attackBaseMax: 55, accuracy: .95, critMultiplier: 1.75, damageType: DAMAGE_TYPE.PHYSICAL, dodgeable: true }
  });
}
function base(matchId='VS-MATCH', reverse=false) {
  let units = [unit('H0',SIDE.A,0,3,1,16), unit('H1',SIDE.A,1,6,1,14,8), unit('G0',SIDE.B,0,3,12,17,3), unit('G1',SIDE.B,1,6,12,13,8)];
  if (reverse) units = units.reverse();
  return createBattleState({ matchId, board:{width:14,height:10}, units });
}
function basic(actor,target) { return createActionDeclaration({ declarationId:`D1:${actor}`, roundNumber:1, actorId:actor, actionId:'BASIC', actionKind:ACTION_KIND.BASIC_ATTACK, target:{type:TARGET_TYPE.UNIT,unitId:target} }); }
function fireball(actor,row,col) { return createActionDeclaration({ declarationId:`D1:${actor}`, roundNumber:1, actorId:actor, actionId:'FIREBALL', actionKind:ACTION_KIND.SPELL, target:{type:TARGET_TYPE.GROUND,row,col}, payload:{ spell:{ completionDelayCycles:2, castRange:20, area:{shape:AREA_SHAPE.SQUARE_3X3}, effect:{type:'AOE_DAMAGE',amount:70} } } }); }
function hold(actor) { return createHoldDeclaration({declarationId:`D1:${actor}`,roundNumber:1,actorId:actor}); }
function setup(seed=0x12345678) {
  const c = new RoundCoordinator({ matchId:'VS-MATCH', seedFactory:()=>seed });
  const aAdapter = new RecordingPresentationAdapter(), bAdapter = new RecordingPresentationAdapter();
  const a = new VerticalSliceClient({side:'A',baseState:base('VS-MATCH'),replayAdapter:aAdapter});
  const b = new VerticalSliceClient({side:'B',baseState:base('VS-MATCH',true),replayAdapter:bAdapter});
  return {c,a,b,aAdapter,bAdapter,t:new InMemoryMatchTransport({coordinator:c,clientA:a,clientB:b})};
}

test('coordinator defaults use simulation protocol/ruleset constants',()=>{
  const c=new RoundCoordinator({matchId:'x',seedFactory:()=>9});
  assert.equal(c.protocolVersion,PROTOCOL_VERSION); assert.equal(c.rulesetVersion,RULESET_VERSION);
});
test('round package is unreleased and seedFactory uncalled until both sides lock',()=>{
  let calls=0; const c=new RoundCoordinator({matchId:'VS-MATCH',seedFactory:()=>{calls++;return 99;}});
  c.submitDeclarations('A',[basic('H0','G0'),hold('H1')]); assert.equal(calls,0); assert.equal(c.roundPackage,null);
  c.submitDeclarations('B',[basic('G0','H0'),hold('G1')]); assert.equal(calls,0); c.releaseRoundPackage(); assert.equal(calls,1);
});
test('both clients consume the identical server-issued package seed',()=>{
  const {t,a,b}=setup(777); t.lock('A',[basic('H0','G0'),fireball('H1',6,11)]); const pkg=t.lock('B',[basic('G0','H0'),hold('G1')]);
  t.simulateBoth(pkg); assert.equal(a.lastSimulation.rng.initialSeed,777); assert.equal(b.lastSimulation.rng.initialSeed,777); assert.deepEqual(a.lastPackage,b.lastPackage);
});
test('client rejects tampered round package before simulation',()=>{
  const {t,a}=setup(777); t.lock('A',[basic('H0','G0'),hold('H1')]); const pkg=t.lock('B',[basic('G0','H0'),hold('G1')]);
  assert.throws(()=>a.simulateRound({...pkg,gameplaySeed:778}),/hash mismatch/);
});
test('independent clients with reversed unit insertion order produce matching digest',()=>{
  const {t,a,b}=setup(12345); t.lock('A',[basic('H0','G0'),fireball('H1',6,11)]); const pkg=t.lock('B',[basic('G0','H0'),hold('G1')]);
  const r=t.simulateBoth(pkg); assert.equal(r.confirmation.kind,'round_confirmed'); assert.equal(compareRoundDigests(a.lastDigest,b.lastDigest).match,true);
});
test('server confirmation occurs only after both digests',()=>{
  const {c,a,b,t}=setup(123); t.lock('A',[basic('H0','G0'),hold('H1')]); const pkg=t.lock('B',[basic('G0','H0'),hold('G1')]);
  const ra=a.simulateRound(pkg), rb=b.simulateRound(pkg); const first=c.submitDigest('A',ra.digest); assert.equal(first.waitingForOpponent,true); const second=c.submitDigest('B',rb.digest); assert.equal(second.kind,'round_confirmed');
});
test('presentation replay is deferred until confirmation in vertical slice flow',async()=>{
  const {t,a,b,aAdapter,bAdapter}=setup(); t.lock('A',[basic('H0','G0'),hold('H1')]); const pkg=t.lock('B',[basic('G0','H0'),hold('G1')]); t.simulateBoth(pkg);
  assert.equal(aAdapter.executed.length,0); assert.equal(bAdapter.executed.length,0); await t.replayBothAfterConfirmation(); assert.ok(aAdapter.executed.length>0); assert.deepEqual(aAdapter.executed,bAdapter.executed); assert.equal(a.replayed,true); assert.equal(b.replayed,true);
});
test('ground fireball presentation contains board-space projectile from caster to locked cell',()=>{
  const {t,a}=setup(555); t.lock('A',[hold('H0'),fireball('H1',5,8)]); const pkg=t.lock('B',[hold('G0'),hold('G1')]); t.simulateBoth(pkg);
  const projectile=a.lastTimeline.find(x=>x.type===PRESENTATION_COMMAND.SPELL_PROJECTILE);
  assert.ok(projectile); assert.deepEqual(projectile.payload.from,{row:6,col:1}); assert.deepEqual(projectile.payload.to,{row:5,col:8}); assert.equal(projectile.payload.areaShape,AREA_SHAPE.SQUARE_3X3);
});
test('projectile presentation command does not alter authoritative event digest',()=>{
  const {t,a,b}=setup(556); t.lock('A',[hold('H0'),fireball('H1',5,8)]); const pkg=t.lock('B',[hold('G0'),hold('G1')]); t.simulateBoth(pkg);
  const before=a.lastDigest.eventStreamHash; a.lastTimeline.find(x=>x.type===PRESENTATION_COMMAND.SPELL_PROJECTILE).payload.from.row; assert.equal(a.lastDigest.eventStreamHash,before); assert.equal(a.lastDigest.eventStreamHash,b.lastDigest.eventStreamHash);
});
test('3x3 ground fireball hits occupants from live completion positions',()=>{
  const {t,a}=setup(557); t.lock('A',[hold('H0'),fireball('H1',6,11)]); const pkg=t.lock('B',[hold('G0'),hold('G1')]); t.simulateBoth(pkg);
  assert.ok(a.lastSimulation.state.units.G1.stats.hp<700);
});
test('transport log never reveals side A declarations before round_package',()=>{
  const {t}=setup(); t.lock('A',[basic('H0','G0'),hold('H1')]); assert.deepEqual(t.log,[{kind:'round_declarations_locked',side:'A',waitingForOpponent:true}]);
});
test('digest RNG accounting survives full package->simulate->confirm loop',()=>{
  const {t,a,b}=setup(0xabcdef01); t.lock('A',[basic('H0','G0'),fireball('H1',6,11)]); const pkg=t.lock('B',[basic('G0','H0'),hold('G1')]); t.simulateBoth(pkg);
  assert.equal(a.lastDigest.gameplayRngDrawCount,b.lastDigest.gameplayRngDrawCount); assert.equal(a.lastDigest.finalGameplayRngState,b.lastDigest.finalGameplayRngState);
});
test('same server package replayed in fresh clients is byte-for-byte deterministic',()=>{
  const s1=setup(424242), s2=setup(424242); s1.t.lock('A',[basic('H0','G0'),fireball('H1',6,11)]); const p1=s1.t.lock('B',[basic('G0','H0'),hold('G1')]); s2.t.lock('A',[basic('H0','G0'),fireball('H1',6,11)]); const p2=s2.t.lock('B',[basic('G0','H0'),hold('G1')]);
  assert.deepEqual(p1,p2); s1.t.simulateBoth(p1); s2.t.simulateBoth(p2); assert.deepEqual(s1.a.lastDigest,s2.a.lastDigest); assert.deepEqual(s1.a.lastTimeline,s2.a.lastTimeline);
});
test('server-issued seed changes deterministic outcome stream without client changes',()=>{
  const x=setup(101), y=setup(202); x.t.lock('A',[basic('H0','G0'),hold('H1')]); const px=x.t.lock('B',[basic('G0','H0'),hold('G1')]); y.t.lock('A',[basic('H0','G0'),hold('H1')]); const py=y.t.lock('B',[basic('G0','H0'),hold('G1')]); x.t.simulateBoth(px); y.t.simulateBoth(py);
  assert.notEqual(x.a.lastDigest.finalGameplayRngState,y.a.lastDigest.finalGameplayRngState);
});
