import { ACTION_KIND, EVENT_TYPE, LIFE_STATE, SIDE, TARGET_TYPE } from './constants.js';
import { cellsForArea } from './area.js';
import { createHoldDeclaration } from './declarations.js';
import { invariant } from './errors.js';
import { effectiveStat } from './modifiers.js';
import { getAbility } from './roster.js';

export const CLIENT_MODE = Object.freeze({ SINGLE_PLAYER:'SINGLE_PLAYER', PVP:'PVP' });
export const ACTION_SELECTION_MS = 120_000;
export const DEFAULT_BOARD_VIEW = Object.freeze({ cellWidth:50, cellHeight:46, originX:25, originY:27, gap:1 });

export function gridToWorld(cell, view=DEFAULT_BOARD_VIEW) {
  invariant(cell && Number.isInteger(cell.row) && Number.isInteger(cell.col), 'gridToWorld requires integer row/col.');
  return {
    x: view.originX + cell.col * (view.cellWidth ?? view.cellSize) + (view.cellWidth ?? view.cellSize)/2,
    y: view.originY + cell.row * (view.cellHeight ?? view.cellSize) + (view.cellHeight ?? view.cellSize)/2
  };
}

export function worldToGrid(point, board, view=DEFAULT_BOARD_VIEW) {
  invariant(point && Number.isFinite(point.x) && Number.isFinite(point.y), 'worldToGrid requires finite x/y.');
  const cellWidth=view.cellWidth ?? view.cellSize, cellHeight=view.cellHeight ?? view.cellSize;
  const col=Math.floor((point.x-view.originX)/cellWidth);
  const row=Math.floor((point.y-view.originY)/cellHeight);
  if(row<0||col<0||row>=board.height||col>=board.width) return null;
  return {row,col};
}

export function abilityTargetingModel(archetypeId, abilityId) {
  const ability=getAbility(archetypeId,abilityId);
  return Object.freeze({
    abilityId:ability.id,
    label:ability.label,
    actionKind:ability.actionKind,
    targetType:ability.targetType,
    castRange:ability.castRange,
    area:ability.area?structuredClone(ability.area):null,
    allowInvisibleTarget:ability.allowInvisibleTarget===true,
    allowDeadTarget:ability.allowDeadTarget===true,
    deadTargetOnly:ability.deadTargetOnly===true
  });
}

export function areaPreviewForAbility(board, archetypeId, abilityId, center) {
  const ability=getAbility(archetypeId,abilityId);
  if(!ability.area || !center) return Object.freeze([]);
  return Object.freeze(cellsForArea(board,{...ability.area,center}).map(c=>Object.freeze({...c})));
}

export function abilityUsesRemaining(actor,ability){
  if(!ability?.usesMax)return null;
  const key=ability.usesKey??ability.id;
  const stored=actor?.limitedUses?.[key];
  const left=Number.isFinite(stored)?Math.trunc(stored):Math.trunc(ability.usesMax);
  return Math.max(0,Math.min(Math.trunc(ability.usesMax),left));
}

export function abilityUseText(actor,ability){
  const remaining=abilityUsesRemaining(actor,ability);
  if(remaining===null)return '';
  return `${remaining}/${ability.usesMax} use${ability.usesMax===1?'':'s'} remaining this match`;
}

const NEGATIVE_STATUS_KEYS=new Set(['poison','bleed','stun','silence','taunt','berserk','root','suppression','spellbreak','marked','blind','def_down','rend_def_down','atk_down','sdm_down','res_down']);

export const CONTROL_IMPAIRING_STATUS_KEYS=Object.freeze(['stun','silence','taunt','berserk','root','suppression','spellbreak']);
const CONTROL_IMPAIRING_STATUS_SET=new Set(CONTROL_IMPAIRING_STATUS_KEYS);
const HARD_CONTROL_STATUS_SET=new Set(['stun','silence','taunt','berserk','root','suppression','spellbreak']);
const IMPORTANT_FLOAT_STATUS_KEYS=new Set(['poison','bleed','blind',...CONTROL_IMPAIRING_STATUS_KEYS]);

export function hasControlImpairment(unit){
  return Boolean(unit?.lifeState===LIFE_STATE.ALIVE && (unit.statuses??[]).some(s=>CONTROL_IMPAIRING_STATUS_SET.has(String(s.key??'').toLowerCase())));
}

export function shouldFloatStatusFeedback(command){
  const p=command?.payload??{};
  const eventType=p.eventType;
  // Direct STUN/SILENCE/TAUNT/BERSERK events are followed by STATUS_APPLY; let that single event carry the VFX.
  if([EVENT_TYPE.STUN,EVENT_TYPE.SILENCE,EVENT_TYPE.TAUNT,EVENT_TYPE.BERSERK].includes(eventType))return false;
  if(eventType===EVENT_TYPE.STATUS_DURATION||eventType===EVENT_TYPE.STATUS_TICK)return false;
  const key=String(p.key??'').toLowerCase();
  if(!IMPORTANT_FLOAT_STATUS_KEYS.has(key))return false;
  return [EVENT_TYPE.STATUS_APPLY,EVENT_TYPE.STATUS_REMOVE,EVENT_TYPE.STATUS_EXPIRE].includes(eventType);
}

function statView(unit,key){
  const base=Math.round(Number(unit.stats?.[key]??0));
  const effective=Math.round(Number(effectiveStat(unit,key)??base));
  const pct=base?Math.round((effective/base-1)*100):0;
  return Object.freeze({base,effective,pct});
}

function shieldLayer(unit,key,fallback){
  const status=(unit.statuses??[]).find(s=>String(s.key??'').toLowerCase()===key);
  if(!status)return 0;
  return Math.max(0,Math.min(.95,Number(status.data?.pct??fallback)));
}
function combinedMitigationPct(basePct,...layers){
  let remaining=1-Math.max(0,Math.min(.95,Number(basePct??0)/100));
  for(const layer of layers)remaining*=1-Math.max(0,Math.min(.95,Number(layer??0)));
  return Math.max(0,Math.min(95,Math.round((1-remaining)*100)));
}
export function playerFacingCombatStats(unit){
  invariant(unit,'playerFacingCombatStats requires unit.');
  const atk=statView(unit,'ATK'),sdm=statView(unit,'SDM'),def=statView(unit,'DEF'),res=statView(unit,'RES');
  const divine=shieldLayer(unit,'divine_shield',.60);
  const physical=shieldLayer(unit,'physical_shield',.50);
  const magical=shieldLayer(unit,'magic_shield',.50);
  const armorMitigationPct=combinedMitigationPct(def.effective,physical,divine);
  const resistanceMitigationPct=combinedMitigationPct(res.effective,magical,divine);
  return Object.freeze({
    attackPct:Math.max(0,Math.round(atk.effective)),
    spellPowerPct:Math.max(0,Math.round(sdm.effective)),
    armorMitigationPct,
    resistanceMitigationPct,
    armorBasePct:Math.max(0,Math.min(95,Math.round(def.effective))),
    resistanceBasePct:Math.max(0,Math.min(95,Math.round(res.effective))),
    physicalShieldPct:Math.round(physical*100),
    magicShieldPct:Math.round(magical*100),
    divineShieldPct:Math.round(divine*100),
    atkRaw:atk,
    sdmRaw:sdm,
    defRaw:def,
    resRaw:res
  });
}


