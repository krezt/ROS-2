import { ACTION_KIND, DAMAGE_TYPE, RETARGET_POLICY, TARGET_TYPE, WEAPON_BEHAVIOR } from './constants.js';
import { createActionDeclaration } from './declarations.js';
import { invariant } from './errors.js';
import { createUnitState } from './state.js';

export const LEGACY_TIMING = Object.freeze({ fast: 1, normal: 3, slow: 5 });
export const ROSTER_MIGRATION_STATUS = Object.freeze({ NATIVE: 'NATIVE', PROVISIONAL: 'PROVISIONAL', DESIGN_GATE: 'DESIGN_GATE' });

const T = TARGET_TYPE;
const A = ACTION_KIND;
const D = DAMAGE_TYPE;

const ab = (id, label, timing, actionKind, targetType, effects, extra={}) => Object.freeze({
  id, label, completionDelayCycles: typeof timing === 'number' ? timing : LEGACY_TIMING[timing], actionKind, targetType,
  castRange: extra.castRange ?? (actionKind === A.SPELL || targetType === T.SELF || targetType === T.ALL_ALLIES || targetType === T.ALL_ENEMIES ? 999 : 14),
  effects: Object.freeze(effects ?? []), migrationStatus: extra.migrationStatus ?? ROSTER_MIGRATION_STATUS.NATIVE,
  playable: extra.playable ?? true, ...extra
});
const dmg=(min,max,opts={})=>({type:'DAMAGE',min,max,scalesWith:opts.scalesWith??'ATK',damageType:opts.damageType??D.PHYSICAL,critBonus:opts.critBonus??0,defensePenetration:opts.defensePenetration??0,dodgeable:opts.dodgeable??true,...(opts.tag?{tag:opts.tag}:{}),...(opts.to?{to:opts.to}:{})});
const STACKING_STAT_STATUS_KEYS = new Set(['atk_up','atk_down','sdm_up','sdm_down','def_up','def_down','res_up','res_down']);
const status=(key,duration,opts={})=>({type:'APPLY_STATUS',key,duration,stackMode:opts.stackMode??(STACKING_STAT_STATUS_KEYS.has(String(key).toLowerCase())?'STACK':'REFRESH'),chance:opts.chance??1,data:opts.data??{},to:opts.to??'TARGET'});
const heal=(min,max,opts={})=>({type:'HEAL',min,max,scalesWith:opts.scalesWith??'SDM',to:opts.to??'TARGET',...(Number.isFinite(opts.pctMaxHP)?{pctMaxHP:opts.pctMaxHP}:{})});

const DEFAULT_DIRECT_STATS = Object.freeze({ ATK:100, SDM:100, DEF:35, RES:35, CRIT:.025 });
function makeStats({maxHP,QKN}){ return { maxHP, hp:maxHP, ATK:DEFAULT_DIRECT_STATS.ATK, SDM:DEFAULT_DIRECT_STATS.SDM, DEF:DEFAULT_DIRECT_STATS.DEF, RES:DEFAULT_DIRECT_STATS.RES, CRIT:DEFAULT_DIRECT_STATS.CRIT, QKN }; }

