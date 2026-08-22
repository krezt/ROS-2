import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import {
  SIDE,TARGET_TYPE,cellsForArea,createBattleState,createHoldDeclaration,createRosterAbilityDeclaration,
  createRosterCombatScheduler,createRosterUnit,createRoundSimulation,getAbility,getArchetype,findStatus
} from '../src/index.js';

function unit(archetypeId,unitId,side,position,draftSlot=0){return createRosterUnit({archetypeId,unitId,side,draftSlot,position});}
function hold(actorId){return createHoldDeclaration({declarationId:`H:${actorId}`,roundNumber:1,actorId});}
function decl(archetypeId,abilityId,actorId,target){return createRosterAbilityDeclaration({declarationId:`D:${actorId}`,roundNumber:1,actorId,archetypeId,abilityId,target});}
function run(state,declarations,seed=1){const sim=createRoundSimulation({state,declarations,seed});createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:500});return sim;}

test('Stage25N adds 400 base HP to every playable champion',()=>{
  const expected={Warrior:2126,Barbarian:1997,Rogue:1700,Cleric:1784,Mage:1700,Paladin:1827,Archer:1700,Monk:1614,Necromancer:1700,Mystic:1571,Shinobi:1658,Electromancer:1614};
  for(const [id,hp] of Object.entries(expected))assert.equal(getArchetype(id).stats.maxHP,hp,id);
});

test('Warrior Power Strikes uses normal seven-swing pool and retains half movement / 165% damage',()=>{
  const a=getAbility('Warrior','POWER_STRIKE');
  assert.equal(a.label,'Power Strikes');
  assert.equal(a.basicStyle.attacksDelta,undefined);
  assert.equal(a.basicStyle.attacksSet,undefined);
  assert.equal(a.basicStyle.movementMultiplier,.5);
  assert.equal(a.basicStyle.damageMultiplier,1.65);
  const state=createBattleState({matchId:'PS7',units:[unit('Warrior','H0',SIDE.A,{row:5,col:4}),unit('Barbarian','G0',SIDE.B,{row:5,col:6})]});
  const sim=createRoundSimulation({state,declarations:[decl('Warrior','POWER_STRIKE','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'}),hold('G0')],seed:2});
  createRosterCombatScheduler(sim,{countersEnabled:false});
  assert.equal(sim.state.units.H0.resources.attacksRemaining,7);
  assert.equal(sim.state.units.H0.resources.movementRemaining,7);
});

test("Enid's Blessing heals all living allies for 15-25% of their own max HP and cures Poison",()=>{
  const state=createBattleState({matchId:'ENID-PCT',units:[
    unit('Cleric','H0',SIDE.A,{row:3,col:2}),unit('Warrior','H1',SIDE.A,{row:5,col:2},1),unit('Mage','H2',SIDE.A,{row:7,col:2},2),unit('Barbarian','G0',SIDE.B,{row:5,col:10})
  ]});
  const before={};
  for(const id of ['H0','H1','H2']){
    const u=state.units[id];u.stats.hp=Math.floor(u.stats.maxHP*.25);before[id]=u.stats.hp;
    u.statuses.push({key:'poison',duration:null,sourceId:'G0',data:{contributions:[{amount:80,sourceId:'G0'}]}});
  }
  const sim=run(state,[decl('Cleric','ENIDS_BLESSING','H0',{type:TARGET_TYPE.ALL_ALLIES}),hold('H1'),hold('H2'),hold('G0')],9);
  for(const id of ['H0','H1','H2']){
    const u=sim.state.units[id],healed=u.stats.hp-before[id];
    assert.ok(healed>=Math.floor(u.stats.maxHP*.15)&&healed<=Math.floor(u.stats.maxHP*.25),`${id} healed ${healed}`);
    assert.equal(findStatus(u,'poison'),null,id);
  }
});

test('Piercing Light uses a centered 7x7 target square',()=>{
  const light=getAbility('Cleric','PIERCING_LIGHT');
  assert.equal(light.area.shape,'SQUARE_7X7');
  assert.equal(cellsForArea({width:16,height:11},{shape:'SQUARE_7X7',center:{row:5,col:8}}).length,49);
});

