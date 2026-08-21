import {
  EVENT_TYPE,
  run3v3Playtest,
  runPlaytestBatch
} from '../src/index.js';

const opts = {
  teamA: ['Warrior', 'Shinobi', 'Mage'],
  teamB: ['Barbarian', 'Rogue', 'Electromancer'],
  maxRounds: 4,
  matchSeed: 0x20260812,
  plannerSeed: 0x5eed20,
  matchId: 'STAGE20-DEMO'
};

const a = run3v3Playtest(opts);
const b = run3v3Playtest(opts);
const same = JSON.stringify(a.rounds.map(r=>r.digest)) === JSON.stringify(b.rounds.map(r=>r.digest));

console.log('ROS 2.0 Stage 20 — Ability Redesign + 3v3 Harness');
console.log('Teams:', opts.teamA.join('/'), 'vs', opts.teamB.join('/'));
console.log('Rounds simulated:', a.rounds.length);
console.log('Outcome:', a.outcome);
console.log('Deterministic replay:', same);
console.log('Planner draws:', a.plannerDraws);
for (const round of a.rounds) {
  const teleports = round.digest.events.filter(e=>e.type===EVENT_TYPE.TELEPORT).length;
  const resolutions = round.digest.events.filter(e=>e.type===EVENT_TYPE.SPELL_RESOLUTION).length;
  console.log(`R${round.roundNumber}: seed=${round.gameplaySeed} events=${round.eventSummary.eventCount} teleports=${teleports} spellResolutions=${resolutions}`);
}

const batch = runPlaytestBatch({
  matchups: [{ name:'demo', teamA:opts.teamA, teamB:opts.teamB }],
  repetitions: 3,
  maxRounds: 4,
  matchSeed: 7000,
  plannerSeed: 8000
});
console.log('3-match batch:', batch.wins);
