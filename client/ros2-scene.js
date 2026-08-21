import { SIDE, TARGET_TYPE, LIFE_STATE } from '../src/constants.js';
import { createTeamBattleState, abilityIntent } from '../src/playtest-harness.js';
import { getArchetype, createRosterAbilityDeclaration, ROSTER_IDS } from '../src/roster.js';
import { createHoldDeclaration } from '../src/declarations.js';
import {
  ActionSelectionSession,
  DEFAULT_BOARD_VIEW,
  gridToWorld,
  worldToGrid,
  areaPreviewForAbility,
  actionSummary,
  unitHudModel,
  isImmediateTargetType,
  targetForImmediateAbility,
  describeAuthoritativeEvent,
  combatLogClassForEvent,
  hasControlImpairment,
  shouldFloatStatusFeedback,
  abilityDetailModel,
  compactAbilitySummary,
  abilityUsesRemaining,
  abilityUseText,
  validatePlaytestTeams
} from '../src/client-foundation.js';
import { LocalSinglePlayerMatch, simulateRosterRoundPackage } from '../src/client-match.js';
import { advanceClosedRound } from '../src/status-engine.js';
import { canAcquireDirectHostileTarget } from '../src/targeting.js';
import { DEFAULT_BOARD } from '../src/grid.js';
import { cloneBattleState } from '../src/state.js';
import { PhaserPresentationAdapter, ReplayController, PRESENTATION_COMMAND } from '../src/presentation.js';
import { MatchStatTracker } from './match-awards.js';
import {
  CHAMPION_ANIMATION_IDS,
  CHAMPION_ANIMATION_MANIFESTS,
  animationKey,
  directionFromCells,
  directionFromDelta,
  registerChampionAnimations
} from './champion-animation.js';

const DEFAULT_TEAM_A=['Warrior','Rogue','Mage'];
const DEFAULT_TEAM_B=['Barbarian','Electromancer','Cleric'];
const BENEFICIAL_STATUS_KEYS=new Set(['atk_up','sdm_up','def_up','res_up','guard','magic_shield','divine_shield','physical_shield','shield_redirect','shinobi_haste','invisible','premonition','arcane_echo','regen','shift','bloodlust','counterstance','flurry_style','poison_imbue','bleed_imbue','shadowstep_crit','ward','unstoppable','detection','warhorn_attacks_up','warhorn_movement_up','attacks_max_up','movement_max_up']);
const AFFLICTED_STATUS_KEYS=new Set(['poison','bleed','stun','silence','taunt','berserk','root','suppression','spellbreak','marked','blind','def_down','rend_def_down','atk_down','sdm_down','res_down']);


export class RosBattleScene extends Phaser.Scene {
  constructor(){
    super('RosBattleScene');
    this.mode='SINGLE_PLAYER';
    this.playerSide=SIDE.A;
    this.networkSocket=null;
    this.networkRoundResult=null;
    this.view=DEFAULT_BOARD_VIEW;
    this.unitViews=new Map();
    this.selectedActorId=null;
    this.inspectedUnitId=null;
    this.pendingAbility=null;
    this.busy=false;
    this.replayEventById=new Map();
    this.loggedReplayEventIds=new Set();
    this.replayLogState=null;
    this.timeoutsRemaining=3;
    this.replaySpeed=0.33;
    this.replaySpeedLocked=false;
    this.singlePlayerTeams={teamA:[...DEFAULT_TEAM_A],teamB:[...DEFAULT_TEAM_B]};
    this.singlePlayerTeamSize=3;
    this.chargeFxByActor=new Map();
    this.lastSpellAbilityByActor=new Map();
    this.lastActionByActor=new Map();
    this.matchStats=null;
    this.matchOutcomeShown=false;
  }

  preload(){
    for(const archetypeId of CHAMPION_ANIMATION_IDS){
      const m=CHAMPION_ANIMATION_MANIFESTS[archetypeId];
      this.load.spritesheet(m.textureKey,m.assetPath,{frameWidth:m.frameWidth,frameHeight:m.frameHeight});
    }
    this.load.spritesheet('vfx-mystic-dagger','assets/vfx/mystic-dagger.png',{frameWidth:80,frameHeight:96});
    this.load.image('vfx-mystic-berserk','assets/vfx/mystic-berserk-sigil.png');
    this.load.image('vfx-mystic-stun','assets/vfx/mystic-stun-rings.png');
    this.load.image('vfx-mystic-spellbreak','assets/vfx/mystic-spellbreak-burst.png');
    this.load.image('vfx-mystic-premonition','assets/vfx/mystic-premonition-eye.png');
    this.load.image('vfx-mystic-proc','assets/vfx/mystic-proc-reticle.png');
    this.load.image('vfx-mystic-psychic','assets/vfx/mystic-psychic-pulse.png');
    this.load.image('vfx-warhorn','assets/vfx/warhorn.png');
    this.load.image('vfx-archer-arrow','assets/vfx/archer-arrow-projectile.png');
    this.load.image('vfx-archer-impact','assets/vfx/archer-impact-burst.png');
    this.load.spritesheet('vfx-barbarian-axe','assets/vfx/barbarian-axe-projectile.png',{frameWidth:80,frameHeight:96});
    this.load.image('vfx-barbarian-roar','assets/vfx/barbarian-war-cry-shockwave.png');
    this.load.image('vfx-barbarian-ring','assets/vfx/barbarian-feral-roar-ring.png');
    this.load.image('vfx-barbarian-aura','assets/vfx/barbarian-buff-aura.png');
    this.load.image('vfx-barbarian-rage','assets/vfx/barbarian-rage-burst.png');
    this.load.image('vfx-archer-mark','assets/vfx/archer-hunters-mark.png');
    this.load.image('vfx-archer-focus','assets/vfx/archer-eagle-eye.png');
    this.load.image('vfx-archer-volley','assets/vfx/archer-volley-cluster.png');
    this.load.image('vfx-archer-feather','assets/vfx/archer-feather-sigil.png');
    this.load.image('vfx-archer-cover','assets/vfx/archer-guarding-wind.png');
    this.load.image('vfx-cleric-aura','assets/vfx/cleric-defensive-aura.png');
    this.load.image('vfx-cleric-angel','assets/vfx/cleric-guardian-angel.png');
    this.load.image('vfx-cleric-light','assets/vfx/cleric-piercing-light.png');
    this.load.image('vfx-cleric-blessing','assets/vfx/cleric-enids-blessing.png');
    this.load.image('vfx-cleric-resurrection','assets/vfx/cleric-resurrection.png');
    this.load.image('vfx-cleric-sigil','assets/vfx/cleric-holy-sigil.png');
    this.load.image('vfx-cleric-heal','assets/vfx/cleric-prayer-mend.png');
    this.load.image('vfx-paladin-bash','assets/vfx/paladin-shield-bash.png');
    this.load.image('vfx-paladin-divine','assets/vfx/paladin-divine-shield.png');
    this.load.image('vfx-paladin-cleanse','assets/vfx/paladin-cleanse.png');
    this.load.image('vfx-paladin-sanctify','assets/vfx/paladin-sanctify-ground.png');
    this.load.image('vfx-paladin-judgment','assets/vfx/paladin-judgment-beam.png');
    this.load.image('vfx-paladin-heal','assets/vfx/paladin-heal-pulse.png');
    this.load.image('vfx-paladin-emblem','assets/vfx/paladin-divine-emblem.png');
    this.load.image('vfx-paladin-proc','assets/vfx/paladin-basic-proc.png');
    this.load.image('vfx-necro-target','assets/vfx/necromancer-target-reticle.png');
    this.load.image('vfx-necro-toxic-orb','assets/vfx/necromancer-toxic-orb.png');
    this.load.image('vfx-necro-skull','assets/vfx/necromancer-skull-projectile.png');
    this.load.image('vfx-necro-plague','assets/vfx/necromancer-plague-sigil.png');
    this.load.image('vfx-necro-cloud','assets/vfx/necromancer-poison-cloud.png');
    this.load.image('vfx-necro-bloom','assets/vfx/necromancer-toxic-bloom.png');
    this.load.image('vfx-necro-impact','assets/vfx/necromancer-necrotic-impact.png');
    this.load.image('vfx-necro-rune','assets/vfx/necromancer-death-rune-circle.png');
    this.load.image('vfx-necro-soul','assets/vfx/necromancer-soul-flame.png');
    this.load.image('vfx-necro-mist','assets/vfx/necromancer-grave-mist.png');
    this.load.image('vfx-barbarian-impact','assets/vfx/barbarian-impact-burst.png');
    this.load.image('vfx-barbarian-blood','assets/vfx/barbarian-blood-hit-spark.png');
    this.load.image('vfx-barbarian-rend','assets/vfx/barbarian-finishing-strike.png');
    this.load.image('vfx-electro-storm','assets/vfx/electromancer-electrical-storm.png');
    this.load.image('vfx-electro-shift','assets/vfx/electromancer-shift-flash.png');
    this.load.image('vfx-electro-tempest','assets/vfx/electromancer-god-tempest.png');
    this.load.image('vfx-electro-slash','assets/vfx/electromancer-lightning-slash.png');
    this.load.image('vfx-electro-impact','assets/vfx/electromancer-impact-spark.png');
    this.load.image('vfx-mage-arcane-surge','assets/vfx/mage-arcane-surge.png');
    this.load.image('vfx-mage-arcane-echo','assets/vfx/mage-arcane-echo.png');
    this.load.image('vfx-mage-meteor','assets/vfx/mage-meteor-impact.png');
    this.load.image('vfx-mage-fireball','assets/vfx/mage-fireball-projectile.png');
    this.load.image('vfx-mage-fireball-impact','assets/vfx/mage-fireball-impact.png');
    this.load.image('vfx-mage-ward','assets/vfx/mage-arcane-ward.png');
    this.load.image('vfx-mage-proc','assets/vfx/mage-basic-proc.png');
    this.load.image('vfx-shinobi-invisibility','assets/vfx/shinobi-invisibility-cast.png');
    this.load.image('vfx-shinobi-dispel-cast','assets/vfx/shinobi-dispel-cast.png');
    this.load.image('vfx-shinobi-dispel-target','assets/vfx/shinobi-dispel-target.png');
    this.load.image('vfx-shinobi-haste','assets/vfx/shinobi-thiefs-haste-cast.png');
    this.load.image('vfx-shinobi-regen','assets/vfx/shinobi-regen-potion-cast.png');
    this.load.image('vfx-shinobi-bleed','assets/vfx/shinobi-bleed-burst.png');
    this.load.image('vfx-shinobi-imbue','assets/vfx/shinobi-bleed-imbue-cast.png');
  }

  create(){
    for(const archetypeId of CHAMPION_ANIMATION_IDS)registerChampionAnimations(this,archetypeId);
    this.drawBoard();
    this.input.on('pointermove',p=>this.onPointerMove(p));
    this.input.on('pointerdown',p=>this.onBoardPointer(p));
    this.input.keyboard?.on('keydown-ESC',()=>this.cancelTargeting());
    this.startSinglePlayer();
    window.rosScene=this;
  }

  resetMatchStats(state){
    this.matchStats=new MatchStatTracker(state);
    this.matchOutcomeShown=false;
    try{window.dispatchEvent(new CustomEvent('ros:match-reset'));}catch{}
  }

  recordConfirmedRound(events,roundNumber){
    this.matchStats?.ingestRound(events,roundNumber);
  }

  showMatchComplete(outcome){
    if(this.matchOutcomeShown)return;
    this.matchOutcomeShown=true;
    if(this.timerHandle){clearInterval(this.timerHandle);this.timerHandle=null;}
    const playerSide=this.playerSelectionSide();
    const won=outcome?.winner===playerSide;
    const stats=this.matchStats?.snapshot?.()??null;
    this.setStatus(`${won?'Victory':'Defeat'}. Winner: Side ${outcome?.winner??'—'}.`);
    this.log(`${won?'VICTORY':'DEFEAT'} — Side ${outcome?.winner??'—'} wins the match.`,'system');
    try{
      window.dispatchEvent(new CustomEvent('ros:match-complete',{detail:{
        result:won?'VICTORY':'DEFEAT',winner:outcome?.winner??null,playerSide,stats
      }}));
    }catch{}
  }

  currentState(){ return this.match?.state ?? this.stateView; }
  playerSelectionSide(){ return this.mode==='PVP' ? this.playerSide : SIDE.A; }

  getSinglePlayerTeams(){return {teamSize:this.singlePlayerTeamSize,teamA:[...this.singlePlayerTeams.teamA],teamB:[...this.singlePlayerTeams.teamB]};}

  configureSinglePlayerTeams({teamA,teamB},{source='roster'}={}){
    const check=validatePlaytestTeams(teamA,teamB,ROSTER_IDS);
    if(!check.ok)throw new Error(check.error);
    this.singlePlayerTeams={teamA:[...check.teamA],teamB:[...check.teamB]};
    this.singlePlayerTeamSize=check.teamSize;
    this.startSinglePlayer({source});
    return this.getSinglePlayerTeams();
  }

  startSandbox(){
    this.singlePlayerTeams={teamA:[...DEFAULT_TEAM_A],teamB:[...DEFAULT_TEAM_B]};
    this.singlePlayerTeamSize=3;
    this.startSinglePlayer({source:'sandbox'});
  }

  startSinglePlayer({source='sandbox'}={}){
    this.mode='SINGLE_PLAYER';this.timeoutsRemaining=3;this.setWaitingForOpponent(false);this.setReplaySpeed(this.replaySpeed,{locked:false,notify:false});
    this.clearBattlefield();
    const {teamA,teamB}=this.singlePlayerTeams;
    const state=createTeamBattleState({teamA,teamB,matchId:`STAGE25A-LOCAL-${teamA.length}V${teamB.length}`});
    this.match=new LocalSinglePlayerMatch({state,aiDifficulty:'NORMAL'});
    this.resetMatchStats(this.match.state);
    this.loadState(this.match.state);
    this.newSelectionSession();
    const label=`${teamA.length}v${teamB.length}`;
    this.log(`1P ${source} ${label} ready. Choose a champion from the sidebar, then assign an action. Visual replay defaults to 0.33× speed.`,'system');
    this.setStatus(`1P ${label}. Choose ${this.session.actorIds.length} action${this.session.actorIds.length===1?'':'s'}.`);
  }

  setMode(mode){
    this.mode=mode;
    if(mode==='SINGLE_PLAYER') this.startSandbox();
    else {
      this.clearBattlefield();this.match=null;this.session=null;this.selectedActorId=null;this.inspectedUnitId=null;this.pendingAbility=null;
      this.emitSelectionUi();this.updateTimeControl();
      this.setWaitingForOpponent(false);this.log('2P network mode enabled. The production coordinator connects automatically.','system');
      this.setStatus('Connecting automatically to the multiplayer coordinator. Create or join a room when the lobby is online.');
    }
  }
  setNetworkSocket(socket){this.networkSocket=socket;this.updateTimeControl();}

  beginNetworkMatch({matchId,side,timeoutsRemaining=3,teamA=DEFAULT_TEAM_A,teamB=DEFAULT_TEAM_B}){
    this.mode='PVP';this.playerSide=side;this.timeoutsRemaining=timeoutsRemaining;this.setWaitingForOpponent(false);this.clearBattlefield();
    const check=validatePlaytestTeams(teamA,teamB,ROSTER_IDS);
    if(!check.ok)throw new Error(check.error);
    this.stateView=createTeamBattleState({teamA:check.teamA,teamB:check.teamB,matchId});
    this.resetMatchStats(this.stateView);
    this.loadState(this.stateView);this.newSelectionSession();
    this.log(`2P match ${matchId} started as Side ${side} (${check.teamSize}v${check.teamSize}).`,'system');
    this.setStatus(`Side ${side}: choose ${this.session.actorIds.length} action${this.session.actorIds.length===1?'':'s'}.`);this.updateTimeControl();
  }

  receiveNetworkRoundPackage(pkg){
    if(this.mode!=='PVP')return;this.setWaitingForOpponent(false);
    try{
      this.networkRoundResult=simulateRosterRoundPackage({baseState:this.stateView,roundPackage:pkg});
      this.log(`Round package ${pkg.roundNumber}: seed ${pkg.gameplaySeed}; ${this.networkRoundResult.events.length} events.`,'system');
      this.networkSocket?.submitDigest(this.networkRoundResult.digest);
      this.setStatus('Simulation complete. Waiting for opponent digest confirmation…');
    }catch(err){this.setStatus(`Network simulation error: ${err.message}`);}
  }

  async confirmNetworkRound(confirmation=null){
    if(!this.networkRoundResult)return null;this.setWaitingForOpponent(false);
    const result=this.networkRoundResult;
    if(confirmation){
      const stateMismatch=confirmation.finalStateHash&&confirmation.finalStateHash!==result.digest.finalStateHash;
      const eventMismatch=confirmation.eventStreamHash&&confirmation.eventStreamHash!==result.digest.eventStreamHash;
      if(stateMismatch||eventMismatch){
        this.busy=true;this.setStatus(`DESYNC: server confirmation hash does not match local simulation (${stateMismatch?'state ':''}${eventMismatch?'events':''}).`);
        return {desync:true,roundNumber:result.digest.roundNumber,digest:result.digest};
      }
    }
    this.prepareReplayLog(result.events,this.stateView);
    const replay=new ReplayController({events:result.events,adapter:this.makePresentationAdapter()});
    await replay.playAll();
    this.stateView=cloneBattleState(result.sim.state);this.syncHud();this.recordConfirmedRound(result.events,result.sim.state.roundNumber);
    this.log(`ROUND CONFIRMED — ${result.digest.finalStateHash.slice(0,8)} / ${result.digest.eventStreamHash.slice(0,8)}.`,'system');
    if(result.sim.state.outcome.status==='COMPLETE'){
      const outcome=structuredClone(result.sim.state.outcome),roundNumber=result.digest.roundNumber;this.networkRoundResult=null;this.busy=false;this.showMatchComplete(outcome);
      return {complete:true,outcome,roundNumber,digest:result.digest};
    }
    const roundNumber=result.digest.roundNumber;advanceClosedRound(result.sim);this.stateView=cloneBattleState(result.sim.state);this.networkRoundResult=null;this.busy=false;
    this.setStatus(`Round ${this.stateView.roundNumber} confirmed locally. Waiting for opponent replay readiness…`);
    return {complete:false,roundNumber,digest:result.digest};
  }

