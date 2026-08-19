import { DAMAGE_TYPE, LIFE_STATE, PROTOCOL_VERSION, RETARGET_POLICY, RULESET_VERSION, SIDE, WEAPON_BEHAVIOR } from './constants.js';
import { invariant } from './errors.js';
import { assertFiniteNumber, assertNonNegativeInteger, assertPositiveInteger, clonePlain } from './util.js';
import { buildOccupancy, assertBattlefieldInvariants } from './grid.js';

const REQUIRED_STATS = ['maxHP', 'hp', 'ATK', 'DEF', 'SDM', 'CRIT', 'QKN'];

export function createUnitState({
  unitId,
  side,
  draftSlot,
  archetypeId,
  stats,
  position,
  combat = {},
  weapon = {},
  statuses = [],
  limitedUses = {},
  modifiers = {}
}) {
  invariant(typeof unitId === 'string' && unitId.length > 0, 'unitId is required.');
  invariant(side === SIDE.A || side === SIDE.B, 'side must be A or B.', { side });
  assertNonNegativeInteger(draftSlot, 'draftSlot');
  invariant(typeof archetypeId === 'string' && archetypeId.length > 0, 'archetypeId is required.');
  invariant(stats && typeof stats === 'object', 'stats are required.');

  for (const key of REQUIRED_STATS) assertFiniteNumber(stats[key], `stats.${key}`);
  if (stats.RES !== undefined) assertFiniteNumber(stats.RES, 'stats.RES');
  invariant(stats.maxHP > 0, 'stats.maxHP must be > 0.');
  invariant(stats.hp >= 0 && stats.hp <= stats.maxHP, 'stats.hp must be within [0, maxHP].');

  if (position !== null) {
    invariant(position && Number.isInteger(position.row) && Number.isInteger(position.col),
      'position must be null or {row, col} integers.', { position });
  }

  const lifeState = stats.hp > 0 ? LIFE_STATE.ALIVE : LIFE_STATE.DEAD;
  const movementMax = combat.movementMax ?? 0;
  const attacksMax = combat.attacksMax ?? 0;
  const attackInterval = combat.attackInterval ?? 1;
  const weaponRange = weapon.weaponRange ?? 0;
  const preferredRange = weapon.preferredRange ?? weaponRange;
  const counterMoveMax = weapon.counterMoveMax ?? 0;
  const attackBaseMin = weapon.attackBaseMin ?? 40;
  const attackBaseMax = weapon.attackBaseMax ?? 60;
  const accuracy = weapon.accuracy ?? 1;
  const critBonus = weapon.critBonus ?? 0;
  const critMultiplier = weapon.critMultiplier ?? 2;
  const defensePenetration = weapon.defensePenetration ?? 0;
  const damageType = weapon.damageType ?? DAMAGE_TYPE.PHYSICAL;
  const dodgeable = weapon.dodgeable ?? true;
  const behavior = weapon.behavior ?? WEAPON_BEHAVIOR.STANDARD;
  const retargetPolicy = weapon.retargetPolicy ?? RETARGET_POLICY.IN_RANGE_NEAREST;

  assertNonNegativeInteger(movementMax, 'combat.movementMax');
  assertNonNegativeInteger(attacksMax, 'combat.attacksMax');
  assertPositiveInteger(attackInterval, 'combat.attackInterval');
  assertNonNegativeInteger(weaponRange, 'weapon.weaponRange');
  assertNonNegativeInteger(preferredRange, 'weapon.preferredRange');
  invariant(preferredRange <= weaponRange, 'weapon.preferredRange must be <= weapon.weaponRange.', { preferredRange, weaponRange });
  assertNonNegativeInteger(counterMoveMax, 'weapon.counterMoveMax');
  assertNonNegativeInteger(attackBaseMin, 'weapon.attackBaseMin');
  assertNonNegativeInteger(attackBaseMax, 'weapon.attackBaseMax');
  invariant(attackBaseMax >= attackBaseMin, 'weapon.attackBaseMax must be >= attackBaseMin.');
  assertFiniteNumber(accuracy, 'weapon.accuracy');
  invariant(accuracy >= 0 && accuracy <= 1, 'weapon.accuracy must be within [0,1].');
  assertFiniteNumber(critBonus, 'weapon.critBonus');
  assertFiniteNumber(critMultiplier, 'weapon.critMultiplier');
  invariant(critMultiplier >= 1, 'weapon.critMultiplier must be >= 1.');
  assertFiniteNumber(defensePenetration, 'weapon.defensePenetration');
  invariant(defensePenetration >= 0 && defensePenetration <= 1, 'weapon.defensePenetration must be within [0,1].');
  invariant(damageType === DAMAGE_TYPE.PHYSICAL || damageType === DAMAGE_TYPE.MAGICAL, 'Unknown weapon.damageType.', { damageType });
  invariant(typeof dodgeable === 'boolean', 'weapon.dodgeable must be boolean.');
  invariant(Object.values(WEAPON_BEHAVIOR).includes(behavior), 'Unknown weapon.behavior.', { behavior });
  invariant(Object.values(RETARGET_POLICY).includes(retargetPolicy), 'Unknown weapon.retargetPolicy.', { retargetPolicy });

  return {
    unitId,
    side,
    draftSlot,
    archetypeId,
    lifeState,
    stats: {
      maxHP: stats.maxHP,
      hp: stats.hp,
      ATK: stats.ATK,
      DEF: stats.DEF,
      SDM: stats.SDM,
      RES: stats.RES ?? 0,
      CRIT: stats.CRIT,
      QKN: stats.QKN
    },
    position: position ? { row: position.row, col: position.col } : null,
    resources: {
      movementMax,
      movementRemaining: movementMax,
      attacksMax,
      attacksRemaining: attacksMax,
      attackInterval,
      nextOrdinaryAttackCycle: 0
    },
    weapon: {
      weaponProfileId: weapon.weaponProfileId ?? null,
      mode: weapon.mode ?? 'MELEE',
      weaponRange,
      preferredRange,
      counterMoveMax,
      attackBaseMin,
      attackBaseMax,
      accuracy,
      critBonus,
      critMultiplier,
      defensePenetration,
      damageType,
      dodgeable,
      behavior,
      retargetPolicy
    },
    statuses: clonePlain(statuses),
    limitedUses: clonePlain(limitedUses),
    modifiers: clonePlain(modifiers)
  };
}

