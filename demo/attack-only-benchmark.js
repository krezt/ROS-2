import fs from 'node:fs';
import path from 'node:path';
import {
  EVENT_TYPE, LIFE_STATE, ROSTER_IDS, SIDE, TARGET_TYPE,
  createBattleState, cloneBattleState, createRosterAbilityDeclaration,
  createRosterCombatScheduler, createRosterUnit, createRoundSimulation,
  getArchetype
} from '../src/index.js';
import { closeRound, advanceClosedRound } from '../src/status-engine.js';

const repsPerPair = Math.max(1, Number(process.argv[2] ?? 10));
const maxRounds = Math.max(1, Number(process.argv[3] ?? 20));

function basicId(id){return getArchetype(id).abilities.find(a=>a.id.endsWith('_ATTACK'))?.id;}
function declaration(roundNumber, unit, targetId){
  return createRosterAbilityDeclaration({roundNumber,actorId:unit.unitId,archetypeId:unit.archetypeId,abilityId:basicId(unit.archetypeId),target:{type:TARGET_TYPE.UNIT,unitId:targetId}});
}
function alive(state,id){return state.units[id]?.lifeState===LIFE_STATE.ALIVE;}

function runDuel(aId,bId,seed,orientation=0){
  const aSide=orientation===0?SIDE.A:SIDE.B, bSide=orientation===0?SIDE.B:SIDE.A;
  const aUnitId=aSide===SIDE.A?'H0':'G0', bUnitId=bSide===SIDE.A?'H0':'G0';
  const aPos=aSide===SIDE.A?{row:5,col:1}:{row:5,col:14};
  const bPos=bSide===SIDE.A?{row:5,col:1}:{row:5,col:14};
  let state=createBattleState({matchId:`DUEL:${aId}:${bId}:${seed}`,board:{width:16,height:11},units:[
    createRosterUnit({archetypeId:aId,unitId:aUnitId,side:aSide,draftSlot:1,position:aPos}),
    createRosterUnit({archetypeId:bId,unitId:bUnitId,side:bSide,draftSlot:1,position:bPos})
  ]});
  const totals={rounds:0,damage:{[aId]:0,[bId]:0},basicDamage:{[aId]:0,[bId]:0},procDamage:{[aId]:0,[bId]:0},procHealing:{[aId]:0,[bId]:0},procCounts:{[aId]:{},[bId]:{}},procRoundDist:{[aId]:{0:0,1:0,2:0,3:0},[bId]:{0:0,1:0,2:0,3:0}},attacks:{[aId]:0,[bId]:0},hits:{[aId]:0,[bId]:0},crits:{[aId]:0,[bId]:0}};
  for(let r=0;r<maxRounds && state.outcome.status==='ACTIVE';r++){
    const roundNumber=state.roundNumber;
    const au=state.units[aUnitId], bu=state.units[bUnitId];
    const declarations=[declaration(roundNumber,au,bUnitId),declaration(roundNumber,bu,aUnitId)];
    const sim=createRoundSimulation({state,declarations,seed:((seed+roundNumber*0x9e3779b9)>>>0)||1});
    createRosterCombatScheduler(sim,{countersEnabled:true}).runUntilCombatSettled({maxCycles:5000});
    closeRound(sim,{advanceRound:false});
    totals.rounds++;
    const roundProcCount={[aId]:0,[bId]:0};
    for(const e of sim.events.snapshot()){
      const actorArch=e.actorId?sim.state.units[e.actorId]?.archetypeId:null;
      if(!actorArch||!(actorArch in totals.damage))continue;
      if(e.type===EVENT_TYPE.ATTACK_START)totals.attacks[actorArch]++;
      if(e.type===EVENT_TYPE.ATTACK_IMPACT)totals.hits[actorArch]++;
      if(e.type===EVENT_TYPE.CRIT)totals.crits[actorArch]++;
      if(e.type===EVENT_TYPE.DAMAGE){
        const n=Math.max(0,Number(e.payload?.amount??0));totals.damage[actorArch]+=n;
        if(e.payload?.proc){totals.procDamage[actorArch]+=n;const label=e.payload?.procLabel??'Proc';totals.procCounts[actorArch][label]=(totals.procCounts[actorArch][label]??0)+1;roundProcCount[actorArch]++;}
        else totals.basicDamage[actorArch]+=n;
      }
      if(e.type===EVENT_TYPE.HEAL&&e.payload?.proc){
        const n=Math.max(0,Number(e.payload?.amount??0));totals.procHealing[actorArch]+=n;
        const label=e.payload?.procLabel??'Proc';
        // Life Drip's proc count is represented by its damage event; Prayer Mend has no proc damage event.
        if(label!=='Life Drip'){totals.procCounts[actorArch][label]=(totals.procCounts[actorArch][label]??0)+1;roundProcCount[actorArch]++;}
      }
      if(e.type===EVENT_TYPE.STATUS_APPLY&&e.payload?.data?.proc){
        const label=e.payload.data.procLabel??e.payload.key??'Proc';totals.procCounts[actorArch][label]=(totals.procCounts[actorArch][label]??0)+1;roundProcCount[actorArch]++;
      }
      if(e.type===EVENT_TYPE.STUN&&actorArch==='Mage'){totals.procCounts[actorArch]['Arc Shock']=(totals.procCounts[actorArch]['Arc Shock']??0)+1;roundProcCount[actorArch]++;}
    }
    for(const arch of [aId,bId]){const n=Math.min(3,roundProcCount[arch]??0);totals.procRoundDist[arch][n]=(totals.procRoundDist[arch][n]??0)+1;}
    if(sim.state.outcome.status==='COMPLETE'){state=cloneBattleState(sim.state);break;}
    advanceClosedRound(sim);state=cloneBattleState(sim.state);
  }
  const winnerUnit=state.outcome.status==='COMPLETE'&&state.outcome.winner?Object.values(state.units).find(u=>u.side===state.outcome.winner&&u.entityKind!=='SUMMON')?.archetypeId:null;
  return {aId,bId,winner:winnerUnit,draw:state.outcome.status!=='COMPLETE',...totals};
}