function statusTooltipText(status,{poisonAmount=null}={}){
  const key=String(status?.key??'status').toLowerCase();
  const d=status?.data??{};
  const pct=n=>`${Math.round(Number(n??0)*100)}%`;
  const map={
    poison:`Negative. Current Poison: ${poisonAmount??0}. At round end, takes a synchronized random 50–100% of the current Poison total as damage; then every Poison contribution decays by 15%.`,
    bleed:`Negative. At round end, Bleed deals ${pct(d.pct??.15)} of the target's current HP. Bleed does not stack; reapplication refreshes it.`,
    stun:'Hard control. Prevents proactive action and movement and interrupts charging delayed actions. Reflexive counters may still fire if the attacker is already in range, but Stun grants no counter movement.',
    silence:'Control. Prevents or interrupts spells. Ordinary physical abilities remain usable unless specifically Silence-sensitive.',
    taunt:'Control. Forces a Basic Attack against the taunter using all remaining legal Movement and attack resources.',
    berserk:'Control. Forces Basic Attacks against a random legal target. A fresh target is rolled each new round while Berserk remains active.',
    root:'Negative control. Prevents voluntary movement and counter-movement, but attacks/casts remain legal if otherwise possible.',
    suppression:'Negative control. Prevents counterattacks while leaving proactive actions intact.',
    spellbreak:'Negative control. If the target is already charging a spell, that spell is immediately interrupted and Spellbreak is consumed; otherwise the next spell attempt is interrupted. Spellbreak itself can be resisted.',
    ward:'Beneficial. Blocks the next hostile status/debuff/control application, then Ward is consumed.',
    unstoppable:'Beneficial. Blocks configured hard-control effects while active without consuming Ward.',
    detection:'Beneficial. Allows new direct hostile acquisition of Invisible enemies while active.',
    invisible:'Beneficial. Prevents new direct hostile target acquisition. Existing legal target locks remain valid.',
    marked:'Negative. Increases incoming damage by 65% while active.',
    blind:`Negative. Physical actions have a ${pct(d.whiffChance??.40)} chance to whiff while Blind.`,
    def_down:'Negative. Reduces ARM/physical mitigation while active.',
    rend_def_down:`Negative. Each Rend stack reduces DEF by ${pct(d.pctPerStack??.10)} multiplicatively; stacks refresh together.`,
    atk_down:'Negative. Reduces physical damage multiplier.',
    sdm_down:'Negative. Reduces spell damage/healing multiplier.',
    atk_up:'Beneficial. Increases physical damage multiplier.',
    sdm_up:'Beneficial. Increases spell damage/healing multiplier.',
    def_up:'Beneficial. Increases base physical mitigation.',
    res_down:'Negative. Reduces base magical mitigation.',
    res_up:'Beneficial. Increases base magical mitigation.',
    dodge_up:`Beneficial. Adds ${pct(d.bonus??.05)} physical dodge chance while active.`,
    physical_shield:`Beneficial. Reduces incoming physical damage by ${pct(d.pct??.50)} after ARM.`,
    magic_shield:`Beneficial. Reduces incoming magical damage by ${pct(d.pct??.50)} after RES.`,
    divine_shield:`Beneficial. Reduces incoming physical and magical damage by ${pct(d.pct??.60)} after ARM/RES.`,
    shadowstep_crit:`Beneficial. Critical hits use the Shadowstep crit-damage multiplier while active.`,
    arcane_echo:'Beneficial. The next spell resolves twice; the second resolution deals 150% damage, then Arcane Echo is consumed.',
    warhorn_attacks_up:'Beneficial. Warhorn grants +1 maximum swing while active.',
    warhorn_movement_up:'Beneficial. Warhorn grants +2 Movement while active.',
    counterstance_movement_up:'Beneficial. Counterstance grants the Monk +5 Movement while active.'
  };
  const fallback=(NEGATIVE_STATUS_KEYS.has(key)?'Negative status.':'Beneficial status.');
  return map[key]??fallback;
}

export function statusDisplayModels(unit){
  invariant(unit,'statusDisplayModels requires unit.');
  return Object.freeze((unit.statuses??[]).map(status=>{
    const key=String(status.key??'status').toLowerCase();
    const duration=status.duration??status.dur??null;
    const stacks=Math.max(1,Math.trunc(status.data?.stacks??1));
    const poisonAmount=key==='poison'?(status.data?.contributions??[]).reduce((n,c)=>n+Math.max(0,Math.floor(c.amount??0)),0):null;
    let value='';
    if(poisonAmount!=null)value=String(poisonAmount);
    else if(stacks>1)value=`×${stacks}`;
    const durationText=Number.isInteger(duration)?`${duration}R`:'';
    const label=key.replaceAll('_',' ').toUpperCase();
    const detail=[value,durationText].filter(Boolean).join(' • ');
    const tone=HARD_CONTROL_STATUS_SET.has(key)?'control':(key==='poison'?'poison':(key==='bleed'?'bleed':(NEGATIVE_STATUS_KEYS.has(key)?'negative':'positive')));
    const tooltip=statusTooltipText(status,{poisonAmount});
    return Object.freeze({key,label,duration,stacks,poisonAmount,detail,tone,tooltip});
  }));
}

export function unitHudModel(unit) {
  invariant(unit,'unitHudModel requires unit.');
  return Object.freeze({
    unitId:unit.unitId,
    archetypeId:unit.archetypeId,
    side:unit.side,
    alive:unit.lifeState===LIFE_STATE.ALIVE,
    hp:unit.stats.hp,
    maxHP:unit.stats.maxHP,
    hpPct:unit.stats.maxHP>0?unit.stats.hp/unit.stats.maxHP:0,
    movementRemaining:unit.resources.movementRemaining,
    movementMax:unit.resources.movementMax,
    attacksRemaining:unit.resources.attacksRemaining,
    attacksMax:unit.resources.attacksMax,
    qkn:Math.round(Number(unit.stats.QKN??0)),
    atkStat:statView(unit,'ATK'),
    sdmStat:statView(unit,'SDM'),
    defStat:statView(unit,'DEF'),
    resStat:statView(unit,'RES'),
    playerStats:playerFacingCombatStats(unit),
    controlImpaired:hasControlImpairment(unit),
    statuses:statusDisplayModels(unit)
  });
}


