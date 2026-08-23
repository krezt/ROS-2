import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require=createRequire(import.meta.url);
const { RankedLadder }=require('../server/ranked-ladder.cjs');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

function source(path){return readFileSync(new URL(path,import.meta.url),'utf8');}

test('Stage25R top bar removes 1P Sandbox, renames modes, and 2P creation starts at 2v2',()=>{
  const html=source('../client/index.html');
  assert.doesNotMatch(html,/id="sandboxButton"|>\s*1P SANDBOX\s*</i);
  assert.match(html,/id="rosterButton"[^>]*>\s*1P ROSTER\s*</i);
  assert.match(html,/id="onePlayerDraftButton"[^>]*>\s*1P DRAFT\s*</i);
  assert.match(html,/id="pvpButton"[^>]*>\s*2P DRAFT\s*</i);
  assert.match(html,/id="rankedButton"[^>]*>\s*2P RANKED\s*</i);
  assert.doesNotMatch(html,/data-network-team-size="1"/);
  for(const n of [2,3,4,5])assert.match(html,new RegExp(`data-network-team-size="${n}"`));
  // 1v1 remains available to the local roster/draft modes; only 2P creation loses it.
  assert.match(html,/data-team-size="1"/);
});

test('Stage25R combat floats reserve an on-canvas margin at battlefield edges',()=>{
  const scene=source('../client/ros2-scene.js');
  assert.match(scene,/Phaser\.Math\.Clamp\(v\.container\.x\+xOffset,26,824\)/);
  assert.match(scene,/startY=Math\.max\(16,v\.container\.y-68\+yOffset\)/);
  assert.match(scene,/setDepth\(3000\)/);
});

