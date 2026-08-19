export class SimulationInvariantError extends Error {
  constructor(message, details = undefined) {
    super(message);
    this.name = 'SimulationInvariantError';
    this.details = details;
  }
}

export function invariant(condition, message, details = undefined) {
  if (!condition) throw new SimulationInvariantError(message, details);
}
