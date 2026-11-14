/** Read-only architectural projection of registered, tenant-scoped local services.
 * No event is routed, replayed or acknowledged by this module. No inferred health
 * status is presented as a heartbeat or independent assurance. */
import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,dirname} from 'node:path';

const requirementsPath=join(dirname(fileURLToPath(import.meta.url)),'../docs/requirements-register.json');
const COMPONENTS=[
 {id:'research',title:'Research Intelligence',parent:'general-business',requirement:'B1',worker:'intel-research-worker'},
 {id:'marketing',title:'Marketing Intelligence',parent:'creative-industries',requirement:'B2',worker:'intel-marketing-worker'},
 {id:'finance',title:'Finance Intelligence',parent:'general-business',requirement:'B3',worker:'intel-finance-worker'},
 {id:'collective',title:'Collective Intelligence',parent:'general-business',requirement:'B4',worker:'intel-collective-worker'},
 {id:'decision',title:'Decision Intelligence',parent:'general-business',requirement:'B5'},
 {id:'reporting',title:'Secretary & Reporting',parent:'general-business',requirement:'B6',worker:'reporting-worker'},
 {id:'education',title:'Education & Learning',parent:'education',requirement:'EDU'},
 {id:'executive',title:'Executive Centre',parent:'general-business',requirement:'EXEC'},
 {id:'management',title:'Management Tower',parent:'general-business',requirement:'C1'},
 {id:'super-user',title:'Governance Centre',parent:'general-business',requirement:'A3'},
 {id:'exchange',title:'Intelligence Exchange',parent:'general-business',requirement:'A1'},
 {id:'caretaker',title:'Caretaker & Recovery',parent:'general-business',requirement:'A5'},
 {id:'security',title:'Security & Policing',parent:'general-business',requirement:'A4'}
];
const LINKS=[['management','research'],['management','marketing'],['management','finance'],['research','collective'],['marketing','collective'],['finance','collective'],['collective','decision'],['decision','reporting'],['reporting','executive'],['super-user','management'],['exchange','research'],['exchange','marketing'],['exchange','finance'],['caretaker','exchange'],['security','exchange']];
const statuses=new Set(['VERIFIED COMPLETE','OPERATIONAL WITH LIMITATIONS','PARTIALLY IMPLEMENTED','NOT IMPLEMENTED','BLOCKED','NOT VERIFIED']);
function requirementsFor(register,prefix){return register.filter(r=>r.id===prefix||r.id.startsWith(prefix+'.'));}
function development(items){
 const leaves=items.filter(x=>!items.some(y=>y.parent===x.id));
 const records=leaves.length?leaves:items;
 const verified=records.filter(x=>x.status==='VERIFIED COMPLETE').length;
 const notStarted=records.filter(x=>x.status==='NOT IMPLEMENTED').length;
 const blocked=records.filter(x=>x.status==='BLOCKED'||x.status==='NOT VERIFIED').length;
 return {applicable:records.length,verified,partiallyImplemented:records.length-verified-notStarted-blocked,notStarted,verificationBlockers:blocked,percent:records.length?Math.round(100*verified/records.length):null,
  status:!records.length?'unregistered':verified===records.length?'verified':notStarted===records.length?'not-implemented':'partial',
  note:'Percentage measures accepted requirement records, not development effort',
  acceptanceEvidence:records.filter(x=>x.status==='VERIFIED COMPLETE').map(x=>({id:x.id,verification:x.verification_result||x.actual_result||'See existing requirements register'})).slice(0,8)};
}
export class IntelligenceCity {
 constructor(store,identity,sectors,coordinator,orchestration,hubs=null){this.store=store;this.identity=identity;this.sectors=sectors;this.coordinator=coordinator;this.orchestration=orchestration;this.hubs=hubs;}
 snapshot(user,objectiveId=null){
  this.identity.require(user,['super_user','management']);
  if(objectiveId)this.coordinator.intel.objective(user,objectiveId);
  const tenant=user.tenant,db=this.store.db;
  const register=JSON.parse(readFileSync(requirementsPath,'utf8')).requirements.filter(x=>x.mandatory!==false&&statuses.has(x.status));
  const sectorRows=this.sectors.list(user);const registeredHubs=this.hubs?this.hubs.listScoped(user,this.identity):[];
  const sectorNodes=sectorRows.map(s=>({id:`sector:${s.sector}`,kind:'district',title:s.sector.replace(/-/g,' '),sector:s.sector,enabled:s.enabled,
   capabilities:s.enabled?s.capabilities.map(c=>({id:c.id,version:c.version,department:c.department})):[],development:development(requirementsFor(register,'C5')),
   operational:{state:s.enabled?'registered':'paused',basis:'tenant-scoped sector configuration; no runtime probe'},traffic:{state:'unknown',basis:'no per-sector event routing identity'}}));
  const objectiveSQL=objectiveId?' AND o.id=?':'';
  const events=db.prepare(`SELECT e.status,e.destination,COUNT(*) AS n,SUM(CASE WHEN e.status='leased' AND e.lease_until<=? THEN 1 ELSE 0 END) AS expired FROM hf_events e JOIN hf_objectives o ON o.id=e.correlation_id WHERE o.tenant=?${objectiveSQL} GROUP BY e.status,e.destination`).all(...(objectiveId?[Date.now(),tenant,objectiveId]:[Date.now(),tenant]));
  const byDestination=new Map();for(const x of events){const m=byDestination.get(x.destination)||{};m[x.status]=(m[x.status]||0)+x.n;m.expired=(m.expired||0)+x.expired;byDestination.set(x.destination,m);}
  const nodes=COMPONENTS.map(c=>{
   const manifest=sectorRows.find(s=>s.sector===c.parent);const registration=c.worker?db.prepare('SELECT department FROM hf_service_identities WHERE id=?').get(c.worker):null;
   const mandate=c.worker?this.orchestration.mandates.check(c.worker,tenant,`intel.${c.id}`,c.worker):null;
   const trafficCounts=c.worker?byDestination.get(c.worker)||{}:{};
   const unavailable=c.worker&&mandate===false;
   return {id:c.id,kind:c.id==='management'||c.id==='super-user'||c.id==='executive'?'governance':c.id==='exchange'||c.id==='caretaker'||c.id==='security'?'infrastructure':'hub',title:c.title,sector:c.parent,
    department:c.id,worker:c.worker||null,capabilities:c.worker?[`intel.${c.id}`]:[],
    development:development(requirementsFor(register,c.requirement)),
    operational:{state:unavailable?'unavailable':'unknown',basis:c.worker?'Current service mandate only; no verified live heartbeat':'No component heartbeat asserted',mandateActive:mandate},
    traffic:{...trafficCounts,state:(trafficCounts.expired||0)?'expired_lease':(trafficCounts.leased||0)?'processing':(trafficCounts.dead_letter||0)?'failed':(trafficCounts.pending||0)?'queued':Object.keys(trafficCounts).length?'idle':'none',basis:'Persisted tenant-scoped event status counts'},
    registered:c.worker?!!registration:false,registrationSource:c.worker?'hf_service_identities':'code-defined architecture; not a persisted service identity',sectorEnabled:!!manifest?.enabled};
  });
  const manifestNodes=registeredHubs.map(h=>({id:`hub:${h.id}`,kind:'registered_hub',title:h.id,sector:h.sector,department:h.department,version:h.version,enabled:h.enabled,registered:true,capabilities:h.capabilities,development:development([]),operational:{state:h.enabled?'registered':'paused',basis:'Reviewed tenant-scoped manifest; execution/worker status not asserted'},traffic:{state:'unknown',basis:'No service-to-hub event mapping registered'}}));
  const total=register.length,verified=register.filter(x=>x.status==='VERIFIED COMPLETE').length;
  const taskStatus=db.prepare(`SELECT t.department,t.status,COUNT(*) n FROM hf_intel_tasks t JOIN hf_objectives o ON o.id=t.objective_id AND o.tenant=t.tenant WHERE t.tenant=?${objectiveSQL} GROUP BY t.department,t.status`).all(...(objectiveId?[tenant,objectiveId]:[tenant]));
  const edges=LINKS.map(([from,to])=>({from,to,kind:'registered_architectural_dependency',active:null,description:'Architectural dependency; not proof of event delivery'}));
  return {at:new Date().toISOString(),scope:{tenant,objectiveId},mapVersion:1,kind:'registered_local_architecture_projection',sectors:sectorNodes,nodes:[...nodes,...manifestNodes],edges,
   requirementSummary:{total,verified,unchecked:total-verified,percent:total?Math.round(100*verified/total):0},
   trafficSummary:{events:events.reduce((n,r)=>n+r.n,0),byStatus:Object.fromEntries([...new Set(events.map(e=>e.status))].map(status=>[status,events.filter(e=>e.status===status).reduce((n,e)=>n+e.n,0)])),tasks:taskStatus},
   limitations:['Not a live worker heartbeat or network map','Only recorded local events are counted','No unapproved intelligence content exposed','Disabled sectors remain visible but unavailable'],outboundActions:0};
 }
}
