import { ACTION_KIND, LIFE_STATE, SIDE, TARGET_TYPE } from './constants.js';
import { createHoldDeclaration } from './declarations.js';
import { invariant } from './errors.js';
import { GameplayRng } from './rng.js';
import { manhattanDistance } from './grid.js';
import { unitsInArea } from './area.js';
import { canAcquireDirectHostileTarget } from './targeting.js';
import { findStatus } from './status.js';
import { poisonTotal } from './status-engine.js';
import { createRosterAbilityDeclaration, getArchetype } from './roster.js';
import { abilityIntent } from './playtest-harness.js';
import { RoundCoordinator } from './round-coordinator.js';

export const AI_DIFFICULTY = Object.freeze({
  BEGINNER: 'BEGINNER',
  NORMAL: 'NORMAL',
  HARD: 'HARD'
});

const HOSTILE_STATUS_VALUE = Object.freeze({
  stun: 120, silence: 85, taunt: 55, berserk: 90, blind: 65,
  marked: 45, def_down: 50, rend_def_down: 55, poison: 40, bleed: 50,
  root: 80, suppression: 95, spellbreak: 105
});
const BENEFICIAL_STATUS_VALUE = Object.freeze({
  invisible: 75, shift: 75, counterstance: 85, flurry_style: 110,
  arcane_echo: 90, regen: 55, guard: 45, shield_redirect: 100,
  divine_shield: 85, physical_shield: 75, magic_shield: 75,
  atk_up: 55, sdm_up: 55, def_up: 50, premonition: 45,
  bloodlust: 70, poison_imbue: 65, bleed_imbue: 65,
  shadowstep_crit: 55, movement_max_up: 65, attacks_max_up: 85, ward: 90, unstoppable: 100, detection: 55
});
const DEFENSIVE_KEYS = new Set(['guard','shield_redirect','divine_shield','physical_shield','magic_shield','def_up','shift','invisible']);
const NEGATIVE_KEYS = new Set(['stun','silence','taunt','berserk','root','suppression','spellbreak','poison','bleed','def_down','rend_def_down','marked','blind']);
const OFFENSIVE_EFFECTS = new Set(['DAMAGE','CONDITIONAL_DAMAGE','CURRENT_HP_DAMAGE','LIFE_DRAIN','AOE_DAMAGE','MULTI_STRIKE','CHAIN_LIGHTNING','WEAPON_STRIKE','BACKSTAB_STRIKE','DETONATE_POISON','DETONATE_POISON_AND_RESEED','POISON_FLAT_ROLL','POISON_FROM_LAST_DAMAGE','HYBRID_STORM']);

function canonicalUnits(state) { return Object.values(state.units).sort((a,b)=>a.unitId.localeCompare(b.unitId)); }
function living(state, side=null) { return canonicalUnits(state).filter(u=>u.lifeState===LIFE_STATE.ALIVE && (side===null || u.side===side)); }
function allies(state, actor) { return living(state, actor.side); }
function enemies(state, actor) { return living(state).filter(u=>u.side!==actor.side); }
function deadAllies(state, actor) { return canonicalUnits(state).filter(u=>u.side===actor.side && u.lifeState===LIFE_STATE.DEAD); }
function hpRatio(u){return u.stats.maxHP>0?u.stats.hp/u.stats.maxHP:0;}
function missingHp(u){return Math.max(0,u.stats.maxHP-u.stats.hp);}
function distance(a,b){return manhattanDistance(a.position,b.position);}
function hasNegative(u){return (u.statuses??[]).some(s=>NEGATIVE_KEYS.has(s.key));}
function negativeCount(u){return (u.statuses??[]).filter(s=>NEGATIVE_KEYS.has(s.key)).length;}
function beneficialCount(u){return (u.statuses??[]).filter(s=>!NEGATIVE_KEYS.has(s.key)).length;}
function defensiveCount(u){return (u.statuses??[]).filter(s=>DEFENSIVE_KEYS.has(s.key)).length;}

function limitedUseAvailable(actor, ability) {
  if (!ability.usesMax) return true;
  const key=ability.usesKey??ability.id;
  return (actor.limitedUses?.[key] ?? ability.usesMax) > 0;
}

