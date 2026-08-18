import { ROSTER_IDS, getArchetype } from '../src/roster.js';
import { SIDE } from '../src/constants.js';
import { createSnakeDraftOrder, battleSizeLabel } from '../src/match-config.js';
import { RosBattleScene } from './ros2-scene.js';
import { CoordinatorSocket } from './network-client.js';

if(!globalThis.Phaser){document.getElementById('statusLine').textContent='Phaser failed to load. The Stage 25D client uses the Phaser CDN for the browser presentation layer.';throw new Error('Phaser unavailable');}
const scene=new RosBattleScene();
new Phaser.Game({type:Phaser.AUTO,parent:'game',backgroundColor:'#080b10',scene:[scene],scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH,width:850,height:560},render:{pixelArt:true,antialias:false}});

const q=id=>document.getElementById(id);let socket=null;
const topModeButtons=()=>[...document.querySelectorAll('#modeButtons button')];
function activateTopButton(button){for(const b of topModeButtons())b.classList.remove('active');button?.classList.add('active');}
function showNetworkPanel(show){q('networkPanel')?.classList.toggle('hidden',!show);}

q('holdButton').onclick=()=>scene.holdSelected();
q('submitButton').onclick=()=>scene.submitActions(false);
q('cancelTargetButton').onclick=()=>scene.cancelTargeting();
q('timeControlButton').onclick=()=>scene.handleTimeControl();
q('replaySpeedButton').onclick=()=>scene.toggleReplaySpeed();
q('clearLogButton').onclick=()=>{q('combatLog').innerHTML='';};

q('sandboxButton').onclick=()=>{activateTopButton(q('sandboxButton'));showNetworkPanel(false);scene.startSandbox();};
q('pvpButton').onclick=()=>{activateTopButton(q('pvpButton'));showNetworkPanel(true);scene.setMode('PVP');};

// ----- Stage 25D multiplayer lifecycle: lobby, draft, lockstep rounds, rematch -----
let networkTeamSize=3;
let currentRoom=null;
let advertisedRooms=[];
let networkMatchCompleteConfirmed=false;

function networkConfig(){return {teamSize:networkTeamSize,draftBansPerPlayer:q('draftBanToggle').checked?1:0};}
function setNetworkTeamSize(size,{send=true}={}){
  networkTeamSize=Math.max(1,Math.min(5,Number(size)||3));
  for(const b of document.querySelectorAll('[data-network-team-size]'))b.classList.toggle('selected',Number(b.dataset.networkTeamSize)===networkTeamSize);
  if(send&&socket&&currentRoom?.side===SIDE.A&&!currentRoom.configLocked)socket.updateRoomConfig(networkConfig());
}
function applyNetworkConfig(config,{send=false}={}){
  if(!config)return;
  setNetworkTeamSize(config.teamSize,{send:false});
  q('draftBanToggle').checked=Number(config.draftBansPerPlayer)===1;
  if(send&&socket&&currentRoom?.side===SIDE.A&&!currentRoom.configLocked)socket.updateRoomConfig(networkConfig());
}
function setLobbyConfigEditable(editable){
  q('hostConfigBlock').classList.toggle('locked',!editable);
  for(const b of document.querySelectorAll('[data-network-team-size]'))b.disabled=!editable;
  q('draftBanToggle').disabled=!editable;
  q('lobbyConfigLockText').textContent=editable
    ? (currentRoom?'Host may adjust until Player 2 joins.':'Choose before creating a room.')
    : (currentRoom?.configLocked?'LOCKED — both players joined.':'Host controls this configuration.');
}
function setLobbyStatus(text){q('lobbyStatus').textContent=text;}
function renderCurrentRoom(){
  const card=q('currentRoomCard');
  if(!currentRoom){card.classList.add('hidden');card.innerHTML='';return;}
  const cfg=currentRoom.config??networkConfig();
  const banText=cfg.draftBansPerPlayer===1?'1 ban per player':'No draft bans';
  card.classList.remove('hidden');
  const phase=currentRoom.draftPhase?` • ${currentRoom.draftPhase}`:'';
  card.innerHTML=`<strong>ROOM ${currentRoom.id}</strong><br>${battleSizeLabel(cfg.teamSize)} • ${banText} • Side ${currentRoom.side}${phase}<br><span class="${currentRoom.configLocked?'locked-copy':''}">${currentRoom.configLocked?'CONFIG LOCKED — BOTH PLAYERS READY':'WAITING FOR PLAYER 2'}</span>`;
}
function renderRooms(rooms=advertisedRooms){
  advertisedRooms=Array.isArray(rooms)?rooms:[];
  q('roomCount').textContent=String(advertisedRooms.length);
  const list=q('roomList');list.innerHTML='';
  if(!advertisedRooms.length){const empty=document.createElement('div');empty.className='room-empty';empty.textContent='No rooms are currently advertised.';list.appendChild(empty);return;}
  for(const room of advertisedRooms){
    const row=document.createElement('div');row.className='room-entry';
    const main=document.createElement('div');main.className='room-entry-main';
    const id=document.createElement('div');id.className='room-entry-id';id.textContent=room.id;
    const meta=document.createElement('div');meta.className='room-entry-meta';
    meta.textContent=`${room.format??battleSizeLabel(room.teamSize??3)} • ${Number(room.draftBansPerPlayer)===1?'1 ban/player':'no bans'} • ${room.players??0}/2 • ${room.status??(room.configLocked?'LOCKED':'WAITING')}`;
    main.append(id,meta);
    const join=document.createElement('button');join.textContent='JOIN';join.disabled=!!room.configLocked||Number(room.players)>=2||!socket;
    join.onclick=()=>{q('roomId').value=room.id;socket?.joinRoom(room.id);setLobbyStatus(`Joining ${room.id}…`);};
    row.append(main,join);list.appendChild(row);
  }
}
let networkDraftState=null;

