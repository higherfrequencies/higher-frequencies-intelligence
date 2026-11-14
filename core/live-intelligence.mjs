import {createHash,randomUUID} from 'node:crypto';
import {parseOfficialRss} from './official-rss.mjs';

const VERIFIED_OFFICIAL_REQUEST=Symbol('verified official API request');
const providers={
 christchurchnz:{name:'ChristchurchNZ events',mode:'attributable_manual_import',dependency:'No authorised public event feed confirmed; manual entry/export with source URL only',url:'https://www.christchurchnz.com/visit/whats-on'},
 eventfinda:{name:'Eventfinda',mode:'authorised_import',dependency:'Developer API credentials and permitted usage needed; no page scraping',url:'https://www.eventfinda.co.nz/api/v2/category'},
 eventbrite:{name:'Eventbrite',mode:'authorised_import',dependency:'OAuth token and endpoint/permission scope validation required',url:'https://www.eventbrite.com.au/platform/docs/authentication'},
 ticketmaster:{name:'Ticketmaster Discovery API',mode:'credentialled_live',dependency:'HF_TICKETMASTER_API_KEY and API terms, rate limits',url:'https://developer.ticketmaster.com/products-and-docs/apis/discovery-api/v2/'},
 nzbn:{name:'NZBN / Companies Register',mode:'authorised_import',dependency:'NZBN subscription key or approved bulk export required',url:'https://portal.api.business.govt.nz/api/nzbn'},
 places:{name:'Google Places',mode:'authorised_import',dependency:'Restricted server API key, enabled Places API, billing, applicable data retention terms',url:'https://developers.google.com/maps/documentation/places/web-service/get-api-key'},
 statsnz:{name:'Stats NZ',mode:'authorised_import',dependency:'Subscription key or lawful manually exported ADE dataset',url:'https://portal.apis.stats.govt.nz/'},
 council:{name:'Christchurch City Council',mode:'authorised_import',dependency:'Specific open-data dataset permissions/licence or attributable manual import',url:'https://opendata-christchurchcity.hub.arcgis.com/'},
 official:{name:'Official organisation websites / permitted directories',mode:'attributable_manual_import',dependency:'Site-specific permission or licensed feed; no generic crawling',url:null},
 beehive:{name:'Beehive official government RSS',mode:'open_rss',dependency:'Official https://www.beehive.govt.nz/rss.xml feed; local DNS and outbound HTTPS required; retain headline/link only',url:'https://www.beehive.govt.nz/feeds'},
 datagovt:{name:'data.govt.nz CKAN catalogue',mode:'open_api',dependency:'Internet connection and dataset-specific licence',url:'https://www.data.govt.nz/catalogue-guide/using-data-govt-nz-apis/dos-and-donts-of-using-the-data-govt-nz-api'}
};
const networkDiagnostic=error=>{if(/^(Beehive RSS|Catalogue API|Ticketmaster API) returned [45][0-9]{2}$/.test(String(error?.message||'')))return String(error.message);const code=String(error?.cause?.code||error?.code||'').slice(0,32);const label=({ENOTFOUND:'DNS name resolution failed',EAI_AGAIN:'DNS temporarily unavailable',ECONNREFUSED:'Connection refused',ETIMEDOUT:'Connection timed out',CERT_HAS_EXPIRED:'Remote TLS certificate expired',UNABLE_TO_VERIFY_LEAF_SIGNATURE:'TLS chain verification failed'})[code];return label?`${label} (${code})`:error?.name==='AbortError'?'Request timed out':'External request failed (check DNS, TLS, proxy and connectivity)'};
// Bound response bytes before allocating the full payload. Small official metadata feeds only.
async function readBounded(response,maxBytes=900000){
 const announced=Number(response.headers?.get?.('content-length')||0);if(announced>maxBytes)throw Error('Provider response too large');
 if(response.body?.getReader){const reader=response.body.getReader();const chunks=[];let bytes=0;try{for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.byteLength;if(bytes>maxBytes)throw Error('Provider response too large');chunks.push(value)}}finally{reader.releaseLock?.()}
 return new TextDecoder('utf-8',{fatal:true}).decode(Buffer.concat(chunks.map(b=>Buffer.from(b))))}
 const raw=await response.text();if(Buffer.byteLength(raw,'utf8')>maxBytes)throw Error('Provider response too large');return raw;
}
const hash=v=>createHash('sha256').update(typeof v==='string'?v:JSON.stringify(v)).digest('hex');
const clean=(v,max=250)=>typeof v==='string'?v.trim().slice(0,max):'';
const defaultProfile={zones:['Christchurch','Canterbury'],radiusKm:null,categories:['events','hospitality','retail','sports','business','creative'],eventTypes:['festival','trade_show','market','sports','business','cultural','market_dataset'],organisationTypes:[],frequency:'manual',sources:{christchurchnz:true,datagovt:true,beehive:true},minEvidence:'attributed'};
const qualityOrder={attributed:0,corroborated:1};
const validUrl=url=>{try{const u=new URL(url);return u.protocol==='https:'&&!!u.hostname&&!u.username&&!u.password}catch{return false}};
function assess(record){
 const hay=[record.title,record.type,record.category,record.description].join(' ').toLowerCase();
 const services=[];const reasons=[];
 if(/event|festival|sport|championship|show|concert|cricket|rugby|race|market|trade|exhibition|celebration|basketball|food|music|motorsport|match/.test(hay)||record.type==='event'){services.push('Commercial / brand photography');reasons.push('Public-facing activity may need event, sponsor or promotional photography')}
 if(/festival|championship|sport|show|concert|race|event|market|creative|tourism|match/.test(hay)||record.type==='event'){services.push('Business promotional video');reasons.push('Event promotion or recap video could suit the public programme')}
 if(/annual|series|season|repeat|market|festival|championship|weekly|ongoing|business/.test(hay)){services.push('Recurring business content');reasons.push('Recurring programme may justify a content schedule; recurrence not necessarily proven')}
 if(record.type==='government_release'){services.length=0;reasons.length=0;reasons.push('Government announcement metadata only; inspect the linked release before assessing economic or commercial significance')}
 if(record.type==='market_dataset'){reasons.push('Catalogue metadata is a market research signal, not an event or customer lead')}
 const start=record.startDate?new Date(record.startDate+'T00:00:00+13:00'):null;
 const days=start&&Number.isFinite(start.getTime())?Math.round((start.getTime()-Date.now())/86400000):null;
 const priority=['market_dataset','government_release'].includes(record.type)?'C':(!services.length?'C':(days!==null&&days>=7&&days<=90&&record.organiser?'A':'B'));
 const gaps=[];if(!record.organiser)gaps.push('Confirm event organiser or contracting entity');if(!record.organiserWebsite)gaps.push('Find the organiser’s official website and authorised enquiry channel');gaps.push('Establish whether content production is already commissioned, budgeted or tendered');if(!record.startDate&&record.type!=='market_dataset')gaps.push('Verify event date');
 return {services,reasons,priority,gaps,confidence:record.quality==='corroborated'?'medium':'low',customerInterestVerified:false,buyingIntent:'not_verified',departments:['research','marketing','management','reporting'],managementStatus:'pending_review',scoreBasis:'deterministic service-fit and lead-time heuristic, not purchase intent',daysUntilStart:days};
}
export class LiveIntelligence {
 constructor(store,identity,{fetchImpl=globalThis.fetch}={}){this.store=store;this.identity=identity;this.fetchImpl=fetchImpl;store.db.exec(`
 CREATE TABLE IF NOT EXISTS hf_discovery_profiles(tenant TEXT PRIMARY KEY,profile_json TEXT NOT NULL,updated_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS hf_discovery_runs(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,provider TEXT NOT NULL,method TEXT NOT NULL,status TEXT NOT NULL,started_at TEXT NOT NULL,completed_at TEXT,counts TEXT NOT NULL,error TEXT);
 CREATE TABLE IF NOT EXISTS hf_discovery_sources(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,provider TEXT NOT NULL,external_key TEXT NOT NULL,url TEXT NOT NULL,retrieved_at TEXT NOT NULL,method TEXT NOT NULL,content_hash TEXT NOT NULL,source_json TEXT NOT NULL,UNIQUE(tenant,provider,external_key));
 CREATE TABLE IF NOT EXISTS hf_discovery_run_evidence(run_id TEXT NOT NULL,tenant TEXT NOT NULL,source_id TEXT NOT NULL,content_hash TEXT NOT NULL,change_kind TEXT NOT NULL,PRIMARY KEY(run_id,tenant,source_id,content_hash));
 CREATE TABLE IF NOT EXISTS hf_discovery_source_history(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,source_id TEXT NOT NULL,provider TEXT NOT NULL,external_key TEXT NOT NULL,url TEXT NOT NULL,retrieved_at TEXT NOT NULL,method TEXT NOT NULL,content_hash TEXT NOT NULL,source_json TEXT NOT NULL,archived_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS hf_discovery_source_history_scope ON hf_discovery_source_history(tenant,source_id,archived_at);
 CREATE TABLE IF NOT EXISTS hf_discovery_reports(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,source_id TEXT NOT NULL,subject TEXT NOT NULL,location TEXT,priority TEXT NOT NULL,review_status TEXT NOT NULL,report_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,FOREIGN KEY(source_id) REFERENCES hf_discovery_sources(id));
 CREATE UNIQUE INDEX IF NOT EXISTS hf_discovery_unique_report ON hf_discovery_reports(tenant,source_id);
 CREATE TABLE IF NOT EXISTS hf_discovery_report_history(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,report_id TEXT NOT NULL,report_json TEXT NOT NULL,review_status TEXT NOT NULL,archived_at TEXT NOT NULL,reason TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS hf_discovery_history_scope ON hf_discovery_report_history(tenant,report_id,archived_at);
 CREATE TABLE IF NOT EXISTS hf_discovery_notifications(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,report_id TEXT NOT NULL,state TEXT NOT NULL,priority TEXT NOT NULL,created_at TEXT NOT NULL,FOREIGN KEY(report_id) REFERENCES hf_discovery_reports(id));
 CREATE INDEX IF NOT EXISTS hf_discovery_inbox_idx ON hf_discovery_notifications(tenant,state,created_at);`)}
 require(user){this.identity.require(user,['super_user'],user?.tenant);return user.tenant}
 profile(user){const tenant=this.require(user);const row=this.store.db.prepare('SELECT profile_json FROM hf_discovery_profiles WHERE tenant=?').get(tenant);return row?JSON.parse(row.profile_json):structuredClone(defaultProfile)}
 configure(user,input){const tenant=this.require(user),before=this.profile(user);if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid discovery configuration');const p={...before,...input};
  if(!Array.isArray(p.zones)||p.zones.length>20||p.zones.some(x=>typeof x!=='string'||x.length>80)||p.zones.length===0)throw Error('Invalid geographic zones');
  if(p.radiusKm!==null&&(!Number.isFinite(p.radiusKm)||p.radiusKm<=0||p.radiusKm>300))throw Error('Invalid radius');
  for(const k of ['categories','eventTypes','organisationTypes'])if(!Array.isArray(p[k])||p[k].length>25||p[k].some(x=>typeof x!=='string'||x.length>90))throw Error('Invalid discovery filters');
  if(!['manual','daily','weekly'].includes(p.frequency)||!(p.minEvidence in qualityOrder)||!p.sources||Array.isArray(p.sources)||Object.keys(p.sources).some(k=>!providers[k]||typeof p.sources[k]!=='boolean'))throw Error('Invalid discovery settings');
  this.store.db.prepare('INSERT INTO hf_discovery_profiles VALUES(?,?,?) ON CONFLICT(tenant) DO UPDATE SET profile_json=excluded.profile_json,updated_at=excluded.updated_at').run(tenant,JSON.stringify(p),new Date().toISOString());this.identity.audit(user.id,'discovery.profile.update',{tenant});return p;
 }
 catalogue(user){const t=this.require(user),profile=this.profile(user);return Object.entries(providers).map(([id,p])=>{
  const completed=this.store.db.prepare("SELECT completed_at,counts FROM hf_discovery_runs WHERE tenant=? AND provider=? AND method='official_api' AND status='completed' ORDER BY completed_at DESC LIMIT 1").get(t,id);
  const failed=this.store.db.prepare("SELECT completed_at,error FROM hf_discovery_runs WHERE tenant=? AND provider=? AND method='official_api' AND status='failed' ORDER BY completed_at DESC LIMIT 1").get(t,id);
  const counts=completed?JSON.parse(completed.counts):null;
  const operationalVerified=!!completed&&Number(counts?.received)>0;
  return {id,...p,enabled:profile.sources[id]===true,credentialConfigured:id==='ticketmaster'?!!process.env.HF_TICKETMASTER_API_KEY:false,
    operationalVerified,lastSuccessfulRetrieval:operationalVerified?completed.completed_at:null,lastFailedRetrieval:failed?.completed_at||null,lastFailure:failed?.error||null,
    status:operationalVerified?'previous_real_application_request_processed':failed?'failed_last_attempt':'not_verified_live',
    frequencyConfigured:profile.frequency,retentionPolicy:'Per-source terms and licence; verify before redistribution',
    geographicCoverage:id==='datagovt'?'New Zealand open-data catalogue':id==='ticketmaster'?'New Zealand via configured query':'Provider-specific',
    rateLimit:'Provider-specific; no automatic background polling enabled'};
 });}

