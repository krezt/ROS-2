import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createHoldDeclaration, createTeamBattleState, simulateRosterRoundPackage } from '../src/index.js';

const require=createRequire(import.meta.url);
const { RankedLadder }=require('../server/ranked-ladder.cjs');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

test('ranked ladder persists case-insensitive W/L records by battle format and ignores duplicate match ids',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ros2-ranked-')),file=join(dir,'ladder.json');
  try{
    const ladder=new RankedLadder({filePath:file});
    assert.equal(ladder.recordMatch({matchId:'M1',format:'3v3',playerA:'Krez',playerB:'Rival',winnerSide:'A',teamA:['Warrior','Cleric','Mage'],teamB:['Rogue','Mystic','Shinobi']}).recorded,true);
    assert.equal(ladder.recordMatch({matchId:'M2',format:'4v4',playerA:'krez',playerB:'Other',winnerSide:'B',teamA:['Warrior','Cleric','Mage','Paladin'],teamB:['Rogue','Mystic','Shinobi','Electromancer']}).recorded,true);
    assert.equal(ladder.recordMatch({matchId:'M1',format:'3v3',playerA:'Krez',playerB:'Rival',winnerSide:'A',teamA:['Warrior','Cleric','Mage'],teamB:['Rogue','Mystic','Shinobi']}).recorded,false);
    const reloaded=new RankedLadder({filePath:file}),snap=reloaded.snapshot();
    const k=snap.players.find(p=>p.name.toLowerCase()==='krez'),r=snap.players.find(p=>p.name==='Rival'),o=snap.players.find(p=>p.name==='Other');
    assert.deepEqual([k.wins,k.losses],[1,1]);assert.deepEqual([k.formats['3v3'].wins,k.formats['3v3'].losses],[1,0]);assert.deepEqual([k.formats['4v4'].wins,k.formats['4v4'].losses],[0,1]);
    assert.deepEqual([r.wins,r.losses],[0,1]);assert.deepEqual([o.wins,o.losses],[1,0]);
    assert.equal(snap.players[0].wins,1);assert.ok(snap.players.every((p,i)=>p.rank===i+1));
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('browser exposes a distinct 2P Ranked mode and public rankings table',()=>{
  const html=readFileSync(new URL('../client/index.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../client/styles.css',import.meta.url),'utf8');
  const main=readFileSync(new URL('../client/main.js',import.meta.url),'utf8');
  const net=readFileSync(new URL('../client/network-client.js',import.meta.url),'utf8');
  assert.match(html,/id="rankedButton"[^>]*>2P RANKED</);assert.match(html,/id="viewRankingsBtn"/);assert.match(html,/id="rankingsModal"/);assert.match(html,/id="rankingsBody"/);
  assert.match(css,/rankings-table/);assert.match(css,/ranked-mode-button/);
  assert.match(main,/networkRankedMode/);assert.match(main,/room=>Boolean\(room\.ranked\)===networkRankedMode/);assert.match(main,/ranked_match_recorded/);
  assert.match(net,/requestRankings\(\)/);assert.match(net,/ranked===true\?\{ranked:true\}/);
});

class Peer{
  constructor(name){this.name=name;this.ws=null;this.messages=[];this.waiters=[];}
  async connect(url){this.ws=new WebSocket(url);this.ws.addEventListener('message',e=>{const msg=JSON.parse(String(e.data));const i=this.waiters.findIndex(w=>w.kind===msg.kind&&(!w.pred||w.pred(msg)));if(i>=0){const[w]=this.waiters.splice(i,1);clearTimeout(w.timer);w.resolve(msg);}else this.messages.push(msg);});await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error(`${this.name} connect timeout`)),3000);this.ws.addEventListener('open',()=>{clearTimeout(t);resolve();},{once:true});this.ws.addEventListener('error',()=>{clearTimeout(t);reject(new Error(`${this.name} socket error`));},{once:true});});return this;}
  send(kind,payload={}){this.ws.send(JSON.stringify({kind,...payload}));}
  wait(kind,pred=null,timeout=5000){const i=this.messages.findIndex(m=>m.kind===kind&&(!pred||pred(m)));if(i>=0)return Promise.resolve(this.messages.splice(i,1)[0]);return new Promise((resolve,reject)=>{const w={kind,pred,resolve,timer:null};w.timer=setTimeout(()=>{const n=this.waiters.indexOf(w);if(n>=0)this.waiters.splice(n,1);reject(new Error(`${this.name} timeout ${kind}; queued=${this.messages.map(m=>m.kind).join(',')}`));},timeout);this.waiters.push(w);});}
  close(){try{this.ws?.close();}catch{}}
}
async function startServer(ladderFile){const child=spawn(process.execPath,['server/relay-server.cjs'],{cwd:root,env:{...process.env,PORT:'0',ROS2_LADDER_FILE:ladderFile},stdio:['ignore','pipe','pipe']});let err='';child.stderr.on('data',d=>err+=String(d));const port=await new Promise((resolvePort,reject)=>{const t=setTimeout(()=>reject(new Error(`server timeout ${err}`)),5000);child.stdout.on('data',d=>{const m=String(d).match(/listening on (\d+)/);if(m){clearTimeout(t);resolvePort(Number(m[1]));}});});return{child,url:`ws://127.0.0.1:${port}/ws`};}
function holds(state,side){return Object.values(state.units).filter(u=>u.side===side).map(u=>createHoldDeclaration({declarationId:`H:${state.roundNumber}:${u.unitId}`,roundNumber:state.roundNumber,actorId:u.unitId}));}