function closeNetworkDraft(){
  networkDraftState=null;
  const modal=q('draftModal');
  modal?.classList.add('hidden');modal?.setAttribute('aria-hidden','true');
  const cancel=q('draftCancelButton');if(cancel){cancel.disabled=false;cancel.textContent='CANCEL';}
}
function networkDraftSideList(bucket){
  if(!networkDraftState)return [];
  return networkDraftState[bucket]?.[socket?.side]??[];
}
function networkOpponentSide(){return socket?.side===SIDE.A?SIDE.B:SIDE.A;}
function networkDraftOpponentList(bucket){
  if(!networkDraftState)return [];
  return networkDraftState[bucket]?.[networkOpponentSide()]??[];
}
function displayNetworkDraftState(state){
  const firstState=!networkDraftState;
  networkDraftState=state;
  if(currentRoom){currentRoom.draftPhase=state.phase;renderCurrentRoom();}
  const modal=q('draftModal');
  if(firstState)q('draftFilter').value='';modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');
  renderNetworkDraft();
}
function networkDraftOrderLabel(side){return side===socket?.side?'YOU':'OPP';}
function renderNetworkDraft(){
  const state=networkDraftState;if(!state)return;
  const size=Number(state.teamSize)||3;
  const phase=state.phase;
  const mine=state.turnSide===socket?.side;
  const complete=phase==='COMPLETE'||!!state.complete;
  const banPhase=phase==='BAN';
  q('draftTitle').textContent=`2P ${banPhase?'Ban':'Draft'} — ${battleSizeLabel(size)}`;
  q('draftMyTitle').textContent='YOUR PICKS';q('draftOpponentTitle').textContent='OPPONENT PICKS';
  const chip=q('draftTurnChip');
  chip.textContent=complete?'DRAFT COMPLETE':(mine?(banPhase?'YOUR BAN':'YOUR PICK'):(banPhase?'OPPONENT BAN':'OPPONENT PICK'));
  chip.className=`draft-turn-chip ${complete?'complete':(banPhase?'ban':(mine?'mine':'opp'))}`;
  q('draftProgress').textContent=banPhase?`${state.banIndex} / ${state.banOrder.length} bans`:`${state.pickIndex} / ${size*2} picks`;
  const my=q('draftMyPicks'),opp=q('draftCpuPicks');my.innerHTML='';opp.innerHTML='';
  const minePicks=networkDraftSideList('picks'),oppPicks=networkDraftOpponentList('picks');
  minePicks.forEach(x=>my.appendChild(pickChip(x)));oppPicks.forEach(x=>opp.appendChild(pickChip(x)));
  for(let i=minePicks.length;i<size;i++){const s=document.createElement('span');s.className='draft-pick-chip empty';s.textContent=`Slot ${i+1}`;my.appendChild(s);}
  for(let i=oppPicks.length;i<size;i++){const s=document.createElement('span');s.className='draft-pick-chip empty';s.textContent=`Slot ${i+1}`;opp.appendChild(s);}
  const banSummary=q('draftBanSummary');
  if(Number(state.draftBansPerPlayer)===1){
    banSummary.classList.remove('hidden');const myB=q('draftMyBans'),oppB=q('draftOpponentBans');myB.innerHTML='';oppB.innerHTML='';
    const mineBans=networkDraftSideList('bans'),oppBans=networkDraftOpponentList('bans');
    (mineBans.length?mineBans:['—']).forEach(x=>myB.appendChild(pickChip(x)));
    (oppBans.length?oppBans:['—']).forEach(x=>oppB.appendChild(pickChip(x)));
  }else banSummary.classList.add('hidden');
  q('draftPoolHeading').textContent=banPhase?'Available Champions — Choose Ban':'Available Champions — Choose Pick';
  const filter=q('draftFilter').value.trim().toLowerCase();const pool=q('draftPool');pool.innerHTML='';
  for(const id of state.available??[]){
    if(filter&&!id.toLowerCase().includes(filter))continue;
    const archetype=getArchetype(id),b=document.createElement('button');b.className=`draft-option${banPhase?' ban-mode':''}`;b.disabled=!mine||complete;
    const name=document.createElement('strong');name.textContent=id;const desc=document.createElement('small');desc.textContent=archetype.identity??'ROS2 champion';b.append(name,desc);
    b.onclick=()=>{if(!networkDraftState||networkDraftState.turnSide!==socket?.side)return;banPhase?socket?.submitDraftBan(id):socket?.submitDraftPick(id);};pool.appendChild(b);
  }
  const order=banPhase?state.banOrder:state.draftOrder;
  q('draftOrderText').textContent=`${banPhase?'Ban':'Draft'} order: ${(order??[]).map(networkDraftOrderLabel).join(' → ')}`;
  const cancel=q('draftCancelButton');cancel.disabled=true;cancel.textContent='ROOM LOCKED';
  setLobbyStatus(complete?'Draft complete. Launching match…':`${banPhase?'Ban':'Draft'} phase — ${mine?'your turn.':'waiting for opponent.'}`);
}

