/** Offline bridge: approved smart-layer work -> durable Exchange jobs. No network or external release. */
import {receive,dispatch} from './exchange.mjs';
import {IntelligenceOrchestrator} from './intelligence-orchestrator.mjs';

const allowed = new Set(['manager','super_user']);
export class SmartExchangeBridge {
  constructor(store){this.store=store;this.intelligence=new IntelligenceOrchestrator(store);}
  assess(record,options={}){return this.intelligence.assess(record,options);}
  approveAndRoute(recordId,{actor,role}={}){
    if(!actor?.trim()||!allowed.has(role))throw Error('Management authorisation required');
    return this.store.transaction(db=>{
      const classification=db.get('information-classification',recordId);
      const plan=db.get('workflow-plan',recordId);
      const original=db.get('information-original',recordId);
      if(!classification||!plan||!original)throw Error('Record must be assessed first');
      const prior=db.get('smart-exchange-routing',recordId);
      if(prior)return {...prior,created:false};
      const restricted=['restricted','confidential'].includes(classification.classification);
      const message=receive({id:`smart:${recordId}`,source:'smart-intelligence',kind:restricted?'alert':'opportunity',summary:restricted?'Restricted review required':`Workflow assessment for ${recordId}`,reviewRequired:true});
      const destination=dispatch(message.item);
      const tasks=plan.steps.map((step,index)=>({id:`smart:${recordId}:${index}`,recordId,step,classification:classification.classification,requiresHumanReview:true,externalActionsAllowed:false}));
      for(const task of tasks)db.enqueue(task.id,task);
      const result={recordId,actor,role,approvedAt:new Date().toISOString(),destination,tasks:tasks.map(t=>t.id),created:true};
      db.put('smart-exchange-routing',recordId,result);
      db.put('smart-exchange-audit',recordId,{actor,role,action:'approve-and-route',at:result.approvedAt});
      return result;
    });
  }
  overview({role}={}){
    if(!['super_user','manager','caretaker','research','secretary','admin'].includes(role))throw Error('Unauthorised overview');
    const jobs=this.store.jobs();
    const visible=jobs.filter(j=>role==='super_user'||role==='manager'||!['restricted','confidential'].includes(j.payload.classification));
    return {totalJobs:visible.length,byStatus:Object.fromEntries(['pending','running','completed'].map(s=>[s,visible.filter(j=>j.status===s).length])),jobs:role==='caretaker'?visible.map(j=>({id:j.id,status:j.status,attempts:j.attempts})):visible};
  }
}
