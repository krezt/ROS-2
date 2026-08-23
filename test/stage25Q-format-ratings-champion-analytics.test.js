import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';

const require=createRequire(import.meta.url);
const { RankedLadder, INITIAL_RATING, ELO_K }=require('../server/ranked-ladder.cjs');

const T3A=['Warrior','Cleric','Mage'],T3B=['Rogue','Mystic','Shinobi'];
const T4A=['Warrior','Cleric','Mage','Paladin'],T4B=['Rogue','Mystic','Shinobi','Electromancer'];

test('each team size owns an independent Elo rating and ladder rank',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ros2-stage25q-rating-')),file=join(dir,'ladder.json');
  try{
    const ladder=new RankedLadder({filePath:file});
    ladder.recordMatch({matchId:'3A',format:'3v3',playerA:'Alpha',playerB:'Beta',winnerSide:'A',teamA:T3A,teamB:T3B});
    let snap=ladder.snapshot(),alpha=snap.players.find(p=>p.name==='Alpha'),beta=snap.players.find(p=>p.name==='Beta');
    assert.equal(snap.ratingSystem.initial,INITIAL_RATING);assert.equal(snap.ratingSystem.kFactor,ELO_K);
    assert.equal(alpha.formats['3v3'].rating,1516);assert.equal(beta.formats['3v3'].rating,1484);
    assert.equal(alpha.formats['3v3'].rank,1);assert.equal(beta.formats['3v3'].rank,2);
    assert.equal(alpha.formats['4v4'].rating,1500);assert.equal(alpha.formats['4v4'].rank,null);

    ladder.recordMatch({matchId:'4A',format:'4v4',playerA:'Alpha',playerB:'Beta',winnerSide:'B',teamA:T4A,teamB:T4B});
    snap=ladder.snapshot();alpha=snap.players.find(p=>p.name==='Alpha');beta=snap.players.find(p=>p.name==='Beta');
    assert.equal(alpha.formats['3v3'].rating,1516);assert.equal(beta.formats['3v3'].rating,1484);
    assert.equal(alpha.formats['4v4'].rating,1484);assert.equal(beta.formats['4v4'].rating,1516);
    assert.equal(beta.formats['4v4'].rank,1);assert.equal(alpha.formats['4v4'].rank,2);
    assert.deepEqual([alpha.wins,alpha.losses],[1,1]);assert.deepEqual([beta.wins,beta.losses],[1,1]);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('ranked draft champions receive aggregate and per-format W/L for balance analytics',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ros2-stage25q-champs-')),file=join(dir,'ladder.json');
  try{
    const ladder=new RankedLadder({filePath:file});
    ladder.recordMatch({matchId:'C1',format:'3v3',playerA:'Alpha',playerB:'Beta',winnerSide:'A',teamA:T3A,teamB:T3B});
    ladder.recordMatch({matchId:'C2',format:'4v4',playerA:'Alpha',playerB:'Beta',winnerSide:'B',teamA:T4A,teamB:T4B});
    const snap=ladder.snapshot(),warrior=snap.champions.find(c=>c.name==='Warrior'),rogue=snap.champions.find(c=>c.name==='Rogue'),electro=snap.champions.find(c=>c.name==='Electromancer');
    assert.deepEqual([warrior.wins,warrior.losses],[1,1]);
    assert.deepEqual([warrior.formats['3v3'].wins,warrior.formats['3v3'].losses],[1,0]);
    assert.deepEqual([warrior.formats['4v4'].wins,warrior.formats['4v4'].losses],[0,1]);
    assert.equal(warrior.formats['3v3'].winPct,100);assert.equal(warrior.formats['4v4'].winPct,0);
    assert.deepEqual([rogue.formats['3v3'].wins,rogue.formats['3v3'].losses],[0,1]);
    assert.deepEqual([rogue.formats['4v4'].wins,rogue.formats['4v4'].losses],[1,0]);
    assert.equal(electro.formats['4v4'].winPct,100);assert.equal(electro.formats['4v4'].rank,1);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('version 1 ladder files migrate W/L and rebuild per-format ratings without inventing champion history',()=>{
  const dir=mkdtempSync(join(tmpdir(),'ros2-stage25q-migrate-')),file=join(dir,'ladder.json');
  try{
    writeFileSync(file,JSON.stringify({version:1,updatedAt:'2026-08-22T00:00:00.000Z',players:{alpha:{name:'Alpha',wins:1,losses:0,formats:{'3v3':{wins:1,losses:0}}},beta:{name:'Beta',wins:0,losses:1,formats:{'3v3':{wins:0,losses:1}}}},recordedMatches:{OLD1:{format:'3v3',winnerSide:'A',playerA:'Alpha',playerB:'Beta',recordedAt:'2026-08-22T00:00:00.000Z'}}},null,2));
    const snap=new RankedLadder({filePath:file}).snapshot(),alpha=snap.players.find(p=>p.name==='Alpha'),beta=snap.players.find(p=>p.name==='Beta');
    assert.equal(snap.version,3);assert.equal(alpha.formats['3v3'].rating,1516);assert.equal(beta.formats['3v3'].rating,1484);assert.deepEqual(snap.champions,[]);
  }finally{rmSync(dir,{recursive:true,force:true});}
});

test('rankings UI exposes team-size tabs plus player ladder and champion win-rate views',()=>{
  const html=readFileSync(new URL('../client/index.html',import.meta.url),'utf8'),css=readFileSync(new URL('../client/styles.css',import.meta.url),'utf8'),main=readFileSync(new URL('../client/main.js',import.meta.url),'utf8');
  for(const f of ['1v1','2v2','3v3','4v4','5v5'])assert.match(html,new RegExp(`data-ranking-format="${f}"`));
  assert.match(html,/id="rankPlayersButton"/);assert.match(html,/id="rankChampionsButton"/);assert.match(html,/independent Elo rating/);
  assert.match(css,/rankings-format-tabs/);assert.match(css,/rankings-rating/);assert.match(main,/rankingView==='champions'/);assert.match(main,/formatRecord\.rating/);assert.match(main,/CHAMPION WIN RATES/);
});
