import {
  AI_DIFFICULTY,
  SIDE,
  GameplayRng,
  SinglePlayerRoundAuthority,
  basicAggroPlanner,
  create3v3BattleState,
  planAiDeclarations
} from '../src/index.js';

const state=create3v3BattleState({
  teamA:['Warrior','Cleric','Archer'],
  teamB:['Barbarian','Monk','Mage'],
  matchId:'STAGE21-DEMO'
});

console.log('ROS 2.0 Stage 21 — Single-Player Opponent Framework');
for(const difficulty of Object.values(AI_DIFFICULTY)){
  const plan=planAiDeclarations({state,side:SIDE.B,difficulty,decisionRng:new GameplayRng(0x2100)});
  console.log(`${difficulty}:`,plan.map(d=>`${d.actorId}:${d.actionId}`).join(' | '));
}

const human=basicAggroPlanner({state,roundNumber:1,side:SIDE.A});
const authority=new SinglePlayerRoundAuthority({
  matchId:'STAGE21-SINGLE',
  humanSide:SIDE.A,
  aiDifficulty:AI_DIFFICULTY.NORMAL,
  aiDecisionSeed:0x5151,
  seedFactory:()=>0x20260812
});
const locked=authority.lockRound({state,humanDeclarations:human});
console.log('Human declarations:',human.map(d=>`${d.actorId}:${d.actionId}`).join(' | '));
console.log('AI declarations:',locked.aiDeclarations.map(d=>`${d.actorId}:${d.actionId}`).join(' | '));
console.log('Authoritative gameplay seed:',locked.roundPackage.gameplaySeed);
console.log('AI decision RNG:',locked.aiDecisionSnapshot.decisionRng);
console.log('Round Package uses normal PvP fields:',Object.keys(locked.roundPackage).sort().join(', '));
