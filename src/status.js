export function statusKey(value) {
  return String(value).toLowerCase();
}

export function findStatus(unit, key) {
  const wanted = statusKey(key);
  return unit?.statuses?.find((s) => s.key === wanted && (s.duration ?? 1) > 0) ?? null;
}

export function hasStatus(unit, key) {
  return Boolean(findStatus(unit, key));
}

export function upsertStatus(unit, status) {
  const idx = unit.statuses.findIndex((s) => s.key === status.key);
  if (idx >= 0) unit.statuses[idx] = status;
  else unit.statuses.push(status);
  return status;
}

export function removeStatus(unit, key) {
  const wanted = statusKey(key);
  const idx = unit?.statuses?.findIndex((s) => s.key === wanted) ?? -1;
  if (idx < 0) return null;
  return unit.statuses.splice(idx, 1)[0];
}