function targetCandidatesForUnitAbility(state, actor, ability) {
  const intent=abilityIntent(ability);
  if (intent==='ALLY_DEAD') {
    const dead=deadAllies(state,actor);
    if(dead.length) return dead;
    return allies(state,actor);
  }
  if(intent==='ALLY') return allies(state,actor);
  if(intent==='ANY') return [...allies(state,actor),...enemies(state,actor).filter(t=>canAcquireDirectHostileTarget(state,actor.unitId,t.unitId))];
  if (ability.allowInvisibleTarget === true) return enemies(state,actor);
  return enemies(state,actor).filter(t=>canAcquireDirectHostileTarget(state,actor.unitId,t.unitId));
}

function groundCandidates(state, actor, ability) {
  const out=[];
  for(let row=0;row<state.board.height;row++) for(let col=0;col<state.board.width;col++) {
    const cell={row,col};
    if(manhattanDistance(actor.position,cell)>(ability.castRange??999)) continue;
    out.push(cell);
  }
  return out;
}

function declarationFor(ability, actor, roundNumber, target) {
  return createRosterAbilityDeclaration({
    roundNumber,
    actorId:actor.unitId,
    archetypeId:actor.archetypeId,
    abilityId:ability.id,
    target
  });
}

export function enumerateAiCandidates({state, actorId, roundNumber=state.roundNumber}) {
  const actor=state.units[actorId];
  invariant(actor && actor.lifeState===LIFE_STATE.ALIVE,`AI candidate actor must be living: ${actorId}`);
  const archetype=getArchetype(actor.archetypeId);
  const out=[];
  const stunned=!!findStatus(actor,'stun');
  const silenced=!!findStatus(actor,'silence');
  const playable=archetype.abilities.filter(a=>a.playable!==false && limitedUseAvailable(actor,a));
  const hardControlEscapes=playable.filter(a=>a.hardControlBypass===true);
  const allowed=stunned && hardControlEscapes.length ? hardControlEscapes : playable;

  for(const ability of allowed){
    if(stunned && ability.hardControlBypass!==true) continue;
    if(silenced && ability.actionKind===ACTION_KIND.SPELL && ability.hardControlBypass!==true) continue;
    try {
      if(ability.targetType===TARGET_TYPE.SELF) {
        out.push({ability,target:{type:TARGET_TYPE.SELF},declaration:declarationFor(ability,actor,roundNumber,{type:TARGET_TYPE.SELF})});
      } else if(ability.targetType===TARGET_TYPE.ALL_ALLIES) {
        out.push({ability,target:{type:TARGET_TYPE.ALL_ALLIES},declaration:declarationFor(ability,actor,roundNumber,{type:TARGET_TYPE.ALL_ALLIES})});
      } else if(ability.targetType===TARGET_TYPE.ALL_ENEMIES) {
        out.push({ability,target:{type:TARGET_TYPE.ALL_ENEMIES},declaration:declarationFor(ability,actor,roundNumber,{type:TARGET_TYPE.ALL_ENEMIES})});
      } else if(ability.targetType===TARGET_TYPE.GROUND) {
        for(const cell of groundCandidates(state,actor,ability)) {
          const target={type:TARGET_TYPE.GROUND,row:cell.row,col:cell.col};
          out.push({ability,target,declaration:declarationFor(ability,actor,roundNumber,target)});
        }
      } else if(ability.targetType===TARGET_TYPE.UNIT) {
        for(const unit of targetCandidatesForUnitAbility(state,actor,ability)) {
          const target={type:TARGET_TYPE.UNIT,unitId:unit.unitId};
          out.push({ability,target,targetUnit:unit,declaration:declarationFor(ability,actor,roundNumber,target)});
        }
      }
    } catch {
      // Candidate generation is intentionally permissive: invalid combinations are
      // omitted rather than teaching the AI a second set of game rules.
    }
  }
  return out;
}

