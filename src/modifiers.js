import { findStatus } from './status.js';
export function statusStacks(unit,key){const s=findStatus(unit,key);return Math.max(0,Math.trunc(s?.data?.stacks??(s?1:0)));}
export function effectiveStat(unit,key){
 let v=unit.stats[key];
 if(key==='ATK')v*=Math.pow(1.5,Math.min(5,statusStacks(unit,'atk_up')))*Math.pow(.75,Math.min(5,statusStacks(unit,'atk_down')));
 if(key==='SDM')v*=Math.pow(1.5,Math.min(5,statusStacks(unit,'sdm_up')))*Math.pow(.75,Math.min(5,statusStacks(unit,'sdm_down')));
 if(key==='DEF'){
   v*=Math.pow(1.33,Math.min(5,statusStacks(unit,'def_up')))*Math.pow(.75,Math.min(5,statusStacks(unit,'def_down')));
   const rend=findStatus(unit,'rend_def_down');
   if(rend){const stacks=Math.min(5,Math.max(0,Math.trunc(rend.data?.stacks??1)));const pct=Math.max(0,Math.min(.95,Number(rend.data?.pctPerStack??.10)));v*=Math.pow(1-pct,stacks);}
 }
 if(key==='RES')v*=Math.pow(1.33,Math.min(5,statusStacks(unit,'res_up')))*Math.pow(.75,Math.min(5,statusStacks(unit,'res_down')));
 return v;
}
export function incomingDamageMultiplier(unit,damageType){
 let m=1;
 if(findStatus(unit,'marked'))m*=1.85;
 const divine=findStatus(unit,'divine_shield');if(divine)m*=Math.max(0,1-(divine.data?.pct??.60));
 const guard=findStatus(unit,'guard');if(guard)m*=Math.max(0,1-(guard.data?.pct??.2));
 const magic=findStatus(unit,'magic_shield');if(magic&&damageType==='MAGICAL')m*=Math.max(0,1-(magic.data?.pct??.5));
 const phys=findStatus(unit,'physical_shield');if(phys&&damageType==='PHYSICAL')m*=Math.max(0,1-(phys.data?.pct??.5));
 const bloodlust=findStatus(unit,'bloodlust');if(bloodlust)m*=Math.max(0,Number(bloodlust.data?.incomingDamageMultiplier??1.25));
 return m;
}