function fmtPct(v){return `${Math.round(v)}%`;}
function scaledRange(min,max,multiplier=1){
  const lo=Math.max(0,Math.floor(Number(min??0)*multiplier)),hi=Math.max(lo,Math.floor(Number(max??min??0)*multiplier));
  return lo===hi?String(lo):`${lo}–${hi}`;
}
function directMultiplier(actor,key){return Math.max(0,Number(effectiveStat(actor,key)??100))/100;}
function timingLabel(ability){const d=ability.completionDelayCycles??0;return d>0?`${d} cycle${d===1?'':'s'}`:'Immediate';}
function targetLabel(ability){if(ability.deadTargetOnly===true)return "KO'd allied corpse";return String(ability.targetType??'').replaceAll('_',' ').toLowerCase();}
function summarizeEffect(actor,effect,ability){
  const type=effect?.type;
  if(type==='DAMAGE'||type==='CONDITIONAL_DAMAGE'||type==='AOE_DAMAGE'){
    const damageType=effect.damageType??'PHYSICAL',key=effect.scalesWith??(damageType==='MAGICAL'?'SDM':'ATK');
    const range=scaledRange(effect.min,effect.max,directMultiplier(actor,key));
    const extra=type==='CONDITIONAL_DAMAGE'?` • ${Math.round((effect.afflictedMultiplier??1)*100)}% when afflicted`:'';
    return `${range} ${damageType.toLowerCase()} damage${extra}`;
  }
  if(type==='WEAPON_STRIKE')return `${Math.round((effect.multiplier??1)*100)}% weapon strike`;
  if(type==='BACKSTAB_STRIKE')return `${Math.round((effect.weaponMultiplier??1)*100)}% weapon strike • ${Math.round((effect.stealthWeaponMultiplier??effect.weaponMultiplier??1)*100)}% from Invisibility`;
  if(type==='MULTI_STRIKE')return `${effect.hits??1} hits • ${scaledRange(effect.min,effect.max,directMultiplier(actor,'ATK'))} physical each`;
  if(type==='HEAL'){
    if(Number.isFinite(effect.pctMaxHP))return `Heal ${fmtPct(effect.pctMaxHP*100)} max HP`;
    return `Heal ${scaledRange(effect.min,effect.max,directMultiplier(actor,effect.scalesWith??'SDM'))}`;
  }
  if(type==='HEAL_PERCENT_ROLL')return `Heal ${fmtPct((effect.minPct??0)*100)}–${fmtPct((effect.maxPct??0)*100)} max HP`;
  if(type==='FULL_HEAL')return 'Restore to full HP';
  if(type==='APPLY_STATUS'){
    const key=String(effect.key??'').toLowerCase();
    const durationText=(Number.isFinite(effect.durationMin)&&Number.isFinite(effect.durationMax))?`${effect.durationMin}–${effect.durationMax} rounds`:`${effect.duration??'?'} round${effect.duration===1?'':'s'}`;
    if(key==='regen'&&ability?.targetType===TARGET_TYPE.SELF){
      const pct=Number.isFinite(effect.data?.pct)?effect.data.pct:.10;
      const amount=Math.max(1,Math.floor((actor.stats?.maxHP??0)*pct));
      return `Regen ${amount} HP/round (${fmtPct(pct*100)} max HP) • ${effect.duration??'?'} round${effect.duration===1?'':'s'}`;
    }
    if(key==='poison_imbue'&&Number.isFinite(effect.data?.damageRatio))return `Poison Imbue • successful basic hits add Poison equal to ${fmtPct(effect.data.damageRatio*100)} of hit damage • ${effect.duration??'?'} rounds`;
    if(['physical_shield','magic_shield','divine_shield'].includes(key)&&Number.isFinite(effect.data?.pct))return `${String(effect.key).replaceAll('_',' ')} • ${fmtPct(effect.data.pct*100)} reduction • ${effect.duration??'?'} round${effect.duration===1?'':'s'}${effect.stackMode==='STACK_SHIELD'?' • stacks to 2':''}`;
    if(key==='dodge_up'&&Number.isFinite(effect.data?.bonus))return `Dodge Up • +${fmtPct(effect.data.bonus*100)} physical dodge • ${effect.duration??'?'} rounds`;
    return `${String(effect.key).replaceAll('_',' ')} • ${durationText}${Number(effect.chance)<1?` • ${fmtPct(effect.chance*100)} chance`:''}`;
  }
  if(type==='LIFE_DRAIN')return `${scaledRange(effect.min,effect.max,directMultiplier(actor,'SDM'))} magical damage and heal for damage dealt`;
  if(type==='CURRENT_HP_DAMAGE')return `${Math.round((effect.fraction??0)*100)}% current-HP damage`;
  if(type==='POISON_FLAT_ROLL')return `${scaledRange(effect.min,effect.max,directMultiplier(actor,effect.scalesWith??'SDM'))} Poison to affected targets`;
  if(type==='DETONATE_POISON_AND_RESEED')return `Detonate all Poison; reseed ${fmtPct((effect.reseedFraction??.5)*100)} of total on a random survivor`;
  if(type==='HYBRID_STORM')return `Storm: damages enemies, heals allies, may Stun enemies`;
  if(type==='CHAIN_LIGHTNING')return `${scaledRange(effect.min,effect.max,directMultiplier(actor,'SDM'))} magical damage; ${fmtPct((effect.bounceChance??.65)*100)} bounce chance; each champion may be hit up to twice, but never on consecutive links`;
  if(type==='CLEANSE'){const keys=(effect.keys??[]).map(String);if(keys.length===1&&keys[0].toLowerCase()==='poison')return 'Cure Poison';return 'Cleanse matching negative statuses';}
  if(type==='RESURRECT_ONLY')return `Resurrect a KO'd ally at ${fmtPct((effect.revivePctMaxHP??.5)*100)} max HP${effect.cleanse?' and cleanse statuses':''}`;
  if(type==='TEMP_ATTACKS_MULTIPLIER')return `${effect.factor??1}× attack pool for ${effect.duration??'?'} rounds`;
  if(type==='TEMP_MOVEMENT_MULTIPLIER')return `${effect.factor??1}× Movement pool for ${effect.duration??'?'} rounds`;
  if(type==='TEMP_MOVEMENT_MAX')return `+${Math.max(0,Math.trunc(effect.amount??0))} Movement for ${effect.duration??'?'} rounds`;
  if(type==='STRIP_DEFENSIVE_BUFF')return `Strip ${effect.count??1} defensive buff`;
  if(type==='REMOVE_STATUS')return `Remove ${String(effect.key??'status').replaceAll('_',' ')}`;
  if(type==='STRIP_BENEFICIAL')return `Strip ${effect.count??1} beneficial status`;
  if(type==='DISPEL_EXCEPT')return `Remove all statuses except ${(effect.keep??[]).map(k=>String(k).replaceAll('_',' ')).join(' and ')}`;
  return null;
}
export function abilityDetailModel(actor,ability){
  invariant(actor&&ability,'abilityDetailModel requires actor and ability.');
  const lines=[];
  if(ability.actionKind==='BASIC_ATTACK'){
    const style=ability.basicStyle??{};const resourceCount=style.attacksSet??Math.max(0,actor.resources?.attacksMax??0)+(style.attacksDelta??0);
    const count=Number.isInteger(style.ordinaryAttackLimit)?Math.min(resourceCount,style.ordinaryAttackLimit):resourceCount;
    const dmgMult=(style.damageMultiplier??1)*directMultiplier(actor,'ATK');
    lines.push(`${count} swing${count===1?'':'s'} • ${scaledRange(actor.weapon.attackBaseMin,actor.weapon.attackBaseMax,dmgMult)} physical per hit before ARM`);
    if(Number.isInteger(style.ordinaryAttackLimit)&&resourceCount>count)lines.push(`${resourceCount-count} remaining attack resource${resourceCount-count===1?'':'s'} reserved for normal counters`);
    if(style.startupDelayCycles)lines.push(`Begins after ${style.startupDelayCycles} initiative cycle${style.startupDelayCycles===1?'':'s'}`);
    if(style.firstSuccessfulHit){
      const f=style.firstSuccessfulHit;
      lines.push(`First landed strike: ${Math.round((f.damageMultiplier??1)*100)}% weapon damage • +${Math.round((f.critBonus??0)*100)}% crit • ${Math.round((f.defensePenetration??0)*100)}% ARM penetration`);
      if(f.stealthDamageMultiplier||f.stealthCritBonus)lines.push(`Primed from Invisibility: ${Math.round((f.stealthDamageMultiplier??f.damageMultiplier??1)*100)}% weapon damage • +${Math.round(((f.critBonus??0)+(f.stealthCritBonus??0))*100)}% crit`);
    }
    if(style.movementMultiplier!=null)lines.push(`Movement ×${style.movementMultiplier}`);
    if(Number.isFinite(style.preAttackRetreatSteps)&&style.preAttackRetreatSteps>0)lines.push(`Before first shot: attempt to retreat up to ${Math.trunc(style.preAttackRetreatSteps)} squares while staying in attack range`);
    if(style.onHit?.defenseShredPct)lines.push(`On hit: ${fmtPct(style.onHit.defenseShredPct*100)} multiplicative DEF reduction per stack • ${style.onHit.duration??'?'}R`);
    else if(style.onHit?.statusKey)lines.push(`On hit: ${String(style.onHit.statusKey).replaceAll('_',' ')}${style.onHit.chance!=null?` (${fmtPct(style.onHit.chance*100)})`:''}${style.onHit.duration?` • ${style.onHit.duration}R`:''}`);
    const proc=ability.basicProc;if(proc){const chance=Number.isFinite(proc.roundChance)?`~${fmtPct(proc.roundChance*100)} across a full attack sequence${Number.isFinite(proc.maxPerRound)?` • max ${proc.maxPerRound}/round`:''}`:(Number.isFinite(proc.chance)?`${fmtPct(proc.chance*100)} per successful hit`:'guaranteed');let effect=proc.label??'Passive proc';if(proc.type==='DAMAGE'){effect+=` • ${scaledRange(proc.min??0,proc.max??proc.min??0,directMultiplier(actor,proc.scalesWith??'SDM'))} ${String(proc.damageType??'MAGICAL').toLowerCase()} damage`;if(Number(proc.defensePenetration)>0)effect+=` • ${fmtPct(proc.defensePenetration*100)} penetration`;if(proc.canCrit!==false)effect+=` • ${fmtPct(Math.min(1,Number(actor.stats?.CRIT??0)+Number(proc.critBonus??0))*100)} crit`;}else if(proc.type==='LIFE_DRAIN')effect+=` • ${scaledRange(proc.min??0,proc.max??proc.min??0,directMultiplier(actor,proc.scalesWith??'SDM'))} magical drain`;else if(proc.type==='HEAL_SELF')effect+=` • ${scaledRange(proc.min??0,proc.max??proc.min??0,directMultiplier(actor,proc.scalesWith??'SDM'))} self-heal`;else if(proc.type==='STATUS'||proc.type==='STATUS_SELF'){effect+=` • ${String(proc.key??'status').replaceAll('_',' ')}${proc.duration?` ${proc.duration}R`:''}`;for(const extra of proc.additionalStatuses??[])effect+=` + ${String(extra.key??'status').replaceAll('_',' ')}${extra.duration?` ${extra.duration}R`:''}`;}lines.push(`Passive: ${effect} • ${chance}`);}
  }
  for(const effect of ability.effects??[]){const line=summarizeEffect(actor,effect,ability);if(line)lines.push(line);}
  if(ability.deadTargetOnly===true)lines.push("Target restriction: KO'd allied corpses only; living allies are not legal targets");
  const useText=abilityUseText(actor,ability);if(useText)lines.push(`Limited use: ${useText}`);
  if(ability.area?.shape)lines.push(`Area: ${String(ability.area.shape).replaceAll('_',' ')}`);
  return Object.freeze({
    id:ability.id,label:ability.label,actionKind:ability.actionKind,target:targetLabel(ability),timing:timingLabel(ability),
    note:ability.note??'',lines:Object.freeze(lines)
  });
}

