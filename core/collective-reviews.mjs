import {createHash,randomUUID} from 'node:crypto';
/** Human review of persisted Collective synthesis. Reviews never assert independent verification. */
export class CollectiveReviews {
 constructor(store,intel){this.store=store;this.intel=intel;store.db.exec(`CREATE TABLE IF NOT EXISTS hf_collective_reviews (
 id TEXT PRIMARY KEY,tenant TEXT NOT NULL,objective_id TEXT NOT NULL,analysis_hash TEXT NOT NULL,
 decision TEXT NOT NULL,reason TEXT NOT NULL,unresolved_risks TEXT NOT NULL,reviewed_by TEXT NOT NULL,reviewed_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS hf_collective_review_scope ON hf_collective_reviews(tenant,objective_id,reviewed_at);`)}
 current(user,id){this.intel.objective(user,id);const row=this.store.db.prepare("SELECT id,analysis,created_at FROM hf_intel_analysis WHERE tenant=? AND objective_id=? AND department='collective' ORDER BY id DESC LIMIT 1").get(user.tenant,id);if(!row)return null;
  const analysis=JSON.parse(row.analysis),hash=createHash('sha256').update(row.analysis).digest('hex');
  const currentEvidence=this.store.db.prepare('SELECT id FROM hf_intel_evidence WHERE tenant=? AND objective_id=? ORDER BY id').all(user.tenant,id).map(r=>r.id).sort();
  const cited=[...new Set(analysis.evidenceIds||[])].sort(),stale=currentEvidence.length!==cited.length||cited.some((id,i)=>id!==currentEvidence[i]);
  const latestDepartments=this.store.db.prepare("SELECT id,department,analysis FROM hf_intel_analysis WHERE tenant=? AND objective_id=? AND department IN ('research','marketing','finance') ORDER BY id DESC").all(user.tenant,id);const latest=new Map();for(const d of latestDepartments)if(!latest.has(d.department))latest.set(d.department,d);
  const departmentStale=['research','marketing','finance'].filter(dep=>{
   const row=latest.get(dep);if(!row)return true;const a=JSON.parse(row.analysis);if(JSON.stringify([...(a.evidenceIds||[])].sort())!==JSON.stringify(currentEvidence))return true;
   const bound=analysis.collective?.inputAssessments?.[dep];
   return !bound||`${row.id}:${createHash('sha256').update(row.analysis).digest('hex')}`!==bound;
  });
  return {id:row.id,analysisHash:hash,analysis,createdAt:row.created_at,stale:stale||departmentStale.length>0,departmentStale,independentVerificationPerformed:false};
 }
 history(user,id){this.intel.objective(user,id);const now=this.current(user,id);return {current:now,reviews:this.store.db.prepare('SELECT id,analysis_hash,decision,reason,unresolved_risks,reviewed_by,reviewed_at FROM hf_collective_reviews WHERE tenant=? AND objective_id=? ORDER BY reviewed_at,id').all(user.tenant,id).map(r=>({...r,unresolvedRisks:JSON.parse(r.unresolved_risks),current:!!now&&r.analysis_hash===now.analysisHash&&!now.stale}))}}
 review(user,id,{decision,reason,acknowledgeLimitations=false}){
  this.intel.require(user,['management','super_user']);this.intel.editable(user,id);
  if(!['reviewed_with_limitations','needs_more_evidence','rejected'].includes(decision)||typeof reason!=='string'||reason.trim().length<12||reason.length>1600||typeof acknowledgeLimitations!=='boolean')throw Error('Invalid collective review');
  return this.store.transaction(()=>{
   const current=this.current(user,id);if(!current)throw Error('Collective synthesis required');
   if(current.stale)throw Error('Re-assess Research, Marketing, Finance and Collective after evidence revisions');
   const analysis=current.analysis.collective||{},gaps=[...(analysis.gaps||[]),...(current.analysis.limitations||[])],conflicts=analysis.conflicts||[];
   if(decision==='reviewed_with_limitations'&&(gaps.length||conflicts.length)&&!acknowledgeLimitations)throw Error('Explicit acknowledgement of Collective gaps and conflicts required');
   const prev=this.store.db.prepare('SELECT decision FROM hf_collective_reviews WHERE tenant=? AND objective_id=? AND analysis_hash=? ORDER BY reviewed_at DESC,id DESC LIMIT 1').get(user.tenant,id,current.analysisHash);
   if(prev?.decision===decision)throw Error('Duplicate Collective review');
   const risks=[...new Set([...gaps,...conflicts.map(c=>`Unresolved conflict: ${c.subject||'unspecified'} / ${c.predicate||'unspecified'}`)])];
   const out={id:randomUUID(),analysisHash:current.analysisHash,decision,reason:reason.trim(),unresolvedRisks:risks,reviewedBy:user.id,reviewedAt:new Date().toISOString(),independentVerificationPerformed:false,externalActions:0};
   this.store.db.prepare('INSERT INTO hf_collective_reviews VALUES(?,?,?,?,?,?,?,?,?)').run(out.id,user.tenant,id,current.analysisHash,decision,out.reason,JSON.stringify(risks),user.id,out.reviewedAt);
   this.intel.identity.audit(user.id,'collective.synthesis.review',{objectiveId:id,reviewId:out.id,decision,analysisHash:current.analysisHash});return out;
  });
 }
}
