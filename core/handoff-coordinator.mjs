/** Durable, offline reconciliation of Exchange intents and departmental staff assignments.
 * SQLite intents are authoritative; staff queue writes are idempotent by sourceId.
 * No automatic approvals, publication, or confidential staff disclosure.
 */
import {randomUUID} from 'node:crypto';
const roles=new Set(['manager','super_user','caretaker']);
const safeSteps={'research-verification':'research','research-assignment':'research','research-backlog':'research','secretary-draft':'secretary','schedule-reassessment':'research'};
const timestamp=()=>new Date().toISOString();
export class HandoffCoordinator {
 constructor(store,staffQueue,{departmentIntelligence=null}={}){this.store=store;this.queue=staffQueue;this.departmentIntelligence=departmentIntelligence;}
 register(recordId,{actor,role}={}){
  if(!actor?.trim()||!['manager','super_user'].includes(role))throw Error('Management authorisation required');
  return this.store.transaction(db=>{
   const approved=db.get('smart-exchange-routing',recordId);
   const plan=db.get('workflow-plan',recordId);
   const classification=db.get('information-classification',recordId);
   if(!approved||!plan||!classification)throw Error('Approved intelligence record required');
   const restricted=['restricted','confidential'].includes(classification.classification);
   const intents=[];
   for(let i=0;i<plan.steps.length;i++){
    const step=plan.steps[i],department=safeSteps[step];if(!department)continue;
    const id=`smart:${recordId}:${i}`;
    const previous=db.get('handoff-intents',id);
    if(previous){intents.push(previous);continue;}
    const intent={id,recordId,step,department,status:restricted?'held':'pending',reason:restricted?'Restricted information requires management review':null,assignmentId:null,createdAt:timestamp(),updatedAt:timestamp()};
    db.put('handoff-intents',id,intent);intents.push(intent);
   }
   db.put('handoff-audit',randomUUID(),{action:'register',recordId,actor,role,restricted,at:timestamp()});
   return {recordId,heldForManagement:restricted,intents};
  });
 }
 async reconcile({actor,role,limit=100}={}){
  if(!actor?.trim()||!roles.has(role))throw Error('Authorised operator required');
  if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw Error('Invalid reconciliation limit');
  const records=this.store.db.prepare("SELECT value FROM kv WHERE namespace='handoff-intents' ORDER BY key").all().map(r=>JSON.parse(r.value));
  const results=[];
  for(const intent of records.filter(r=>r.status==='pending'||r.status==='delivered').slice(0,limit)){
   const classification=this.store.get('information-classification',intent.recordId);
   if(!classification||['restricted','confidential'].includes(classification.classification)){
    this.store.transaction(db=>{const current=db.get('handoff-intents',intent.id);if(current){db.put('handoff-intents',intent.id,{...current,status:'held',reason:'Restricted or missing classification',updatedAt:timestamp()});}});
    results.push({id:intent.id,status:'held'});continue;
   }
   try{
    const result=await this.queue.assign({sourceId:intent.id,title:`${intent.step.replaceAll('-',' ')} — ${intent.recordId}`,role:intent.department,priority:'moderate',evidence:[intent.recordId],summary:'Approved offline intelligence handoff; verify evidence before external use'},actor);
    this.store.transaction(db=>{
     const current=db.get('handoff-intents',intent.id);
     if(current&&current.status!=='held')db.put('handoff-intents',intent.id,{...current,status:'delivered',assignmentId:result.task.id,updatedAt:timestamp()});
     db.put('handoff-audit',randomUUID(),{action:'reconciled',id:intent.id,assignmentId:result.task.id,created:result.created,actor,at:timestamp()});
    });
    results.push({id:intent.id,status:'delivered',created:result.created,assignmentId:result.task.id});
   }catch(error){results.push({id:intent.id,status:'pending',error:String(error.message)});}
  }
  return {processed:results.length,results};
 }
 reconcileOutcomes({actor,role}={}){
  if(!actor?.trim()||!roles.has(role)||!this.departmentIntelligence)throw Error('Authorised department intelligence required');
  const tasks=this.queue.snapshot().tasks;
  const updated=[];
  for(const task of tasks.filter(t=>['completed','blocked'].includes(t.status)&&t.sourceId?.startsWith('smart:'))){
   const intent=this.store.get('handoff-intents',task.sourceId);
   if(!intent||intent.status!=='delivered'||intent.assignmentId!==task.id)continue;
   const status=task.status;
   const outcome=this.departmentIntelligence.recordOutcome({id:`assignment:${task.id}:${status}`,department:intent.department,taskId:task.id,status,blockedReason:status==='blocked'?(task.history.at(-1)?.reason||'Blocked task'):null,sourceRefs:[intent.recordId]},{actor,role});
   this.store.transaction(db=>{const current=db.get('handoff-intents',intent.id);if(current)db.put('handoff-intents',intent.id,{...current,status:status==='completed'?'completed':'blocked',updatedAt:timestamp()});});
   updated.push({id:intent.id,outcomeId:outcome.id,status});
  }
  return updated;
 }
 overview({role}={}){
  if(!roles.has(role)&&!['research','secretary','admin'].includes(role))throw Error('Unauthorised overview');
  const records=this.store.db.prepare("SELECT value FROM kv WHERE namespace='handoff-intents'").all().map(r=>JSON.parse(r.value));
  const filtered=roles.has(role)?records:records.filter(r=>r.department===role&&r.status!=='held');
  return {total:filtered.length,byStatus:Object.fromEntries(['pending','delivered','completed','blocked','held'].map(s=>[s,filtered.filter(r=>r.status===s).length])),intents:role==='caretaker'?filtered.map(r=>({id:r.id,status:r.status,updatedAt:r.updatedAt})):filtered};
 }
}