const COMPACT_HOSTILE_EFFECTS=new Set(['DAMAGE','CONDITIONAL_DAMAGE','CURRENT_HP_DAMAGE','LIFE_DRAIN','POISON_FLAT_ROLL','DETONATE_POISON_AND_RESEED','AOE_DAMAGE','MULTI_STRIKE','CHAIN_LIGHTNING','WEAPON_STRIKE','BACKSTAB_STRIKE']);
const COMPACT_SUPPORT_EFFECTS=new Set(['HEAL','HEAL_PERCENT_ROLL','FULL_HEAL','RESURRECT_ONLY','CLEANSE']);
const COMPACT_CONTROL_KEYS=new Set(['stun','silence','taunt','berserk','root','suppression','spellbreak','blind','marked','def_down','rend_def_down']);
export function compactAbilitySummary(ability){
  invariant(ability,'compactAbilitySummary requires ability.');
  if(ability.actionKind===ACTION_KIND.BASIC_ATTACK) return ability.label==='Attack'?'Single-target attack':'Modified attack style';
  const effects=ability.effects??[];
  const damaging=effects.some(e=>COMPACT_HOSTILE_EFFECTS.has(e.type));
  const healing=effects.some(e=>COMPACT_SUPPORT_EFFECTS.has(e.type));
  const control=effects.some(e=>e.type==='APPLY_STATUS'&&COMPACT_CONTROL_KEYS.has(String(e.key??'').toLowerCase()));
  const aoe=Boolean(ability.area)||ability.targetType===TARGET_TYPE.ALL_ENEMIES||ability.targetType===TARGET_TYPE.ALL_ALLIES;
  const self=ability.targetType===TARGET_TYPE.SELF;
  const unit=ability.targetType===TARGET_TYPE.UNIT;
  const noun=ability.actionKind===ACTION_KIND.SPELL?'spell':(ability.actionKind===ACTION_KIND.ITEM?'item':'ability');
  if(damaging&&aoe)return `Damaging AoE ${noun}`;
  if(damaging&&unit)return `Single-target damage ${noun}`;
  if(control&&unit)return `Single-target control ${noun}`;
  if(healing&&aoe)return `Team support ${noun}`;
  if(healing&&unit)return `Single-target support ${noun}`;
  if(self)return `Self-buff ${noun}`;
  if(aoe)return `Team/AoE ${noun}`;
  return `${noun[0].toUpperCase()+noun.slice(1)} action`;
}

export function validatePlaytestTeams(teamA,teamB,allowedArchetypes=[],{teamSize=null}={}){
  const a=Array.isArray(teamA)?teamA:[], b=Array.isArray(teamB)?teamB:[];
  if(a.length!==b.length||a.length<1||a.length>5)return Object.freeze({ok:false,error:'Playtest teams must contain the same number of champions, from 1 to 5 per side.'});
  if(teamSize!==null && a.length!==teamSize)return Object.freeze({ok:false,error:`Playtest teams must contain exactly ${teamSize} champion${teamSize===1?'':'s'} per side.`});
  const all=[...a,...b];
  if(all.some(x=>!allowedArchetypes.includes(x)))return Object.freeze({ok:false,error:'Unknown archetype in playtest roster.'});
  if(new Set(all).size!==all.length)return Object.freeze({ok:false,error:'Playtest roster cannot contain duplicate archetypes.'});
  return Object.freeze({ok:true,error:null,teamSize:a.length,teamA:Object.freeze([...a]),teamB:Object.freeze([...b])});
}

function livingSideActorIds(state,side){
  return Object.values(state.units)
    .filter(u=>u.side===side&&u.lifeState===LIFE_STATE.ALIVE&&u.entityKind!=='SUMMON')
    .sort((a,b)=>(a.position?.row??999)-(b.position?.row??999)||(a.position?.col??999)-(b.position?.col??999)||a.draftSlot-b.draftSlot||a.unitId.localeCompare(b.unitId))
    .map(u=>u.unitId);
}

