const DEFAULT_TABLE='ros2_ranked_ladder';
const DEFAULT_ROW_ID='main';

function cleanIdentifier(value,fallback){
  const text=String(value??fallback).trim();
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(text))throw new Error('INVALID_LADDER_STORE_IDENTIFIER');
  return text;
}

class SupabaseLadderStore{
  constructor({url,key,table=DEFAULT_TABLE,rowId=DEFAULT_ROW_ID,fetchImpl=globalThis.fetch}={}){
    this.url=String(url??'').trim().replace(/\/+$/,'');
    this.key=String(key??'').trim();
    this.table=cleanIdentifier(table,DEFAULT_TABLE);
    this.rowId=String(rowId??DEFAULT_ROW_ID).trim()||DEFAULT_ROW_ID;
    this.fetchImpl=fetchImpl;
    if(!this.url||!/^https?:\/\//i.test(this.url))throw new Error('INVALID_SUPABASE_URL');
    if(!this.key)throw new Error('SUPABASE_SERVICE_ROLE_KEY_REQUIRED');
    if(typeof this.fetchImpl!=='function')throw new Error('FETCH_NOT_AVAILABLE');
  }
  headers(extra={}){return {apikey:this.key,authorization:`Bearer ${this.key}`,...extra};}
  endpoint(query=''){return `${this.url}/rest/v1/${this.table}${query}`;}
  async load(){
    const query=`?id=eq.${encodeURIComponent(this.rowId)}&select=state&limit=1`;
    const res=await this.fetchImpl(this.endpoint(query),{method:'GET',headers:this.headers({accept:'application/json'})});
    if(!res.ok)throw new Error(`SUPABASE_LOAD_${res.status}: ${await res.text()}`.slice(0,500));
    const rows=await res.json();
    return Array.isArray(rows)&&rows[0]?.state&&typeof rows[0].state==='object'?rows[0].state:null;
  }
  async save(state){
    const body=JSON.stringify([{id:this.rowId,state,updated_at:new Date().toISOString()}]);
    const res=await this.fetchImpl(this.endpoint('?on_conflict=id'),{method:'POST',headers:this.headers({'content-type':'application/json',accept:'application/json',prefer:'resolution=merge-duplicates,return=minimal'}),body});
    if(!res.ok)throw new Error(`SUPABASE_SAVE_${res.status}: ${await res.text()}`.slice(0,500));
    return true;
  }
}

function createSupabaseStoreFromEnv(env=process.env,{fetchImpl=globalThis.fetch}={}){
  const url=String(env.SUPABASE_URL??'').trim(),key=String(env.SUPABASE_SERVICE_ROLE_KEY??'').trim();
  if(!url&&!key)return null;
  if(!url||!key)throw new Error('SUPABASE_LADDER_CONFIG_INCOMPLETE');
  return new SupabaseLadderStore({url,key,table:env.ROS2_LADDER_SUPABASE_TABLE||DEFAULT_TABLE,rowId:env.ROS2_LADDER_SUPABASE_ROW||DEFAULT_ROW_ID,fetchImpl});
}

module.exports={SupabaseLadderStore,createSupabaseStoreFromEnv,DEFAULT_TABLE,DEFAULT_ROW_ID};
