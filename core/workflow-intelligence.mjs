/** Advisory workflow sequencing; queue insertion requires explicit caller authorisation. */
export function planWorkflow({classification,decision,capacity=1}={}){
 if(!classification?.recordId)throw Error('Classification required');
 const destination=classification.destination;
 const steps=destination==='restricted-review'?['management-review']:
  destination==='verification'?['research-verification']:
  destination==='watchlist'?['schedule-reassessment']:
  capacity<=0?['capacity-review']:
  decision?.route==='research_priority'?['research-assignment','management-initial-review','secretary-draft','management-final-approval']:
  ['research-backlog'];
 return {recordId:classification.recordId,steps,requiresApproval:steps.some(s=>s.startsWith('management-')),advisoryOnly:true,externalActionsAllowed:false};
}
export class WorkflowIntelligence{
 constructor(store){this.store=store;}
 plan(input){const result=planWorkflow(input);this.store.transaction(db=>db.put('workflow-plan',result.recordId,result));return result;}
 enqueueApproved(recordId,{role,actor}={}){
  if(!['manager','super_user'].includes(role)||!actor)throw Error('Management approval required');
  return this.store.transaction(db=>{
   const plan=db.get('workflow-plan',recordId);if(!plan)throw Error('No plan');
   const queued=plan.steps.map((step,index)=>({id:`workflow:${recordId}:${index}`,step,createdBy:actor}));
   for(const job of queued)db.enqueue(job.id,job);
   db.put('workflow-approval',recordId,{actor,role,at:new Date().toISOString()});
   return queued;
  });
 }
}
