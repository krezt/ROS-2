const METRICS=Object.freeze({
  damage:'Highest Damage',
  kills:'Most Kills',
  healing:'Most Healing',
  bestRoundDamage:'Most Damage in 1 Round'
});

function safeAmount(value){
  const n=Number(value);
  return Number.isFinite(n)&&n>0?Math.trunc(n):0;
}

function emptyChampion(unit){
  return {
    unitId:unit.unitId,
    archetypeId:unit.archetypeId,
    side:unit.side,
    damage:0,
    kills:0,
    healing:0,
    bestRoundDamage:0,
    bestRoundNumber:null
  };
}

function awardFor(champions,key,title){
  const eligible=champions.filter(c=>Number.isFinite(c[key]));
  if(!eligible.length)return {key,title,value:0,winners:[]};
  const value=Math.max(...eligible.map(c=>c[key]));
  if(value<=0)return {key,title,value:0,winners:[]};
  const winners=eligible.filter(c=>c[key]===value).sort((a,b)=>String(a.unitId).localeCompare(String(b.unitId))).map(c=>({
    unitId:c.unitId,archetypeId:c.archetypeId,side:c.side,
    ...(key==='bestRoundDamage'?{roundNumber:c.bestRoundNumber}:{}),
  }));
  return {key,title,value,winners};
}

export class MatchStatTracker {
  constructor(state){this.reset(state);}

  reset(state){
    this.roundsCompleted=0;
    this.units=new Map();
    for(const unit of Object.values(state?.units??{}).sort((a,b)=>String(a.unitId).localeCompare(String(b.unitId)))){
      this.units.set(unit.unitId,emptyChampion(unit));
    }
    return this;
  }

  ingestRound(events,roundNumber){
    const perRoundDamage=new Map();
    for(const event of events??[]){
      const actorId=event?.actorId;
      if(!actorId||!this.units.has(actorId))continue;
      const row=this.units.get(actorId);
      if(event.type==='DAMAGE'){
        const amount=safeAmount(event.payload?.amount);
        row.damage+=amount;
        perRoundDamage.set(actorId,(perRoundDamage.get(actorId)??0)+amount);
      }else if(event.type==='HEAL'){
        row.healing+=safeAmount(event.payload?.amount);
      }else if(event.type==='KO'){
        row.kills+=1;
      }
    }
    for(const [actorId,amount] of perRoundDamage){
      const row=this.units.get(actorId);
      if(amount>row.bestRoundDamage){
        row.bestRoundDamage=amount;
        row.bestRoundNumber=Number.isInteger(roundNumber)?roundNumber:null;
      }
    }
    this.roundsCompleted=Math.max(this.roundsCompleted,Number.isInteger(roundNumber)?roundNumber:this.roundsCompleted+1);
    return this.snapshot();
  }

  snapshot(){
    const champions=[...this.units.values()].map(x=>({...x})).sort((a,b)=>String(a.unitId).localeCompare(String(b.unitId)));
    const teamTotals={A:{damage:0,kills:0,healing:0},B:{damage:0,kills:0,healing:0}};
    for(const c of champions){
      const t=teamTotals[c.side];
      if(!t)continue;
      t.damage+=c.damage;t.kills+=c.kills;t.healing+=c.healing;
    }
    return {
      roundsCompleted:this.roundsCompleted,
      champions,
      teamTotals,
      awards:[
        awardFor(champions,'damage',METRICS.damage),
        awardFor(champions,'kills',METRICS.kills),
        awardFor(champions,'healing',METRICS.healing),
        awardFor(champions,'bestRoundDamage',METRICS.bestRoundDamage)
      ]
    };
  }
}

export function buildMatchAwards(state,rounds=[]){
  const tracker=new MatchStatTracker(state);
  for(const round of rounds)tracker.ingestRound(round.events,round.roundNumber);
  return tracker.snapshot();
}
