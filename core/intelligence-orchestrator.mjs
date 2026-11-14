/** Composes existing advisory layers. Does not approve or dispatch work. */
import {InformationIntelligence} from './information-intelligence.mjs';
import {WorkflowIntelligence} from './workflow-intelligence.mjs';
import {assessPriority} from './decision-intelligence.mjs';
import {coordinateFinding} from './ecosystem-coordinator.mjs';
export class IntelligenceOrchestrator{
 constructor(store){this.information=new InformationIntelligence(store);this.workflow=new WorkflowIntelligence(store);this.store=store;}
 assess(record,{capacity=1,now=Date.now()}={}){
  const classification=this.information.ingest(record,{now});
  const decision=classification.destination==='research'?assessPriority({...record,capacity:{available:capacity}}):null;
  const coordination=coordinateFinding(record,{capacity,now});
  const workflow=this.workflow.plan({classification,decision,capacity});
  this.store.transaction(db=>db.put('intelligence-assessments',record.id,{classification,decision,coordination,workflow}));
  return {classification,decision,coordination,workflow};
 }
}
