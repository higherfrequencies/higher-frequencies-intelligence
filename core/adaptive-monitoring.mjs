/** Persistent, conservative source-item significance decisions.
 * A monitoring classification is advisory; it never approves Education or Management.
 * Uses the existing source and report IDs, no second evidence store.
 */
import {createHash,randomUUID} from 'node:crypto';
const digest=x=>createHash('sha256').update(JSON.stringify(x)).digest('hex');
const DAY=86400000;
const relevantFields=['title','type','category','startDate','endDate','location','region','organiser','publisher'];
const materialFields=new Set(['title','type','startDate','endDate','location','region','organiser']);
const asJson=x=>{try{return JSON.parse(x)}catch{return {}}};
// Comparisons are limited to explicitly supplied, source-attributed factual claims.
// A match is only a Research candidate, never proof of independent corroboration.
const normalise=x=>String(x??'').trim().toLowerCase().replace(/\s+/g,' ');
const claimsOf=record=>Array.isArray(record.claims)?record.claims.filter(x=>x&&typeof x==='object'&&typeof x.key==='string'&&x.key.trim()&&['string','number','boolean'].includes(typeof x.value)).slice(0,30).map(x=>({key:normalise(x.key),value:normalise(x.value)})):[];

export class AdaptiveMonitoring{
 constructor(store,identity,{clock=()=>Date.now()}={}){this.store=store;this.identity=identity;this.clock=clock;store.db.exec(`
 CREATE TABLE IF NOT EXISTS hf_monitor_items(tenant TEXT NOT NULL,provider TEXT NOT NULL,external_key TEXT NOT NULL,source_id TEXT,report_id TEXT,source_hash TEXT NOT NULL,semantic_hash TEXT NOT NULL,last_record_json TEXT NOT NULL,checked_at INTEGER NOT NULL,next_at INTEGER NOT NULL,reason TEXT NOT NULL,state TEXT NOT NULL,minor_count INTEGER NOT NULL DEFAULT 0,failures INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL,PRIMARY KEY(tenant,provider,external_key));
 CREATE TABLE IF NOT EXISTS hf_monitor_checks(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,provider TEXT NOT NULL,external_key TEXT NOT NULL,source_hash TEXT NOT NULL,state TEXT NOT NULL,reason TEXT NOT NULL,changed_fields TEXT NOT NULL,downstream INTEGER NOT NULL,next_at INTEGER NOT NULL,checked_at INTEGER NOT NULL);
 CREATE INDEX IF NOT EXISTS hf_monitor_checks_recent ON hf_monitor_checks(tenant,checked_at);
 CREATE TABLE IF NOT EXISTS hf_monitor_claim_reviews(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,provider TEXT NOT NULL,external_key TEXT NOT NULL,related_provider TEXT NOT NULL,related_key TEXT NOT NULL,claim_key TEXT NOT NULL,relationship TEXT NOT NULL,checked_at INTEGER NOT NULL,source_hash TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS hf_claim_reviews_recent ON hf_monitor_claim_reviews(tenant,checked_at);
 
 `)}
 require(user){this.identity.require(user,['super_user'],user?.tenant);return user.tenant}
 /** The raw source hash can change due to editorial text. Semantic fields determine whether existing assessments must be invalidated. */
 observe(user,{provider,externalKey,record,sourceHash,sourceId=null,reportId=null,activeObjective=false,contradiction=false,deadlineAt=null}={}){
  const tenant=this.require(user);if(!/^[a-z][a-z0-9_]{1,30}$/.test(provider||'')||typeof externalKey!=='string'||!externalKey.trim()||externalKey.length>600||!record||typeof record!=='object'||Array.isArray(record))throw Error('Invalid monitored evidence');
  if(typeof sourceHash!=='string'||sourceHash.length<8)throw Error('Source hash required');
  const at=this.clock(),before=this.store.db.prepare('SELECT * FROM hf_monitor_items WHERE tenant=? AND provider=? AND external_key=?').get(tenant,provider,externalKey);
  const old=before?asJson(before.last_record_json):{},fields=before?[...new Set([...Object.keys(old),...Object.keys(record)])].filter(k=>JSON.stringify(old[k]??null)!==JSON.stringify(record[k]??null)):Object.keys(record);
  const significantFields=fields.filter(x=>materialFields.has(x));const semanticHash=digest(relevantFields.map(k=>[k,record[k]??null]));
  let state,reason,downstream=false,minorCount=before?.minor_count||0;
  if(!before){state='new_evidence';reason='First observation requires evidence review';downstream=true;minorCount=0}
  else if(before.source_hash===sourceHash){state='unchanged';reason='Exact evidence hash previously examined; no new intelligence';}
  else if(contradiction){state='contradictory_evidence';reason='A claimed contradiction requires Research and Management review';downstream=true;minorCount=0}
  else if(significantFields.length||activeObjective&&before.semantic_hash!==semanticHash){state='material_change';reason='Decision-relevant fields changed: '+(significantFields.join(', ')||'active objective input');downstream=true;minorCount=0}
  else if(before.semantic_hash!==semanticHash){state='minor_change';reason='Editorial or classification change without material decision fields';minorCount++}
  else{state='minor_change';reason='Source wording or metadata changed, analytical fields unchanged';minorCount++}
  // Evaluate attributable cross-source factual claims without treating publisher repetition as corroboration.
  // Explicit sourceOrganisation and originUrl are necessary before considering an independent-source candidate.
  const currentOrganisation=normalise(record.sourceOrganisation||record.publisher);
  const currentOrigin=normalise(record.originUrl||record.url);
  const claimPairs=claimsOf(record),peerComparisons=[];
  if(currentOrganisation&&currentOrigin&&claimPairs.length){
   const candidates=this.store.db.prepare('SELECT provider,external_key,last_record_json FROM hf_monitor_items WHERE tenant=? AND NOT (provider=? AND external_key=?)').all(tenant,provider,externalKey);
   for(const candidate of candidates){
    const prior=asJson(candidate.last_record_json),priorOrganisation=normalise(prior.sourceOrganisation||prior.publisher),priorOrigin=normalise(prior.originUrl||prior.url);
    if(!priorOrganisation||!priorOrigin||priorOrganisation===currentOrganisation||priorOrigin===currentOrigin)continue;
    const theirClaims=claimsOf(prior);
    for(const claim of claimPairs){for(const peer of theirClaims.filter(p=>p.key===claim.key)){
     peerComparisons.push({key:claim.key,relationship:peer.value===claim.value?'independent_source_agreement_candidate':'conflicting_claim_candidate',sourceProvider:candidate.provider,sourceExternalKey:candidate.external_key});
    }}
   }
  }
  if(peerComparisons.some(x=>x.relationship==='conflicting_claim_candidate') && state!=='unchanged' && state!=='contradictory_evidence'){
   state='contradictory_evidence';reason='Differing source-attributed factual claims require Research review; source reliability and claim validity are not established';downstream=true;minorCount=0;
  }else if(peerComparisons.some(x=>x.relationship==='independent_source_agreement_candidate')&&state==='minor_change'){
   state='corroboration_review';reason='Matching claims from separately attributed publishers require Research corroboration review; agreement is not proof';downstream=true;minorCount=0;
  }
  // Editorial revisions from one publisher are not independent corroboration, even after many revisions.
  // Only distinct attributable sources with matching factual subjects can raise a corroboration *candidate*.
  if(state==='minor_change'&&minorCount>=3)reason='Repeated changes from one source retained for review; revision count alone is not significance';
  const subject=String(record.title||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim();
  const peers=subject?this.store.db.prepare('SELECT provider,external_key,last_record_json FROM hf_monitor_items WHERE tenant=? AND NOT (provider=? AND external_key=?)').all(tenant,provider,externalKey).filter(x=>{const other=asJson(x.last_record_json);return String(other.title||'').toLowerCase().replace(/[^a-z0-9 ]/g,' ').replace(/\s+/g,' ').trim()===subject && String(other.publisher||'').toLowerCase()!==String(record.publisher||'').toLowerCase() && x.provider!==provider}):[];
  // This remains a research review candidate; a second source does not make the claim true.
  if(state==='minor_change'&&peers.length&&fields.some(x=>['description','category'].includes(x))){state='corroboration_review';reason='Independent publisher candidate for matching subject; corroboration and claim accuracy require Research review';downstream=true;minorCount=0}
  // A near-term event can become time-sensitive even if the source hash remains unchanged.
  const eventAt=Date.parse(String(record.startDate||'')+'T00:00:00Z');
  if(before&&state==='unchanged'&&Number.isFinite(eventAt)&&eventAt>at&&eventAt-at<=3*DAY&&before.next_at<=at){state='time_sensitive';reason='Existing event is within three days; reassess timing without claiming new evidence';downstream=true}
  const deadline=Number(deadlineAt);const urgent=Number.isFinite(deadline)&&deadline>at&&deadline<at+14*DAY;
  const interval=state==='retrieval_failure'?DAY:urgent?DAY:downstream?3*DAY:state==='unchanged'?7*DAY:2*DAY;
  const nextAt=at+interval,updated=new Date(at).toISOString();
  this.store.transaction(()=>{
   this.store.db.prepare(`INSERT INTO hf_monitor_items(tenant,provider,external_key,source_id,report_id,source_hash,semantic_hash,last_record_json,checked_at,next_at,reason,state,minor_count,failures,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant,provider,external_key) DO UPDATE SET source_id=COALESCE(excluded.source_id,hf_monitor_items.source_id),report_id=COALESCE(excluded.report_id,hf_monitor_items.report_id),source_hash=excluded.source_hash,semantic_hash=excluded.semantic_hash,last_record_json=excluded.last_record_json,checked_at=excluded.checked_at,next_at=excluded.next_at,reason=excluded.reason,state=excluded.state,minor_count=excluded.minor_count,failures=0,updated_at=excluded.updated_at`).run(tenant,provider,externalKey,sourceId,reportId,sourceHash,semanticHash,JSON.stringify(record),at,nextAt,reason,state,minorCount,0,updated);
   this.store.db.prepare('INSERT INTO hf_monitor_checks VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),tenant,provider,externalKey,sourceHash,state,reason,JSON.stringify(fields),downstream?1:0,nextAt,at);
   if(state!=='unchanged')for(const candidate of peerComparisons){
    this.store.db.prepare('INSERT INTO hf_monitor_claim_reviews VALUES(?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),tenant,provider,externalKey,candidate.sourceProvider,candidate.sourceExternalKey,candidate.key,candidate.relationship,at,sourceHash);
   }
  });return {provider,externalKey,state,reason,changedFields:fields,claimComparisons:peerComparisons,process:downstream,nextAt,sourceId,reportId};
 }
 failed(user,{provider,externalKey,error}={}){const t=this.require(user),at=this.clock();const row=this.store.db.prepare('SELECT * FROM hf_monitor_items WHERE tenant=? AND provider=? AND external_key=?').get(t,provider,externalKey);if(!row)throw Error('Monitored item not found');const failures=row.failures+1,nextAt=at+Math.min(7*DAY,DAY*2**Math.min(failures-1,3)),reason=String(error||'Retrieval unavailable').slice(0,180);this.store.db.prepare("UPDATE hf_monitor_items SET failures=?,checked_at=?,next_at=?,state='retrieval_failure',reason=?,updated_at=? WHERE tenant=? AND provider=? AND external_key=?").run(failures,at,nextAt,reason,new Date(at).toISOString(),t,provider,externalKey);this.store.db.prepare('INSERT INTO hf_monitor_checks VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),t,provider,externalKey,row.source_hash,'retrieval_failure',reason,'[]',0,nextAt,at);return {state:'retrieval_failure',process:false,nextAt,reason};}
 /** Claim item reassessment before network I/O. Claims are restart-safe and bounded by a lease. */
 claimDue(user,{limit=8,leaseMs=15*60000}={}){
  const tenant=this.require(user),at=this.clock(),cap=Math.min(20,Math.max(1,Math.trunc(Number(limit)||8)));
  return this.store.transaction(()=>{
   const items=this.store.db.prepare('SELECT * FROM hf_monitor_items WHERE tenant=? AND next_at<=? ORDER BY next_at LIMIT ?').all(tenant,at,cap);
   for(const x of items){this.store.db.prepare('UPDATE hf_monitor_items SET next_at=?,reason=?,updated_at=? WHERE tenant=? AND provider=? AND external_key=? AND next_at<=?').run(at+leaseMs,'Scheduled reassessment claimed; awaiting source check',new Date(at).toISOString(),tenant,x.provider,x.external_key,at)}
   return items.map(x=>({provider:x.provider,externalKey:x.external_key,sourceHash:x.source_hash,record:asJson(x.last_record_json),lastCheckedAt:x.checked_at,previousState:x.state}));
  });
 }
 /** Evaluate the cached item if live provider retrieval is unavailable; clearly label it as cached. */
 inspectCached(user,item,{reason='No fresh provider retrieval available'}={}){
  const tenant=this.require(user);const at=this.clock();const existing=this.store.db.prepare('SELECT * FROM hf_monitor_items WHERE tenant=? AND provider=? AND external_key=?').get(tenant,item.provider,item.externalKey);if(!existing)throw Error('Monitored item not found');
  const record=asJson(existing.last_record_json),date=Date.parse(String(record.startDate||'')+'T00:00:00Z');
  const urgent=Number.isFinite(date)&&date>at&&date-at<=3*DAY;
  const state=urgent?'time_sensitive':'unchanged',explanation=urgent?'Cached event within three days: Super User review suggested; no new source evidence or automated approval':'Cached evidence rechecked: '+reason+'; no novel facts';
  const nextAt=at+(urgent?DAY:7*DAY),process=false; // cached observations cannot create new source evidence or bypass reviewed handoffs
  this.store.transaction(()=>{
   this.store.db.prepare('UPDATE hf_monitor_items SET checked_at=?,next_at=?,reason=?,state=?,updated_at=? WHERE tenant=? AND provider=? AND external_key=?').run(at,nextAt,explanation,state,new Date(at).toISOString(),tenant,item.provider,item.externalKey);
   this.store.db.prepare('INSERT INTO hf_monitor_checks VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),tenant,item.provider,item.externalKey,existing.source_hash,state,explanation,'[]',process?1:0,nextAt,at);
  });
  return {provider:item.provider,externalKey:item.externalKey,state,reason:explanation,process,source:'cached_only',nextAt};
 }
 list(user,{limit=100,dueOnly=false}={}){const tenant=this.require(user);const cap=Math.min(200,Math.max(1,Number(limit)||100));const rows=this.store.db.prepare(`SELECT provider,external_key externalKey,source_id sourceId,report_id reportId,state,reason,checked_at checkedAt,next_at nextAt,minor_count minorCount,failures FROM hf_monitor_items WHERE tenant=? ${dueOnly?'AND next_at<=?':''} ORDER BY next_at LIMIT ?`).all(...(dueOnly?[tenant,this.clock(),cap]:[tenant,cap]));return rows}
 claimReviews(user,{limit=50}={}){const tenant=this.require(user),cap=Math.min(200,Math.max(1,Math.trunc(Number(limit)||50)));return this.store.db.prepare('SELECT provider,external_key externalKey,related_provider relatedProvider,related_key relatedKey,claim_key claimKey,relationship,checked_at checkedAt,source_hash sourceHash FROM hf_monitor_claim_reviews WHERE tenant=? ORDER BY checked_at DESC,id DESC LIMIT ?').all(tenant,cap)}
 summary(user){const tenant=this.require(user);const statuses=this.store.db.prepare('SELECT state,COUNT(*) n FROM hf_monitor_items WHERE tenant=? GROUP BY state').all(tenant);const stats=Object.fromEntries(statuses.map(x=>[x.state,x.n]));return {monitored:statuses.reduce((n,x)=>n+x.n,0),states:stats,due:this.store.db.prepare('SELECT COUNT(*) n FROM hf_monitor_items WHERE tenant=? AND next_at<=?').get(tenant,this.clock()).n,lastChecks:this.store.db.prepare('SELECT provider,external_key externalKey,state,reason,downstream,next_at nextAt,checked_at checkedAt FROM hf_monitor_checks WHERE tenant=? ORDER BY checked_at DESC LIMIT 20').all(tenant).map(x=>({...x,downstream:!!x.downstream})),scope:'persistent monitoring decisions, not live-source success or Education approval'};}
}
