import {randomUUID, createHash} from 'node:crypto';
import {financeAnalysis} from './commercial-analysis.mjs';

/** Reviewed supplied financial scenarios; never writes approved budgets or forecasts. */
export class FinanceWorkspace {
 constructor(store,intel){this.store=store;this.intel=intel;store.db.exec(`CREATE TABLE IF NOT EXISTS hf_finance_reviews (
 id TEXT PRIMARY KEY,tenant TEXT NOT NULL,objective_id TEXT NOT NULL,evidence_id TEXT NOT NULL,
 input_hash TEXT NOT NULL,calculation TEXT NOT NULL,decision TEXT NOT NULL,reason TEXT NOT NULL,
 reviewed_by TEXT NOT NULL,reviewed_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS hf_finance_reviews_scope ON hf_finance_reviews(tenant,objective_id,evidence_id);
 CREATE TABLE IF NOT EXISTS hf_finance_comparisons (
 id TEXT PRIMARY KEY,tenant TEXT NOT NULL,objective_id TEXT NOT NULL,version INTEGER NOT NULL,
 first_evidence_id TEXT NOT NULL,second_evidence_id TEXT NOT NULL,first_input_hash TEXT NOT NULL,
 second_input_hash TEXT NOT NULL,analysis TEXT NOT NULL,prepared_by TEXT NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(tenant,objective_id,version));
 CREATE TABLE IF NOT EXISTS hf_finance_comparison_reviews (
 id TEXT PRIMARY KEY,tenant TEXT NOT NULL,objective_id TEXT NOT NULL,comparison_id TEXT NOT NULL,
 decision TEXT NOT NULL,reason TEXT NOT NULL,reviewed_by TEXT NOT NULL,reviewed_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS hf_finance_comparison_scope ON hf_finance_comparisons(tenant,objective_id,version);`)}
 scope(user,id,write=false){this.intel.require(user,write?['management','super_user']:['management','super_user','specialist','department_admin','operator']);return write?this.intel.editable(user,id):this.intel.objective(user,id)}
 scenarios(user,id){this.scope(user,id);const evidence=this.store.db.prepare('SELECT id,kind,source,content,verification FROM hf_intel_evidence WHERE tenant=? AND objective_id=? ORDER BY created_at,id').all(user.tenant,id);const analysis=financeAnalysis(evidence);return {...analysis,classification:'supplied_financial_scenarios_only',approvedFinancialRecordsModified:false,sourceEvidenceCount:evidence.filter(x=>x.kind==='cost').length,history:this.history(user,id)}}
 review(user,id,{evidenceId,decision,reason}){this.scope(user,id,true);
  if(typeof evidenceId!=='string'||!['assumptions_reviewed','needs_more_evidence','rejected'].includes(decision)||typeof reason!=='string'||reason.trim().length<8||reason.length>1000)throw Error('Invalid financial scenario review');
  return this.store.transaction(()=>{
   const evidence=this.store.db.prepare('SELECT id,kind,source,content,verification FROM hf_intel_evidence WHERE tenant=? AND objective_id=? AND id=?').get(user.tenant,id,evidenceId);
   if(!evidence||evidence.kind!=='cost')throw Error('Financial scenario evidence not found');
   const analysis=financeAnalysis([evidence]);const scenario=analysis.scenarios.find(x=>x.evidenceId===evidenceId);
   if(!scenario)throw Error('Validated financial scenario required; correct supplied inputs first');
   const inputHash=createHash('sha256').update(evidence.content).digest('hex');
   const prior=this.store.db.prepare('SELECT decision FROM hf_finance_reviews WHERE tenant=? AND objective_id=? AND evidence_id=? ORDER BY reviewed_at DESC,id DESC LIMIT 1').get(user.tenant,id,evidenceId);
   if(prior?.decision===decision)throw Error('Duplicate financial scenario review');
   const result={id:randomUUID(),evidenceId,inputHash,calculation:scenario,decision,reason:reason.trim(),reviewedBy:user.id,reviewedAt:new Date().toISOString(),classification:'manual_assumption_review_not_financial_forecast_approval',approvedFinancialRecordsModified:false,outboundActions:0};
   this.store.db.prepare('INSERT INTO hf_finance_reviews VALUES(?,?,?,?,?,?,?,?,?,?)').run(result.id,user.tenant,id,evidenceId,inputHash,JSON.stringify(scenario),decision,result.reason,user.id,result.reviewedAt);
   this.intel.identity.audit(user.id,'finance.scenario.review',{objectiveId:id,evidenceId,decision,inputHash});return result;
  });
 }
 history(user,id){this.scope(user,id);return this.store.db.prepare('SELECT id,evidence_id,input_hash,calculation,decision,reason,reviewed_by,reviewed_at FROM hf_finance_reviews WHERE tenant=? AND objective_id=? ORDER BY reviewed_at,id').all(user.tenant,id).map(x=>({...x,calculation:JSON.parse(x.calculation),approvedFinancialRecordsModified:false}));}
}

