import { ROSTER_IDS, getArchetype } from '../src/roster.js';
import { SIDE } from '../src/constants.js';
import { createSnakeDraftOrder, battleSizeLabel } from '../src/match-config.js';
import { RosBattleScene } from './ros2-scene.js';
import { CoordinatorSocket } from './network-client.js';

if(!globalThis.Phaser){document.getElementById('statusLine').textContent='Phaser failed to load. The Stage 25D client uses the Phaser CDN for the browser presentation layer.';throw new Error('Phaser unavailable');}
const scene=new RosBattleScene();
new Phaser.Game({type:Phaser.AUTO,parent:'game',backgroundColor:'#080b10',scene:[scene],scale:{mode:Phaser.Scale.FIT,autoCenter:Phaser.Scale.CENTER_BOTH,width:850,height:560},render:{pixelArt:true,antialias:false}});

const q=id=>document.getElementById(id);
const COORDINATOR_URL='wss://ros2-coordinator.onrender.com/ws';
let socket=null,reconnectTimer=null;
let activeLogTab='combat',chatUnread=0,chatCollapsed=false,combatLogCollapsed=false;
const PLAYER_NAME_STORAGE_KEY='ros2-player-name';
function normalizePlayerName(value){return String(value??'').replace(/[<>&\u0000-\u001f\u007f]/g,'').replace(/\s+/g,' ').trim().slice(0,20)||'Player';}
function currentPlayerName(){return normalizePlayerName(q('playerNameInput')?.value);}
function savePlayerName(){
  const name=currentPlayerName();q('playerNameInput').value=name;
  try{localStorage.setItem(PLAYER_NAME_STORAGE_KEY,name);}catch{}
  socket?.setPlayerName?.(name);
  if(currentRoom){currentRoom.playerNames={...(currentRoom.playerNames??{}),[currentRoom.side]:name};renderCurrentRoom();}
  return name;
}
const topModeButtons=()=>[...document.querySelectorAll('#modeButtons button')];
function activateTopButton(button){for(const b of topModeButtons())b.classList.remove('active');button?.classList.add('active');}
function showNetworkPanel(show){q('networkPanel')?.classList.toggle('hidden',!show);}

try{q('playerNameInput').value=normalizePlayerName(localStorage.getItem(PLAYER_NAME_STORAGE_KEY)||'Player');}catch{q('playerNameInput').value='Player';}
q('playerNameInput').addEventListener('change',savePlayerName);
q('playerNameInput').addEventListener('blur',savePlayerName);
q('playerNameInput').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();q('playerNameInput').blur();}});

q('holdButton').onclick=()=>scene.holdSelected();
q('submitButton').onclick=()=>scene.submitActions(false);
q('cancelTargetButton').onclick=()=>scene.cancelTargeting();
q('timeControlButton').onclick=()=>scene.handleTimeControl();
q('replaySpeedButton').onclick=()=>handleReplaySpeedButton();
q('clearLogButton').onclick=()=>{q('combatLog').innerHTML='';};
q('combatLogCollapseButton').onclick=()=>setCombatLogCollapsed(!combatLogCollapsed);
q('chatCollapseButton').onclick=()=>setChatCollapsed(!chatCollapsed);
q('combatLogTabButton').onclick=()=>setLogChatTab('combat');
q('chatTabButton').onclick=()=>setLogChatTab('chat');
q('chatForm').addEventListener('submit',event=>{
  event.preventDefault();
  const input=q('chatInput'),text=input.value.trim();
  if(!text||!currentRoom||!socket?.ws||socket.ws.readyState!==WebSocket.OPEN)return;
  try{socket.sendChat(text);input.value='';input.focus();}catch{appendChatSystem('Chat send failed — coordinator is not connected.');}
});

function setLogChatTab(tab){
  const wantsChat=tab==='chat'&&!q('chatTabButton').disabled;
  activeLogTab=wantsChat?'chat':'combat';
  q('combatLog').classList.toggle('hidden',activeLogTab!=='combat'||combatLogCollapsed);
  q('multiplayerChat').classList.toggle('hidden',activeLogTab!=='chat'||chatCollapsed);
  q('combatLogTabButton').classList.toggle('active',activeLogTab==='combat');
  q('chatTabButton').classList.toggle('active',activeLogTab==='chat');
  q('combatLogTabButton').setAttribute('aria-selected',String(activeLogTab==='combat'));
  q('chatTabButton').setAttribute('aria-selected',String(activeLogTab==='chat'));
  q('clearLogButton').classList.toggle('hidden',activeLogTab==='chat');
  q('combatLogCollapseButton').classList.toggle('hidden',activeLogTab!=='combat');
  q('logPanel')?.classList.toggle('combat-log-collapsed',activeLogTab==='combat'&&combatLogCollapsed);
  q('chatCollapseButton').classList.toggle('hidden',activeLogTab!=='chat');
  if(activeLogTab==='chat'&&!chatCollapsed){chatUnread=0;updateChatUnread();q('chatMessages').scrollTop=q('chatMessages').scrollHeight;q('chatInput')?.focus();}
}
function setCombatLogCollapsed(collapsed){
  combatLogCollapsed=Boolean(collapsed);
  const button=q('combatLogCollapseButton');
  button.textContent=combatLogCollapsed?'EXPAND':'MINIMIZE';button.setAttribute('aria-expanded',String(!combatLogCollapsed));
  q('logPanel')?.classList.toggle('combat-log-collapsed',activeLogTab==='combat'&&combatLogCollapsed);
  q('combatLog').classList.toggle('hidden',activeLogTab!=='combat'||combatLogCollapsed);
}
function setChatCollapsed(collapsed){
  chatCollapsed=Boolean(collapsed);
  const button=q('chatCollapseButton');
  button.textContent=chatCollapsed?'EXPAND':'COLLAPSE';button.setAttribute('aria-expanded',String(!chatCollapsed));
  q('logPanel')?.classList.toggle('chat-collapsed',chatCollapsed);
  q('multiplayerChat').classList.toggle('hidden',activeLogTab!=='chat'||chatCollapsed);
  if(!chatCollapsed&&activeLogTab==='chat'){chatUnread=0;updateChatUnread();q('chatMessages').scrollTop=q('chatMessages').scrollHeight;q('chatInput')?.focus();}
}
function updateChatUnread(){
  const badge=q('chatUnreadBadge'),tab=q('chatTabButton');
  badge.textContent=String(chatUnread);badge.classList.toggle('hidden',chatUnread<=0);tab.classList.toggle('has-unread',chatUnread>0);
}
function setChatAvailable(available){
  q('chatTabButton').disabled=!available;q('chatInput').disabled=!available;q('chatSendButton').disabled=!available;
  if(!available&&activeLogTab==='chat')setLogChatTab('combat');
}
function clearChat(){q('chatMessages').innerHTML='';chatUnread=0;updateChatUnread();setChatCollapsed(false);}
function appendChatSystem(text){
  const line=document.createElement('div');line.className='chat-system';line.textContent=text;q('chatMessages').appendChild(line);q('chatMessages').scrollTop=q('chatMessages').scrollHeight;
}
function appendChatMessage(msg){
  if(!msg?.text)return;const own=msg.side===socket?.side,line=document.createElement('div');line.className=`chat-line ${own?'own':'opp'}`;
  const fallback=msg.side===SIDE.A?'HOST':'PLAYER 2';const displayName=normalizePlayerName(msg.name??currentRoom?.playerNames?.[msg.side]??fallback);
  const meta=document.createElement('span');meta.className='chat-meta';meta.textContent=own?`${displayName} (YOU)`:displayName;
  const body=document.createElement('span');body.textContent=msg.text;line.append(meta,body);q('chatMessages').appendChild(line);q('chatMessages').scrollTop=q('chatMessages').scrollHeight;
  if(!own&&(activeLogTab!=='chat'||chatCollapsed)){chatUnread=Math.min(99,chatUnread+1);updateChatUnread();}
}
setChatAvailable(false);

