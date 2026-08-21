import {
  EVENT_TYPE,
  PhaserPresentationAdapter,
  ReplayController,
  PRESENTATION_COMMAND
} from '../src/index.js';

const events = [
  { eventId:'E000001', sequence:0, parentEventId:null, initiativeCycle:5, type:EVENT_TYPE.MOVE, actorId:'H0', targetId:'G0', payload:{ from:{row:3,col:4}, to:{row:3,col:5}, movementReason:'PURSUIT' } },
  { eventId:'E000002', sequence:1, parentEventId:null, initiativeCycle:5, type:EVENT_TYPE.ATTACK_START, actorId:'H0', targetId:'G0', payload:{ attackReason:'ORDINARY' } },
  { eventId:'E000003', sequence:2, parentEventId:'E000002', initiativeCycle:5, type:EVENT_TYPE.ATTACK_IMPACT, actorId:'H0', targetId:'G0', payload:{ damageType:'PHYSICAL' } },
  { eventId:'E000004', sequence:3, parentEventId:'E000003', initiativeCycle:5, type:EVENT_TYPE.DAMAGE, actorId:'H0', targetId:'G0', payload:{ amount:82, hpBefore:500, hpAfter:418 } },
  { eventId:'E000005', sequence:4, parentEventId:'E000002', initiativeCycle:5, type:EVENT_TYPE.COUNTER, actorId:'G0', targetId:'H0', payload:{} },
  { eventId:'E000006', sequence:5, parentEventId:'E000005', initiativeCycle:5, type:EVENT_TYPE.COUNTER_MOVE, actorId:'G0', targetId:'H0', payload:{ from:{row:3,col:7},to:{row:2,col:7},distanceBefore:2,distanceAfter:3 } }
];

const log = [];
const adapter = new PhaserPresentationAdapter({
  scene: { key: 'HeadlessDemoScene' },
  handlers: {
    '*': async ({ command }) => log.push(`${command.commandId} ${command.type} ${command.actorId ?? '-'} -> ${command.targetId ?? '-'}`),
    [PRESENTATION_COMMAND.MOVE_UNIT]: async ({ command }) => log.push(`${command.commandId} MOVE ${JSON.stringify(command.payload.from)} -> ${JSON.stringify(command.payload.to)}`)
  }
});

const replay = new ReplayController({ events, adapter });
console.log(`Authoritative events: ${events.length}`);
console.log(`Presentation commands: ${replay.length}`);
await replay.playAll();
console.log(`Replay state: ${replay.state}`);
console.log(log.join('\n'));
console.log('\nSimulation/RNG are absent from the presentation adapter by design.');
