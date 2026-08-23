const fs = require('fs');
const path = require('path');

const FORMATS = Object.freeze(['1v1','2v2','3v3','4v4','5v5']);
const INITIAL_RATING = 1500;
const ELO_K = 32;

function cleanName(value){
  return String(value ?? 'Player')
    .replace(/[<>&\u0000-\u001f\u007f]/g,'')
    .replace(/\s+/g,' ')
    .trim()
    .slice(0,20) || 'Player';
}
function keyForName(value){return cleanName(value).toLocaleLowerCase('en-US');}
function cleanChampion(value){return String(value??'').replace(/[<>&\u0000-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim().slice(0,40);}
function keyForChampion(value){return cleanChampion(value).toLocaleLowerCase('en-US');}
function emptyRecord({rating=true}={}){return rating?{wins:0,losses:0,rating:INITIAL_RATING}:{wins:0,losses:0};}
function normalizeRecord(value,{rating=true}={}){
  const out={wins:Math.max(0,Number(value?.wins)||0),losses:Math.max(0,Number(value?.losses)||0)};
  if(rating)out.rating=Number.isFinite(Number(value?.rating))?Math.max(0,Math.round(Number(value.rating))):INITIAL_RATING;
  return out;
}
function games(record){return (record?.wins??0)+(record?.losses??0);}
function winPct(record){const total=games(record);return total?Math.round(((record?.wins??0)/total)*1000)/10:0;}
function expectedScore(own,opponent){return 1/(1+Math.pow(10,(opponent-own)/400));}
function eloPair(ratingA,ratingB,winnerSide){
  const a=Number(ratingA)||INITIAL_RATING,b=Number(ratingB)||INITIAL_RATING;
  const scoreA=winnerSide==='A'?1:0,scoreB=1-scoreA;
  return {
    A:Math.max(0,Math.round(a+ELO_K*(scoreA-expectedScore(a,b)))),
    B:Math.max(0,Math.round(b+ELO_K*(scoreB-expectedScore(b,a))))
  };
}
function teamSizeForFormat(format){const n=Number(String(format??'').split('v')[0]);return Number.isInteger(n)&&n>=1&&n<=5?n:null;}
function normalizeTeam(team,expectedSize){
  if(!Array.isArray(team))throw new Error('RANKED_TEAMS_REQUIRED');
  const out=team.map(cleanChampion).filter(Boolean);
  if(out.length!==expectedSize)throw new Error('RANKED_TEAM_SIZE_MISMATCH');
  if(new Set(out.map(keyForChampion)).size!==out.length)throw new Error('RANKED_TEAM_DUPLICATE_CHAMPION');
  return out;
}

class RankedLadder {
  constructor({filePath}={}){
    this.filePath=filePath||path.join(__dirname,'data','ranked-ladder.json');
    this.data={version:2,updatedAt:null,players:{},champions:{},recordedMatches:{},championTrackingSince:null};
    this.load();
  }
  load(){
    try{
      if(!fs.existsSync(this.filePath))return;
      const parsed=JSON.parse(fs.readFileSync(this.filePath,'utf8'));
      if(!parsed||typeof parsed!=='object')return;
      const oldVersion=Number(parsed.version)||1;
      this.data={
        version:2,
        updatedAt:parsed.updatedAt??null,
        players:parsed.players&&typeof parsed.players==='object'?parsed.players:{},
        champions:parsed.champions&&typeof parsed.champions==='object'?parsed.champions:{},
        recordedMatches:parsed.recordedMatches&&typeof parsed.recordedMatches==='object'?parsed.recordedMatches:{},
        championTrackingSince:parsed.championTrackingSince??null
      };
      for(const p of Object.values(this.data.players))this.ensurePlayer(p?.name);
      for(const c of Object.values(this.data.champions))this.ensureChampion(c?.name);
      if(oldVersion<2){this.rebuildRatingsFromHistory();this.save();}
    }catch(err){console.warn(`[RANKED] Failed to load ladder ${this.filePath}: ${err.message}`);}
  }
  save(){
    try{
      fs.mkdirSync(path.dirname(this.filePath),{recursive:true});
      const tmp=`${this.filePath}.tmp`;
      fs.writeFileSync(tmp,JSON.stringify(this.data,null,2));
      fs.renameSync(tmp,this.filePath);
    }catch(err){console.warn(`[RANKED] Failed to save ladder ${this.filePath}: ${err.message}`);}
  }
  ensurePlayer(name){
    const displayName=cleanName(name),key=keyForName(displayName);
    let p=this.data.players[key];
    if(!p){p={name:displayName,wins:0,losses:0,formats:Object.fromEntries(FORMATS.map(f=>[f,emptyRecord()])),lastPlayedAt:null};this.data.players[key]=p;}
    p.name=displayName;p.wins=Math.max(0,Number(p.wins)||0);p.losses=Math.max(0,Number(p.losses)||0);
    if(!p.formats||typeof p.formats!=='object')p.formats={};
    for(const f of FORMATS)p.formats[f]=normalizeRecord(p.formats[f]);
    return p;
  }
  ensureChampion(name){
    const displayName=cleanChampion(name);if(!displayName)throw new Error('INVALID_RANKED_CHAMPION');
    const key=keyForChampion(displayName);let c=this.data.champions[key];
    if(!c){c={name:displayName,wins:0,losses:0,formats:Object.fromEntries(FORMATS.map(f=>[f,emptyRecord({rating:false})])),lastPlayedAt:null};this.data.champions[key]=c;}
    c.name=displayName;c.wins=Math.max(0,Number(c.wins)||0);c.losses=Math.max(0,Number(c.losses)||0);
    if(!c.formats||typeof c.formats!=='object')c.formats={};
    for(const f of FORMATS)c.formats[f]=normalizeRecord(c.formats[f],{rating:false});
    return c;
  }
  rebuildRatingsFromHistory(){
    for(const raw of Object.values(this.data.players)){
      const p=this.ensurePlayer(raw?.name);
      for(const f of FORMATS)p.formats[f].rating=INITIAL_RATING;
    }
    const history=Object.entries(this.data.recordedMatches)
      .map(([matchId,m])=>({matchId,...m}))
      .filter(m=>FORMATS.includes(m.format)&&(m.winnerSide==='A'||m.winnerSide==='B')&&m.playerA&&m.playerB)
      .sort((a,b)=>String(a.recordedAt??'').localeCompare(String(b.recordedAt??''))||String(a.matchId).localeCompare(String(b.matchId)));
    for(const m of history){
      const a=this.ensurePlayer(m.playerA),b=this.ensurePlayer(m.playerB),ra=a.formats[m.format],rb=b.formats[m.format];
      const next=eloPair(ra.rating,rb.rating,m.winnerSide);ra.rating=next.A;rb.rating=next.B;
    }
  }
  recordMatch({matchId,format,playerA,playerB,winnerSide,teamA,teamB}){
    const id=String(matchId??'').trim();if(!id)throw new Error('RANKED_MATCH_ID_REQUIRED');
    if(!FORMATS.includes(format))throw new Error('INVALID_RANKED_FORMAT');
    if(winnerSide!=='A'&&winnerSide!=='B')throw new Error('INVALID_RANKED_WINNER');
    if(this.data.recordedMatches[id])return {recorded:false,standings:this.snapshot()};
    const size=teamSizeForFormat(format),aTeam=normalizeTeam(teamA,size),bTeam=normalizeTeam(teamB,size);
    const allChampions=[...aTeam,...bTeam].map(keyForChampion);if(new Set(allChampions).size!==allChampions.length)throw new Error('RANKED_CHAMPION_ON_BOTH_TEAMS');
    const a=this.ensurePlayer(playerA),b=this.ensurePlayer(playerB);if(keyForName(a.name)===keyForName(b.name))throw new Error('RANKED_NAMES_MUST_DIFFER');
    const aFormat=a.formats[format],bFormat=b.formats[format],before={A:aFormat.rating,B:bFormat.rating},after=eloPair(before.A,before.B,winnerSide);
    const winner=winnerSide==='A'?a:b,loser=winnerSide==='A'?b:a;winner.wins+=1;winner.formats[format].wins+=1;loser.losses+=1;loser.formats[format].losses+=1;
    aFormat.rating=after.A;bFormat.rating=after.B;
    const now=new Date().toISOString();winner.lastPlayedAt=now;loser.lastPlayedAt=now;
    const updateChampion=(champion,side)=>{const c=this.ensureChampion(champion),won=side===winnerSide;c[won?'wins':'losses']+=1;c.formats[format][won?'wins':'losses']+=1;c.lastPlayedAt=now;};
    for(const champion of aTeam)updateChampion(champion,'A');for(const champion of bTeam)updateChampion(champion,'B');
    if(!this.data.championTrackingSince)this.data.championTrackingSince=now;
    this.data.updatedAt=now;
    this.data.recordedMatches[id]={format,winnerSide,playerA:a.name,playerB:b.name,teamA:[...aTeam],teamB:[...bTeam],ratingBefore:before,ratingAfter:after,recordedAt:now};
    this.save();return {recorded:true,standings:this.snapshot()};
  }
  snapshot(){
    const players=Object.values(this.data.players).map(raw=>{
      const p=this.ensurePlayer(raw?.name),wins=p.wins,losses=p.losses,total=games({wins,losses}),formats={};
      for(const f of FORMATS){const r=normalizeRecord(p.formats?.[f]);formats[f]={...r,games:games(r),winPct:winPct(r),rank:null};}
      return {name:cleanName(p.name),wins,losses,games:total,winPct:winPct({wins,losses}),formats,lastPlayedAt:p.lastPlayedAt??null,rank:null};
    });
    players.sort((a,b)=>b.wins-a.wins||a.losses-b.losses||b.games-a.games||a.name.localeCompare(b.name));players.forEach((p,i)=>p.rank=i+1);
    for(const f of FORMATS){
      const ranked=players.filter(p=>p.formats[f].games>0).sort((a,b)=>b.formats[f].rating-a.formats[f].rating||b.formats[f].wins-a.formats[f].wins||a.formats[f].losses-b.formats[f].losses||a.name.localeCompare(b.name));
      ranked.forEach((p,i)=>p.formats[f].rank=i+1);
    }
    const champions=Object.values(this.data.champions).map(raw=>{
      const c=this.ensureChampion(raw?.name),wins=c.wins,losses=c.losses,total=games({wins,losses}),formats={};
      for(const f of FORMATS){const r=normalizeRecord(c.formats?.[f],{rating:false});formats[f]={...r,games:games(r),winPct:winPct(r),rank:null};}
      return {name:cleanChampion(c.name),wins,losses,games:total,winPct:winPct({wins,losses}),formats,lastPlayedAt:c.lastPlayedAt??null,rank:null};
    });
    champions.sort((a,b)=>b.winPct-a.winPct||b.games-a.games||b.wins-a.wins||a.name.localeCompare(b.name));champions.forEach((c,i)=>c.rank=i+1);
    for(const f of FORMATS){
      const ranked=champions.filter(c=>c.formats[f].games>0).sort((a,b)=>b.formats[f].winPct-a.formats[f].winPct||b.formats[f].games-a.formats[f].games||b.formats[f].wins-a.formats[f].wins||a.name.localeCompare(b.name));
      ranked.forEach((c,i)=>c.formats[f].rank=i+1);
    }
    return {version:2,updatedAt:this.data.updatedAt,formats:[...FORMATS],ratingSystem:{name:'Elo',initial:INITIAL_RATING,kFactor:ELO_K},players,champions,championTrackingSince:this.data.championTrackingSince};
  }
}

module.exports={RankedLadder,FORMATS,INITIAL_RATING,ELO_K,cleanName,keyForName,cleanChampion,keyForChampion};