const classes = {
 Warrior:{baseStats:{maxHP:1726,QKN:17},identity:'Durable frontline melee fighter; protection, taunt, sustain and strong single-target pressure.',combat:{movementMax:14,attacksMax:7,attackInterval:2},weapon:{weaponProfileId:'SWORD_SHIELD',mode:'MELEE',weaponRange:2,preferredRange:2,counterMoveMax:1,attackBaseMin:80,attackBaseMax:120},abilities:[
  ab('WARRIOR_ATTACK','Attack',0,A.BASIC_ATTACK,T.UNIT,[]),
  ab('WARHORN','Warhorn',2,A.SPELL,T.ALL_ALLIES,[{type:'TEMP_ATTACKS_MAX',amount:1,duration:4,to:'ALL_ALLIES',statusKey:'warhorn_attacks_up'},{type:'TEMP_MOVEMENT_MAX',amount:2,duration:4,to:'ALL_ALLIES',statusKey:'warhorn_movement_up'}],{note:'2-cycle team rally: all living allies gain +1 SW and +2 Movement for 4 rounds.'}),
  ab('POWER_STRIKE','Power Strike',0,A.BASIC_ATTACK,T.UNIT,[],{basicStyle:{movementMultiplier:.5,attacksDelta:-2,damageMultiplier:1.65},note:'Alternative attack style: half Movement, -2 SW, and each strike deals 165% damage.'}),
  ab('INSULT','Insult','normal',A.SPELL,T.UNIT,[status('taunt',3,{chance:.50})]),
  ab('SHIELDWALL','Shieldwall','fast',A.ABILITY,T.ALL_ALLIES,[status('physical_shield',1,{to:'ALL_ALLIES',data:{pct:.20}}),status('shield_redirect',1,{to:'SELF',data:{remaining:5,meleeOnly:true}})]),
  ab('DIG_IN','Dig In','fast',A.ABILITY,T.SELF,[status('def_up',2,{to:'SELF'}),status('physical_shield',2,{to:'SELF',data:{pct:.10}}),heal(0,0,{to:'SELF',pctMaxHP:.20})],{note:'Focus-fire deterrent: restore 20% max HP while digging in behind DEF and a physical shield.'})
 ]},
 Barbarian:{baseStats:{maxHP:1597,QKN:16},identity:'Aggressive heavy melee bruiser; reach, burst, defense break, stun and relentless pursuit.',combat:{movementMax:15,attacksMax:7,attackInterval:2},weapon:{weaponProfileId:'LONG_AXE',mode:'MELEE',weaponRange:3,preferredRange:3,counterMoveMax:1,attackBaseMin:85,attackBaseMax:120},abilities:[
  ab('BARBARIAN_ATTACK','Attack',0,A.BASIC_ATTACK,T.UNIT,[]),
  ab('BLOODLUST','Bloodlust',0,A.BASIC_ATTACK,T.UNIT,[],{basicStyle:{selfStatusOnStart:{statusKey:'bloodlust',duration:1,data:{incomingDamageMultiplier:1.25,noCounter:true}}},note:'Modified attack: pursue the chosen target with the full normal attack pool while Bloodlust suppresses counters for the round; incoming damage is increased to 125%.'}),
  ab('WAR_CRY','War Cry','normal',A.SPELL,T.ALL_ENEMIES,[dmg(70,90,{damageType:D.MAGICAL,scalesWith:'ATK',dodgeable:false,to:'ALL_ENEMIES'}),status('def_down',4,{to:'ALL_ENEMIES'})],{migrationStatus:ROSTER_MIGRATION_STATUS.PROVISIONAL,spatialPolicy:'LEGACY_GLOBAL_PENDING_REVIEW'}),
  ab('SMASH','Smashing Blows',0,A.BASIC_ATTACK,T.UNIT,[],{basicStyle:{attacksDelta:-2,damageMultiplier:1.10,onHit:{statusKey:'stun',chance:.10,duration:2}},note:'Alternative attack style: -2 attacks, 110% damage, 10% 2-round Stun per successful hit.'}),
  ab('REND','Rend',0,A.BASIC_ATTACK,T.UNIT,[],{basicStyle:{attacksSet:4,onHit:{defenseShredPct:.20,statusKey:'rend_def_down',duration:3}},note:'Alternative attack style: exactly 4 swings; successful hits stack -20% ARM for 3 rounds.'}),
  ab('RAMPAGE','Rampage','slow',A.ABILITY,T.SELF,[status('atk_up',5,{to:'SELF',stackMode:'STACK'}),status('atk_up',5,{to:'SELF',stackMode:'STACK'}),status('def_down',3,{to:'SELF',stackMode:'STACK'}),status('def_down',3,{to:'SELF',stackMode:'STACK'})],{note:'Large offensive steroid for 5 rounds with a severe 3-round defensive sacrifice.'})
 ]},
 Rogue:{baseStats:{maxHP:1300,QKN:30},identity:'High-pressure precision melee attacker; crits, poison imbues, marks and evasive disruption.',combat:{movementMax:16,attacksMax:9,attackInterval:1},weapon:{weaponProfileId:'ROGUE_BLADE',mode:'MELEE',weaponRange:1,preferredRange:1,counterMoveMax:1,attackBaseMin:55,attackBaseMax:85,critBonus:.10},abilities:[
  ab('ROGUE_ATTACK','Attack',0,A.BASIC_ATTACK,T.UNIT,[]),
  ab('BACKSTAB','Backstab',0,A.BASIC_ATTACK,T.UNIT,[],{basicStyle:{attacksSet:3,startupDelayCycles:1,captureInvisibilityAtStart:true,firstSuccessfulHit:{damageMultiplier:2.5,stealthDamageMultiplier:3.75,critBonus:.25,stealthCritBonus:.50,defensePenetration:.35}},note:'Pursuit finisher. After a 1-cycle startup, Rogue pursues normally with 3 attack attempts. The first successful hit becomes Backstab; if the action was primed from Shadowstep, that landed strike gets the massive stealth damage/crit bonus.'}),
  ab('POISON_DAGGER','Poison Imbue','normal',A.SPELL,T.SELF,[status('poison_imbue',3,{to:'SELF',data:{damageRatio:.65}})],{note:'Every successful basic hit adds Poison while active.'}),
  ab('EXPOSE','Expose','fast',A.ABILITY,T.UNIT,[{type:'STRIP_DEFENSIVE_BUFF',count:1},status('marked',2)]),
  ab('SHADOWSTEP','Shadowstep','fast',A.SPELL,T.SELF,[status('invisible',3,{to:'SELF',data:{breakOnPhysicalAttack:true,sourceAbility:'SHADOWSTEP'}}),status('shadowstep_crit',3,{to:'SELF',data:{multiplier:2.0}})],{note:'Three-round stealth setup. Shadowstep Invisibility breaks on the Rogue\'s first physical attack; the crit-amplification window is long enough to chain Shadowstep → Expose → Backstab.'}),
  ab('SMOKE_BOMB','Smoke Bomb','fast',A.ABILITY,T.ALL_ENEMIES,[status('blind',1,{to:'ALL_ENEMIES',data:{whiffChance:.50}}),heal(0,0,{to:'SELF',pctMaxHP:.15})],{migrationStatus:ROSTER_MIGRATION_STATUS.PROVISIONAL,spatialPolicy:'LEGACY_GLOBAL_PENDING_REVIEW'})
 ]},
 Cleric:{baseStats:{maxHP:1384,QKN:15},identity:'Primary restorative and defensive support with healing, poison cleansing, protection and resurrection.',combat:{movementMax:11,attacksMax:6,attackInterval:2},weapon:{weaponProfileId:'CLERIC_MACE',mode:'MELEE',weaponRange:2,preferredRange:2,counterMoveMax:1,attackBaseMin:35,attackBaseMax:60},abilities:[
  ab('CLERIC_ATTACK','Attack',0,A.BASIC_ATTACK,T.UNIT,[],{basicProc:{type:'HEAL_SELF',roundChance:.80,referenceSwings:6,maxPerRound:3,min:100,max:250,scalesWith:'SDM',label:'Prayer Mend'}}),
  ab('DEFENSIVE_AURA','Defensive Aura',2,A.SPELL,T.SELF,[{type:'HEAL_PERCENT_ROLL',minPct:.40,maxPct:.60,to:'SELF'},status('def_up',4,{to:'SELF'})],{note:'2-cycle self-only focus-fire counterplay: restore a randomized 40–60% max HP and substantially reinforce DEF.'}),
  ab('PIERCING_LIGHT','Piercing Light',3,A.SPELL,T.GROUND,[{type:'AOE_DAMAGE',min:150,max:250,damageType:D.MAGICAL,scalesWith:'SDM',defensePenetration:.30,dodgeable:false,hostileOnly:true},{type:'AOE_REMOVE_STATUS',key:'invisible',hostileOnly:true,reason:'PIERCING_LIGHT_REVEAL'}],{area:{shape:'SQUARE_5X5'},castRange:999,note:'3-cycle 5x5 holy AoE: deals 150–250 base magical damage to opposing occupants and strips Invisibility from opposing champions caught in the area.'}),
  ab('GUARDIAN_ANGEL','Guardian Angel','fast',A.SPELL,T.UNIT,[heal(100,175),status('divine_shield',1,{data:{pct:.60}})],{note:'Emergency single-target protection: heal 100–175 and grant 60% Divine Shield for the current round only.'}),
  ab('ENIDS_BLESSING',"Enid's Blessing",7,A.SPELL,T.ALL_ALLIES,[heal(100,250,{to:'ALL_ALLIES'}),{type:'CLEANSE',scope:'ALL_ALLIES',keys:['poison']}],{note:'7-cycle powerful team recovery: heal each living ally 100–250 and cleanse Poison.'}),
  ab('RESURRECTION','Resurrection','slow',A.SPELL,T.UNIT,[{type:'RESURRECT_ONLY',revivePctMaxHP:.55,cleanse:true}],{usesMax:2,usesKey:'resurrection',allowDeadTarget:true,deadTargetOnly:true,note:"Limited to 2 uses per match. Targets KO'd allied corpses only; revives at 55% max HP and cleanses statuses. Cannot target or heal living allies."}),
  ab('SUMMON_FAERY','Summon Faery','normal',A.SPELL,T.UNIT,[{type:'SUMMON_FAERY'}],{playable:false,experimental:true,targeting:{hostile:true},note:'EXPERIMENTAL / OFF-ROSTER: summon a 100-HP Faery beside the caster. Beginning next round it fires one weak battlefield-range magical bolt per round at its marked enemy; if that target dies it deterministically retargets.'})
 ]},
 Mage:{baseStats:{maxHP:1300,QKN:14},identity:'High-impact ranged magical damage and team magical protection; AoE, amplification and spell duplication.',combat:{movementMax:13,attacksMax:6,attackInterval:2},weapon:{weaponProfileId:'MAGE_DAGGER',mode:'MELEE',weaponRange:3,preferredRange:3,counterMoveMax:1,attackBaseMin:25,attackBaseMax:45},abilities:[
  ab('MAGE_ATTACK','Attack',0,A.BASIC_ATTACK,T.UNIT,[],{basicProc:{type:'STATUS',key:'stun',roundChance:.30,referenceSwings:6,maxPerRound:3,duration:2,label:'Arc Shock'}}),
  ab('ARCANE_SURGE','Arcane Surge','fast',A.SPELL,T.SELF,[status('def_up',4,{to:'SELF'}),status('sdm_up',4,{to:'SELF',stackMode:'STACK'}),status('shift',1,{to:'SELF'})],{note:'Self amplification: DEF and SDM reinforcement plus one round of Shift melee-hit teleportation.'}),
  ab('ARCANE_ECHO','Arcane Echo','normal',A.SPELL,T.SELF,[status('arcane_echo',2,{to:'SELF'})],{note:'The next spell resolves twice; the echoed second resolution deals 150% damage, then Echo is consumed.'}),
  ab('METEOR','Meteor','fast',A.SPELL,T.UNIT,[dmg(130,190,{damageType:D.MAGICAL,scalesWith:'SDM',dodgeable:false}),status('stun',2,{chance:.30})],{castRange:999,note:'Battlefield-range targeted spell; still validates the locked target at completion.'}),
  ab('ARCANE_WARD','Arcane Ward',4,A.SPELL,T.ALL_ALLIES,[status('magic_shield',5,{to:'ALL_ALLIES',data:{pct:.50}})],{note:'4-cycle team magical ward; 50% Magic Shield for 5 rounds.'}),
  ab('FIREBALL','Fireball','slow',A.SPELL,T.GROUND,[{type:'AOE_DAMAGE',min:200,max:350,scalesWith:'SDM',damageType:D.MAGICAL,hostileOnly:false}],{area:{shape:'SQUARE_5X5'},note:'Battlefield-range 5x5 ground spell with true friendly fire; locked cell remains authoritative at completion.'})
 ]},
 Paladin:{baseStats:{maxHP:1427,QKN:12},identity:'Defensive melee/support hybrid; protection, cleanse, stun and holy payoff damage.',combat:{movementMax:14,attacksMax:6,attackInterval:2},weapon:{weaponProfileId:'PALADIN_SWORD',mode:'MELEE',weaponRange:2,preferredRange:2,counterMoveMax:1,attackBaseMin:70,attackBaseMax:105},abilities:[
  ab('PALADIN_ATTACK','Attack',0,A.BASIC_ATTACK,T.UNIT,[],{basicProc:{type:'STATUS_SELF',roundChance:.90,referenceSwings:6,maxPerRound:3,key:'def_up',duration:2,label:'Resolve'}}),
  ab('SHIELD_BASH','Shield Bash',0,A.BASIC_ATTACK,T.UNIT,[],{basicStyle:{attacksSet:3,ordinaryAttackLimit:1,startupDelayCycles:1,damageMultiplier:3.0,onHit:{statusKey:'stun',chance:.35,duration:2},selfOnFirstAttack:{statusKey:'physical_shield',duration:1,data:{pct:.20}}},note:'Pursuit bash. After a 1-cycle startup, Paladin pursues normally and makes one 300% weapon attack; two remaining attack resources are reserved for normal counters. A landed bash has a 35% chance to Stun for 2 rounds, then Paladin braces behind a 20% physical shield for the rest of the round.'}),
  ab('DIVINE_SHIELD','Divine Shield','fast',A.SPELL,T.UNIT,[status('divine_shield',2,{data:{pct:.60}})]),
  ab('CLEANSE','Cleanse','normal',A.SPELL,T.UNIT,[{type:'CLEANSE',scope:'TARGET',mode:'NEGATIVE_AND_BLEED'},heal(20,40)]),
  ab('SANCTIFY','Sanctify','slow',A.SPELL,T.ALL_ALLIES,[status('ward',3,{to:'ALL_ALLIES'})],{note:'Slow team protection spell: each living ally gains one Ward charge against the next hostile status/debuff/CC.'}),
  ab('JUDGMENT','Judgment','slow',A.SPELL,T.UNIT,[{type:'CONDITIONAL_DAMAGE',min:200,max:300,scalesWith:'SDM',damageType:D.MAGICAL,defensePenetration:.25,afflictedMultiplier:2.0}],{note:'Deals 200–300 base magical damage; total damage is doubled against an afflicted target.'})
 ]},
 Archer:{baseStats:{maxHP:1300,QKN:14},identity:'Long-range physical pressure; precision, marks, ranged control and area barrages.',combat:{movementMax:12,attacksMax:7,attackInterval:2},weapon:{weaponProfileId:'LONGBOW',mode:'RANGED',weaponRange:6,preferredRange:6,counterMoveMax:3,attackBaseMin:69,attackBaseMax:106,critBonus:.08},abilities:[
  ab('ARCHER_ATTACK','Attack',0,A.BASIC_ATTACK,T.UNIT,[],{basicStyle:{damageMultiplier:0.90},note:'Standard shot: each weapon strike deals 90% of normal weapon damage.'}),
  ab('RANGERS_FOCUS',"Ranger's Focus",'fast',A.SPELL,T.UNIT,[heal(50,100,{scalesWith:'ATK'}),status('atk_up',4,{stackMode:'STACK'}),status('regen',3,{data:{pct:.10}})],{note:'1-cycle support spell: heal 50–100 (scaled by ATK), grant ATK Up for 4 rounds, and apply 3 rounds of Regen.'}),
  ab('COVER_FIRE','Cover Fire',0,A.BASIC_ATTACK,T.UNIT,[],{basicStyle:{attacksDelta:-4,targetDistribution:'BALANCED_LIVING_ENEMIES',attackRangeOverride:99,onHit:{statusKey:'blind',chance:1,duration:1,data:{whiffChance:.50}}},note:'Three covering shots distributed across living enemies before repeating a target; successful hits Blind for the rest of the round.'}),
  ab('VOLLEY','Volley','normal',A.ABILITY,T.GROUND,[{type:'AOE_DAMAGE',min:132,max:240,scalesWith:'ATK',damageType:D.PHYSICAL,hostileOnly:false,dodgeable:true}],{area:{shape:'SQUARE_5X5'},castRange:999,spatialPolicy:'5X5_LOCKED',note:'Battlefield-range 5x5 barrage dealing 132–240 base physical damage with true friendly fire.'}),
  ab('SNIPE','Snipe',0,A.BASIC_ATTACK,T.UNIT,[],{basicStyle:{attacksSet:3,damageMultiplier:2.25,attackRangeOverride:8,ordinaryKite:true,distanceDamageBonusPerSquare:.10},note:'Three long-range kiting shots at 225% base damage, plus 10% more damage per square of actual separation when each shot is fired.'}),
  ab('HUNTERS_MARK',"Hunter's Mark",4,A.SPELL,T.UNIT,[status('marked',3),status('def_down',3)],{note:'4-cycle mark: applies Marked and DEF Down for 3 rounds.'})
 ]},
 Monk:{baseStats:{maxHP:1214,QKN:26},identity:'Fast melee combatant; explosive attack-volume styles, stun pressure, reactive defense and self-recovery.',combat:{movementMax:15,attacksMax:7,attackInterval:1},weapon:{weaponProfileId:'MONK_FISTS',mode:'MELEE',weaponRange:1,preferredRange:1,counterMoveMax:1,attackBaseMin:55,attackBaseMax:65,critBonus:.10},abilities:[
  ab('MONK_ATTACK','Attack',0,A.BASIC_ATTACK,T.UNIT,[],{basicProc:{type:'STATUS_SELF',roundChance:.85,referenceSwings:7,maxPerRound:3,key:'atk_up',duration:2,label:'Opening'}}),
  ab('FLURRY','Flurry Style','slow',A.ABILITY,T.SELF,[{type:'TEMP_ATTACKS_MULTIPLIER',factor:2,duration:3,to:'SELF'},status('flurry_style',3,{to:'SELF'})],{note:'Costs the current action; then doubles the Monk attack pool for the next two full rounds.'}),
  ab('PALM_HIT','Palm Hits',0,A.BASIC_ATTACK,T.UNIT,[],{basicStyle:{attacksSet:2,ordinaryAttackLimit:2,startupDelayCycles:1,damageMultiplier:3.50,onHit:{statusKey:'stun',chance:.35,duration:2}},note:'Pursuit combo: after a 1-cycle startup, Monk pursues normally and makes two 350% Palm Hits, each with an independent 35% chance to Stun for 2 rounds.'}),
  ab('CHI_WAVE','Chi Wave','normal',A.SPELL,T.ALL_ALLIES,[{type:'CLEANSE',scope:'ALL_ALLIES',mode:'CC_AND_DEBUFFS'}]),
  ab('COUNTERSTANCE','Counterstance','fast',A.ABILITY,T.SELF,[status('counterstance',3,{to:'SELF',data:{profile:'FREE_COUNTERS',attackCost:0,allowPursuit:false,pursuitMoveMax:0}})],{note:'Parameterized native-counter override. Default experiment: counters cost no attacks; pursuit profiles are available in rule-overrides.js.'}),
  ab('SECOND_WIND','Second Wind','normal',A.ABILITY,T.SELF,[{type:'CLEANSE',scope:'SELF',mode:'CC_AND_DEBUFFS'},status('regen',3,{to:'SELF',data:{pct:.10}})],{hardControlBypass:true,note:'May start and resolve while hard-CCed; intended as the Monk escape valve.'})
 ]},
 Necromancer:{baseStats:{maxHP:1300,QKN:14},identity:'Attrition caster centered on poison buildup, life stealing, percentage damage and detonation.',combat:{movementMax:11,attacksMax:5,attackInterval:2},weapon:{weaponProfileId:'NECRO_DAGGER',mode:'MELEE',weaponRange:3,preferredRange:3,counterMoveMax:1,attackBaseMin:15,attackBaseMax:30},abilities:[
  ab('NECRO_ATTACK','Attack',0,A.BASIC_ATTACK,T.UNIT,[],{basicProc:{type:'LIFE_DRAIN',roundChance:.80,referenceSwings:5,maxPerRound:3,min:75,max:200,scalesWith:'SDM',damageType:D.MAGICAL,label:'Life Drip'}}),
  ab('LIFE_DRAIN','Life Drain','fast',A.SPELL,T.UNIT,[{type:'LIFE_DRAIN',min:150,max:300,scalesWith:'SDM'}],{note:'Deals 150–300 base magical damage (scaled by SDM) and heals the Necromancer for exactly the damage actually dealt unless healing is blocked.'}),
  ab('DEATH_TOUCH','Death Touch','slow',A.SPELL,T.UNIT,[{type:'CURRENT_HP_DAMAGE',fraction:.50}]),
  ab('POISON_BOLT','Poison Bolt','normal',A.SPELL,T.UNIT,[dmg(150,200,{damageType:D.MAGICAL,scalesWith:'SDM',critBonus:.20,dodgeable:false,tag:'POISON_BOLT'}),{type:'STRIP_BENEFICIAL',count:1},{type:'POISON_FROM_LAST_DAMAGE',ratio:.70}],{note:'Deals 150–200 base magical damage, strips one beneficial status, then adds Poison equal to 70% of damage dealt.'}),
  ab('PLAGUE','Plague',6,A.SPELL,T.ALL_ENEMIES,[{type:'POISON_FLAT_ROLL',min:100,max:160,scalesWith:'SDM',to:'ALL_ENEMIES'}],{migrationStatus:ROSTER_MIGRATION_STATUS.PROVISIONAL,spatialPolicy:'LEGACY_GLOBAL_PENDING_REVIEW',note:'6-cycle team poison spell: applies 100–160 base Poison (scaled by SDM) to all living enemies.'}),
  ab('PLAGUE_DETONATION','Plague Detonation','fast',A.SPELL,T.ALL_ENEMIES,[{type:'DETONATE_POISON_AND_RESEED',scope:'ALL_ENEMIES',reseedFraction:.50}],{migrationStatus:ROSTER_MIGRATION_STATUS.PROVISIONAL,spatialPolicy:'FOLLOWS_PLAGUE_FINAL_TARGETING',note:'Detonates all Poison, then reapplies 50% of the total detonated Poison to one random surviving enemy.'})
 ]},
 Mystic:{baseStats:{maxHP:1171,QKN:27},identity:'Control/disruption specialist with stun, berserk, defense collapse, scheduler manipulation and throwing-dagger backup.',combat:{movementMax:13,attacksMax:10,attackInterval:1},weapon:{weaponProfileId:'THROWING_DAGGER',mode:'RANGED',weaponRange:999,preferredRange:999,counterMoveMax:2,attackBaseMin:35,attackBaseMax:55,behavior:WEAPON_BEHAVIOR.THROWING_DAGGER,retargetPolicy:RETARGET_POLICY.IN_RANGE_RANDOM},abilities:[
  ab('MYSTIC_ATTACK','Attack',0,A.BASIC_ATTACK,T.UNIT,[],{basicProc:{type:'STATUS',roundChance:.75,referenceSwings:10,maxPerRound:3,key:'def_down',duration:2,label:'Guard Falter'}}),
  ab('MYSTIC_STUN','Stun','fast',A.SPELL,T.UNIT,[status('stun',3,{chance:.45})],{note:'Premier control spell: 45% chance to Stun for 3 rounds; 55% chance to fail.'}),
  ab('BERSERK','Berserk','normal',A.SPELL,T.UNIT,[status('berserk',3,{chance:.45})]),
  ab('MENTAL_BREAKDOWN','Spellbreak',2,A.SPELL,T.UNIT,[status('spellbreak',3,{chance:.80,data:{announceResist:true}})],{note:"2-cycle anti-caster disruption: 80% chance to apply Spellbreak. It cancels the target's next spell attempt; against an Arcane Echo spell it cancels only the first resolution, allowing the echoed second resolution to continue."}),
  ab('MIND_SHATTER','Psychic Pulse',3,A.SPELL,T.UNIT,[dmg(75,200,{damageType:D.MAGICAL,scalesWith:'SDM',dodgeable:false,tag:'PSYCHIC_PULSE'}),status('blind',2,{chance:.65,data:{whiffChance:.50}})],{note:'3-cycle single-target psychic blast: deals 75–200 base magical damage (scaled by SDM) and has a 65% chance to Blind for 2 rounds.'}),
  ab('PREMONITION','Premonition','fast',A.SPELL,T.ALL_ALLIES,[status('premonition',3,{to:'ALL_ALLIES',data:{cycleReduction:3}})],{note:'New non-basic actions initiated while Premonition is active complete 3 initiative cycles sooner, minimum 1. Already-charging actions are unchanged.'})
 ]},
 Shinobi:{baseStats:{maxHP:1258,QKN:24},identity:'Tight-range dexterity melee assassin; extreme dagger volume, invisibility, pursuit mobility, bleed utility and disruption.',combat:{movementMax:16,attacksMax:12,attackInterval:1},weapon:{weaponProfileId:'SHINOBI_DAGGER',mode:'MELEE',weaponRange:1,preferredRange:1,counterMoveMax:1,attackBaseMin:45,attackBaseMax:75,critBonus:.30,retargetPolicy:RETARGET_POLICY.NEAREST_IN_RANGE},abilities:[
  ab('SHINOBI_ATTACK','Attack',0,A.BASIC_ATTACK,T.UNIT,[]),
  ab('THIEFS_HASTE',"Thief's Haste",'normal',A.SPELL,T.SELF,[status('shinobi_haste',4,{to:'SELF'}),{type:'TEMP_MOVEMENT_MULTIPLIER',factor:3,duration:4,to:'SELF'}],{note:'Obnoxious pursuit counterplay: triples the Shinobi Movement pool (16→48 baseline); setup round counts against duration.'}),
  ab('INVISIBILITY','Invisibility','slow',A.SPELL,T.SELF,[status('invisible',3,{to:'SELF'})]),
  ab('BLEED_STRIKE','Bleed Imbue','normal',A.SPELL,T.SELF,[status('bleed_imbue',5,{to:'SELF',data:{chance:.15,bleedDuration:5,pct:.15}})],{note:'For five rounds, successful basic hits have a 15% chance to apply or refresh a five-round Bleed.'}),
  ab('REGEN_POTION','Regen Potion','fast',A.ITEM,T.SELF,[{type:'HEAL_PERCENT_ROLL',minPct:.35,maxPct:.60,to:'SELF'},{type:'CLEANSE',scope:'SELF',keys:['poison']}],{usesMax:3,usesKey:'potion_regen',note:'Limited to 3 uses per match. Heal 35–60% max HP and cure Poison.'}),
  ab('DISPEL','Dispel','fast',A.SPELL,T.UNIT,[{type:'DISPEL_EXCEPT',keep:['poison','bleed']}],{targeting:{anyUnit:true},note:'May target any living champion. Removes every active status except Poison and Bleed; deals no damage.'})
 ]},
 Electromancer:{baseStats:{maxHP:1214,QKN:15},identity:'Aggressive magical hybrid; electricity, stun, chain damage, self-reset, evasion and team offense.',combat:{movementMax:12,attacksMax:7,attackInterval:1},weapon:{weaponProfileId:'SHOCK_GAUNTLET',mode:'MELEE',weaponRange:2,preferredRange:2,counterMoveMax:1,attackBaseMin:18,attackBaseMax:28},abilities:[
  ab('ELECTRO_ATTACK','Attack',0,A.BASIC_ATTACK,T.UNIT,[],{basicProc:{type:'DAMAGE',roundChance:.80,referenceSwings:7,maxPerRound:3,min:30,max:45,scalesWith:'SDM',damageType:D.MAGICAL,defensePenetration:.10,label:'Lightning Bolt'}}),
  ab('ELECTRICAL_STORM','Electrical Storm','fast',A.SPELL,T.ALL_ENEMIES,[{type:'HYBRID_STORM',damage:{min:25,max:125},heal:{min:25,max:125},stunChance:.15}],{migrationStatus:ROSTER_MIGRATION_STATUS.PROVISIONAL,spatialPolicy:'LEGACY_GLOBAL_PENDING_REVIEW',note:'Damages each living enemy for 25–125 base magical damage and heals each living ally for 25–125 base healing.'}),
  ab('CHAIN_LIGHTNING','Chain Lightning','normal',A.SPELL,T.UNIT,[{type:'CHAIN_LIGHTNING',min:190,max:290,critBonus:.15,defensePenetration:.30,bounceChance:.80}]),
  ab('GOD_TEMPEST','God Tempest','normal',A.SPELL,T.SELF,[{type:'CLEANSE',scope:'SELF',mode:'NEGATIVE'},{type:'FULL_HEAL',to:'SELF'},status('sdm_up',6,{to:'SELF',stackMode:'STACK'}),status('def_up',6,{to:'SELF',stackMode:'STACK'})],{usesMax:1,usesKey:'god_tempest',note:'Limited to 1 use per match. Cleanse negative statuses, fully heal, and gain SDM Up and DEF Up for 6 rounds.'}),
  ab('SHIFT','Shift','fast',A.SPELL,T.SELF,[status('shift',4,{to:'SELF'})]),
  ab('POWER_SURGE','Power Surge','slow',A.SPELL,T.ALL_ALLIES,[status('atk_up',5,{to:'ALL_ALLIES',stackMode:'STACK'}),status('sdm_up',5,{to:'ALL_ALLIES',stackMode:'STACK'})],{note:'Team offensive surge: all living allies gain one ATK stack and one SDM stack for 5 rounds.'})
 ]}
};