function expectedBasicValue(actor,ability,targetUnit){
  const style=ability.basicStyle??{};
  const baseAttacks=actor.resources?.attacksMax??actor.combat?.attacksMax??1;
  let attacks=baseAttacks;
  if(Number.isInteger(style.attacksSet)) attacks=Math.min(baseAttacks,style.attacksSet);
  else if(Number.isFinite(style.attacksFractionOfMax)) attacks=Math.floor(baseAttacks*Math.max(0,Number(style.attacksFractionOfMax)));
  else attacks=Math.max(0,baseAttacks+(style.attacksDelta??0));
  if(Number.isInteger(style.ordinaryAttackLimit)) attacks=Math.min(attacks,style.ordinaryAttackLimit);
  const avg=((actor.weapon.attackBaseMin??0)+(actor.weapon.attackBaseMax??0))/2;
  const distanceBonus=targetUnit&&Number.isFinite(style.distanceDamageBonusPerSquare)?1+distance(actor,targetUnit)*Number(style.distanceDamageBonusPerSquare):1;
  let score=avg*Math.max(1,attacks)*(style.damageMultiplier??1)*distanceBonus*0.10;
  if(style.onHit?.defenseShredPct) score+=Math.max(0,attacks)*24;
  if(style.onHit?.statusKey==='stun') score+=Math.max(0,attacks)*(style.onHit.chance??0)*75;
  if(targetUnit){
    score+=(1-hpRatio(targetUnit))*55;
    const range=Number.isFinite(style.attackRangeOverride)?style.attackRangeOverride:(actor.weapon.weaponRange??1);
    const move=Math.floor((actor.resources?.movementMax??0)*(style.movementMultiplier??1));
    const need=Math.max(0,distance(actor,targetUnit)-range);
    if(need>move) score*=0.35;
    else score-=need*2;
  }
  return score;
}

function damageBaseScore(effect,actor,target,state=null){
  if(effect.type==='CURRENT_HP_DAMAGE') return (target?.stats.hp??600)*(effect.fraction??0)*0.14;
  if(effect.type==='WEAPON_STRIKE') return (((actor.weapon.attackBaseMin+actor.weapon.attackBaseMax)/2)*(effect.multiplier??1))*0.22;
  if(effect.type==='MULTI_STRIKE') return (((effect.min??25)+(effect.max??effect.min??25))/2)*(effect.hits??1)*0.20;
  if(['DAMAGE','CONDITIONAL_DAMAGE','LIFE_DRAIN'].includes(effect.type)) return (((effect.min??0)+(effect.max??effect.min??0))/2)*0.30;
  if(effect.type==='CHAIN_LIGHTNING') {
    const avg=((effect.min??0)+(effect.max??effect.min??0))/2;
    if(!state)return avg*.38;
    const livingAll=canonicalUnits(state).filter(u=>u.lifeState===LIFE_STATE.ALIVE);
    const hostileAfterFirst=livingAll.filter(u=>u.side!==actor.side&&u.unitId!==target?.unitId).length;
    const friendlyBouncePool=livingAll.filter(u=>u.side===actor.side).length; // includes caster: deliberately risky
    const pool=Math.max(1,hostileAfterFirst+friendlyBouncePool);
    const bounceNet=(hostileAfterFirst-friendlyBouncePool*.70)/pool;
    return avg*.45 + avg*(effect.bounceChance??.65)*.18*bounceNet;
  }
  if(effect.type==='AOE_DAMAGE') return (((effect.min??0)+(effect.max??effect.min??0))/2)*0.22;
  return 0;
}

function statusScore(effect,target){
  const key=effect.key;
  const hostile=HOSTILE_STATUS_VALUE[key];
  const beneficial=BENEFICIAL_STATUS_VALUE[key];
  let value=hostile??beneficial??25;
  if(target&&findStatus(target,key)) value*=0.45;
  if(key==='stun') value*=Math.max(.5,effect.chance??1);
  if(key==='taunt'||key==='berserk') value*=Math.max(.5,effect.chance??1);
  return value;
}

function areaVictims(state,actor,ability,target){
  if(!ability.area||target?.type!==TARGET_TYPE.GROUND) return [];
  return unitsInArea(state,actor.unitId,{...ability.area,center:{row:target.row,col:target.col}}).filter(u=>u.side!==actor.side&&u.lifeState===LIFE_STATE.ALIVE);
}
function hasDirectOffense(ability){
  return ability.actionKind===ACTION_KIND.BASIC_ATTACK || (ability.effects??[]).some(e=>OFFENSIVE_EFFECTS.has(e.type));
}
function historyPenalty(ability,history){
  if(!history?.length || ability.actionKind===ACTION_KIND.BASIC_ATTACK)return 0;
  let run=0;
  for(let i=history.length-1;i>=0&&history[i]===ability.id;i--)run++;
  if(run===0)return 0;
  return [0,55,125,210,300][Math.min(run,4)];
}
function statusValueForRecipient(effect,recipient,actor){
  const key=effect.key;
  const isNegative=NEGATIVE_KEYS.has(key);
  const sameSide=recipient.side===actor.side;
  let value=statusScore(effect,recipient);
  if(findStatus(recipient,key)) value*=.35; // already-active status has sharply diminishing setup value
  if(isNegative&&sameSide)return -Math.abs(value)*.9;
  if(!isNegative&&!sameSide)return -Math.abs(value)*.6;
  return value;
}

