import {
  EVENT_TYPE, SIDE, TARGET_TYPE,
  create3v3BattleState, createHoldDeclaration, createRosterAbilityDeclaration,
  createRoundSimulation, createRosterCombatScheduler, createRosterUnit,
  createBattleState, getAbility, findStatus
} from '../src/index.js';

const hold=(id)=>createHoldDeclaration({declarationId:`D1:${id}`,roundNumber:1,actorId:id});
const decl=(arch,ability,actor='H0',target={type:TARGET_TYPE.UNIT,unitId:'G0'})=>createRosterAbilityDeclaration({roundNumber:1,actorId:actor,archetypeId:arch,abilityId:ability,target});

const state=create3v3BattleState({teamA:['Archer','Shinobi','Cleric'],teamB:['Warrior','Barbarian','Rogue'],matchId:'S21.1-DEMO'});
for(const id of ['G0','G1','G2']) { state.units[id].stats.QKN=-1000; state.units[id].stats.DEF=0; }
const sim=createRoundSimulation({state,declarations:[
  decl('Archer','COVER_FIRE','H0',{type:TARGET_TYPE.UNIT,unitId:'G0'}),
  hold('H1'),hold('H2'),hold('G0'),hold('G1'),hold('G2')
],seed:0x2111});
createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:5000});
const coverTargets=sim.events.snapshot().filter(e=>e.type===EVENT_TYPE.ATTACK_START&&e.actorId==='H0').map(e=>e.targetId);

const shinobi=createRosterUnit({archetypeId:'Shinobi',unitId:'S0',side:SIDE.A,draftSlot:0,position:{row:3,col:3}});
const warrior=createRosterUnit({archetypeId:'Warrior',unitId:'W0',side:SIDE.B,draftSlot:0,position:{row:3,col:4}});
const hasteState=createBattleState({matchId:'HASTE-DEMO',units:[shinobi,warrior]});
const hasteSim=createRoundSimulation({state:hasteState,declarations:[decl('Shinobi','THIEFS_HASTE','S0',{type:TARGET_TYPE.SELF}),hold('W0')],seed:0x2112});
createRosterCombatScheduler(hasteSim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:5000});

console.log('ROS 2.0 Stage 21.1 — Thematic Combat Corrections');
console.log('Cover Fire targets:', coverTargets.join(' -> '));
console.log('Blinded:', ['G0','G1','G2'].filter(id=>findStatus(sim.state.units[id],'blind')).join(', '));
console.log('Shinobi:', {mode:shinobi.weapon.mode,range:shinobi.weapon.weaponRange,attacks:shinobi.resources.attacksMax});
console.log("Thief's Haste Movement:", hasteSim.state.units.S0.resources.movementMax);
console.log('Shield Bash:', getAbility('Paladin','SHIELD_BASH').effects);
console.log('Defensive Aura heal fraction:', getAbility('Cleric','DEFENSIVE_AURA').effects.find(e=>e.type==='HEAL').pctMaxHP);
