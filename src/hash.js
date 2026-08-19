import { canonicalStringify } from './canonical.js';

const FNV64_OFFSET = 0xcbf29ce484222325n;
const FNV64_PRIME = 0x100000001b3n;
const MASK_64 = 0xffffffffffffffffn;

export function fnv1a64String(text) {
  let hash = FNV64_OFFSET;
  // Hash UTF-8 bytes, not UTF-16 code units, so browser/Node semantics are explicit.
  const bytes = new TextEncoder().encode(String(text));
  for (const byte of bytes) {
    hash ^= BigInt(byte);
    hash = (hash * FNV64_PRIME) & MASK_64;
  }
  return hash.toString(16).padStart(16, '0');
}

export function hashCanonical(value) {
  return fnv1a64String(canonicalStringify(value));
}