export class ActionSelectionSession {
  constructor({state,side=SIDE.A,durationMs=ACTION_SELECTION_MS,now=Date.now}={}){
    invariant(state,'ActionSelectionSession requires state.');
    invariant(side===SIDE.A||side===SIDE.B,'ActionSelectionSession side must be A/B.');
    invariant(Number.isFinite(durationMs)&&durationMs>0,'durationMs must be > 0.');
    this.state=state;this.side=side;this.durationMs=durationMs;this.now=now;
    this.startedAt=now();this.deadlineAt=this.startedAt+durationMs;this.locked=false;this.pausedAt=null;
    this.actorIds=livingSideActorIds(state,side);this.byActor=new Map();
  }
  remainingMs(){const t=this.pausedAt??this.now();return Math.max(0,this.deadlineAt-t);}
  isExpired(){return this.remainingMs()<=0;}
  isPaused(){return this.pausedAt!==null;}
  pause(){if(this.locked||this.pausedAt!==null)return false;this.pausedAt=this.now();return true;}
  resume(){if(this.pausedAt===null)return false;const t=this.now();this.deadlineAt+=Math.max(0,t-this.pausedAt);this.pausedAt=null;return true;}
  extend(extraMs){invariant(Number.isFinite(extraMs)&&extraMs>0,'Timer extension must be > 0.');this.deadlineAt+=extraMs;return this.deadlineAt;}
  setDeclaration(declaration){
    invariant(!this.locked,'Action selection already locked.');
    invariant(declaration?.roundNumber===this.state.roundNumber,'Declaration round mismatch.');
    invariant(this.actorIds.includes(declaration.actorId),`Actor not selectable by this side: ${declaration.actorId}`);
    this.byActor.set(declaration.actorId,declaration);return declaration;
  }
  clear(actorId){invariant(!this.locked,'Action selection already locked.');this.byActor.delete(actorId);}
  get(actorId){return this.byActor.get(actorId)??null;}
  missingActorIds(){return this.actorIds.filter(id=>!this.byActor.has(id));}
  snapshot(){return Object.freeze({
    side:this.side,roundNumber:this.state.roundNumber,startedAt:this.startedAt,deadlineAt:this.deadlineAt,remainingMs:this.remainingMs(),locked:this.locked,paused:this.isPaused(),
    actorIds:Object.freeze([...this.actorIds]),
    declarations:Object.freeze([...this.byActor.values()].sort((a,b)=>a.actorId.localeCompare(b.actorId)).map(structuredClone)),
    missingActorIds:Object.freeze(this.missingActorIds())
  });}
  lock({fillMissingWithHold=true}={}){
    invariant(!this.locked,'Action selection already locked.');
    if(fillMissingWithHold){for(const actorId of this.missingActorIds())this.byActor.set(actorId,createHoldDeclaration({declarationId:`D${this.state.roundNumber}:${actorId}`,roundNumber:this.state.roundNumber,actorId}));}
    invariant(this.missingActorIds().length===0,'Cannot lock while declarations are missing.');
    this.locked=true;
    return Object.freeze([...this.byActor.values()].sort((a,b)=>a.actorId.localeCompare(b.actorId)));
  }
  lockOnTimeout(){invariant(this.isExpired(),'lockOnTimeout requires expired timer.');return this.lock({fillMissingWithHold:true});}
}

export function isImmediateTargetType(type){return [TARGET_TYPE.SELF,TARGET_TYPE.ALL_ALLIES,TARGET_TYPE.ALL_ENEMIES,TARGET_TYPE.NONE].includes(type);}
export function targetForImmediateAbility(type){
  if(type===TARGET_TYPE.SELF)return {type:TARGET_TYPE.SELF};
  if(type===TARGET_TYPE.ALL_ALLIES)return {type:TARGET_TYPE.ALL_ALLIES};
  if(type===TARGET_TYPE.ALL_ENEMIES)return {type:TARGET_TYPE.ALL_ENEMIES};
  if(type===TARGET_TYPE.NONE)return {type:TARGET_TYPE.NONE};
  return null;
}

export function commandSpatialEndpoints(command){
  const p=command?.payload??{};
  if(command?.type==='SPELL_PROJECTILE')return {from:p.from??null,to:p.to??null};
  if(command?.type==='MOVE_UNIT')return {from:p.from??null,to:p.to??null};
  if(command?.type==='DISPLACE_UNIT')return {from:p.from??p.start??null,to:p.to??p.end??p.finalPosition??null};
  return {from:null,to:null};
}

export function boardCellLabel(cell){
  if(!cell||!Number.isInteger(cell.row)||!Number.isInteger(cell.col))return '?';
  const column=String.fromCharCode(65+cell.col);
  return `${column}${cell.row+1}`;
}

export function actionSummary(declaration,state=null){
  if(!declaration)return 'No action selected';
  if(declaration.actionKind===ACTION_KIND.HOLD)return 'HOLD';
  const ref=declaration.payload?.roster;
  const ability=ref?getAbility(ref.archetypeId,ref.abilityId):null;
  const target=declaration.target;
  let suffix='';
  if(target?.type===TARGET_TYPE.UNIT){
    const unit=state?.units?.[target.unitId];
    suffix=` → ${unit?unit.archetypeId:target.unitId}`;
  } else if(target?.type===TARGET_TYPE.GROUND)suffix=` → ${boardCellLabel(target)}`;
  return `${ability?.label??declaration.actionId}${suffix}`;
}


function displayUnitName(state, unitId) {
  if (!unitId) return 'Environment';
  const unit = state?.units?.[unitId];
  return unit ? `${unit.archetypeId} (${unitId})` : unitId;
}

function displayActionName(state, actorId, actionId) {
  if (!actionId) return 'action';
  const archetypeId = state?.units?.[actorId]?.archetypeId;
  if (archetypeId) {
    try { return getAbility(archetypeId, actionId).label; } catch {}
  }
  return actionId.replaceAll('_', ' ');
}

/**
 * Compact player-facing log text derived only from authoritative events.
 * Returning null deliberately hides low-value scheduler/movement noise.
 */
