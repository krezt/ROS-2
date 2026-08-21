import { ACTION_KIND, LIFE_STATE, SIDE, TARGET_TYPE } from './constants.js';
import { createHoldDeclaration } from './declarations.js';
import { standardStartingPosition, SUPPORTED_TEAM_SIZES } from './grid.js';
import { GameplayRng } from './rng.js';
import { createRoundSimulation, snapshotRoundSimulation } from './simulation.js';
import { createBattleState, cloneBattleState } from './state.js';
import { advanceClosedRound, closeRound } from './status-engine.js';
import { canAcquireDirectHostileTarget } from './targeting.js';
import { createRosterAbilityDeclaration, createRosterUnit, getArchetype } from './roster.js';
import { createRosterCombatScheduler } from './roster-combat-scheduler.js';

const NEGATIVE_STATUS_KEYS = new Set(['stun','silence','taunt','berserk','root','suppression','spellbreak','poison','bleed','def_down','rend_def_down','marked','blind']);
const SUPPORT_EFFECTS = new Set(['HEAL','FULL_HEAL','RESURRECT_ONLY','CLEANSE']);
const HOSTILE_EFFECTS = new Set(['DAMAGE','CONDITIONAL_DAMAGE','CURRENT_HP_DAMAGE','LIFE_DRAIN','POISON_FLAT_ROLL','DETONATE_POISON','DETONATE_POISON_AND_RESEED','AOE_DAMAGE','MULTI_STRIKE','STUN_OR_DEF_DOWN','CHAIN_LIGHTNING','WEAPON_STRIKE','BACKSTAB_STRIKE','STRIP_DEFENSIVE_BUFF','STRIP_BENEFICIAL']);

function canonicalUnits(state) { return Object.values(state.units).sort((a,b)=>a.unitId.localeCompare(b.unitId)); }
function living(state, side = null) { return canonicalUnits(state).filter((u)=>u.lifeState===LIFE_STATE.ALIVE && (side===null || u.side===side)); }
function enemies(state, unit) { return living(state).filter((u)=>u.side!==unit.side); }
function allies(state, unit) { return living(state, unit.side); }

export function createTeamBattleState({
  teamA,
  teamB,
  matchId = 'PLAYTEST',
  roundNumber = 1,
  board = { width: 16, height: 11 }
}) {
  if (!Array.isArray(teamA) || !Array.isArray(teamB) || teamA.length !== teamB.length || !SUPPORTED_TEAM_SIZES.includes(teamA.length)) {
    throw new Error('ROS2 playtest teams must have the same size between 1 and 5 champions.');
  }
  const teamSize = teamA.length;
  const units = [];
  for (let i=0;i<teamSize;i++) {
    units.push(createRosterUnit({ archetypeId: teamA[i], unitId: `H${i}`, side: SIDE.A, draftSlot: i, position: standardStartingPosition({ side:SIDE.A, draftSlot:i, teamSize, board }) }));
    units.push(createRosterUnit({ archetypeId: teamB[i], unitId: `G${i}`, side: SIDE.B, draftSlot: i, position: standardStartingPosition({ side:SIDE.B, draftSlot:i, teamSize, board }) }));
  }
  return createBattleState({ matchId, roundNumber, board, units });
}

export function create3v3BattleState(options) {
  if (!Array.isArray(options?.teamA) || !Array.isArray(options?.teamB) || options.teamA.length !== 3 || options.teamB.length !== 3) {
    throw new Error('3v3 playtest requires exactly three archetypes on each team.');
  }
  return createTeamBattleState(options);
}

