import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname, resolve } from 'node:path';
import { createRequire } from 'node:module';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const require=createRequire(import.meta.url);
const { SupabaseLadderStore,createSupabaseStoreFromEnv }=require('../server/ranked-store.cjs');
const { RankedLadder }=require('../server/ranked-ladder.cjs');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

async function fakeSupabase({mutateRead=false}={}){
  let row=null;const requests=[];
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    requests.push({method:req.method,url:req.url,headers:{...req.headers}});
    if(req.method==='GET'&&req.url.startsWith('/rest/v1/ros2_ranked_ladder')){
      res.setHeader('content-type','application/json');
      if(!row)return res.end('[]');
      const state=structuredClone(row.state);
      if(mutateRead)state.persistenceRevision=(Number(state.persistenceRevision)||0)+99;
      return res.end(JSON.stringify([{state}]));
    }
    if(req.method==='POST'&&req.url.startsWith('/rest/v1/ros2_ranked_ladder')){
      const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8')||'[]');row=parsed[0]??null;res.writeHead(201);return res.end();
    }
    res.writeHead(404);res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  return {server,url:`http://127.0.0.1:${port}`,requests,get row(){return row;}};
}

async function spawnCoordinator(env={}){
  const child=spawn(process.execPath,['server/relay-server.cjs'],{cwd:root,env:{...process.env,PORT:'0',...env},stdio:['ignore','pipe','pipe']});
  let stderr='';child.stderr.on('data',d=>stderr+=String(d));
  const port=await new Promise((resolvePort,reject)=>{const timer=setTimeout(()=>reject(new Error(`server timeout ${stderr}`)),5000);child.stdout.on('data',d=>{const m=String(d).match(/listening on (\d+)/);if(m){clearTimeout(timer);resolvePort(Number(m[1]));}});});
  return {child,port,get stderr(){return stderr;}};
}

class WsClient{
  constructor(){this.messages=[];this.waiters=[];}
  async connect(url){this.ws=new WebSocket(url);this.ws.addEventListener('message',e=>{const msg=JSON.parse(String(e.data));const i=this.waiters.findIndex(w=>w.kind===msg.kind);if(i>=0){const[w]=this.waiters.splice(i,1);clearTimeout(w.timer);w.resolve(msg);}else this.messages.push(msg);});await new Promise((resolveOpen,reject)=>{const t=setTimeout(()=>reject(new Error('connect timeout')),3000);this.ws.addEventListener('open',()=>{clearTimeout(t);resolveOpen();},{once:true});this.ws.addEventListener('error',()=>{clearTimeout(t);reject(new Error('socket error'));},{once:true});});return this;}
  send(obj){this.ws.send(JSON.stringify(obj));}
  wait(kind,ms=2500){const existing=this.messages.findIndex(m=>m.kind===kind);if(existing>=0)return Promise.resolve(this.messages.splice(existing,1)[0]);return new Promise((resolveWait,reject)=>{const timer=setTimeout(()=>reject(new Error(`timeout ${kind}`)),ms);this.waiters.push({kind,resolve:resolveWait,reject,timer});});}
  close(){try{this.ws.close();}catch{}}
}

test('Stage25U uses apikey-only auth for new sb_secret Supabase keys and legacy Bearer auth for service_role JWTs',async t=>{
  const fake=await fakeSupabase();t.after(()=>fake.server.close());
  const modern=new SupabaseLadderStore({url:fake.url,key:'sb_secret_example_123'});
  await modern.saveAndVerify({version:4,persistenceRevision:7,updatedAt:'now',players:{},champions:{},recordedMatches:{},championTrackingSince:null});
  const modernRequests=fake.requests.slice(-2);
  for(const req of modernRequests){assert.equal(req.headers.apikey,'sb_secret_example_123');assert.equal(req.headers.authorization,undefined);}
  const legacy=new SupabaseLadderStore({url:fake.url,key:'legacy.jwt.service_role'});
  await legacy.load();
  const legacyReq=fake.requests.at(-1);assert.equal(legacyReq.headers.apikey,'legacy.jwt.service_role');assert.equal(legacyReq.headers.authorization,'Bearer legacy.jwt.service_role');
  assert.ok(createSupabaseStoreFromEnv({SUPABASE_URL:fake.url,SUPABASE_SECRET_KEY:'sb_secret_current'}));
});

test('Stage25U read-after-write verification catches a remote snapshot mismatch',async t=>{
  const fake=await fakeSupabase({mutateRead:true});t.after(()=>fake.server.close());
  const store=new SupabaseLadderStore({url:fake.url,key:'sb_secret_verify'});
  const dir=mkdtempSync(join(tmpdir(),'ros2-25u-verify-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const ladder=new RankedLadder({filePath:join(dir,'ladder.json')});
  ladder.recordMatch({matchId:'VERIFY-2V2',format:'2v2',playerA:'Alpha',playerB:'Beta',winnerSide:'A',teamA:['Warrior','Cleric'],teamB:['Rogue','Mystic']});
  await assert.rejects(()=>ladder.persistRemote(store),/SUPABASE_VERIFY_MISMATCH/);
});

test('Stage25U hosted coordinator fails closed when durable Ranked storage is unavailable',async t=>{
  const dir=mkdtempSync(join(tmpdir(),'ros2-25u-hosted-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const {child,port}=await spawnCoordinator({RENDER:'true',ROS2_LADDER_FILE:join(dir,'ephemeral.json'),SUPABASE_URL:'',SUPABASE_SERVICE_ROLE_KEY:'',SUPABASE_SECRET_KEY:''});
  t.after(()=>{try{child.kill('SIGTERM');}catch{}});
  const health=await fetch(`http://127.0.0.1:${port}/health`).then(r=>r.json());
  assert.equal(health.rankedPersistence.required,true);assert.equal(health.rankedPersistence.durable,false);
  const rankings=await fetch(`http://127.0.0.1:${port}/rankings`).then(r=>r.json());assert.equal(rankings.persistence.durable,false);
  if(typeof WebSocket==='function'){
    const client=await new WsClient().connect(`ws://127.0.0.1:${port}/ws`);t.after(()=>client.close());await client.wait('hello_ack');
    client.send({kind:'create_room',ranked:true,teamSize:3,playerName:'Alpha'});
    const err=await client.wait('error');assert.equal(err.code,'RANKED_STORAGE_UNAVAILABLE');
  }
});

test('Stage25U surfaces Ranked persistence health in the client and fixes rankings-modal focus warning',()=>{
  const main=readFileSync(new URL('../client/main.js',import.meta.url),'utf8');
  const html=readFileSync(new URL('../client/index.html',import.meta.url),'utf8');
  const css=readFileSync(new URL('../client/styles.css',import.meta.url),'utf8');
  assert.match(html,/rankedPersistenceStatus/);assert.match(css,/ranked-persistence-status\.healthy/);assert.match(css,/ranked-persistence-status\.error/);
  assert.match(main,/RANKED STORAGE: SUPABASE VERIFIED/);assert.match(main,/RANKED_STORAGE_UNAVAILABLE/);assert.match(main,/ranked_storage_error/);
  assert.match(main,/modal\.contains\(document\.activeElement\).*viewRankingsBtn/s);
});
