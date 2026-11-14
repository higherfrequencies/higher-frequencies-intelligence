import {createHash, randomUUID} from 'node:crypto';
import {marketingAnalysis} from './commercial-analysis.mjs';

/** Versioned, offline source-based recommendations. Supplied assertions are not externally verified. */
export class MarketingRecommendations {
 constructor(store,intel){this.store=store;this.intel=intel;store.db.exec(`
 CREATE TABLE IF NOT EXISTS hf_marketing_recommendation_versions (
 id TEXT PRIMARY KEY,tenant TEXT NOT NULL,objective_id TEXT NOT NULL,version INTEGER NOT NULL,
 evidence_digest TEXT NOT NULL,document TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,
 UNIQUE(tenant,objective_id,version));
 CREATE TABLE IF NOT EXISTS hf_marketing_recommendation_reviews (
 id TEXT PRIMARY KEY,tenant TEXT NOT NULL,objective_id TEXT NOT NULL,version_id TEXT NOT NULL,
 decision TEXT NOT NULL,reason TEXT NOT NULL,reviewed_by TEXT NOT NULL,reviewed_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS hf_marketing_recommendations_scope ON hf_marketing_recommendation_versions(tenant,objective_id,version);
 `)}
 scope(user,id,write=false){this.intel.require(user,write?['management','super_user']:['management','super_user','specialist','department_admin','operator']);return write?this.intel.editable(user,id):this.intel.objective(user,id)}
 inputs(tenant,id){return this.store.db.prepare(`SELECT e.id,e.kind,e.source,e.content,e.verification,m.content_hash FROM hf_intel_evidence e LEFT JOIN hf_intel_evidence_meta m ON m.evidence_id=e.id AND m.tenant=e.tenant WHERE e.tenant=? AND e.objective_id=? ORDER BY e.id`).all(tenant,id)}
 generate(user,id){this.scope(user,id,true);return this.store.transaction(()=>{
  const inputs=this.inputs(user.tenant,id);
  const digest=createHash('sha256').update(JSON.stringify(inputs.map(e=>[e.id,e.content_hash||createHash('sha256').update(e.content).digest('hex')]))).digest('hex');
  const last=this.store.db.prepare('SELECT id,evidence_digest FROM hf_marketing_recommendation_versions WHERE tenant=? AND objective_id=? ORDER BY version DESC LIMIT 1').get(user.tenant,id);
  if(last?.evidence_digest===digest)throw Error('No new evidence since latest recommendation snapshot');
  const analysis=marketingAnalysis(inputs);
  const sourceIds=new Set(inputs.map(e=>e.id));
  for(const rec of analysis.recommendations)if(rec.evidenceIds.some(x=>!sourceIds.has(x)))throw Error('Broken recommendation evidence reference');
  const version=(this.store.db.prepare('SELECT MAX(version) version FROM hf_marketing_recommendation_versions WHERE tenant=? AND objective_id=?').get(user.tenant,id).version||0)+1;
  const document={version,classification:'supplied_evidence_hypotheses_not_verified_leads',sourceEvidence:inputs.map(e=>({id:e.id,source:e.source,verification:e.verification,contentHash:e.content_hash})),recommendations:analysis.recommendations,serviceFit:analysis.serviceFit,competitorComparisons:analysis.competitorComparisons,gaps:analysis.gaps,risks:analysis.risks,assumptions:analysis.assumptions,independentlyVerified:false,publicationAuthorised:false,outboundActions:0};
  const result={id:randomUUID(),version,evidenceDigest:digest,document,createdBy:user.id,createdAt:new Date().toISOString()};
  this.store.db.prepare('INSERT INTO hf_marketing_recommendation_versions VALUES(?,?,?,?,?,?,?,?)').run(result.id,user.tenant,id,version,digest,JSON.stringify(document),user.id,result.createdAt);
  this.intel.identity.audit(user.id,'marketing.recommendation.snapshot',{objectiveId:id,version,evidenceIds:inputs.map(e=>e.id),recommendations:document.recommendations.length});return result;
 })}
 history(user,id){this.scope(user,id);const versions=this.store.db.prepare('SELECT id,version,evidence_digest,document,created_by,created_at FROM hf_marketing_recommendation_versions WHERE tenant=? AND objective_id=? ORDER BY version DESC').all(user.tenant,id).map(row=>({id:row.id,version:row.version,evidenceDigest:row.evidence_digest,document:JSON.parse(row.document),createdBy:row.created_by,createdAt:row.created_at}));const reviews=this.store.db.prepare('SELECT id,version_id,decision,reason,reviewed_by,reviewed_at FROM hf_marketing_recommendation_reviews WHERE tenant=? AND objective_id=? ORDER BY reviewed_at,id').all(user.tenant,id);return {versions,reviews,publicationAuthorised:false,outboundActions:0}}
 review(user,id,{versionId,decision,reason}){this.scope(user,id,true);if(typeof versionId!=='string'||!['reviewed','needs_more_evidence','rejected'].includes(decision)||typeof reason!=='string'||reason.trim().length<8||reason.length>1000)throw Error('Invalid recommendation review');return this.store.transaction(()=>{
  const current=this.store.db.prepare('SELECT id,evidence_digest FROM hf_marketing_recommendation_versions WHERE tenant=? AND objective_id=? ORDER BY version DESC LIMIT 1').get(user.tenant,id);
  if(!current||current.id!==versionId)throw Error('Only latest recommendation snapshot may be reviewed');
  const inputs=this.inputs(user.tenant,id),digest=createHash('sha256').update(JSON.stringify(inputs.map(e=>[e.id,e.content_hash||createHash('sha256').update(e.content).digest('hex')]))).digest('hex');
  if(digest!==current.evidence_digest)throw Error('Recommendation snapshot is stale; regenerate after evidence changes');
  const previous=this.store.db.prepare('SELECT decision FROM hf_marketing_recommendation_reviews WHERE tenant=? AND objective_id=? AND version_id=? ORDER BY reviewed_at DESC,id DESC LIMIT 1').get(user.tenant,id,versionId);
  if(previous?.decision===decision)throw Error('Duplicate recommendation review');
  const record={id:randomUUID(),versionId,decision,reason:reason.trim(),reviewedBy:user.id,reviewedAt:new Date().toISOString(),publicationAuthorised:false,outboundActions:0};
  this.store.db.prepare('INSERT INTO hf_marketing_recommendation_reviews VALUES(?,?,?,?,?,?,?,?)').run(record.id,user.tenant,id,versionId,decision,record.reason,user.id,record.reviewedAt);
  this.intel.identity.audit(user.id,'marketing.recommendation.review',{objectiveId:id,versionId,decision});return record;
 })}
}