function setRematchButton({visible=false,disabled=false,label='REQUEST REMATCH'}={}){
  const button=q('matchResultRematchButton');if(!button)return;
  button.classList.toggle('hidden',!visible);button.disabled=disabled;button.textContent=label;
}
function resetRoomUi(message='Not currently in a room.'){
  closeNetworkDraft();currentRoom=null;networkMatchCompleteConfirmed=false;setRematchButton({visible:false});renderCurrentRoom();setLobbyConfigEditable(true);setLobbyStatus(message);
}
async function handleNetworkMessage(msg){
  q('connection').textContent=`${msg.kind}${msg.side?` • Side ${msg.side}`:''}${msg.roomId?` • ${msg.roomId}`:''}`;
  scene.log(`[NET] ${msg.kind}`,'system');
  if(msg.kind==='hello_ack'){
    q('lobbyConnectionBadge').textContent='ONLINE';q('lobbyConnectionBadge').className='lobby-badge online';
    setLobbyStatus('Connected. Create a configured room or join an advertised room.');
    socket?.listRooms();return;
  }
  if(msg.kind==='rooms'){renderRooms(msg.rooms);return;}
  if(msg.kind==='room_joined'){
    currentRoom={id:msg.roomId,side:msg.side,config:msg.config??networkConfig(),configLocked:!!msg.configLocked,players:msg.players??1};
    q('roomId').value=msg.roomId;applyNetworkConfig(currentRoom.config);renderCurrentRoom();
    setLobbyConfigEditable(currentRoom.side===SIDE.A&&!currentRoom.configLocked);
    setLobbyStatus(currentRoom.configLocked?'Both players joined. Configuration locked; draft handoff is ready.':'Room created/joined. Waiting for Player 2.');
    return;
  }
  if(msg.kind==='room_config_updated'){
    if(currentRoom&&currentRoom.id===msg.roomId){currentRoom.config=msg.config;applyNetworkConfig(msg.config);renderCurrentRoom();}
    setLobbyStatus(`Room configuration updated: ${battleSizeLabel(msg.config.teamSize)} • ${msg.config.draftBansPerPlayer?'1 ban/player':'no bans'}.`);return;
  }
  if(msg.kind==='room_locked'){
    if(currentRoom&&currentRoom.id===msg.roomId){currentRoom.config=msg.config;currentRoom.configLocked=true;currentRoom.players=2;applyNetworkConfig(msg.config);renderCurrentRoom();}
    setLobbyConfigEditable(false);q('lobbyConnectionBadge').textContent='ROOM LOCKED';q('lobbyConnectionBadge').className='lobby-badge locked';
    setLobbyStatus(`${battleSizeLabel(msg.config.teamSize)} lobby locked with both players. ${msg.config.draftBansPerPlayer?'Ban phase enabled: 1 ban per player.':'No draft bans.'} Network draft starting…`);return;
  }
  if(msg.kind==='draft_state'){
    if(currentRoom&&currentRoom.id===msg.roomId){currentRoom.config=msg.config??currentRoom.config;currentRoom.configLocked=true;currentRoom.draftPhase=msg.state?.phase??null;renderCurrentRoom();}
    displayNetworkDraftState(msg.state);return;
  }
  if(msg.kind==='draft_complete'){
    networkDraftState=msg.state??networkDraftState;if(networkDraftState)renderNetworkDraft();setLobbyStatus('Draft complete on server. Launching synchronized match…');return;
  }
  if(msg.kind==='opponent_disconnected'){
    const reason=`Opponent disconnected${msg.during?` during ${String(msg.during).toLowerCase().replace('_',' ')}`:''}. Match session closed.`;
    scene.handleNetworkDisconnect(reason);showNetworkPanel(true);activateTopButton(q('pvpButton'));setRematchButton({visible:false});setLobbyStatus(reason);return;
  }
  if(msg.kind==='room_closed'){
    scene.handleNetworkDisconnect('Room closed because a player left.');resetRoomUi('Room closed because a player left. Create or join another room.');showNetworkPanel(true);activateTopButton(q('pvpButton'));socket?.listRooms();return;
  }
  if(msg.kind==='error'){setLobbyStatus(`Server error: ${msg.code}`);return;}
  if(msg.kind==='socket_closed'){
    q('lobbyConnectionBadge').textContent='OFFLINE';q('lobbyConnectionBadge').className='lobby-badge';scene.handleNetworkDisconnect('Coordinator connection closed.');resetRoomUi('Connection closed.');showNetworkPanel(true);activateTopButton(q('pvpButton'));return;
  }
  // Stage 25D deterministic battle lifecycle.
  if(msg.kind==='match_started'){
    networkMatchCompleteConfirmed=false;setRematchButton({visible:false});
    if(currentRoom){currentRoom.matchNumber=msg.matchNumber??currentRoom.matchNumber;currentRoom.draftPhase=null;renderCurrentRoom();}
    closeNetworkDraft();showNetworkPanel(false);q('lobbyConnectionBadge').textContent='IN MATCH';q('lobbyConnectionBadge').className='lobby-badge locked';
    scene.beginNetworkMatch({matchId:msg.matchId,side:socket.side,timeoutsRemaining:msg.timeoutsRemaining?.[socket.side]??3,teamA:msg.teamA,teamB:msg.teamB});
  }else if(msg.kind==='selection_timeout_granted')scene.applyNetworkTimeout(msg);
  else if(msg.kind==='round_package')scene.receiveNetworkRoundPackage(msg.package);
  else if(msg.kind==='round_confirmed'){
    const local=await scene.confirmNetworkRound(msg);if(local?.desync)return;
    if(local?.complete)socket?.reportMatchComplete({roundNumber:local.roundNumber,winner:local.outcome?.winner,finalStateHash:local.digest?.finalStateHash,eventStreamHash:local.digest?.eventStreamHash});
    else if(local)socket?.readyForNextRound({roundNumber:local.roundNumber,finalStateHash:local.digest?.finalStateHash,eventStreamHash:local.digest?.eventStreamHash});
  }else if(msg.kind==='round_ready_status')scene.setStatus(`Round ${msg.roundNumber} confirmed. Replay ready ${msg.readySides?.length??0}/2.`);
  else if(msg.kind==='round_open')scene.openNetworkRound(msg.roundNumber);
  else if(msg.kind==='round_desync'||msg.kind==='match_desync'){
    const detail=msg.mismatches?.join(', ')??msg.reason??'HASH_MISMATCH';scene.handleNetworkDisconnect(`DESYNC — ${detail}. Match halted.`);setRematchButton({visible:false});
  }else if(msg.kind==='match_complete_received')scene.setStatus(msg.waitingForOpponent?'Match complete locally. Verifying opponent final result…':'Final result received by server.');
  else if(msg.kind==='match_complete_confirmed'){
    networkMatchCompleteConfirmed=true;if(currentRoom){currentRoom.postMatch=true;renderCurrentRoom();}
    q('lobbyConnectionBadge').textContent='MATCH COMPLETE';q('lobbyConnectionBadge').className='lobby-badge locked';setRematchButton({visible:!!msg.rematchAvailable,disabled:false,label:'REQUEST REMATCH'});scene.setStatus(`Match result verified by both clients — Side ${msg.winner} wins. Rematch available.`);
  }else if(msg.kind==='rematch_status'){
    const voted=(msg.votes??[]).includes(socket?.side);setRematchButton({visible:true,disabled:voted,label:voted?'REMATCH REQUESTED — WAITING':'REQUEST REMATCH'});scene.setStatus(`Rematch votes: ${msg.votes?.length??0}/${msg.required??2}.`);
  }else if(msg.kind==='rematch_start'){
    networkMatchCompleteConfirmed=false;setRematchButton({visible:false});hideMatchResult();scene.prepareNetworkRematch();showNetworkPanel(false);if(currentRoom){currentRoom.postMatch=false;currentRoom.draftPhase='DRAFT';renderCurrentRoom();}q('lobbyConnectionBadge').textContent='REMATCH DRAFT';q('lobbyConnectionBadge').className='lobby-badge locked';setLobbyStatus('Both players accepted the rematch. New synchronized draft starting…');
  }
}

