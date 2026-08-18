export class CoordinatorSocket {
  constructor(url){
    this.url=url;this.ws=null;this.listeners=new Set();this.side=null;this.matchId=null;this.roomId=null;this.roomConfig=null;this.roomLocked=false;this.draftState=null;this.matchNumber=0;this.matchComplete=null;
  }
  onMessage(fn){this.listeners.add(fn);return()=>this.listeners.delete(fn);}
  emit(msg){for(const fn of this.listeners)fn(msg);}
  connect(){
    return new Promise((resolve,reject)=>{
      const ws=new WebSocket(this.url);this.ws=ws;
      ws.onopen=()=>resolve(this);
      ws.onerror=(e)=>reject(e);
      ws.onmessage=(e)=>{
        const msg=JSON.parse(e.data);
        if(msg.kind==='room_joined'){
          this.side=msg.side;this.roomId=msg.roomId;this.roomConfig=msg.config??null;this.roomLocked=!!msg.configLocked;
        }
        if(msg.kind==='room_config_updated')this.roomConfig=msg.config??this.roomConfig;
        if(msg.kind==='room_locked'){
          this.roomLocked=true;this.roomConfig=msg.config??this.roomConfig;
        }
        if(msg.kind==='draft_state')this.draftState=msg.state??this.draftState;
        if(msg.kind==='draft_complete')this.draftState=msg.state??this.draftState;
        if(msg.kind==='match_started'){this.matchId=msg.matchId;this.matchNumber=msg.matchNumber??this.matchNumber;this.matchComplete=null;}
        if(msg.kind==='match_complete_confirmed')this.matchComplete=msg;
        if(msg.kind==='rematch_start'){this.matchId=null;this.matchComplete=null;}
        if(msg.kind==='opponent_disconnected'&&msg.roomId===this.roomId)this.roomLocked=!!msg.configLocked;
        this.emit(msg);
      };
      ws.onclose=()=>this.emit({kind:'socket_closed'});
    });
  }
  send(kind,payload={}){
    if(!this.ws||this.ws.readyState!==WebSocket.OPEN)throw new Error('Socket not connected');
    this.ws.send(JSON.stringify({kind,...payload}));
  }
  createRoom({id,teamSize=3,draftBansPerPlayer=0}={}){
    this.send('create_room',{...(id?{id}:{}),teamSize,draftBansPerPlayer});
  }
  joinRoom(id){this.send('join_room',{id});}
  updateRoomConfig({teamSize,draftBansPerPlayer}){this.send('update_room_config',{teamSize,draftBansPerPlayer});}
  listRooms(){this.send('list_rooms');}
  submitDraftBan(archetype){this.send('draft_ban',{archetype});}
  submitDraftPick(archetype){this.send('draft_pick',{archetype});}
  lockDeclarations(declarations,deadlineMetadata){this.send('round_declarations',{declarations,deadlineMetadata});}
  requestTimeout(){this.send('selection_timeout_request');}
  submitDigest(digest){this.send('round_digest',{digest});}
  readyForNextRound({roundNumber,finalStateHash,eventStreamHash}){this.send('round_ready',{roundNumber,finalStateHash,eventStreamHash});}
  reportMatchComplete({roundNumber,winner,finalStateHash,eventStreamHash}){this.send('match_complete',{roundNumber,winner,finalStateHash,eventStreamHash});}
  requestRematch(){this.send('request_rematch');}
  leaveRoom(){this.send('leave_room');}
}