if(typeof WebSocket==='function')test('live ranked 3v3 room records one verified result and exposes it through rankings',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'ros2-ranked-live-')),file=join(dir,'ladder.json');t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const {child,url}=await startServer(file);t.after(()=>{try{child.kill('SIGTERM');}catch{}});
  const A=await new Peer('A').connect(url),B=await new Peer('B').connect(url),viewer=await new Peer('viewer').connect(url);t.after(()=>{A.close();B.close();viewer.close();});
  await A.wait('hello_ack');await B.wait('hello_ack');await viewer.wait('hello_ack');
  A.send('create_room',{id:'RANK-3V3',teamSize:3,draftBansPerPlayer:0,replaySpeed:.33,ranked:true,playerName:'Alpha'});const aj=await A.wait('room_joined');assert.equal(aj.config.ranked,true);
  viewer.send('list_rooms');const rooms=await viewer.wait('rooms',m=>m.rooms?.some(r=>r.id==='RANK-3V3'));assert.equal(rooms.rooms.find(r=>r.id==='RANK-3V3').ranked,true);
  B.send('join_room',{id:'RANK-3V3',playerName:'Beta'});await B.wait('room_joined');await A.wait('room_locked');await B.wait('room_locked');
  let state=(await A.wait('draft_state')).state;
  while(!state.complete){const before=`${state.phase}:${state.pickIndex}`,peer=state.turnSide==='A'?A:B,choice=state.available[0];peer.send('draft_pick',{archetype:choice});state=(await A.wait('draft_state',m=>`${m.state.phase}:${m.state.pickIndex}`!==before)).state;}
  await B.wait('draft_state',m=>m.state.complete);const started=await A.wait('match_started');await B.wait('match_started');assert.equal(started.config.ranked,true);assert.deepEqual(started.playerNames,{A:'Alpha',B:'Beta'});
  const battle=createTeamBattleState({teamA:started.teamA,teamB:started.teamB,matchId:started.matchId});A.send('round_declarations',{declarations:holds(battle,'A'),deadlineMetadata:{selectionMs:120000,timedOut:false}});B.send('round_declarations',{declarations:holds(battle,'B'),deadlineMetadata:{selectionMs:120000,timedOut:false}});
  const pkg=(await A.wait('round_package')).package;await B.wait('round_package');const result=simulateRosterRoundPackage({baseState:battle,roundPackage:pkg});A.send('round_digest',{digest:result.digest});B.send('round_digest',{digest:result.digest});const confirmed=await A.wait('round_confirmed');await B.wait('round_confirmed');
  const report={roundNumber:confirmed.roundNumber,winner:'A',finalStateHash:confirmed.finalStateHash,eventStreamHash:confirmed.eventStreamHash};A.send('match_complete',report);B.send('match_complete',report);
  const recorded=await A.wait('ranked_match_recorded');await B.wait('ranked_match_recorded');assert.equal(recorded.format,'3v3');
  await A.wait('match_complete_confirmed');await B.wait('match_complete_confirmed');
  viewer.send('get_rankings');const ranking=await viewer.wait('rankings');const alpha=ranking.standings.players.find(p=>p.name==='Alpha'),beta=ranking.standings.players.find(p=>p.name==='Beta');
  assert.deepEqual([alpha.wins,alpha.losses,alpha.formats['3v3'].wins],[1,0,1]);assert.deepEqual([beta.wins,beta.losses,beta.formats['3v3'].losses],[0,1,1]);assert.equal(alpha.formats['3v3'].rating,1516);assert.equal(alpha.formats['3v3'].rank,1);
  for(const champion of started.teamA){const stat=ranking.standings.champions.find(c=>c.name===champion);assert.equal(stat?.formats?.['3v3']?.wins,1);}
  for(const champion of started.teamB){const stat=ranking.standings.champions.find(c=>c.name===champion);assert.equal(stat?.formats?.['3v3']?.losses,1);}
  const disk=new RankedLadder({filePath:file}).snapshot();assert.equal(disk.players.find(p=>p.name==='Alpha').wins,1);assert.equal(disk.champions.length,6);
});
