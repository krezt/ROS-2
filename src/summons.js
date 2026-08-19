import { DAMAGE_TYPE, EVENT_TYPE, LIFE_STATE } from './constants.js';
import { invariant } from './errors.js';
import { cellKey, isCellOpen, isInBounds, markUnitDead } from './grid.js';
import { createUnitState } from './state.js';
import { effectiveStat, incomingDamageMultiplier } from './modifiers.js';

export const SUMMON_KIND=Object.freeze({FAERY:'FAERY'});
export const FAERY_PROFILE=Object.freeze({
  label:'Faery', maxHP:100, shotMin:12, shotMax:18, damageType:DAMAGE_TYPE.MAGICAL, range:999
});

function emit(sim,type,opts){const e=sim.events.emit(type,opts);sim.state.round.eventSequence=sim.events.length;return e;}
function championsAlive(state,side){return Object.values(state.units).some(u=>u.side===side&&u.entityKind!=='SUMMON'&&u.lifeState===LIFE_STATE.ALIVE);}
function updateOutcome(state){const a=championsAlive(state,'A'),b=championsAlive(state,'B');if(a&&b)return;state.outcome.status='COMPLETE';state.outcome.winner=a?'A':(b?'B':null);}
function nextSummonId(state,ownerId){let i=1;while(state.units[`S:${ownerId}:F${i}`])i++;return `S:${ownerId}:F${i}`;}

/** Prefer spawning behind the owner, then vertically, then toward the enemy. */
export function faerySpawnCell(state,ownerId){
  const owner=state.units[ownerId];invariant(owner?.position,'Faery summon requires an owner on the battlefield.');
  const dir=owner.side==='A'?-1:1;
  const candidates=[
    {row:owner.position.row,col:owner.position.col+dir},
    {row:owner.position.row-1,col:owner.position.col},
    {row:owner.position.row+1,col:owner.position.col},
    {row:owner.position.row,col:owner.position.col-dir}
  ];
  return candidates.find(c=>isInBounds(state.board,c.row,c.col)&&isCellOpen(state,c.row,c.col))??null;
}

/**
 * Experimental/off-roster summon primitive. The Faery occupies a real square,
 * has 100 HP, and remembers an enemy target for its autonomous shot.
 */
export function summonFaery(sim,{ownerId,targetId,cycle=sim.state.round.initiativeCycle,parentEventId=null}={}){
  const owner=sim.state.units[ownerId],target=sim.state.units[targetId];
  invariant(owner&&owner.lifeState===LIFE_STATE.ALIVE,'Living summon owner required.');
  invariant(target&&target.lifeState===LIFE_STATE.ALIVE&&target.side!==owner.side,'Faery requires a living enemy target.');
  const position=faerySpawnCell(sim.state,ownerId);invariant(position,'No adjacent legal square for Faery summon.');
  const unitId=nextSummonId(sim.state,ownerId);
  const faery=createUnitState({
    unitId,side:owner.side,draftSlot:1000+Object.keys(sim.state.units).length,archetypeId:'Faery',
    stats:{maxHP:FAERY_PROFILE.maxHP,hp:FAERY_PROFILE.maxHP,ATK:100,SDM:100,DEF:0,RES:0,CRIT:0,QKN:1},
    position,combat:{movementMax:0,attacksMax:1,attackInterval:99},
    weapon:{weaponProfileId:'FAERY_BOLT',mode:'RANGED',weaponRange:999,preferredRange:999,counterMoveMax:0,attackBaseMin:FAERY_PROFILE.shotMin,attackBaseMax:FAERY_PROFILE.shotMax,damageType:DAMAGE_TYPE.MAGICAL,dodgeable:false}
  });
  faery.entityKind='SUMMON';faery.ownerId=ownerId;faery.summon={kind:SUMMON_KIND.FAERY,targetId,summonedRound:sim.state.roundNumber,lastShotRound:null};
  sim.state.units[unitId]=faery;sim.state.board.occupancy[cellKey(position.row,position.col)]=unitId;
  const ev=emit(sim,EVENT_TYPE.SUMMON,{initiativeCycle:cycle,actorId:ownerId,targetId:unitId,parentEventId,payload:{kind:SUMMON_KIND.FAERY,label:FAERY_PROFILE.label,position,targetId,hp:FAERY_PROFILE.maxHP}});
  sim.trace.record('SUMMON_FAERY',{cycle,ownerId,unitId,targetId,position,eventId:ev.eventId});
  return faery;
}