function distance(a,b){return Math.abs(a.position.row-b.position.row)+Math.abs(a.position.col-b.position.col);}
function nearestLegalEnemy(state, actor) {
  return enemies(state, actor)
    .filter((u)=>canAcquireDirectHostileTarget(state, actor.unitId, u.unitId))
    .sort((a,b)=>distance(actor,a)-distance(actor,b)||a.unitId.localeCompare(b.unitId))[0] ?? null;
}
function weakestAlly(state, actor){return allies(state,actor).sort((a,b)=>(a.stats.hp/a.stats.maxHP)-(b.stats.hp/b.stats.maxHP)||a.unitId.localeCompare(b.unitId))[0]??actor;}
function firstDeadAlly(state, actor){return canonicalUnits(state).filter((u)=>u.side===actor.side&&u.lifeState===LIFE_STATE.DEAD).sort((a,b)=>a.unitId.localeCompare(b.unitId))[0]??null;}

export function abilityIntent(ability) {
  if (ability.targeting?.anyUnit === true) return 'ANY';
  if (ability.actionKind === ACTION_KIND.BASIC_ATTACK) return 'ENEMY';
  if (ability.targetType === TARGET_TYPE.SELF || ability.targetType === TARGET_TYPE.ALL_ALLIES) return 'ALLY';
  if (ability.targetType === TARGET_TYPE.ALL_ENEMIES || ability.targetType === TARGET_TYPE.GROUND) return 'ENEMY';
  if (ability.allowDeadTarget) return 'ALLY_DEAD';
  let hostile = false, support = false;
  for (const effect of ability.effects ?? []) {
    if (HOSTILE_EFFECTS.has(effect.type)) hostile = true;
    if (SUPPORT_EFFECTS.has(effect.type)) support = true;
    if (effect.type === 'APPLY_STATUS') {
      if (NEGATIVE_STATUS_KEYS.has(effect.key)) hostile = true; else support = true;
    }
    if (effect.type === 'DISPEL_EXCEPT') hostile = true;
  }
  return hostile && !support ? 'ENEMY' : support && !hostile ? 'ALLY' : hostile ? 'ENEMY' : 'ALLY';
}

function groundNearEnemyFormation(state, actor) {
  const pool = enemies(state, actor);
  if (!pool.length) return null;
  // Median-ish living enemy cell gives Volley/Fireball useful multi-target testing.
  const rows = pool.map((u)=>u.position.row).sort((a,b)=>a-b);
  const cols = pool.map((u)=>u.position.col).sort((a,b)=>a-b);
  return { type: TARGET_TYPE.GROUND, row: rows[Math.floor(rows.length/2)], col: cols[Math.floor(cols.length/2)] };
}

export function targetForAbility(state, actor, ability) {
  if (ability.actionKind === ACTION_KIND.BASIC_ATTACK) {
    const enemy = nearestLegalEnemy(state, actor);
    return enemy ? { type: TARGET_TYPE.UNIT, unitId: enemy.unitId } : null;
  }
  switch (ability.targetType) {
    case TARGET_TYPE.SELF: return { type: TARGET_TYPE.SELF };
    case TARGET_TYPE.ALL_ALLIES: return { type: TARGET_TYPE.ALL_ALLIES };
    case TARGET_TYPE.ALL_ENEMIES: return { type: TARGET_TYPE.ALL_ENEMIES };
    case TARGET_TYPE.GROUND: return groundNearEnemyFormation(state, actor);
    case TARGET_TYPE.UNIT: {
      const intent = abilityIntent(ability);
      if (intent === 'ALLY_DEAD') {
        const dead = firstDeadAlly(state, actor);
        return dead ? { type: TARGET_TYPE.UNIT, unitId: dead.unitId } : null;
      }
      if (intent === 'ALLY') return { type: TARGET_TYPE.UNIT, unitId: weakestAlly(state, actor).unitId };
      if (intent === 'ANY') {
        const enemyPool=enemies(state,actor).filter(u=>canAcquireDirectHostileTarget(state,actor.unitId,u.unitId)).sort((a,b)=>(b.statuses?.length??0)-(a.statuses?.length??0)||a.unitId.localeCompare(b.unitId));
        if(enemyPool.length) return {type:TARGET_TYPE.UNIT,unitId:enemyPool[0].unitId};
        const allyPool=allies(state,actor).sort((a,b)=>(b.statuses?.length??0)-(a.statuses?.length??0)||a.unitId.localeCompare(b.unitId));
        return allyPool.length?{type:TARGET_TYPE.UNIT,unitId:allyPool[0].unitId}:null;
      }
      const enemy = nearestLegalEnemy(state, actor);
      return enemy ? { type: TARGET_TYPE.UNIT, unitId: enemy.unitId } : null;
    }
    default: return null;
  }
}

