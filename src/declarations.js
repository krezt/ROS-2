import { ACTION_KIND, ACTION_RUNTIME_STATE, TARGET_TYPE } from './constants.js';
import { invariant } from './errors.js';
import { clonePlain, deepFreeze } from './util.js';

function validateTarget(target) {
  invariant(target && typeof target === 'object', 'target is required.');
  invariant(Object.values(TARGET_TYPE).includes(target.type), 'Unknown target type.', { target });

  switch (target.type) {
    case TARGET_TYPE.UNIT:
      invariant(typeof target.unitId === 'string' && target.unitId.length > 0,
        'UNIT target requires unitId.');
      break;
    case TARGET_TYPE.GROUND:
      invariant(Number.isInteger(target.row) && Number.isInteger(target.col),
        'GROUND target requires integer row/col.');
      break;
    case TARGET_TYPE.TEAM:
      invariant(target.side === 'A' || target.side === 'B', 'TEAM target requires side A/B.');
      break;
    case TARGET_TYPE.NONE:
    case TARGET_TYPE.SELF:
    case TARGET_TYPE.ALL_ENEMIES:
    case TARGET_TYPE.ALL_ALLIES:
      break;
    default:
      break;
  }
}

export function createActionDeclaration({
  declarationId,
  roundNumber,
  actorId,
  actionId,
  actionKind,
  target = { type: TARGET_TYPE.NONE },
  payload = {}
}) {
  invariant(typeof declarationId === 'string' && declarationId.length > 0, 'declarationId is required.');
  invariant(Number.isInteger(roundNumber) && roundNumber > 0, 'roundNumber must be a positive integer.');
  invariant(typeof actorId === 'string' && actorId.length > 0, 'actorId is required.');
  invariant(typeof actionId === 'string' && actionId.length > 0, 'actionId is required.');
  invariant(Object.values(ACTION_KIND).includes(actionKind), 'Unknown actionKind.', { actionKind });
  validateTarget(target);

  return deepFreeze({
    declarationId,
    roundNumber,
    actorId,
    actionId,
    actionKind,
    target: clonePlain(target),
    payload: clonePlain(payload)
  });
}

export function createHoldDeclaration({ declarationId, roundNumber, actorId }) {
  return createActionDeclaration({
    declarationId,
    roundNumber,
    actorId,
    actionId: 'HOLD',
    actionKind: ACTION_KIND.HOLD,
    target: { type: TARGET_TYPE.NONE }
  });
}

export function createActionRuntime(declaration) {
  const unitLock = declaration.target.type === TARGET_TYPE.UNIT
    ? { unitId: declaration.target.unitId, acquiredLegally: true }
    : null;
  const groundLock = declaration.target.type === TARGET_TYPE.GROUND
    ? { row: declaration.target.row, col: declaration.target.col }
    : null;

  return {
    runtimeId: `R${declaration.roundNumber}:${declaration.actorId}`,
    declarationId: declaration.declarationId,
    actorId: declaration.actorId,
    actionId: declaration.actionId,
    actionKind: declaration.actionKind,
    state: ACTION_RUNTIME_STATE.PENDING,
    declaredPrimaryTargetId: unitLock?.unitId ?? null,
    currentForcedTargetId: null,
    targetLock: unitLock,
    groundLock,
    castStartCycle: null,
    completionCycle: null,
    interrupted: false,
    completed: false,
    metadata: {}
  };
}