export function describeAuthoritativeEvent(event, state) {
  if (!event) return null;
  const cycle = `[C${String(event.initiativeCycle ?? 0).padStart(2,'0')}]`;
  const actor = displayUnitName(state, event.actorId);
  const target = displayUnitName(state, event.targetId);
  const p = event.payload ?? {};
  const actionName = displayActionName(state, event.actorId, p.actionId ?? p.abilityId);
  switch (event.type) {
    case EVENT_TYPE.ROUND_START: return `— ROUND ${p.roundNumber ?? state?.roundNumber ?? ''} START —`;
    case EVENT_TYPE.ROUND_END: return `— ROUND ${p.roundNumber ?? state?.roundNumber ?? ''} END —`;
    case EVENT_TYPE.ACTION_START: {
      const name = displayActionName(state, event.actorId, p.actionId);
      return `${cycle} ${actor} uses ${name}${event.targetId ? ` → ${target}` : ''}.`;
    }
    case EVENT_TYPE.COUNTER: return `${cycle} ${actor} COUNTERS ${target}.`;
    case EVENT_TYPE.INTERCEPT: return `${cycle} ${actor} intercepts an attack meant for ${target}.`;
    case EVENT_TYPE.CRIT: { const via=p.procLabel?` ${p.procLabel} (proc)`:(p.abilityId?` ${displayActionName(state,event.actorId,p.abilityId)}`:''); return `${cycle} CRITICAL HIT — ${actor}${via} → ${target}.`; }
    case EVENT_TYPE.MISS: { const via=p.abilityId?` with ${displayActionName(state,event.actorId,p.abilityId)}`:''; return `${cycle} ${actor} misses ${target}${via}.`; }
    case EVENT_TYPE.DODGE: { const via=p.abilityId?`'s ${displayActionName(state,event.actorId,p.abilityId)}`:''; return `${cycle} ${target} dodges ${actor}${via}.`; }
    case EVENT_TYPE.BLOCK: {
      if(p.reason==='WARD'){const hostile=displayUnitName(state,p.hostileSourceId);const what=String(p.blockedStatusKey??'status').toUpperCase();const amount=Number.isFinite(p.blockedAmount)?`${p.blockedAmount} `:'';const via=p.abilityId?` from ${hostile}'s ${displayActionName(state,p.hostileSourceId,p.abilityId)}`:(p.hostileSourceId?` from ${hostile}`:'');return `${cycle} ${target}'s WARD blocks ${amount}${what}${via}.`;}
      if(p.reason==='STATUS_RESIST'){const hostile=displayUnitName(state,p.hostileSourceId);const what=String(p.blockedStatusKey??'status').toUpperCase();return `${cycle} ${target} resists ${what}${p.hostileSourceId?` from ${hostile}`:''}.`;}
      if(p.reason==='SPELLBREAK') return `${cycle} SPELLBREAK interrupts ${target}'s spell and is consumed.`;
      return `${cycle} ${target} blocks ${actor}.`;
    }
    case EVENT_TYPE.DAMAGE: {
      if (p.source === 'STATUS_TICK') {
        const key=String(p.damageType ?? 'STATUS').toUpperCase();
        if(key==='POISON'&&Number.isFinite(p.poisonTotalBefore)&&Number.isFinite(p.tickPct)) return `${cycle} POISON ticks ${target} for ${p.amount ?? '?'} damage (${Math.round(p.tickPct*100)}% of ${p.poisonTotalBefore} Poison)${Number.isFinite(p.hpAfter) ? ` — ${p.hpAfter} HP remains` : ''}.`;
        return `${cycle} ${key} ticks ${target} for ${p.amount ?? '?'} damage${Number.isFinite(p.hpAfter) ? ` (${p.hpAfter} HP)` : ''}.`;
      }
      const mitigation = Number.isFinite(p.mitigated) && p.mitigated > 0 ? ` [${p.mitigated} mitigated]` : '';
      const via = p.procLabel ? ` with ${p.procLabel} (proc)` : (p.abilityId ? ` with ${displayActionName(state,event.actorId,p.abilityId)}` : '');
      return `${cycle} ${actor} hits ${target}${via} for ${p.amount ?? '?'} ${String(p.damageType ?? '').toLowerCase()} damage${mitigation}${Number.isFinite(p.hpAfter) ? ` (${p.hpAfter} HP)` : ''}.`;
    }
    case EVENT_TYPE.HEAL: {
      const via=p.procLabel?` with ${p.procLabel} (proc)`:(p.abilityId?` with ${displayActionName(state,event.actorId,p.abilityId)}`:'');
      if(p.blockedByBleed) return `${cycle} BLEED prevents ${target} from gaining HP${via}.`;
      return `${cycle} ${actor} heals ${target}${via} for ${p.amount ?? '?'}${Number.isFinite(p.hpAfter) ? ` (${p.hpAfter} HP)` : ''}.`;
    }
    case EVENT_TYPE.STATUS_APPLY: {
      const key=String(p.key ?? 'status').toUpperCase();
      if(key==='POISON' && Number.isFinite(p.contribution?.amount)){
        const total=Number.isFinite(p.total)?` → ${p.total} total`:'';
        const via=p.abilityId?` with ${displayActionName(state,event.actorId,p.abilityId)}`:'';
        return `${cycle} ${actor} adds +${p.contribution.amount} Poison to ${target}${via}${total}.`;
      }
      return `${cycle} ${target} gains ${key}${p.duration != null ? ` (${p.duration} rounds)` : ''}.`;
    }
    case EVENT_TYPE.STATUS_REMOVE: {
      const key=String(p.key ?? 'status').toUpperCase();
      if(p.reason==='CLEANSE') { const via=p.abilityId?` with ${displayActionName(state,event.actorId,p.abilityId)}`:''; return `${cycle} ${actor} cleanses ${key} from ${target}${via}.`; }
      if(p.reason==='CONSUMED_BLOCKING_STATUS'&&key==='WARD') return `${cycle} WARD on ${target} is consumed.`;
      if(p.reason==='DISPEL') {const via=p.abilityId?` with ${displayActionName(state,event.actorId,p.abilityId)}`:'';return `${cycle} ${actor} dispels ${key} from ${target}${via}.`;}
      if(p.reason==='STRIP_BENEFICIAL') return `${cycle} ${actor} strips ${key} from ${target}.`;
      if(p.reason==='PIERCING_LIGHT_REVEAL') return `${cycle} ${actor} reveals ${target}; ${key} is removed.`;
      if(p.reason==='PHYSICAL_ATTACK_REVEAL') return `${cycle} ${key} ends on ${target} after a physical attack.`;
      return `${cycle} ${key} is removed from ${target}${p.reason?` (${String(p.reason).replaceAll('_',' ').toLowerCase()})`:''}.`;
    }
    case EVENT_TYPE.STATUS_EXPIRE:
      return `${cycle} ${String(p.key ?? 'status').toUpperCase()} expires on ${target}.`;
    case EVENT_TYPE.STATUS_TICK:
      if(String(p.key??'').toLowerCase()==='poison' && Number.isFinite(p.remaining)) return `${cycle} Poison on ${target} decays to ${p.remaining} total after the tick.`;
      return null;
    case EVENT_TYPE.CAST_COMPLETE:
      return `${cycle} ${actor}'s ${displayActionName(state,event.actorId,p.abilityId ?? p.actionId)} completes.`;
    case EVENT_TYPE.CAST_INTERRUPT:
      return `${cycle} ${actor}'s spell is INTERRUPTED${p.reason ? ` (${p.reason})` : ''}.`;
    case EVENT_TYPE.CAST_FIZZLE:
      return `${cycle} ${actor}'s spell FIZZLES${p.reason ? ` (${p.reason})` : ''}.`;
    case EVENT_TYPE.SPELL_RESOLUTION:
      return p.abilityId ? `${cycle} ${actor}'s ${displayActionName(state,event.actorId,p.abilityId)} resolves.` : null;
    case EVENT_TYPE.TELEPORT:
      return `${cycle} ${target !== 'Environment' ? target : actor} teleports${p.to ? ` to (${p.to.row},${p.to.col})` : ''}.`;
    case EVENT_TYPE.KO: return `${cycle} ${target} is KO'd${event.actorId ? ` by ${actor}` : ''}.`;
    case EVENT_TYPE.RESURRECT: return `${cycle} ${actor} RESURRECTS ${target} with ${p.hp ?? '?'} HP.`;
    case EVENT_TYPE.SUMMON:
      return `${cycle} ${actor} summons ${p.label ?? 'a summon'}${event.targetId ? ` (${event.targetId})` : ''}.`;
    default: return null;
  }
}


function compactUnitName(state, unitId) {
  if (!unitId) return 'Environment';
  return state?.units?.[unitId]?.archetypeId ?? unitId;
}

function compactStatusName(key) {
  const raw=String(key??'status').toLowerCase();
  const names={
    atk_up:'ATK Up',sdm_up:'SDM Up',def_up:'DEF Up',res_up:'RES Up',
    atk_down:'ATK Down',sdm_down:'SDM Down',def_down:'DEF Down',res_down:'RES Down',rend_def_down:'DEF Down',
    magic_shield:'Magic Shield',physical_shield:'Physical Shield',divine_shield:'Divine Shield',shield_redirect:'Shieldwall',
    poison_imbue:'Poison Imbue',bleed_imbue:'Bleed Imbue',shadowstep_crit:'Shadowstep',shinobi_haste:'Haste',
    arcane_echo:'Arcane Echo',counterstance:'Counterstance',flurry_style:'Flurry',premonition:'Premonition',
    invisible:'Invisibility',marked:'Marked',spellbreak:'Spellbreak',berserk:'Berserk',stun:'Stun',blind:'Blind',
    poison:'Poison',bleed:'Bleed',taunt:'Taunt',silence:'Silence',root:'Root',suppression:'Suppression',ward:'Ward',regen:'Regen',shift:'Shift'
  };
  return names[raw] ?? raw.replaceAll('_',' ').replace(/\b\w/g,c=>c.toUpperCase());
}

const PLAYER_LOG_NEGATIVE_STATUSES=new Set(['stun','silence','taunt','berserk','root','suppression','spellbreak','marked','blind','bleed','def_down','rend_def_down','atk_down','sdm_down','res_down']);

/**
 * Build the default player-facing combat log from the full authoritative event stream.
 * The detailed/debug formatter above remains available behind the UI's Detailed toggle.
 *
 * The compact plan intentionally:
 * - removes cycle coordinates and unit ids;
 * - hides scheduler/cast-complete/status-expiry bookkeeping;
 * - preserves every individual attack hit, miss and dodge in authoritative order;
 * - highlights critical hits on the exact strike that critted;
 * - aggregates poison applications and multi-target healing where practical.
 */
