export const CHAMPION_FRAME = Object.freeze({ width:32, height:40 });
export const CHAMPION_HD_FRAME = Object.freeze({ width:64, height:80 });
export const LARGE_HD_FRAME = Object.freeze({ width:80, height:96 });
export const LARGE_HD_RENDER_SCALE = 5/6;
export const CHAMPION_RENDER_SCALE = 2.0;
export const CHAMPION_SHEET_COLUMNS = 18;
export const COMPACT_SHEET_COLUMNS = 15;
export const BARBARIAN_SHEET_COLUMNS = 17;
export const ROGUE_RENDER_SCALE = 1.048;
export const CHAMPION_DIRECTIONS = Object.freeze(['N','S','E','W']);
export const CHAMPION_ANIMATION_IDS = Object.freeze([
  'Warrior','Barbarian','Rogue','Cleric','Mage','Paladin','Archer','Monk','Necromancer','Mystic','Shinobi','Electromancer'
]);

const rowFor = Object.freeze({ N:0, S:1, E:2, W:3 });
const frame = (dir,col,columns=CHAMPION_SHEET_COLUMNS)=>rowFor[dir]*columns+col;
const range = (dir,start,count,columns=CHAMPION_SHEET_COLUMNS)=>Object.freeze(Array.from({length:count},(_,i)=>frame(dir,start+i,columns)));

function buildManifest(archetypeId){
  const slug=String(archetypeId).toLowerCase();
  const hd = false;
  const compactContract = archetypeId === 'Rogue' || archetypeId === 'Mage' || archetypeId === 'Shinobi';
  const barbarianContract = archetypeId === 'Barbarian';
  const monkContract = archetypeId === 'Monk';
  const mysticContract = archetypeId === 'Mystic';
  const largeHd = archetypeId === 'Archer' || archetypeId === 'Cleric' || archetypeId === 'Paladin' || archetypeId === 'Necromancer' || archetypeId === 'Electromancer' || archetypeId === 'Barbarian' || archetypeId === 'Warrior' || monkContract || mysticContract || compactContract;
  const frameSpec = largeHd ? LARGE_HD_FRAME : (hd ? CHAMPION_HD_FRAME : CHAMPION_FRAME);
  const rogueContract = archetypeId === 'Rogue';
  const mageContract = archetypeId === 'Mage';
  const sheetColumns = (barbarianContract || monkContract || mysticContract) ? BARBARIAN_SHEET_COLUMNS : (compactContract ? COMPACT_SHEET_COLUMNS : CHAMPION_SHEET_COLUMNS);
  const clips = (barbarianContract || monkContract || mysticContract) ? Object.freeze({
    N:Object.freeze({idle:range('N',0,1,sheetColumns),walk:range('N',1,4,sheetColumns),attack:range('N',5,5,sheetColumns),cast:range('N',10,5,sheetColumns)}),
    S:Object.freeze({idle:range('S',0,1,sheetColumns),walk:range('S',1,4,sheetColumns),attack:range('S',5,5,sheetColumns),cast:range('S',10,5,sheetColumns)}),
    E:Object.freeze({idle:range('E',0,1,sheetColumns),walk:range('E',1,4,sheetColumns),attack:range('E',5,5,sheetColumns),cast:range('E',10,5,sheetColumns)}),
    W:Object.freeze({idle:range('W',0,1,sheetColumns),walk:range('W',1,4,sheetColumns),attack:range('W',5,5,sheetColumns),cast:range('W',10,5,sheetColumns)})
  }) : compactContract ? Object.freeze({
    N:Object.freeze({idle:range('N',0,1,sheetColumns),walk:range('N',1,4,sheetColumns),attack:range('N',5,5,sheetColumns),cast:range('N',10,5,sheetColumns)}),
    S:Object.freeze({idle:range('S',0,1,sheetColumns),walk:range('S',1,4,sheetColumns),attack:range('S',5,5,sheetColumns),cast:range('S',10,5,sheetColumns)}),
    E:Object.freeze({idle:range('E',0,1,sheetColumns),walk:range('E',1,4,sheetColumns),attack:range('E',5,5,sheetColumns),cast:range('E',10,5,sheetColumns)}),
    W:Object.freeze({idle:range('W',0,1,sheetColumns),walk:range('W',1,4,sheetColumns),attack:range('W',5,5,sheetColumns),cast:range('W',10,5,sheetColumns)})
  }) : Object.freeze({
    N:Object.freeze({idle:range('N',0,4,sheetColumns),walk:range('N',4,4,sheetColumns),attack:range('N',8,5,sheetColumns),cast:range('N',13,5,sheetColumns)}),
    S:Object.freeze({idle:range('S',0,4,sheetColumns),walk:range('S',4,4,sheetColumns),attack:range('S',8,5,sheetColumns),cast:range('S',13,5,sheetColumns)}),
    E:Object.freeze({idle:range('E',0,4,sheetColumns),walk:range('E',4,4,sheetColumns),attack:range('E',8,5,sheetColumns),cast:range('E',13,5,sheetColumns)}),
    W:Object.freeze({idle:range('W',0,4,sheetColumns),walk:range('W',4,4,sheetColumns),attack:range('W',8,5,sheetColumns),cast:range('W',13,5,sheetColumns)})
  });
  const sharedBase = 4 * sheetColumns;
  return Object.freeze({
    archetypeId,
    textureKey:`champion-${slug}`,
    assetPath:`assets/champions/${slug}.png`,
    frameWidth:frameSpec.width,
    frameHeight:frameSpec.height,
    sheetColumns,
    // Rogue uses a smaller native body inside the same 80×96 cell, then renders slightly above 1×.
    // Warrior, Mage, Shinobi, and this refreshed Barbarian use fitted 80×96 bodies rendered at 1×.
    renderScale:rogueContract ? ROGUE_RENDER_SCALE : ((archetypeId === 'Warrior' || mageContract || archetypeId === 'Shinobi' || barbarianContract || monkContract || mysticContract) ? 1.0 : (largeHd ? LARGE_HD_RENDER_SCALE : (hd ? 1.0 : CHAMPION_RENDER_SCALE))),
    clips,
    hit:Object.freeze([sharedBase,sharedBase+1,sharedBase+2]),
    ko:Object.freeze([sharedBase+3,sharedBase+4,sharedBase+5,sharedBase+6,sharedBase+7]),
    resurrect:Object.freeze([sharedBase+8,sharedBase+9,sharedBase+10,sharedBase+11,sharedBase+12]),
    projectile:barbarianContract?Object.freeze([sharedBase+13,sharedBase+14,sharedBase+15,sharedBase+16]):Object.freeze([]),
    palmHit:monkContract?Object.freeze([sharedBase+13,sharedBase+14,sharedBase+15,sharedBase+16]):Object.freeze([]),
    timing:Object.freeze({
      idleFps:4, walkFps:9, attackFps:12, castFps:10, hitFps:12, koFps:9, resurrectFps:9,
      attackImpactFrame:3,
      castReleaseFrame:3
    })
  });
}