  handleNetworkDisconnect(reason='Opponent disconnected.'){
    if(this.mode!=='PVP')return;this.setWaitingForOpponent(false);
    if(this.timerHandle){clearInterval(this.timerHandle);this.timerHandle=null;}
    this.networkRoundResult=null;this.busy=true;this.session=null;this.pendingAbility=null;this.selectedActorId=null;
    this.emitSelectionUi();this.updateTimeControl();this.setStatus(reason);this.log(reason,'system');
  }

  prepareNetworkRematch(){
    this.setWaitingForOpponent(false);if(this.timerHandle){clearInterval(this.timerHandle);this.timerHandle=null;}
    this.networkRoundResult=null;this.busy=false;this.session=null;this.pendingAbility=null;this.selectedActorId=null;this.inspectedUnitId=null;
    this.clearBattlefield();this.match=null;this.stateView=null;this.matchStats=null;this.matchOutcomeShown=false;
    try{window.dispatchEvent(new CustomEvent('ros:match-reset'));}catch{}
    this.emitSelectionUi();this.updateTimeControl();this.setStatus('Rematch accepted. Waiting for the new network draft.');
  }

  openNetworkRound(roundNumber){
    if(this.mode!=='PVP'||this.stateView?.roundNumber!==roundNumber)return;this.setWaitingForOpponent(false);
    this.newSelectionSession();this.syncHud();this.setStatus(`Round ${roundNumber}. Choose ${this.session.actorIds.length} action${this.session.actorIds.length===1?'':'s'}.`);
  }

  drawBoard(){
    this.gridGraphics=this.add.graphics().setDepth(-1000);this.previewGraphics=this.add.graphics();
    const {originX,originY}=this.view,cellWidth=this.view.cellWidth??this.view.cellSize,cellHeight=this.view.cellHeight??this.view.cellSize;
    for(let r=0;r<DEFAULT_BOARD.height;r++)for(let c=0;c<DEFAULT_BOARD.width;c++){
      const x=originX+c*cellWidth,y=originY+r*cellHeight;
      this.gridGraphics.fillStyle((r+c)%2?0x172333:0x1c2a3b,1).fillRect(x,y,cellWidth-1,cellHeight-1);
      this.gridGraphics.lineStyle(1,0x344967,.55).strokeRect(x,y,cellWidth-1,cellHeight-1);
    }
    for(let c=0;c<DEFAULT_BOARD.width;c++)this.add.text(originX+c*cellWidth+cellWidth/2,originY-14,String.fromCharCode(65+c),{fontFamily:'monospace',fontSize:'10px',color:'#7188a8'}).setOrigin(.5);
    for(let r=0;r<DEFAULT_BOARD.height;r++)this.add.text(originX-11,originY+r*cellHeight+cellHeight/2,String(r+1),{fontFamily:'monospace',fontSize:'10px',color:'#7188a8'}).setOrigin(.5);
  }

  clearBattlefield(){
    for(const actorId of this.chargeFxByActor?.keys?.()??[])this.clearChargeFx(actorId);
    this.lastSpellAbilityByActor?.clear?.();
    this.lastActionByActor?.clear?.();
    for(const v of this.unitViews.values())v.container.destroy(true);
    this.unitViews.clear();this.previewGraphics?.clear();
  }

  loadState(state){
    this.stateView=structuredClone(state);
    for(const unit of Object.values(state.units).sort((a,b)=>a.unitId.localeCompare(b.unitId)))this.createUnitView(unit);
    this.syncHud();this.emitSelectionUi();
  }

  unitIsInvisible(unit){return Boolean((unit?.statuses??[]).some(s=>String(s.key).toLowerCase()==='invisible'));}

  unitDepthFor(unit,position=unit?.position){
    const row=Number(position?.row??0);
    const slot=Math.max(0,Number(unit?.draftSlot??0));
    const sideTie=unit?.side===SIDE.B ? 0.0005 : 0;
    return -500+row+(slot*.001)+sideTie;
  }

  syncUnitDepth(v,position=v?.unit?.position){
    if(!v?.container)return;
    v.container.setDepth(this.unitDepthFor(v.unit,position));
  }

  syncUnitDepthFromWorldY(v){
    if(!v?.container)return;
    const cellHeight=this.view.cellHeight??this.view.cellSize;
    const rowFloat=(v.container.y-this.view.originY-(cellHeight/2))/cellHeight;
    const slot=Math.max(0,Number(v.unit?.draftSlot??0));
    const sideTie=v.unit?.side===SIDE.B?.0005:0;
    v.container.setDepth(-500+rowFloat+(slot*.001)+sideTie);
  }

  refreshStealthVisual(v){
    if(!v)return;
    const invisible=this.unitIsInvisible(v.unit);
    v.body?.setAlpha(invisible?.38:1);
    v.sprite?.setAlpha(invisible?.38:1);
    v.name?.setAlpha(invisible?.55:1);
  }

  nameColorForUnit(unit){
    return unit?.side===this.playerSelectionSide() ? '#ffffff' : '#ff6b6b';
  }

  applyUnitNameStyle(v){
    if(!v?.name||!v?.unit)return;
    const color=this.nameColorForUnit(v.unit);
    if(v.name.setColor)v.name.setColor(color);
    else v.name.style.color=color;
  }

  refreshStatusDots(v,unit=v?.unit){
    if(!v||!unit)return;
    const alive=unit.lifeState===LIFE_STATE.ALIVE;
    const keys=new Set((unit.statuses??[]).map(s=>String(s.key??'').toLowerCase()));
    v.buffDot?.setVisible(alive&&[...keys].some(k=>BENEFICIAL_STATUS_KEYS.has(k)));
    v.afflictDot?.setVisible(alive&&[...keys].some(k=>AFFLICTED_STATUS_KEYS.has(k)));
    v.controlDot?.setVisible(alive&&hasControlImpairment(unit));
  }

  createUnitView(unit){
    const pos=gridToWorld(unit.position,this.view), sideA=unit.side===SIDE.A;
    const animated=Boolean(CHAMPION_ANIMATION_MANIFESTS[unit.archetypeId]);
    const selectRing=this.add.ellipse(0,15,58,28,0x8fd4ff,0).setStrokeStyle(3,0x8fd4ff,.26).setVisible(false);
    const targetRing=this.add.ellipse(0,15,54,26,0x70e0ff,0).setStrokeStyle(2,0x70e0ff,.50).setVisible(false);
    const body=this.add.rectangle(0,0,40,36,sideA?0x3d72b8:0xb84a4a,1).setStrokeStyle(2,sideA?0xaed3ff:0xffc1c1).setVisible(!animated);
    let sprite=null;
    const facing=sideA?'E':'W';
    if(animated){
      const manifest=CHAMPION_ANIMATION_MANIFESTS[unit.archetypeId];
      sprite=this.add.sprite(0,20,manifest.textureKey).setOrigin(.5,1).setScale(manifest.renderScale??2.0);
      sprite.play(animationKey(unit.archetypeId,'idle',facing));
    }
    const name=this.add.text(0,animated?-64:-2,unit.archetypeId,{fontFamily:'monospace',fontSize:animated?'9px':'10px',fontStyle:'bold',color:'#ffffff',backgroundColor:animated?'#05070a99':undefined,padding:animated?{x:2,y:1}:undefined}).setOrigin(.5);
    const id=this.add.text(0,animated?15:10,unit.unitId,{fontFamily:'monospace',fontSize:'9px',color:'#d7e3f5'}).setOrigin(.5).setVisible(false);
    const hpBg=this.add.rectangle(0,24,44,5,0x240000);
    const hp=this.add.rectangle(-22,24,44,5,0x55d66b).setOrigin(0,.5);
    const buffDot=this.add.circle(-12,-51,5,0x52d273,1).setStrokeStyle(2,0xc8ffd5,1).setVisible(false);
    const afflictDot=this.add.circle(0,-51,5,0xe05a62,1).setStrokeStyle(2,0xffc2c7,1).setVisible(false);
    const controlDot=this.add.circle(12,-51,5,0xb56cff,1).setStrokeStyle(2,0xe3c7ff,1).setVisible(false);
    const hitTarget=this.add.rectangle(0,-20,58,76,0xffffff,.001).setInteractive({cursor:'zoom-in'});
    hitTarget.on('pointerdown',(_p,_lx,_ly,event)=>{event?.stopPropagation?.();this.onUnitClicked(unit.unitId);});
    const children=[selectRing,targetRing,body];if(sprite)children.push(sprite);children.push(name,id,hpBg,hp,buffDot,afflictDot,controlDot,hitTarget);
    const c=this.add.container(pos.x,pos.y,children);
    const view={container:c,selectRing,targetRing,body,sprite,name,id,hp,hpBg,buffDot,afflictDot,controlDot,hitTarget,unit:structuredClone(unit),animated,facing};
    this.unitViews.set(unit.unitId,view);this.syncUnitDepth(view,unit.position);this.refreshStealthVisual(view);this.refreshStatusDots(view,unit);this.applyUnitNameStyle(view);
  }

  syncUnitView(unit){
    const v=this.unitViews.get(unit.unitId);if(!v)return;
    v.unit=structuredClone(unit);
    const p=gridToWorld(unit.position,this.view);v.container.setPosition(p.x,p.y);this.syncUnitDepth(v,unit.position);
    const alive=unit.lifeState===LIFE_STATE.ALIVE;
    if(v.animated){
      v.container.setAlpha(alive?1:.6).setAngle(0);
      if(alive && v.sprite && !v.sprite.anims?.isPlaying)this.playIdle(v);
      if(!alive && v.sprite){const manifest=CHAMPION_ANIMATION_MANIFESTS[unit.archetypeId];v.sprite.stop();v.sprite.setFrame(manifest?.ko?.at(-1)??0);}
    }else v.container.setAlpha(alive?1:.38).setAngle(alive?0:90);
    v.body.setStrokeStyle(2,unit.side===SIDE.A?0xaed3ff:0xffc1c1);
    v.hp.width=44*Math.max(0,unit.stats.hp/unit.stats.maxHP);
    this.refreshStatusDots(v,unit);this.refreshStealthVisual(v);this.applyUnitNameStyle(v);
    this.refreshUnitHighlights();
  }

  syncHud(){
    if(!this.stateView)return;
    for(const u of Object.values(this.stateView.units))this.syncUnitView(u);
    document.getElementById('roundNo').textContent=String(this.stateView.roundNumber);
    this.updateLockedActions();
    if(this.inspectedUnitId)this.renderSelectedUnit();
  }

  refreshUnitHighlights(){
    const state=this.currentState();
    for(const [id,v] of this.unitViews){
      const unit=state?.units?.[id] ?? v.unit;
      v.selectRing.setVisible(id===this.inspectedUnitId);
      const canBeTargeted=this.pendingAbility?.targetType===TARGET_TYPE.UNIT && this.isLegalPendingUnitTarget(id);
      v.targetRing.setVisible(Boolean(canBeTargeted));
      if(v.hitTarget?.input)v.hitTarget.input.cursor=this.pendingAbility?(canBeTargeted||this.pendingAbility.targetType===TARGET_TYPE.GROUND?'pointer':'not-allowed'):'zoom-in';
    }
  }

  newSelectionSession(){
    this.session=new ActionSelectionSession({state:this.currentState(),side:this.playerSelectionSide()});
    this.selectedActorId=this.session.actorIds[0]??null;
    this.inspectedUnitId=this.selectedActorId;
    this.pendingAbility=null;
    this.startTimerLoop();this.emitSelectionUi();this.updateLockedActions();this.refreshUnitHighlights();this.updateTimeControl();
  }

  startTimerLoop(){
    if(this.timerHandle)clearInterval(this.timerHandle);
    const tick=()=>{
      if(!this.session)return;
      const ms=this.session.remainingMs(),s=Math.ceil(ms/1000),el=document.getElementById('timer');
      el.textContent=this.session.isPaused()?'PAUSED':`${String(Math.floor(s/60)).padStart(2,'0')}:${String(s%60).padStart(2,'0')}`;
      el.classList.toggle('danger',!this.session.isPaused()&&s<=20);
      this.updateTimeControl();
      if(ms<=0&&!this.session.locked&&!this.session.isPaused()){clearInterval(this.timerHandle);this.submitActions(true);}
    };
    tick();this.timerHandle=setInterval(tick,250);
  }

  updateTimeControl(){
    const b=document.getElementById('timeControlButton');if(!b)return;
    if(this.mode==='SINGLE_PLAYER'){
      b.textContent=this.session?.isPaused()?'RESUME':'PAUSE';
      b.disabled=!this.session||this.session.locked||this.busy;
      b.title='Pause or resume the single-player action-selection clock.';
    }else{
      b.textContent=`TIMEOUT +1:00 (${this.timeoutsRemaining} left)`;
      b.disabled=!this.session||this.session.locked||this.busy||this.timeoutsRemaining<=0||!this.networkSocket;
      b.title='Spend one of your three match timeouts to add 60 seconds for both players.';
    }
  }

  replayDuration(baseMs){ return Math.max(1,Math.round(baseMs/this.replaySpeed)); }

  setWaitingForOpponent(show,detail='Your replay is complete. The next round will open when the other player finishes theirs.'){
    const el=document.getElementById('opponentWaitIndicator');if(!el)return;
    el.classList.toggle('hidden',!show);
    const small=el.querySelector('small');if(small&&detail)small.textContent=detail;
  }

  setReplaySpeed(value,{locked=this.replaySpeedLocked,notify=true}={}){
    const speeds=[0.25,0.33,0.5],n=Number(value);
    this.replaySpeed=speeds.includes(n)?n:0.33;
    this.replaySpeedLocked=Boolean(locked);
    const b=document.getElementById('replaySpeedButton');
    if(b){
      b.textContent=`REPLAY ${this.replaySpeed.toFixed(2)}×${this.replaySpeedLocked?' 🔒':''}`;
      b.disabled=this.replaySpeedLocked;
      b.title=this.replaySpeedLocked?'Replay speed locked by the match host for both players.':'Cycle visual replay speed: 0.25×, 0.33×, 0.50×.';
    }
    if(notify)this.setStatus(this.replaySpeedLocked?`Replay speed locked by host at ${this.replaySpeed.toFixed(2)}×.`:`Visual replay speed set to ${this.replaySpeed.toFixed(2)}×. Combat simulation timing is unchanged.`);
    return this.replaySpeed;
  }

  toggleReplaySpeed(){
    if(this.replaySpeedLocked){this.setStatus(`Replay speed is locked by the match host at ${this.replaySpeed.toFixed(2)}×.`);return;}
    const speeds=[0.25,0.33,0.5];
    const i=speeds.indexOf(this.replaySpeed);
    this.setReplaySpeed(speeds[(i+1+speeds.length)%speeds.length],{locked:false,notify:true});
  }

  handleTimeControl(){
    if(!this.session||this.session.locked)return;
    if(this.mode==='SINGLE_PLAYER'){
      const paused=this.session.isPaused()? (this.session.resume(),false) : (this.session.pause(),true);
      this.updateTimeControl();
      this.setStatus(paused?'Action timer paused. Inspect the battlefield/log as long as you need.':'Action timer resumed.');
      return;
    }
    if(this.mode==='PVP'&&this.timeoutsRemaining>0){
      try{this.networkSocket?.requestTimeout();this.setStatus('Timeout requested…');}catch(err){this.setStatus(`Timeout request failed: ${err.message}`);}
    }
  }

  applyNetworkTimeout(msg){
    if(this.mode!=='PVP'||!this.session||msg.roundNumber!==this.currentState()?.roundNumber)return;
    this.session.extend(msg.extraMs??60000);
    if(msg.remainingBySide&&this.playerSide)this.timeoutsRemaining=msg.remainingBySide[this.playerSide]??this.timeoutsRemaining;
    this.updateTimeControl();
    this.log(`Side ${msg.requestedBySide} used a timeout: +${Math.round((msg.extraMs??60000)/1000)} seconds.`,'system');
    this.setStatus(`Timeout granted. ${this.timeoutsRemaining} of your timeouts remain.`);
  }

  inspectUnit(unitId){
    const unit=this.currentState()?.units?.[unitId];if(!unit)return;
    this.inspectedUnitId=unitId;this.renderSelectedUnit();this.refreshUnitHighlights();
    const sideLabel=unit.side===this.playerSelectionSide()?'ALLY':'ENEMY';
    this.setStatus(`Inspecting ${unit.archetypeId} (${unitId}) — ${sideLabel}.`);
  }

  selectActor(unitId){
    if(this.busy||!this.session)return;
    const unit=this.currentState()?.units?.[unitId];
    if(!unit||unit.side!==this.playerSelectionSide()||unit.lifeState!==LIFE_STATE.ALIVE)return;
    this.pendingAbility=null;this.clearPreview();this.selectedActorId=unitId;this.inspectedUnitId=unitId;
    this.emitSelectionUi();this.refreshUnitHighlights();
    this.setStatus(`Editing ${unit.archetypeId} (${unitId}). Choose or change this round's action.`);
  }