function candidateScore(state,actor,candidate,{history=[]}={}){
  const {ability,target,targetUnit}=candidate;
  let score=12;
  if(ability.actionKind===ACTION_KIND.BASIC_ATTACK) score+=expectedBasicValue(actor,ability,targetUnit);
  const intent=abilityIntent(ability);
  const tgt=targetUnit??(target?.type===TARGET_TYPE.UNIT?state.units[target.unitId]:null);
  const areaTargets=areaVictims(state,actor,ability,target);

  for(const effect of ability.effects??[]){
    if(effect.type==='HEAL') {
      const targets=effect.to==='ALL_ALLIES'?allies(state,actor):effect.to==='SELF'?[actor]:(tgt?[tgt]:[]);
      for(const u of targets) score+=Math.min(missingHp(u),Math.max(1,(effect.max??effect.min??0)))*0.18;
    } else if(effect.type==='FULL_HEAL') score+=missingHp(actor)*0.22;
    else if(effect.type==='HEAL_PERCENT_ROLL') score+=missingHp(actor)*0.16;
    else if(effect.type==='RESURRECT_OR_HEAL') score+=tgt?.lifeState===LIFE_STATE.DEAD?360:missingHp(tgt??actor)*0.16;
    else if(effect.type==='CLEANSE') {
      const targets=effect.scope==='ALL_ALLIES'?allies(state,actor):effect.scope==='SELF'?[actor]:(tgt?[tgt]:[]);
      score+=targets.reduce((n,u)=>n+negativeCount(u)*42,0);
      if(!targets.some(hasNegative)) score-=35;
    } else if(effect.type==='APPLY_STATUS') {
      const targets=effect.to==='ALL_ENEMIES'?enemies(state,actor):effect.to==='ALL_ALLIES'?allies(state,actor):effect.to==='SELF'?[actor]:(tgt?[tgt]:[]);
      if(targets.length) score+=targets.reduce((n,u)=>n+statusValueForRecipient(effect,u,actor),0);
    } else if(effect.type==='AOE_DAMAGE') {
      score+=damageBaseScore(effect,actor,tgt,state)*Math.max(1,areaTargets.length);
      score+=areaTargets.length*24;
      if(areaTargets.length>=3)score+=85;
      if(areaTargets.length===0) score-=100;
    } else if(effect.type==='DETONATE_POISON_AND_RESEED'||effect.type==='DETONATE_POISON') {
      const poisoned=enemies(state,actor).reduce((n,u)=>n+poisonTotal(u),0);
      score+=poisoned*0.25;
      if(poisoned===0)score-=80;
    } else if(effect.type==='POISON_FLAT_ROLL') score+=55;
    else if(effect.type==='POISON_FROM_LAST_DAMAGE') score+=35;
    else if(effect.type==='STRIP_DEFENSIVE_BUFF') {score+=(tgt?defensiveCount(tgt):0)*55;if(tgt&&defensiveCount(tgt)===0)score-=20;}
    else if(effect.type==='STRIP_BENEFICIAL'||effect.type==='DISPEL_EXCEPT') {score+=(tgt?beneficialCount(tgt):0)*35;}
    else if(effect.type==='TEMP_ATTACKS_MAX') score+=(effect.to==='ALL_ALLIES'?allies(state,actor).length:1)*55;
    else if(effect.type==='TEMP_MOVEMENT_MAX') score+=(effect.to==='ALL_ALLIES'?allies(state,actor).length:1)*35;
    else if(effect.type==='TEMP_ATTACKS_MULTIPLIER') score+=findStatus(actor,'attacks_max_up')?20:105;
    else if(effect.type==='TEMP_MOVEMENT_MULTIPLIER') score+=findStatus(actor,'movement_max_up')?10:75;
    else if(effect.type==='STUN_OR_DEF_DOWN') score+=75;
    else if(effect.type==='HYBRID_STORM') {
      const avgD=((effect.damage?.min??0)+(effect.damage?.max??effect.damage?.min??0))/2;
      const avgH=((effect.heal?.min??0)+(effect.heal?.max??effect.heal?.min??0))/2;
      score+=enemies(state,actor).length*(avgD*.22+(effect.stunChance??0)*70);
      score+=allies(state,actor).reduce((n,u)=>n+Math.min(missingHp(u),avgH)*.10,0);
    }
    else score+=damageBaseScore(effect,actor,tgt,state);
  }

  if(intent==='ENEMY'&&tgt){
    const missing=1-hpRatio(tgt);
    score+=missing*55;
    if(hpRatio(tgt)<=.35 && hasDirectOffense(ability))score+=65;
    score-=Math.max(0,distance(actor,tgt)-(ability.castRange??999))*30;
  }
  const enemyCount=enemies(state,actor).length;
  if(enemyCount===1){
    if(hasDirectOffense(ability))score+=55;
    else {
      const emergency=hpRatio(actor)<.38||allies(state,actor).some(u=>hpRatio(u)<.28)||deadAllies(state,actor).length>0;
      if(!emergency)score-=45;
    }
  }
  if(ability.id==='ARCANE_ECHO') {
    const already=!!findStatus(actor,'arcane_echo'); score+=already?-120:70;
  }
  if(ability.id==='SECOND_WIND'&&findStatus(actor,'stun')) score+=250;
  if(ability.id==='DEFENSIVE_AURA'){const r=hpRatio(actor);score+=missingHp(actor)*.12;if(r>=.90)score-=210;else if(r>=.75)score-=135;else if(r>=.60)score-=65;else if(r<=.45)score+=85;}
  if(ability.id==='SHIELDWALL') score+=allies(state,actor).filter(u=>u.unitId!==actor.unitId&&hpRatio(u)<.7).length*30;
  if(ability.id==='BLOODLUST') score+=(findStatus(actor,'bloodlust')?-90:Math.max(0,actor.resources.attacksRemaining??0)*8);
  if(ability.id==='RAMPAGE' && (findStatus(actor,'atk_up')||findStatus(actor,'def_down'))) score-=100;
  if(ability.id==='GUARDIAN_ANGEL' && tgt){
    if(findStatus(tgt,'divine_shield')) score-=160;
    const r=hpRatio(tgt);
    if(r>=.90) score-=210; else if(r>=.75) score-=135; else if(r>=.60) score-=55; else if(r<=.40) score+=95; else if(r<=.55) score+=45;
  }
  if(ability.id==='DIVINE_SHIELD' && tgt){
    if(findStatus(tgt,'divine_shield')) score-=160;
    const r=hpRatio(tgt);
    if(r>=.90) score-=180; else if(r>=.75) score-=110; else if(r<=.45) score+=70;
  }
  score-=historyPenalty(ability,history);
  if(ability.usesMax) score-=25;

  const delay=Math.max(0,(ability.completionDelayCycles??0)-1);
  score/=1+delay*.07;
  return score;
}

