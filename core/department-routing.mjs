/** Offline, explicit handoff of approved intelligence work to departmental staff queues.
 * Management steps remain approval gates, never delegated to ordinary staff.
 */
const staffSteps = Object.freeze({
  'research-verification':'research',
  'research-assignment':'research',
  'research-backlog':'research',
  'secretary-draft':'secretary',
  'schedule-reassessment':'research'
});
export class DepartmentRouting {
  constructor(exchangeBridge,staffQueue){this.exchange=exchangeBridge;this.queue=staffQueue;}
  async routeApproved(recordId,{actor,role}={}){
    if(!actor?.trim()||!['manager','super_user'].includes(role))throw Error('Management authorisation required');
    const approval=this.exchange.approveAndRoute(recordId,{actor,role});
    const classification=this.exchange.store.transaction(db=>db.get('information-classification',recordId));
    if(!classification)throw Error('Missing classification');
    // Confidential records are held for management review; never copied to a staff queue.
    if(['restricted','confidential'].includes(classification.classification))return {approval,assignments:[],heldForManagement:true};
    const plan=this.exchange.store.transaction(db=>db.get('workflow-plan',recordId));
    const assignments=[];
    for(let index=0;index<plan.steps.length;index++){
      const step=plan.steps[index],target=staffSteps[step];
      if(!target)continue;
      const result=await this.queue.assign({sourceId:`smart:${recordId}:${index}`,title:`${step.replaceAll('-',' ')} — ${recordId}`,role:target,priority:'moderate',evidence:[recordId],summary:'Approved offline intelligence handoff; verify evidence before external use'},actor);
      assignments.push({step,role:target,created:result.created,taskId:result.task.id});
    }
    return {approval,assignments,heldForManagement:false};
  }
}