 filterRecord(r,p){const geo=[r.location,r.region].join(' ').toLowerCase();if(r.type!=='government_release'&&p.zones.length&&!p.zones.some(z=>geo.includes(z.toLowerCase()))){return false}if(p.categories.length){const s=[r.title,r.category,r.type,r.description].join(' ').toLowerCase();if(!p.categories.some(c=>s.includes(c.toLowerCase()))&&r.type!=='event'&&r.type!=='market_dataset'&&r.type!=='government_release')return false}if(p.eventTypes.length&&r.type==='event'&&r.category&&!p.eventTypes.some(x=>r.category.toLowerCase().includes(x.toLowerCase())))return false;return true}
 ingest(user,{provider,records,method='manual_attributed_import'}={},internalPermission=null){const tenant=this.require(user),profile=this.profile(user);if(!providers[provider])throw Error('Unsupported source');if(!profile.sources[provider])throw Error('Source disabled');if(!['manual_attributed_import','official_api'].includes(method))throw Error('Invalid import method');if(method==='official_api'&&internalPermission!==VERIFIED_OFFICIAL_REQUEST)throw Error('API method requires confirmed connector retrieval');if(!Array.isArray(records)||!records.length||records.length>40)throw Error('Invalid import records');
  const at=new Date().toISOString(),runId=randomUUID(),count={received:records.length,created:0,updated:0,duplicates:0,filtered:0,deferred:0};
  const normalised=records.map(raw=>{if(!raw||typeof raw!=='object'||Array.isArray(raw))throw Error('Invalid source record');const record={title:clean(raw.title,180),url:clean(raw.url,600),externalKey:clean(raw.externalKey,200),location:clean(raw.location,180),region:clean(raw.region||'Canterbury',90),startDate:clean(raw.startDate,10),endDate:clean(raw.endDate,10),organiser:clean(raw.organiser,180),organiserWebsite:clean(raw.organiserWebsite,500),type:clean(raw.type||'event',40),category:clean(raw.category,90),description:clean(raw.description,500),publisher:clean(raw.publisher||providers[provider].name,140),sourceObservedAt:clean(raw.sourceObservedAt,45),quality:'attributed' /* provider claims never self-certify corroboration */,licence:clean(raw.licence,100)};
   if(record.title.length<5||!validUrl(record.url)||(!record.externalKey&&!record.url))throw Error('Record must have title and HTTPS source URL');if(record.startDate&&!/^\d{4}-\d{2}-\d{2}$/.test(record.startDate))throw Error('Invalid event date');if(record.organiserWebsite&&!validUrl(record.organiserWebsite))throw Error('Invalid organiser website');
   if(method==='official_api'&&provider==='beehive'&&new URL(record.url).hostname!=='www.beehive.govt.nz')throw Error('Official Beehive source URL expected');
   if(method==='official_api'&&provider==='datagovt'&&new URL(record.url).hostname!=='catalogue.data.govt.nz')throw Error('Official catalogue URL expected');
   return record});
  this.store.transaction(()=>{this.store.db.prepare('INSERT INTO hf_discovery_runs VALUES(?,?,?,?,?,?,?, ?,?)').run(runId,tenant,provider,method,'completed',at,at,JSON.stringify(count),null);
   for(const r of normalised){if(qualityOrder[r.quality]<qualityOrder[profile.minEvidence]||!this.filterRecord(r,profile)){count.filtered++;continue}
    const externalKey=r.externalKey||r.url,contentHash=hash(r);const prior=this.store.db.prepare('SELECT id,content_hash FROM hf_discovery_sources WHERE tenant=? AND provider=? AND external_key=?').get(tenant,provider,externalKey);
    const decision=this.monitor?.observe(user,{provider,externalKey,record:r,sourceHash:contentHash,sourceId:prior?.id||null,deadlineAt:r.startDate?Date.parse(r.startDate+'T00:00:00Z'):null});
    if(decision&&!decision.process&&prior?.content_hash!==contentHash){count.deferred++;continue}
    if(prior?.content_hash===contentHash){count.duplicates++;continue}
    const sourceId=prior?.id||randomUUID();
    if(prior){const historic=this.store.db.prepare('SELECT * FROM hf_discovery_sources WHERE tenant=? AND id=?').get(tenant,sourceId);
     this.store.db.prepare('INSERT INTO hf_discovery_source_history VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(randomUUID(),tenant,sourceId,historic.provider,historic.external_key,historic.url,historic.retrieved_at,historic.method,historic.content_hash,historic.source_json,at);
    }
    const prov={...r,provider,retrievedAt:at,importMethod:method,automaticVerification:false,sha256:contentHash};
    this.store.db.prepare('INSERT INTO hf_discovery_sources VALUES(?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant,provider,external_key) DO UPDATE SET retrieved_at=excluded.retrieved_at,method=excluded.method,content_hash=excluded.content_hash,source_json=excluded.source_json').run(sourceId,tenant,provider,externalKey,r.url,at,method,contentHash,JSON.stringify(prov));
    const analysis=assess(r);const report={sourceId,subject:r.title,provider,sourceUrl:r.url,sourcePublisher:r.publisher,sourceObservedAt:r.sourceObservedAt||null,retrievedAt:at,method,sourceHash:contentHash,location:r.location,region:r.region,startDate:r.startDate||null,endDate:r.endDate||null,eventType:r.type,organiser:r.organiser||null,verifiedFacts:[`Published title: ${r.title}`,...(r.startDate?[`Published start date: ${r.startDate}`]:[]),...(r.location?[`Published location: ${r.location}`]:[]),...(r.organiser?[`Organiser listed: ${r.organiser}`]:[])],factsStatus:'attributed_to_publisher_not_independently_verified',commercialRelevance:analysis.reasons,services:analysis.services,confidence:analysis.confidence,uncertainty:analysis.gaps,priority:analysis.priority,managementReviewStatus:'pending_review',departments:analysis.departments,customerInterestVerified:false,buyingIntent:'not_verified',assessmentMethod:analysis.scoreBasis,sourceQuality:r.quality,licence:r.licence||'Check publisher terms before reusing content',manualImport:method!=='official_api'};
    let reportRow=this.store.db.prepare('SELECT id,review_status,report_json FROM hf_discovery_reports WHERE tenant=? AND source_id=?').get(tenant,sourceId);const reportId=reportRow?.id||randomUUID();
    if(reportRow){
     // Preserve previously reviewed content exactly; source updates require fresh Management review.
     this.store.db.prepare('INSERT INTO hf_discovery_report_history VALUES(?,?,?,?,?,?,?)').run(randomUUID(),tenant,reportId,reportRow.report_json,reportRow.review_status,at,'source evidence changed');
     this.store.db.prepare('UPDATE hf_discovery_reports SET subject=?,location=?,priority=?,review_status=?,report_json=?,updated_at=? WHERE id=? AND tenant=?').run(r.title,r.location,analysis.priority,'pending_review',JSON.stringify(report),at,reportId,tenant);count.updated++}
    else{this.store.db.prepare('INSERT INTO hf_discovery_reports VALUES(?,?,?,?,?,?,?,?,?,?)').run(reportId,tenant,sourceId,r.title,r.location,analysis.priority,'pending_review',JSON.stringify(report),at,at);count.created++}
    this.store.db.prepare('INSERT INTO hf_discovery_run_evidence VALUES(?,?,?,?,?)').run(runId,tenant,sourceId,contentHash,reportRow?'updated':'created');
    this.store.db.prepare('INSERT INTO hf_discovery_notifications VALUES(?,?,?,?,?,?)').run(randomUUID(),tenant,reportId,'unread',analysis.priority,at);
   }
   this.store.db.prepare('UPDATE hf_discovery_runs SET counts=? WHERE id=?').run(JSON.stringify(count),runId);
   this.identity.audit(user.id,'discovery.ingested',{runId,tenant,provider,method,count});
  });return {runId,provider,method,...count};
 }
 async requestOfficial(endpoint,options,{maxBytes=900000}={}){
  // Retry only explicit transient server responses; network DNS/TLS errors are not retried.
  for(let attempt=0;attempt<2;attempt++){
   const response=await this.fetchImpl(endpoint,options);
   if([502,503,504].includes(response.status)&&attempt===0){await new Promise(resolve=>setTimeout(resolve,250));continue}
   return {response,raw:response.ok?await readBounded(response,maxBytes):null};
  }
  throw Error('Provider temporarily unavailable');
 }
 async run(user,provider){this.require(user);if(!['datagovt','ticketmaster','beehive'].includes(provider))throw Error('Provider needs an authorised import or further integration');if(!this.profile(user).sources[provider])throw Error('Source disabled');
  const ctrl=new AbortController();const timeout=setTimeout(()=>ctrl.abort(),12000);let records=[];
  try{
   if(provider==='beehive'){
    const endpoint='https://www.beehive.govt.nz/rss.xml';
    const {response,raw}=await this.requestOfficial(endpoint,{signal:ctrl.signal,redirect:'error',headers:{Accept:'application/rss+xml, application/xml;q=0.9', 'User-Agent':'HigherFrequenciesIntelligence/0.1 (local operator; publisher RSS)'}},{maxBytes:900000});
    if(!response.ok)throw Error('Beehive RSS returned '+response.status);
    const contentType=response.headers?.get?.('content-type')||'';
    if(contentType&&!/xml|rss|text\/plain/i.test(contentType))throw Error('Unexpected RSS content type');
    records=parseOfficialRss(raw);
   }else if(provider==='datagovt'){
    const p=this.profile(user);const q=p.zones.some(x=>x.toLowerCase().includes('christchurch'))?'Christchurch':'Canterbury';const endpoint='https://catalogue.data.govt.nz/api/3/action/package_search?'+new URLSearchParams({q,rows:'12'});
    const {response,raw}=await this.requestOfficial(endpoint,{signal:ctrl.signal,headers:{Accept:'application/json'}},{maxBytes:1000000});if(!response.ok)throw Error('Catalogue API returned '+response.status);const data=JSON.parse(raw);if(!data.success||!Array.isArray(data.result?.results))throw Error('Unexpected catalogue API response');
    records=data.result.results.filter(x=>x.name&&x.title).map(x=>({title:x.title,externalKey:x.id||x.name,url:'https://catalogue.data.govt.nz/dataset/'+encodeURIComponent(x.name),location:q+', Canterbury',region:'Canterbury',type:'market_dataset',category:'business',organiser:x.organization?.title||'',description:'Public dataset listing. Review the linked data before drawing any market conclusions.',publisher:'data.govt.nz',sourceObservedAt:x.metadata_modified||'',quality:'attributed',licence:x.license_title||''}));
   }else{
    const apiKey=process.env.HF_TICKETMASTER_API_KEY;if(!apiKey)throw Error('HF_TICKETMASTER_API_KEY is not configured');const endpoint='https://app.ticketmaster.com/discovery/v2/events.json?'+new URLSearchParams({apikey:apiKey,countryCode:'NZ',city:'Christchurch',size:'20',sort:'date,asc'});
    const {response,raw}=await this.requestOfficial(endpoint,{signal:ctrl.signal,headers:{Accept:'application/json'}},{maxBytes:1000000});if(!response.ok)throw Error('Ticketmaster API returned '+response.status);const data=JSON.parse(raw);
    records=(data._embedded?.events||[]).filter(x=>x.name&&x.url).map(x=>({title:x.name,url:x.url,externalKey:x.id,location:x._embedded?.venues?.[0]?.city?.name||'Christchurch',region:'Canterbury',type:'event',category:x.classifications?.[0]?.segment?.name||'',startDate:x.dates?.start?.localDate||'',publisher:'Ticketmaster',quality:'attributed'}));
   }
   if(!records.length)throw Error('Provider returned no usable records');return this.ingest(user,{provider,records,method:'official_api'},VERIFIED_OFFICIAL_REQUEST);
  }catch(error){const at=new Date().toISOString(),tenant=this.require(user);this.store.db.prepare('INSERT INTO hf_discovery_runs VALUES(?,?,?,?,?,?,?,?,?)').run(randomUUID(),tenant,provider,'official_api','failed',at,at,JSON.stringify({received:0,created:0,updated:0,duplicates:0,filtered:0}),networkDiagnostic(error).slice(0,200));this.identity.audit(user.id,'discovery.live.failed',{provider,message:networkDiagnostic(error)});throw error}finally{clearTimeout(timeout)}
 }
 list(user,{q='',priority='',status='',limit=100}={}){const tenant=this.require(user);const search='%'+String(q).slice(0,100).replace(/[\\%_]/g,'\\$&')+'%';if(!['','A','B','C'].includes(priority)||!['','pending_review','research_required','approved_for_outreach','dismissed'].includes(status))throw Error('Invalid filter');return this.store.db.prepare(`SELECT id,subject,location,priority,review_status,created_at,updated_at,report_json FROM hf_discovery_reports WHERE tenant=? AND (?='' OR priority=?) AND (?='' OR review_status=?) AND subject LIKE ? ESCAPE '\\' ORDER BY CASE priority WHEN 'A' THEN 0 WHEN 'B' THEN 1 ELSE 2 END,updated_at DESC LIMIT ?`).all(tenant,priority,priority,status,status,search,Math.min(200,Math.max(1,Number(limit)||100))).map(({report_json,...x})=>({...x,report:JSON.parse(report_json)}))}
 get(user,id){const tenant=this.require(user);const row=this.store.db.prepare('SELECT * FROM hf_discovery_reports WHERE id=? AND tenant=?').get(id,tenant);if(!row)throw Error('Not found');return {...row,report:JSON.parse(row.report_json),history:this.history(user,id),source:this.store.db.prepare('SELECT id,url,retrieved_at,method,content_hash,source_json FROM hf_discovery_sources WHERE tenant=? AND id=?').get(tenant,row.source_id)}}
 history(user,id){const tenant=this.require(user);if(!this.store.db.prepare('SELECT id FROM hf_discovery_reports WHERE id=? AND tenant=?').get(id,tenant))throw Error('Not found');return this.store.db.prepare('SELECT id,report_json,review_status,archived_at,reason FROM hf_discovery_report_history WHERE tenant=? AND report_id=? ORDER BY archived_at,id').all(tenant,id).map(({report_json,...item})=>({...item,report:JSON.parse(report_json)}))}
 inbox(user){const tenant=this.require(user);return this.store.db.prepare('SELECT n.id,n.report_id,n.state,n.priority,n.created_at,r.subject,r.location FROM hf_discovery_notifications n JOIN hf_discovery_reports r ON r.id=n.report_id AND r.tenant=n.tenant WHERE n.tenant=? ORDER BY CASE n.state WHEN \'unread\' THEN 0 ELSE 1 END,n.created_at DESC LIMIT 100').all(tenant)}
 markRead(user,id){const tenant=this.require(user);const result=this.store.db.prepare("UPDATE hf_discovery_notifications SET state='read' WHERE id=? AND tenant=?").run(id,tenant);if(!result.changes)throw Error('Not found');this.identity.audit(user.id,'discovery.notification.read',{id});return {id,state:'read'}}
 review(user,id,{status,reason}={}){const tenant=this.require(user);if(!['research_required','approved_for_outreach','dismissed'].includes(status)||!clean(reason,1000)||reason.length<8||reason.length>1000)throw Error('Invalid review');const item=this.get(user,id);const report={...item.report,managementReviewStatus:status,reviewedAt:new Date().toISOString(),reviewedBy:user.id,reviewReason:reason};this.store.transaction(()=>{this.store.db.prepare('INSERT INTO hf_discovery_report_history VALUES(?,?,?,?,?,?,?)').run(randomUUID(),tenant,id,item.report_json,item.review_status,report.reviewedAt,'Management review '+status);this.store.db.prepare('UPDATE hf_discovery_reports SET review_status=?,report_json=?,updated_at=? WHERE id=? AND tenant=?').run(status,JSON.stringify(report),report.reviewedAt,id,tenant);this.identity.audit(user.id,'discovery.report.review',{id,status,reason})});return {id,status,externalOutreachPerformed:false}}
 runs(user){const tenant=this.require(user);return this.store.db.prepare('SELECT * FROM hf_discovery_runs WHERE tenant=? ORDER BY started_at DESC LIMIT 40').all(tenant).map(r=>({...r,counts:JSON.parse(r.counts)}))}
 overview(user){const tenant=this.require(user);return {counts:this.store.db.prepare('SELECT priority,review_status,COUNT(*) count FROM hf_discovery_reports WHERE tenant=? GROUP BY priority,review_status').all(tenant),unread:this.store.db.prepare("SELECT COUNT(*) n FROM hf_discovery_notifications WHERE tenant=? AND state='unread'").get(tenant).n,sourceCount:this.store.db.prepare('SELECT COUNT(*) n FROM hf_discovery_sources WHERE tenant=?').get(tenant).n,reportCount:this.store.db.prepare('SELECT COUNT(*) n FROM hf_discovery_reports WHERE tenant=?').get(tenant).n,runCount:this.store.db.prepare('SELECT COUNT(*) n FROM hf_discovery_runs WHERE tenant=?').get(tenant).n}}
}
