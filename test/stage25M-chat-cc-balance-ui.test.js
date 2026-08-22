import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  EVENT_TYPE,PRESENTATION_COMMAND,SIDE,TARGET_TYPE,
  buildPresentationTimeline,createBattleState,createHoldDeclaration,createRosterAbilityDeclaration,
  createRosterCombatScheduler,createRosterUnit,createRoundSimulation,getAbility,getArchetype
} from '../src/index.js';

function unit(archetypeId,unitId,side,position,draftSlot=0){return createRosterUnit({archetypeId,unitId,side,draftSlot,position});}
function hold(actorId){return createHoldDeclaration({declarationId:`H:${actorId}`,roundNumber:1,actorId});}
function decl(archetypeId,abilityId,actorId,target){return createRosterAbilityDeclaration({declarationId:`D:${actorId}`,roundNumber:1,actorId,archetypeId,abilityId,target});}
function run(state,declarations,seed=1){const sim=createRoundSimulation({state,declarations,seed});createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:500});return sim;}

test('Stage25M requested balance tuning is represented in roster data',()=>{
  const power=getAbility('Electromancer','POWER_SURGE');
  assert.equal(power.completionDelayCycles,4);
  assert.ok(power.effects.filter(e=>e.type==='APPLY_STATUS').every(e=>e.duration===3));
  const storm=getAbility('Electromancer','ELECTRICAL_STORM');assert.equal(storm.completionDelayCycles,2);
  const bolt=getAbility('Electromancer','ELECTRO_ATTACK').basicProc;assert.deepEqual([bolt.min,bolt.max],[50,175]);
  assert.equal(getAbility('Mystic','BERSERK').completionDelayCycles,2);
  const rogue=getArchetype('Rogue');assert.deepEqual([rogue.weapon.attackBaseMin,rogue.weapon.attackBaseMax],[55,100]);
  assert.equal(getAbility('Rogue','EXPOSE').completionDelayCycles,3);
  assert.equal(getAbility('Rogue','POISON_DAGGER').effects[0].duration,4);
  assert.equal(getAbility('Warrior','DIG_IN').effects.find(e=>e.type==='APPLY_STATUS'&&e.key==='physical_shield')?.data?.pct,.20);
});

test('failed chance-based Mystic CC emits STATUS_RESIST BLOCK feedback',()=>{
  const state=createBattleState({matchId:'RESIST',units:[unit('Mystic','H0',SIDE.A,{row:5,col:2}),unit('Warrior','G0',SIDE.B,{row:5,col:8})]});
  const sim=run(state,[decl('Mystic','MYSTIC_STUN','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'}),hold('G0')],7168);
  const resisted=sim.events.snapshot().find(e=>e.type===EVENT_TYPE.BLOCK&&e.targetId==='G0'&&e.payload?.reason==='STATUS_RESIST'&&e.payload?.blockedStatusKey==='stun');
  assert.ok(resisted,'a failed Stun should explicitly emit STATUS_RESIST');
});

test('Smoke Bomb BLIND applications are grouped into one simultaneous presentation beat',()=>{
  const state=createBattleState({matchId:'BLIND-SIM',units:[
    unit('Rogue','H0',SIDE.A,{row:5,col:2}),
    unit('Warrior','G0',SIDE.B,{row:3,col:9}),unit('Paladin','G1',SIDE.B,{row:5,col:9},1),unit('Mage','G2',SIDE.B,{row:7,col:9},2)
  ]});
  const sim=run(state,[decl('Rogue','SMOKE_BOMB','H0',{type:TARGET_TYPE.ALL_ENEMIES}),hold('G0'),hold('G1'),hold('G2')],77);
  const blind=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.STATUS_APPLY&&e.payload?.key==='blind');assert.equal(blind.length,3);
  const group=buildPresentationTimeline(sim.events.snapshot()).find(c=>c.type===PRESENTATION_COMMAND.SIMULTANEOUS_FEEDBACK&&c.payload?.events?.length===3&&c.payload.events.every(e=>e.type===EVENT_TYPE.STATUS_APPLY&&e.payload?.key==='blind'));
  assert.ok(group,'all Smoke Bomb BLIND popups should replay together');
});

