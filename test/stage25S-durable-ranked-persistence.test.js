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
const { RankedLadder }=require('../server/ranked-ladder.cjs');
const { SupabaseLadderStore, createSupabaseStoreFromEnv }=require('../server/ranked-store.cjs');
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');

async function fakeSupabase(){
  let row=null;
  const server=http.createServer(async(req,res)=>{
    const chunks=[];for await(const chunk of req)chunks.push(chunk);
    if(req.method==='GET'&&req.url.startsWith('/rest/v1/ros2_ranked_ladder')){
      res.setHeader('content-type','application/json');res.end(JSON.stringify(row?[{state:row.state}]:[]));return;
    }
    if(req.method==='POST'&&req.url.startsWith('/rest/v1/ros2_ranked_ladder')){
      const parsed=JSON.parse(Buffer.concat(chunks).toString('utf8')||'[]');row=parsed[0]??null;res.writeHead(201);res.end();return;
    }
    res.writeHead(404);res.end();
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const port=server.address().port;
  return {server,url:`http://127.0.0.1:${port}`,get row(){return row;}};
}

test('Stage25S Supabase snapshot survives loss of the coordinator local ladder file',async t=>{
  const fake=await fakeSupabase();t.after(()=>fake.server.close());
  const dir=mkdtempSync(join(tmpdir(),'ros2-stage25s-'));t.after(()=>rmSync(dir,{recursive:true,force:true}));
  const file1=join(dir,'first.json'),file2=join(dir,'after-restart.json');
  const store=new SupabaseLadderStore({url:fake.url,key:'server-secret'});
  const first=new RankedLadder({filePath:file1});
  first.recordMatch({matchId:'PERSIST-3V3',format:'3v3',playerA:'Alpha',playerB:'Beta',winnerSide:'A',teamA:['Warrior','Cleric','Mage'],teamB:['Rogue','Mystic','Shinobi']});
  await first.persistRemote(store);
  assert.equal(fake.row?.state?.recordedMatches?.['PERSIST-3V3']?.winnerSide,'A');

  const afterRestart=new RankedLadder({filePath:file2});
  assert.equal(afterRestart.snapshot().players.length,0);
  const hydrated=await afterRestart.hydrateFromRemote(store);
  assert.equal(hydrated.loaded,true);
  const snap=afterRestart.snapshot(),alpha=snap.players.find(p=>p.name==='Alpha');
  assert.equal(alpha?.wins,1);assert.equal(alpha?.formats?.['3v3']?.rating,1516);
  assert.equal(snap.champions.length,6);
});

test('Stage25S coordinator hydrates rankings from Supabase before serving clients',async t=>{
  const fake=await fakeSupabase();t.after(()=>fake.server.close());
  const seedDir=mkdtempSync(join(tmpdir(),'ros2-stage25s-seed-'));t.after(()=>rmSync(seedDir,{recursive:true,force:true}));
  const seed=new RankedLadder({filePath:join(seedDir,'seed.json')});
  seed.recordMatch({matchId:'REMOTE-2V2',format:'2v2',playerA:'Krez',playerB:'Rival',winnerSide:'A',teamA:['Warrior','Cleric'],teamB:['Mystic','Necromancer']});
  await seed.persistRemote(new SupabaseLadderStore({url:fake.url,key:'server-secret'}));

  const runtimeDir=mkdtempSync(join(tmpdir(),'ros2-stage25s-runtime-'));t.after(()=>rmSync(runtimeDir,{recursive:true,force:true}));
  const child=spawn(process.execPath,['server/relay-server.cjs'],{cwd:root,env:{...process.env,PORT:'0',ROS2_LADDER_FILE:join(runtimeDir,'ephemeral.json'),SUPABASE_URL:fake.url,SUPABASE_SERVICE_ROLE_KEY:'server-secret'},stdio:['ignore','pipe','pipe']});
  t.after(()=>{try{child.kill('SIGTERM');}catch{}});
  let stderr='';child.stderr.on('data',d=>stderr+=String(d));
  const port=await new Promise((resolvePort,reject)=>{const timer=setTimeout(()=>reject(new Error(`server timeout ${stderr}`)),5000);child.stdout.on('data',d=>{const m=String(d).match(/listening on (\d+)/);if(m){clearTimeout(timer);resolvePort(Number(m[1]));}});});
  const health=await fetch(`http://127.0.0.1:${port}/health`).then(r=>r.json());
  assert.equal(health.rankedPersistence.mode,'supabase');assert.equal(health.rankedPersistence.durable,true);assert.equal(health.rankedPersistence.remoteHealthy,true);
  const standings=await fetch(`http://127.0.0.1:${port}/rankings`).then(r=>r.json());
  assert.equal(standings.players.find(p=>p.name==='Krez')?.wins,1);
});

test('Stage25S refuses incomplete Supabase configuration and documents server-only setup',()=>{
  assert.throws(()=>createSupabaseStoreFromEnv({SUPABASE_URL:'https://example.supabase.co'}),/SUPABASE_LADDER_CONFIG_INCOMPLETE/);
  const readme=readFileSync(new URL('../server/README.md',import.meta.url),'utf8');
  const relay=readFileSync(new URL('../server/relay-server.cjs',import.meta.url),'utf8');
  assert.match(readme,/Render Free web services use an \*\*ephemeral filesystem\*\*/);
  assert.match(readme,/SUPABASE_SERVICE_ROLE_KEY/);assert.match(readme,/Never expose the service-role key/);
  assert.match(relay,/RANKED_STORAGE_UNAVAILABLE/);assert.match(relay,/rankedPersistence/);
});
