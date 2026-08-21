import {
  EVENT_TYPE,
  SIDE,
  TARGET_TYPE,
  applyTimedStatus,
  createBattleState,
  createHoldDeclaration,
  createRosterAbilityDeclaration,
  createRosterCombatScheduler,
  createRosterUnit,
  createRoundSimulation,
  findStatus
} from '../src/index.js';

const u=(archetypeId,unitId,side,position)=>createRosterUnit({archetypeId,unitId,side,draftSlot:0,position});
const hold=(actorId)=>createHoldDeclaration({declarationId:`D1:${actorId}`,roundNumber:1,actorId});
const decl=(archetypeId,abilityId,actorId='H0',target={type:TARGET_TYPE.UNIT,unitId:'G0'})=>createRosterAbilityDeclaration({roundNumber:1,actorId,archetypeId,abilityId,target});

// Backstab payoff from a completed Shadowstep/Expose setup.
const state=createBattleState({matchId:'S22.1-DEMO',units:[u('Rogue','H0',SIDE.A,{row:3,col:3}),u('Warrior','G0',SIDE.B,{row:3,col:5})]});
state.units.G0.stats.QKN=-1000; state.units.G0.stats.DEF=0; state.units.G0.stats.hp=5000; state.units.G0.stats.maxHP=5000;
state.units.H0.weapon.attackBaseMin=100;state.units.H0.weapon.attackBaseMax=100;state.units.H0.stats.CRIT=.25;
state.units.H0.statuses.push({key:'invisible',duration:3,sourceId:'H0',data:{breakOnPhysicalAttack:true,sourceAbility:'SHADOWSTEP'}});
state.units.H0.statuses.push({key:'shadowstep_crit',duration:3,sourceId:'H0',data:{multiplier:2}});
state.units.G0.statuses.push({key:'marked',duration:2,sourceId:'H0',data:{}});
const sim=createRoundSimulation({state,declarations:[decl('Rogue','BACKSTAB'),hold('G0')],seed:0x221});
createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:50});
const dmg=sim.events.snapshot().find(e=>e.type===EVENT_TYPE.DAMAGE&&e.payload?.abilityId==='BACKSTAB');
console.log('Backstab damage with Shadowstep + Marked + forced crit:',dmg?.payload?.amount);
console.log('Rogue still invisible after Backstab:',Boolean(findStatus(sim.state.units.H0,'invisible')));

// Premonition: base slow 5-cycle Fireball -> 2 cycles when newly started.
const pstate=createBattleState({matchId:'PREMONITION-DEMO',units:[u('Mage','H0',SIDE.A,{row:5,col:2}),u('Warrior','G0',SIDE.B,{row:5,col:10})]});
const psim=createRoundSimulation({state:pstate,declarations:[decl('Mage','FIREBALL','H0',{type:TARGET_TYPE.GROUND,row:5,col:10}),hold('G0')],seed:0x222});
applyTimedStatus(psim,'H0',{key:'premonition',duration:3,sourceId:'H0',data:{cycleReduction:3}});
const sched=createRosterCombatScheduler(psim,{countersEnabled:false});sched.advanceCycle();
console.log('Fireball base delay:',psim.runtimes['R1:H0'].metadata.baseCompletionDelayCycles);
console.log('Fireball Premonition delay:',psim.runtimes['R1:H0'].metadata.completionDelayCycles);