export function basicAggroPlanner({ state, roundNumber, side = null }) {
  const declarations = [];
  for (const actor of living(state, side)) {
    const archetype = getArchetype(actor.archetypeId);
    const basic = archetype.abilities.find((a)=>a.actionKind===ACTION_KIND.BASIC_ATTACK && /_ATTACK$/.test(a.id)) ?? archetype.abilities.find((a)=>a.actionKind===ACTION_KIND.BASIC_ATTACK);
    const target = nearestLegalEnemy(state, actor);
    if (!basic || !target) declarations.push(createHoldDeclaration({ declarationId:`D${roundNumber}:${actor.unitId}`, roundNumber, actorId:actor.unitId }));
    else declarations.push(createRosterAbilityDeclaration({ roundNumber, actorId:actor.unitId, archetypeId:actor.archetypeId, abilityId:basic.id, target:{type:TARGET_TYPE.UNIT,unitId:target.unitId} }));
  }
  return declarations;
}

/**
 * Deterministic but intentionally simple balance bot. Decision RNG is separate
 * from gameplay RNG so planner experimentation can never change combat rolls.
 */
export function mixedRosterPlanner({ state, roundNumber, side = null, decisionRng }) {
  const declarations = [];
  for (const actor of living(state, side)) {
    const archetype = getArchetype(actor.archetypeId);
    const playable = archetype.abilities.filter((a)=>a.playable!==false);
    const basic = playable.find((a)=>a.actionKind===ACTION_KIND.BASIC_ATTACK && /_ATTACK$/.test(a.id)) ?? playable.find((a)=>a.actionKind===ACTION_KIND.BASIC_ATTACK);
    // Weight the normal attack three times so automated matches continue to progress.
    const pool = [...playable, ...(basic?[basic,basic]:[])];
    let declaration = null;
    const offset = pool.length ? decisionRng.nextInt(0,pool.length-1,`PLANNER_PICK:R${roundNumber}:${actor.unitId}`) : 0;
    for (let i=0;i<pool.length;i++) {
      const ability = pool[(offset+i)%pool.length];
      // Avoid wasting limited-use resurrection when nobody is dead.
      if (ability.allowDeadTarget && !firstDeadAlly(state,actor)) continue;
      const target = targetForAbility(state,actor,ability);
      if (!target) continue;
      try {
        declaration = createRosterAbilityDeclaration({ roundNumber, actorId:actor.unitId, archetypeId:actor.archetypeId, abilityId:ability.id, target });
        break;
      } catch {}
    }
    if (!declaration) {
      const enemy = nearestLegalEnemy(state,actor);
      declaration = basic&&enemy
        ? createRosterAbilityDeclaration({roundNumber,actorId:actor.unitId,archetypeId:actor.archetypeId,abilityId:basic.id,target:{type:TARGET_TYPE.UNIT,unitId:enemy.unitId}})
        : createHoldDeclaration({declarationId:`D${roundNumber}:${actor.unitId}`,roundNumber,actorId:actor.unitId});
    }
    declarations.push(declaration);
  }
  return declarations;
}

