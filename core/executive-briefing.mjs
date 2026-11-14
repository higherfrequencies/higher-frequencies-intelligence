/** Read-only strategic intelligence constructed ONLY from final-approved immutable report snapshots. */
export class ExecutiveBriefing {
 constructor(store,intel){this.store=store;this.intel=intel}
 list(user){this.intel.require(user,['super_user','management','executive']);
  const rows=this.store.db.prepare(`SELECT o.id objective_id,o.title,r.id report_id,r.version,r.document,r.approved_at
   FROM hf_objectives o JOIN hf_intel_report_versions r ON r.tenant=o.tenant AND r.objective_id=o.id
   WHERE o.tenant=? AND o.status='approved' AND r.status='approved'
     AND r.version=(SELECT MAX(v.version) FROM hf_intel_report_versions v WHERE v.tenant=o.tenant AND v.objective_id=o.id AND v.status='approved')
   ORDER BY r.approved_at DESC,o.id LIMIT 100`).all(user.tenant);
  return {classification:'approved_internal_intelligence_only',source:'immutable_locally_approved_report_snapshots',liveMarketData:false,externalActions:0,
   reports:rows.map(row=>{
    const doc=JSON.parse(row.document);
    const collective=doc.departmentalAnalysis?.collective?.collective||{};
    const decision=doc.decision;
    return {objectiveId:row.objective_id,title:row.title,reportId:row.report_id,reportVersion:row.version,approvedAt:row.approved_at,
     departmentalConfidence:(doc.assessments||[]).map(a=>({department:a.department,confidence:a.confidence})),
     opportunities:(collective.opportunities||[]).map(x=>({description:x.description||'',department:x.department||null,evidenceIds:x.evidenceIds||[],classification:'supplied_hypothesis_not_verified_intent'})),
     risks:(collective.risks||[]).map(x=>({description:x.description||'',department:x.department||null,evidenceIds:x.evidenceIds||[]})),
     unresolvedConflicts:(collective.conflicts||[]).length,
     evidenceCount:(doc.evidence||[]).length,
     limitations:(doc.limitations||[]).slice(0,60),
     decision:decision?{question:decision.question||null,version:decision.version,reviewHistory:decision.reviews||[],topRatedByHuman:decision.comparison?.highestRated||null}:null,
     reportPath:`/api/intelligence/objectives/${row.objective_id}/reports`,
     buyerIntentVerified:false,independentVerificationPerformed:false};
   })};
 }
}