function chooseByScore(candidates,decisionRng,reason){
  const best=Math.max(...candidates.map(c=>c.score));
  const tied=candidates.filter(c=>Math.abs(c.score-best)<1e-9).sort((a,b)=>a.declaration.actionId.localeCompare(b.declaration.actionId)||JSON.stringify(a.target).localeCompare(JSON.stringify(b.target)));
  return tied.length===1?tied[0]:decisionRng.choose(tied,reason);
}

function scoredCandidates(state,actor,roundNumber,history=[]){
  return enumerateAiCandidates({state,actorId:actor.unitId,roundNumber}).map(c=>({...c,score:candidateScore(state,actor,c,{history})}));
}

function beginnerPick(state,actor,roundNumber,decisionRng,history=[]){
  const candidates=scoredCandidates(state,actor,roundNumber,history);
  if(!candidates.length)return null;
  const basics=candidates.filter(c=>c.ability.actionKind===ACTION_KIND.BASIC_ATTACK);
  const urgent=candidates.filter(c=>c.score>=180);
  const pool=urgent.length&&decisionRng.chance(.55,`AI_BEGINNER_URGENT:${actor.unitId}:R${roundNumber}`)?urgent:[...candidates,...basics,...basics];
  return decisionRng.choose(pool,`AI_BEGINNER_PICK:${actor.unitId}:R${roundNumber}`);
}