export const CHAMPION_ANIMATION_MANIFESTS = Object.freeze(Object.fromEntries(CHAMPION_ANIMATION_IDS.map(id=>[id,buildManifest(id)])));
export const WARRIOR_ANIMATION_MANIFEST = CHAMPION_ANIMATION_MANIFESTS.Warrior;

export function directionFromDelta(dx,dy,fallback='S'){
  if(!Number.isFinite(dx)||!Number.isFinite(dy)||(dx===0&&dy===0))return fallback;
  if(Math.abs(dx)>=Math.abs(dy))return dx>=0?'E':'W';
  return dy>=0?'S':'N';
}

export function directionFromCells(from,to,fallback='S'){
  if(!from||!to)return fallback;
  return directionFromDelta(Number(to.col)-Number(from.col),Number(to.row)-Number(from.row),fallback);
}

export function animationKey(archetypeId,clip,direction='S'){
  const suffix=['idle','walk','attack','cast'].includes(clip)?`-${direction}`:'';
  return `${String(archetypeId).toLowerCase()}-${clip}${suffix}`;
}

export function registerChampionAnimations(scene,archetypeId='Warrior'){
  const manifest=CHAMPION_ANIMATION_MANIFESTS[archetypeId];
  if(!scene?.anims||!manifest)return false;
  const create=(key,frames,frameRate,repeat=0)=>{
    if(scene.anims.exists(key))return;
    scene.anims.create({key,frames:frames.map(f=>({key:manifest.textureKey,frame:f})),frameRate,repeat});
  };
  for(const dir of CHAMPION_DIRECTIONS){
    create(animationKey(archetypeId,'idle',dir),manifest.clips[dir].idle,manifest.timing.idleFps,-1);
    create(animationKey(archetypeId,'walk',dir),manifest.clips[dir].walk,manifest.timing.walkFps,-1);
    create(animationKey(archetypeId,'attack',dir),manifest.clips[dir].attack,manifest.timing.attackFps,0);
    create(animationKey(archetypeId,'cast',dir),manifest.clips[dir].cast,manifest.timing.castFps,0);
  }
  create(animationKey(archetypeId,'hit'),manifest.hit,manifest.timing.hitFps,0);
  create(animationKey(archetypeId,'ko'),manifest.ko,manifest.timing.koFps,0);
  create(animationKey(archetypeId,'resurrect'),manifest.resurrect,manifest.timing.resurrectFps,0);
  if(manifest.palmHit?.length)create(animationKey(archetypeId,'palm-hit'),manifest.palmHit,manifest.timing.attackFps,0);
  return true;
}