export function buildPlayerCombatLogPlan(events, state) {
  const source=Array.isArray(events)?events:[];
  const byId=new Map(source.map(e=>[e.eventId,e]));
  const plan=new Map();
  const add=(eventId,text,kind='system')=>{
    if(!eventId||!text)return;
    if(!plan.has(eventId))plan.set(eventId,[]);
    plan.get(eventId).push(Object.freeze({text,kind}));
  };
  const contextRoot=(event)=>{
    let cur=event;
    const seen=new Set();
    while(cur?.parentEventId&&!seen.has(cur.parentEventId)){
      seen.add(cur.parentEventId);
      cur=byId.get(cur.parentEventId);
      if(!cur)break;
      if(cur.type===EVENT_TYPE.COUNTER||cur.type===EVENT_TYPE.ACTION_START)return cur;
    }
    return null;
  };
  const actionAbility=(root,event)=>{
    const actorId=event?.actorId??root?.actorId;
    const abilityId=event?.payload?.abilityId??root?.payload?.actionId??null;
    if(!actorId||!abilityId)return null;
    const archetypeId=state?.units?.[actorId]?.archetypeId;
    if(!archetypeId)return null;
    try{return getAbility(archetypeId,abilityId);}catch{return null;}
  };
  const contextKey=(root,event)=>root?.eventId??`FREE:${event.eventId}`;
  const critImpactParents=new Set(source.filter(e=>e.type===EVENT_TYPE.CRIT&&e.parentEventId).map(e=>e.parentEventId));
  const koByDamageId=new Map(source.filter(e=>e.type===EVENT_TYPE.KO&&e.parentEventId).map(e=>[e.parentEventId,e]));
  const linkedKoIds=new Set(koByDamageId.values().map(e=>e.eventId));
  const healGroups=new Map(), poisonGroups=new Map(), statusGroups=new Map();

  const group=(map,key,init)=>{if(!map.has(key))map.set(key,init());return map.get(key);};

  for(const event of source){
    const p=event.payload??{};
    const root=contextRoot(event);
    const actor=compactUnitName(state,event.actorId),target=compactUnitName(state,event.targetId);
    const ability=actionAbility(root,event);
    const abilityId=p.abilityId??root?.payload?.actionId??null;
    const abilityName=ability?.label??(abilityId?displayActionName(state,event.actorId,abilityId):'');

    if(event.type===EVENT_TYPE.DAMAGE){
      if(String(p.source??'').toUpperCase()==='STATUS_TICK'){
        const label=String(p.damageType??'status').toLowerCase()==='poison'?'Poison':compactStatusName(p.damageType);
        const ko=koByDamageId.get(event.eventId);
        add(event.eventId,`${label} hits ${target} for ${p.amount??'?'} damage${ko?' — KO!':''}.`,`combat ${String(p.damageType??'physical').toLowerCase()}`);
        continue;
      }
      const procLabel=p.procLabel??'';
      const critical=critImpactParents.has(event.parentEventId);
      const killed=koByDamageId.has(event.eventId);
      const isCounter=root?.type===EVENT_TYPE.COUNTER;
      const plainAttack=abilityName==='Attack'&&!procLabel;
      let lead;
      if(procLabel)lead=`${actor}'s ${procLabel} procs on ${target}`;
      else if(isCounter)lead=`${actor} counters ${target}`;
      else if(plainAttack)lead=`${actor} attacks ${target}`;
      else lead=`${actor}'s ${abilityName||'attack'} hits ${target}`;
      const critPrefix=critical?'CRITICAL! ':'';
      const type=String(p.damageType??'physical').toLowerCase();
      add(event.eventId,`${critPrefix}${lead} for ${p.amount??'?'} ${type} damage${killed?' — KO!':''}.`,critical?'critical':`combat ${type}`);
      continue;
    }

    if(event.type===EVENT_TYPE.MISS||event.type===EVENT_TYPE.DODGE){
      const isCounter=root?.type===EVENT_TYPE.COUNTER;
      const plainAttack=abilityName==='Attack';
      const attackName=isCounter?'counter':(plainAttack?'attack':(abilityName||'attack'));
      if(event.type===EVENT_TYPE.DODGE)add(event.eventId,`${target} dodges ${actor}'s ${attackName}.`,'combat');
      else add(event.eventId,`${actor}'s ${attackName} misses ${target}.`,'combat');
      continue;
    }

    if(event.type===EVENT_TYPE.HEAL){
      if(p.blockedByBleed){
        add(event.eventId,`Bleed prevents ${target} from healing${abilityName?` with ${abilityName}`:''}.`,'status bleed');
        continue;
      }
      const amount=Number(p.amount??0);if(amount<=0)continue;
      const procLabel=p.procLabel??'';
      const key=`${contextKey(root,event)}|${event.actorId??''}|${abilityId??''}|${procLabel}`;
      const g=group(healGroups,key,()=>({root,actorId:event.actorId,abilityId,abilityName,procLabel,targets:[],total:0,lastEventId:event.eventId}));
      g.targets.push({id:event.targetId,name:target,amount});g.total+=amount;g.lastEventId=event.eventId;
      continue;
    }

    if(event.type===EVENT_TYPE.STATUS_APPLY){
      const keyName=String(p.key??'').toLowerCase();
      if(keyName==='poison'&&Number.isFinite(p.contribution?.amount)){
        const key=`${contextKey(root,event)}|${event.actorId??''}|${event.targetId??''}|${abilityId??''}`;
        const g=group(poisonGroups,key,()=>({root,actorId:event.actorId,targetId:event.targetId,abilityId,abilityName,totalAdded:0,lastTotal:null,lastEventId:event.eventId}));
        g.totalAdded+=Number(p.contribution.amount);if(Number.isFinite(p.total))g.lastTotal=p.total;g.lastEventId=event.eventId;
        continue;
      }
      const isProc=p.data?.proc===true;
      if(!PLAYER_LOG_NEGATIVE_STATUSES.has(keyName)&&!isProc)continue;
      const key=`${contextKey(root,event)}|${event.actorId??''}|${keyName}|${p.data?.procLabel??''}|${p.duration??''}`;
      const g=group(statusGroups,key,()=>({root,actorId:event.actorId,key:keyName,duration:p.duration,procLabel:p.data?.procLabel??'',targets:new Map(),lastEventId:event.eventId}));
      const prev=g.targets.get(event.targetId)??0;g.targets.set(event.targetId,prev+1);g.lastEventId=event.eventId;
      continue;
    }

    switch(event.type){
      case EVENT_TYPE.ROUND_START:
        add(event.eventId,`— ROUND ${p.roundNumber??state?.roundNumber??''} —`,'round');
        break;
      case EVENT_TYPE.ACTION_START: {
        const a=actionAbility(event,event);
        if(!a)break;
        const isPlainAttack=a.actionKind===ACTION_KIND.BASIC_ATTACK&&a.label==='Attack';
        if(isPlainAttack||a.actionKind===ACTION_KIND.HOLD)break;
        let verb='uses';
        if(a.actionKind===ACTION_KIND.SPELL)verb='casts';
        else if(a.actionKind===ACTION_KIND.BASIC_ATTACK)verb='uses';
        const targetPart=event.targetId&&event.targetId!==event.actorId?` on ${target}`:'';
        add(event.eventId,`${actor} ${verb} ${a.label}${targetPart}.`,'action');
        break;
      }
      case EVENT_TYPE.COUNTER:
        // Counter outcome is folded into the resulting hit/miss summary.
        break;
      case EVENT_TYPE.INTERCEPT:
        add(event.eventId,`${actor} intercepts the attack for ${target}.`,'action');
        break;
      case EVENT_TYPE.BLOCK: {
        const reason=String(p.reason??'').toUpperCase();
        if(reason==='STATUS_RESIST')add(event.eventId,`${target} resists ${compactStatusName(p.blockedStatusKey)}!`,'status control');
        else if(reason==='WARD')add(event.eventId,`${target}'s Ward blocks ${compactStatusName(p.blockedStatusKey)}.`,'status positive');
        else if(reason==='SPELLBREAK')add(event.eventId,`Spellbreak interrupts ${target}'s spell!`,'status control');
        else add(event.eventId,`${target} blocks the effect.`,'combat');
        break;
      }
      case EVENT_TYPE.STATUS_REMOVE: {
        const status=compactStatusName(p.key);
        if(p.reason==='CLEANSE')add(event.eventId,`${actor} cleanses ${status} from ${target}.`,'status positive');
        else if(p.reason==='DISPEL')add(event.eventId,`${actor} dispels ${status} from ${target}.`,'status negative');
        else if(p.reason==='STRIP_BENEFICIAL'||p.reason==='STRIP_DEFENSIVE_BUFF')add(event.eventId,`${actor} strips ${status} from ${target}.`,'status negative');
        else if(p.reason==='PIERCING_LIGHT_REVEAL')add(event.eventId,`${actor} reveals ${target}.`,'status negative');
        else if(p.reason==='PHYSICAL_ATTACK_REVEAL')add(event.eventId,`${target} becomes visible.`,'status negative');
        else if(p.reason==='CONSUMED_BLOCKING_STATUS'&&String(p.key??'').toLowerCase()==='ward')add(event.eventId,`${target}'s Ward is consumed.`,'status positive');
        break;
      }
      case EVENT_TYPE.CAST_INTERRUPT:
        add(event.eventId,`${actor}'s ${abilityName||'spell'} is interrupted${p.reason?` (${String(p.reason).replaceAll('_',' ').toLowerCase()})`:''}.`,'action');
        break;
      case EVENT_TYPE.CAST_FIZZLE:
        add(event.eventId,`${actor}'s ${abilityName||'spell'} fizzles${p.reason?` (${String(p.reason).replaceAll('_',' ').toLowerCase()})`:''}.`,'action');
        break;
      case EVENT_TYPE.TELEPORT:
        add(event.eventId,`${target!=='Environment'?target:actor} shifts to a new position.`,'action');
        break;
      case EVENT_TYPE.RESURRECT:
        add(event.eventId,`${actor} resurrects ${target} with ${p.hp??'?'} HP.`,'heal');
        break;
      case EVENT_TYPE.SUMMON:
        add(event.eventId,`${actor} summons ${p.label??'an ally'}.`,'action');
        break;
      case EVENT_TYPE.KO:
        if(!linkedKoIds.has(event.eventId))add(event.eventId,`${target} is KO'd${event.actorId?` by ${actor}`:''}!`,'critical');
        break;
      default: break;
    }
  }

  for(const g of healGroups.values()){
    const actor=compactUnitName(state,g.actorId);
    const source=g.procLabel||g.abilityName||'healing';
    const positive=g.targets.filter(t=>t.amount>0);
    if(!positive.length)continue;
    if(positive.length===1){
      add(g.lastEventId,`${source} heals ${positive[0].name} for ${positive[0].amount} HP.`,'heal');
    }else{
      const detail=positive.map(t=>`${t.name} ${t.amount}`).join(', ');
      add(g.lastEventId,`${actor}'s ${source} heals ${detail} (${g.total} total).`,'heal');
    }
  }

  for(const g of poisonGroups.values()){
    const actor=compactUnitName(state,g.actorId),target=compactUnitName(state,g.targetId);
    const source=g.abilityName||'attack';
    const totalPart=Number.isFinite(g.lastTotal)?` (${g.lastTotal} total)`:'';
    add(g.lastEventId,`${actor}'s ${source} adds ${g.totalAdded} Poison to ${target}${totalPart}.`,'status poison');
  }

  for(const g of statusGroups.values()){
    const status=compactStatusName(g.key),actor=compactUnitName(state,g.actorId);
    const names=[...g.targets.keys()].map(id=>compactUnitName(state,id));
    const totalApplications=[...g.targets.values()].reduce((a,b)=>a+b,0);
    const rounds=Number.isFinite(g.duration)?` for ${g.duration} round${g.duration===1?'':'s'}`:'';
    let text;
    if(g.procLabel){
      const targetText=names.length===1?names[0]:names.join(', ');
      text=`${actor} procs ${g.procLabel} on ${targetText}: ${status}${totalApplications>1?` ×${totalApplications}`:''}${rounds}.`;
    }else if(g.key==='blind'){
      text=`${names.join(' and ')} ${names.length===1?'is':'are'} Blinded${rounds}.`;
    }else if(g.key==='stun'){
      text=`${names.join(' and ')} ${names.length===1?'is':'are'} Stunned${rounds}.`;
    }else if(g.key==='marked'){
      text=`${names.join(' and ')} ${names.length===1?'is':'are'} Marked${rounds}.`;
    }else if(g.key==='taunt'){
      text=`${actor} Taunts ${names.join(' and ')}${rounds}.`;
    }else if(g.key==='berserk'){
      text=`${names.join(' and ')} ${names.length===1?'is':'are'} Berserked${rounds}.`;
    }else if(g.key==='spellbreak'){
      text=`${names.join(' and ')} ${names.length===1?'is':'are'} afflicted by Spellbreak${rounds}.`;
    }else if(g.key==='bleed'){
      text=`${actor} inflicts Bleed on ${names.join(' and ')}${rounds}.`;
    }else if(['def_down','rend_def_down','res_down','atk_down','sdm_down'].includes(g.key)){
      text=`${names.join(' and ')} suffer${names.length===1?'s':''} ${status}${totalApplications>1?` ×${totalApplications}`:''}${rounds}.`;
    }else{
      text=`${names.join(' and ')} gain${names.length===1?'s':''} ${status}${rounds}.`;
    }
    const controlKeys=new Set(['stun','silence','taunt','berserk','root','suppression','spellbreak']);
    add(g.lastEventId,text,controlKeys.has(g.key)?'status control':(PLAYER_LOG_NEGATIVE_STATUSES.has(g.key)?'status negative':'status positive'));
  }

  return plan;
}

