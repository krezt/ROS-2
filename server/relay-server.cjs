const http = require('http');
const crypto = require('crypto');
const path = require('path');
const { WebSocketServerLite, OPEN } = require('./ws-lite.cjs');
const { RankedLadder } = require('./ranked-ladder.cjs');
const { createSupabaseStoreFromEnv } = require('./ranked-store.cjs');

(async () => {
  const { RoundCoordinator, MatchRoom } = await import('../src/round-coordinator.js');
  const { PROTOCOL_VERSION, RULESET_VERSION } = await import('../src/constants.js');
  const { createNetworkDraftState, applyNetworkDraftAction, networkDraftSnapshot, networkDraftComplete } = await import('./network-draft.mjs');
  const ladderFile=process.env.ROS2_LADDER_FILE||path.join(__dirname,'data','ranked-ladder.json');
  const rankedLadder=new RankedLadder({filePath:ladderFile});
  const durableFile=String(process.env.ROS2_LADDER_DURABLE_FILE??'').toLowerCase()==='true';
  const requireDurableRanked=String(process.env.ROS2_REQUIRE_DURABLE_RANKED??(process.env.RENDER?'true':'false')).toLowerCase()==='true';
  const supabaseConfiguredIntent=Boolean(String(process.env.SUPABASE_URL??'').trim()||String(process.env.SUPABASE_SECRET_KEY??'').trim()||String(process.env.SUPABASE_SERVICE_ROLE_KEY??'').trim());
  let remoteLadderStore=null,remoteLadderHydrated=false,remoteLadderStatus={configured:false,loaded:false,persisted:false,verified:false,lastVerifiedAt:null,error:null};
  try{
    remoteLadderStore=createSupabaseStoreFromEnv(process.env);
    if(remoteLadderStore){
      const hydrated=await rankedLadder.hydrateFromRemote(remoteLadderStore);
      remoteLadderHydrated=true;remoteLadderStatus={...remoteLadderStatus,...hydrated,persisted:true,verified:true,lastVerifiedAt:new Date().toISOString(),error:null};
      console.log(`[RANKED] durable Supabase storage enabled (${remoteLadderStore.table}/${remoteLadderStore.rowId})`);
    }else if(process.env.RENDER){
      console.warn('[RANKED] WARNING: Render local files are ephemeral. Configure SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY (recommended for Free) or a paid persistent disk, otherwise standings can disappear after spin-down/restart.');
    }
  }catch(err){
    remoteLadderStatus={configured:true,loaded:false,persisted:false,verified:false,lastVerifiedAt:null,error:err.message||'REMOTE_LADDER_INIT_FAILED'};
    console.warn(`[RANKED] durable storage initialization failed: ${remoteLadderStatus.error}`);
  }
  const rankedPersistence=()=>{const remoteHealthy=remoteLadderStore?(remoteLadderHydrated&&remoteLadderStatus.verified&&!remoteLadderStatus.error):false;const remoteFailed=supabaseConfiguredIntent&&!remoteHealthy;return {mode:remoteLadderStore?'supabase':(supabaseConfiguredIntent?'supabase-error':(durableFile?'persistent-file':'file')),required:requireDurableRanked,durable:remoteLadderStore?remoteHealthy:(remoteFailed?false:durableFile),remoteConfigured:supabaseConfiguredIntent||!!remoteLadderStatus.configured,remoteHealthy,verified:!!remoteLadderStatus.verified,lastVerifiedAt:remoteLadderStatus.lastVerifiedAt??null,revision:rankedLadder.data?.persistenceRevision??0,error:remoteLadderStatus.error};};
  const ensureRankedStorage=()=>{const p=rankedPersistence();if(requireDurableRanked&&!p.durable)throw new Error('RANKED_STORAGE_UNAVAILABLE');return p;};

  const server = http.createServer((req,res)=>{
    const pathname=new URL(req.url,'http://localhost').pathname;
    res.setHeader('access-control-allow-origin','*');
    if(pathname==='/health'){res.setHeader('content-type','application/json; charset=utf-8');res.writeHead(200);res.end(JSON.stringify({ok:true,protocol:'ros2-protocol-1',stage:'25U',rankedLadder:true,separateFormatRatings:true,championWinRates:true,rankedDraws:true,drawProposals:true,rankedPersistence:rankedPersistence()}));return;}
    if(pathname==='/rankings'){res.setHeader('content-type','application/json; charset=utf-8');res.writeHead(200);res.end(JSON.stringify({...rankedLadder.snapshot(),persistence:rankedPersistence()}));return;}
    if(pathname==='/'){res.setHeader('content-type','text/plain; charset=utf-8');res.writeHead(200);res.end('ROS 2.0 coordinator OK — Stage 25U verified ranked persistence');return;}
    res.setHeader('content-type','application/json; charset=utf-8');res.writeHead(404);res.end(JSON.stringify({ok:false,error:'NOT_FOUND'}));
  });
  const wss=new WebSocketServerLite({server,path:'/ws'}),rooms=new Map();let serverSequence=0;
  const nextSequence=()=>++serverSequence;
  const randId=(len=8)=>crypto.randomBytes(8).toString('base64url').slice(0,len);
  function normalizeTeamSize(value){const n=Number(value);if(!Number.isInteger(n)||n<1||n>5)throw new Error('INVALID_TEAM_SIZE');return n;}
  function normalizeDraftBans(value){const n=Number(value??0);if(n!==0&&n!==1)throw new Error('INVALID_DRAFT_BANS');return n;}
  function normalizeReplaySpeed(value){const n=Number(value??0.33);if(![0.25,0.33,0.5].includes(n))throw new Error('INVALID_REPLAY_SPEED');return n;}
  function normalizeRanked(value){return value===true;}
  function normalizeChatText(value){return String(value??'').replace(/[\u0000-\u001f\u007f]/g,' ').replace(/\s+/g,' ').trim().slice(0,240);}
  function normalizePlayerName(value){return String(value??'Player').replace(/[<>&\u0000-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim().slice(0,20)||'Player';}
  function rankedNameAllowed(value){const name=normalizePlayerName(value);return name.length>=2&&name.toLowerCase()!=='player';}
  function normalizeRoomConfig(input={}){return Object.freeze({teamSize:normalizeTeamSize(input.teamSize??3),draftBansPerPlayer:normalizeDraftBans(input.draftBansPerPlayer??0),replaySpeed:normalizeReplaySpeed(input.replaySpeed??0.33),ranked:normalizeRanked(input.ranked)});}
  function send(ws,obj){if(ws?.readyState===OPEN)ws.send(JSON.stringify(obj));}
  function broadcastRoom(room,obj){for(const ws of room.sockets.values())send(ws,obj);}
  function phaseOf(room){if(room.matchComplete)return 'POST_MATCH';if(room.coordinator)return 'IN_MATCH';if(room.draft)return 'DRAFT';return room.configLocked?'LOCKED':'WAITING';}
  function playerNames(room){const names={};for(const peer of room.sockets.values())if(peer._side)names[peer._side]=normalizePlayerName(peer._displayName);return names;}
  function roomSummary(room){const teamSize=room.config.teamSize,names=playerNames(room);return{id:room.id,hostName:names.A??'Player',players:room.matchRoom.players.size,maxPlayers:2,started:!!room.coordinator,configLocked:room.configLocked,teamSize,format:`${teamSize}v${teamSize}`,draftBansPerPlayer:room.config.draftBansPerPlayer,replaySpeed:room.config.replaySpeed,ranked:!!room.config.ranked,draftPhase:room.draft?.phase??null,matchNumber:room.matchNumber,status:phaseOf(room)};}
  function broadcastRooms(){const payload={kind:'rooms',rooms:[...rooms.values()].map(roomSummary),serverSequence:nextSequence()};for(const ws of wss.clients)send(ws,payload);}
  function createRoom(id=randId(),config={}){if(rooms.has(id))throw new Error('ROOM_EXISTS');const room={id,matchRoom:new MatchRoom({id}),sockets:new Map(),coordinator:null,draft:null,matchId:null,matchNumber:0,timeoutsRemaining:{A:3,B:3},config:normalizeRoomConfig(config),configLocked:false,roundReadySides:new Set(),matchCompleteReports:new Map(),matchComplete:null,matchPlayerNames:null,matchTeams:null,rematchVotes:new Set(),drawProposal:null};rooms.set(id,room);return room;}
  function broadcastDraftState(room){if(room.draft)broadcastRoom(room,{kind:'draft_state',roomId:room.id,config:{...room.config},state:networkDraftSnapshot(room.draft),serverSequence:nextSequence()});}
  function beginNetworkDraft(room,{rematch=false}={}){if(!room.configLocked||!room.matchRoom.isReady())throw new Error('ROOM_NOT_READY');if(room.draft||room.coordinator)return;room.draft=createNetworkDraftState(room.config);if(rematch)broadcastRoom(room,{kind:'rematch_start',roomId:room.id,config:{...room.config},matchNumber:room.matchNumber+1,serverSequence:nextSequence()});broadcastDraftState(room);broadcastRooms();}
  function resetRoundHandshake(room){room.roundReadySides.clear();room.matchCompleteReports.clear();}
  function finalizeNetworkDraft(room){if(!room.draft||!networkDraftComplete(room.draft))throw new Error('DRAFT_NOT_COMPLETE');if(room.coordinator)return;room.matchNumber+=1;room.matchId=`${room.id}-M${room.matchNumber}-${randId(6)}`;room.coordinator=new RoundCoordinator({matchId:room.matchId,protocolVersion:PROTOCOL_VERSION,rulesetVersion:RULESET_VERSION});room.timeoutsRemaining={A:3,B:3};room.matchComplete=null;room.matchPlayerNames=Object.freeze({...playerNames(room)});room.rematchVotes.clear();room.drawProposal=null;resetRoundHandshake(room);const snapshot=networkDraftSnapshot(room.draft);room.matchTeams=Object.freeze({A:Object.freeze([...snapshot.picks.A]),B:Object.freeze([...snapshot.picks.B])});broadcastRoom(room,{kind:'draft_complete',roomId:room.id,state:snapshot,serverSequence:nextSequence()});broadcastRoom(room,{kind:'match_started',roomId:room.id,matchId:room.matchId,matchNumber:room.matchNumber,config:{...room.config},teamA:[...snapshot.picks.A],teamB:[...snapshot.picks.B],timeoutsRemaining:{...room.timeoutsRemaining},playerNames:{...room.matchPlayerNames},roundNumber:1,serverSequence:nextSequence()});broadcastRooms();}
  function handleDraftAction(ws,room,msg){if(!room.configLocked||!room.draft)throw new Error('DRAFT_NOT_STARTED');if(room.coordinator)throw new Error('DRAFT_ALREADY_COMPLETE');applyNetworkDraftAction(room.draft,{side:ws._side,kind:msg.kind,archetype:msg.archetype});broadcastDraftState(room);if(networkDraftComplete(room.draft))finalizeNetworkDraft(room);}
  function clearRoomMembership(ws){ws._roomId=null;ws._side=null;}
  function leave(ws,reason='PLAYER_LEFT'){const room=ws._roomId?rooms.get(ws._roomId):null;if(!room){clearRoomMembership(ws);return;}const departedSide=room.matchRoom.removePlayer(ws._playerId);room.sockets.delete(ws._playerId);clearRoomMembership(ws);if(room.configLocked||departedSide==='A'){const during=phaseOf(room);for(const peer of room.sockets.values()){send(peer,{kind:'opponent_disconnected',roomId:room.id,during,configLocked:true,canRematch:false,serverSequence:nextSequence()});send(peer,{kind:'room_closed',roomId:room.id,reason,serverSequence:nextSequence()});clearRoomMembership(peer);}rooms.delete(room.id);return;}if(room.sockets.size===0)rooms.delete(room.id);}
  function join(ws,room){if(room.configLocked||room.matchRoom.players.size>=2)throw new Error('ROOM_FULL');if(room.config.ranked){ensureRankedStorage();if(!rankedNameAllowed(ws._displayName))throw new Error('RANKED_NAME_REQUIRED');const incoming=normalizePlayerName(ws._displayName).toLowerCase();if(Object.values(playerNames(room)).some(name=>normalizePlayerName(name).toLowerCase()===incoming))throw new Error('RANKED_NAME_IN_USE');}leave(ws,'JOINED_OTHER_ROOM');const side=room.matchRoom.addPlayer(ws._playerId);room.sockets.set(ws._playerId,ws);ws._roomId=room.id;ws._side=side;if (room.matchRoom.isReady()) room.configLocked = true;send(ws,{kind:'room_joined',roomId:room.id,side,config:{...room.config},configLocked:room.configLocked,players:room.matchRoom.players.size,playerNames:playerNames(room),serverSequence:nextSequence()});if(room.configLocked){broadcastRoom(room,{kind:'room_locked',roomId:room.id,config:{...room.config},players:2,playerNames:playerNames(room),message:'Lobby configuration locked. Network draft begins.',serverSequence:nextSequence()});beginNetworkDraft(room);}broadcastRooms();}
  function updateRoomConfig(ws,room,msg){if(ws._side!=='A')throw new Error('ONLY_HOST_MAY_CONFIGURE');if(room.configLocked||room.matchRoom.players.size!==1)throw new Error('ROOM_CONFIG_LOCKED');room.config=normalizeRoomConfig({teamSize:msg.teamSize??room.config.teamSize,draftBansPerPlayer:msg.draftBansPerPlayer??room.config.draftBansPerPlayer,replaySpeed:msg.replaySpeed??room.config.replaySpeed,ranked:room.config.ranked});broadcastRoom(room,{kind:'room_config_updated',roomId:room.id,config:{...room.config},configLocked:false,serverSequence:nextSequence()});broadcastRooms();}
  function validateConfirmedHashes(room,msg){const c=room.coordinator;if(!c||c.status!=='CONFIRMED'||!c.confirmation)throw new Error('ROUND_NOT_CONFIRMED');if(Number(msg.roundNumber)!==c.roundNumber)throw new Error('ROUND_NUMBER_MISMATCH');if(msg.finalStateHash&&msg.finalStateHash!==c.confirmation.finalStateHash)throw new Error('FINAL_STATE_HASH_MISMATCH');if(msg.eventStreamHash&&msg.eventStreamHash!==c.confirmation.eventStreamHash)throw new Error('EVENT_STREAM_HASH_MISMATCH');return c;}
  function handleRoundReady(ws,room,msg){const c=validateConfirmedHashes(room,msg);if(room.matchCompleteReports.size>0||room.matchComplete)throw new Error('MATCH_COMPLETION_IN_PROGRESS');room.roundReadySides.add(ws._side);broadcastRoom(room,{kind:'round_ready_status',roomId:room.id,roundNumber:c.roundNumber,readySides:[...room.roundReadySides].sort(),serverSequence:nextSequence()});if(room.roundReadySides.size<2)return;const n=c.nextRound();resetRoundHandshake(room);broadcastRoom(room,{kind:'round_open',roundNumber:n,serverSequence:nextSequence()});}
  async function persistRankedDurably(matchId){
    if(!remoteLadderStore)return rankedPersistence();
    let lastError=null;
    for(let attempt=1;attempt<=3;attempt+=1){
      try{
        const verified=await rankedLadder.persistRemote(remoteLadderStore);
        remoteLadderHydrated=true;
        remoteLadderStatus={...remoteLadderStatus,persisted:true,verified:true,lastVerifiedAt:new Date().toISOString(),error:null};
        return {...rankedPersistence(),saveAttempts:attempt,verifiedRevision:verified?.revision??rankedLadder.data?.persistenceRevision??0};
      }catch(err){
        lastError=err;
        remoteLadderStatus={...remoteLadderStatus,persisted:false,verified:false,error:err.message||'REMOTE_LADDER_SAVE_FAILED'};
        console.warn(`[RANKED] durable save attempt ${attempt}/3 failed for ${matchId}: ${remoteLadderStatus.error}`);
        if(attempt<3)await new Promise(resolve=>setTimeout(resolve,250*attempt));
      }
    }
    return {...rankedPersistence(),saveAttempts:3,error:lastError?.message||remoteLadderStatus.error||'REMOTE_LADDER_SAVE_FAILED'};
  }
  async function broadcastRankedResult(room,{winnerSide,draw=false}){
    if(!room.config.ranked)return null;
    const names=room.matchPlayerNames??playerNames(room),format=`${room.config.teamSize}v${room.config.teamSize}`,teams=room.matchTeams??{A:[],B:[]};
    const rankedResult=rankedLadder.recordMatch({matchId:room.matchId,format,playerA:names.A,playerB:names.B,winnerSide,teamA:teams.A,teamB:teams.B});
    let persistence={...rankedPersistence()};
    if(rankedResult.recorded&&remoteLadderStore)persistence=await persistRankedDurably(room.matchId);
    if(rankedResult.recorded&&requireDurableRanked&&!persistence.durable){
      const failure={kind:'ranked_storage_error',roomId:room.id,matchId:room.matchId,format,error:persistence.error||'RANKED_STORAGE_UNAVAILABLE',persistence,serverSequence:nextSequence()};
      broadcastRoom(room,failure);
      console.error(`[RANKED] RESULT NOT DURABLY VERIFIED for ${room.matchId}; future Ranked entry is blocked until storage recovers.`);
      return {...rankedResult,persistence,durableRecorded:false};
    }
    if(rankedResult.recorded){const update={kind:'rankings_updated',standings:rankedResult.standings,persistence,serverSequence:nextSequence()};for(const peer of wss.clients)send(peer,update);}
    broadcastRoom(room,{kind:'ranked_match_recorded',roomId:room.id,matchId:room.matchId,format,winner:draw?null:winnerSide,draw,playerNames:{...names},standings:rankedResult.standings,persistence,serverSequence:nextSequence()});
    return {...rankedResult,persistence,durableRecorded:!requireDurableRanked||persistence.durable};
  }
  async function handleMatchComplete(ws,room,msg){
    const c=validateConfirmedHashes(room,msg),winner=String(msg.winner??'');if(winner!=='A'&&winner!=='B')throw new Error('INVALID_MATCH_WINNER');
    const report=Object.freeze({side:ws._side,roundNumber:c.roundNumber,winner,finalStateHash:c.confirmation.finalStateHash,eventStreamHash:c.confirmation.eventStreamHash});room.matchCompleteReports.set(ws._side,report);
    send(ws,{kind:'match_complete_received',roundNumber:c.roundNumber,waitingForOpponent:room.matchCompleteReports.size<2,serverSequence:nextSequence()});if(room.matchCompleteReports.size<2)return;
    const a=room.matchCompleteReports.get('A'),b=room.matchCompleteReports.get('B');if(a.winner!==b.winner||a.finalStateHash!==b.finalStateHash||a.eventStreamHash!==b.eventStreamHash){broadcastRoom(room,{kind:'match_desync',reason:'MATCH_COMPLETE_REPORT_MISMATCH',serverSequence:nextSequence()});c.halt('MATCH_COMPLETE_REPORT_MISMATCH');return;}
    room.drawProposal=null;room.matchComplete=Object.freeze({matchId:room.matchId,matchNumber:room.matchNumber,roundNumber:c.roundNumber,winner:a.winner,draw:false,finalStateHash:a.finalStateHash,eventStreamHash:a.eventStreamHash});
    await broadcastRankedResult(room,{winnerSide:a.winner,draw:false});
    broadcastRoom(room,{kind:'match_complete_confirmed',roomId:room.id,...room.matchComplete,ranked:!!room.config.ranked,rematchAvailable:true,serverSequence:nextSequence()});broadcastRooms();
  }
  async function finalizeAgreedDraw(room){
    if(room.matchComplete)throw new Error('MATCH_ALREADY_COMPLETE');const c=room.coordinator;if(!c)throw new Error('MATCH_NOT_STARTED');
    const proposal=room.drawProposal;if(!proposal)throw new Error('NO_DRAW_PROPOSAL');room.drawProposal=null;c.halt('DRAW_AGREED');room.roundReadySides.clear();room.matchCompleteReports.clear();
    room.matchComplete=Object.freeze({matchId:room.matchId,matchNumber:room.matchNumber,roundNumber:c.roundNumber,winner:null,draw:true,finalStateHash:c.confirmation?.finalStateHash??null,eventStreamHash:c.confirmation?.eventStreamHash??null});
    await broadcastRankedResult(room,{winnerSide:'DRAW',draw:true});
    broadcastRoom(room,{kind:'draw_accepted',roomId:room.id,acceptedBy:proposal.proposedBy==='A'?'B':'A',proposedBy:proposal.proposedBy,serverSequence:nextSequence()});
    broadcastRoom(room,{kind:'match_complete_confirmed',roomId:room.id,...room.matchComplete,ranked:!!room.config.ranked,rematchAvailable:true,serverSequence:nextSequence()});broadcastRooms();
  }
  async function handleDrawProposal(ws,room){
    const c=room.coordinator;if(!c)throw new Error('MATCH_NOT_STARTED');if(room.matchComplete)throw new Error('MATCH_ALREADY_COMPLETE');if(c.status!=='COLLECTING')throw new Error('DRAW_PROPOSAL_ONLY_DURING_PLANNING');if(c.submissions.size>0)throw new Error('DRAW_PROPOSAL_ONLY_BEFORE_LOCK');
    if(room.drawProposal){if(room.drawProposal.proposedBy!==ws._side)return await finalizeAgreedDraw(room);throw new Error('DRAW_PROPOSAL_PENDING');}
    room.drawProposal=Object.freeze({proposedBy:ws._side,createdAt:Date.now()});broadcastRoom(room,{kind:'draw_proposed',roomId:room.id,proposedBy:ws._side,playerNames:{...(room.matchPlayerNames??playerNames(room))},serverSequence:nextSequence()});
  }
  async function handleDrawResponse(ws,room,msg){
    const proposal=room.drawProposal;if(!proposal)throw new Error('NO_DRAW_PROPOSAL');if(proposal.proposedBy===ws._side)throw new Error('DRAW_PROPOSER_CANNOT_RESPOND');
    if(msg.accept===true)return await finalizeAgreedDraw(room);
    room.drawProposal=null;broadcastRoom(room,{kind:'draw_declined',roomId:room.id,declinedBy:ws._side,serverSequence:nextSequence()});
  }
  function handleRematchRequest(ws,room){if(!room.matchComplete)throw new Error('REMATCH_NOT_AVAILABLE');if(!room.matchRoom.isReady())throw new Error('ROOM_NOT_READY');room.rematchVotes.add(ws._side);broadcastRoom(room,{kind:'rematch_status',roomId:room.id,votes:[...room.rematchVotes].sort(),required:2,serverSequence:nextSequence()});if(room.rematchVotes.size<2)return;room.coordinator=null;room.draft=null;room.matchId=null;room.matchComplete=null;room.matchTeams=null;room.rematchVotes.clear();room.drawProposal=null;resetRoundHandshake(room);beginNetworkDraft(room,{rematch:true});}

  wss.on('connection',ws=>{
    ws._playerId=randId(12);ws._roomId=null;ws._side=null;ws._displayName='Player';ws._lastChatAt=0;ws.isAlive=true;send(ws,{kind:'hello_ack',playerId:ws._playerId,serverSequence:nextSequence()});ws.on('pong',()=>{ws.isAlive=true;});
    ws.on('message',async raw=>{let msg;try{msg=JSON.parse(String(raw));}catch{return send(ws,{kind:'error',code:'BAD_JSON',serverSequence:nextSequence()});}try{
      if(msg.kind==='list_rooms')return send(ws,{kind:'rooms',rooms:[...rooms.values()].map(roomSummary),serverSequence:nextSequence()});
      if(msg.kind==='get_rankings')return send(ws,{kind:'rankings',standings:rankedLadder.snapshot(),persistence:rankedPersistence(),serverSequence:nextSequence()});
      if(msg.kind==='set_player_name'){const namedRoom=ws._roomId?rooms.get(ws._roomId):null;if(namedRoom?.config?.ranked&&namedRoom.configLocked)throw new Error('RANKED_NAME_LOCKED');ws._displayName=normalizePlayerName(msg.playerName);if(namedRoom){broadcastRoom(namedRoom,{kind:'player_names',roomId:namedRoom.id,playerNames:playerNames(namedRoom),serverSequence:nextSequence()});broadcastRooms();}return;}
      if(msg.kind==='create_room'){ws._displayName=normalizePlayerName(msg.playerName??ws._displayName);if(msg.ranked===true)ensureRankedStorage();if(msg.ranked===true&&!rankedNameAllowed(ws._displayName))throw new Error('RANKED_NAME_REQUIRED');const room=createRoom(msg.id?String(msg.id):undefined,{teamSize:msg.teamSize,draftBansPerPlayer:msg.draftBansPerPlayer,replaySpeed:msg.replaySpeed,ranked:msg.ranked});join(ws,room);return;}
      if(msg.kind==='join_room'){ws._displayName=normalizePlayerName(msg.playerName??ws._displayName);const room=rooms.get(String(msg.id||''));if(!room)throw new Error('ROOM_NOT_FOUND');join(ws,room);return;}
      if(msg.kind==='leave_room'){leave(ws,'PLAYER_LEFT');broadcastRooms();return;}
      const room=ws._roomId?rooms.get(ws._roomId):null;
      if(msg.kind==='chat_message'){
        if(!room)throw new Error('NOT_IN_ROOM');
        const text=normalizeChatText(msg.text);if(!text)throw new Error('EMPTY_CHAT_MESSAGE');
        const now=Date.now();if(now-ws._lastChatAt<250)throw new Error('CHAT_RATE_LIMIT');ws._lastChatAt=now;
        broadcastRoom(room,{kind:'chat_message',roomId:room.id,side:ws._side,name:normalizePlayerName(ws._displayName),text,sentAt:now,serverSequence:nextSequence()});return;
      }
      if(msg.kind==='update_room_config'){if(!room)throw new Error('NOT_IN_ROOM');updateRoomConfig(ws,room,msg);return;}
      if(msg.kind==='draft_ban'||msg.kind==='draft_pick'){if(!room)throw new Error('NOT_IN_ROOM');handleDraftAction(ws,room,msg);return;}
      if(msg.kind==='request_rematch'){if(!room)throw new Error('NOT_IN_ROOM');handleRematchRequest(ws,room);return;}
      if(msg.kind==='propose_draw'){if(!room)throw new Error('NOT_IN_ROOM');await handleDrawProposal(ws,room);return;}
      if(msg.kind==='respond_draw'){if(!room)throw new Error('NOT_IN_ROOM');await handleDrawResponse(ws,room,msg);return;}
      if(!room||!room.coordinator)throw new Error('MATCH_NOT_STARTED');const c=room.coordinator;if(room.matchComplete)throw new Error('MATCH_ALREADY_COMPLETE');
      if(msg.kind==='selection_timeout_request'){if(c.status!=='COLLECTING')throw new Error('TIMEOUT_NOT_AVAILABLE');if(c.submissions.has(ws._side))throw new Error('SIDE_ALREADY_LOCKED');const remaining=room.timeoutsRemaining[ws._side]??0;if(remaining<=0)throw new Error('NO_TIMEOUTS_REMAINING');room.timeoutsRemaining[ws._side]=remaining-1;broadcastRoom(room,{kind:'selection_timeout_granted',roundNumber:c.roundNumber,requestedBySide:ws._side,extraMs:60000,remainingBySide:{...room.timeoutsRemaining},serverSequence:nextSequence()});return;}
      if(msg.kind==='round_declarations'){if(room.matchCompleteReports.size>0)throw new Error('MATCH_COMPLETION_IN_PROGRESS');if(room.drawProposal){room.drawProposal=null;broadcastRoom(room,{kind:'draw_declined',roomId:room.id,declinedBy:null,reason:'ROUND_LOCKED',serverSequence:nextSequence()});}const ack=c.submitDeclarations(ws._side,msg.declarations,{lockedAtServerSequence:nextSequence()});send(ws,{kind:'round_declarations_locked',side:ws._side,roundNumber:c.roundNumber,waitingForOpponent:ack.waitingForOpponent,serverSequence:nextSequence()});if(c.canReleaseRound()){const pkg=c.releaseRoundPackage({deadlineMetadata:msg.deadlineMetadata??null});broadcastRoom(room,{kind:'round_package',package:pkg,serverSequence:nextSequence()});}return;}
      if(msg.kind==='round_digest'){const result=c.submitDigest(ws._side,msg.digest);if(result.kind==='round_confirmed'){room.roundReadySides.clear();room.matchCompleteReports.clear();broadcastRoom(room,{...result,serverSequence:nextSequence()});}else if(result.kind==='round_desync'){broadcastRoom(room,{...result,serverSequence:nextSequence()});c.halt('DESYNC');}else send(ws,{kind:'round_digest_received',roundNumber:c.roundNumber,waitingForOpponent:true,serverSequence:nextSequence()});return;}
      if(msg.kind==='round_ready'){handleRoundReady(ws,room,msg);return;}
      if(msg.kind==='match_complete'){await handleMatchComplete(ws,room,msg);return;}
      if(msg.kind==='advance_round')throw new Error('ADVANCE_ROUND_REPLACED_BY_TWO_SIDE_READY');
      throw new Error('UNKNOWN_MESSAGE_KIND');
    }catch(err){send(ws,{kind:'error',code:err.message||'SERVER_ERROR',serverSequence:nextSequence()});}});
    ws.on('close',()=>{leave(ws,'SOCKET_CLOSED');broadcastRooms();});
  });
  const interval=setInterval(()=>{for(const ws of wss.clients){if(ws.isAlive===false){ws.terminate();continue;}ws.isAlive=false;try{ws.ping();}catch{}}},25000);interval.unref?.();
  const PORT=Number(process.env.PORT||3000);server.listen(PORT,()=>{const actual=server.address()?.port??PORT;console.log(`ROS 2.0 Stage 25U coordinator listening on ${actual}`);console.log(`[RANKED] ladder file: ${ladderFile}`);console.log(`[RANKED] persistence: ${JSON.stringify(rankedPersistence())}`);});
  function shutdown(){clearInterval(interval);for(const ws of wss.clients)try{ws.terminate();}catch{}server.close(()=>process.exit(0));setTimeout(()=>process.exit(0),250).unref?.();}
  process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);
})().catch(err=>{console.error(err);process.exitCode=1;});
