import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { CoordinatorSocket } from '../client/network-client.js';
import {
  NETWORK_DRAFT_PHASE,
  createNetworkDraftState,
  networkDraftTurnSide,
  networkDraftComplete,
  networkDraftSnapshot,
  applyNetworkDraftAction
} from '../server/network-draft.mjs';

function driveDraft(state){
  while(!networkDraftComplete(state)){
    const side=networkDraftTurnSide(state);
    assert.ok(side==='A'||side==='B');
    const archetype=state.pool[0];
    const kind=state.phase===NETWORK_DRAFT_PHASE.BAN?'draft_ban':'draft_pick';
    applyNetworkDraftAction(state,{side,kind,archetype});
  }
  return networkDraftSnapshot(state);
}

test('Stage25C generalized network snake draft completes 1v1 through 5v5 with canonical A/B teams',()=>{
  for(let teamSize=1;teamSize<=5;teamSize++){
    const state=createNetworkDraftState({teamSize,draftBansPerPlayer:0});
    assert.deepEqual(state.draftOrder.length,teamSize*2);
    const final=driveDraft(state);
    assert.equal(final.phase,'COMPLETE');
    assert.equal(final.picks.A.length,teamSize);
    assert.equal(final.picks.B.length,teamSize);
    assert.equal(new Set([...final.picks.A,...final.picks.B]).size,teamSize*2);
    assert.deepEqual(final.draftOrder.slice(0,Math.min(6,final.draftOrder.length)),['A','B','B','A','A','B'].slice(0,Math.min(6,teamSize*2)));
  }
});

test('Stage25C optional one-ban-per-player phase is server-authoritative and removes both bans before picks',()=>{
  const state=createNetworkDraftState({teamSize:5,draftBansPerPlayer:1});
  assert.equal(state.phase,'BAN');
  assert.equal(networkDraftTurnSide(state),'A');
  applyNetworkDraftAction(state,{side:'A',kind:'draft_ban',archetype:'Warrior'});
  assert.equal(networkDraftTurnSide(state),'B');
  applyNetworkDraftAction(state,{side:'B',kind:'draft_ban',archetype:'Mage'});
  assert.equal(state.phase,'DRAFT');
  assert.ok(!state.pool.includes('Warrior'));
  assert.ok(!state.pool.includes('Mage'));
  const final=driveDraft(state);
  assert.deepEqual(final.bans,{A:['Warrior'],B:['Mage']});
  assert.equal(final.available.length,0);
  assert.ok(![...final.picks.A,...final.picks.B].includes('Warrior'));
  assert.ok(![...final.picks.A,...final.picks.B].includes('Mage'));
});

test('Stage25C rejects out-of-turn, wrong-phase, and unavailable network draft actions',()=>{
  const state=createNetworkDraftState({teamSize:2,draftBansPerPlayer:1});
  assert.throws(()=>applyNetworkDraftAction(state,{side:'B',kind:'draft_ban',archetype:'Warrior'}),/DRAFT_NOT_YOUR_TURN/);
  assert.throws(()=>applyNetworkDraftAction(state,{side:'A',kind:'draft_pick',archetype:'Warrior'}),/DRAFT_EXPECTED_BAN/);
  applyNetworkDraftAction(state,{side:'A',kind:'draft_ban',archetype:'Warrior'});
  assert.throws(()=>applyNetworkDraftAction(state,{side:'B',kind:'draft_ban',archetype:'Warrior'}),/DRAFT_ARCHETYPE_UNAVAILABLE/);
});

test('Stage25C CoordinatorSocket exposes explicit ban and pick protocol messages',()=>{
  const old=globalThis.WebSocket;
  globalThis.WebSocket={OPEN:1};
  try{
    const sent=[];
    const socket=new CoordinatorSocket('ws://example/ws');
    socket.ws={readyState:1,send:value=>sent.push(JSON.parse(value))};
    socket.submitDraftBan('Mystic');
    socket.submitDraftPick('Barbarian');
    assert.deepEqual(sent,[
      {kind:'draft_ban',archetype:'Mystic'},
      {kind:'draft_pick',archetype:'Barbarian'}
    ]);
  }finally{globalThis.WebSocket=old;}
});

test('Stage25C browser and relay wire locked lobby into draft_state and automatic match_started handoff',()=>{
  const html=readFileSync(new URL('../client/index.html',import.meta.url),'utf8');
  const main=readFileSync(new URL('../client/main.js',import.meta.url),'utf8');
  const server=readFileSync(new URL('../server/relay-server.cjs',import.meta.url),'utf8');
  for(const id of ['draftBanSummary','draftMyBans','draftOpponentBans','draftMyTitle','draftOpponentTitle'])assert.match(html,new RegExp(`id="${id}"`));
  assert.match(main,/msg\.kind==='draft_state'/);
  assert.match(main,/submitDraftBan/);
  assert.match(main,/submitDraftPick/);
  assert.match(main,/msg\.kind==='match_started'/);
  assert.match(server,/beginNetworkDraft\(room\)/);
  assert.match(server,/handleDraftAction/);
  assert.match(server,/finalizeNetworkDraft/);
  assert.match(server,/kind:'match_started'/);
  assert.match(server,/teamA:\[\.\.\.snapshot\.picks\.A\]/);
  assert.match(server,/teamB:\[\.\.\.snapshot\.picks\.B\]/);
});
