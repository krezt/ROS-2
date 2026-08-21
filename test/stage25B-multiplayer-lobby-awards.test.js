import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { MatchStatTracker } from '../client/match-awards.js';
import { CoordinatorSocket } from '../client/network-client.js';

function state(){
  return {units:{
    H0:{unitId:'H0',archetypeId:'Warrior',side:'A'},
    H1:{unitId:'H1',archetypeId:'Cleric',side:'A'},
    G0:{unitId:'G0',archetypeId:'Barbarian',side:'B'},
    G1:{unitId:'G1',archetypeId:'Mage',side:'B'}
  }};
}

test('Stage25B match awards aggregate damage, healing, kills, and best single-round damage',()=>{
  const tracker=new MatchStatTracker(state());
  tracker.ingestRound([
    {type:'DAMAGE',actorId:'H0',payload:{amount:120}},
    {type:'DAMAGE',actorId:'H0',payload:{amount:80}},
    {type:'HEAL',actorId:'H1',payload:{amount:150}},
    {type:'KO',actorId:'H0',payload:{}},
    {type:'DAMAGE',actorId:'G0',payload:{amount:190}}
  ],1);
  tracker.ingestRound([
    {type:'DAMAGE',actorId:'G0',payload:{amount:260}},
    {type:'DAMAGE',actorId:'H0',payload:{amount:140}},
    {type:'HEAL',actorId:'H1',payload:{amount:90}},
    {type:'KO',actorId:'G0',payload:{}}
  ],2);
  const snap=tracker.snapshot();
  const byId=Object.fromEntries(snap.champions.map(c=>[c.unitId,c]));
  assert.equal(byId.H0.damage,340);
  assert.equal(byId.H0.kills,1);
  assert.equal(byId.H0.bestRoundDamage,200);
  assert.equal(byId.H0.bestRoundNumber,1);
  assert.equal(byId.H1.healing,240);
  assert.equal(byId.G0.damage,450);
  assert.equal(byId.G0.bestRoundDamage,260);
  assert.equal(byId.G0.bestRoundNumber,2);
  assert.equal(snap.awards.find(a=>a.key==='damage').winners[0].unitId,'G0');
  assert.equal(snap.awards.find(a=>a.key==='healing').winners[0].unitId,'H1');
  assert.equal(snap.awards.find(a=>a.key==='bestRoundDamage').winners[0].unitId,'G0');
});

test('Stage25B match awards preserve exact ties deterministically',()=>{
  const tracker=new MatchStatTracker(state());
  tracker.ingestRound([
    {type:'KO',actorId:'H0',payload:{}},
    {type:'KO',actorId:'G0',payload:{}}
  ],1);
  const kills=tracker.snapshot().awards.find(a=>a.key==='kills');
  assert.equal(kills.value,1);
  assert.deepEqual(kills.winners.map(w=>w.unitId),['G0','H0']);
});

test('Stage25B CoordinatorSocket sends host-selected room format and draft-ban configuration',()=>{
  const old=globalThis.WebSocket;
  globalThis.WebSocket={OPEN:1};
  try{
    const sent=[];
    const socket=new CoordinatorSocket('ws://example/ws');
    socket.ws={readyState:1,send:value=>sent.push(JSON.parse(value))};
    socket.createRoom({id:'TESTROOM',teamSize:5,draftBansPerPlayer:1});
    socket.updateRoomConfig({teamSize:4,draftBansPerPlayer:0});
    assert.deepEqual(sent[0],{kind:'create_room',id:'TESTROOM',teamSize:5,draftBansPerPlayer:1});
    assert.deepEqual(sent[1],{kind:'update_room_config',teamSize:4,draftBansPerPlayer:0});
  }finally{globalThis.WebSocket=old;}
});

test('Stage25B browser exposes advertised-room lobby, 1v1–5v5 host config, draft-ban option, and match awards',()=>{
  const html=readFileSync(new URL('../client/index.html',import.meta.url),'utf8');
  const main=readFileSync(new URL('../client/main.js',import.meta.url),'utf8');
  for(const n of [1,2,3,4,5])assert.match(html,new RegExp(`data-network-team-size="${n}"`));
  for(const id of ['draftBanToggle','roomList','currentRoomCard','matchResultModal','matchAwards','matchStatsBody'])assert.match(html,new RegExp(`id="${id}"`));
  for(const award of ['Highest Damage','Most Kills','Most Healing','Most Damage in 1 Round'])assert.match(readFileSync(new URL('../client/match-awards.js',import.meta.url),'utf8'),new RegExp(award));
  assert.match(main,/room_locked/);
  assert.match(main,/configLocked/);
});

test('Stage25B relay advertises format and bans, lets only host edit waiting config, and locks when Player 2 joins',()=>{
  const server=readFileSync(new URL('../server/relay-server.cjs',import.meta.url),'utf8');
  assert.match(server,/format:\s*`\$\{teamSize\}v\$\{teamSize\}`/);
  assert.match(server,/draftBansPerPlayer/);
  assert.match(server,/ONLY_HOST_MAY_CONFIGURE/);
  assert.match(server,/ROOM_CONFIG_LOCKED/);
  assert.match(server,/if \(room\.matchRoom\.isReady\(\)\) room\.configLocked = true/);
  assert.match(server,/kind:'room_locked'/);
});
