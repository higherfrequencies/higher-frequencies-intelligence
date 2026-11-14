export function coordinateFinding(record,{capacity=1}={}){return {recordId:record.id,route:record.classification==='confidential'?'restricted-review':'research',capacity,advisoryOnly:true}}

import {randomUUID} from 'node:crypto';
/** Tenant-scoped operational coordinator over the existing guarded workbench/exchange.
 * This does not replace the original handoff coordinator or Management workflow. */
export class EcosystemCoordinator {
 constructor(store,intel,orchestration,sectors){this.store=store;this.intel=intel;this.orchestration=orchestration;this.sectors=sectors;
  store.db.exec(`CREATE TABLE IF NOT EXISTS hf_coordination_runs(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,objective_id TEXT NOT NULL,sector TEXT NOT NULL,departments TEXT NOT NULL,status TEXT NOT NULL,actor TEXT NOT NULL,at TEXT NOT NULL);CREATE INDEX IF NOT EXISTS hf_coordination_scope ON hf_coordination_runs(tenant,objective_id,at);`);
  if(!store.db.prepare('PRAGMA table_info(hf_coordination_runs)').all().some(x=>x.name==='evidence_ids'))store.db.exec('ALTER TABLE hf_coordination_runs ADD COLUMN evidence_ids TEXT');
  store.db.exec(`CREATE TABLE IF NOT EXISTS hf_coordination_state_history(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,objective_id TEXT NOT NULL,run_id TEXT NOT NULL,previous_status TEXT NOT NULL,next_status TEXT NOT NULL,reason TEXT NOT NULL,at TEXT NOT NULL);CREATE INDEX IF NOT EXISTS hf_coordination_state_scope ON hf_coordination_state_history(tenant,objective_id,run_id);`);
 }
 /** Read-only reconciliation of processing results into persisted coordinator route state.
  * Reconciliation never publishes events, replays work, or manufactures a Management approval.
  * Called during worker ticks and on restart, with manual Management inspection available. */
 reconcileSystem(){return this.store.transaction(()=>{
  let changed=0;const runs=this.store.db.prepare('SELECT id,tenant,objective_id,sector,status,evidence_ids FROM hf_coordination_runs ORDER BY at,id').all();
  for(const run of runs){
   const o=this.store.db.prepare('SELECT status FROM hf_objectives WHERE id=? AND tenant=?').get(run.objective_id,run.tenant);
   const current=this.store.db.prepare('SELECT id FROM hf_intel_evidence WHERE tenant=? AND objective_id=? ORDER BY id').all(run.tenant,run.objective_id).map(x=>x.id);
   let prior=[];try{prior=JSON.parse(run.evidence_ids||'[]')}catch{}
   const changedRevision=current.length!==prior.length||current.some(x=>!prior.includes(x));
   const assessments=this.store.db.prepare("SELECT department,evidence_ids FROM hf_intel_assessments WHERE tenant=? AND objective_id=? AND department IN ('research','marketing','finance','collective')").all(run.tenant,run.objective_id);
   const fresh=new Set(assessments.filter(x=>{let ids;try{ids=JSON.parse(x.evidence_ids)}catch{return false}return ids.length===current.length&&current.every(i=>ids.includes(i))}).map(x=>x.department));
   const required=['research','marketing','finance','collective'];
   const mandates=['research','marketing','finance'].every(d=>this.orchestration.mandates.check(`intel-${d}-worker`,run.tenant,`intel.${d}`,`intel-${d}-worker`));
   let status,reason;
   if(!o||['rejected','cancelled'].includes(o.status)){status='cancelled';reason='Objective unavailable or cancelled'}
   else if(changedRevision){status='superseded';reason='New evidence differs from the route snapshot'}
   else if(required.every(d=>fresh.has(d))){status='completed';reason='All required departmental assessments match route evidence'}
   else if(!mandates){status='blocked';reason='Required departmental mandate missing or revoked'}
   else if(fresh.size){status='processing';reason='Departmental assessments incomplete'}
   else{status='queued';reason='Awaiting authorised departmental processing'}
   if(status===run.status)continue;
   const at=new Date().toISOString(),recordId=randomUUID();
   this.store.db.prepare('UPDATE hf_coordination_runs SET status=? WHERE id=? AND tenant=?').run(status,run.id,run.tenant);
   this.store.db.prepare('INSERT INTO hf_coordination_state_history VALUES(?,?,?,?,?,?,?,?)').run(recordId,run.tenant,run.objective_id,run.id,run.status,status,reason,at);
   changed++;
  }
  return {inspected:runs.length,updated:changed,externalActions:0};
 })}
 reconcile(user,id){this.intel.require(user,['management','super_user']);this.intel.objective(user,id);const summary=this.reconcileSystem();return {...summary,history:this.history(user,id)}}
 stateHistory(user,id){this.intel.objective(user,id);return this.store.db.prepare('SELECT run_id,previous_status,next_status,reason,at FROM hf_coordination_state_history WHERE tenant=? AND objective_id=? ORDER BY at,id').all(user.tenant,id)}
 /** Discover the supported built-in departmental route and specialist contracts through
  * the tenant's live sector manifest and service mandates. Discovery is not execution. */
 capabilities(user,id,sector='general-business'){
  this.intel.objective(user,id);
  const manifest=this.sectors.discover(user,id,sector);
  const departments=['research','marketing','finance'].map(department=>{
   const worker=`intel-${department}-worker`;
   return {department,capability:`intel.${department}`,worker,
    dependsOn:[],mandateActive:this.orchestration.mandates.check(worker,user.tenant,`intel.${department}`,worker),
    authenticationRequired:true,execution:'local_guarded_exchange'};
  });
  const collective={department:'collective',capability:'intel.collective',worker:'intel-collective-worker',
   dependsOn:departments.map(d=>d.capability),mandateActive:this.orchestration.mandates.check('intel-collective-worker',user.tenant,'intel.collective','intel-collective-worker'),authenticationRequired:true,execution:'local_guarded_exchange'};
  const registeredHubs=this.hubs&&['super_user','management','specialist','department_admin','operator'].includes(user.role)?this.hubs.listScoped(user,this.intel.identity).filter(h=>h.sector===sector&&h.enabled).map(h=>({id:h.id,version:h.version,department:h.department,capabilities:h.capabilities,metadataOnly:true,executionEnabled:false})):[];
  return {sector,sectorEnabled:manifest.enabled,departments:[...departments,collective],specialists:manifest.capabilities,registeredHubs,
   routeContract:'research_marketing_finance_then_collective',routeAvailable:manifest.enabled&&departments.every(x=>x.mandateActive),
   tenant:user.tenant,objectiveId:id,source:'persisted_sector_registry_and_current_mandates',
   limitations:['Discovery does not establish worker credential availability or independently verify any evidence'],outboundActions:0};
 }
 /** Authoritative preflight for the existing registered departmental route. Does not
  * transmit, replay, reroute or reclassify data. Only the existing route() method
  * may publish guarded work after the preflight returns deliver. */
 trafficDecision(user,id,{sector='general-business',department='research',classification='internal'}={}){
  this.intel.require(user,['super_user','management']);
  const objective=this.intel.objective(user,id);
  if(!['public','internal','restricted'].includes(classification))throw Error('Unsupported intelligence classification');
  if(typeof department!=='string'||department.length>60)throw Error('Invalid destination department');
  const contract=this.capabilities(user,id,sector);
  const destination=contract.departments.find(x=>x.department===department);
  const base={tenant:user.tenant,objectiveId:id,sector,department,classification,originalDestination:destination?.worker||null,
   evaluatedAt:new Date().toISOString(),externalActions:0,deliveryAttempted:false,rerouted:false,
   reviewRequired:false,routeContract:contract.routeContract};
  if(!destination)return {...base,decision:'reject',reason:'No registered departmental capability for this destination'};
  if(['cancelled','rejected','approved'].includes(objective.status))return {...base,decision:'reject',reason:'Objective does not permit further departmental routing'};
  if(!contract.sectorEnabled)return {...base,decision:'hold',reason:'Registered sector is disabled; Management must review enablement',reviewRequired:true};
  if(classification!=='internal')return {...base,decision:'hold',reason:'Classification cannot be changed without a separately authorised source-classification review; no automatic transfer',reviewRequired:true};
  if(!destination.mandateActive)return {...base,decision:'reject',reason:'Destination mandate is not active'};
  if(destination.dependsOn.length){
   const status=this.progress(user,id);
   if(!destination.dependsOn.every(d=>status.completedDepartments.includes(d.replace('intel.',''))))return {...base,decision:'queue',reason:'Upstream departmental assessments are not ready; no event published'};
  }
  return {...base,decision:'deliver',reason:'Guarded enqueue permitted by registered contract and current mandate; processing still requires an authenticated worker'};
 }
 /** Derived from persisted evidence/assessment state, not a claim of external verification. */
 progress(user,id,departments=['research','marketing','finance']){
  this.intel.objective(user,id);
  const current=this.store.db.prepare('SELECT id FROM hf_intel_evidence WHERE tenant=? AND objective_id=? ORDER BY id').all(user.tenant,id).map(x=>x.id);
  const assessed=this.store.db.prepare('SELECT department,evidence_ids FROM hf_intel_assessments WHERE tenant=? AND objective_id=?').all(user.tenant,id);
  const fresh=assessed.filter(row=>{const ids=JSON.parse(row.evidence_ids);return ids.length===current.length&&current.every(id=>ids.includes(id))}).map(x=>x.department);
  const complete=[...departments,'collective'].every(d=>fresh.includes(d));
  return {status:complete?'completed':fresh.length?'processing':current.length?'queued':'blocked',completedDepartments:fresh,missingDepartments:[...departments,'collective'].filter(d=>!fresh.includes(d)),evidenceIds:current,source:'persisted_departmental_assessments',independentlyVerified:false};
 }
 overview(user,id){const objective=this.intel.objective(user,id),tasks=this.intel.tasks(user,id),assessments=this.intel.assessments(user,id),evidence=this.intel.evidence(user,id),departments=['research','marketing','finance'],blockers=[];
  if(!evidence.length)blockers.push('No supplied evidence; unsupported market or financial conclusions are prohibited');
  for(const d of departments){const worker=`intel-${d}-worker`;if(!this.orchestration.mandates.check(worker,user.tenant,`intel.${d}`,worker))blockers.push(`No active ${d} service mandate`);}
  for(const d of departments){const a=assessments.find(x=>x.department===d);if(!a)blockers.push(`Missing ${d} assessment`);else if(a.evidence_ids.length!==evidence.length||evidence.some(e=>!a.evidence_ids.includes(e.id)))blockers.push(`Stale ${d} assessment: new evidence requires reassessment`)}
  if(!assessments.some(a=>a.department==='collective'))blockers.push('Collective synthesis pending');
  const progress=this.progress(user,id);
  return {objective,progress,tasks,assessments:assessments.map(x=>({department:x.department,confidence:x.confidence,evidenceIds:x.evidence_ids})),evidenceCount:evidence.length,blockers,history:this.history(user,id),stateHistory:this.stateHistory(user,id),timeline:this.orchestration.timeline(user,id),externalActions:0};
 }
 route(user,id,{sector='general-business',departments=['research','marketing','finance'],classification='internal'}={}){
  this.intel.require(user,['management','super_user']);this.intel.editable(user,id);
  // Derive the supported route from the live registered capability contract, not the caller's claim.
  const contract=this.capabilities(user,id,sector);
  const required=contract.departments.filter(d=>d.dependsOn.length===0).map(d=>d.department);
  if(!Array.isArray(departments)||departments.length!==required.length||new Set(departments).size!==required.length||!required.every(d=>departments.includes(d)))throw Error('Complete registered departmental route required');
  if(!contract.sectorEnabled)throw Error('Sector disabled');
  for(const d of contract.departments.filter(d=>required.includes(d.department)))if(!d.mandateActive)throw Error(`Active ${d.department} mandate required`);
  for(const department of required){const decision=this.trafficDecision(user,id,{sector,department,classification});if(decision.decision!=='deliver')throw Error(`Traffic control ${decision.decision}: ${decision.reason}`);}
  const revision=this.progress(user,id).evidenceIds;
  const latest=this.store.db.prepare('SELECT id,departments,evidence_ids,status,actor,at FROM hf_coordination_runs WHERE tenant=? AND objective_id=? AND sector=? ORDER BY at DESC,id DESC LIMIT 1').get(user.tenant,id,sector);
  if(latest&&latest.evidence_ids===JSON.stringify(revision)&&departments.every(d=>JSON.parse(latest.departments).includes(d)))return {id:latest.id,sector,departments,status:this.progress(user,id).status,duplicate:true,tasks:this.intel.tasks(user,id),outboundActions:0};
  return this.store.transaction(()=>{const tasks=this.intel.assign(user,id,departments),run={id:randomUUID(),sector,departments,status:'queued',actor:user.id,at:new Date().toISOString()};this.store.db.prepare('INSERT INTO hf_coordination_runs(id,tenant,objective_id,sector,departments,status,actor,at,evidence_ids) VALUES(?,?,?,?,?,?,?,?,?)').run(run.id,user.tenant,id,sector,JSON.stringify(departments),'queued',user.id,run.at,JSON.stringify(revision));this.intel.identity.audit(user.id,'ecosystem.route',{objectiveId:id,sector,departments,coordinationId:run.id});return {...run,tasks,outboundActions:0}});
 }
 history(user,id){this.intel.objective(user,id);return this.store.db.prepare('SELECT id,sector,departments,status,actor,at,evidence_ids FROM hf_coordination_runs WHERE tenant=? AND objective_id=? ORDER BY at,id').all(user.tenant,id).map(r=>({...r,departments:JSON.parse(r.departments),sourceEvidenceIds:JSON.parse(r.evidence_ids||'[]'),liveStatus:this.progress(user,id).status}));}
}