function normalPick(state,actor,roundNumber,decisionRng,history=[]){
  const candidates=scoredCandidates(state,actor,roundNumber,history);
  return candidates.length?chooseByScore(candidates,decisionRng,`AI_NORMAL_TIE:${actor.unitId}:R${roundNumber}`):null;
}

function hostileUnitId(candidate,state,actor){
  if(candidate.target?.type!==TARGET_TYPE.UNIT)return null;
  const u=state.units[candidate.target.unitId];return u&&u.side!==actor.side?u.unitId:null;
}
function effectKeys(candidate){return new Set((candidate.ability.effects??[]).filter(e=>e.type==='APPLY_STATUS').map(e=>e.key));}
function comboSynergy(state,actors,combo){
  let bonus=0;
  const focused=new Map(),heals=new Map(),controls=new Map(),armorBreak=new Set();
  for(let i=0;i<combo.length;i++){
    const c=combo[i],actor=actors[i]; const hostile=hostileUnitId(c,state,actor);
    if(hostile){focused.set(hostile,(focused.get(hostile)??0)+1);const keys=effectKeys(c);if(keys.has('def_down')||keys.has('rend_def_down')||keys.has('marked')||c.ability.effects?.some(e=>e.type==='STRIP_DEFENSIVE_BUFF'))armorBreak.add(hostile);if(keys.has('stun')||keys.has('taunt')||keys.has('berserk')||keys.has('silence'))controls.set(hostile,(controls.get(hostile)??0)+1);}
    if(c.target?.type===TARGET_TYPE.UNIT){const u=state.units[c.target.unitId];if(u&&u.side===actor.side&&(c.ability.effects??[]).some(e=>['HEAL','RESURRECT_OR_HEAL'].includes(e.type)))heals.set(u.unitId,(heals.get(u.unitId)??0)+1);}
  }
  for(const n of focused.values())if(n>1)bonus+=(n-1)*28;
  for(const [id,n] of controls)if(n>1)bonus-=(n-1)*25;
  for(const [id,n] of heals)if(n>1)bonus-=(n-1)*30;
  for(let i=0;i<combo.length;i++){const target=hostileUnitId(combo[i],state,actors[i]);if(target&&armorBreak.has(target)&&!effectKeys(combo[i]).has('def_down')&&!effectKeys(combo[i]).has('rend_def_down')&&!effectKeys(combo[i]).has('marked'))bonus+=20;}
  return bonus;
}

function cartesianTop(lists,visit,index=0,acc=[]){if(index===lists.length){visit(acc);return;}for(const x of lists[index]){acc.push(x);cartesianTop(lists,visit,index+1,acc);acc.pop();}}

function hardTeamPlan({state,roundNumber,side,decisionRng,actionHistory=null}){
  const actors=living(state,side).filter(u=>u.entityKind!=='SUMMON');
  const lists=actors.map(actor=>scoredCandidates(state,actor,roundNumber,actionHistory?.[actor.unitId]??[]).sort((a,b)=>b.score-a.score||a.declaration.actionId.localeCompare(b.declaration.actionId)).slice(0,4));
  if(lists.some(x=>x.length===0)) return actors.map((actor,i)=>lists[i][0]??null);
  let bestScore=-Infinity,best=[];
  cartesianTop(lists,(combo)=>{
    const score=combo.reduce((n,c)=>n+c.score,0)+comboSynergy(state,actors,combo);
    if(score>bestScore+1e-9){bestScore=score;best=[combo.slice()];}
    else if(Math.abs(score-bestScore)<1e-9)best.push(combo.slice());
  });
  best.sort((a,b)=>JSON.stringify(a.map(c=>[c.declaration.actionId,c.target])).localeCompare(JSON.stringify(b.map(c=>[c.declaration.actionId,c.target]))));
  return best.length===1?best[0]:decisionRng.choose(best,`AI_HARD_TEAM_TIE:R${roundNumber}:${side}`);
}