for(const b of document.querySelectorAll('[data-network-team-size]'))b.onclick=()=>setNetworkTeamSize(Number(b.dataset.networkTeamSize));
q('draftBanToggle').addEventListener('change',()=>{if(socket&&currentRoom?.side===SIDE.A&&!currentRoom.configLocked)socket.updateRoomConfig(networkConfig());});
q('connectBtn').onclick=async()=>{
  try{
    socket=new CoordinatorSocket(q('wsUrl').value);scene.setNetworkSocket(socket);socket.onMessage(handleNetworkMessage);
    await socket.connect();q('connection').textContent='Connected';q('lobbyConnectionBadge').textContent='ONLINE';q('lobbyConnectionBadge').className='lobby-badge online';socket.listRooms();
  }catch(e){q('connection').textContent=`Connection failed: ${e.message}`;setLobbyStatus(`Connection failed: ${e.message}`);}
};
q('createRoomBtn').onclick=()=>{
  if(!socket)return setLobbyStatus('Connect before creating a room.');
  const id=q('roomId').value.trim()||undefined;socket.createRoom({id,...networkConfig()});setLobbyStatus(`Creating ${battleSizeLabel(networkTeamSize)} room…`);
};
q('joinRoomBtn').onclick=()=>{
  if(!socket)return setLobbyStatus('Connect before joining a room.');
  const id=q('roomId').value.trim();if(!id)return setLobbyStatus('Enter a room ID or choose an advertised room.');socket.joinRoom(id);setLobbyStatus(`Joining ${id}…`);
};
q('refreshRoomsBtn').onclick=()=>socket?.listRooms();
setLobbyConfigEditable(true);

