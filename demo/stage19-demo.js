import {
  ROSTER, ROSTER_IDS, SIDE, TARGET_TYPE, createBattleState, createHoldDeclaration,
  createRosterAbilityDeclaration, createRosterCombatScheduler, createRosterUnit,
  createRoundSimulation, validateRoster
} from '../src/index.js';

console.log('ROS 2.0 Stage 19 — Full Roster Migration');
console.log(validateRoster());
for (const id of ROSTER_IDS) {
  const c = ROSTER[id];
  console.log(`${id.padEnd(14)} QKN ${String(c.stats.QKN).padStart(2)} | Move ${c.combat.movementMax} | Attacks ${c.combat.attacksMax} | Range ${c.weapon.weaponRange} | ${c.abilities.map(a=>a.label).join(', ')}`);
}

const mage = createRosterUnit({ archetypeId:'Mage', unitId:'H0', side:SIDE.A, draftSlot:0, position:{row:5,col:1} });
const warrior = createRosterUnit({ archetypeId:'Warrior', unitId:'G0', side:SIDE.B, draftSlot:0, position:{row:5,col:8} });
const state = createBattleState({ matchId:'STAGE19-DEMO', units:[mage,warrior] });
const fireball = createRosterAbilityDeclaration({ roundNumber:1, actorId:'H0', archetypeId:'Mage', abilityId:'FIREBALL', target:{type:TARGET_TYPE.GROUND,row:5,col:8} });
const hold = createHoldDeclaration({ declarationId:'D1:G0', roundNumber:1, actorId:'G0' });
const sim = createRoundSimulation({ state, declarations:[fireball,hold], seed:0x19191919 });
createRosterCombatScheduler(sim,{countersEnabled:false}).runUntilCombatSettled({maxCycles:30});
console.log('\nFireball demo:');
console.log('Warrior HP:', sim.state.units.G0.stats.hp, '/', sim.state.units.G0.stats.maxHP);
console.log('RNG draws:', sim.rng.drawCount, 'final RNG state:', sim.rng.state);
console.log('Events:', sim.events.snapshot().map(e=>e.type).join(' -> '));
