/** Evidence-bound improvement proposals. No policy changes or automatic deployment. */
import {randomUUID} from 'node:crypto';
export function evaluateWorkflowOutcomes(outcomes=[]){
 if(!Array.isArray(outcomes))throw Error('Outcomes array required');
 const valid=outcomes.filter(o=>o&&o.completed===true&&Number.isFinite(o.durationMs)&&o.durationMs>=0);
 const failures=outcomes.filter(o=>o?.failed===true).length;
 const averageMs=valid.length?Math.round(valid.reduce((n,o)=>n+o.durationMs,0)/valid.length):null;
 return {observations:outcomes.length,completed:valid.length,failures,averageDurationMs:averageMs,insufficientEvidence:valid.length<5};
}
export class LearningIntelligence{
 constructor(store){this.store=store;}
 propose(outcomes,{actor='system'}={}){
  const metrics=evaluateWorkflowOutcomes(outcomes);
  const proposal={id:randomUUID(),metrics,recommendation:metrics.insufficientEvidence?'Collect more verified outcomes before optimising':metrics.failures>0?'Investigate recorded failures and review workflow capacity':'Review measured processing times for potential improvements',status:'pending-management-review',autoApply:false,actor,at:new Date().toISOString()};
  this.store.transaction(db=>db.put('learning-proposals',proposal.id,proposal));return proposal;
 }
}
