import {
  ACTION_KIND, DAMAGE_TYPE, EVENT_TYPE, RETARGET_POLICY, SIDE, TARGET_TYPE, WEAPON_BEHAVIOR,
  createActionDeclaration, createBattleState, createCombatScheduler, createHoldDeclaration,
  createRoundSimulation, createUnitState, snapshotRoundSimulation
} from '../src/index.js';

const makeUnit = ({unitId, side, position, qkn, hp=300, movementMax=8, attacksMax=4, attackInterval=1,
  weaponRange=2, preferredRange=weaponRange, counterMoveMax=1, damage=20, mode='MELEE',
  behavior=WEAPON_BEHAVIOR.STANDARD, retargetPolicy=RETARGET_POLICY.IN_RANGE_NEAREST}) => createUnitState({
  unitId, side, draftSlot:0, archetypeId:unitId,
  stats:{maxHP:hp,hp,ATK:0,DEF:0,SDM:0,CRIT:0,QKN:qkn}, position,
  combat:{movementMax,attacksMax,attackInterval},
  weapon:{weaponProfileId:`${unitId}-weapon`,mode,weaponRange,preferredRange,counterMoveMax,
    attackBaseMin:damage,attackBaseMax:damage,accuracy:1,critBonus:0,critMultiplier:1.75,
    defensePenetration:0,damageType:DAMAGE_TYPE.PHYSICAL,dodgeable:false,behavior,retargetPolicy}
});

const attack=(a,t)=>createActionDeclaration({declarationId:`D-${a}`,roundNumber:1,actorId:a,actionId:'ATTACK',actionKind:ACTION_KIND.BASIC_ATTACK,target:{type:TARGET_TYPE.UNIT,unitId:t}});
const hold=(a)=>createHoldDeclaration({declarationId:`D-${a}-H`,roundNumber:1,actorId:a});

const shinobi = makeUnit({
  unitId:'H0', side:SIDE.A, position:{row:4,col:8}, qkn:18,
  movementMax:7, attacksMax:4, attackInterval:1,
  weaponRange:20, preferredRange:20, counterMoveMax:3, damage:24, mode:'RANGED',
  behavior:WEAPON_BEHAVIOR.THROWING_DAGGER, retargetPolicy:RETARGET_POLICY.IN_RANGE_RANDOM
});
const warrior = makeUnit({unitId:'G0',side:SIDE.B,position:{row:4,col:4},qkn:17,movementMax:8,attacksMax:4,weaponRange:2,preferredRange:2,damage:30});
const target2 = makeUnit({unitId:'G1',side:SIDE.B,position:{row:2,col:4},qkn:10,movementMax:0,attacksMax:0,weaponRange:2,damage:1});

const sim=createRoundSimulation({
  state:createBattleState({matchId:'stage8-demo',roundNumber:1,board:{width:12,height:9},units:[shinobi,warrior,target2]}),
  declarations:[attack('H0','G0'),attack('G0','H0'),hold('G1')], seed:0x808080
});
const scheduler=createCombatScheduler(sim);
for(let i=0;i<8;i++){
  const c=scheduler.advanceCycle();
  const hp=sim.state.units;
  console.log(`Cycle ${c.cycle}: H0(${hp.H0.position.row},${hp.H0.position.col}) M${hp.H0.resources.movementRemaining} A${hp.H0.resources.attacksRemaining} | G0(${hp.G0.position.row},${hp.G0.position.col}) M${hp.G0.resources.movementRemaining} A${hp.G0.resources.attacksRemaining}`);
  if(!c.madeCombatProgress && c.movementCount===0) break;
}
for(const e of sim.events.snapshot().filter(e=>[EVENT_TYPE.MOVE,EVENT_TYPE.COUNTER_MOVE,EVENT_TYPE.ATTACK_START,EVENT_TYPE.COUNTER].includes(e.type))){
  const why=e.payload?.movementReason||e.payload?.attackReason||'';
  console.log(`${e.eventId} C${e.initiativeCycle} ${e.type} ${e.actorId}->${e.targetId??'-'} ${why}`);
}
const snap=snapshotRoundSimulation(sim);
console.log('State hash:', snap.stateHash);
console.log('Event hash:', snap.eventHash);
console.log('RNG draws:', snap.rng.drawCount);
console.log('RNG final state:', snap.rng.state);