test('Stage25R browser and network client expose mutual draw proposal controls',()=>{
  const html=source('../client/index.html'),main=source('../client/main.js'),net=source('../client/network-client.js');
  assert.match(html,/id="drawProposalButton"/);assert.match(html,/PROPOSE DRAW/);
  assert.match(html,/id="drawProposalModal"/);assert.match(html,/id="acceptDrawButton"/);assert.match(html,/id="declineDrawButton"/);
  assert.match(net,/proposeDraw\(\)\{this\.send\('propose_draw'\);\}/);
  assert.match(net,/respondDraw\(accept\)\{this\.send\('respond_draw'/);
  assert.match(main,/msg\.kind==='draw_proposed'/);assert.match(main,/msg\.kind==='draw_declined'/);assert.match(main,/msg\.draw/);
});

test('Stage25R ranked ladder records draws for players and champions without moving equal Elo ratings',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ros2-stage25r-draw-')),file=join(dir,'ladder.json');
  try{
    const ladder=new RankedLadder({filePath:file});
    const out=ladder.recordMatch({matchId:'DRAW-2V2',format:'2v2',playerA:'Alpha',playerB:'Beta',winnerSide:'DRAW',teamA:['Warrior','Cleric'],teamB:['Necromancer','Mystic']});
    assert.equal(out.recorded,true);
    const snap=out.standings,a=snap.players.find(p=>p.name==='Alpha'),b=snap.players.find(p=>p.name==='Beta');
    assert.equal(snap.version,3);assert.equal(snap.ratingSystem.drawScore,0.5);
    for(const p of [a,b]){
      assert.deepEqual([p.wins,p.draws,p.losses,p.games],[0,1,0,1]);
      assert.deepEqual([p.formats['2v2'].wins,p.formats['2v2'].draws,p.formats['2v2'].losses,p.formats['2v2'].games],[0,1,0,1]);
      assert.equal(p.formats['2v2'].rating,1500);
    }
    for(const name of ['Warrior','Cleric','Necromancer','Mystic']){
      const c=snap.champions.find(x=>x.name===name);assert.ok(c,name);assert.deepEqual([c.wins,c.draws,c.losses,c.games],[0,1,0,1]);assert.equal(c.formats['2v2'].draws,1);
    }
  }finally{rmSync(dir,{recursive:true,force:true});}
});

class Peer{
  constructor(name){this.name=name;this.ws=null;this.messages=[];this.waiters=[];}
  async connect(url){this.ws=new WebSocket(url);this.ws.addEventListener('message',e=>{const msg=JSON.parse(String(e.data));const i=this.waiters.findIndex(w=>w.kind===msg.kind&&(!w.pred||w.pred(msg)));if(i>=0){const[w]=this.waiters.splice(i,1);clearTimeout(w.timer);w.resolve(msg);}else this.messages.push(msg);});await new Promise((resolveOpen,reject)=>{const t=setTimeout(()=>reject(new Error(`${this.name} connect timeout`)),3000);this.ws.addEventListener('open',()=>{clearTimeout(t);resolveOpen();},{once:true});this.ws.addEventListener('error',()=>{clearTimeout(t);reject(new Error(`${this.name} socket error`));},{once:true});});return this;}
  send(kind,payload={}){this.ws.send(JSON.stringify({kind,...payload}));}
  wait(kind,pred=null,timeout=5000){const i=this.messages.findIndex(m=>m.kind===kind&&(!pred||pred(m)));if(i>=0)return Promise.resolve(this.messages.splice(i,1)[0]);return new Promise((resolveWait,reject)=>{const w={kind,pred,resolve:resolveWait,timer:null};w.timer=setTimeout(()=>{const n=this.waiters.indexOf(w);if(n>=0)this.waiters.splice(n,1);reject(new Error(`${this.name} timeout ${kind}; queued=${this.messages.map(m=>m.kind).join(',')}`));},timeout);this.waiters.push(w);});}
  close(){try{this.ws?.close();}catch{}}
}
async function startServer(ladderFile){const child=spawn(process.execPath,['server/relay-server.cjs'],{cwd:root,env:{...process.env,PORT:'0',ROS2_LADDER_FILE:ladderFile},stdio:['ignore','pipe','pipe']});let err='';child.stderr.on('data',d=>err+=String(d));const port=await new Promise((resolvePort,reject)=>{const t=setTimeout(()=>reject(new Error(`server timeout ${err}`)),5000);child.stdout.on('data',d=>{const m=String(d).match(/listening on (\d+)/);if(m){clearTimeout(t);resolvePort(Number(m[1]));}});});return{child,url:`ws://127.0.0.1:${port}/ws`};}

if(typeof WebSocket==='function')test('live ranked 2v2 supports decline then accepted draw and records W-D-L/champion draws',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'ros2-stage25r-live-draw-')),file=join(dir,'ladder.json');t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const {child,url}=await startServer(file);t.after(()=>{try{child.kill('SIGTERM');}catch{}});
  const A=await new Peer('A').connect(url),B=await new Peer('B').connect(url);t.after(()=>{A.close();B.close();});
  await A.wait('hello_ack');await B.wait('hello_ack');
  A.send('create_room',{id:'DRAW-2V2',teamSize:2,draftBansPerPlayer:0,replaySpeed:.33,ranked:true,playerName:'Alpha'});await A.wait('room_joined');
  B.send('join_room',{id:'DRAW-2V2',playerName:'Beta'});await B.wait('room_joined');await A.wait('room_locked');await B.wait('room_locked');
  let state=(await A.wait('draft_state')).state;
  while(!state.complete){const before=`${state.phase}:${state.pickIndex}`,peer=state.turnSide==='A'?A:B;peer.send('draft_pick',{archetype:state.available[0]});state=(await A.wait('draft_state',m=>`${m.state.phase}:${m.state.pickIndex}`!==before)).state;}
  await B.wait('draft_state',m=>m.state.complete);const started=await A.wait('match_started');await B.wait('match_started');assert.equal(started.config.teamSize,2);assert.equal(started.config.ranked,true);

  A.send('propose_draw');const pA=await A.wait('draw_proposed'),pB=await B.wait('draw_proposed');assert.equal(pA.proposedBy,'A');assert.equal(pB.proposedBy,'A');
  B.send('respond_draw',{accept:false});const dA=await A.wait('draw_declined'),dB=await B.wait('draw_declined');assert.equal(dA.declinedBy,'B');assert.equal(dB.declinedBy,'B');

  B.send('propose_draw');await A.wait('draw_proposed',m=>m.proposedBy==='B');await B.wait('draw_proposed',m=>m.proposedBy==='B');
  A.send('respond_draw',{accept:true});
  const rA=await A.wait('ranked_match_recorded'),rB=await B.wait('ranked_match_recorded');assert.equal(rA.draw,true);assert.equal(rB.draw,true);assert.equal(rA.winner,null);assert.equal(rA.format,'2v2');
  await A.wait('draw_accepted');await B.wait('draw_accepted');
  const cA=await A.wait('match_complete_confirmed'),cB=await B.wait('match_complete_confirmed');for(const c of [cA,cB]){assert.equal(c.draw,true);assert.equal(c.winner,null);assert.equal(c.rematchAvailable,true);}

  A.send('get_rankings');const ranking=await A.wait('rankings'),alpha=ranking.standings.players.find(p=>p.name==='Alpha'),beta=ranking.standings.players.find(p=>p.name==='Beta');
  for(const p of [alpha,beta]){assert.deepEqual([p.wins,p.draws,p.losses],[0,1,0]);assert.equal(p.formats['2v2'].draws,1);assert.equal(p.formats['2v2'].rating,1500);}
  for(const champion of [...started.teamA,...started.teamB]){const stat=ranking.standings.champions.find(c=>c.name===champion);assert.equal(stat?.formats?.['2v2']?.draws,1,champion);}
});