// ----- Quick 1P roster picker: no draft, variable 1v1–5v5 test shortcut. -----
const rosterModal=q('rosterModal');
const MAX_TEAM_SIZE=5;
const rosterSelectIds=[];
for(const side of ['A','B'])for(let i=0;i<MAX_TEAM_SIZE;i++)rosterSelectIds.push(`team${side}${i}`);
for(const id of rosterSelectIds){
  const select=q(id);
  for(const archetype of ROSTER_IDS){const option=document.createElement('option');option.value=archetype;option.textContent=archetype;select.appendChild(option);}
}
let rosterTeamSize=3;
function setRosterTeamSize(size){
  rosterTeamSize=Math.max(1,Math.min(MAX_TEAM_SIZE,Number(size)||3));
  for(const b of document.querySelectorAll('[data-roster-team-size]'))b.classList.toggle('selected',Number(b.dataset.rosterTeamSize)===rosterTeamSize);
  for(const side of ['A','B'])for(let i=0;i<MAX_TEAM_SIZE;i++)q(`team${side}${i}`).classList.toggle('is-unused',i>=rosterTeamSize);
}
function normalizeVisibleRosterSelections(){
  const used=new Set();
  for(const side of ['A','B'])for(let i=0;i<rosterTeamSize;i++){
    const select=q(`team${side}${i}`);
    if(used.has(select.value))select.value=ROSTER_IDS.find(id=>!used.has(id))??select.value;
    used.add(select.value);
  }
}
for(const b of document.querySelectorAll('[data-roster-team-size]'))b.onclick=()=>{setRosterTeamSize(Number(b.dataset.rosterTeamSize));normalizeVisibleRosterSelections();q('rosterError').textContent='';};
function setRosterPickerValues({teamSize=3,teamA=[],teamB=[]}){
  setRosterTeamSize(teamSize);
  const used=new Set();
  const fallback=[...ROSTER_IDS];
  const valueFor=(arr,index)=>{
    const requested=arr[index];
    if(requested&&!used.has(requested)){used.add(requested);return requested;}
    const next=fallback.find(id=>!used.has(id));used.add(next);return next;
  };
  for(let i=0;i<MAX_TEAM_SIZE;i++)if(i<rosterTeamSize){q(`teamA${i}`).value=valueFor(teamA,i);q(`teamB${i}`).value=valueFor(teamB,i);}
}
function rosterPickerValues(){return {teamA:Array.from({length:rosterTeamSize},(_,i)=>q(`teamA${i}`).value),teamB:Array.from({length:rosterTeamSize},(_,i)=>q(`teamB${i}`).value)};}
function openRosterPicker(){setRosterPickerValues(scene.getSinglePlayerTeams());q('rosterError').textContent='';rosterModal.classList.remove('hidden');rosterModal.setAttribute('aria-hidden','false');}
function closeRosterPicker(){rosterModal.classList.add('hidden');rosterModal.setAttribute('aria-hidden','true');}
q('rosterButton').onclick=()=>{activateTopButton(q('rosterButton'));showNetworkPanel(false);openRosterPicker();};q('closeRosterButton').onclick=closeRosterPicker;
q('randomRosterButton').onclick=()=>{const pool=[...ROSTER_IDS];for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}setRosterPickerValues({teamSize:rosterTeamSize,teamA:pool.slice(0,rosterTeamSize),teamB:pool.slice(rosterTeamSize,rosterTeamSize*2)});q('rosterError').textContent='';};
q('applyRosterButton').onclick=()=>{try{scene.configureSinglePlayerTeams(rosterPickerValues(),{source:'roster'});activateTopButton(q('rosterButton'));showNetworkPanel(false);q('rosterError').textContent='';closeRosterPicker();}catch(err){q('rosterError').textContent=err.message;}};
rosterModal.addEventListener('pointerdown',e=>{if(e.target===rosterModal)closeRosterPicker();});