q('pvpButton').onclick=()=>enterNetworkMode(false);
q('rankedButton').onclick=()=>enterNetworkMode(true);

// ----- Stage 25D multiplayer lifecycle: lobby, draft, lockstep rounds, rematch -----
let networkTeamSize=3;
let networkReplaySpeed=0.33;
let networkRankedMode=false;
let currentRoom=null;
let advertisedRooms=[];
let latestRankings={version:3,updatedAt:null,formats:['1v1','2v2','3v3','4v4','5v5'],ratingSystem:{name:'Elo',initial:1500,kFactor:32},players:[],champions:[]};
let latestRankedPersistence=null;
let rankingFormat='3v3',rankingView='players';
let networkMatchCompleteConfirmed=false;

function networkConfig(){return {teamSize:networkTeamSize,draftBansPerPlayer:q('draftBanToggle').checked?1:0,replaySpeed:networkReplaySpeed,ranked:networkRankedMode};}
function activeNetworkButton(){return networkRankedMode?q('rankedButton'):q('pvpButton');}
function setNetworkRankedMode(ranked,{activate=true}={}){
  networkRankedMode=ranked===true;
  if(activate)activateTopButton(activeNetworkButton());
  q('networkPanelTitle').textContent=networkRankedMode?'2P Ranked Lobby':'2P Draft Lobby';
  q('rankedLobbyNotice').classList.toggle('hidden',!networkRankedMode);
  q('roomBrowserTitle').textContent=networkRankedMode?'OPEN RANKED ROOMS':'OPEN CASUAL ROOMS';
  q('createRoomBtn').textContent=networkRankedMode?'CREATE RANKED ROOM':'CREATE ROOM';
  renderRooms(advertisedRooms);
}
function enterNetworkMode(ranked){
  if(currentRoom&&Boolean(currentRoom.config?.ranked)!==(ranked===true)){
    showNetworkPanel(true);activateTopButton(activeNetworkButton());setLobbyStatus('Leave or finish your current room before switching between Casual and Ranked.');return;
  }
  setNetworkRankedMode(ranked,{activate:true});showNetworkPanel(true);
  if(!currentRoom)scene.setMode('PVP');
  connectCoordinator();
}
function setNetworkTeamSize(size,{send=true}={}){
  networkTeamSize=Math.max(2,Math.min(5,Number(size)||3));
  for(const b of document.querySelectorAll('[data-network-team-size]'))b.classList.toggle('selected',Number(b.dataset.networkTeamSize)===networkTeamSize);
  if(send&&socket&&currentRoom?.side===SIDE.A&&!currentRoom.configLocked)socket.updateRoomConfig(networkConfig());
}
function normalizeReplaySpeed(value){
  const n=Number(value);
  return [0.25,0.33,0.5].includes(n)?n:0.33;
}
function setNetworkReplaySpeed(value,{send=true}={}){
  networkReplaySpeed=normalizeReplaySpeed(value);
  for(const b of document.querySelectorAll('[data-network-replay-speed]'))b.classList.toggle('selected',Number(b.dataset.networkReplaySpeed)===networkReplaySpeed);
  scene.setReplaySpeed(networkReplaySpeed,{locked:Boolean(currentRoom?.configLocked),notify:false});
  if(send&&socket&&currentRoom?.side===SIDE.A&&!currentRoom.configLocked)socket.updateRoomConfig(networkConfig());
}
function handleReplaySpeedButton(){
  if(scene.mode==='PVP'&&currentRoom?.side===SIDE.A&&!currentRoom.configLocked){
    const speeds=[0.25,0.33,0.5],i=speeds.indexOf(networkReplaySpeed);
    setNetworkReplaySpeed(speeds[(i+1+speeds.length)%speeds.length],{send:true});
    scene.setStatus(`Host replay speed set to ${networkReplaySpeed.toFixed(2)}×. It will lock for both players when Player 2 joins.`);
    return;
  }
  scene.toggleReplaySpeed();
}
function applyNetworkConfig(config,{send=false}={}){
  if(!config)return;
  setNetworkTeamSize(config.teamSize,{send:false});
  q('draftBanToggle').checked=Number(config.draftBansPerPlayer)===1;
  setNetworkReplaySpeed(config.replaySpeed??0.33,{send:false});
  if(send&&socket&&currentRoom?.side===SIDE.A&&!currentRoom.configLocked)socket.updateRoomConfig(networkConfig());
}
function setLobbyConfigEditable(editable){
  q('hostConfigBlock').classList.toggle('locked',!editable);
  for(const b of document.querySelectorAll('[data-network-team-size]'))b.disabled=!editable;
  for(const b of document.querySelectorAll('[data-network-replay-speed]'))b.disabled=!editable;
  q('draftBanToggle').disabled=!editable;
  q('lobbyConfigLockText').textContent=editable
    ? (currentRoom?'Host may adjust until Player 2 joins.':'Choose before creating a room.')
    : (currentRoom?.configLocked?'LOCKED — both players joined.':'Host controls this configuration.');
}
function setLobbyStatus(text){q('lobbyStatus').textContent=text;}
function renderCurrentRoom(){
  const card=q('currentRoomCard');
  if(!currentRoom){card.classList.add('hidden');card.classList.remove('ranked-room-card');card.innerHTML='';q('playerNameInput').disabled=false;return;}
  const cfg=currentRoom.config??networkConfig();
  const banText=cfg.draftBansPerPlayer===1?'1 ban per player':'No draft bans';
  const replayText=`Replay ${normalizeReplaySpeed(cfg.replaySpeed??0.33).toFixed(2)}×`;
  card.classList.remove('hidden');card.classList.toggle('waiting-room',!currentRoom.configLocked);card.classList.toggle('ranked-room-card',!!cfg.ranked);
  q('playerNameInput').disabled=!!cfg.ranked&&!!currentRoom.configLocked;
  const phase=currentRoom.draftPhase?` • ${currentRoom.draftPhase}`:'';
  const names=currentRoom.playerNames??{};const hostName=normalizePlayerName(names.A??(currentRoom.side===SIDE.A?currentPlayerName():'Host'));const p2Name=names.B?normalizePlayerName(names.B):'—';
  const modeTag=cfg.ranked?'<span class="ranked-tag">RANKED</span>':'CASUAL';
  card.innerHTML=`<strong>ROOM ${currentRoom.id}</strong><br>${modeTag} • ${battleSizeLabel(cfg.teamSize)} • ${banText} • ${replayText} • Side ${currentRoom.side}${phase}<br>Host: <strong>${hostName}</strong> • Player 2: <strong>${p2Name}</strong><br><span class="${currentRoom.configLocked?'locked-copy':''}">${currentRoom.configLocked?'CONFIG LOCKED — BOTH PLAYERS READY':'WAITING FOR PLAYER 2'}</span>`;
}
function renderRooms(rooms=advertisedRooms){
  advertisedRooms=Array.isArray(rooms)?rooms:[];
  const visible=advertisedRooms.filter(room=>Boolean(room.ranked)===networkRankedMode);
  q('roomCount').textContent=String(visible.length);
  const list=q('roomList');list.innerHTML='';
  if(!visible.length){const empty=document.createElement('div');empty.className='room-empty';empty.textContent=networkRankedMode?'No ranked rooms are currently advertised.':'No casual rooms are currently advertised.';list.appendChild(empty);return;}
  for(const room of visible){
    const row=document.createElement('div');row.className='room-entry';row.classList.toggle('ranked-room',!!room.ranked);
    const main=document.createElement('div');main.className='room-entry-main';
    const id=document.createElement('div');id.className='room-entry-id';id.textContent=room.id;
    const meta=document.createElement('div');meta.className='room-entry-meta';
    meta.textContent=`${room.ranked?'RANKED':'CASUAL'} • Hosted by ${normalizePlayerName(room.hostName??'Player')} • ${room.format??battleSizeLabel(room.teamSize??3)} • ${Number(room.draftBansPerPlayer)===1?'1 ban/player':'no bans'} • replay ${normalizeReplaySpeed(room.replaySpeed??0.33).toFixed(2)}× • ${room.players??0}/2 • ${room.status??(room.configLocked?'LOCKED':'WAITING')}`;
    main.append(id,meta);
    const join=document.createElement('button');join.textContent='JOIN';join.className='join-room-button';join.disabled=!!room.configLocked||Number(room.players)>=2||socket?.ws?.readyState!==WebSocket.OPEN;
    row.classList.toggle('open-room',!join.disabled);
    join.onclick=()=>{const name=savePlayerName();if(room.ranked&&name.toLowerCase()==='player')return setLobbyStatus('Choose a player name before joining Ranked.');q('roomId').value=room.id;socket?.joinRoom(room.id);setLobbyStatus(`Joining ${room.ranked?'ranked ':''}${room.id}…`);};
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
  q('draftMyTitle').textContent=`${currentPlayerName().toUpperCase()} PICKS`;q('draftOpponentTitle').textContent=`${normalizePlayerName(currentRoom?.playerNames?.[networkOpponentSide()]??'OPPONENT').toUpperCase()} PICKS`;
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
    const archetype=getArchetype(id),b=createDraftOption(id,archetype,{banMode:banPhase,disabled:!mine||complete});
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
function setDrawButton({visible=false,disabled=false,label='PROPOSE DRAW',pending=false}={}){
  const button=q('drawProposalButton');if(!button)return;
  button.classList.toggle('hidden',!visible);button.classList.toggle('pending',pending);button.disabled=disabled;button.textContent=label;
}
function hideDrawProposal(){const modal=q('drawProposalModal');modal?.classList.add('hidden');modal?.setAttribute('aria-hidden','true');}
function showDrawProposal(msg={}){
  const proposer=normalizePlayerName(msg.playerNames?.[msg.proposedBy]??'Opponent');
  q('drawProposalText').textContent=`${proposer} has proposed ending this match as a draw. Accepting ends the match immediately${currentRoom?.config?.ranked?' and records a Ranked draw':''}.`;
  const modal=q('drawProposalModal');modal.classList.remove('hidden');modal.setAttribute('aria-hidden','false');
}
function resetDrawUi(){hideDrawProposal();setDrawButton({visible:false});}
q('drawProposalButton').onclick=()=>{
  if(scene.mode!=='PVP'||!currentRoom||networkMatchCompleteConfirmed||!socket?.ws||socket.ws.readyState!==WebSocket.OPEN)return;
  setDrawButton({visible:true,disabled:true,label:'SENDING DRAW…',pending:true});
  try{socket.proposeDraw();}catch{setDrawButton({visible:true});scene.setStatus('Unable to send draw proposal — coordinator is unavailable.');}
};
q('acceptDrawButton').onclick=()=>{hideDrawProposal();setDrawButton({visible:true,disabled:true,label:'ACCEPTING DRAW…',pending:true});try{socket?.respondDraw(true);}catch{setDrawButton({visible:true});}};
q('declineDrawButton').onclick=()=>{hideDrawProposal();setDrawButton({visible:true});try{socket?.respondDraw(false);}catch{}};
function resetRoomUi(message='Not currently in a room.'){
  closeNetworkDraft();currentRoom=null;networkMatchCompleteConfirmed=false;q('playerNameInput').disabled=false;scene.setReplaySpeed(networkReplaySpeed,{locked:false,notify:false});setRematchButton({visible:false});resetDrawUi();renderCurrentRoom();setLobbyConfigEditable(true);setLobbyStatus(message);setChatAvailable(false);
}
function prepareLocalModeSelection(){
  if(currentRoom&&socket){try{socket.leaveRoom();}catch{}}
  resetRoomUi('Not currently in a room.');resetDrawUi();setDrawButton({visible:false});hideMatchResult();showNetworkPanel(false);
  scene.enterIdleState({startup:false});
}
function recordText(record){return record&&Number(record.games)>0?`${record.wins}-${record.draws??0}-${record.losses}`:'—';}
function rankingRecord(entity,format){return entity?.formats?.[format]??{wins:0,draws:0,losses:0,games:0,winPct:0,rank:null,rating:1500};}
function setRankingFormat(format){
  if(!['1v1','2v2','3v3','4v4','5v5'].includes(format))return;
  rankingFormat=format;renderRankings();
}
function setRankingView(view){rankingView=view==='champions'?'champions':'players';renderRankings();}
function renderRankingControls(){
  for(const b of document.querySelectorAll('[data-ranking-format]'))b.classList.toggle('active',b.dataset.rankingFormat===rankingFormat);
  q('rankPlayersButton').classList.toggle('active',rankingView==='players');q('rankChampionsButton').classList.toggle('active',rankingView==='champions');
}
function renderRankedPersistence(persistence=latestRankedPersistence){
  if(persistence)latestRankedPersistence=persistence;
  const el=q('rankedPersistenceStatus');if(!el)return;
  const p=latestRankedPersistence;
  el.className='ranked-persistence-status';
  if(!p){el.textContent='RANKED STORAGE: CHECKING…';el.classList.add('checking');return;}
  if(p.durable&&p.remoteHealthy){
    const stamp=p.lastVerifiedAt?new Date(p.lastVerifiedAt).toLocaleTimeString():null;
    el.textContent=`RANKED STORAGE: SUPABASE VERIFIED${Number.isFinite(Number(p.revision))?` • REV ${p.revision}`:''}${stamp?` • ${stamp}`:''}`;
    el.classList.add('healthy');return;
  }
  if(p.durable){el.textContent=`RANKED STORAGE: DURABLE ${String(p.mode??'STORAGE').toUpperCase()}`;el.classList.add('healthy');return;}
  el.textContent=`RANKED STORAGE: NOT DURABLE${p.error?` • ${String(p.error).slice(0,90)}`:''}`;
  el.classList.add('error');
}
function renderRankings(standings=latestRankings){
  latestRankings=standings??latestRankings;renderRankingControls();renderRankedPersistence();
  const body=q('rankingsBody'),head=q('rankingsHead');body.innerHTML='';
  const stamp=latestRankings?.updatedAt?new Date(latestRankings.updatedAt).toLocaleString():'No completed ranked matches yet';
  if(rankingView==='champions'){
    head.innerHTML='<tr><th>#</th><th>Champion</th><th>Record</th><th>Games</th><th>Win %</th></tr>';
    const champions=(latestRankings?.champions??[]).filter(c=>Number(rankingRecord(c,rankingFormat).games)>0).sort((a,b)=>(rankingRecord(a,rankingFormat).rank??9999)-(rankingRecord(b,rankingFormat).rank??9999));
    if(!champions.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=5;td.className='rankings-empty';td.textContent=`No ${rankingFormat} champion data has been recorded yet.`;tr.appendChild(td);body.appendChild(tr);}
    for(const champion of champions){
      const r=rankingRecord(champion,rankingFormat),tr=document.createElement('tr');
      const values=[String(r.rank??'—'),champion.name,recordText(r),String(r.games),`${Number(r.winPct??0).toFixed(1)}%`];
      values.forEach((value,index)=>{const td=document.createElement('td');td.textContent=value;if(index===0)td.className='rankings-rank';else if(index===1)td.className='rankings-champion';else if(index===3)td.className='rankings-games';else if(index===4)td.className='rankings-winpct';else td.className='rankings-record';tr.appendChild(td);});body.appendChild(tr);
    }
    const tracked=champions.reduce((n,c)=>n+Number(rankingRecord(c,rankingFormat).games||0),0),teamSize=Number(rankingFormat[0])||1,matchEstimate=Math.floor(tracked/(teamSize*2));
    q('rankingsSummary').textContent=`${rankingFormat} CHAMPION WIN RATES • ${champions.length} champion${champions.length===1?'':'s'} • ${matchEstimate} tracked match${matchEstimate===1?'':'es'} • Updated: ${stamp}`;
    q('rankingsFoot').textContent='Champion records use W-D-L for every drafted champion. Mutually agreed draws are recorded for both teams; sort order remains win rate, then games played.';
    return;
  }
  head.innerHTML='<tr><th>#</th><th>Player</th><th>Rating</th><th>Record</th><th>Games</th><th>Win %</th></tr>';
  const mine=currentPlayerName().toLowerCase(),players=(latestRankings?.players??[]).filter(p=>Number(rankingRecord(p,rankingFormat).games)>0).sort((a,b)=>(rankingRecord(a,rankingFormat).rank??9999)-(rankingRecord(b,rankingFormat).rank??9999));
  if(!players.length){const tr=document.createElement('tr'),td=document.createElement('td');td.colSpan=6;td.className='rankings-empty';td.textContent=`No ${rankingFormat} ranked matches have been recorded yet.`;tr.appendChild(td);body.appendChild(tr);}
  for(const player of players){
    const r=rankingRecord(player,rankingFormat),tr=document.createElement('tr');if(normalizePlayerName(player.name).toLowerCase()===mine)tr.classList.add('current-player');
    const values=[String(r.rank??'—'),player.name,String(r.rating??latestRankings?.ratingSystem?.initial??1500),recordText(r),String(r.games),`${Number(r.winPct??0).toFixed(1)}%`];
    values.forEach((value,index)=>{const td=document.createElement('td');td.textContent=value;if(index===0)td.className='rankings-rank';else if(index===1)td.className='rankings-name';else if(index===2)td.className='rankings-rating';else if(index===4)td.className='rankings-games';else if(index===5)td.className='rankings-winpct';else td.className='rankings-record';tr.appendChild(td);});body.appendChild(tr);
  }
  const gamesPlayed=Math.floor(players.reduce((n,p)=>n+Number(rankingRecord(p,rankingFormat).games||0),0)/2),system=latestRankings?.ratingSystem??{name:'Elo',initial:1500,kFactor:32};
  q('rankingsSummary').textContent=`${rankingFormat} PLAYER LADDER • ${players.length} ranked player${players.length===1?'':'s'} • ${gamesPlayed} match${gamesPlayed===1?'':'es'} • Updated: ${stamp}`;
  q('rankingsFoot').textContent=`${system.name??'Elo'} ratings are independent for every team size (${system.initial??1500} initial rating, K=${system.kFactor??32}). Records are W-D-L; a draw scores 0.5 in Elo. Rank order follows rating, then wins.`;
}
function openRankings(){
  rankingFormat=`${Number(currentRoom?.config?.teamSize??networkTeamSize)||3}v${Number(currentRoom?.config?.teamSize??networkTeamSize)||3}`;
  q('rankingsModal').classList.remove('hidden');q('rankingsModal').setAttribute('aria-hidden','false');renderRankedPersistence();renderRankings();if(socket?.ws?.readyState===WebSocket.OPEN)socket.requestRankings();else q('rankingsSummary').textContent='Coordinator offline — rankings cannot be refreshed right now.';
}
function closeRankings(){const modal=q('rankingsModal');if(modal.contains(document.activeElement))q('viewRankingsBtn')?.focus();modal.classList.add('hidden');modal.setAttribute('aria-hidden','true');}
function humanServerError(code){
  if(code==='RANKED_NAME_REQUIRED')return 'Choose a player name before entering Ranked.';
  if(code==='RANKED_NAME_IN_USE')return 'That username is already being used by the other player in this ranked room.';
  if(code==='RANKED_NAME_LOCKED')return 'Player names are locked once a ranked room starts.';
  if(code==='RANKED_STORAGE_UNAVAILABLE')return 'Ranked is temporarily unavailable because durable ladder storage is not verified. Check the Rankings storage indicator or coordinator /health status.';
  if(code==='DRAW_PROPOSAL_ONLY_DURING_PLANNING')return 'Draws may be proposed during the action-planning phase between replays.';
  if(code==='DRAW_PROPOSAL_PENDING')return 'A draw proposal is already pending.';
  if(code==='DRAW_PROPOSAL_ONLY_BEFORE_LOCK')return 'Propose a draw before either player locks their actions for the round.';
  if(code==='NO_DRAW_PROPOSAL')return 'There is no active draw proposal to answer.';
  return `Server error: ${code}`;
}
q('viewRankingsBtn').onclick=openRankings;q('closeRankingsButton').onclick=closeRankings;q('rankPlayersButton').onclick=()=>setRankingView('players');q('rankChampionsButton').onclick=()=>setRankingView('champions');for(const b of document.querySelectorAll('[data-ranking-format]'))b.onclick=()=>setRankingFormat(b.dataset.rankingFormat);q('rankingsModal').addEventListener('pointerdown',e=>{if(e.target===q('rankingsModal'))closeRankings();});

async function handleNetworkMessage(msg){
  if(msg.kind==='rankings'||msg.kind==='rankings_updated'){renderRankedPersistence(msg.persistence);renderRankings(msg.standings);return;}
  if(msg.kind==='ranked_storage_error'){renderRankedPersistence(msg.persistence);const text='Ranked result completed, but durable ladder storage could not be verified. New Ranked rooms are blocked until storage recovers.';appendChatSystem(text);scene.setStatus(text);setLobbyStatus(text);return;}
  if(msg.kind==='ranked_match_recorded'){
    renderRankedPersistence(msg.persistence);renderRankings(msg.standings);const mine=(msg.standings?.players??[]).find(p=>normalizePlayerName(p.name).toLowerCase()===currentPlayerName().toLowerCase()),formatRecord=mine?.formats?.[msg.format];
    const note=mine&&formatRecord?`${mine.name} is #${formatRecord.rank} in ${msg.format} at ${formatRecord.rating} (${formatRecord.wins}-${formatRecord.draws??0}-${formatRecord.losses}).`:'Ranked ladder updated.';appendChatSystem(`${msg.draw?'Ranked draw':'Ranked result'} recorded (${msg.format}) — ${note}`);scene.setStatus(`${msg.draw?'Ranked draw':'Ranked result'} recorded — ${note}`);return;
  }
  if(msg.kind==='chat_message'){appendChatMessage(msg);return;}
  if(msg.kind==='player_names'){if(currentRoom&&currentRoom.id===msg.roomId){currentRoom.playerNames=msg.playerNames??currentRoom.playerNames;renderCurrentRoom();if(networkDraftState)renderNetworkDraft();}return;}
  q('connection').textContent=`${msg.kind}${msg.side?` • Side ${msg.side}`:''}${msg.roomId?` • ${msg.roomId}`:''}`;
  scene.log(`[NET] ${msg.kind}`,'system');
  if(msg.kind==='hello_ack'){
    q('lobbyConnectionBadge').textContent='ONLINE';q('lobbyConnectionBadge').className='lobby-badge online';
    setLobbyStatus(`Connected automatically to ${COORDINATOR_URL}. Create a configured room or join an advertised room.`);
    socket?.listRooms();socket?.requestRankings();return;
  }
  if(msg.kind==='rooms'){renderRooms(msg.rooms);return;}
  if(msg.kind==='room_joined'){
    setNetworkRankedMode(Boolean(msg.config?.ranked),{activate:true});
    currentRoom={id:msg.roomId,side:msg.side,config:msg.config??networkConfig(),configLocked:!!msg.configLocked,players:msg.players??1,playerNames:msg.playerNames??{}};
    q('roomId').value=msg.roomId;applyNetworkConfig(currentRoom.config);renderCurrentRoom();
    setLobbyConfigEditable(currentRoom.side===SIDE.A&&!currentRoom.configLocked);
    clearChat();setChatAvailable(true);appendChatSystem(`Connected to room ${msg.roomId} as ${currentPlayerName()} (${msg.side===SIDE.A?'HOST':'PLAYER 2'}). Chat is live for this room.`);
    setLobbyStatus(currentRoom.configLocked?'Both players joined. Configuration locked; draft handoff is ready.':`${currentRoom.config?.ranked?'Ranked r':'R'}oom created/joined. Waiting for Player 2.`);
    return;
  }
  if(msg.kind==='room_config_updated'){
    if(currentRoom&&currentRoom.id===msg.roomId){currentRoom.config=msg.config;setNetworkRankedMode(Boolean(msg.config?.ranked),{activate:true});applyNetworkConfig(msg.config);renderCurrentRoom();}
    setLobbyStatus(`Room configuration updated: ${battleSizeLabel(msg.config.teamSize)} • ${msg.config.draftBansPerPlayer?'1 ban/player':'no bans'} • replay ${normalizeReplaySpeed(msg.config.replaySpeed??0.33).toFixed(2)}×.`);return;
  }
  if(msg.kind==='room_locked'){
    if(currentRoom&&currentRoom.id===msg.roomId){currentRoom.config=msg.config;currentRoom.configLocked=true;currentRoom.players=2;currentRoom.playerNames=msg.playerNames??currentRoom.playerNames;setNetworkRankedMode(Boolean(msg.config?.ranked),{activate:true});applyNetworkConfig(msg.config);renderCurrentRoom();}
    setLobbyConfigEditable(false);q('lobbyConnectionBadge').textContent='ROOM LOCKED';q('lobbyConnectionBadge').className='lobby-badge locked';
    scene.setReplaySpeed(msg.config?.replaySpeed??0.33,{locked:true,notify:false});appendChatSystem('Opponent connected — room locked and draft starting.');
    setLobbyStatus(`${battleSizeLabel(msg.config.teamSize)} lobby locked with both players at replay ${normalizeReplaySpeed(msg.config.replaySpeed??0.33).toFixed(2)}×. ${msg.config.draftBansPerPlayer?'Ban phase enabled: 1 ban per player.':'No draft bans.'} Network draft starting…`);return;
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
    scene.handleNetworkDisconnect(reason);resetDrawUi();setDrawButton({visible:false});showNetworkPanel(true);activateTopButton(activeNetworkButton());setRematchButton({visible:false});setLobbyStatus(reason);return;
  }
  if(msg.kind==='room_closed'){
    scene.handleNetworkDisconnect('Room closed because a player left.');resetDrawUi();setDrawButton({visible:false});resetRoomUi('Room closed because a player left. Create or join another room.');showNetworkPanel(true);activateTopButton(activeNetworkButton());socket?.listRooms();return;
  }
  if(msg.kind==='error'){const human=humanServerError(msg.code);if(String(msg.code??'').startsWith('DRAW_')){hideDrawProposal();setDrawButton({visible:scene.mode==='PVP'&&!networkMatchCompleteConfirmed});scene.setStatus(human);}setLobbyStatus(human);return;}
  if(msg.kind==='socket_closed'){
    const wasPvp=scene.mode==='PVP';
    q('lobbyConnectionBadge').textContent='RECONNECTING…';q('lobbyConnectionBadge').className='lobby-badge';scene.handleNetworkDisconnect('Coordinator connection closed. Reconnecting automatically…');resetDrawUi();setDrawButton({visible:false});resetRoomUi('Connection closed. Reconnecting automatically…');if(wasPvp){showNetworkPanel(true);activateTopButton(activeNetworkButton());}scheduleCoordinatorReconnect();return;
  }
  if(msg.kind==='draw_proposed'){
    const mine=msg.proposedBy===socket?.side;setDrawButton({visible:true,disabled:mine,label:mine?'DRAW PROPOSED — WAITING':'OPPONENT PROPOSED DRAW',pending:true});
    if(mine){appendChatSystem('Draw proposal sent. Waiting for opponent response.');scene.setStatus('Draw proposed. Waiting for opponent…');}
    else{showDrawProposal(msg);appendChatSystem(`${normalizePlayerName(msg.playerNames?.[msg.proposedBy]??'Opponent')} proposed a draw.`);scene.setStatus('Opponent proposed a draw. Accept or decline the proposal.');}
    return;
  }
  if(msg.kind==='draw_declined'){
    resetDrawUi();setDrawButton({visible:true});const expired=msg.reason==='ROUND_LOCKED',copy=expired?'Draw proposal expired when round actions were locked.':'Draw proposal declined. The match continues.';appendChatSystem(copy);scene.setStatus(expired?'Draw proposal expired. Continue the round.':'Draw proposal declined. Continue the match.');return;
  }
  // Stage 25D deterministic battle lifecycle.
  if(msg.kind==='match_started'){
    networkMatchCompleteConfirmed=false;setRematchButton({visible:false});resetDrawUi();setDrawButton({visible:true});
    if(currentRoom){currentRoom.matchNumber=msg.matchNumber??currentRoom.matchNumber;currentRoom.draftPhase=null;currentRoom.playerNames=msg.playerNames??currentRoom.playerNames;renderCurrentRoom();}
    closeNetworkDraft();showNetworkPanel(false);q('lobbyConnectionBadge').textContent=currentRoom?.config?.ranked?'RANKED MATCH':'IN MATCH';q('lobbyConnectionBadge').className='lobby-badge locked';appendChatSystem(`${currentRoom?.config?.ranked?'Ranked match':'Match'} started — room chat remains available in the 2P CHAT tab.`);
    scene.setReplaySpeed(msg.config?.replaySpeed??currentRoom?.config?.replaySpeed??0.33,{locked:true,notify:false});
    hideMatchResult();scene.beginNetworkMatch({matchId:msg.matchId,side:socket.side,timeoutsRemaining:msg.timeoutsRemaining?.[socket.side]??3,teamA:msg.teamA,teamB:msg.teamB});
  }else if(msg.kind==='selection_timeout_granted')scene.applyNetworkTimeout(msg);
  else if(msg.kind==='round_declarations_locked'){setDrawButton({visible:true,disabled:true,label:'DRAW BETWEEN ROUNDS'});}
  else if(msg.kind==='round_package'){setDrawButton({visible:true,disabled:true,label:'DRAW BETWEEN ROUNDS'});scene.receiveNetworkRoundPackage(msg.package);}
  else if(msg.kind==='round_confirmed'){
    const local=await scene.confirmNetworkRound(msg);if(local?.desync)return;
    if(local?.complete)socket?.reportMatchComplete({roundNumber:local.roundNumber,winner:local.outcome?.winner,finalStateHash:local.digest?.finalStateHash,eventStreamHash:local.digest?.eventStreamHash});
    else if(local){scene.setWaitingForOpponent(true);socket?.readyForNextRound({roundNumber:local.roundNumber,finalStateHash:local.digest?.finalStateHash,eventStreamHash:local.digest?.eventStreamHash});}
  }else if(msg.kind==='round_ready_status'){
    const count=msg.readySides?.length??0;scene.setWaitingForOpponent(count<2&&(msg.readySides??[]).includes(socket?.side));scene.setStatus(count<2?`Your replay is complete. Waiting for opponent… (${count}/2 ready)`:`Both replays complete. Opening next round…`);
  }
  else if(msg.kind==='round_open'){scene.setWaitingForOpponent(false);setDrawButton({visible:true});scene.openNetworkRound(msg.roundNumber);}
  else if(msg.kind==='round_desync'||msg.kind==='match_desync'){
    const detail=msg.mismatches?.join(', ')??msg.reason??'HASH_MISMATCH';scene.handleNetworkDisconnect(`DESYNC — ${detail}. Match halted.`);setRematchButton({visible:false});
  }else if(msg.kind==='match_complete_received'){scene.setWaitingForOpponent(false);scene.setStatus(msg.waitingForOpponent?'Match complete locally. Verifying opponent final result…':'Final result received by server.');}
  else if(msg.kind==='match_complete_confirmed'){
    scene.setWaitingForOpponent(false);networkMatchCompleteConfirmed=true;resetDrawUi();setDrawButton({visible:false});if(currentRoom){currentRoom.postMatch=true;renderCurrentRoom();}
    q('lobbyConnectionBadge').textContent=msg.draw?(msg.ranked?'RANKED DRAW':'MATCH DRAW'):(msg.ranked?'RANKED COMPLETE':'MATCH COMPLETE');q('lobbyConnectionBadge').className='lobby-badge locked';setRematchButton({visible:!!msg.rematchAvailable,disabled:false,label:'REQUEST REMATCH'});
    if(msg.draw){scene.showNetworkDraw?.();scene.setStatus(`Draw agreed by both players.${msg.ranked?' Ranked draw recorded.':''} Rematch available.`);}
    else scene.setStatus(`Match result verified by both clients — Side ${msg.winner} wins.${msg.ranked?' Ranked ladder recorded.':''} Rematch available.`);
  }else if(msg.kind==='rematch_status'){
    const voted=(msg.votes??[]).includes(socket?.side);setRematchButton({visible:true,disabled:voted,label:voted?'REMATCH REQUESTED — WAITING':'REQUEST REMATCH'});scene.setStatus(`Rematch votes: ${msg.votes?.length??0}/${msg.required??2}.`);
  }else if(msg.kind==='rematch_start'){
    networkMatchCompleteConfirmed=false;setRematchButton({visible:false});resetDrawUi();setDrawButton({visible:false});hideMatchResult();scene.prepareNetworkRematch();showNetworkPanel(false);if(currentRoom){currentRoom.postMatch=false;currentRoom.draftPhase='DRAFT';renderCurrentRoom();}q('lobbyConnectionBadge').textContent='REMATCH DRAFT';q('lobbyConnectionBadge').className='lobby-badge locked';setLobbyStatus('Both players accepted the rematch. New synchronized draft starting…');
  }
}

for(const b of document.querySelectorAll('[data-network-team-size]'))b.onclick=()=>setNetworkTeamSize(Number(b.dataset.networkTeamSize));
for(const b of document.querySelectorAll('[data-network-replay-speed]'))b.onclick=()=>setNetworkReplaySpeed(Number(b.dataset.networkReplaySpeed));
q('draftBanToggle').addEventListener('change',()=>{if(socket&&currentRoom?.side===SIDE.A&&!currentRoom.configLocked)socket.updateRoomConfig(networkConfig());});
function scheduleCoordinatorReconnect(){
  if(reconnectTimer)return;
  reconnectTimer=setTimeout(()=>{reconnectTimer=null;connectCoordinator();},3000);
}
async function connectCoordinator(){
  if(socket?.ws&&[WebSocket.OPEN,WebSocket.CONNECTING].includes(socket.ws.readyState))return;
  if(!socket){socket=new CoordinatorSocket(COORDINATOR_URL);scene.setNetworkSocket(socket);socket.onMessage(handleNetworkMessage);}
  q('connection').textContent='Coordinator: connecting…';q('lobbyConnectionBadge').textContent='CONNECTING…';q('lobbyConnectionBadge').className='lobby-badge';
  try{
    await socket.connect();
    socket.setPlayerName(currentPlayerName());
    if(reconnectTimer){clearTimeout(reconnectTimer);reconnectTimer=null;}
    q('connection').textContent='Coordinator online';q('lobbyConnectionBadge').textContent='ONLINE';q('lobbyConnectionBadge').className='lobby-badge online';socket.listRooms();
  }catch(e){q('connection').textContent='Coordinator reconnecting…';q('lobbyConnectionBadge').textContent='RETRYING…';q('lobbyConnectionBadge').className='lobby-badge';setLobbyStatus('Multiplayer coordinator is waking up or temporarily unavailable. Retrying automatically…');scheduleCoordinatorReconnect();}
}
q('createRoomBtn').onclick=()=>{
  if(!socket?.ws||socket.ws.readyState!==WebSocket.OPEN)return setLobbyStatus('Coordinator is still connecting. Please wait a moment.');
  const name=savePlayerName();if(networkRankedMode&&name.toLowerCase()==='player')return setLobbyStatus('Choose a player name before creating a Ranked room.');const id=q('roomId').value.trim()||undefined;socket.createRoom({id,...networkConfig()});setLobbyStatus(`Creating ${networkRankedMode?'Ranked ':''}${battleSizeLabel(networkTeamSize)} room…`);
};
q('joinRoomBtn').onclick=()=>{
  if(!socket?.ws||socket.ws.readyState!==WebSocket.OPEN)return setLobbyStatus('Coordinator is still connecting. Please wait a moment.');
  const name=savePlayerName();if(networkRankedMode&&name.toLowerCase()==='player')return setLobbyStatus('Choose a player name before joining Ranked.');const id=q('roomId').value.trim();if(!id)return setLobbyStatus('Enter a room ID or choose an advertised room.');socket.joinRoom(id);setLobbyStatus(`Joining ${id}…`);
};
q('refreshRoomsBtn').onclick=()=>socket?.listRooms();
setLobbyConfigEditable(true);
setNetworkReplaySpeed(0.33,{send:false});
setNetworkRankedMode(false,{activate:false});
activateTopButton(null);
connectCoordinator();

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
q('rosterButton').onclick=()=>{prepareLocalModeSelection();activateTopButton(q('rosterButton'));openRosterPicker();};q('closeRosterButton').onclick=closeRosterPicker;
q('randomRosterButton').onclick=()=>{const pool=[...ROSTER_IDS];for(let i=pool.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[pool[i],pool[j]]=[pool[j],pool[i]];}setRosterPickerValues({teamSize:rosterTeamSize,teamA:pool.slice(0,rosterTeamSize),teamB:pool.slice(rosterTeamSize,rosterTeamSize*2)});q('rosterError').textContent='';};
q('applyRosterButton').onclick=()=>{try{hideMatchResult();scene.configureSinglePlayerTeams(rosterPickerValues(),{source:'roster'});activateTopButton(q('rosterButton'));showNetworkPanel(false);q('rosterError').textContent='';closeRosterPicker();}catch(err){q('rosterError').textContent=err.message;}};
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

q('onePlayerDraftButton').onclick=()=>{prepareLocalModeSelection();activateTopButton(q('onePlayerDraftButton'));openMatchSetup();};
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
  if(!draftState)return;const {teamSize,picksA,picksB}=draftState;if(picksA.length!==teamSize||picksB.length!==teamSize)return;closeDraft();hideMatchResult();scene.configureSinglePlayerTeams({teamA:picksA,teamB:picksB},{source:'vs AI draft'});activateTopButton(q('onePlayerDraftButton'));showNetworkPanel(false);
}
function draftPortraitPath(archetype){return `assets/draft_portraits/${encodeURIComponent(archetype)}.png`;}
function draftPortrait(archetype,className='draft-portrait'){
  const img=document.createElement('img');img.className=className;img.src=draftPortraitPath(archetype);img.alt='';img.loading='lazy';img.decoding='async';img.draggable=false;
  img.onerror=()=>img.classList.add('portrait-missing');return img;
}
function createDraftOption(id,archetype,{banMode=false,disabled=false}={}){
  const b=document.createElement('button');b.className=`draft-option${banMode?' ban-mode':''}`;b.disabled=disabled;
  const portrait=draftPortrait(id,'draft-option-portrait');
  const copy=document.createElement('span');copy.className='draft-option-copy';
  const name=document.createElement('strong');name.textContent=id;
  const desc=document.createElement('small');desc.textContent=archetype?.identity??'ROS2 champion';
  copy.append(name,desc);b.append(portrait,copy);return b;
}
function pickChip(archetype){
  const chip=document.createElement('span');chip.className='draft-pick-chip';
  if(ROSTER_IDS.includes(archetype))chip.appendChild(draftPortrait(archetype,'draft-chip-portrait'));
  const label=document.createElement('span');label.textContent=archetype;chip.appendChild(label);return chip;
}
function renderDraft(){
  if(!draftState)return;const size=draftState.teamSize,turn=draftTurnSide(),mine=turn===SIDE.A;
  q('draftMyTitle').textContent='YOUR PICKS';q('draftOpponentTitle').textContent='CPU PICKS';q('draftBanSummary').classList.add('hidden');q('draftPoolHeading').textContent='Available Champions';
  q('draftTitle').textContent=`Draft — ${battleSizeLabel(size)}`;q('draftTurnChip').textContent=draftComplete()?'Draft complete':(mine?'YOUR PICK':'CPU PICK');q('draftTurnChip').className=`draft-turn-chip ${mine?'mine':'cpu'}`;q('draftProgress').textContent=`${draftState.pickIndex} / ${size*2} picks`;
  const my=q('draftMyPicks'),cpu=q('draftCpuPicks');my.innerHTML='';cpu.innerHTML='';draftState.picksA.forEach(x=>my.appendChild(pickChip(x)));draftState.picksB.forEach(x=>cpu.appendChild(pickChip(x)));
  for(let i=draftState.picksA.length;i<size;i++){const s=document.createElement('span');s.className='draft-pick-chip empty';s.textContent=`Slot ${i+1}`;my.appendChild(s);}for(let i=draftState.picksB.length;i<size;i++){const s=document.createElement('span');s.className='draft-pick-chip empty';s.textContent=`Slot ${i+1}`;cpu.appendChild(s);}
  const filter=q('draftFilter').value.trim().toLowerCase();const pool=q('draftPool');pool.innerHTML='';
  for(const id of draftState.pool){if(filter&&!id.toLowerCase().includes(filter))continue;const archetype=getArchetype(id);const b=createDraftOption(id,archetype,{disabled:!mine||draftComplete()});b.onclick=()=>commitDraftPick(SIDE.A,id);pool.appendChild(b);}
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
  const victory=detail.result==='VICTORY',draw=detail.result==='DRAW';
  const banner=q('matchResultBanner');banner.className=`match-result-banner ${draw?'draw':(victory?'victory':'defeat')}`;
  q('matchResultTitle').textContent=detail.result;
  const a=stats.teamTotals?.A??{damage:0,kills:0,healing:0},b=stats.teamTotals?.B??{damage:0,kills:0,healing:0};
  q('matchResultSummary').textContent=draw?`Mutually agreed draw • Side A ${a.damage.toLocaleString()} damage • Side B ${b.damage.toLocaleString()} damage`:`Winner: Side ${detail.winner} • Side A ${a.damage.toLocaleString()} damage • Side B ${b.damage.toLocaleString()} damage`;
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
q('matchResultRosterButton').onclick=()=>{if(scene.mode==='PVP'&&socket&&currentRoom){try{socket.leaveRoom();}catch{}}hideMatchResult();resetDrawUi();setDrawButton({visible:false});resetRoomUi('Not currently in a room.');activateTopButton(q('rosterButton'));showNetworkPanel(false);openRosterPicker();};

// Stage 24D client lineage marker retained for presentation regression coverage.