test('browser exposes persistent player-name input and multiplayer code forwards names into rooms/chat',()=>{
  const html=readFileSync(new URL('../client/index.html',import.meta.url),'utf8');
  const main=readFileSync(new URL('../client/main.js',import.meta.url),'utf8');
  const net=readFileSync(new URL('../client/network-client.js',import.meta.url),'utf8');
  const server=readFileSync(new URL('../server/relay-server.cjs',import.meta.url),'utf8');
  assert.match(html,/id="playerNameInput"/);
  assert.match(main,/ros2-player-name/);assert.match(main,/Hosted by/);assert.match(main,/\(YOU\)/);
  assert.match(net,/setPlayerName\(name\)/);assert.match(net,/playerName:this\.playerName/);
  assert.match(server,/set_player_name/);assert.match(server,/hostName/);assert.match(server,/kind:'chat_message'.*name:/s);
});

class Peer{
  constructor(){this.ws=null;this.messages=[];this.waiters=[];}
  async connect(url){this.ws=new WebSocket(url);this.ws.addEventListener('message',e=>{const msg=JSON.parse(String(e.data));const i=this.waiters.findIndex(w=>w.kind===msg.kind&&(!w.pred||w.pred(msg)));if(i>=0){const[w]=this.waiters.splice(i,1);clearTimeout(w.timer);w.resolve(msg);}else this.messages.push(msg);});await new Promise((resolve,reject)=>{const t=setTimeout(()=>reject(new Error('connect timeout')),3000);this.ws.addEventListener('open',()=>{clearTimeout(t);resolve();},{once:true});this.ws.addEventListener('error',()=>{clearTimeout(t);reject(new Error('socket error'));},{once:true});});return this;}
  send(kind,payload={}){this.ws.send(JSON.stringify({kind,...payload}));}
  wait(kind,pred=null,timeout=4000){const i=this.messages.findIndex(m=>m.kind===kind&&(!pred||pred(m)));if(i>=0)return Promise.resolve(this.messages.splice(i,1)[0]);return new Promise((resolve,reject)=>{const w={kind,pred,resolve,timer:null};w.timer=setTimeout(()=>{const n=this.waiters.indexOf(w);if(n>=0)this.waiters.splice(n,1);reject(new Error(`timeout ${kind}`));},timeout);this.waiters.push(w);});}
  close(){try{this.ws?.close();}catch{}}
}
async function startServer(){const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');const child=spawn(process.execPath,['server/relay-server.cjs'],{cwd:root,env:{...process.env,PORT:'0'},stdio:['ignore','pipe','pipe']});let err='';child.stderr.on('data',d=>err+=String(d));const port=await new Promise((resolvePort,reject)=>{const t=setTimeout(()=>reject(new Error(`server timeout ${err}`)),5000);child.stdout.on('data',d=>{const m=String(d).match(/listening on (\d+)/);if(m){clearTimeout(t);resolvePort(Number(m[1]));}});});return{child,url:`ws://127.0.0.1:${port}/ws`};}

if(typeof WebSocket==='function')test('live coordinator advertises host name and attaches player names to chat',async t=>{
  const {child,url}=await startServer();t.after(()=>{try{child.kill('SIGTERM');}catch{}});
  const a=await new Peer().connect(url),b=await new Peer().connect(url),viewer=await new Peer().connect(url);t.after(()=>{a.close();b.close();viewer.close();});
  await a.wait('hello_ack');await b.wait('hello_ack');await viewer.wait('hello_ack');
  a.send('set_player_name',{playerName:'Krez'});b.send('set_player_name',{playerName:'Rival'});
  a.send('create_room',{id:'NAMED-ROOM',teamSize:1,draftBansPerPlayer:0,replaySpeed:.33,playerName:'Krez'});await a.wait('room_joined');
  viewer.send('list_rooms');const rooms=await viewer.wait('rooms',m=>m.rooms?.some(r=>r.id==='NAMED-ROOM'));assert.equal(rooms.rooms.find(r=>r.id==='NAMED-ROOM').hostName,'Krez');
  b.send('join_room',{id:'NAMED-ROOM',playerName:'Rival'});const bj=await b.wait('room_joined');assert.deepEqual(bj.playerNames,{A:'Krez',B:'Rival'});await a.wait('room_locked');await b.wait('room_locked');
  a.send('chat_message',{text:'welcome'});const msg=await b.wait('chat_message');assert.equal(msg.name,'Krez');assert.equal(msg.text,'welcome');
});