export function combatLogClassForEvent(event) {
  switch(event?.type){
    case EVENT_TYPE.DAMAGE: return `combat ${String(event.payload?.damageType??'PHYSICAL').toLowerCase()}`;
    case EVENT_TYPE.MISS: case EVENT_TYPE.DODGE: case EVENT_TYPE.BLOCK: return 'combat';
    case EVENT_TYPE.HEAL: case EVENT_TYPE.RESURRECT: return 'heal';
    case EVENT_TYPE.KO: case EVENT_TYPE.CRIT: return 'critical';
    case EVENT_TYPE.STATUS_APPLY: case EVENT_TYPE.STATUS_REMOVE: case EVENT_TYPE.STATUS_EXPIRE: {
      const key=String(event.payload?.key??'').toLowerCase();
      if(HARD_CONTROL_STATUS_SET.has(key))return 'status control';
      if(key==='poison')return 'status poison';
      if(key==='bleed')return 'status bleed';
      return NEGATIVE_STATUS_KEYS.has(key)?'status negative':'status positive';
    }
    case EVENT_TYPE.ACTION_START: case EVENT_TYPE.CAST_COMPLETE: case EVENT_TYPE.CAST_INTERRUPT: case EVENT_TYPE.CAST_FIZZLE: case EVENT_TYPE.SPELL_RESOLUTION: return 'action';
    case EVENT_TYPE.ROUND_START: case EVENT_TYPE.ROUND_END: return 'round';
    default: return 'system';
  }
}