/** Compare only explicit validated scenarios from the same currency and month. No forecasts are altered. */
FinanceWorkspace.prototype.compare = function(user,id,{firstEvidenceId,secondEvidenceId}) {
 this.scope(user,id,true);
 if(typeof firstEvidenceId!=='string'||typeof secondEvidenceId!=='string'||firstEvidenceId===secondEvidenceId)throw Error('Two distinct scenario evidence IDs required');
 return this.store.transaction(()=>{
  const rows=this.store.db.prepare("SELECT id,kind,source,content,verification FROM hf_intel_evidence WHERE tenant=? AND objective_id=? AND id IN (?,?)").all(user.tenant,id,firstEvidenceId,secondEvidenceId);
  if(rows.length!==2||rows.some(x=>x.kind!=='cost'))throw Error('Both financial evidence records required within objective');
  const analysis=financeAnalysis(rows);
  if(analysis.rejected.length||analysis.scenarios.length!==2)throw Error('Both scenarios must contain validated supplied inputs');
  const a=analysis.scenarios.find(x=>x.evidenceId===firstEvidenceId),b=analysis.scenarios.find(x=>x.evidenceId===secondEvidenceId);
  if(a.currency!==b.currency||a.period!==b.period)throw Error('Scenario comparison requires identical month and currency; no conversion inferred');
  const result={firstEvidenceId,secondEvidenceId,first:a,second:b,currency:a.currency,period:a.period,
   revenueDelta:Number((b.revenue-a.revenue).toFixed(8)),costDelta:Number((b.cost-a.cost).toFixed(8)),
   differenceDelta:Number((b.difference-a.difference).toFixed(8)),
   marginDelta:a.marginPercent===null||b.marginPercent===null?null:Number((b.marginPercent-a.marginPercent).toFixed(4)),
   assumptions:['Both inputs are supplied evidence, not independently verified revenue or approved forecasts'],
   limitations:['No predicted market performance, tax liability or currency conversion inferred'],
   sourceClassification:'supplied_financial_evidence_only',forecastModified:false,externalActions:0};
  const evidence=new Map(rows.map(x=>[x.id,x]));
  const version=1+(this.store.db.prepare('SELECT COALESCE(MAX(version),0) v FROM hf_finance_comparisons WHERE tenant=? AND objective_id=?').get(user.tenant,id).v);
  const record={id:randomUUID(),version,...result,createdAt:new Date().toISOString()};
  this.store.db.prepare('INSERT INTO hf_finance_comparisons VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(record.id,user.tenant,id,version,firstEvidenceId,secondEvidenceId,
   createHash('sha256').update(evidence.get(firstEvidenceId).content).digest('hex'),
   createHash('sha256').update(evidence.get(secondEvidenceId).content).digest('hex'),JSON.stringify(result),user.id,record.createdAt);
  this.intel.identity.audit(user.id,'finance.comparison.create',{objectiveId:id,version,evidenceIds:[firstEvidenceId,secondEvidenceId]});return record;
 });
};
FinanceWorkspace.prototype.comparisonHistory = function(user,id){this.scope(user,id);return this.store.db.prepare('SELECT * FROM hf_finance_comparisons WHERE tenant=? AND objective_id=? ORDER BY version').all(user.tenant,id).map(row=>({id:row.id,version:row.version,...JSON.parse(row.analysis),inputHashes:[row.first_input_hash,row.second_input_hash],createdBy:row.prepared_by,createdAt:row.created_at,reviews:this.store.db.prepare('SELECT id,decision,reason,reviewed_by,reviewed_at FROM hf_finance_comparison_reviews WHERE tenant=? AND objective_id=? AND comparison_id=? ORDER BY reviewed_at,id').all(user.tenant,id,row.id)}))};
FinanceWorkspace.prototype.reviewComparison = function(user,id,{comparisonId,decision,reason}){
 this.scope(user,id,true);this.intel.require(user,['management','super_user']);
 if(typeof comparisonId!=='string'||!['assumptions_reviewed','needs_more_evidence','rejected'].includes(decision)||typeof reason!=='string'||reason.trim().length<8||reason.length>1000)throw Error('Invalid comparison review');
 return this.store.transaction(()=>{
  const latest=this.store.db.prepare('SELECT id FROM hf_finance_comparisons WHERE tenant=? AND objective_id=? ORDER BY version DESC LIMIT 1').get(user.tenant,id);
  if(!latest||latest.id!==comparisonId)throw Error('Only latest financial comparison may be reviewed');
  const previous=this.store.db.prepare('SELECT decision FROM hf_finance_comparison_reviews WHERE tenant=? AND objective_id=? AND comparison_id=? ORDER BY reviewed_at DESC,id DESC LIMIT 1').get(user.tenant,id,comparisonId);
  if(previous?.decision===decision)throw Error('Duplicate comparison review');
  const result={id:randomUUID(),comparisonId,decision,reason:reason.trim(),reviewedBy:user.id,reviewedAt:new Date().toISOString(),forecastModified:false};
  this.store.db.prepare('INSERT INTO hf_finance_comparison_reviews VALUES(?,?,?,?,?,?,?,?)').run(result.id,user.tenant,id,comparisonId,decision,result.reason,user.id,result.reviewedAt);
  this.intel.identity.audit(user.id,'finance.comparison.review',{objectiveId:id,comparisonId,decision});return result;
 });
};
