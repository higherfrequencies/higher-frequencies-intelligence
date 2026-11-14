/** Opt-in offline recovery cycle. No background process is started by importing this module.
 * Scheduling belongs to the host process; lease prevents overlapping cycles.
 */
import {randomUUID} from 'node:crypto';
export class ReconciliationService {
 constructor(store,coordinator,{owner=randomUUID(),leaseName='hf:handoff-reconciliation'}={}){
  this.store=store;this.coordinator=coordinator;this.owner=owner;this.leaseName=leaseName;
 }
 async runOnce({limit=100,includeOutcomes=true}={}){
  if(!Number.isSafeInteger(limit)||limit<1||limit>1000)throw Error('Invalid limit');
  const lease=this.store.acquireLease(this.leaseName,this.owner,{ttlMs:120000});
  if(!lease)return {status:'skipped',reason:'Another reconciliation cycle holds the lease'};
  const startedAt=new Date().toISOString();
  try{
   const routing=await this.coordinator.reconcile({actor:'offline-reconciliation-service',role:'caretaker',limit});
   const outcomes=includeOutcomes?this.coordinator.reconcileOutcomes({actor:'offline-reconciliation-service',role:'caretaker'}):[];
   const summary={status:'completed',startedAt,finishedAt:new Date().toISOString(),processed:routing.processed,delivered:routing.results.filter(x=>x.status==='delivered').length,held:routing.results.filter(x=>x.status==='held').length,errors:routing.results.filter(x=>x.error).length,outcomes:outcomes.length};
   this.store.put('reconciliation-runs',randomUUID(),summary);
   return summary;
  }catch(error){
   const summary={status:'failed',startedAt,finishedAt:new Date().toISOString(),error:String(error.message)};
   this.store.put('reconciliation-runs',randomUUID(),summary);
   return summary;
  }finally{this.store.releaseLease(lease);}
 }
}
