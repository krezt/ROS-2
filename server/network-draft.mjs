import { ROSTER_IDS } from '../src/roster.js';
import { createSnakeDraftOrder, normalizeTeamSize } from '../src/match-config.js';

export const NETWORK_DRAFT_PHASE = Object.freeze({
  BAN: 'BAN',
  DRAFT: 'DRAFT',
  COMPLETE: 'COMPLETE'
});

function normalizeBans(value) {
  const n=Number(value??0);
  if(n!==0&&n!==1)throw new Error('INVALID_DRAFT_BANS');
  return n;
}

function validateSide(side){
  if(side!=='A'&&side!=='B')throw new Error('INVALID_DRAFT_SIDE');
  return side;
}

export function createNetworkDraftState({teamSize=3,draftBansPerPlayer=0,rosterIds=ROSTER_IDS}={}){
  const size=normalizeTeamSize(teamSize);
  const bans=normalizeBans(draftBansPerPlayer);
  const pool=[...rosterIds];
  if(new Set(pool).size!==pool.length)throw new Error('DRAFT_ROSTER_MUST_BE_UNIQUE');
  if(pool.length < size*2 + bans*2)throw new Error('DRAFT_POOL_TOO_SMALL');
  return {
    teamSize:size,
    draftBansPerPlayer:bans,
    phase:bans===1?NETWORK_DRAFT_PHASE.BAN:NETWORK_DRAFT_PHASE.DRAFT,
    banOrder:bans===1?['A','B']:[],
    banIndex:0,
    draftOrder:[...createSnakeDraftOrder(size)],
    pickIndex:0,
    bans:{A:[],B:[]},
    picks:{A:[],B:[]},
    pool
  };
}

export function networkDraftTurnSide(state){
  if(!state)return null;
  if(state.phase===NETWORK_DRAFT_PHASE.BAN)return state.banOrder[state.banIndex]??null;
  if(state.phase===NETWORK_DRAFT_PHASE.DRAFT)return state.draftOrder[state.pickIndex]??null;
  return null;
}

export function networkDraftComplete(state){
  return !!state&&state.phase===NETWORK_DRAFT_PHASE.COMPLETE&&
    state.picks.A.length===state.teamSize&&state.picks.B.length===state.teamSize;
}

export function networkDraftSnapshot(state){
  if(!state)throw new Error('DRAFT_NOT_INITIALIZED');
  return Object.freeze({
    teamSize:state.teamSize,
    draftBansPerPlayer:state.draftBansPerPlayer,
    phase:state.phase,
    turnSide:networkDraftTurnSide(state),
    banIndex:state.banIndex,
    banOrder:Object.freeze([...state.banOrder]),
    pickIndex:state.pickIndex,
    draftOrder:Object.freeze([...state.draftOrder]),
    bans:Object.freeze({A:Object.freeze([...state.bans.A]),B:Object.freeze([...state.bans.B])}),
    picks:Object.freeze({A:Object.freeze([...state.picks.A]),B:Object.freeze([...state.picks.B])}),
    available:Object.freeze([...state.pool]),
    complete:networkDraftComplete(state)
  });
}

export function applyNetworkDraftAction(state,{side,kind,archetype}={}){
  if(!state)throw new Error('DRAFT_NOT_INITIALIZED');
  validateSide(side);
  const id=String(archetype??'');
  if(!id||!state.pool.includes(id))throw new Error('DRAFT_ARCHETYPE_UNAVAILABLE');
  const turn=networkDraftTurnSide(state);
  if(turn!==side)throw new Error('DRAFT_NOT_YOUR_TURN');

  if(state.phase===NETWORK_DRAFT_PHASE.BAN){
    if(kind!=='draft_ban')throw new Error('DRAFT_EXPECTED_BAN');
    state.bans[side].push(id);
    state.pool=state.pool.filter(x=>x!==id);
    state.banIndex+=1;
    if(state.banIndex>=state.banOrder.length)state.phase=NETWORK_DRAFT_PHASE.DRAFT;
    return networkDraftSnapshot(state);
  }

  if(state.phase===NETWORK_DRAFT_PHASE.DRAFT){
    if(kind!=='draft_pick')throw new Error('DRAFT_EXPECTED_PICK');
    state.picks[side].push(id);
    state.pool=state.pool.filter(x=>x!==id);
    state.pickIndex+=1;
    if(state.pickIndex>=state.draftOrder.length){
      if(state.picks.A.length!==state.teamSize||state.picks.B.length!==state.teamSize)throw new Error('DRAFT_PICK_COUNT_MISMATCH');
      state.phase=NETWORK_DRAFT_PHASE.COMPLETE;
    }
    return networkDraftSnapshot(state);
  }

  throw new Error('DRAFT_ALREADY_COMPLETE');
}