for (const [id,c] of Object.entries(classes)) {
  c.id=id; c.stats=makeStats(c.baseStats);
  c.weapon={accuracy:1,critBonus:0,defensePenetration:0,damageType:D.PHYSICAL,dodgeable:true,behavior:WEAPON_BEHAVIOR.STANDARD,retargetPolicy:RETARGET_POLICY.IN_RANGE_NEAREST,...c.weapon};
  c.abilities=Object.freeze(c.abilities); Object.freeze(c.combat); Object.freeze(c.weapon); Object.freeze(c.stats); Object.freeze(c.baseStats); Object.freeze(c);
}
export const ROSTER = Object.freeze(classes);
export const ROSTER_IDS = Object.freeze(Object.keys(ROSTER));

export function getArchetype(id){ const c=ROSTER[id]; invariant(c,`Unknown archetype: ${id}`); return c; }
export function getAbility(archetypeId, abilityId){ const a=getArchetype(archetypeId).abilities.find(x=>x.id===abilityId); invariant(a,`Unknown ability ${abilityId} for ${archetypeId}`); return a; }
export function createRosterUnit({archetypeId,unitId,side,draftSlot,position}){
 const c=getArchetype(archetypeId); const limitedUses={}; for(const a of c.abilities) if(a.usesMax) limitedUses[a.usesKey??a.id]=a.usesMax;
 return createUnitState({unitId,side,draftSlot,archetypeId,stats:c.stats,position,combat:c.combat,weapon:c.weapon,limitedUses});
}
function normalizeTarget(ability,target,actorId){
 if(ability.targetType===T.SELF) return {type:T.SELF};
 if(ability.targetType===T.ALL_ALLIES) return {type:T.ALL_ALLIES};
 if(ability.targetType===T.ALL_ENEMIES) return {type:T.ALL_ENEMIES};
 invariant(target && target.type===ability.targetType,`Ability ${ability.id} requires target type ${ability.targetType}.`);
 return target;
}
export function createRosterAbilityDeclaration({roundNumber,actorId,archetypeId,abilityId,target,declarationId=`D${roundNumber}:${actorId}`}){
 const ability=getAbility(archetypeId,abilityId); invariant(ability.playable!==false,`${ability.label} is a design-gated ability and is not executable yet: ${ability.designGate??'pending design'}`);
 if(ability.actionKind===A.BASIC_ATTACK) return createActionDeclaration({declarationId,roundNumber,actorId,actionId:ability.id,actionKind:A.BASIC_ATTACK,target:normalizeTarget(ability,target,actorId),payload:{roster:{archetypeId,abilityId},basicStyle:ability.basicStyle??null}});
 const payload={roster:{archetypeId,abilityId},action:{completionDelayCycles:ability.completionDelayCycles,castRange:ability.castRange,effects:ability.effects,area:ability.area??null,usesMax:ability.usesMax??null,usesKey:ability.usesKey??null,actionClass:ability.actionKind},...(ability.targeting?{targeting:structuredClone(ability.targeting)}:{})};
 if(ability.actionKind===A.SPELL) payload.spell={...payload.action,effect:{type:'ROSTER_EFFECTS'},area:ability.area??null};
 return createActionDeclaration({declarationId,roundNumber,actorId,actionId:ability.id,actionKind:ability.actionKind,target:normalizeTarget(ability,target,actorId),payload});
}

export function validateRoster(){
 const issues=[]; const ids=new Set();
 for(const [cid,c] of Object.entries(ROSTER)){
   if(c.abilities.length<5) issues.push(`${cid}: expected at least five abilities`);
   const local=new Set(); for(const a of c.abilities){ if(local.has(a.id)) issues.push(`${cid}: duplicate ${a.id}`); local.add(a.id); if(ids.has(`${cid}:${a.id}`)) issues.push(`${cid}: duplicate global key ${a.id}`); ids.add(`${cid}:${a.id}`); if(a.actionKind!==A.BASIC_ATTACK && (!Number.isInteger(a.completionDelayCycles)||a.completionDelayCycles<1)) issues.push(`${cid}/${a.id}: invalid timing`); }
 }
 return Object.freeze({ok:issues.length===0,issues:Object.freeze(issues),archetypes:ROSTER_IDS.length,abilities:Array.from(ids).length});
}