  isLegalPendingUnitTarget(unitId){
    if(!this.pendingAbility||this.pendingAbility.targetType!==TARGET_TYPE.UNIT)return false;
    const state=this.currentState(),actor=state?.units?.[this.selectedActorId],unit=state?.units?.[unitId];
    if(!actor||!unit)return false;
    if(this.pendingAbility.deadTargetOnly===true)return unit.side===actor.side&&unit.lifeState===LIFE_STATE.DEAD;
    if(this.pendingAbility.allowDeadTarget===true)return unit.side===actor.side;
    if(unit.lifeState!==LIFE_STATE.ALIVE)return false;
    const intent=abilityIntent(this.pendingAbility);
    if(intent==='ALLY')return unit.side===actor.side;
    if(intent==='ANY')return true;
    if(unit.side===actor.side)return false;
    if(this.pendingAbility.allowInvisibleTarget===true)return true;
    return canAcquireDirectHostileTarget(state,actor.unitId,unit.unitId);
  }

  onUnitClicked(unitId){
    const unit=this.currentState()?.units?.[unitId];if(!unit)return;
    if(!this.busy&&this.pendingAbility?.targetType===TARGET_TYPE.GROUND){
      // Ground-targeted AoE takes targeting priority even when the chosen cell is occupied.
      // This deliberately permits dropping Fireball/Volley directly onto an ally's square.
      this.commitPendingTarget({type:TARGET_TYPE.GROUND,row:unit.position.row,col:unit.position.col});return;
    }
    if(!this.busy&&this.pendingAbility?.targetType===TARGET_TYPE.UNIT){
      if(!this.isLegalPendingUnitTarget(unitId)){this.setStatus(`Illegal target for ${this.pendingAbility.label}.`);return;}
      this.commitPendingTarget({type:TARGET_TYPE.UNIT,unitId});return;
    }
    this.inspectUnit(unitId);
  }

  cancelTargeting(){
    if(!this.pendingAbility)return;
    const label=this.pendingAbility.label;
    this.pendingAbility=null;this.clearPreview();this.emitSelectionUi();this.refreshUnitHighlights();
    this.setStatus(`${label} targeting cancelled. Choose an action.`);
  }

  chooseAbility(abilityId){
    if(!this.selectedActorId||this.busy)return;
    const state=this.currentState(),actor=state.units[this.selectedActorId];
    const ability=getArchetype(actor.archetypeId).abilities.find(a=>a.id===abilityId);if(!ability)return;
    if(abilityUsesRemaining(actor,ability)===0){
      this.pendingAbility=null;this.emitSelectionUi();this.refreshUnitHighlights();
      this.setStatus(`${ability.label} has no uses remaining this match.`);
      return;
    }
    if(isImmediateTargetType(ability.targetType)){
      this.pendingAbility=null;this.commitAbility(ability,targetForImmediateAbility(ability.targetType));return;
    }
    this.pendingAbility=ability;this.emitSelectionUi();this.refreshUnitHighlights();
    this.setStatus(ability.targetType===TARGET_TYPE.GROUND
      ? `${ability.label}: TARGETING MODE — click a battlefield cell. ESC cancels.`
      : ability.deadTargetOnly===true
        ? `${ability.label}: TARGETING MODE — click a KO'd allied corpse. Living allies are not valid targets. ESC cancels.`
        : `${ability.label}: TARGETING MODE — click a champion. Use the sidebar to switch actors. ESC cancels.`);
  }

  onBoardPointer(pointer){
    if(this.busy||!this.pendingAbility||this.pendingAbility.targetType!==TARGET_TYPE.GROUND)return;
    const cell=worldToGrid({x:pointer.worldX,y:pointer.worldY},this.currentState().board,this.view);
    if(cell)this.commitPendingTarget({type:TARGET_TYPE.GROUND,...cell});
  }

  onPointerMove(pointer){
    if(!this.pendingAbility||this.pendingAbility.targetType!==TARGET_TYPE.GROUND)return this.clearPreview();
    const state=this.currentState();
    const cell=worldToGrid({x:pointer.worldX,y:pointer.worldY},state.board,this.view);
    if(!cell)return this.clearPreview();
    this.showPreview(areaPreviewForAbility(state.board,state.units[this.selectedActorId].archetypeId,this.pendingAbility.id,cell));
  }

  showPreview(cells){
    this.previewGraphics.clear();
    for(const cell of cells){
      const cw=this.view.cellWidth??this.view.cellSize,ch=this.view.cellHeight??this.view.cellSize;
      const x=this.view.originX+cell.col*cw,y=this.view.originY+cell.row*ch;
      this.previewGraphics.fillStyle(0xf5b942,.28).fillRect(x+2,y+2,cw-5,ch-5);
    }
  }
  clearPreview(){this.previewGraphics?.clear();}

  commitPendingTarget(target){
    const ability=this.pendingAbility;this.pendingAbility=null;this.clearPreview();this.emitSelectionUi();this.refreshUnitHighlights();
    if(ability)this.commitAbility(ability,target);
  }

  flashCommittedGround(ability,target){
    if(target?.type!==TARGET_TYPE.GROUND)return;
    const state=this.currentState(),actor=state?.units?.[this.selectedActorId];if(!state||!actor)return;
    const cells=areaPreviewForAbility(state.board,actor.archetypeId,ability.id,target);
    this.previewGraphics.clear();
    for(const cell of cells){const cw=this.view.cellWidth??this.view.cellSize,ch=this.view.cellHeight??this.view.cellSize;const x=this.view.originX+cell.col*cw,y=this.view.originY+cell.row*ch;this.previewGraphics.fillStyle(0x72e68f,.38).fillRect(x+2,y+2,cw-5,ch-5);}
    this.time.delayedCall(550,()=>{if(!this.pendingAbility)this.clearPreview();});
  }

  advanceAfterCommit(summary,committedActorId){
    this.updateLockedActions();
    const missing=this.session.missingActorIds();
    if(missing.length){
      const order=this.session.actorIds,idx=order.indexOf(committedActorId);
      const next=order.slice(idx+1).concat(order.slice(0,idx+1)).find(id=>missing.includes(id))??missing[0];
      this.selectedActorId=next;this.inspectedUnitId=next;this.pendingAbility=null;this.emitSelectionUi();this.refreshUnitHighlights();
      const u=this.currentState().units[next];this.setStatus(`✓ ${summary} locked. Next: ${u.archetypeId} (${next}).`);
    }else{
      this.pendingAbility=null;this.emitSelectionUi();this.refreshUnitHighlights();
      this.setStatus(`✓ ${summary} locked. All actions assigned — review, then LOCK ACTIONS.`);
      const panel=document.getElementById('commandPanel'),button=document.getElementById('submitButton');
      button?.classList.add('attention');panel?.scrollIntoView({behavior:'smooth',block:'nearest'});
      setTimeout(()=>button?.classList.remove('attention'),1600);
    }
  }

  commitAbility(ability,target){
    try{
      const state=this.currentState(),actor=state.units[this.selectedActorId],actorId=actor.unitId;
      if(abilityUsesRemaining(actor,ability)===0)throw new Error(`${ability.label} has no uses remaining this match.`);
      if(ability.deadTargetOnly===true){
        const targetUnit=target?.type===TARGET_TYPE.UNIT?state.units[target.unitId]:null;
        if(!targetUnit||targetUnit.side!==actor.side||targetUnit.lifeState!==LIFE_STATE.DEAD)throw new Error(`${ability.label} can only target a KO'd allied corpse.`);
      }
      const d=createRosterAbilityDeclaration({roundNumber:state.roundNumber,actorId,archetypeId:actor.archetypeId,abilityId:ability.id,target});
      this.session.setDeclaration(d);this.flashCommittedGround(ability,target);
      this.advanceAfterCommit(`${actor.archetypeId}: ${actionSummary(d,state)}`,actorId);
    }catch(err){this.setStatus(`Illegal target/action: ${err.message}`);}
  }

  holdSelected(){
    if(!this.selectedActorId||this.busy)return;
    const state=this.currentState(),actorId=this.selectedActorId;
    const d=createHoldDeclaration({declarationId:`D${state.roundNumber}:${actorId}`,roundNumber:state.roundNumber,actorId});
    this.session.setDeclaration(d);this.advanceAfterCommit(`${state.units[actorId].archetypeId}: HOLD`,actorId);
  }

  async submitActions(timeout=false){
    if(this.busy||!this.session)return;this.busy=true;
    try{
      this.cancelTargeting();
      const decls=this.session.lock({fillMissingWithHold:true});clearInterval(this.timerHandle);
      if(this.mode==='PVP'){
        this.networkSocket?.lockDeclarations(decls,{selectionMs:120000,timedOut:timeout});
        this.setStatus(timeout?'Timer expired — missing actions became HOLD; declarations sent.':'Actions locked and sent privately. Waiting for opponent…');return;
      }
      this.setStatus(timeout?'Timer expired — missing actions became HOLD.':'Actions locked. Simulating authoritative round…');
      const roundStartState=cloneBattleState(this.match.state);
      const result=this.match.resolveRound(decls);
      this.log(`Round ${this.match.state.roundNumber}: seed ${result.roundPackage.gameplaySeed}; ${result.events.length} authoritative events.`,'system');
      this.prepareReplayLog(result.events,roundStartState);
      const replay=new ReplayController({events:result.events,adapter:this.makePresentationAdapter()});
      await replay.playAll();
      this.stateView=structuredClone(result.sim.state);this.syncHud();
      this.recordConfirmedRound(result.events,result.sim.state.roundNumber);
      this.log(`ROUND CONFIRMED — state ${result.digest.finalStateHash.slice(0,8)} / events ${result.digest.eventStreamHash.slice(0,8)}.`,'system');
      if(result.sim.state.outcome.status==='COMPLETE'){
        this.showMatchComplete(result.sim.state.outcome);return;
      }
      this.match.advanceRound();this.stateView=structuredClone(this.match.state);this.busy=false;this.newSelectionSession();this.syncHud();
      this.setStatus(`Round ${this.stateView.roundNumber}. Choose ${this.session.actorIds.length} action${this.session.actorIds.length===1?'':'s'}.`);
    }catch(err){console.error(err);this.setStatus(`Round error: ${err.message}`);this.busy=false;}
    finally{if(this.mode!=='PVP')this.busy=false;}
  }

  prepareReplayLog(events,state){
    this.replayEventById=new Map(events.map(e=>[e.eventId,e]));
    this.loggedReplayEventIds=new Set();this.replayLogState=structuredClone(state);
  }

  logReplayEventId(id){
    if(!id||this.loggedReplayEventIds.has(id))return;
    this.loggedReplayEventIds.add(id);
    const event=this.replayEventById.get(id);if(!event)return;
    const text=describeAuthoritativeEvent(event,this.replayLogState);
    if(text)this.log(text,combatLogClassForEvent(event));
  }

  logReplayCommand(command){this.logReplayEventId(command?.sourceEventId);}

  async simultaneousFeedback(command){
    const entries=command.payload?.events??[];
    for(const entry of entries)this.logReplayEventId(entry.eventId);
    const statusTypes=new Set(['STATUS_APPLY','STATUS_TICK','STATUS_DURATION','STATUS_REMOVE','STATUS_EXPIRE','STUN','SILENCE','TAUNT','BERSERK']);
    await Promise.all(entries.map(entry=>{
      const pseudo={actorId:entry.actorId,targetId:entry.targetId,payload:{eventType:entry.type,...entry.payload}};
      if(entry.type==='DAMAGE')return this.damageFeedback(pseudo);
      if(entry.type==='HEAL')return this.healFeedback(pseudo);
      if(statusTypes.has(entry.type))return this.statusFeedback(pseudo);
      return Promise.resolve();
    }));
  }

  updatePresentationStatus(command){
    const id=command.targetId??command.actorId,v=this.unitViews.get(id);if(!v)return;
    const p=command.payload??{},key=String(p.key??'').toLowerCase(),eventType=p.eventType;
    if(key){
      if(eventType==='STATUS_APPLY'){
        const idx=(v.unit.statuses??[]).findIndex(x=>String(x.key).toLowerCase()===key);
        if(key==='poison'&&p.contribution){
          const contribution=structuredClone(p.contribution);
          if(idx>=0){
            const existing=v.unit.statuses[idx];existing.sourceId=command.actorId??existing.sourceId??null;existing.data??={};existing.data.contributions??=[];existing.data.contributions.push(contribution);
          }else (v.unit.statuses??=[]).push({key,duration:null,sourceId:command.actorId??null,data:{contributions:[contribution]}});
        }else{
          const next={key,duration:Number.isInteger(p.duration)?p.duration:null,sourceId:command.actorId??null,data:structuredClone(p.data??{})};
          if(idx>=0)v.unit.statuses[idx]=next;else(v.unit.statuses??=[]).push(next);
        }
      }else if(eventType==='STATUS_REMOVE'||eventType==='STATUS_EXPIRE'){
        v.unit.statuses=(v.unit.statuses??[]).filter(x=>String(x.key).toLowerCase()!==key);
      }else if(eventType==='STATUS_DURATION'){
        const st=(v.unit.statuses??[]).find(x=>String(x.key).toLowerCase()===key);if(st&&Number.isInteger(p.durationRemaining))st.duration=p.durationRemaining;
      }
    }
    this.refreshStatusDots(v);this.refreshStealthVisual(v);if(this.inspectedUnitId===id)this.renderSelectedUnit();
  }

  async statusFeedback(command){
    const id=command.targetId??command.actorId,v=this.unitViews.get(id),rawKey=String(command.payload?.key??'').toLowerCase();
    const wasPresent=Boolean(rawKey&&v?.unit?.statuses?.some(s=>String(s.key).toLowerCase()===rawKey));
    this.updatePresentationStatus(command);
    const raw=String(command.payload?.key??'status').toLowerCase();
    const key=raw.toUpperCase();
    const ending=['STATUS_REMOVE','STATUS_EXPIRE'].includes(command.payload?.eventType);
    const source=this.unitViews.get(command.actorId);
    const targetView=this.unitViews.get(id);
    const ability=String(command.payload?.abilityId??command.payload?.actionId??this.lastActionByActor.get(command.actorId)??'').toUpperCase();
    const mysticSpecialFx = !ending && command.payload?.eventType==='STATUS_APPLY' && targetView && source?.unit?.archetypeId==='Mystic' && (
      (raw==='def_down' && ability==='MYSTIC_ATTACK') ||
      (raw==='stun' && ability==='MYSTIC_STUN') ||
      (raw==='spellbreak' && ability==='MENTAL_BREAKDOWN') ||
      (raw==='berserk' && ability==='BERSERK') ||
      (raw==='blind' && ability==='MIND_SHATTER')
    );
    if(!shouldFloatStatusFeedback(command) && !mysticSpecialFx)return;
    // Bleed refreshes may arrive repeatedly in one attack sequence; keep those quiet. Poison contributions stay visible so every poison ability communicates the amount added.
    if(command.payload?.eventType==='STATUS_APPLY'&&wasPresent&&rawKey==='bleed')return;
    const control=new Set(['stun','silence','taunt','berserk','root','suppression','spellbreak']);
    const color=raw==='poison'?'#2f8f46':(raw==='bleed'?'#ff5f68':(control.has(raw)?'#c08cff':'#f2e8d5'));
    if(!ending&&raw==='poison'&&source?.unit?.archetypeId==='Necromancer'&&targetView&&ability==='PLAGUE_DETONATION'){
      this.pulseImageFx('vfx-necro-cloud',targetView.container.x,targetView.container.y-22,{scale:.34,duration:440,alpha:.96,scaleTo:.44,depth:12});
    }
    if(!ending&&raw==='stun'&&source?.unit?.archetypeId==='Mage'&&ability==='MAGE_ATTACK'&&targetView){
      this.pulseImageFx('vfx-mage-proc',targetView.container.x,targetView.container.y-22,{scale:.34,duration:440,alpha:.96,scaleTo:.44});
    }
    if(!ending&&raw==='bleed'&&source?.unit?.archetypeId==='Shinobi'&&targetView){
      this.pulseImageFx('vfx-shinobi-bleed',targetView.container.x,targetView.container.y-22,{scale:.34,duration:440,alpha:.96,scaleTo:.44});
    }
    if(!ending&&raw==='def_up'&&source?.unit?.archetypeId==='Paladin'&&ability==='PALADIN_ATTACK'&&targetView){
      this.pulseImageFx('vfx-paladin-proc',targetView.container.x,targetView.container.y-22,{scale:.30,duration:440,alpha:.96,scaleTo:.38,depth:12});
    }
    if(mysticSpecialFx){
      let mysticKey='vfx-mystic-proc';
      if(raw==='stun') mysticKey='vfx-mystic-stun';
      else if(raw==='spellbreak') mysticKey='vfx-mystic-spellbreak';
      else if(raw==='berserk') mysticKey='vfx-mystic-berserk';
      else if(raw==='blind') mysticKey='vfx-mystic-psychic';
      this.pulseImageFx(mysticKey,targetView.container.x,targetView.container.y-22,{scale:.34,duration:440,alpha:.96,scaleTo:.44,depth:12});
    }
    if(shouldFloatStatusFeedback(command)){
      const poisonContribution=raw==='poison'&&command.payload?.eventType==='STATUS_APPLY'?Number(command.payload?.contribution?.amount):NaN;
      if(Number.isFinite(poisonContribution)&&poisonContribution>0){
        await Promise.all([
          this.floatText(id,'POISON',color,{yOffset:-10}),
          this.floatText(id,`-${Math.floor(poisonContribution)}`,color,{yOffset:8})
        ]);
      }else await this.floatText(id,ending?`${key} END`:key,color);
    }
  }

  rememberActionCue(command){
    const actionId=String(command.payload?.actionId??'').toUpperCase();
    if(actionId&&command.actorId)this.lastActionByActor.set(command.actorId,actionId);
    return Promise.resolve();
  }

