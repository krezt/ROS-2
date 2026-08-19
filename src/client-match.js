import { SIDE } from './constants.js';
import { createRoundSimulation } from './simulation.js';
import { createRosterCombatScheduler } from './roster-combat-scheduler.js';
import { createRoundDigest } from './determinism.js';
import { buildPresentationTimeline } from './presentation.js';
import { advanceClosedRound, closeRound } from './status-engine.js';
import { cloneBattleState } from './state.js';
import { SinglePlayerRoundAuthority } from './ai-planner.js';
import { invariant } from './errors.js';
import { verifyRoundPackage } from './vertical-slice.js';

export function simulateRosterRoundPackage({baseState, roundPackage, maxCycles=5000}) {
  verifyRoundPackage(roundPackage);
  invariant(baseState.matchId===roundPackage.matchId,'Client matchId mismatch.');
  invariant(baseState.roundNumber===roundPackage.roundNumber,'Client roundNumber mismatch.');
  const state=cloneBattleState(baseState);
  state.protocolVersion=roundPackage.protocolVersion;
  state.rulesetVersion=roundPackage.rulesetVersion;
  const declarations=[...roundPackage.declarationsA,...roundPackage.declarationsB];
  const sim=createRoundSimulation({state,declarations,seed:roundPackage.gameplaySeed});
  createRosterCombatScheduler(sim).runUntilCombatSettled({maxCycles});
  // End-of-round status damage/healing is part of the authoritative confirmed round,
  // not a silent client-side transition after replay.
  closeRound(sim,{advanceRound:false});
  const digest=createRoundDigest(sim);
  const events=sim.events.snapshot();
  const timeline=buildPresentationTimeline(events);
  return Object.freeze({sim,digest,events,timeline});
}

export class LocalSinglePlayerMatch {
  constructor({state,humanSide=SIDE.A,aiDifficulty='NORMAL',aiDecisionSeed=0xA121B07,seedFactory}={}){
    invariant(state,'LocalSinglePlayerMatch requires initial state.');
    this.state=cloneBattleState(state);
    this.humanSide=humanSide;
    this.authority=new SinglePlayerRoundAuthority({
      matchId:this.state.matchId,
      humanSide,
      aiDifficulty,
      aiDecisionSeed,
      roundNumber:this.state.roundNumber,
      ...(seedFactory?{seedFactory}:{})
    });
    this.lastRound=null;
  }
  resolveRound(humanDeclarations){
    const locked=this.authority.lockRound({state:this.state,humanDeclarations,deadlineMetadata:{selectionMs:120000}});
    const result=simulateRosterRoundPackage({baseState:this.state,roundPackage:locked.roundPackage});
    const confirmation=this.authority.confirmRound({humanDigest:result.digest,aiDigest:result.digest}).confirmation;
    invariant(confirmation.kind==='round_confirmed','Local single-player round did not confirm.');
    this.lastRound=Object.freeze({...result,roundPackage:locked.roundPackage,aiDeclarations:locked.aiDeclarations,confirmation});
    return this.lastRound;
  }
  advanceRound(){
    invariant(this.lastRound,'No completed round to advance.');
    if(this.lastRound.sim.state.outcome.status==='COMPLETE'){
      this.state=cloneBattleState(this.lastRound.sim.state);
      return this.state;
    }
    advanceClosedRound(this.lastRound.sim);
    this.state=cloneBattleState(this.lastRound.sim.state);
    this.authority.nextRound();
    this.lastRound=null;
    return this.state;
  }
}