const leaderboard=Object.fromEntries(ROSTER_IDS.map(id=>[id,{archetype:id,appearances:0,wins:0,losses:0,draws:0,rounds:0,damage:0,basicDamage:0,procDamage:0,procHealing:0,attacks:0,hits:0,crits:0,procCounts:{},procRoundDist:{0:0,1:0,2:0,3:0}}]));
const duels=[];
let matchIndex=0;
for(let i=0;i<ROSTER_IDS.length;i++)for(let j=i+1;j<ROSTER_IDS.length;j++){
  const a=ROSTER_IDS[i],b=ROSTER_IDS[j];
  for(let r=0;r<repsPerPair;r++){
    const orientation=r%2;
    const seed=((0x23140000 + (++matchIndex)*2654435761 + r*97)>>>0)||1;
    const result=runDuel(a,b,seed,orientation);duels.push(result);
    for(const id of [a,b]){
      const row=leaderboard[id];row.appearances++;row.rounds+=result.rounds;row.damage+=result.damage[id];row.basicDamage+=result.basicDamage[id];row.procDamage+=result.procDamage[id];row.procHealing+=result.procHealing[id];row.attacks+=result.attacks[id];row.hits+=result.hits[id];row.crits+=result.crits[id];
      for(const [label,n] of Object.entries(result.procCounts[id]))row.procCounts[label]=(row.procCounts[label]??0)+n;
      for(const [n,count] of Object.entries(result.procRoundDist[id]??{}))row.procRoundDist[n]=(row.procRoundDist[n]??0)+count;
      if(result.draw)row.draws++;else if(result.winner===id)row.wins++;else row.losses++;
    }
  }
}
const rows=Object.values(leaderboard).map(r=>({
  ...r,
  winPct:+(100*r.wins/Math.max(1,r.appearances-r.draws)).toFixed(1),
  avgDamage:+(r.damage/r.appearances).toFixed(1),
  avgDamagePerRound:+(r.damage/Math.max(1,r.rounds)).toFixed(1),
  avgBasicDamage:+(r.basicDamage/r.appearances).toFixed(1),
  avgProcDamage:+(r.procDamage/r.appearances).toFixed(1),
  avgProcHealing:+(r.procHealing/r.appearances).toFixed(1),
  hitRate:+(100*r.hits/Math.max(1,r.attacks)).toFixed(1),
  critRate:+(100*r.crits/Math.max(1,r.hits)).toFixed(1),
  procs:Object.values(r.procCounts).reduce((a,b)=>a+b,0),
  avgProcs:+(Object.values(r.procCounts).reduce((a,b)=>a+b,0)/r.appearances).toFixed(2)
})).sort((a,b)=>b.avgDamage-a.avgDamage||b.winPct-a.winPct);

const report={generatedAt:new Date().toISOString(),rules:{repsPerPair,maxRounds,totalDuels:duels.length,format:'round-robin 1v1; Attack only; counters enabled; B6 vs O6-equivalent center-lane starts; all proc effects enabled'},leaderboard:rows,duels};
const outDir=path.resolve('benchmark');fs.mkdirSync(outDir,{recursive:true});
fs.writeFileSync(path.join(outDir,'attack-only-660.json'),JSON.stringify(report,null,2));
const header='| Rank | Archetype | Win % | Avg dmg/match | Dmg/round | Basic dmg | Proc dmg | Proc heal | Procs/match |\n|---:|---|---:|---:|---:|---:|---:|---:|---:|';
const lines=rows.map((r,i)=>`| ${i+1} | ${r.archetype} | ${r.winPct}% | ${r.avgDamage} | ${r.avgDamagePerRound} | ${r.avgBasicDamage} | ${r.avgProcDamage} | ${r.avgProcHealing} | ${r.avgProcs} |`);
const procLines=rows.map(r=>`- **${r.archetype}:** ${Object.keys(r.procCounts).length?Object.entries(r.procCounts).map(([k,v])=>`${k} ${v}`).join(', '):'no passive basic proc'}`);
const distLines=rows.filter(r=>Object.values(r.procCounts).reduce((a,b)=>a+b,0)>0).map(r=>`- **${r.archetype}:** 0 procs ${r.procRoundDist[0]??0} rounds • 1 proc ${r.procRoundDist[1]??0} • 2 procs ${r.procRoundDist[2]??0} • 3 procs ${r.procRoundDist[3]??0}`);
const md=`# ROS2 Stage 23.20 — Attack-only round-robin benchmark\n\n${report.rules.totalDuels} deterministic 1v1 matches. Every champion selects only **Attack** every round; native counters, movement/range maintenance, crits, dodge, and passive basic procs remain enabled. Each unordered archetype pairing is run ${repsPerPair} times with side orientation alternated.\n\n${header}\n${lines.join('\n')}\n\n## Proc occurrences\n\n${procLines.join('\n')}\n\n## Per-round proc volatility\n\n${distLines.join('\n')}\n\n> This is a mechanical baseline, not a balance verdict. It intentionally removes the ability kits that define the real 3v3 PvP game.\n`;
fs.writeFileSync(path.join(outDir,'attack-only-660.md'),md);
console.log(md);