  animateItemCue(command){
    if(command.payload?.eventType!=='ITEM_COMPLETE')return Promise.resolve();
    const v=this.unitViews.get(command.actorId);if(!v)return Promise.resolve();
    const abilityId=String(command.payload?.actionId??this.lastActionByActor.get(command.actorId)??'').toUpperCase();
    if(v.unit?.archetypeId==='Shinobi'&&abilityId==='REGEN_POTION'){
      this.spawnShinobiSignatureFx(v,abilityId,command.targetId);
    }
    return Promise.resolve();
  }

  animateActionEnd(command){
    const v=this.unitViews.get(command.actorId);if(!v)return Promise.resolve();
    if(command.payload?.eventType==='ACTION_INTERRUPT')return Promise.resolve();
    const abilityId=String(command.payload?.actionId??this.lastActionByActor.get(command.actorId)??'').toUpperCase();
    const target=command.payload?.targetPositionAtCompletion??command.payload?.groundLock??null;
    if(target)this.faceViewToward(v,target);
    if(v.unit?.archetypeId==='Archer'&&abilityId==='VOLLEY'){
      const clipPromise=v.animated
        ? this.playChampionClip(v,'attack',{direction:v.facing,durationMs:this.replayDuration(265),resolveAtRatio:.62})
        : this.flashUnit(command.actorId,0x8e72ff);
      const fxPromise=new Promise(resolve=>this.time.delayedCall(this.replayDuration(150),()=>{
        this.spawnArcherSignatureFx(v,abilityId,command.targetId,target);
        resolve();
      }));
      return Promise.all([clipPromise,fxPromise]).then(()=>undefined);
    }
    if(v.unit?.archetypeId==='Barbarian'&&abilityId==='RAMPAGE'){
      this.spawnBarbarianSignatureFx(v,abilityId,command.targetId,target);
      if(!v.animated)return Promise.resolve();
      return this.playChampionClip(v,'cast',{direction:v.facing,durationMs:this.replayDuration(230),resolveAtRatio:.72});
    }
    if(v.unit?.archetypeId!=='Warrior'||!['DIG_IN','SHIELDWALL'].includes(abilityId))return Promise.resolve();
    this.spawnWarriorSignatureFx(v,abilityId,command.targetId);
    if(!v.animated)return Promise.resolve();
    return this.playChampionClip(v,'cast',{direction:v.facing,durationMs:this.replayDuration(230),resolveAtRatio:.72});
  }

  isArcherSignatureOverride(abilityId=''){
    return ['RANGERS_FOCUS','HUNTERS_MARK','VOLLEY'].includes(String(abilityId??'').toUpperCase());
  }

  isMageSignatureOverride(abilityId=''){
    return ['ARCANE_SURGE','ARCANE_ECHO','ARCANE_WARD','FIREBALL','METEOR'].includes(String(abilityId??'').toUpperCase());
  }

  pulseImageFx(key,px,py,{scale=.16,duration=260,depth=12,alpha=.9,scaleTo=null,yoyo=false,repeat=0,angle=0,onComplete=null}={}){
    const fx=this.add.image(px,py,key).setOrigin(.5).setScale(scale).setAlpha(alpha).setDepth(depth).setAngle(angle);
    this.tweens.add({
      targets:fx,
      scale:scaleTo??scale*1.22,
      alpha:0,
      duration:this.replayDuration(duration),
      ease:'Sine.easeOut',
      yoyo,
      repeat,
      onComplete:()=>{fx.destroy();if(typeof onComplete==='function')onComplete();}
    });
    return fx;
  }

  spawnArcherImpactSignatureFx(targetView,abilityId){
    if(!targetView)return;
    const id=String(abilityId??'').toUpperCase();
    const tx=targetView.container.x;
    const ty=targetView.container.y-24;
    if(id==='SNIPE'){
      this.pulseImageFx('vfx-archer-feather',tx,ty,{scale:.34,duration:440,alpha:.96,scaleTo:.44});
      return;
    }
    if(id==='COVER_FIRE'){
      this.pulseImageFx('vfx-archer-cover',tx,ty,{scale:.34,duration:480,alpha:.94,scaleTo:.44});
    }
  }

  animateArcherVolleyCluster(pos){
    const fx=this.add.image(pos.x,pos.y-24,'vfx-archer-volley').setOrigin(.5).setScale(.86).setAlpha(.98).setDepth(12);
    for(let r=-2;r<=2;r++){
      for(let c=-2;c<=2;c++){
        const impact=this.add.circle(pos.x+(c*22),pos.y-10+(r*20),4,0xf4efb0,.26).setStrokeStyle(2,0xe9ef96,.88).setDepth(11);
        this.tweens.add({targets:impact,scale:2.2,alpha:0,duration:this.replayDuration(240),delay:this.replayDuration(((r+2)*5+(c+2))*10),onComplete:()=>impact.destroy()});
      }
    }
    return new Promise(resolve=>{
      this.tweens.add({targets:fx,scale:1.04,alpha:0,duration:this.replayDuration(520),ease:'Sine.easeOut',onComplete:()=>{fx.destroy();resolve();}});
    });
  }

  spawnArcherSignatureFx(v,abilityId,targetId=null,targetPos=null){
    if(!v||v.unit?.archetypeId!=='Archer')return;
    const id=String(abilityId??'').toUpperCase();
    const x=v.container.x,y=v.container.y;
    const target=this.unitViews.get(targetId);
    const point=targetPos ? gridToWorld(targetPos,this.view) : null;
    if(id==='RANGERS_FOCUS'){
      this.pulseImageFx('vfx-archer-focus',x,y-34,{scale:.34,duration:600,alpha:.95,scaleTo:.42});
      return;
    }
    if(id==='HUNTERS_MARK'){
      const tx=point?.x??target?.container?.x??x;
      const ty=(point?.y??target?.container?.y??y)-22;
      this.pulseImageFx('vfx-archer-mark',tx,ty,{scale:.32,duration:264,alpha:.98,scaleTo:.40,yoyo:true,repeat:1});
      return;
    }
    if(id==='VOLLEY'){
      const wx=point?.x??target?.container?.x??x;
      const wy=point?.y??target?.container?.y??y;
      this.animateArcherVolleyCluster({x:wx,y:wy});
      return;
    }
  }

  spawnMageSignatureFx(v,abilityId,targetId=null,targetPos=null){
    if(!v||v.unit?.archetypeId!=='Mage')return;
    const id=String(abilityId??'').toUpperCase();
    const x=v.container.x,y=v.container.y;
    if(id==='ARCANE_SURGE'){
      this.pulseImageFx('vfx-mage-arcane-surge',x,y-22,{scale:.34,duration:440,alpha:.96,scaleTo:.44,depth:12});
      return;
    }
    if(id==='ARCANE_ECHO'){
      this.pulseImageFx('vfx-mage-arcane-echo',x,y-22,{scale:.34,duration:440,alpha:.96,scaleTo:.44,depth:12});
      return;
    }
    if(id==='ARCANE_WARD'){
      for(const ally of this.unitViews.values()){
        if(ally?.unit?.side!==v.unit.side||ally.unit.lifeState!==LIFE_STATE.ALIVE)continue;
        this.pulseImageFx('vfx-mage-ward',ally.container.x,ally.container.y-22,{scale:.34,duration:440,alpha:.96,scaleTo:.44,depth:12});
      }
      return;
    }
  }


  spawnClericSignatureFx(v,abilityId,targetId=null,targetPos=null){
    if(!v||v.unit?.archetypeId!=='Cleric')return;
    const id=String(abilityId??'').toUpperCase();
    const x=v.container.x,y=v.container.y;
    const target=this.unitViews.get(targetId);
    const point=targetPos ? gridToWorld(targetPos,this.view) : null;
    const pulseImage=(key,px,py,scale=.16,duration=300)=>{
      const fx=this.add.image(px,py,key).setOrigin(.5).setScale(scale).setAlpha(.94);
      this.tweens.add({targets:fx,scale:scale*1.18,alpha:0,duration:this.replayDuration(duration),ease:'Sine.easeOut',onComplete:()=>fx.destroy()});
    };
    if(id==='DEFENSIVE_AURA'){
      pulseImage('vfx-cleric-aura',x,y-18,.18,360);
      return;
    }
    if(id==='GUARDIAN_ANGEL'){
      const tx=target?.container?.x??x, ty=(target?.container?.y??y)-18;
      pulseImage('vfx-cleric-angel',tx,ty,.18,360);
      return;
    }
    if(id==='ENIDS_BLESSING'){
      for(const ally of this.unitViews.values()){
        if(ally?.unit?.side!==v.unit.side||ally.unit.lifeState!==LIFE_STATE.ALIVE)continue;
        pulseImage('vfx-cleric-blessing',ally.container.x,ally.container.y-18,.13,340);
      }
      pulseImage('vfx-cleric-heal',x,y-24,.14,300);
      return;
    }
    if(id==='RESURRECTION'){
      const tx=target?.container?.x??x, ty=(target?.container?.y??y)-18;
      pulseImage('vfx-cleric-resurrection',tx,ty,.16,400);
      return;
    }
    if(id==='PIERCING_LIGHT'){
      const tx=point?.x??target?.container?.x??x, ty=(point?.y??target?.container?.y??y)-22;
      const fx=this.add.image(tx,ty,'vfx-cleric-light').setOrigin(.5).setScale(.15).setAlpha(.96);
      this.tweens.add({targets:fx,scale:.21,alpha:0,duration:this.replayDuration(360),ease:'Sine.easeOut',onComplete:()=>fx.destroy()});
      return;
    }
  }


  spawnPaladinSignatureFx(v,abilityId,targetId=null,targetPos=null){
    if(!v||v.unit?.archetypeId!=='Paladin')return;
    const id=String(abilityId??'').toUpperCase();
    const x=v.container.x,y=v.container.y;
    const target=this.unitViews.get(targetId);
    const point=targetPos ? gridToWorld(targetPos,this.view) : null;
    const pulseImage=(key,px,py,scale=.32,duration=420,scaleTo=null)=>{
      this.pulseImageFx(key,px,py,{scale,duration,alpha:.96,scaleTo:scaleTo??Math.max(scale*1.18,scale+.08),depth:12});
    };
    if(id==='SHIELD_BASH'){
      const tx=point?.x??target?.container?.x??x, ty=(point?.y??target?.container?.y??y)-18;
      pulseImage('vfx-paladin-bash',tx,ty,.31,420,.39);
      return;
    }
    if(id==='DIVINE_SHIELD'){
      const tx=target?.container?.x??x, ty=(target?.container?.y??y)-18;
      pulseImage('vfx-paladin-divine',tx,ty,.32,440,.40);
      return;
    }
    if(id==='CLEANSE'){
      const tx=target?.container?.x??x, ty=(target?.container?.y??y)-18;
      pulseImage('vfx-paladin-cleanse',tx,ty,.33,440,.41);
      return;
    }
    if(id==='SANCTIFY'){
      for(const ally of this.unitViews.values()){
        if(ally?.unit?.side!==v.unit.side||ally.unit.lifeState!==LIFE_STATE.ALIVE)continue;
        pulseImage('vfx-paladin-sanctify',ally.container.x,ally.container.y-14,.33,460,.41);
      }
      return;
    }
    if(id==='JUDGMENT'){
      const tx=point?.x??target?.container?.x??x, ty=(point?.y??target?.container?.y??y)-10;
      pulseImage('vfx-paladin-judgment',tx,ty,.31,460,.39);
      return;
    }
  }

  pulseImageFx(key,x,y,{scale=.16,duration=320,alpha=.95,grow=1.18,depth=12,rotation=0,scaleTo=null,yoyo=false,repeat=0,angle=null,onComplete=null}={}){
    const fx=this.add.image(x,y,key).setOrigin(.5).setScale(scale).setAlpha(alpha).setRotation(rotation).setDepth(depth);
    if(angle!==null&&angle!==undefined)fx.setAngle(angle);
    this.tweens.add({
      targets:fx,
      scale:scaleTo??(scale*grow),
      alpha:0,
      duration:this.replayDuration(duration),
      ease:'Sine.easeOut',
      yoyo,
      repeat,
      onComplete:()=>{fx.destroy();if(typeof onComplete==='function')onComplete();}
    });
    return fx;
  }

  animateImageProjectile(a,b,key,{scale=.14,duration=235,impactKey=null,impactScale=.13,yStart=-16,yEnd=-18,rotate=true,depth=12}={}){
    const dx=b.x-a.x,dy=b.y-a.y;
    const angle=Math.atan2(dy,dx);
    const img=this.add.image(a.x,a.y+yStart,key).setOrigin(.5).setScale(scale).setAlpha(.98).setDepth(depth);
    if(rotate)img.setRotation(angle);
    return new Promise(resolve=>this.tweens.add({targets:img,x:b.x,y:b.y+yEnd,duration:this.replayDuration(duration),ease:'Quad.easeInOut',onComplete:()=>{
      img.destroy();
      if(impactKey)this.pulseImageFx(impactKey,b.x,b.y+yEnd,{scale:impactScale,duration:220,alpha:.96,grow:1.2,depth:depth});
      resolve();
    }}));
  }



  animateNecromancerDrain(a,b){
    const x0=b.x, y0=b.y-18, x1=a.x, y1=a.y-24;
    this.pulseImageFx('vfx-necro-target',x0,y0,{scale:.12,duration:240,alpha:.92,grow:1.12,depth:12});
    this.pulseImageFx('vfx-necro-cloud',x0,y0,{scale:.1,duration:220,alpha:.88,grow:1.1,depth:11});
    const launches=[];
    for(let i=0;i<3;i++){
      launches.push(new Promise(resolve=>this.time.delayedCall(this.replayDuration(i*34),()=>{
        this.animateImageProjectile(
          {x:x0+((i-1)*5),y:y0+((i%2)?2:-2)},
          {x:x1+((i-1)*4),y:y1+((i%2)?4:-4)},
          'vfx-necro-toxic-orb',
          {scale:.095,duration:210+i*22,impactKey:null,impactScale:.1,yStart:0,yEnd:0,rotate:false,depth:12}
        ).then(resolve);
      })));
    }
    return Promise.all(launches).then(()=>new Promise(resolve=>{
      this.pulseImageFx('vfx-necro-cloud',x1,y1,{scale:.12,duration:260,alpha:.92,grow:1.14,depth:11});
      this.pulseImageFx('vfx-necro-impact',x1,y1-2,{scale:.105,duration:220,alpha:.9,grow:1.16,depth:12});
      this.time.delayedCall(this.replayDuration(120),resolve);
    }));
  }
  spawnNecromancerSignatureFx(v,abilityId,targetId=null,targetPos=null){
    if(!v||v.unit?.archetypeId!=='Necromancer')return;
    const id=String(abilityId??'').toUpperCase();
    const x=v.container.x,y=v.container.y;
    const target=this.unitViews.get(targetId);
    const point=targetPos ? gridToWorld(targetPos,this.view) : null;
    const tx=point?.x??target?.container?.x??x;
    const ty=(point?.y??target?.container?.y??y)-18;
    const enemyViews=[...this.unitViews.values()].filter(other=>other?.unit?.side!==v.unit.side&&other.unit.lifeState===LIFE_STATE.ALIVE);
    if(id==='POISON_BOLT'){
      this.pulseImageFx('vfx-necro-target',tx,ty,{scale:.11,duration:220,alpha:.88,grow:1.08});
      this.pulseImageFx('vfx-necro-cloud',tx,ty,{scale:.09,duration:220,alpha:.84,grow:1.08,depth:11});
      return;
    }
    if(id==='LIFE_DRAIN'){
      this.pulseImageFx('vfx-necro-target',tx,ty,{scale:.12,duration:240,alpha:.92,grow:1.12});
      this.pulseImageFx('vfx-necro-mist',x,y-8,{scale:.11,duration:260,alpha:.88,grow:1.10,depth:11});
      return;
    }
    if(id==='DEATH_TOUCH'){
      this.pulseImageFx('vfx-necro-rune',tx,ty+10,{scale:.32,duration:264,alpha:.98,scaleTo:.40,yoyo:true,repeat:1,depth:12});
      return;
    }
    if(id==='PLAGUE'){
      enemyViews.forEach((enemy,index)=>{
        const ex=enemy.container.x, ey=enemy.container.y-16;
        for(let burst=0;burst<3;burst++){
          this.time.delayedCall(this.replayDuration(index*24 + burst*34),()=>{
            this.animateImageProjectile({x,y:y-24},{x:ex+((burst-1)*6),y:ey+((burst%2)?4:-2)},'vfx-necro-toxic-orb',{scale:.09,duration:185,impactKey:null,depth:11});
          });
        }
        this.time.delayedCall(this.replayDuration(index*24 + 112),()=>{
          this.pulseImageFx('vfx-necro-plague',ex,enemy.container.y+4,{scale:.12,duration:360,alpha:.95,grow:1.16,depth:11});
          this.pulseImageFx('vfx-necro-cloud',ex,ey,{scale:.11,duration:320,alpha:.92,grow:1.12,depth:12});
        });
      });
      return;
    }
  }
  spawnMysticSignatureFx(v,abilityId,targetId=null,targetPos=null){
    if(!v||v.unit?.archetypeId!=='Mystic')return;
    const id=String(abilityId??'').toUpperCase();
    if(id==='PREMONITION'){
      const allies=[...this.unitViews.values()].filter(other=>other?.unit?.side===v.unit.side&&other.unit.lifeState===LIFE_STATE.ALIVE);
      allies.forEach((ally,index)=>{
        this.time.delayedCall(this.replayDuration(index*24),()=>{
          this.pulseImageFx('vfx-mystic-premonition',ally.container.x,ally.container.y-22,{scale:.34,duration:440,alpha:.96,scaleTo:.44,depth:12});
        });
      });
    }
  }