/** Call once near the end of a round. Newly-created Faeries begin firing next round. */
export function resolveAutonomousSummons(sim,{cycle=sim.state.round.initiativeCycle}={}){
  const shots=[];
  const faeries=Object.values(sim.state.units).filter(u=>u.entityKind==='SUMMON'&&u.summon?.kind===SUMMON_KIND.FAERY&&u.lifeState===LIFE_STATE.ALIVE).sort((a,b)=>a.unitId.localeCompare(b.unitId));
  for(const f of faeries){
    if(f.summon.summonedRound>=sim.state.roundNumber||f.summon.lastShotRound===sim.state.roundNumber)continue;
    let target=sim.state.units[f.summon.targetId];
    if(!target||target.lifeState!==LIFE_STATE.ALIVE||target.side===f.side){
      const choices=Object.values(sim.state.units).filter(u=>u.side!==f.side&&u.lifeState===LIFE_STATE.ALIVE).sort((a,b)=>a.unitId.localeCompare(b.unitId));
      if(!choices.length)continue;
      target=choices.length===1?choices[0]:sim.rng.choose(choices,`FAERY_RETARGET:${f.unitId}:R${sim.state.roundNumber}`);
      f.summon.targetId=target.unitId;
    }
    const action=emit(sim,EVENT_TYPE.ACTION_START,{initiativeCycle:cycle,actorId:f.unitId,targetId:target.unitId,payload:{actionId:'FAERY_BOLT',summon:true}});
    const base=FAERY_PROFILE.shotMin===FAERY_PROFILE.shotMax?FAERY_PROFILE.shotMin:sim.rng.nextInt(FAERY_PROFILE.shotMin,FAERY_PROFILE.shotMax,`FAERY_BOLT:${f.unitId}`);
    const raw=Math.floor(base*Math.max(0,f.stats.SDM)/100);
    const res=Math.max(0,Math.min(.95,Number(effectiveStat(target,'RES')??0)/100));
    const afterRes=Math.max(1,Math.floor(raw*(1-res)));
    const amount=Math.max(0,Math.floor(afterRes*incomingDamageMultiplier(target,DAMAGE_TYPE.MAGICAL)));
    const before=target.stats.hp;target.stats.hp=Math.max(0,before-amount);f.summon.lastShotRound=sim.state.roundNumber;
    const dmg=emit(sim,EVENT_TYPE.DAMAGE,{initiativeCycle:cycle,actorId:f.unitId,targetId:target.unitId,parentEventId:action.eventId,payload:{amount:before-target.stats.hp,hpBefore:before,hpAfter:target.stats.hp,damageType:DAMAGE_TYPE.MAGICAL,source:'SUMMON',abilityId:'FAERY_BOLT'}});
    if(target.stats.hp<=0&&target.lifeState===LIFE_STATE.ALIVE){markUnitDead(sim.state,target.unitId);updateOutcome(sim.state);emit(sim,EVENT_TYPE.KO,{initiativeCycle:cycle,actorId:f.unitId,targetId:target.unitId,parentEventId:dmg.eventId,payload:{position:target.position,source:'SUMMON',abilityId:'FAERY_BOLT'}});}
    shots.push({summonId:f.unitId,targetId:target.unitId,amount:before-target.stats.hp});
  }
  return shots;
}