// ----- Stage 25A local match setup + draft (preserved) -----
const matchSetupModal=q('matchSetupModal');
const draftModal=q('draftModal');
let selectedTeamSize=3;
let draftState=null;
let draftAiTimer=null;

function openMatchSetup(){
  selectedTeamSize=3;
  for(const b of document.querySelectorAll('[data-team-size]'))b.classList.toggle('selected',Number(b.dataset.teamSize)===selectedTeamSize);
  q('setupBattleLabel').textContent=battleSizeLabel(selectedTeamSize);
  matchSetupModal.classList.remove('hidden');matchSetupModal.setAttribute('aria-hidden','false');
}
function closeMatchSetup(){matchSetupModal.classList.add('hidden');matchSetupModal.setAttribute('aria-hidden','true');}
function closeDraft(){if(draftAiTimer){clearTimeout(draftAiTimer);draftAiTimer=null;}draftState=null;draftModal.classList.add('hidden');draftModal.setAttribute('aria-hidden','true');}

q('onePlayerDraftButton').onclick=openMatchSetup;
q('closeMatchSetupButton').onclick=closeMatchSetup;
for(const b of document.querySelectorAll('[data-team-size]'))b.onclick=()=>{selectedTeamSize=Number(b.dataset.teamSize);for(const x of document.querySelectorAll('[data-team-size]'))x.classList.toggle('selected',x===b);q('setupBattleLabel').textContent=battleSizeLabel(selectedTeamSize);};
q('beginDraftButton').onclick=()=>{closeMatchSetup();startLocalDraft(selectedTeamSize);};
matchSetupModal.addEventListener('pointerdown',e=>{if(e.target===matchSetupModal)closeMatchSetup();});
q('draftCancelButton').onclick=()=>{if(!networkDraftState)closeDraft();};
q('draftFilter').addEventListener('input',()=>networkDraftState?renderNetworkDraft():renderDraft());
draftModal.addEventListener('pointerdown',e=>{if(e.target===draftModal&&!networkDraftState)closeDraft();});