  spawnWarriorSignatureFx(v,abilityId,targetId=null){
    if(!v||v.unit?.archetypeId!=='Warrior')return;
    const id=String(abilityId??'').toUpperCase();
    const x=v.container.x,y=v.container.y;
    if(id==='WARHORN'){
      const facing=v.facing??'S';
      const offsets={N:[7,-50,-Math.PI/2],S:[10,-49,Math.PI/10],E:[18,-44,0],W:[-18,-44,Math.PI]};
      const [ox,oy,rot]=offsets[facing]??offsets.S;
      const horn=this.add.image(x+ox,y+oy,'vfx-warhorn').setOrigin(.5).setRotation(rot).setScale(.82).setAlpha(.95);
      this.tweens.add({targets:horn,scale:1.02,alpha:.72,duration:this.replayDuration(150),yoyo:true,onComplete:()=>horn.destroy()});
      const sx=x+ox+(facing==='W'?-16:(facing==='E'?16:0)), sy=y+oy+(facing==='N'?-12:(facing==='S'?12:0));
      for(let i=0;i<3;i++){
        const ring=this.add.ellipse(sx,sy,10+i*6,5+i*3,0xf2c35e,.03).setStrokeStyle(2,0xf2c35e,.75-i*.15);
        this.tweens.add({targets:ring,scaleX:1.7,scaleY:1.7,alpha:0,duration:this.replayDuration(180+i*45),delay:this.replayDuration(i*35),onComplete:()=>ring.destroy()});
      }
      return;
    }
    if(id==='DIG_IN'){
      const ring=this.add.ellipse(x,y+15,34,14,0x6d9cff,.08).setStrokeStyle(3,0xe9c866,.9);
      const shield=this.add.ellipse(x,y-15,28,42,0x7da9ff,.08).setStrokeStyle(3,0x9fc7ff,.8);
      this.tweens.add({targets:[ring,shield],scaleX:1.35,scaleY:1.18,alpha:0,duration:this.replayDuration(240),onComplete:()=>{ring.destroy();shield.destroy();}});
      for(let i=0;i<5;i++){
        const dust=this.add.circle(x-12+i*6,y+17-(i%2)*2,2,0xc6aa77,.55);
        this.tweens.add({targets:dust,y:dust.y-7-(i%3)*2,alpha:0,duration:this.replayDuration(170+i*15),onComplete:()=>dust.destroy()});
      }
      return;
    }
    if(id==='SHIELDWALL'){
      const wall=this.add.ellipse(x,y-14,34,50,0x729dff,.06).setStrokeStyle(4,0xe8c763,.88);
      this.tweens.add({targets:wall,scaleX:1.45,scaleY:1.12,alpha:0,duration:this.replayDuration(260),onComplete:()=>wall.destroy()});
      return;
    }
    if(id==='INSULT'){
      const shout=this.add.text(x,y-70,'!?!',{fontFamily:'monospace',fontSize:'15px',fontStyle:'bold',color:'#ffb45c',stroke:'#3b0b0b',strokeThickness:3}).setOrigin(.5);
      this.tweens.add({targets:shout,y:shout.y-10,scale:1.25,alpha:0,duration:this.replayDuration(260),ease:'Back.easeOut',onComplete:()=>shout.destroy()});
    }
  }


  spawnBarbarianSignatureFx(v,abilityId,targetId=null,targetPos=null){
    if(!v||v.unit?.archetypeId!=='Barbarian')return;
    const id=String(abilityId??'').toUpperCase();
    const x=v.container.x,y=v.container.y;
    const target=this.unitViews.get(targetId);
    const point=targetPos ? gridToWorld(targetPos,this.view) : null;
    const tx=point?.x??target?.container?.x??x;
    const ty=(point?.y??target?.container?.y??y)-18;
    const enemies=[...this.unitViews.values()].filter(other=>other?.unit?.side!==v.unit.side&&other.unit.lifeState===LIFE_STATE.ALIVE);
    if(id==='WAR_CRY'){
      this.pulseImageFx('vfx-barbarian-ring',x,y-28,{scale:.12,duration:260,alpha:.94,grow:1.18,depth:12});
      enemies.forEach((enemy,index)=>{
        this.time.delayedCall(this.replayDuration(index*28),()=>{
          this.animateImageProjectile({x,y},{x:enemy.container.x,y:enemy.container.y},'vfx-barbarian-roar',{
            scale:.12,duration:210,impactKey:'vfx-barbarian-ring',impactScale:.11,yStart:-34,yEnd:-18,rotate:true,depth:12
          });
        });
      });
      return;
    }
    if(id==='RAMPAGE'){
      this.pulseImageFx('vfx-barbarian-rage',x,y-20,{scale:.34,duration:440,alpha:.96,scaleTo:.44,depth:12});
      this.pulseImageFx('vfx-barbarian-aura',x,y-8,{scale:.18,duration:420,alpha:.92,grow:1.16,depth:11});
      for(let i=0;i<3;i++){
        this.time.delayedCall(this.replayDuration(i*36),()=>{
          this.pulseImageFx('vfx-barbarian-ring',x,y-8,{scale:.10+i*.015,duration:220,alpha:.82-i*.12,grow:1.2,depth:11});
        });
      }
      return;
    }
  }

  spawnRogueSignatureFx(v,abilityId,targetId=null,targetPos=null){
    if(!v||v.unit?.archetypeId!=='Rogue')return;
    const id=String(abilityId??'').toUpperCase();
    const x=v.container.x,y=v.container.y;
    if(id==='SMOKE_BOMB'){
      const offsets=[[-22,-10],[0,-16],[22,-8],[-12,8],[12,10]];
      offsets.forEach(([ox,oy],i)=>{
        this.time.delayedCall(this.replayDuration(i*24),()=>{
          const puff=this.add.circle(x+ox,y+oy,10,0xb7bcc9,.42).setStrokeStyle(2,0xe8ecf7,.55).setDepth(11);
          this.tweens.add({targets:puff,scaleX:2.2,scaleY:1.8,alpha:0,duration:this.replayDuration(240+i*18),onComplete:()=>puff.destroy()});
        });
      });
      const haze=this.add.ellipse(x,y-2,72,48,0xc8ced8,.18).setDepth(10).setStrokeStyle(2,0xf1f3f8,.35);
      this.tweens.add({targets:haze,scaleX:1.28,scaleY:1.16,alpha:0,duration:this.replayDuration(280),onComplete:()=>haze.destroy()});
    }
  }

  spawnShinobiSignatureFx(v,abilityId,targetId=null,targetPos=null){
    if(!v||v.unit?.archetypeId!=='Shinobi')return;
    const id=String(abilityId??'').toUpperCase();
    const x=v.container.x,y=v.container.y;
    const target=this.unitViews.get(targetId);
    const point=targetPos ? gridToWorld(targetPos,this.view) : null;
    const tx=point?.x??target?.container?.x??x;
    const ty=(point?.y??target?.container?.y??y)-22;
    if(id==='INVISIBILITY'){
      this.pulseImageFx('vfx-shinobi-invisibility',x,y-22,{scale:.34,duration:440,alpha:.96,scaleTo:.44,depth:12});
      return;
    }
    if(id==='DISPEL'){
      this.pulseImageFx('vfx-shinobi-dispel-cast',x,y-22,{scale:.34,duration:440,alpha:.96,scaleTo:.44,depth:12});
      this.pulseImageFx('vfx-shinobi-dispel-target',tx,ty,{scale:.34,duration:440,alpha:.96,scaleTo:.44,depth:12});
      return;
    }
    if(id==='THIEFS_HASTE'){
      this.pulseImageFx('vfx-shinobi-haste',x,y-22,{scale:.34,duration:440,alpha:.96,scaleTo:.44,depth:12});
      return;
    }
    if(id==='REGEN_POTION'){
      this.pulseImageFx('vfx-shinobi-regen',x,y-22,{scale:.34,duration:440,alpha:.96,scaleTo:.44,depth:12});
      return;
    }
    if(id==='BLEED_STRIKE'){
      this.pulseImageFx('vfx-shinobi-imbue',x,y-22,{scale:.34,duration:440,alpha:.96,scaleTo:.44,depth:12});
    }
  }

  spawnElectromancerSignatureFx(v,abilityId,targetId=null,targetPos=null){
    if(!v||v.unit?.archetypeId!=='Electromancer')return;
    const id=String(abilityId??'').toUpperCase();
    const allies=[...this.unitViews.values()].filter(other=>other?.unit?.side===v.unit.side&&other.unit.lifeState===LIFE_STATE.ALIVE);
    if(id==='ELECTRICAL_STORM'){
      const everyone=[...this.unitViews.values()].filter(other=>other?.unit?.lifeState===LIFE_STATE.ALIVE);
      everyone.forEach((unitView,index)=>{
        this.time.delayedCall(this.replayDuration(index*18),()=>{
          this.pulseImageFx('vfx-electro-storm',unitView.container.x,unitView.container.y-18,{scale:.289,duration:420,alpha:.95,scaleTo:.391,depth:12});
        });
      });
      return;
    }
    if(id==='GOD_TEMPEST'){
      this.pulseImageFx('vfx-electro-tempest',v.container.x,v.container.y-22,{scale:.32,duration:264,alpha:.98,scaleTo:.40,yoyo:true,repeat:1,depth:12});
      return;
    }
    if(id==='POWER_SURGE'){
      allies.forEach((ally,index)=>{
        this.time.delayedCall(this.replayDuration(index*24),()=>{
          this.pulseImageFx('vfx-electro-slash',ally.container.x,ally.container.y-18,{scale:.255,duration:400,alpha:.96,scaleTo:.33,depth:12});
        });
      });
    }
  }

  makePresentationAdapter(){
    const run=fn=>async({command})=>{this.logReplayCommand(command);await fn(command);};
    const logOnly=run(async()=>{});
    return new PhaserPresentationAdapter({scene:this,handlers:{
      [PRESENTATION_COMMAND.ROUND_MARKER]:logOnly,
      [PRESENTATION_COMMAND.ACTION_CUE]:run(c=>this.rememberActionCue(c)),
      [PRESENTATION_COMMAND.ACTION_END]:run(c=>this.animateActionEnd(c)),
      [PRESENTATION_COMMAND.MOVE_UNIT]:run(c=>this.animateMove(c)),
      [PRESENTATION_COMMAND.DISPLACE_UNIT]:run(c=>this.animateDisplace(c)),
      [PRESENTATION_COMMAND.ATTACK_CUE]:run(c=>this.animateAttack(c)),
      [PRESENTATION_COMMAND.ATTACK_IMPACT]:logOnly,
      [PRESENTATION_COMMAND.COUNTER_CUE]:run(c=>this.animateCounterCue(c)),
      [PRESENTATION_COMMAND.INTERCEPT_CUE]:logOnly,
      [PRESENTATION_COMMAND.CAST_CUE]:run(c=>this.animateChargeStart(c)),
      [PRESENTATION_COMMAND.CAST_COMPLETE]:run(c=>this.animateSpellResolution(c)),
      [PRESENTATION_COMMAND.CAST_INTERRUPT]:run(c=>this.animateCastEnd(c,'INTERRUPTED')),
      [PRESENTATION_COMMAND.CAST_FIZZLE]:run(c=>this.animateCastEnd(c,'FIZZLE')),
      [PRESENTATION_COMMAND.ITEM_CUE]:run(c=>this.animateItemCue(c)),
      [PRESENTATION_COMMAND.SPELL_RESOLUTION]:run(c=>this.animateSpellResolution(c)),
      [PRESENTATION_COMMAND.SPELL_PROJECTILE]:run(c=>this.animateProjectile(c)),
      [PRESENTATION_COMMAND.DAMAGE_FEEDBACK]:run(c=>this.damageFeedback(c)),
      [PRESENTATION_COMMAND.HEAL_FEEDBACK]:run(c=>this.healFeedback(c)),
      [PRESENTATION_COMMAND.SIMULTANEOUS_FEEDBACK]:async({command})=>this.simultaneousFeedback(command),
      [PRESENTATION_COMMAND.STATUS_FEEDBACK]:run(c=>this.statusFeedback(c)),
      [PRESENTATION_COMMAND.MISS_FEEDBACK]:run(c=>this.floatText(c.targetId??c.actorId,'MISS','#c8d4e5')),
      [PRESENTATION_COMMAND.DODGE_FEEDBACK]:run(c=>this.floatText(c.targetId,'DODGE','#b9e7ff')),
      [PRESENTATION_COMMAND.BLOCK_FEEDBACK]:run(c=>this.floatText(c.targetId,'BLOCK','#b9e7ff')),
      [PRESENTATION_COMMAND.KO_FEEDBACK]:run(c=>this.koUnit(c.targetId)),
      [PRESENTATION_COMMAND.RESURRECT_FEEDBACK]:run(c=>this.resurrectUnit(c.targetId,c.payload)),
      [PRESENTATION_COMMAND.CRIT_FEEDBACK]:run(c=>this.floatText(c.targetId,'CRIT!','#ffe36d')),
      '*':logOnly
    }});
  }

  animationDurationMs(archetypeId,clip,direction='S'){
    const manifest=CHAMPION_ANIMATION_MANIFESTS[archetypeId];if(!manifest)return 0;
    const frames=['hit','ko','resurrect'].includes(clip)?manifest[clip]:manifest.clips?.[direction]?.[clip];
    const fps=manifest.timing?.[`${clip}Fps`]??10;
    return frames?.length ? frames.length/fps*1000 : 0;
  }

  playIdle(v){
    if(!v?.sprite||v.unit.lifeState!==LIFE_STATE.ALIVE)return;
    v.sprite.anims.timeScale=1;
    v.sprite.play(animationKey(v.unit.archetypeId,'idle',v.facing??'S'),true);
  }

  faceViewToward(v,targetPosition){
    if(!v||!targetPosition)return v?.facing??'S';
    v.facing=directionFromCells(v.unit.position,targetPosition,v.facing??'S');
    return v.facing;
  }

  shouldMirrorSharedFacing(v,direction=v?.facing??'S'){
    return ['Barbarian','Electromancer','Cleric','Rogue','Mage','Shinobi'].includes(v?.unit?.archetypeId) && direction==='W';
  }

  playSharedChampionClip(v,clip,{direction=v?.facing??'S',durationMs=null,resolveAtRatio=1,returnToIdle=true,mirror=null}={}){
    if(!v?.sprite)return Promise.resolve();
    const shouldMirror=mirror ?? this.shouldMirrorSharedFacing(v,direction);
    if(shouldMirror&&v.sprite?.setFlipX)v.sprite.setFlipX(true);
    return this.playChampionClip(v,clip,{direction,durationMs,resolveAtRatio,returnToIdle}).finally(()=>{
      if(v.sprite?.setFlipX)v.sprite.setFlipX(false);
    });
  }

  playChampionClip(v,clip,{direction=v?.facing??'S',durationMs=null,resolveAtRatio=1,returnToIdle=true}={}){
    if(!v?.sprite)return Promise.resolve();
    v.facing=direction;
    const key=animationKey(v.unit.archetypeId,clip,direction);
    const base=this.animationDurationMs(v.unit.archetypeId,clip,direction)||200;
    const desired=Math.max(1,durationMs??base);
    v.sprite.anims.timeScale=Math.max(.05,base/desired);
    v.sprite.play(key,true);
    const resolveDelay=Math.max(1,Math.round(desired*Math.max(0,Math.min(1,resolveAtRatio))));
    if(returnToIdle){
      this.time.delayedCall(desired,()=>{
        if(v.unit.lifeState===LIFE_STATE.ALIVE)this.playIdle(v);
      });
    }
    return new Promise(resolve=>this.time.delayedCall(resolveDelay,resolve));
  }

  clearChargeFx(actorId){
    const fx=this.chargeFxByActor?.get(actorId);
    if(!fx)return;
    this.chargeFxByActor.delete(actorId);
    fx.tween?.stop?.();fx.ring?.destroy?.();fx.spark?.destroy?.();
  }

  animateChargeStart(command){
    const v=this.unitViews.get(command.actorId);if(!v)return Promise.resolve();
    this.clearChargeFx(command.actorId);
    const target=this.unitViews.get(command.targetId)?.unit?.position??command.payload?.targetPositionAtStart??null;
    if(target)this.faceViewToward(v,target);
    // Declaration gets only a restrained charging tell. The real cast motion happens on resolution.
    const ring=this.add.ellipse(v.container.x,v.container.y+14,28,11,0x8e72ff,.08).setStrokeStyle(2,0xbda8ff,.58);
    const spark=this.add.circle(v.container.x,v.container.y-23,2,0xded3ff,.8);
    const tween=this.tweens.add({targets:[ring,spark],alpha:{from:.35,to:.9},scaleX:{from:.82,to:1.18},scaleY:{from:.82,to:1.18},duration:this.replayDuration(280),yoyo:true,repeat:-1});
    const actionId=command.payload?.actionId??this.lastActionByActor.get(command.actorId)??null;
    this.chargeFxByActor.set(command.actorId,{ring,spark,tween,actionId});
    if(v.animated&&v.sprite){
      const manifest=CHAMPION_ANIMATION_MANIFESTS[v.unit.archetypeId];
      const frame=manifest?.clips?.[v.facing]?.cast?.[0];
      if(Number.isInteger(frame)){v.sprite.stop();v.sprite.setFrame(frame);this.time.delayedCall(this.replayDuration(90),()=>this.playIdle(v));}
    }
    return new Promise(resolve=>this.time.delayedCall(this.replayDuration(85),resolve));
  }

  animateCastEnd(command,label){
    this.clearChargeFx(command.actorId);
    return this.floatText(command.actorId,label,'#ff9a72');
  }

