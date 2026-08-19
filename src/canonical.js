import { invariant } from './errors.js';
import { isPlainObject } from './util.js';

function encode(value, path) {
  if (value === null) return 'null';

  switch (typeof value) {
    case 'string':
      return JSON.stringify(value);
    case 'boolean':
      return value ? 'true' : 'false';
    case 'number': {
      invariant(Number.isFinite(value), `Non-finite number is not canonicalizable at ${path}.`, { value });
      return Object.is(value, -0) ? '0' : JSON.stringify(value);
    }
    case 'undefined':
      throw new TypeError(`Undefined is forbidden in authoritative data at ${path}. Use null or omit the field deliberately.`);
    case 'bigint':
    case 'function':
    case 'symbol':
      throw new TypeError(`Unsupported authoritative value at ${path}: ${typeof value}.`);
    case 'object':
      break;
    default:
      throw new TypeError(`Unsupported authoritative value at ${path}: ${typeof value}.`);
  }

  if (Array.isArray(value)) {
    return `[${value.map((item, index) => encode(item, `${path}[${index}]`)).join(',')}]`;
  }

  invariant(isPlainObject(value), `Only plain objects are allowed in authoritative data at ${path}.`);
  const keys = Object.keys(value).sort();
  const body = keys.map((key) => `${JSON.stringify(key)}:${encode(value[key], `${path}.${key}`)}`).join(',');
  return `{${body}}`;
}

export function canonicalStringify(value) {
  return encode(value, '$');
}
