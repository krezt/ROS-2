import {
  ACTION_KIND, AREA_SHAPE, DAMAGE_TYPE, SIDE, TARGET_TYPE, RoundCoordinator,
  VerticalSliceClient, InMemoryMatchTransport, RecordingPresentationAdapter,
  createActionDeclaration, createBattleState, createHoldDeclaration, createUnitState,
  PRESENTATION_COMMAND
} from '../src/index.js';
function unit(unitId,side,slot,row,col,qkn,range=2){return createUnitState({unitId,side,draftSlot:slot,archetypeId:unitId,stats:{maxHP:700,hp:700,ATK:45,DEF:20,SDM:55,CRIT:.08,QKN:qkn},position:{row,col},combat:{movementMax:12,attacksMax:4,attackInterval:1},weapon:{weaponRange:range,preferredRange:range,counterMoveMax:1,attackBaseMin:35,attackBaseMax:55,accuracy:.95,critMultiplier:1.75,damageType:DAMAGE_TYPE.PHYSICAL,dodgeable:true}})}
const matchId='stage18-demo';
const state=createBattleState({matchId,board:{width:14,height:10},units:[unit('H0',SIDE.A,0,3,1,16),unit('H1',SIDE.A,1,6,1,14,8),unit('G0',SIDE.B,0,3,12,17,3),unit('G1',SIDE.B,1,6,12,13,8)]});
const basic=(a,t)=>createActionDeclaration({declarationId:`D1:${a}`,roundNumber:1,actorId:a,actionId:'BASIC',actionKind:ACTION_KIND.BASIC_ATTACK,target:{type:TARGET_TYPE.UNIT,unitId:t}});
const hold=a=>createHoldDeclaration({declarationId:`D1:${a}`,roundNumber:1,actorId:a});
const fireball=createActionDeclaration({declarationId:'D1:H1',roundNumber:1,actorId:'H1',actionId:'FIREBALL',actionKind:ACTION_KIND.SPELL,target:{type:TARGET_TYPE.GROUND,row:6,col:11},payload:{spell:{completionDelayCycles:2,castRange:20,area:{shape:AREA_SHAPE.SQUARE_3X3},effect:{type:'AOE_DAMAGE',amount:70}}}});
const coordinator=new RoundCoordinator({matchId,seedFactory:()=>0x5eed1234});
const aa=new RecordingPresentationAdapter(), ba=new RecordingPresentationAdapter();
const A=new VerticalSliceClient({side:'A',baseState:state,replayAdapter:aa});
const B=new VerticalSliceClient({side:'B',baseState:state,replayAdapter:ba});
const net=new InMemoryMatchTransport({coordinator,clientA:A,clientB:B});
console.log('A lock ->',net.lock('A',[basic('H0','G0'),fireball]));
const pkg=net.lock('B',[basic('G0','H0'),hold('G1')]);
console.log('Server seed ->',pkg.gameplaySeed,'packageHash ->',pkg.packageHash);
const result=net.simulateBoth(pkg);
console.log('Confirmation ->',result.confirmation.kind);
console.log('Digest match ->',A.lastDigest.finalStateHash===B.lastDigest.finalStateHash);
const projectile=A.lastTimeline.find(c=>c.type===PRESENTATION_COMMAND.SPELL_PROJECTILE);
console.log('Fireball board animation cue ->',projectile?.payload);
await net.replayBothAfterConfirmation();
console.log('Replayed commands A/B ->',aa.executed.length,ba.executed.length);
console.log('RNG draws/state ->',A.lastDigest.gameplayRngDrawCount,A.lastDigest.finalGameplayRngState);