export function planAiDeclarations({
  state,
  roundNumber=state.roundNumber,
  side=SIDE.B,
  difficulty=AI_DIFFICULTY.NORMAL,
  decisionRng,
  actionHistory=null
}){
  invariant(Object.values(AI_DIFFICULTY).includes(difficulty),`Unknown AI difficulty: ${difficulty}`);
  invariant(decisionRng instanceof GameplayRng,'AI planning requires a dedicated GameplayRng-compatible decision RNG.');
  const actors=living(state,side).filter(u=>u.entityKind!=='SUMMON');
  let picks;
  if(difficulty===AI_DIFFICULTY.HARD) picks=hardTeamPlan({state,roundNumber,side,decisionRng,actionHistory});
  else picks=actors.map(actor=>{const h=actionHistory?.[actor.unitId]??[];return difficulty===AI_DIFFICULTY.BEGINNER?beginnerPick(state,actor,roundNumber,decisionRng,h):normalPick(state,actor,roundNumber,decisionRng,h);});
  return actors.map((actor,i)=>picks[i]?.declaration??createHoldDeclaration({declarationId:`D${roundNumber}:${actor.unitId}`,roundNumber,actorId:actor.unitId}));
}

export function createAiPlannerAdapter(difficulty=AI_DIFFICULTY.NORMAL){
  return ({state,roundNumber,side,decisionRng})=>planAiDeclarations({state,roundNumber,side,difficulty,decisionRng});
}

export class SinglePlayerOpponent {
  constructor({side=SIDE.B,difficulty=AI_DIFFICULTY.NORMAL,decisionSeed=0xA121B07}={}){
    invariant(side===SIDE.A||side===SIDE.B,'SinglePlayerOpponent side must be A or B.');
    invariant(Object.values(AI_DIFFICULTY).includes(difficulty),`Unknown AI difficulty: ${difficulty}`);
    this.side=side;this.difficulty=difficulty;this.decisionRng=new GameplayRng(decisionSeed);this.actionHistory={};
  }
  planRound(state){
    const plan=planAiDeclarations({state,roundNumber:state.roundNumber,side:this.side,difficulty:this.difficulty,decisionRng:this.decisionRng,actionHistory:this.actionHistory});
    for(const d of plan){const h=this.actionHistory[d.actorId]??=[];h.push(d.actionId);while(h.length>4)h.shift();this.actionHistory[d.actorId]=h;}
    return plan;
  }
  snapshot(){return Object.freeze({side:this.side,difficulty:this.difficulty,decisionRng:this.decisionRng.snapshot(),actionHistory:structuredClone(this.actionHistory)});}
}

/**
 * Single-player still uses the PvP coordinator contract. The only difference is
 * that one declaration set comes from SinglePlayerOpponent instead of a socket.
 * Gameplay seed generation remains wholly separate from AI decision RNG.
 */
export class SinglePlayerRoundAuthority {
  constructor({
    matchId='ROS2-SINGLE-PLAYER',
    humanSide=SIDE.A,
    aiDifficulty=AI_DIFFICULTY.NORMAL,
    aiDecisionSeed=0xA121B07,
    seedFactory,
    roundNumber=1
  }={}){
    invariant(humanSide===SIDE.A||humanSide===SIDE.B,'humanSide must be A or B.');
    this.humanSide=humanSide;this.aiSide=humanSide===SIDE.A?SIDE.B:SIDE.A;
    this.opponent=new SinglePlayerOpponent({side:this.aiSide,difficulty:aiDifficulty,decisionSeed:aiDecisionSeed});
    this.coordinator=new RoundCoordinator({matchId,roundNumber,...(seedFactory?{seedFactory}:{})});
  }
  lockRound({state,humanDeclarations,deadlineMetadata=null}){
    invariant(state.roundNumber===this.coordinator.roundNumber,'Single-player state/coordinator round mismatch.');
    const aiDeclarations=this.opponent.planRound(state);
    this.coordinator.submitDeclarations(this.humanSide,humanDeclarations);
    this.coordinator.submitDeclarations(this.aiSide,aiDeclarations);
    const roundPackage=this.coordinator.releaseRoundPackage({deadlineMetadata});
    return Object.freeze({roundPackage,aiDeclarations,aiDecisionSnapshot:this.opponent.snapshot()});
  }

  confirmRound({humanDigest,aiDigest}){
    const first=this.coordinator.submitDigest(this.humanSide,humanDigest);
    const second=this.coordinator.submitDigest(this.aiSide,aiDigest);
    return Object.freeze({first,confirmation:second});
  }
  nextRound(){return this.coordinator.nextRound();}
  snapshot(){return Object.freeze({humanSide:this.humanSide,aiSide:this.aiSide,opponent:this.opponent.snapshot(),coordinator:this.coordinator.snapshot()});}
}