function startLocalDraft(teamSize){
  networkDraftState=null;q('draftBanSummary').classList.add('hidden');q('draftMyTitle').textContent='YOUR PICKS';q('draftOpponentTitle').textContent='CPU PICKS';q('draftPoolHeading').textContent='Available Champions';q('draftCancelButton').disabled=false;q('draftCancelButton').textContent='CANCEL';
  if(draftAiTimer){clearTimeout(draftAiTimer);draftAiTimer=null;}
  draftState={teamSize,order:[...createSnakeDraftOrder(teamSize)],pickIndex:0,picksA:[],picksB:[],pool:[...ROSTER_IDS]};
  q('draftFilter').value='';draftModal.classList.remove('hidden');draftModal.setAttribute('aria-hidden','false');renderDraft();continueAiDraftIfNeeded();
}
function draftTurnSide(){return draftState?.order?.[draftState.pickIndex]??null;}
function draftComplete(){return !!draftState&&draftState.pickIndex>=draftState.order.length;}
function deterministicAiChoice(){const priority=['Barbarian','Cleric','Mage','Warrior','Archer','Paladin','Electromancer','Necromancer','Monk','Mystic','Rogue','Shinobi'];return priority.find(id=>draftState.pool.includes(id))??draftState.pool[0]??null;}
function commitDraftPick(side,archetype){
  if(!draftState||draftComplete()||draftTurnSide()!==side||!draftState.pool.includes(archetype))return false;
  (side===SIDE.A?draftState.picksA:draftState.picksB).push(archetype);draftState.pool=draftState.pool.filter(id=>id!==archetype);draftState.pickIndex+=1;renderDraft();
  if(draftComplete())finishLocalDraft();else continueAiDraftIfNeeded();return true;
}
function continueAiDraftIfNeeded(){
  if(!draftState||draftComplete()||draftTurnSide()!==SIDE.B)return;if(draftAiTimer)clearTimeout(draftAiTimer);
  draftAiTimer=setTimeout(()=>{draftAiTimer=null;if(!draftState||draftTurnSide()!==SIDE.B)return;const pick=deterministicAiChoice();if(pick)commitDraftPick(SIDE.B,pick);},260);
}
function finishLocalDraft(){
  if(!draftState)return;const {teamSize,picksA,picksB}=draftState;if(picksA.length!==teamSize||picksB.length!==teamSize)return;closeDraft();scene.configureSinglePlayerTeams({teamA:picksA,teamB:picksB},{source:'vs AI draft'});activateTopButton(q('onePlayerDraftButton'));showNetworkPanel(false);
}
function pickChip(archetype){const chip=document.createElement('span');chip.className='draft-pick-chip';chip.textContent=archetype;return chip;}
function renderDraft(){
  if(!draftState)return;const size=draftState.teamSize,turn=draftTurnSide(),mine=turn===SIDE.A;
  q('draftMyTitle').textContent='YOUR PICKS';q('draftOpponentTitle').textContent='CPU PICKS';q('draftBanSummary').classList.add('hidden');q('draftPoolHeading').textContent='Available Champions';
  q('draftTitle').textContent=`Draft — ${battleSizeLabel(size)}`;q('draftTurnChip').textContent=draftComplete()?'Draft complete':(mine?'YOUR PICK':'CPU PICK');q('draftTurnChip').className=`draft-turn-chip ${mine?'mine':'cpu'}`;q('draftProgress').textContent=`${draftState.pickIndex} / ${size*2} picks`;
  const my=q('draftMyPicks'),cpu=q('draftCpuPicks');my.innerHTML='';cpu.innerHTML='';draftState.picksA.forEach(x=>my.appendChild(pickChip(x)));draftState.picksB.forEach(x=>cpu.appendChild(pickChip(x)));
  for(let i=draftState.picksA.length;i<size;i++){const s=document.createElement('span');s.className='draft-pick-chip empty';s.textContent=`Slot ${i+1}`;my.appendChild(s);}for(let i=draftState.picksB.length;i<size;i++){const s=document.createElement('span');s.className='draft-pick-chip empty';s.textContent=`Slot ${i+1}`;cpu.appendChild(s);}
  const filter=q('draftFilter').value.trim().toLowerCase();const pool=q('draftPool');pool.innerHTML='';
  for(const id of draftState.pool){if(filter&&!id.toLowerCase().includes(filter))continue;const archetype=getArchetype(id);const b=document.createElement('button');b.className='draft-option';b.disabled=!mine||draftComplete();const name=document.createElement('strong');name.textContent=id;const desc=document.createElement('small');desc.textContent=archetype.identity??'ROS2 champion';b.append(name,desc);b.onclick=()=>commitDraftPick(SIDE.A,id);pool.appendChild(b);}
  q('draftOrderText').textContent=`Order: ${draftState.order.map(side=>side===SIDE.A?'P1':'CPU').join(' → ')}`;
}

