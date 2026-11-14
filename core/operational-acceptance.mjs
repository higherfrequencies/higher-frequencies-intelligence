/** Read-only tenant-scoped acceptance coverage; never equates stored API labels with an independently observed HTTP exchange. */
export function operationalAcceptance(user,{identity,store,flow,activation,scheduler,provider='beehive'}){
 identity.require(user,['super_user'],user?.tenant);
 if(!['beehive','datagovt','ticketmaster','christchurchnz'].includes(provider))throw Error('Unsupported acceptance provider');
 const tenant=user.tenant,db=store.db;
 const runs=db.prepare('SELECT id,method,status,started_at,counts,error FROM hf_discovery_runs WHERE tenant=? AND provider=? ORDER BY started_at DESC LIMIT 20').all(tenant,provider).map(r=>({id:r.id,method:r.method,status:r.status,startedAt:r.started_at,counts:JSON.parse(r.counts),failure:r.error||null}));
 const rows=db.prepare(`SELECT r.id reportId,r.subject,r.review_status managementSourceStatus,s.content_hash sourceHash,s.url sourceUrl,s.method sourceMethod,s.retrieved_at retrievedAt FROM hf_discovery_reports r JOIN hf_discovery_sources s ON r.source_id=s.id AND r.tenant=s.tenant WHERE r.tenant=? AND s.provider=? ORDER BY r.updated_at DESC LIMIT 100`).all(tenant,provider);
 const records=rows.map(r=>{
  const stages=db.prepare('SELECT stage,status FROM hf_rc7_processing WHERE tenant=? AND report_id=? AND source_hash=?').all(tenant,r.reportId,r.sourceHash);
  const states=Object.fromEntries(stages.map(s=>[s.stage,s.status]));
  const kv=db.prepare(`SELECT k.id knowledgeId,k.review_state reviewState,v.version,v.source_hash knowledgeHash FROM hf_education_knowledge k JOIN hf_education_versions v ON v.tenant=k.tenant AND v.knowledge_id=k.id AND v.version=k.current_version WHERE k.tenant=? AND k.report_id=?`).get(tenant,r.reportId);
  const briefs=db.prepare('SELECT id,version,review_status,knowledge_version FROM hf_collective_briefs WHERE tenant=? AND report_id=? ORDER BY version DESC LIMIT 5').all(tenant,r.reportId);
  const notices=db.prepare(`SELECT n.id,n.state,n.brief_id FROM hf_activation_notifications n JOIN hf_collective_briefs b ON b.id=n.brief_id AND b.tenant=n.tenant WHERE n.tenant=? AND b.report_id=?`).all(tenant,r.reportId);
  const specialists=briefs.length?db.prepare('SELECT DISTINCT department FROM hf_specialist_intelligence WHERE tenant=? AND report_id=? AND knowledge_version=?').all(tenant,r.reportId,briefs[0].knowledge_version).map(x=>x.department):[];
  const reviewedSameSource=!!kv&&kv.knowledgeHash===r.sourceHash;
  const latest=briefs[0]||null;
  const steps={evidenceStored:!!r.sourceHash&&!!r.sourceUrl,researchClassified:states.research==='completed',educationReviewed:reviewedSameSource&&states.education==='completed',marketingAssessed:reviewedSameSource&&specialists.includes('marketing'),financeAssessed:reviewedSameSource&&specialists.includes('finance'),collectiveDecisionDraft:!!latest&&reviewedSameSource,superUserNotification:!!latest&&notices.some(n=>n.brief_id===latest.id)};
  return {...r,steps,stages:states,knowledge:kv||null,latestBrief:latest,notification:notices.find(n=>n.brief_id===latest?.id)||null,remaining:Object.entries(steps).filter(([,v])=>!v).map(([k])=>k),approvalStatus:latest?.review_status||'education_review_pending',sourceUrlStatus:r.sourceUrl.startsWith('https://')?'attributed_https':'requires_review'};
 });
 const complete=records.filter(x=>Object.values(x.steps).every(Boolean));
 const due=scheduler.list(user).filter(x=>x.provider===provider);
 return {buildAcceptance:'local_read_only_evidence_coverage',provider,checkedAt:new Date().toISOString(),retrievalVerification:'Stored official_api method labels and run counts do not by themselves independently prove an unmocked HTTP response; confirm actual provider response in native Windows acceptance',liveEndToEndAccepted:false,counts:{runs:runs.length,storedReports:records.length,completeGovernedDrafts:complete.length,pendingEducation:records.filter(x=>!x.steps.educationReviewed).length,pendingManagement:records.filter(x=>x.latestBrief?.review_status==='pending_management').length},runs,records,schedules:due,ownerAction:'Review pending Education items, then review the linked strategic briefing separately; do not approve during a read-only check',changesPerformed:false};
}
