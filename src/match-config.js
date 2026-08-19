import { SIDE } from './constants.js';
import { invariant } from './errors.js';
import { SUPPORTED_TEAM_SIZES } from './grid.js';

export const TEAM_SIZE_OPTIONS = SUPPORTED_TEAM_SIZES;

export function normalizeTeamSize(value) {
  const n=Number(value);
  invariant(Number.isInteger(n) && TEAM_SIZE_OPTIONS.includes(n),'teamSize must be an integer from 1 to 5.',{value});
  return n;
}

/**
 * ROS2 snake draft. Side A opens, then the turn direction reverses after every pair.
 * Examples:
 * 1v1: A B
 * 2v2: A B B A
 * 3v3: A B B A A B
 * 5v5: A B B A A B B A A B
 */
export function createSnakeDraftOrder(teamSize) {
  const n=normalizeTeamSize(teamSize);
  const order=[];
  let forward=true;
  while(order.length<n*2){
    const pair=forward?[SIDE.A,SIDE.B]:[SIDE.B,SIDE.A];
    for(const side of pair){
      if(order.length<n*2)order.push(side);
    }
    forward=!forward;
  }
  return Object.freeze(order);
}

export function battleSizeLabel(teamSize) {
  const n=normalizeTeamSize(teamSize);
  return `${n}v${n}`;
}