  animateSpellResolution(command){
    const v=this.unitViews.get(command.actorId);if(!v)return Promise.resolve();
    if(command.payload?.spellbroken){this.clearChargeFx(command.actorId);return Promise.resolve();}
    const charging=this.chargeFxByActor?.get(command.actorId);
    const rememberedAction=charging?.actionId??this.lastSpellAbilityByActor.get(command.actorId)??null;
    this.clearChargeFx(command.actorId);
    const target=this.unitViews.get(command.targetId)?.unit?.position??command.payload?.targetPositionAtCompletion??command.payload?.groundLock??null;
    if(target)this.faceViewToward(v,target);
    const abilityId=String(command.payload?.abilityId??command.payload?.actionId??rememberedAction??this.lastActionByActor.get(command.actorId)??'').toUpperCase();
    if(abilityId)this.lastSpellAbilityByActor.set(command.actorId,abilityId);
    const archerSignatureOverride=v.unit?.archetypeId==='Archer' && this.isArcherSignatureOverride(abilityId);
    const mageSignatureOverride=v.unit?.archetypeId==='Mage' && this.isMageSignatureOverride(abilityId);
    if(!(archerSignatureOverride||mageSignatureOverride)) this.spawnCastReleaseFx(v,abilityId);
    this.spawnWarriorSignatureFx(v,abilityId,command.targetId);
    this.spawnBarbarianSignatureFx(v,abilityId,command.targetId,target);
    if(v.unit?.archetypeId==='Archer'&&abilityId==='VOLLEY'){
      const clipPromise=v.animated
        ? this.playChampionClip(v,'attack',{direction:v.facing,durationMs:this.replayDuration(265),resolveAtRatio:.62})
        : this.flashUnit(command.actorId,0x8e72ff);
      const fxPromise=new Promise(resolve=>this.time.delayedCall(this.replayDuration(150),()=>{
        this.spawnArcherSignatureFx(v,abilityId,command.targetId,target);
        resolve();
      }));
      return Promise.all([clipPromise,fxPromise]).then(()=>undefined);
    }
    this.spawnArcherSignatureFx(v,abilityId,command.targetId,target);
    this.spawnClericSignatureFx(v,abilityId,command.targetId,target);
    this.spawnPaladinSignatureFx(v,abilityId,command.targetId,target);
    this.spawnNecromancerSignatureFx(v,abilityId,command.targetId,target);
    this.spawnRogueSignatureFx(v,abilityId,command.targetId,target);
    this.spawnShinobiSignatureFx(v,abilityId,command.targetId,target);
    this.spawnElectromancerSignatureFx(v,abilityId,command.targetId,target);
    this.spawnMysticSignatureFx(v,abilityId,command.targetId,target);
    this.spawnMageSignatureFx(v,abilityId,command.targetId,target);
    if(!v.animated)return this.flashUnit(command.actorId,0x8e72ff);
    return this.playChampionClip(v,'cast',{direction:v.facing,durationMs:this.replayDuration(250),resolveAtRatio:.68});
  }

  spawnCastReleaseFx(v,abilityId=''){
    const x=v.container.x,y=v.container.y-16;
    let color=0xbda8ff;
    if(/CHAIN|ELECTR|POWER_SURGE|SHIFT/.test(abilityId))color=0x8edcff;
    else if(/PIERCING|ENID|GUARDIAN|RESURRECT|DIVINE|WARD|AURA/.test(abilityId))color=0xfff0a8;
    else if(/PLAGUE|POISON|DRAIN|DEATH_TOUCH/.test(abilityId))color=0x69c66b;
    else if(/FIREBALL|METEOR/.test(abilityId))color=0xffa13a;
    else if(/WARHORN|DIG_IN|SHIELDWALL/.test(abilityId))color=0xe8c763;
    else if(/INSULT/.test(abilityId))color=0xff8a4c;
    const halo=this.add.circle(x,y,5,color,.22).setStrokeStyle(2,color,.85);
    this.tweens.add({targets:halo,scale:3.3,alpha:0,duration:this.replayDuration(210),onComplete:()=>halo.destroy()});
  }

  animateMove(command){
    const v=this.unitViews.get(command.actorId),to=command.payload.to;if(!v||!to)return Promise.resolve();
    const p=gridToWorld(to,this.view),duration=this.replayDuration(110);
    if(v.animated&&v.sprite){
      v.facing=directionFromCells(v.unit.position,to,v.facing??'S');
      const base=this.animationDurationMs(v.unit.archetypeId,'walk',v.facing)||440;
      v.sprite.anims.timeScale=Math.max(.05,base/duration);
      v.sprite.play(animationKey(v.unit.archetypeId,'walk',v.facing),true);
    }
    return new Promise(resolve=>this.tweens.add({targets:v.container,x:p.x,y:p.y,duration,ease:'Sine.easeInOut',onUpdate:()=>this.syncUnitDepthFromWorldY(v),onComplete:()=>{
      v.unit.position={...to};this.syncUnitDepth(v,to);if(v.animated)this.playIdle(v);resolve();
    }}));
  }

  animateDisplace(command){
    const id=command.targetId??command.actorId,v=this.unitViews.get(id),to=command.payload.to??command.payload.finalPosition;
    if(!v||!to)return Promise.resolve();
    const p=gridToWorld(to,this.view),teleport=command.payload.kind==='TELEPORT';
    if(teleport){
      return new Promise(resolve=>{
        const isShiftTeleport=String(command.payload?.reason??command.payload?.movementReason??'').includes('SHIFT');
        const preDelay=(isShiftTeleport&&['Electromancer','Mage'].includes(v.unit?.archetypeId))?this.replayDuration(90):0;
        if(preDelay)this.pulseImageFx('vfx-electro-shift',v.container.x,v.container.y-18,{scale:.34,duration:220,alpha:.96,scaleTo:.44,depth:12});
        this.time.delayedCall(preDelay,()=>{
          const outFx=this.add.circle(v.container.x,v.container.y-8,8,0x8edcff,.24).setStrokeStyle(2,0xf7f4a8,.8);
          this.tweens.add({targets:outFx,scale:3,alpha:0,duration:this.replayDuration(100),onComplete:()=>outFx.destroy()});
          v.container.setAlpha(.18);
          this.tweens.add({targets:v.container,x:p.x,y:p.y,duration:this.replayDuration(55),ease:'Quad.easeOut',onUpdate:()=>this.syncUnitDepthFromWorldY(v),onComplete:()=>{
            v.unit.position={...to};this.syncUnitDepth(v,to);v.container.setAlpha(v.unit.lifeState===LIFE_STATE.ALIVE?1:.38);
            const inFx=this.add.circle(p.x,p.y-8,6,0x8edcff,.5).setStrokeStyle(2,0xf7f4a8,.9);
            this.tweens.add({targets:inFx,scale:3.2,alpha:0,duration:this.replayDuration(130),onComplete:()=>inFx.destroy()});
            resolve();
          }});
        });
      });
    }
    return new Promise(resolve=>this.tweens.add({targets:v.container,x:p.x,y:p.y,duration:this.replayDuration(120),onUpdate:()=>this.syncUnitDepthFromWorldY(v),onComplete:()=>{v.unit.position={...to};this.syncUnitDepth(v,to);resolve();}}));
  }

  animateMysticDaggerAttack(a,t){
    const dx=t.container.x-a.container.x,dy=t.container.y-a.container.y;
    a.facing=(a.unit?.position&&t.unit?.position)?directionFromCells(a.unit.position,t.unit.position,a.facing??'S'):directionFromDelta(dx,dy,a.facing??'S');
    const duration=this.replayDuration(220), releaseAt=Math.max(1,Math.round(duration*.56));
    const flight=Math.max(1,duration-releaseAt);
    const clip=this.playChampionClip(a,'attack',{direction:a.facing,durationMs:duration,resolveAtRatio:1});
    const projectile=new Promise(resolve=>this.time.delayedCall(releaseAt,()=>{
      const len=Math.max(1,Math.hypot(dx,dy));
      const ux=dx/len,uy=dy/len;
      const x0=a.container.x+ux*15,y0=a.container.y-23+uy*5;
      const x1=t.container.x,y1=t.container.y-22;
      const angle=Math.atan2(y1-y0,x1-x0);
      if(!this.anims.exists('mystic-dagger-flight')){
        this.anims.create({key:'mystic-dagger-flight',frames:[0,1,2,3].map(frame=>({key:'vfx-mystic-dagger',frame})),frameRate:18,repeat:-1});
      }
      const knife=this.add.sprite(x0,y0,'vfx-mystic-dagger',0).setOrigin(.5).setRotation(angle).setScale(.72).setAlpha(.98);
      knife.play('mystic-dagger-flight');
      const spark=this.add.circle(x0,y0,3,0xb66cff,.55).setStrokeStyle(1,0xefd7ff,.85);
      this.tweens.add({targets:spark,scale:2.2,alpha:0,duration:Math.max(1,Math.round(flight*.7)),onComplete:()=>spark.destroy()});
      this.tweens.add({targets:knife,x:x1,y:y1,duration:flight,ease:'Linear',onComplete:()=>{
        knife.destroy();
        const impact=this.add.circle(x1,y1,4,0xd9b6ff,.42).setStrokeStyle(1,0xffffff,.85);
        this.tweens.add({targets:impact,scale:2.2,alpha:0,duration:this.replayDuration(90),onComplete:()=>impact.destroy()});
        resolve();
      }});
    }));
    return Promise.all([clip,projectile]).then(()=>undefined);
  }

  animateArcherAttack(a,t){
    const dx=t.container.x-a.container.x,dy=t.container.y-a.container.y;
    a.facing=(a.unit?.position&&t.unit?.position)?directionFromCells(a.unit.position,t.unit.position,a.facing??'S'):directionFromDelta(dx,dy,a.facing??'S');
    const duration=this.replayDuration(210),releaseAt=Math.max(1,Math.round(duration*.58));
    const flight=Math.max(1,duration-releaseAt);
    const clip=this.playChampionClip(a,'attack',{direction:a.facing,durationMs:duration,resolveAtRatio:1});
    const projectile=new Promise(resolve=>this.time.delayedCall(releaseAt,()=>{
      const len=Math.max(1,Math.hypot(dx,dy));
      const ux=dx/len,uy=dy/len;
      const x0=a.container.x+ux*16,y0=a.container.y-25+uy*4;
      const x1=t.container.x,y1=t.container.y-22;
      const angle=Math.atan2(y1-y0,x1-x0);
      const arrow=this.add.image(x0,y0,'vfx-archer-arrow').setOrigin(.5).setRotation(angle).setScale(.62).setAlpha(.98);
      this.tweens.add({targets:arrow,x:x1,y:y1,duration:flight,ease:'Linear',onComplete:()=>{
        arrow.destroy();
        const impact=this.add.image(x1,y1,'vfx-archer-impact').setOrigin(.5).setScale(.10).setAlpha(.85);
        this.tweens.add({targets:impact,scale:.15,alpha:0,duration:this.replayDuration(105),ease:'Sine.easeOut',onComplete:()=>impact.destroy()});
        resolve();
      }});
    }));
    return Promise.all([clip,projectile]).then(()=>undefined);
  }


  animateMageAttack(a,t){
    const dx=t.container.x-a.container.x,dy=t.container.y-a.container.y;
    a.facing=(a.unit?.position&&t.unit?.position)?directionFromCells(a.unit.position,t.unit.position,a.facing??'S'):directionFromDelta(dx,dy,a.facing??'S');
    const duration=this.replayDuration(205),releaseAt=Math.max(1,Math.round(duration*.58));
    const flight=Math.max(1,duration-releaseAt);
    const clip=this.playChampionClip(a,'attack',{direction:a.facing,durationMs:duration,resolveAtRatio:1});
    const projectile=new Promise(resolve=>this.time.delayedCall(releaseAt,()=>{
      const len=Math.max(1,Math.hypot(dx,dy));
      const ux=dx/len,uy=dy/len;
      const x0=a.container.x+ux*13,y0=a.container.y-24+uy*4;
      const x1=t.container.x,y1=t.container.y-20;
      const angle=Math.atan2(y1-y0,x1-x0);
      const bolt=this.add.graphics({x:x0,y:y0});
      bolt.lineStyle(2.5,0x8edcff,.98);
      bolt.beginPath();
      bolt.moveTo(-8,-2);
      bolt.lineTo(-2,-7);
      bolt.lineTo(-4,-1);
      bolt.lineTo(2,-3);
      bolt.lineTo(-1,6);
      bolt.lineTo(1,1);
      bolt.lineTo(7,2);
      bolt.strokePath();
      bolt.setRotation(angle);
      const glow=this.add.circle(x0,y0,4,0xf7f4a8,.40).setStrokeStyle(1,0xffffff,.65);
      const trail=this.add.circle(x0,y0,2,0x8edcff,.55);
      this.tweens.add({targets:[bolt,glow,trail],x:x1,y:y1,duration:flight,ease:'Linear',onUpdate:()=>{trail.x=bolt.x-ux*6;trail.y=bolt.y-uy*6;},onComplete:()=>{
        bolt.destroy();glow.destroy();trail.destroy();
        const impact=this.add.circle(x1,y1,4,0x8edcff,.42).setStrokeStyle(2,0xf7f4a8,.95);
        const spark=this.add.graphics({x:x1,y:y1});
        spark.lineStyle(2,0xffffff,.92);
        spark.beginPath();
        spark.moveTo(-6,0); spark.lineTo(6,0);
        spark.moveTo(0,-6); spark.lineTo(0,6);
        spark.strokePath();
        this.tweens.add({targets:[impact,spark],scale:2.0,alpha:0,duration:this.replayDuration(110),ease:'Sine.easeOut',onComplete:()=>{impact.destroy();spark.destroy();resolve();}});
      }});
    }));
    return Promise.all([clip,projectile]).then(()=>undefined);
  }

  dominantAttackFacing(from,to,fallback='S'){
    if(!from||!to)return fallback;
    const dr=Number(to.row)-Number(from.row);
    const dc=Number(to.col)-Number(from.col);
    const absDr=Math.abs(dr), absDc=Math.abs(dc);
    if(absDc>=absDr && dc!==0)return dc>0?'E':'W';
    if(dr!==0)return dr>0?'S':'N';
    return fallback;
  }

  animateBarbarianAttack(a,t){
    const dx=t.container.x-a.container.x,dy=t.container.y-a.container.y;
    if(a.unit?.position&&t.unit?.position){
      a.facing=this.dominantAttackFacing(a.unit.position,t.unit.position,a.facing??'S');
    }else{
      a.facing=directionFromDelta(dx,dy,a.facing??'S');
    }
    const duration=this.replayDuration(215), releaseAt=Math.max(1,Math.round(duration*.57));
    const flight=Math.max(1,duration-releaseAt);
    const clip=this.playChampionClip(a,'attack',{direction:a.facing,durationMs:duration,resolveAtRatio:1});
    const projectile=new Promise(resolve=>this.time.delayedCall(releaseAt,()=>{
      if(!this.anims.exists('barbarian-axe-spin')){
        this.anims.create({key:'barbarian-axe-spin',frames:[0,1,2,3].map(frame=>({key:'vfx-barbarian-axe',frame})),frameRate:18,repeat:-1});
      }
      const len=Math.max(1,Math.hypot(dx,dy));
      const ux=dx/len,uy=dy/len;
      const x0=a.container.x+ux*16,y0=a.container.y-24+uy*4;
      const x1=t.container.x,y1=t.container.y-22;
      const angle=Math.atan2(y1-y0,x1-x0);
      const axe=this.add.sprite(x0,y0,'vfx-barbarian-axe',0).setOrigin(.5).setScale(.60).setRotation(angle).setAlpha(.98);
      axe.play('barbarian-axe-spin');
      const streak=this.add.ellipse(x0,y0,10,4,0xcf5040,.40).setAngle(angle*180/Math.PI);
      this.tweens.add({targets:axe,x:x1,y:y1,duration:flight,ease:'Linear'});
      this.tweens.add({targets:streak,x:x1,y:y1,scaleX:2.2,alpha:0,duration:flight,ease:'Linear',onComplete:()=>{streak.destroy();}});
      this.time.delayedCall(flight,()=>{
        axe.destroy();
        const impact=this.add.circle(x1,y1,5,0xc3503a,.48).setStrokeStyle(2,0xf0d8a0,.92);
        const spark=this.add.ellipse(x1,y1,18,8,0xf0d8a0,.24).setAngle(angle*180/Math.PI);
        this.tweens.add({targets:[impact,spark],scale:2.0,alpha:0,duration:this.replayDuration(110),ease:'Sine.easeOut',onComplete:()=>{impact.destroy();spark.destroy();resolve();}});
      });
    }));
    return Promise.all([clip,projectile]).then(()=>undefined);
  }

  animateMonkPalmHit(a,t){
    const dx=t.container.x-a.container.x,dy=t.container.y-a.container.y,len=Math.max(1,Math.hypot(dx,dy));
    a.facing=(a.unit?.position&&t.unit?.position)?directionFromCells(a.unit.position,t.unit.position,a.facing??'S'):directionFromDelta(dx,dy,a.facing??'S');
    const duration=this.replayDuration(190),impactRatio=.68;
    if(a.animated&&a.sprite){
      const key=animationKey('Monk','palm-hit');
      const manifest=CHAMPION_ANIMATION_MANIFESTS.Monk;
      if(this.anims.exists(key)){
        a.sprite.anims.timeScale=1;
        a.sprite.play(key,true);
        const ringDelay=Math.max(1,Math.round(duration*impactRatio));
        this.time.delayedCall(ringDelay,()=>{
          const pulse=this.add.circle(t.container.x,t.container.y-20,5,0x9de8ff,.32).setStrokeStyle(2,0xe7fbff,.9);
          this.tweens.add({targets:pulse,scale:2.4,alpha:0,duration:this.replayDuration(95),onComplete:()=>pulse.destroy()});
        });
        return new Promise(resolve=>this.time.delayedCall(duration,()=>{this.playIdle(a);resolve();}));
      }
    }
    return this.playChampionClip(a,'attack',{direction:a.facing,durationMs:duration,resolveAtRatio:impactRatio});
  }

