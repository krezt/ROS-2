import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  SIDE, LIFE_STATE,
  createHoldDeclaration, createRosterUnit, createTeamBattleState,
  simulateRosterRoundPackage, advanceClosedRound, statusDisplayModels
} from '../src/index.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

function unit(archetypeId='Mystic'){
  return createRosterUnit({archetypeId,unitId:'H0',side:SIDE.A,draftSlot:0,position:{row:5,col:5}});
}

test('Stage25AF RES Down is presented as a negative status, not a green buff',()=>{
  const u=unit();u.statuses=[{key:'res_down',duration:3,sourceId:'H0',data:{stacks:1}}];
  const model=statusDisplayModels(u)[0];
  assert.equal(model.tone,'negative');
  assert.match(model.tooltip,/Negative/i);
  assert.match(model.tooltip,/magical mitigation/i);
});

test('Stage25AF replay timing splits movement/melee from casts and ability VFX',()=>{
  const scene=readFileSync(new URL('../client/ros2-scene.js',import.meta.url),'utf8');
  const main=readFileSync(new URL('../client/main.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../client/index.html',import.meta.url),'utf8');
  assert.match(scene,/this\.replaySpeed=0\.5/);
  assert.match(scene,/vfxReplaySpeed\(\)\{ return Math\.min\(this\.replaySpeed,0\.33\); \}/);
  assert.match(scene,/animateMove\(command\)[\s\S]*duration=this\.replayDuration\(110\)/);
  assert.match(scene,/pulseImageFx\([\s\S]*duration:this\.vfxDuration\(duration\)/);
  assert.match(scene,/playChampionClip\(v,'cast',[\s\S]*this\.vfxDuration\(250\)/);
  assert.match(main,/let networkReplaySpeed=0\.5/);
  assert.match(html,/REPLAY 0\.50×/);
  assert.match(html,/data-network-replay-speed="0\.5" class="selected"/);
});

test('Stage25AF browser exposes spectator joining and spectator-aware room chat',()=>{
  const main=readFileSync(new URL('../client/main.js',import.meta.url),'utf8');
  const net=readFileSync(new URL('../client/network-client.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../client/index.html',import.meta.url),'utf8');
  const server=readFileSync(new URL('../server/relay-server.cjs',import.meta.url),'utf8');
  assert.match(html,/id="spectateRoomBtn"/);
  assert.match(main,/spectate-room-button/);
  assert.match(main,/msg\.kind==='spectator_joined'/);
  assert.match(net,/spectateRoom\(id\)/);
  assert.match(server,/function joinSpectator\(/);
  assert.match(server,/SPECTATOR_READ_ONLY/);
  assert.match(server,/confirmedRoundPackages/);
});

class Peer{
  constructor(name){this.name=name;this.ws=null;this.messages=[];this.waiters=[];}
  async connect(url){
    this.ws=new WebSocket(url);
    this.ws.addEventListener('message',e=>{const msg=JSON.parse(String(e.data));const i=this.waiters.findIndex(w=>w.kind===msg.kind&&(!w.pred||w.pred(msg)));if(i>=0){const[w]=this.waiters.splice(i,1);clearTimeout(w.timer);w.resolve(msg);}else this.messages.push(msg);});
    await new Promise((res,rej)=>{const tm=setTimeout(()=>rej(new Error(`${this.name} connect timeout`)),3000);this.ws.addEventListener('open',()=>{clearTimeout(tm);res();},{once:true});this.ws.addEventListener('error',()=>{clearTimeout(tm);rej(new Error(`${this.name} socket error`));},{once:true});});return this;
  }
  send(kind,payload={}){this.ws.send(JSON.stringify({kind,...payload}));}
  wait(kind,pred=null,timeout=5000){const i=this.messages.findIndex(m=>m.kind===kind&&(!pred||pred(m)));if(i>=0)return Promise.resolve(this.messages.splice(i,1)[0]);return new Promise((resolve,reject)=>{const w={kind,pred,resolve,timer:null};w.timer=setTimeout(()=>{const n=this.waiters.indexOf(w);if(n>=0)this.waiters.splice(n,1);reject(new Error(`${this.name} timeout ${kind}; queued=${this.messages.map(m=>m.kind).join(',')}`));},timeout);this.waiters.push(w);});}
  close(){try{this.ws?.close();}catch{}}
}
async function startServer(){
  const child=spawn(process.execPath,['server/relay-server.cjs'],{cwd:root,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});let err='';child.stderr.on('data',d=>err+=String(d));
  const port=await new Promise((resolvePort,reject)=>{const t=setTimeout(()=>reject(new Error(`server timeout ${err}`)),5000);child.stdout.on('data',d=>{const m=String(d).match(/listening on (\d+)/);if(m){clearTimeout(t);resolvePort(Number(m[1]));}});});
  return {child,url:`ws://127.0.0.1:${port}/ws`};
}
function holdsFor(state,side){return Object.values(state.units).filter(u=>u.side===side&&u.lifeState===LIFE_STATE.ALIVE).sort((a,b)=>a.draftSlot-b.draftSlot).map(u=>createHoldDeclaration({declarationId:`H:${state.roundNumber}:${u.unitId}`,roundNumber:state.roundNumber,actorId:u.unitId}));}

if(typeof WebSocket==='function')test('Stage25AF live spectator can join an ongoing match, reconstruct confirmed history, receive live rounds, and chat without gameplay authority',async t=>{
  const {child,url}=await startServer();t.after(()=>{try{child.kill('SIGTERM');}catch{}});
  const A=await new Peer('A').connect(url),B=await new Peer('B').connect(url),S=await new Peer('S').connect(url);t.after(()=>{A.close();B.close();S.close();});
  await A.wait('hello_ack');await B.wait('hello_ack');await S.wait('hello_ack');
  const roomId=`SPEC-${Date.now()}`;
  A.send('create_room',{id:roomId,teamSize:1,draftBansPerPlayer:0,replaySpeed:.5,playerName:'Alpha'});await A.wait('room_joined');
  B.send('join_room',{id:roomId,playerName:'Beta'});await B.wait('room_joined');await A.wait('room_locked');await B.wait('room_locked');
  let ds=(await A.wait('draft_state')).state;
  while(!ds.complete){
    const before=`${ds.phase}:${ds.pickIndex}:${ds.banIndex}`;const actor=ds.turnSide==='A'?A:B;actor.send(ds.phase==='BAN'?'draft_ban':'draft_pick',{archetype:ds.available[0]});
    ds=(await A.wait('draft_state',m=>`${m.state.phase}:${m.state.pickIndex}:${m.state.banIndex}`!==before)).state;
  }
  await B.wait('draft_state',m=>m.state.complete===true);
  const startedA=await A.wait('match_started'),startedB=await B.wait('match_started');assert.equal(startedA.matchId,startedB.matchId);
  let state=createTeamBattleState({teamA:startedA.teamA,teamB:startedA.teamB,matchId:startedA.matchId});

  // Confirm round 1 before the spectator arrives so late-join reconstruction is exercised.
  A.send('round_declarations',{declarations:holdsFor(state,'A')});B.send('round_declarations',{declarations:holdsFor(state,'B')});
  const p1=(await A.wait('round_package')).package;await B.wait('round_package');const r1=simulateRosterRoundPackage({baseState:state,roundPackage:p1});
  A.send('round_digest',{digest:r1.digest});B.send('round_digest',{digest:r1.digest});const c1=await A.wait('round_confirmed');await B.wait('round_confirmed');
  const ready={roundNumber:c1.roundNumber,finalStateHash:c1.finalStateHash,eventStreamHash:c1.eventStreamHash};A.send('round_ready',ready);B.send('round_ready',ready);await A.wait('round_open');await B.wait('round_open');advanceClosedRound(r1.sim);state=structuredClone(r1.sim.state);

  S.send('spectate_room',{id:roomId,playerName:'Watcher'});const joined=await S.wait('spectator_joined');
  assert.equal(joined.role,'SPECTATOR');assert.equal(joined.matchId,startedA.matchId);assert.equal(joined.config.replaySpeed,.5);assert.equal(joined.confirmedRoundPackages.length,1);assert.equal(joined.confirmedRoundPackages[0].roundNumber,1);assert.equal(joined.pendingRoundPackage,null);

  S.send('chat_message',{text:'great match'});const sc=await S.wait('chat_message',m=>m.text==='great match'),ac=await A.wait('chat_message',m=>m.text==='great match'),bc=await B.wait('chat_message',m=>m.text==='great match');
  assert.equal(sc.role,'SPECTATOR');assert.equal(ac.name,'Watcher');assert.equal(bc.senderId,sc.senderId);

  S.send('round_declarations',{declarations:[]});assert.equal((await S.wait('error')).code,'SPECTATOR_READ_ONLY');

  A.send('round_declarations',{declarations:holdsFor(state,'A')});B.send('round_declarations',{declarations:holdsFor(state,'B')});
  const p2=(await A.wait('round_package',m=>m.package.roundNumber===2)).package;await B.wait('round_package',m=>m.package.roundNumber===2);const spectatorPkg=await S.wait('round_package',m=>m.package.roundNumber===2);assert.deepEqual(spectatorPkg.package,p2);
  const r2=simulateRosterRoundPackage({baseState:state,roundPackage:p2});A.send('round_digest',{digest:r2.digest});B.send('round_digest',{digest:r2.digest});await A.wait('round_confirmed',m=>m.roundNumber===2);await B.wait('round_confirmed',m=>m.roundNumber===2);const spectatorConfirmed=await S.wait('round_confirmed',m=>m.roundNumber===2);assert.equal(spectatorConfirmed.finalStateHash,r2.digest.finalStateHash);
});