function summarizeEvents(events) {
  const summary = { damageByActor:{}, healingByActor:{}, kosByActor:{}, damageTaken:{}, eventCount:events.length };
  for (const e of events) {
    if (e.type === 'DAMAGE') {
      const amount = Math.max(0,Math.trunc(e.payload?.amount??0));
      const actor=e.actorId??'ENVIRONMENT'; summary.damageByActor[actor]=(summary.damageByActor[actor]??0)+amount;
      if(e.targetId) summary.damageTaken[e.targetId]=(summary.damageTaken[e.targetId]??0)+amount;
    }
    if (e.type === 'HEAL') { const amount=Math.max(0,Math.trunc(e.payload?.amount??0));const actor=e.actorId??'ENVIRONMENT';summary.healingByActor[actor]=(summary.healingByActor[actor]??0)+amount; }
    if (e.type === 'KO') { const actor=e.actorId??'ENVIRONMENT';summary.kosByActor[actor]=(summary.kosByActor[actor]??0)+1; }
  }
  return summary;
}

export function run3v3Playtest({
  teamA,
  teamB,
  maxRounds = 12,
  matchSeed = 0x20A2026,
  plannerSeed = 0xB07B07,
  planner = mixedRosterPlanner,
  plannerA = null,
  plannerB = null,
  matchId = 'ROS2-3V3-PLAYTEST'
}) {
  let state = create3v3BattleState({teamA,teamB,matchId});
  const serverSeedRng = new GameplayRng(matchSeed);
  const decisionRngA = new GameplayRng(plannerSeed);
  const decisionRngB = new GameplayRng((plannerSeed ^ 0x9e3779b9)>>>0);
  const rounds=[];

  for(let roundIndex=0;roundIndex<maxRounds && state.outcome.status==='ACTIVE';roundIndex++) {
    const roundNumber=state.roundNumber;
    const planA=(plannerA??planner)({state,roundNumber,side:SIDE.A,decisionRng:decisionRngA}).filter((d)=>state.units[d.actorId]?.side===SIDE.A);
    const planB=(plannerB??planner)({state,roundNumber,side:SIDE.B,decisionRng:decisionRngB}).filter((d)=>state.units[d.actorId]?.side===SIDE.B);
    const declarations=[...planA,...planB];
    const gameplaySeed=serverSeedRng.nextInt(1,0xffffffff,`SERVER_ROUND_SEED:${roundNumber}`);
    const sim=createRoundSimulation({state,declarations,seed:gameplaySeed});
    const scheduler=createRosterCombatScheduler(sim);
    scheduler.runUntilCombatSettled({maxCycles:5000});
    closeRound(sim,{advanceRound:false});
    const digest=snapshotRoundSimulation(sim);
    const eventSummary=summarizeEvents(digest.events);
    const survivors={A:living(sim.state,SIDE.A).map((u)=>u.unitId),B:living(sim.state,SIDE.B).map((u)=>u.unitId)};
    rounds.push({roundNumber,gameplaySeed,digest,eventSummary,survivors,declarations});
    if(sim.state.outcome.status==='COMPLETE'){state=cloneBattleState(sim.state);break;}
    advanceClosedRound(sim);
    state=cloneBattleState(sim.state);
  }

  return {
    matchId,
    teamA:[...teamA],teamB:[...teamB],
    outcome:structuredClone(state.outcome),
    rounds,
    finalState:state,
    serverSeedDraws:serverSeedRng.drawCount,
    plannerDraws:{A:decisionRngA.drawCount,B:decisionRngB.drawCount}
  };
}

export function runPlaytestBatch({ matchups, repetitions = 10, ...options }) {
  const results=[];
  for(const matchup of matchups){
    for(let i=0;i<repetitions;i++){
      results.push(run3v3Playtest({
        ...options,
        ...matchup,
        matchSeed:((options.matchSeed??0x20A2026)+i+(results.length*2654435761))>>>0,
        plannerSeed:((options.plannerSeed??0xB07B07)+i*17+results.length)>>>0,
        matchId:`${matchup.name??'MATCHUP'}:${i}`
      }));
    }
  }
  const wins={A:0,B:0,DRAW:0,ACTIVE:0};
  for(const r of results){if(r.outcome.status!=='COMPLETE')wins.ACTIVE++;else if(r.outcome.winner==='A')wins.A++;else if(r.outcome.winner==='B')wins.B++;else wins.DRAW++;}
  return {results,wins,total:results.length};
}