  animatePaladinShieldBashAttack(a,t,targetId=null){
    const dx=t.container.x-a.container.x,dy=t.container.y-a.container.y,len=Math.max(1,Math.hypot(dx,dy));
    a.facing=(a.unit?.position&&t.unit?.position)?directionFromCells(a.unit.position,t.unit.position,a.facing??'S'):directionFromDelta(dx,dy,a.facing??'S');
    const duration=this.replayDuration(190),impactRatio=.62,impactDelay=Math.max(1,Math.round(duration*impactRatio));
    const clip=this.playChampionClip(a,'attack',{direction:a.facing,durationMs:duration,resolveAtRatio:1});
    this.tweens.add({targets:a.container,x:a.container.x+dx/len*7,y:a.container.y+dy/len*7,duration:Math.max(1,Math.round(duration*.44)),yoyo:true,ease:'Sine.easeOut'});
    const fx=new Promise(resolve=>this.time.delayedCall(impactDelay,resolve));
    return Promise.all([clip,fx]).then(()=>undefined);
  }

  animateCounterCue(command){
    const v=this.unitViews.get(command.actorId);if(!v)return Promise.resolve();
    // COUNTER is an authoritative reaction marker, not the counter attack itself.
    // Counter movement events follow this cue; ATTACK_START later owns the actual attack animation.
    const ring=this.add.ellipse(v.container.x,v.container.y+16,34,14,0xb78cff,.08).setStrokeStyle(2,0xd7c2ff,.72);
    const spark=this.add.circle(v.container.x,v.container.y-18,3,0xe0d2ff,.7);
    return new Promise(resolve=>{
      let completed=0;
      const done=()=>{completed+=1;if(completed<2)return;ring.destroy();spark.destroy();resolve();};
      this.tweens.add({targets:ring,scaleX:1.45,scaleY:1.45,alpha:0,duration:this.replayDuration(70),ease:'Sine.easeOut',onComplete:done});
      this.tweens.add({targets:spark,y:spark.y-7,scale:1.8,alpha:0,duration:this.replayDuration(70),ease:'Sine.easeOut',onComplete:done});
    });
  }

  animateAttack(command){
    const a=this.unitViews.get(command.actorId),t=this.unitViews.get(command.targetId);if(!a||!t)return Promise.resolve();
    const actionId=String(command.payload?.actionId??this.lastActionByActor.get(command.actorId)??'').toUpperCase();
    if(a.unit?.archetypeId==='Mystic')return this.animateMysticDaggerAttack(a,t);
    if(a.unit?.archetypeId==='Archer')return this.animateArcherAttack(a,t);
    if(a.unit?.archetypeId==='Mage')return this.animateMageAttack(a,t);
    if(a.unit?.archetypeId==='Barbarian')return this.animateBarbarianAttack(a,t);
    if(a.unit?.archetypeId==='Paladin'&&actionId==='SHIELD_BASH')return this.animatePaladinShieldBashAttack(a,t,command.targetId);
    if(a.unit?.archetypeId==='Monk'&&actionId==='PALM_HIT')return this.animateMonkPalmHit(a,t);
    const dx=t.container.x-a.container.x,dy=t.container.y-a.container.y,len=Math.max(1,Math.hypot(dx,dy));
    if(a.animated&&a.sprite){
      if(a.unit?.archetypeId==='Barbarian'&&a.unit?.position&&t.unit?.position){
        a.facing=this.dominantAttackFacing(a.unit.position,t.unit.position,a.facing??'S');
      }else{
        a.facing=(a.unit?.position&&t.unit?.position)?directionFromCells(a.unit.position,t.unit.position,a.facing??'S'):directionFromDelta(dx,dy,a.facing??'S');
      }
      const duration=this.replayDuration(180),impactRatio=.62;
      this.tweens.add({targets:a.container,x:a.container.x+dx/len*6,y:a.container.y+dy/len*6,duration:Math.max(1,Math.round(duration*.45)),yoyo:true,ease:'Sine.easeOut'});
      return this.playChampionClip(a,'attack',{direction:a.facing,durationMs:duration,resolveAtRatio:impactRatio});
    }
    return new Promise(resolve=>this.tweens.add({targets:a.container,x:a.container.x+dx/len*9,y:a.container.y+dy/len*9,duration:this.replayDuration(55),yoyo:true,onComplete:resolve}));
  }

  animateProjectile(command){
    let from=command.payload.from,to=command.payload.to;
    const ability=String(command.payload?.abilityId??command.payload?.actionId??this.lastSpellAbilityByActor.get(command.actorId)??'').toUpperCase();
    if((!from||!to) && ability==='CHAIN_LIGHTNING' && command.payload?.fromTargetId && command.payload?.toTargetId){
      const fromView=this.unitViews.get(command.payload.fromTargetId),toView=this.unitViews.get(command.payload.toTargetId);
      if(fromView&&toView){
        from={x:fromView.unit?.position?.x??0,y:fromView.unit?.position?.y??0};
        to={x:toView.unit?.position?.x??0,y:toView.unit?.position?.y??0};
      }
    }
    if(!from||!to)return Promise.resolve();
    const a=gridToWorld(from,this.view),b=gridToWorld(to,this.view);
    if(ability==='CHAIN_LIGHTNING'){
      if(!this.lastChainLightningTargetByActor)this.lastChainLightningTargetByActor=new Map();
      if(command.actorId && command.targetId)this.lastChainLightningTargetByActor.set(command.actorId, command.targetId);
      return this.animateLightningArc(a,b);
    }
    if(ability==='INSULT')return this.animateInsultWave(a,b);
    if(ability==='PIERCING_LIGHT')return this.animateAreaBurst(b,{color:0xfff3ad,radius:70,shape:'LIGHT'});
    if(ability==='VOLLEY')return this.animateArcherVolleyCluster(b);
    if(ability==='FIREBALL')return this.animateMageFireball(a,b);
    if(ability==='METEOR')return this.animateMageMeteorImpact(b);
    if(ability==='POISON_BOLT'){
      const shots=[];
      for(let i=0;i<3;i++){
        shots.push(new Promise(resolve=>this.time.delayedCall(this.replayDuration(i*28),()=>{
          this.animateImageProjectile(
            {x:a.x+((i-1)*4),y:a.y-2+((i%2)?3:-1)},
            {x:b.x+((i-1)*5),y:b.y+((i%2)?2:-2)},
            'vfx-necro-toxic-orb',
            {scale:.097,duration:205+i*18,impactKey:i===2?'vfx-necro-cloud':null,impactScale:.11,yStart:-12,yEnd:-14,rotate:false,depth:12}
          ).then(resolve);
        })));
      }
      return Promise.all(shots).then(()=>undefined);
    }
    if(ability==='DEATH_TOUCH')return this.animateImageProjectile(a,b,'vfx-necro-skull',{scale:.13,duration:245,impactKey:'vfx-necro-impact',impactScale:.11});
    if(ability==='LIFE_DRAIN')return this.animateNecromancerDrain(a,b);
    if(/POISON|PLAGUE|DRAIN|DEATH_TOUCH/.test(ability))return this.animateMagicProjectile(a,b,{color:0x4cae5f,core:0xb7e68a,blastRadius:28});
    return this.animateMagicProjectile(a,b,{color:0x9b7dff,core:0xe1d5ff,blastRadius:28});
  }

  animateInsultWave(a,b){
    const word=this.add.text(a.x,a.y-46,'!',{fontFamily:'monospace',fontSize:'16px',fontStyle:'bold',color:'#ffb45c',stroke:'#3b0b0b',strokeThickness:3}).setOrigin(.5);
    const wave=this.add.ellipse(a.x,a.y-25,8,18,0xff8a4c,.04).setStrokeStyle(2,0xffb45c,.85);
    return new Promise(resolve=>this.tweens.add({targets:[word,wave],x:b.x,y:b.y-25,scaleX:1.35,scaleY:1.2,alpha:{from:.95,to:.15},duration:this.replayDuration(190),ease:'Quad.easeOut',onComplete:()=>{
      word.destroy();wave.destroy();
      const pop=this.add.circle(b.x,b.y-22,5,0xff8a4c,.35).setStrokeStyle(2,0xffc27a,.8);
      this.tweens.add({targets:pop,scale:2.6,alpha:0,duration:this.replayDuration(110),onComplete:()=>{pop.destroy();resolve();}});
    }}));
  }

  animateMagicProjectile(a,b,{color=0xff7428,core=0xffdb7b,blastRadius=32}={}){
    const orb=this.add.circle(a.x,a.y-10,7,color,.9).setStrokeStyle(2,core,1);
    const trail=this.add.circle(a.x,a.y-10,4,core,.4);
    return new Promise(resolve=>this.tweens.add({targets:[orb,trail],x:b.x,y:b.y-8,duration:this.replayDuration(250),ease:'Quad.easeIn',onUpdate:()=>{trail.x=orb.x-4;trail.y=orb.y+2;},onComplete:()=>{
      orb.destroy();trail.destroy();
      const blast=this.add.circle(b.x,b.y-8,8,color,.72).setStrokeStyle(2,core,.85);
      this.tweens.add({targets:blast,scale:Math.max(2.5,blastRadius/8),alpha:0,duration:this.replayDuration(190),onComplete:()=>{blast.destroy();resolve();}});
    }}));
  }

  animateLightningArc(a,b){
    const g=this.add.graphics();
    g.lineStyle(3,0x8edcff,.95);g.beginPath();g.moveTo(a.x,a.y-14);
    const steps=6;
    for(let i=1;i<steps;i++){const t=i/steps;const x=a.x+(b.x-a.x)*t;const y=a.y-14+(b.y-a.y)*t+((i%2?1:-1)*5);g.lineTo(x,y);}
    g.lineTo(b.x,b.y-14);g.strokePath();
    const flash=this.add.circle(b.x,b.y-14,6,0xf7f4a8,.8);
    return new Promise(resolve=>this.tweens.add({targets:[g,flash],alpha:0,duration:this.replayDuration(170),onComplete:()=>{g.destroy();flash.destroy();resolve();}}));
  }

  animateMageFireball(a,b){
    const dx=b.x-a.x,dy=b.y-a.y;
    const len=Math.max(1,Math.hypot(dx,dy));
    const ux=dx/len,uy=dy/len;
    const x0=a.x+ux*14,y0=a.y-22+uy*4;
    const x1=b.x,y1=b.y-18;
    const fireball=this.add.image(x0,y0,'vfx-mage-fireball').setOrigin(.5).setScale(.34).setAlpha(.98).setDepth(12);
    // Keep the projectile horizontally mirrored only: the fireball head should lead,
    // with the tail nearest the Mage. Do not rotate, flip vertically, or apply any
    // north/south mirroring so East-to-West casts cannot appear upside down.
    fireball.setFlipX(dx>0);
    return new Promise(resolve=>this.tweens.add({targets:fireball,x:x1,y:y1,duration:this.replayDuration(250),ease:'Quad.easeIn',onComplete:()=>{
      fireball.destroy();
      const blast=this.add.image(b.x,b.y-20,'vfx-mage-fireball-impact').setOrigin(.5).setScale(.62).setAlpha(.98).setDepth(12);
      this.tweens.add({targets:blast,scale:.74,alpha:0,duration:this.replayDuration(520),ease:'Sine.easeOut',onComplete:()=>{blast.destroy();resolve();}});
    }}));
  }

  animateMageMeteorImpact(b){
    const fx=this.add.image(b.x,b.y-22,'vfx-mage-meteor').setOrigin(.5).setScale(.34).setAlpha(.98).setDepth(12);
    return new Promise(resolve=>this.tweens.add({targets:fx,scale:.44,alpha:0,duration:this.replayDuration(440),ease:'Sine.easeOut',onComplete:()=>{fx.destroy();resolve();}}));
  }

  animateMeteor(b){
    const rock=this.add.circle(b.x-34,b.y-90,9,0xc75b32,1).setStrokeStyle(3,0xffbf5a,.9);
    return new Promise(resolve=>this.tweens.add({targets:rock,x:b.x,y:b.y-6,duration:this.replayDuration(220),ease:'Cubic.easeIn',onComplete:()=>{
      rock.destroy();this.animateAreaBurst(b,{color:0xff7a34,radius:58,shape:'FIRE'}).then(resolve);
    }}));
  }

  animateAreaBurst(pos,{color=0xbda8ff,radius=48,shape='MAGIC'}={}){
    const ring=this.add.circle(pos.x,pos.y-8,8,color,.18).setStrokeStyle(3,color,.88);
    const core=this.add.circle(pos.x,pos.y-8,5,color,.65);
    if(shape==='LIGHT'){
      const beam=this.add.rectangle(pos.x,pos.y-45,10,75,color,.28);
      this.tweens.add({targets:beam,alpha:0,scaleX:2.2,duration:this.replayDuration(220),onComplete:()=>beam.destroy()});
    }else if(shape==='VOLLEY'){
      for(let i=0;i<6;i++){
        const dx=(i-2.5)*12;
        const arrow=this.add.rectangle(pos.x+dx,pos.y-42-Math.abs(i-2.5)*3,3,26,0xe8dfb1,.9).setRotation(.12).setDepth(12);
        const head=this.add.triangle(arrow.x+2,arrow.y-13,0,0,5,3,0,6,0xc49a58,.95).setRotation(.12).setDepth(12);
        this.tweens.add({targets:[arrow,head],y:'+=28',x:'+=2',alpha:0,duration:this.replayDuration(200),delay:this.replayDuration(i*16),onComplete:()=>{arrow.destroy();head.destroy();}});
        this.time.delayedCall(this.replayDuration(96+i*16),()=>{
          const impact=this.add.circle(pos.x+dx,pos.y-4+(i%2?3:-2),5,0xcbe864,.28).setStrokeStyle(2,0xf4efb0,.8).setDepth(11);
          this.tweens.add({targets:impact,scale:1.8,alpha:0,duration:this.replayDuration(120),onComplete:()=>impact.destroy()});
        });
      }
    }
    return new Promise(resolve=>this.tweens.add({targets:[ring,core],scale:Math.max(3,radius/8),alpha:0,duration:this.replayDuration(220),onComplete:()=>{ring.destroy();core.destroy();resolve();}}));
  }

  spawnImpactVfx(command){
    const v=this.unitViews.get(command.targetId);if(!v)return;
    const type=String(command.payload?.damageType??'PHYSICAL').toUpperCase();
    const ability=String(command.payload?.abilityId??command.payload?.actionId??'').toUpperCase();
    const attacker=this.unitViews.get(command.actorId);
    if(attacker?.unit?.archetypeId==='Archer') this.spawnArcherImpactSignatureFx(v,ability);
    if(attacker?.unit?.archetypeId==='Barbarian'){
      if(ability==='SMASH') this.pulseImageFx('vfx-barbarian-impact',v.container.x,v.container.y-22,{scale:.255,duration:360,alpha:.96,scaleTo:.33});
      else if(ability==='BLOODLUST') this.pulseImageFx('vfx-barbarian-blood',v.container.x,v.container.y-22,{scale:.255,duration:360,alpha:.96,scaleTo:.33});
      else if(ability==='REND') this.pulseImageFx('vfx-barbarian-rend',v.container.x,v.container.y-22,{scale:.255,duration:380,alpha:.96,scaleTo:.33});
    }
    if(attacker?.unit?.archetypeId==='Electromancer'&&ability==='ELECTRO_ATTACK'&&type==='MAGICAL'){
      this.pulseImageFx('vfx-electro-impact',v.container.x,v.container.y-22,{scale:.34,duration:320,alpha:.96,scaleTo:.44});
    }
    if(attacker?.unit?.archetypeId==='Necromancer'&&ability==='PLAGUE_DETONATION'&&type==='POISON'){
      this.pulseImageFx('vfx-necro-impact',v.container.x,v.container.y-22,{scale:.34,duration:380,alpha:.96,scaleTo:.44});
    }
    if(type==='PHYSICAL'){
      const g=this.add.graphics();g.lineStyle(command.payload?.critical?4:3,command.payload?.critical?0xffdf61:0xf3f5f7,.9);
      g.lineBetween(v.container.x-11,v.container.y-16,v.container.x+12,v.container.y-4);
      g.lineBetween(v.container.x+7,v.container.y-19,v.container.x-8,v.container.y-1);
      this.tweens.add({targets:g,alpha:0,duration:this.replayDuration(120),onComplete:()=>g.destroy()});
    }else if(type==='POISON'){
      if(!(attacker?.unit?.archetypeId==='Necromancer'&&ability==='PLAGUE_DETONATION')) this.spawnStatusBurst(v,0x4cae5f);
    }
    else if(type==='BLEED'){
      if(attacker?.unit?.archetypeId==='Shinobi') this.pulseImageFx('vfx-shinobi-bleed',v.container.x,v.container.y-22,{scale:.34,duration:440,alpha:.96,scaleTo:.44});
      else this.spawnStatusBurst(v,0xe85662);
    }
    else if(!/FIREBALL|METEOR|CHAIN_LIGHTNING|PIERCING_LIGHT/.test(ability))this.spawnStatusBurst(v,0x9edbff);
  }

  spawnStatusBurst(v,color){
    const dots=[];
    for(let i=0;i<5;i++){const d=this.add.circle(v.container.x+(i-2)*4,v.container.y-10-(i%2)*5,2,color,.8);dots.push(d);this.tweens.add({targets:d,y:d.y-12-(i%3)*3,alpha:0,duration:this.replayDuration(180),onComplete:()=>d.destroy()});}
  }

  flashUnit(id,color){
    const v=this.unitViews.get(id);if(!v)return Promise.resolve();const old=v.body.fillColor;v.body.setFillStyle(color);
    return new Promise(resolve=>this.time.delayedCall(this.replayDuration(100),()=>{v.body.setFillStyle(old);resolve();}));
  }

  updateLiveHp(id,hpAfter){
    const v=this.unitViews.get(id);if(!v||!Number.isFinite(hpAfter))return;
    v.unit.stats.hp=Math.max(0,hpAfter);v.hp.width=44*Math.max(0,v.unit.stats.hp/v.unit.stats.maxHP);if(this.inspectedUnitId===id)this.renderSelectedUnit();
  }