// ----- Stage 25B match-end awards screen (preserved in Stage 25C) -----
const resultModal=q('matchResultModal');
function hideMatchResult(){resultModal.classList.add('hidden');resultModal.setAttribute('aria-hidden','true');}
function metricValue(award){
  if(award.key==='kills')return `${award.value} ${award.value===1?'kill':'kills'}`;
  return `${Number(award.value??0).toLocaleString()} ${award.key==='healing'?'healing':'damage'}`;
}
function renderMatchResult(detail){
  const stats=detail?.stats;if(!stats)return;
  const victory=detail.result==='VICTORY';
  const banner=q('matchResultBanner');banner.className=`match-result-banner ${victory?'victory':'defeat'}`;
  q('matchResultTitle').textContent=detail.result;
  const a=stats.teamTotals?.A??{damage:0,kills:0,healing:0},b=stats.teamTotals?.B??{damage:0,kills:0,healing:0};
  q('matchResultSummary').textContent=`Winner: Side ${detail.winner} • Side A ${a.damage.toLocaleString()} damage • Side B ${b.damage.toLocaleString()} damage`;
  q('matchRoundCount').textContent=`${stats.roundsCompleted} round${stats.roundsCompleted===1?'':'s'}`;
  const awards=q('matchAwards');awards.innerHTML='';
  for(const award of stats.awards??[]){
    const card=document.createElement('div');card.className='match-award-card';
    const title=document.createElement('div');title.className='match-award-title';title.textContent=award.title;
    const winner=document.createElement('div');winner.className='match-award-winner';winner.textContent=(award.winners??[]).map(w=>w.archetypeId).join(' / ')||'—';
    const value=document.createElement('div');value.className='match-award-value';value.textContent=metricValue(award);
    if(award.key==='bestRoundDamage'&&award.winners?.length===1&&award.winners[0].roundNumber)value.textContent+=` • Round ${award.winners[0].roundNumber}`;
    card.append(title,winner,value);awards.appendChild(card);
  }
  const body=q('matchStatsBody');body.innerHTML='';
  for(const c of stats.champions??[]){
    const tr=document.createElement('tr');
    const values=[c.archetypeId,c.side,c.damage.toLocaleString(),String(c.kills),c.healing.toLocaleString(),`${c.bestRoundDamage.toLocaleString()}${c.bestRoundNumber?` (R${c.bestRoundNumber})`:''}`];
    values.forEach((value,index)=>{const td=document.createElement('td');td.textContent=value;if(index===1)td.className=c.side===SIDE.A?'side-a':'side-b';tr.appendChild(td);});
    body.appendChild(tr);
  }
  setRematchButton({visible:scene.mode==='PVP'&&networkMatchCompleteConfirmed,disabled:false,label:'REQUEST REMATCH'});
  resultModal.classList.remove('hidden');resultModal.setAttribute('aria-hidden','false');
}
window.addEventListener('ros:match-complete',event=>renderMatchResult(event.detail));
window.addEventListener('ros:match-reset',hideMatchResult);
q('matchResultViewButton').onclick=hideMatchResult;
q('matchResultRematchButton').onclick=()=>{if(!socket||!currentRoom||!networkMatchCompleteConfirmed)return;setRematchButton({visible:true,disabled:true,label:'REMATCH REQUESTED — WAITING'});socket.requestRematch();};
q('matchResultSandboxButton').onclick=()=>{if(scene.mode==='PVP'&&socket&&currentRoom){try{socket.leaveRoom();}catch{}}hideMatchResult();resetRoomUi('Not currently in a room.');activateTopButton(q('sandboxButton'));showNetworkPanel(false);scene.startSandbox();};

// Stage 24D client lineage marker retained for presentation regression coverage.
