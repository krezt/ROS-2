import {
  ACTION_KIND, CONTROL_TYPE, DAMAGE_TYPE, EVENT_TYPE, SIDE, TARGET_TYPE,
  applyControlEffect, applyDetection, applySpellbreak, applyUnstoppable, applyWard,
  canAcquireDirectHostileTarget, createActionDeclaration, createBattleState,
  createHoldDeclaration, createRoundSimulation, createSpellCombatScheduler,
  createUnitState, findStatus
} from '../src/index.js';

function unit({unitId,side,position,statuses=[]}) {
  return createUnitState({unitId,side,draftSlot:0,archetypeId:unitId,
    stats:{maxHP:1000,hp:1000,ATK:0,DEF:0,SDM:0,CRIT:0,QKN:10},position,
    combat:{movementMax:8,attacksMax:3,attackInterval:1},
    weapon:{weaponProfileId:`${unitId}-w`,mode:'MELEE',weaponRange:2,preferredRange:2,counterMoveMax:1,attackBaseMin:10,attackBaseMax:10,accuracy:1,critBonus:0,critMultiplier:1.75,defensePenetration:0,damageType:DAMAGE_TYPE.PHYSICAL,dodgeable:false},statuses});
}
function hold(id){return createHoldDeclaration({declarationId:`D-${id}`,roundNumber:1,actorId:id});}
function spell(a,t){return createActionDeclaration({declarationId:`D-${a}`,roundNumber:1,actorId:a,actionId:'TEST_FIRE',actionKind:ACTION_KIND.SPELL,target:{type:TARGET_TYPE.UNIT,unitId:t},payload:{targeting:{hostile:true},spell:{completionDelayCycles:2,castRange:20,effect:{type:'DAMAGE',amount:100}}}});}

const s=createRoundSimulation({
  state:createBattleState({matchId:'STAGE22-DEMO',roundNumber:1,board:{width:14,height:10},units:[
    unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2}}),
    unit({unitId:'G0',side:SIDE.B,position:{row:3,col:5}})
  ]}), declarations:[hold('H0'),hold('G0')], seed:0x220022
});
applyWard(s,'H0',{duration:3});
applyUnstoppable(s,'H0',{duration:2});
const blocked=applyControlEffect(s,'H0',{type:CONTROL_TYPE.STUN,sourceId:'G0',duration:2});
console.log('Stun result:',blocked.reason,'| Ward preserved:',Boolean(findStatus(s.state.units.H0,'ward')));

const detectState=createBattleState({matchId:'DETECT',roundNumber:1,board:{width:14,height:10},units:[
  unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2},statuses:[{key:'detection',duration:2,sourceId:'H0',data:{}}]}),
  unit({unitId:'G0',side:SIDE.B,position:{row:3,col:5},statuses:[{key:'invisible',duration:2,sourceId:'G0',data:{}}]})
]});
console.log('Detection acquires Invisible:',canAcquireDirectHostileTarget(detectState,'H0','G0'));

const spellSim=createRoundSimulation({
  state:createBattleState({matchId:'SPELLBREAK',roundNumber:1,board:{width:14,height:10},units:[
    unit({unitId:'H0',side:SIDE.A,position:{row:3,col:2}}),
    unit({unitId:'G0',side:SIDE.B,position:{row:3,col:5}})
  ]}), declarations:[spell('H0','G0'),hold('G0')], seed:0x22
});
applySpellbreak(spellSim,'H0',{duration:3,sourceId:'G0'});
createSpellCombatScheduler(spellSim).runUntilCombatSettled({maxCycles:20});
console.log('Spellbreak interrupted cast:',spellSim.events.snapshot().some(e=>e.type===EVENT_TYPE.CAST_INTERRUPT&&e.payload.reason==='SPELLBREAK'));
console.log('Target HP after broken spell:',spellSim.state.units.G0.stats.hp);
