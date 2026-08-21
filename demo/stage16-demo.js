import { RoundCoordinator } from '../src/round-coordinator.js';

const c = new RoundCoordinator({
  matchId: 'DEMO-MATCH',
  protocolVersion: 'ros2-protocol-1',
  rulesetVersion: 'ros2-ruleset-stage16',
  seedFactory: () => 0x6a09e667
});

c.submitDeclarations('A', [{ actorId: 'H0', kind: 'BASIC_ATTACK', targetId: 'G0' }]);
console.log('After A locks: package?', c.roundPackage);
c.submitDeclarations('B', [{ actorId: 'G0', kind: 'HOLD' }]);
const pkg = c.releaseRoundPackage();
console.log('\nServer-issued package:');
console.log(JSON.stringify(pkg, null, 2));

const baseDigest = {
  protocolVersion: c.protocolVersion,
  rulesetVersion: c.rulesetVersion,
  matchId: c.matchId,
  roundNumber: c.roundNumber,
  declarationsHash: 'example-declarations-hash',
  finalStateHash: 'same-state',
  eventStreamHash: 'same-events',
  gameplayRngDrawCount: 12,
  finalGameplayRngState: 987654321
};

console.log('\nA digest:', c.submitDigest('A', baseDigest));
console.log('B digest:', c.submitDigest('B', baseDigest));
console.log('Coordinator status:', c.status);
