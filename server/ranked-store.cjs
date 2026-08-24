const DEFAULT_TABLE='ros2_ranked_ladder';
const DEFAULT_ROW_ID='main';

function cleanIdentifier(value,fallback){
  const text=String(value??fallback).trim();
  if(!/^[A-Za-z_][A-Za-z0-9_]*$/.test(text))throw new Error('INVALID_LADDER_STORE_IDENTIFIER');
  return text;
}
function isOpaqueSupabaseKey(key){return /^sb_(?:secret|publishable)_/i.test(String(key??''));}
function stateSignature(state){
  const s=state&&typeof state==='object'?state:{};
  return {
    version:Number(s.version)||0,
    revision:Number(s.persistenceRevision)||0,
    updatedAt:s.updatedAt??null,
    matches:Object.keys(s.recordedMatches&&typeof s.recordedMatches==='object'?s.recordedMatches:{}).length,
    players:Object.keys(s.players&&typeof s.players==='object'?s.players:{}).length,
    champions:Object.keys(s.champions&&typeof s.champions==='object'?s.champions:{}).length
  };
}
function signaturesEqual(a,b){return JSON.stringify(stateSignature(a))===JSON.stringify(stateSignature(b));}

class SupabaseLadderStore{
  constructor({url,key,table=DEFAULT_TABLE,rowId=DEFAULT_ROW_ID,fetchImpl=globalThis.fetch}={}){
    this.url=String(url??'').trim().replace(/\/+$/,'');
    this.key=String(key??'').trim();
    this.table=cleanIdentifier(table,DEFAULT_TABLE);
    this.rowId=String(rowId??DEFAULT_ROW_ID).trim()||DEFAULT_ROW_ID;
    this.fetchImpl=fetchImpl;
    if(!this.url||!/^https?:\/\//i.test(this.url))throw new Error('INVALID_SUPABASE_URL');
    if(!this.key)throw new Error('SUPABASE_SECRET_KEY_REQUIRED');
    if(typeof this.fetchImpl!=='function')throw new Error('FETCH_NOT_AVAILABLE');
  }
  headers(extra={}){
    // New sb_secret_* keys are opaque API keys, not JWTs. Supabase's Data API
    // expects them in the apikey header and the gateway derives service_role.
    // Legacy service_role JWTs still use both apikey + Authorization Bearer.
    const headers={apikey:this.key,...extra};
    if(!isOpaqueSupabaseKey(this.key))headers.authorization=`Bearer ${this.key}`;
    return headers;
  }
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
  async saveAndVerify(state){
    await this.save(state);
    const remote=await this.load();
    if(!remote)throw new Error('SUPABASE_VERIFY_ROW_MISSING');
    if(!signaturesEqual(state,remote))throw new Error(`SUPABASE_VERIFY_MISMATCH local=${JSON.stringify(stateSignature(state))} remote=${JSON.stringify(stateSignature(remote))}`.slice(0,500));
    return remote;
  }
}

function createSupabaseStoreFromEnv(env=process.env,{fetchImpl=globalThis.fetch}={}){
  const url=String(env.SUPABASE_URL??'').trim();
  // Accept the current Supabase naming as well as the legacy variable we
  // documented in Stage25S. Either may hold an sb_secret_* or service_role JWT.
  const key=String(env.SUPABASE_SECRET_KEY??env.SUPABASE_SERVICE_ROLE_KEY??'').trim();
  const anyConfigured=Boolean(url||key||env.SUPABASE_SECRET_KEY||env.SUPABASE_SERVICE_ROLE_KEY);
  if(!anyConfigured)return null;
  if(!url||!key)throw new Error('SUPABASE_LADDER_CONFIG_INCOMPLETE');
  return new SupabaseLadderStore({url,key,table:env.ROS2_LADDER_SUPABASE_TABLE||DEFAULT_TABLE,rowId:env.ROS2_LADDER_SUPABASE_ROW||DEFAULT_ROW_ID,fetchImpl});
}

module.exports={SupabaseLadderStore,createSupabaseStoreFromEnv,DEFAULT_TABLE,DEFAULT_ROW_ID,isOpaqueSupabaseKey,stateSignature,signaturesEqual};
