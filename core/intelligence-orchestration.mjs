import {SecureExchange} from './secure-exchange.mjs';
import {ServiceMandates} from './security/mandates.mjs';
import {ServiceCredentials} from './security/service-credentials.mjs';
import {randomUUID} from 'node:crypto';
/** Mandate-gated local analysis. No external data collection or business actions. */
export class IntelligenceOrchestration {
 constructor(workflow,workbench){this.workflow=workflow;this.intel=workbench;this.store=workflow.store;this.exchange=new SecureExchange(this.store);this.mandates=new ServiceMandates(this.store);this.store.db.exec(`CREATE TABLE IF NOT EXISTS hf_intel_execution(id TEXT PRIMARY KEY,event_id TEXT NOT NULL UNIQUE,tenant TEXT NOT NULL,objective_id TEXT NOT NULL,department TEXT NOT NULL,at TEXT NOT NULL); CREATE TABLE IF NOT EXISTS hf_intel_orchestration_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,objective_id TEXT NOT NULL,tenant TEXT NOT NULL,stage TEXT NOT NULL,detail TEXT NOT NULL);`);for(const d of ['research','marketing','finance','collective','executive','education'])this.store.db.prepare('INSERT OR IGNORE INTO hf_service_identities(id,department) VALUES(?,?)').run(`intel-${d}-worker`,d)}
 provision(admin,tenant,days=30){if(!admin||!['management','super_user'].includes(admin.role)||admin.tenant!==tenant)throw Error('Forbidden');const result=[];for(const d of ['research','marketing','finance','collective','executive','education']){const service=`intel-${d}-worker`;result.push({department:d,id:this.mandates.create(admin,{service,department:d,tenant,types:[`intel.${d}`],destinations:[service],expiresAt:Date.now()+days*86400000})})}return result}
 principal(d,tenant){return new ServiceCredentials(this.store).runtimePrincipal(`intel-${d}-worker`,d,tenant)}
 audit(tenant,id,stage,detail=''){this.store.db.prepare('INSERT INTO hf_intel_orchestration_audit(at,objective_id,tenant,stage,detail) VALUES(?,?,?,?,?)').run(new Date().toISOString(),id,tenant,stage,detail)}
 enqueue(department,tenant,id){let principal;try{principal=this.principal(department,tenant)}catch{this.exchange.policy.incidents.record({category:'event_authorisation',severity:'high',source:'orchestration',actor:`intel-${department}-worker`,resource:'enqueue',tenant});return false}if(!this.mandates.check(principal.id,tenant,`intel.${department}`))return false;// Never issue duplicate live work. An acknowledged event is not a permanent blocker:
 // later evidence or upstream assessments can require a new execution.
 const active=this.store.db.prepare("SELECT 1 FROM hf_events WHERE type=? AND correlation_id=? AND json_extract(payload,'$.tenant')=? AND status IN ('pending','leased')").get(`intel.${department}`,id,tenant);
 if(active)return false;
 // A Collective result must never mix old and new evidence revisions.
 if(department==='collective'){
  const scope=this.store.db.prepare('SELECT id FROM hf_intel_evidence WHERE tenant=? AND objective_id=?').all(tenant,id).map(r=>r.id);
  for(const dependency of ['research','marketing','finance']){
   const row=this.store.db.prepare('SELECT analysis FROM hf_intel_analysis WHERE tenant=? AND objective_id=? AND department=? ORDER BY id DESC LIMIT 1').get(tenant,id,dependency);
   if(!row)return false;
   const previous=JSON.parse(row.analysis).evidenceIds||[];
   if(previous.length!==scope.length||scope.some(evidenceId=>!previous.includes(evidenceId)))return false;
  }
 }
 const latest=this.store.db.prepare('SELECT id,analysis FROM hf_intel_analysis WHERE tenant=? AND objective_id=? AND department=? ORDER BY id DESC LIMIT 1').get(tenant,id,department);
 if(latest){
  if(['research','marketing','finance'].includes(department)){
   const current=this.store.db.prepare('SELECT id FROM hf_intel_evidence WHERE tenant=? AND objective_id=? ORDER BY id').all(tenant,id).map(x=>x.id);
   const previous=JSON.parse(latest.analysis).evidenceIds||[];
   if(current.length===previous.length&&current.every(x=>previous.includes(x)))return false;
  }else{
   const deps=department==='collective'?['research','marketing','finance']:department==='executive'?['collective']:['executive'];
   const versions=this.store.db.prepare(`SELECT department,MAX(id) AS newest FROM hf_intel_analysis WHERE tenant=? AND objective_id=? AND department IN (${deps.map(()=>'?').join(',')}) GROUP BY department`).all(tenant,id,...deps);
   if(versions.length===deps.length&&versions.every(v=>v.newest<latest.id))return false;
  }
 }
const o=this.store.db.prepare('SELECT id FROM hf_objectives WHERE id=? AND tenant=?').get(id,tenant);if(!o)return false; // Internal orchestration uses a scoped, currently authorised worker mandate; never a payload role claim.
 const event={type:`intel.${department}`,source:principal.id,destination:principal.id,correlationId:id,payload:{objectiveId:id,tenant}};
 this.exchange.publish(event,principal);this.audit(tenant,id,'queued',department);return true}
 tick(){const output=[];for(const d of ['research','marketing','finance','collective','executive','education']){const p={kind:'service',id:`intel-${d}-worker`,department:d,tenant:'internal'}; // Actual tenant is selected from persisted event; never inferred from caller payload alone.
 const e=this.store.db.prepare("SELECT * FROM hf_events WHERE destination=? AND ((status='pending' AND available_at<=?) OR (status='leased' AND lease_until<=?)) ORDER BY created_at,id LIMIT 1").get(p.id,Date.now(),Date.now());if(!e){continue}let payload;try{payload=JSON.parse(e.payload)}catch{continue}p.tenant=payload.tenant;try{Object.assign(p,this.principal(d,p.tenant));const event=this.exchange.claim(p,{leaseMs:30000});if(!event)continue;const id=event.payload.objectiveId,tenant=event.payload.tenant;const actor={...p,role:'service'};this.store.transaction(()=>{this.exchange.check('commit',p,{...event,tenant});const objective=this.store.db.prepare('SELECT * FROM hf_objectives WHERE id=? AND tenant=?').get(id,tenant);if(!objective||['rejected','cancelled'].includes(objective.status))throw Error('Objective unavailable');if(event.type!==`intel.${d}`||event.correlation_id!==id||event.destination!==p.id)throw Error('Event contract rejected');if(event.source==='management'){const creator=this.store.db.prepare('SELECT role,tenant,disabled FROM hf_users WHERE id=?').get(objective.created_by);if(!creator||creator.disabled||creator.tenant!==tenant||!['management','super_user'].includes(creator.role))throw Error('Origin authority revoked')}else if(event.source!==p.id)throw Error('Untrusted source');if(!this.store.db.prepare('SELECT 1 FROM hf_intel_execution WHERE event_id=?').get(event.id)){const result=this.intel.assess(actor,id,d);this.store.db.prepare('INSERT INTO hf_intel_execution VALUES(?,?,?,?,?,?)').run(randomUUID(),event.id,tenant,id,d,new Date().toISOString());this.audit(tenant,id,'completed',`${d}:${result.confidence}`)}if(!this.exchange.acknowledge({...event,tenant},p))throw Error('Lease expired')});output.push({department:d,objectiveId:id,status:'completed'});
 // All three departmental assessments must exist before collective synthesis.
 const completed=this.store.db.prepare("SELECT department FROM hf_intel_assessments WHERE tenant=? AND objective_id=? AND department IN ('research','marketing','finance')").all(tenant,id).map(x=>x.department);if(completed.length===3)this.enqueue('collective',tenant,id);
 if(d==='collective'&&this.store.db.prepare('SELECT status FROM hf_objectives WHERE id=? AND tenant=?').get(id,tenant)?.status==='approved')this.enqueue('executive',tenant,id);
 if(d==='executive'&&this.store.db.prepare("SELECT status FROM hf_objectives WHERE id=? AND tenant=?").get(id,tenant)?.status==='approved')this.enqueue('education',tenant,id);
 }catch(err){if(String(err.message).includes('credential'))this.exchange.policy.incidents.record({category:'event_authorisation',severity:'high',source:'orchestration',actor:p.id,resource:e.id,tenant:p.tenant});this.audit(p.tenant||'internal',payload.objectiveId||'unknown','error',String(err.message).slice(0,120));const leased=this.store.db.prepare("SELECT * FROM hf_events WHERE id=? AND status='leased' AND lease_owner=?").get(e.id,p.id);if(leased){try{this.exchange.fail({...leased,tenant:payload.tenant},p,err.message,{maxAttempts:3,baseDelayMs:1000})}catch{}}}}
 // Reconcile deferred downstream stages after restart or later mandate provisioning.
 for(const row of this.store.db.prepare("SELECT tenant,objective_id id,COUNT(*) n FROM hf_intel_assessments WHERE department IN ('research','marketing','finance') GROUP BY tenant,objective_id HAVING n=3").all())this.enqueue('collective',row.tenant,row.id);
 for(const row of this.store.db.prepare("SELECT a.tenant,a.objective_id id FROM hf_intel_assessments a JOIN hf_objectives o ON o.id=a.objective_id AND o.tenant=a.tenant WHERE a.department='collective' AND o.status='approved'").all())this.enqueue('executive',row.tenant,row.id);
 // On approval after Executive processing, queue a governed quality assessment.
 for(const row of this.store.db.prepare("SELECT DISTINCT a.objective_id id,a.tenant FROM hf_intel_assessments a JOIN hf_objectives o ON o.id=a.objective_id AND o.tenant=a.tenant WHERE a.department='executive' AND o.status='approved'").all())this.enqueue('education',row.tenant,row.id);
 return output}
 timeline(user,id){this.intel.objective(user,id);return this.store.db.prepare('SELECT at,stage,detail FROM hf_intel_orchestration_audit WHERE tenant=? AND objective_id=? ORDER BY id').all(user.tenant,id)}
}
