import { invariant } from './errors.js';

export function isPlainObject(value) {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function deepFreeze(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.freeze(value);
  for (const key of Object.keys(value)) deepFreeze(value[key]);
  return value;
}

export function clonePlain(value) {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(clonePlain);
  invariant(isPlainObject(value), 'Authoritative state must contain only plain JSON-like objects and arrays.');
  const out = {};
  for (const [key, child] of Object.entries(value)) out[key] = clonePlain(child);
  return out;
}

export function assertFiniteNumber(value, label) {
  invariant(typeof value === 'number' && Number.isFinite(value), `${label} must be a finite number.`, { value });
}

export function assertNonNegativeInteger(value, label) {
  invariant(Number.isInteger(value) && value >= 0, `${label} must be a non-negative integer.`, { value });
}

export function assertPositiveInteger(value, label) {
  invariant(Number.isInteger(value) && value > 0, `${label} must be a positive integer.`, { value });
}