export function createBattleState({
  matchId,
  roundNumber = 1,
  board = { width: 16, height: 11 },
  units,
  protocolVersion = PROTOCOL_VERSION,
  rulesetVersion = RULESET_VERSION
}) {
  invariant(typeof matchId === 'string' && matchId.length > 0, 'matchId is required.');
  assertPositiveInteger(roundNumber, 'roundNumber');
  assertPositiveInteger(board.width, 'board.width');
  assertPositiveInteger(board.height, 'board.height');
  invariant(Array.isArray(units) && units.length > 0, 'units must be a non-empty array.');

  const unitMap = {};
  for (const unit of units) {
    invariant(unit && typeof unit.unitId === 'string', 'Every unit must have a unitId.');
    invariant(!unitMap[unit.unitId], `Duplicate unitId: ${unit.unitId}`);
    unitMap[unit.unitId] = clonePlain(unit);
  }

  const state = {
    protocolVersion,
    rulesetVersion,
    matchId,
    roundNumber,
    board: {
      width: board.width,
      height: board.height,
      occupancy: buildOccupancy({ board, units: unitMap })
    },
    units: unitMap,
    round: {
      initiativeCycle: 0,
      eventSequence: 0,
      activeRuntimeIds: []
    },
    outcome: {
      status: 'ACTIVE',
      winner: null
    }
  };

  assertBattlefieldInvariants(state);
  return state;
}

export function cloneBattleState(state) {
  return clonePlain(state);
}