  async damageFeedback(command){
    this.updateLiveHp(command.targetId,command.payload.hpAfter);
    const type=String(command.payload?.damageType??'PHYSICAL').toUpperCase();
    const ability=String(command.payload?.abilityId??command.payload?.actionId??'').toUpperCase();
    const colors={MAGICAL:'#9edbff',PHYSICAL:'#f4f6fa',BLEED:'#ff5f68',POISON:'#2f8f46'};
    const v=this.unitViews.get(command.targetId);
    if(v&&ability==='PLAGUE_DETONATION'&&type==='POISON'){v.unit.statuses=(v.unit.statuses??[]).filter(s=>String(s.key??'').toLowerCase()!=='poison');this.refreshStatusDots(v);}
    this.spawnImpactVfx(command);const feedback=[this.floatText(command.targetId,`-${command.payload.amount??'DMG'}`,colors[type]??'#f4f6fa')];
    if(ability==='CHAIN_LIGHTNING' && command.actorId && command.targetId){
      if(!this.lastChainLightningTargetByActor)this.lastChainLightningTargetByActor=new Map();
      const prevTargetId=this.lastChainLightningTargetByActor.get(command.actorId);
      if(prevTargetId && prevTargetId!==command.targetId){
        const fromView=this.unitViews.get(prevTargetId),toView=this.unitViews.get(command.targetId);
        if(fromView&&toView){
          const a={x:fromView.container.x,y:fromView.container.y};
          const b={x:toView.container.x,y:toView.container.y};
          feedback.unshift(this.animateLightningArc(a,b));
        }
      }
      this.lastChainLightningTargetByActor.set(command.actorId, command.targetId);
    }
    const attacker=this.unitViews.get(command.actorId);
    if(ability==='SHIELD_BASH'&&attacker?.unit?.archetypeId==='Paladin'){
      this.spawnPaladinSignatureFx(attacker,'SHIELD_BASH',command.targetId,v?.unit?.position??null);
    }
    if(v?.animated&&v.unit.lifeState===LIFE_STATE.ALIVE){
      let shouldMirrorHit=false;
      if(['Barbarian','Electromancer','Cleric','Rogue','Mage','Shinobi'].includes(v.unit?.archetypeId)){
        const attacker=this.unitViews.get(command.actorId);
        if(attacker?.unit?.position&&v.unit?.position){
          // Shared hit art is authored facing east. Mirror it when the damaging champion
          // is west of the victim, including NW/SW diagonal impacts.
          const dc=Number(attacker.unit.position.col)-Number(v.unit.position.col);
          shouldMirrorHit=dc<0||(dc===0&&v.facing==='W');
        }else{
          shouldMirrorHit=v.facing==='W';
        }
      }
      feedback.push(this.playSharedChampionClip(v,'hit',{durationMs:this.replayDuration(120),returnToIdle:true,mirror:shouldMirrorHit}));
    }
    await Promise.all(feedback);
  }

  async healFeedback(command){
    this.updateLiveHp(command.targetId,command.payload.hpAfter);
    const v=this.unitViews.get(command.targetId);
    const ability=String(command.payload?.abilityId??command.payload?.actionId??'').toUpperCase();
    const attacker=this.unitViews.get(command.actorId);
    if(v && !(attacker?.unit?.archetypeId==='Archer' && ability==='RANGERS_FOCUS')) this.spawnStatusBurst(v,0x79ff93);
    await this.floatText(command.targetId,`+${command.payload.amount??'HEAL'}`,'#79ff93');
  }

  floatText(id,text,color,{xOffset=0,yOffset=0,duration=300}={}){
    const v=this.unitViews.get(id);if(!v)return Promise.resolve();
    const t=this.add.text(v.container.x+xOffset,v.container.y-68+yOffset,String(text),{fontFamily:'monospace',fontSize:'14px',fontStyle:'bold',color,backgroundColor:'#05070aaa',padding:{x:3,y:1}}).setOrigin(.5);
    return new Promise(resolve=>this.tweens.add({targets:t,y:t.y-22,alpha:0,duration:this.replayDuration(duration),onComplete:()=>{t.destroy();resolve();}}));
  }

  koUnit(id){
    const v=this.unitViews.get(id);if(!v)return Promise.resolve();v.unit.lifeState=LIFE_STATE.DEAD;this.refreshStatusDots(v);if(this.inspectedUnitId===id)this.renderSelectedUnit();
    if(v.animated&&v.sprite){
      v.container.setAngle(0).setAlpha(1);
      return this.playSharedChampionClip(v,'ko',{direction:v.facing??'S',durationMs:this.replayDuration(300),returnToIdle:false}).then(()=>{
        const finalFrame=CHAMPION_ANIMATION_MANIFESTS[v.unit.archetypeId]?.ko?.at(-1);
        if(Number.isInteger(finalFrame)){
          v.sprite.stop();
          v.sprite.setFrame(finalFrame);
        }
        v.container.setAlpha(.62);
      });
    }
    return new Promise(resolve=>this.tweens.add({targets:v.container,alpha:.35,angle:90,duration:this.replayDuration(180),onComplete:resolve}));
  }

  resurrectUnit(id,payload={}){
    const v=this.unitViews.get(id);if(!v)return Promise.resolve();
    v.unit.lifeState=LIFE_STATE.ALIVE;v.unit.statuses=[];this.refreshStatusDots(v);
    if(Number.isFinite(payload.hp))this.updateLiveHp(id,payload.hp);
    if(payload.position){const p=gridToWorld(payload.position,this.view);v.container.setPosition(p.x,p.y);v.unit.position={...payload.position};this.syncUnitDepth(v,payload.position);}
    v.container.setAngle(0).setAlpha(1);if(this.inspectedUnitId===id)this.renderSelectedUnit();
    const holy=this.add.circle(v.container.x,v.container.y-8,7,0xfff0a8,.28).setStrokeStyle(3,0xfff0a8,.9);
    const beam=this.add.rectangle(v.container.x,v.container.y-42,10,72,0xfff6c8,.24);
    this.tweens.add({targets:[holy,beam],alpha:0,scaleX:2.3,duration:this.replayDuration(300),onComplete:()=>{holy.destroy();beam.destroy();}});
    if(v.animated&&v.sprite)return this.playSharedChampionClip(v,'resurrect',{direction:v.facing??'S',durationMs:this.replayDuration(320),returnToIdle:true});
    return new Promise(resolve=>this.tweens.add({targets:v.container,scaleX:1.12,scaleY:1.12,duration:this.replayDuration(120),yoyo:true,onComplete:()=>{v.container.setScale(1);resolve();}}));
  }

  renderSelectedUnit(){
    const state=this.currentState(),liveUnit=this.unitViews.get(this.inspectedUnitId)?.unit,unit=(this.busy&&liveUnit)?liveUnit:state?.units?.[this.inspectedUnitId];
    const name=document.getElementById('selectedUnit'),stats=document.getElementById('unitStats'),chips=document.getElementById('statusChips'),badge=document.getElementById('inspectedSide');
    if(!unit){if(name)name.textContent='Click any champion on the battlefield.';if(stats)stats.textContent='';if(chips)chips.innerHTML='';if(badge)badge.textContent='—';return;}
    const h=unitHudModel(unit),isAlly=unit.side===this.playerSelectionSide();
    if(name)name.innerHTML=`<span class="selected-summary"><strong>${unit.archetypeId}</strong> <span class="unit-id">${unit.unitId}</span>${h.alive?'':' <span class="ko-label">KO</span>'}</span>`;
    if(badge){badge.textContent=isAlly?'ALLY':'ENEMY';badge.className=`side-badge ${isAlly?'ally':'enemy'}`;}
    if(stats){
      const ps=h.playerStats;
      const tone=x=>x.pct>0?'up':(x.pct<0?'down':'');
      const mitigationTone=(current,baseline)=>current>baseline?'up':(current<baseline?'down':'');
      const shieldParts=[];if(ps.physicalShieldPct)shieldParts.push(`Physical Shield ${ps.physicalShieldPct}%`);if(ps.magicShieldPct)shieldParts.push(`Magic Shield ${ps.magicShieldPct}%`);if(ps.divineShieldPct)shieldParts.push(`Divine Shield ${ps.divineShieldPct}%`);
      const stat=(label,value,title,cls='')=>`<span class="compact-stat ${cls}" title="${title}"><small>${label}</small><b>${value}</b></span>`;
      const base=getArchetype(unit.archetypeId);
      const resourceTone=(current,baseline)=>current>baseline?'up':(current<baseline?'down':'');
      stats.innerHTML=`<div class="stat-row resources">${[
        stat('HP',`${h.hp}/${h.maxHP}`,'Current / maximum HP'),
        stat('MOV',`${h.movementMax}`,'Movement available at the start of a round.',resourceTone(h.movementMax,base.combat.movementMax)),
        stat('SW',`${h.attacksMax}`,'Basic attack / counter swing pool at the start of a round.',resourceTone(h.attacksMax,base.combat.attacksMax)),
        stat('QKN',h.qkn,'Quickness — initiative priority')
      ].join('')}</div><div class="stat-row combat">${[
        stat('ATK',`${ps.attackPct}%`,`Physical damage multiplier before ability-specific multipliers. ${ps.attackPct}% = ${(ps.attackPct/100).toFixed(2)}× raw physical damage.`,tone(ps.atkRaw)),
        stat('SDM',`${ps.spellPowerPct}%`,`Spell Damage/Healing multiplier. ${ps.spellPowerPct}% = ${(ps.spellPowerPct/100).toFixed(2)}× listed magical/healing values.`,tone(ps.sdmRaw)),
        stat('ARM',`${ps.armorMitigationPct}%`,`Effective physical mitigation before penetration. Base ARM ${ps.armorBasePct}%${ps.physicalShieldPct?` + Physical Shield ${ps.physicalShieldPct}%`:''}${ps.divineShieldPct?` + Divine Shield ${ps.divineShieldPct}%`:''}.`,mitigationTone(ps.armorMitigationPct,ps.defRaw.base)),
        stat('RES',`${ps.resistanceMitigationPct}%`,`Effective magical mitigation before penetration. Base RES ${ps.resistanceBasePct}%${ps.magicShieldPct?` + Magic Shield ${ps.magicShieldPct}%`:''}${ps.divineShieldPct?` + Divine Shield ${ps.divineShieldPct}%`:''}.`,mitigationTone(ps.resistanceMitigationPct,ps.resRaw.base))
      ].join('')}</div>`;
    }
    if(chips){
      chips.innerHTML='';
      if(!h.statuses.length){const empty=document.createElement('span');empty.className='status-none';empty.textContent='No active statuses';chips.appendChild(empty);}
      for(const status of h.statuses){const chip=document.createElement('span');chip.className=`status-chip ${status.tone}`;chip.title=status.tooltip??'';chip.dataset.tooltip=status.tooltip??'';chip.setAttribute('aria-label',status.tooltip??status.label);chip.innerHTML=`<b>${status.label}</b>${status.detail?` <small>${status.detail}</small>`:''}`;chips.appendChild(chip);}
    }
  }

  renderChampionButtons(){
    const box=document.getElementById('championButtons');if(!box)return;box.innerHTML='';
    const state=this.currentState();if(!state||!this.session)return;
    const units=Object.values(state.units)
      .filter(u=>u.side===this.playerSelectionSide())
      .sort((a,b)=>(a.position?.row??999)-(b.position?.row??999)||(a.position?.col??999)-(b.position?.col??999)||a.draftSlot-b.draftSlot||a.unitId.localeCompare(b.unitId));
    for(const unit of units){
      const declaration=this.session.get(unit.unitId),hud=unitHudModel(unit);
      const b=document.createElement('button');b.className='champion-select command-row';
      if(unit.unitId===this.selectedActorId)b.classList.add('active');
      if(declaration)b.classList.add('assigned');
      if(unit.lifeState!==LIFE_STATE.ALIVE)b.classList.add('dead');
      b.disabled=this.busy||unit.lifeState!==LIFE_STATE.ALIVE;
      const statusText=hud.statuses.length?hud.statuses.map(s=>`${s.label}${s.detail?` ${s.detail}`:''}`).join(' · '):'No statuses';
      b.innerHTML=`<div class="command-row-top"><strong>${unit.archetypeId}</strong><small>${unit.unitId} • HP ${hud.hp}/${hud.maxHP}</small></div><div class="command-row-status">${statusText}</div><div class="command-row-action"><span>${declaration?actionSummary(declaration,state):'Choose action…'}</span>${declaration?'<b>✓</b>':''}</div>`;
      b.onclick=()=>this.selectActor(unit.unitId);box.appendChild(b);
    }
  }

  renderAbilityDetail(actor,ability){
    const title=document.getElementById('abilityInfoTitle'),meta=document.getElementById('abilityInfoMeta'),body=document.getElementById('abilityInfoBody');
    if(!title||!meta||!body)return;
    if(!actor||!ability){title.textContent='Ability Details';meta.textContent='Hover an ability';body.textContent='Hover an action to see its damage, timing, targeting and important effects.';return;}
    const d=abilityDetailModel(actor,ability);
    title.textContent=d.label;
    meta.textContent=`${d.actionKind} • ${d.target} • ${d.timing}`;
    const pieces=[];
    for(const line of d.lines){const lower=line.toLowerCase();const damageClass=lower.includes('magical')?' magical':(lower.includes('physical')||lower.includes('weapon')?' physical':'');pieces.push(`<span class="ability-detail-line${damageClass}">${line}</span>`);}
    if(d.note)pieces.push(`<span class="ability-detail-note">${d.note}</span>`);
    body.innerHTML=pieces.join('')||'<span class="ability-detail-note">No additional effect text.</span>';
  }

  emitSelectionUi(){
    this.renderChampionButtons();this.renderSelectedUnit();
    const box=document.getElementById('abilityButtons');box.innerHTML='';
    const targetMode=document.getElementById('targetMode'),targetHint=document.getElementById('targetHint'),editorTitle=document.getElementById('editorTitle');
    targetMode?.classList.toggle('hidden',!this.pendingAbility);
    if(targetHint&&this.pendingAbility)targetHint.textContent=this.pendingAbility.deadTargetOnly===true
      ? `TARGETING: ${this.pendingAbility.label} — KO'D ALLY/CORPSE ONLY`
      : `TARGETING: ${this.pendingAbility.label}`;
    const hold=document.getElementById('holdButton');
    if(!this.selectedActorId){if(editorTitle)editorTitle.textContent='Choose a friendly champion row to edit an action.';if(hold)hold.disabled=true;this.renderAbilityDetail(null,null);return;}
    const state=this.currentState(),actor=state.units[this.selectedActorId];
    if(editorTitle)editorTitle.innerHTML=`Editing <strong>${actor.archetypeId}</strong> — ${this.session?.get(actor.unitId)?`currently <b>${actionSummary(this.session.get(actor.unitId),state)}</b>`:'no action selected yet'}`;
    if(hold)hold.disabled=this.busy||actor.lifeState!==LIFE_STATE.ALIVE;
    const abilities=[...getArchetype(actor.archetypeId).abilities.filter(a=>a.playable!==false)].sort((a,b)=>(a.label==='Attack'?-1:0)-(b.label==='Attack'?-1:0));
    for(const a of abilities){
      const b=document.createElement('button');
      const kindClass=a.actionKind==='SPELL'?'spell':(a.actionKind==='BASIC_ATTACK'?'attack':(a.actionKind==='ITEM'?'item':'ability'));
      const remaining=abilityUsesRemaining(actor,a);
      const exhausted=remaining===0;
      b.className=`ability kind-${kindClass}`;if(this.pendingAbility?.id===a.id)b.classList.add('armed');if(exhausted)b.classList.add('exhausted');
      const useMeta=remaining===null?'':` • Uses ${remaining}/${a.usesMax}`;
      b.innerHTML=`<span class="ability-name">${a.label}</span><span class="meta">${compactAbilitySummary(a)}${useMeta}</span>`;
      b.disabled=this.busy||actor.lifeState!==LIFE_STATE.ALIVE||exhausted;
      const useText=abilityUseText(actor,a);
      b.title=exhausted?`${a.label}: no uses remaining (${a.usesMax} max per match).`:(useText?`${a.label}: ${useText}.`:'');
      b.onclick=()=>{this.renderAbilityDetail(actor,a);this.chooseAbility(a.id);};
      b.onmouseenter=()=>this.renderAbilityDetail(actor,a);b.onfocus=()=>this.renderAbilityDetail(actor,a);
      box.appendChild(b);
    }
    const currentDecl=this.session?.get(actor.unitId);const currentAbility=currentDecl?.payload?.roster?.abilityId?abilities.find(a=>a.id===currentDecl.payload.roster.abilityId):null;
    this.renderAbilityDetail(actor,this.pendingAbility??currentAbility??abilities[0]??null);
  }

  updateLockedActions(){
    if(!this.session)return;
    const assigned=this.session.actorIds.filter(id=>this.session.get(id)).length,total=this.session.actorIds.length;
    const count=document.getElementById('assignedCount');if(count)count.textContent=`${assigned} / ${total}`;
    const submit=document.getElementById('submitButton');if(submit){submit.disabled=this.busy||this.session.locked||assigned<total;submit.textContent='LOCK ACTIONS';submit.title=assigned<total?`${assigned}/${total} living champion actions assigned`:'Lock the selected actions for this round';}
    this.renderChampionButtons();
  }

  setStatus(text){document.getElementById('statusLine').textContent=text;}
  log(text,kind='system'){
    const box=document.getElementById('combatLog');if(!box)return;
    const line=document.createElement('div');line.className=`log-line ${kind}`;line.textContent=text;box.appendChild(line);box.scrollTop=box.scrollHeight;
  }
}