test('Stage25M browser exposes 2P chat, green room clarity, RESIST feedback and no declaration cast-frame pose',()=>{
  const html=readFileSync(new URL('../client/index.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../client/styles.css',import.meta.url),'utf8');
  const main=readFileSync(new URL('../client/main.js',import.meta.url),'utf8');
  const net=readFileSync(new URL('../client/network-client.js',import.meta.url),'utf8');
  const scene=readFileSync(new URL('../client/ros2-scene.js',import.meta.url),'utf8');
  assert.match(html,/id="chatTabButton"/);assert.match(html,/id="chatMessages"/);assert.match(html,/id="chatInput"/);
  assert.match(net,/sendChat\(text\)/);assert.match(main,/msg\.kind==='chat_message'/);
  assert.match(css,/join-room-button/);assert.match(css,/open-room/);
  assert.match(scene,/resisted\?'RESIST':'BLOCK'/);
  const charge=scene.match(/animateChargeStart\(command\)\{([\s\S]*?)\n  \}\n\n  animateCastEnd/);assert.ok(charge);assert.doesNotMatch(charge[1],/setFrame\(|\.play\(/);
});

class Peer{
  constructor(){this.ws=null;this.messages=[];this.waiters=[];}
  async connect(url){this.ws=new WebSocket(url);this.ws.addEventListener('message',e=>{const msg=JSON.parse(String(e.data));const i=this.waiters.findIndex(w=>w.kind===msg.kind&&(!w.pred||w.pred(msg)));if(i>=0){const[w]=this.waiters.splice(i,1);clearTimeout(w.timer);w.resolve(msg);}else this.messages.push(msg);});await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('connect timeout')),3000);this.ws.addEventListener('open',()=>{clearTimeout(t);resolve();},{once:true});this.ws.addEventListener('error',()=>{clearTimeout(t);reject(new Error('socket error'));},{once:true});});return this;}
  send(kind,payload={}){this.ws.send(JSON.stringify({kind,...payload}));}
  wait(kind,pred=null,timeout=4000){const i=this.messages.findIndex(m=>m.kind===kind&&(!pred||pred(m)));if(i>=0)return Promise.resolve(this.messages.splice(i,1)[0]);return new Promise((resolve,reject)=>{const w={kind,pred,resolve,timer:null};w.timer=setTimeout(()=>{const n=this.waiters.indexOf(w);if(n>=0)this.waiters.splice(n,1);reject(new Error(`timeout ${kind}`));},timeout);this.waiters.push(w);});}
  close(){try{this.ws?.close();}catch{}}
}
async function startServer(){const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');const child=spawn(process.execPath,['server/relay-server.cjs'],{cwd:root,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});let err='';child.stderr.on('data',d=>err+=String(d));const port=await new Promise((resolvePort,reject)=>{const t=setTimeout(()=>reject(new Error(`server timeout ${err}`)),5000);child.stdout.on('data',d=>{const m=String(d).match(/listening on (\d+)/);if(m){clearTimeout(t);resolvePort(Number(m[1]));}});});return{child,url:`ws://127.0.0.1:${port}/ws`};}

if(typeof WebSocket==='function')test('live coordinator relays room chat to both players before the match starts',async t=>{
  const {child,url}=await startServer();t.after(()=>{try{child.kill('SIGTERM');}catch{}});
  const a=await new Peer().connect(url),b=await new Peer().connect(url);t.after(()=>{a.close();b.close();});await a.wait('hello_ack');await b.wait('hello_ack');
  a.send('create_room',{id:'CHAT-ROOM',teamSize:1,draftBansPerPlayer:0,replaySpeed:.33});await a.wait('room_joined');
  b.send('join_room',{id:'CHAT-ROOM'});await b.wait('room_joined');await a.wait('room_locked');await b.wait('room_locked');
  a.send('chat_message',{text:'gg have fun'});
  const am=await a.wait('chat_message'),bm=await b.wait('chat_message');
  assert.equal(am.text,'gg have fun');assert.equal(bm.text,'gg have fun');assert.equal(am.side,'A');assert.equal(bm.roomId,'CHAT-ROOM');
});
