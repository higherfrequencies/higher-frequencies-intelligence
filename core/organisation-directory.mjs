import {randomUUID} from 'node:crypto';
import {digest} from './evidence-analysis.mjs';
import {parseNzbnCsv} from './nzbn-csv.mjs';

/** Local, evidence-linked organisation observations. No contact enrichment, prospect intent or outbound actions. */
export class OrganisationDirectory {
 constructor(store,intel){this.store=store;this.intel=intel;store.db.exec(`
 CREATE TABLE IF NOT EXISTS hf_organisation_directory (
 id TEXT PRIMARY KEY, tenant TEXT NOT NULL, name TEXT NOT NULL, name_key TEXT NOT NULL,
 sector TEXT, locality TEXT, website TEXT, classification TEXT NOT NULL,
 created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(tenant,name_key));
 CREATE TABLE IF NOT EXISTS hf_organisation_observations (
 id TEXT PRIMARY KEY, tenant TEXT NOT NULL, organisation_id TEXT NOT NULL, objective_id TEXT NOT NULL,
 evidence_id TEXT NOT NULL, observation TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(tenant,organisation_id,evidence_id));
 CREATE TABLE IF NOT EXISTS hf_organisation_outcomes (
 id TEXT PRIMARY KEY,tenant TEXT NOT NULL,organisation_id TEXT NOT NULL,objective_id TEXT NOT NULL,
 opportunity_id TEXT,kind TEXT NOT NULL,description TEXT NOT NULL,evidence_id TEXT,
 recorded_by TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE TABLE IF NOT EXISTS hf_organisation_external_ids (
 tenant TEXT NOT NULL,organisation_id TEXT NOT NULL,provider TEXT NOT NULL,external_id TEXT NOT NULL,
 PRIMARY KEY(tenant,provider,external_id));
 CREATE INDEX IF NOT EXISTS hf_org_observations_by_objective ON hf_organisation_observations(tenant,objective_id);
 CREATE INDEX IF NOT EXISTS hf_org_outcomes_by_objective ON hf_organisation_outcomes(tenant,objective_id);
 CREATE TABLE IF NOT EXISTS hf_organisation_assessments(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,objective_id TEXT NOT NULL,organisation_id TEXT NOT NULL,version INTEGER NOT NULL,assessment_json TEXT NOT NULL,created_by TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(tenant,objective_id,organisation_id,version));
 CREATE TABLE IF NOT EXISTS hf_organisation_assessment_reviews(id TEXT PRIMARY KEY,tenant TEXT NOT NULL,objective_id TEXT NOT NULL,organisation_id TEXT NOT NULL,assessment_id TEXT NOT NULL,decision TEXT NOT NULL,reason TEXT NOT NULL,reviewer TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS hf_org_assessment_scope ON hf_organisation_assessments(tenant,objective_id,organisation_id,version);
 CREATE TABLE IF NOT EXISTS hf_organisation_research_classifications(
 id TEXT PRIMARY KEY,tenant TEXT NOT NULL,objective_id TEXT NOT NULL,organisation_id TEXT NOT NULL,
 evidence_id TEXT NOT NULL,segment TEXT NOT NULL,size_band TEXT NOT NULL,
 reason TEXT NOT NULL,recorded_by TEXT NOT NULL,created_at TEXT NOT NULL);
 CREATE INDEX IF NOT EXISTS hf_org_classification_scope ON hf_organisation_research_classifications(tenant,objective_id,created_at);
 `)}
 scope(user,id,write=false){this.intel.require(user,write?['management','super_user','specialist','department_admin']:['management','super_user','specialist','department_admin','operator']);return write?this.intel.editable(user,id):this.intel.objective(user,id)}
 evidence(tenant,objectiveId,evidenceId){const e=this.store.db.prepare('SELECT id,source FROM hf_intel_evidence WHERE id=? AND tenant=? AND objective_id=?').get(evidenceId,tenant,objectiveId);if(!e)throw Error('Evidence outside objective');return e}
 add(user,objectiveId,{name,sector='',locality='',website='',evidenceId,observation}){
  this.scope(user,objectiveId,true);if(typeof name!=='string'||name.trim().length<2||name.length>180||typeof sector!=='string'||sector.length>100||typeof locality!=='string'||locality.length>150||typeof observation!=='string'||observation.trim().length<10||observation.length>1500||typeof website!=='string'||website.length>300)throw Error('Invalid organisation observation');
  if(website){let u;try{u=new URL(website)}catch{throw Error('Invalid source website')};if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('Invalid source website')}
  this.evidence(user.tenant,objectiveId,evidenceId);const key=name.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-NZ');const now=new Date().toISOString();
  return this.store.transaction(()=>{
   let org=this.store.db.prepare('SELECT id,name FROM hf_organisation_directory WHERE tenant=? AND name_key=?').get(user.tenant,key);const duplicate=!!org;
   if(!org){org={id:randomUUID(),name:name.trim()};this.store.db.prepare('INSERT INTO hf_organisation_directory VALUES(?,?,?,?,?,?,?,?,?,?)').run(org.id,user.tenant,org.name,key,sector.trim()||null,locality.trim()||null,website||null,'supplied_source_observation',user.id,now)}
   const existing=this.store.db.prepare('SELECT id FROM hf_organisation_observations WHERE tenant=? AND organisation_id=? AND evidence_id=?').get(user.tenant,org.id,evidenceId);
   if(!existing)this.store.db.prepare('INSERT INTO hf_organisation_observations VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),user.tenant,org.id,objectiveId,evidenceId,observation.trim(),user.id,now);
   this.intel.identity.audit(user.id,'organisation.observation',{organisationId:org.id,objectiveId,evidenceId,duplicate});
   return {id:org.id,name:org.name,duplicate,observationDuplicate:!!existing,verification:'source_supplied_not_independently_verified',intentVerified:false};
  });
 }
 /** Import a bounded local NZBN/Companies Office public export. Caller must have authorised access.
     The extract is not independently verified and nothing is fetched or contacted. */
 importNzbnCsv(user,objectiveId,{csv,sourceUrl,snapshotDate,accessConfirmed}){
  this.scope(user,objectiveId,true);
  if(accessConfirmed!==true)throw Error('Confirm lawful access and permitted use of this public export');
  if(typeof sourceUrl!=='string'||sourceUrl.length>250)throw Error('Source URL required');
  let url;try{url=new URL(sourceUrl)}catch{throw Error('Invalid source URL')};if(url.protocol!=='https:'||url.username||url.password)throw Error('HTTPS source URL required');
  if(typeof snapshotDate!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(snapshotDate)||Number.isNaN(Date.parse(snapshotDate))||new Date(snapshotDate).toISOString().slice(0,10)!==snapshotDate)throw Error('Valid extract snapshot date required');
  const records=parseNzbnCsv(csv);const unique=new Set();for(const row of records){if(unique.has(row.nzbn))throw Error('Duplicate NZBN within file');unique.add(row.nzbn)}
  const now=new Date().toISOString();
  return this.store.transaction(()=>{
   const imported=[];
   for(const row of records){
    const content=JSON.stringify({name:row.name,nzbn:row.nzbn,entityStatus:row.status,sector:row.sector,snapshotDate,sourceUrl,classification:'user_authorised_public_export',independentlyVerified:false,buyingIntentVerified:false});
    const hash=digest(content),found=this.store.db.prepare('SELECT e.id FROM hf_intel_evidence e JOIN hf_intel_evidence_meta m ON m.evidence_id=e.id WHERE e.tenant=? AND e.objective_id=? AND m.content_hash=?').get(user.tenant,objectiveId,hash);
    const evidenceId=found?.id||randomUUID();
    if(!found){this.store.db.prepare('INSERT INTO hf_intel_evidence VALUES(?,?,?,?,?,?,?,?,?)').run(evidenceId,user.tenant,objectiveId,'organisation',sourceUrl,content,'unverified',user.id,now);this.store.db.prepare('INSERT INTO hf_intel_evidence_meta VALUES(?,?,?,?,?)').run(evidenceId,user.tenant,hash,'authorised_nzbn_csv',now)}
    let org=this.store.db.prepare('SELECT organisation_id AS id FROM hf_organisation_external_ids WHERE tenant=? AND provider=? AND external_id=?').get(user.tenant,'nzbn',row.nzbn);
    const nameKey=row.name.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-NZ');
    if(!org)org=this.store.db.prepare('SELECT id FROM hf_organisation_directory WHERE tenant=? AND name_key=?').get(user.tenant,nameKey);
    if(org){const existingNzbn=this.store.db.prepare('SELECT external_id FROM hf_organisation_external_ids WHERE tenant=? AND organisation_id=? AND provider=?').get(user.tenant,org.id,'nzbn');if(existingNzbn&&existingNzbn.external_id!==row.nzbn)throw Error('Conflicting NZBN identity for organisation name')}
    if(!org){org={id:randomUUID()};this.store.db.prepare('INSERT INTO hf_organisation_directory VALUES(?,?,?,?,?,?,?,?,?,?)').run(org.id,user.tenant,row.name,nameKey,row.sector||null,null,null,'user_supplied_public_register_extract',user.id,now)}
    this.store.db.prepare('INSERT OR IGNORE INTO hf_organisation_external_ids VALUES(?,?,?,?)').run(user.tenant,org.id,'nzbn',row.nzbn);
    const previous=this.store.db.prepare('SELECT id FROM hf_organisation_observations WHERE tenant=? AND organisation_id=? AND evidence_id=?').get(user.tenant,org.id,evidenceId);
    if(!previous)this.store.db.prepare('INSERT INTO hf_organisation_observations VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),user.tenant,org.id,objectiveId,evidenceId,`User-authorised NZBN CSV export, snapshot ${snapshotDate}; entity status supplied as ${row.status}; not independently verified`,user.id,now);
    imported.push({organisationId:org.id,evidenceId,nzbn:row.nzbn,duplicate:!!found,externalAction:false,independentlyVerified:false,buyingIntentVerified:false});
   }
   this.intel.identity.audit(user.id,'organisation.nzbn_csv_import',{objectiveId,snapshotDate,sourceUrl,records:imported.length});
   return {records:imported,classification:'user_authorised_cached_public_export',independentVerification:false,externalRequests:0,outboundActions:0};
  });
 }
 /** Import explicitly structured organisation evidence already recorded in the objective.
     No web requests or identity inference; all rows validated before transactional writes. */
 importEvidence(user,objectiveId,{evidenceIds}){
  this.scope(user,objectiveId,true);
  if(!Array.isArray(evidenceIds)||!evidenceIds.length||evidenceIds.length>50||new Set(evidenceIds).size!==evidenceIds.length||evidenceIds.some(id=>typeof id!=='string'))throw Error('Provide 1–50 unique evidence IDs');
  const records=evidenceIds.map(evidenceId=>{
   const e=this.store.db.prepare('SELECT id,kind,source,content FROM hf_intel_evidence WHERE id=? AND tenant=? AND objective_id=?').get(evidenceId,user.tenant,objectiveId);
   if(!e||e.kind!=='organisation')throw Error('Organisation evidence required within objective');
   let supplied;try{supplied=JSON.parse(e.content)}catch{throw Error('Structured organisation JSON required')}
   if(!supplied||typeof supplied!=='object'||Array.isArray(supplied)||typeof supplied.name!=='string'||supplied.name.trim().length<2||supplied.name.length>180)throw Error('Explicit organisation name required');
   for(const key of ['sector','locality','website'])if(supplied[key]!==undefined&&typeof supplied[key]!=='string')throw Error('Invalid organisation field');
   const sector=supplied.sector||'',locality=supplied.locality||'',website=supplied.website||'';
   if(sector.length>100||locality.length>150||website.length>300)throw Error('Invalid organisation field');
   if(website){let u;try{u=new URL(website)}catch{throw Error('Invalid source website')};if(!['https:','http:'].includes(u.protocol)||u.username||u.password)throw Error('Invalid source website')}
   return {evidenceId,source:e.source,name:supplied.name.trim(),sector,locality,website,observation:`Structured organisation record from source: ${e.source}`.slice(0,1500)};
  });
  return this.store.transaction(()=>{
   const now=new Date().toISOString(),results=[];
   for(const item of records){
    const key=item.name.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-NZ');
    let org=this.store.db.prepare('SELECT id FROM hf_organisation_directory WHERE tenant=? AND name_key=?').get(user.tenant,key),duplicate=!!org;
    if(org){const existingNzbn=this.store.db.prepare('SELECT external_id FROM hf_organisation_external_ids WHERE tenant=? AND organisation_id=? AND provider=?').get(user.tenant,org.id,'nzbn');if(existingNzbn&&existingNzbn.external_id!==row.nzbn)throw Error('Conflicting NZBN identity for organisation name')}
    if(!org){org={id:randomUUID()};this.store.db.prepare('INSERT INTO hf_organisation_directory VALUES(?,?,?,?,?,?,?,?,?,?)').run(org.id,user.tenant,item.name,key,item.sector||null,item.locality||null,item.website||null,'supplied_source_observation',user.id,now)}
    const existing=this.store.db.prepare('SELECT id FROM hf_organisation_observations WHERE tenant=? AND organisation_id=? AND evidence_id=?').get(user.tenant,org.id,item.evidenceId);
    if(!existing)this.store.db.prepare('INSERT INTO hf_organisation_observations VALUES(?,?,?,?,?,?,?,?)').run(randomUUID(),user.tenant,org.id,objectiveId,item.evidenceId,item.observation,user.id,now);
    results.push({id:org.id,evidenceId:item.evidenceId,duplicate,observationDuplicate:!!existing,independentlyVerified:false,intentVerified:false});
   }
   this.intel.identity.audit(user.id,'organisation.evidence_import',{objectiveId,records:results.length,sourceEvidenceIds:evidenceIds});
   return {records:results,source:'objective_evidence_only',externalRequests:0,outboundActions:0};
  });
 }
 list(user,objectiveId,{q=''}={}){this.scope(user,objectiveId);if(typeof q!=='string'||q.length>100)throw Error('Invalid search');const terms=`%${q.toLowerCase().replace(/[\\%_]/g,'\\$&')}%`;
  return this.store.db.prepare(`SELECT d.id,d.name,d.sector,d.locality,d.website,d.classification,o.evidence_id,o.observation,o.created_at
   FROM hf_organisation_directory d JOIN hf_organisation_observations o ON o.organisation_id=d.id AND o.tenant=d.tenant
   WHERE d.tenant=? AND o.objective_id=? AND LOWER(d.name) LIKE ? ESCAPE '\\' ORDER BY d.name,o.created_at`).all(user.tenant,objectiveId,terms).map(x=>({...x,independentlyVerified:false,intentVerified:false}));
 }
 /** One organisation, one objective: source-backed observations and manually recorded progress.
     A registry entry is never a verified prospect or proof of demand. */
 profile(user,objectiveId,organisationId){
  this.scope(user,objectiveId);
  const profile=this.store.db.prepare(`SELECT d.id,d.name,d.sector,d.locality,d.website,d.classification
    FROM hf_organisation_directory d JOIN hf_organisation_observations o ON o.organisation_id=d.id AND o.tenant=d.tenant
    WHERE d.tenant=? AND d.id=? AND o.objective_id=? LIMIT 1`).get(user.tenant,organisationId,objectiveId);
  if(!profile)throw Error('Not found');
  const observations=this.store.db.prepare(`SELECT o.id,o.observation,o.evidence_id,o.created_by,o.created_at,e.source,e.kind,e.verification,m.content_hash,m.import_format
    FROM hf_organisation_observations o JOIN hf_intel_evidence e ON e.id=o.evidence_id AND e.tenant=o.tenant AND e.objective_id=o.objective_id
    LEFT JOIN hf_intel_evidence_meta m ON m.evidence_id=e.id AND m.tenant=e.tenant
    WHERE o.tenant=? AND o.objective_id=? AND o.organisation_id=? ORDER BY o.created_at,o.id`).all(user.tenant,objectiveId,organisationId);
  const opportunities=this.store.db.prepare(`SELECT id,organisation,service,assessment,status,evidence_ids,created_at FROM hf_marketing_opportunities
    WHERE tenant=? AND objective_id=? AND organisation_id=? ORDER BY created_at,id`).all(user.tenant,objectiveId,organisationId).map(r=>({...r,evidenceIds:JSON.parse(r.evidence_ids),intentVerified:false}));
  const outcomes=this.store.db.prepare(`SELECT id,opportunity_id,kind,description,evidence_id,recorded_by,created_at
    FROM hf_organisation_outcomes WHERE tenant=? AND objective_id=? AND organisation_id=? ORDER BY created_at,id`).all(user.tenant,objectiveId,organisationId);
  const externalIds=this.store.db.prepare('SELECT provider,external_id FROM hf_organisation_external_ids WHERE tenant=? AND organisation_id=?').all(user.tenant,organisationId);
  return {...profile,observations,opportunities,outcomes,externalIds,verification:'supplied_sources_only',independentlyVerified:false,buyingIntentVerified:false,automaticOutreach:false};
 }
 /** Append-only, sourced human categorisation for the original quarterly research targets. */
 classify(user,objectiveId,organisationId,{segment,sizeBand,evidenceId,reason}){
  this.intel.require(user,['management','super_user']);this.intel.editable(user,objectiveId);
  if(!['Experience','Services','Products'].includes(segment)||!['Small','Medium','Large'].includes(sizeBand)||typeof reason!=='string'||reason.trim().length<12||reason.length>1000)throw Error('Invalid research classification');
  this.profile(user,objectiveId,organisationId);
  if(!this.store.db.prepare('SELECT 1 FROM hf_organisation_observations WHERE tenant=? AND objective_id=? AND organisation_id=? AND evidence_id=?').get(user.tenant,objectiveId,organisationId,evidenceId))throw Error('Classification evidence must belong to this organisation');
  return this.store.transaction(()=>{const entry={id:randomUUID(),organisationId,segment,sizeBand,evidenceId,reason:reason.trim(),createdAt:new Date().toISOString()};
   this.store.db.prepare('INSERT INTO hf_organisation_research_classifications VALUES(?,?,?,?,?,?,?,?,?,?)').run(entry.id,user.tenant,objectiveId,organisationId,evidenceId,segment,sizeBand,entry.reason,user.id,entry.createdAt);
   this.intel.identity.audit(user.id,'organisation.research.classified',{objectiveId,organisationId,evidenceId,segment,sizeBand});return {...entry,classification:'human_evidence_linked_not_independently_verified',intentVerified:false};});
 }
 quarterlyProgress(user,objectiveId,{year=new Date().getUTCFullYear(),quarter=Math.floor(new Date().getUTCMonth()/3)+1}={}){
  this.scope(user,objectiveId);year=Number(year);quarter=Number(quarter);
  if(!Number.isInteger(year)||year<2020||year>2100||!Number.isInteger(quarter)||quarter<1||quarter>4)throw Error('Invalid quarter');
  const begin=`${year}-${String((quarter-1)*3+1).padStart(2,'0')}-01`,until=quarter===4?`${year+1}-01-01`:`${year}-${String(quarter*3+1).padStart(2,'0')}-01`;
  const records=this.store.db.prepare('SELECT organisation_id,segment,size_band,evidence_id,id FROM hf_organisation_research_classifications WHERE tenant=? AND objective_id=? AND created_at>=? AND created_at<? ORDER BY created_at,id').all(user.tenant,objectiveId,begin,until);
  const latest=new Map();for(const r of records)latest.set(r.organisation_id,r);
  const groups=['Experience','Services','Products'].map(segment=>({segment,target:15,actual:[...latest.values()].filter(x=>x.segment===segment).length,sizes:['Small','Medium','Large'].map(size=>({size,target:5,actual:[...latest.values()].filter(x=>x.segment===segment&&x.size_band===size).length}))}));
  return {year,quarter,targets:{organisations:45,responses:[9,18],initialPaidBookings:5,stretchPaidBookings:9},actual:{organisations:latest.size,groups,responses:'not independently measured',paidBookings:'not independently measured'},evidenceIds:[...new Set([...latest.values()].map(x=>x.evidence_id))],classification:'explicit_sourced_research_activity_not_verified_leads',intentVerified:false,outboundActions:0};
 }
 /** A fixed evidence inventory for Management review, not an inference of demand or endorsement. */
 assess(user,objectiveId,organisationId){
  this.intel.require(user,['management','super_user']);this.intel.editable(user,objectiveId);
  const profile=this.profile(user,objectiveId,organisationId);
  const priorities=this.store.db.prepare(`SELECT p.opportunity_id,p.score,p.version,p.reason FROM hf_marketing_priorities p WHERE p.tenant=? AND p.objective_id=? AND p.opportunity_id IN (SELECT id FROM hf_marketing_opportunities WHERE tenant=? AND objective_id=? AND organisation_id=?) AND p.version=(SELECT MAX(t.version) FROM hf_marketing_priorities t WHERE t.tenant=p.tenant AND t.objective_id=p.objective_id AND t.opportunity_id=p.opportunity_id) ORDER BY p.opportunity_id`).all(user.tenant,objectiveId,user.tenant,objectiveId,organisationId);
  const evidenceIds=[...new Set([...profile.observations.map(x=>x.evidence_id),...profile.opportunities.flatMap(x=>x.evidenceIds),...profile.outcomes.map(x=>x.evidence_id).filter(Boolean)])].sort();
  const assessment={organisationId,organisationName:profile.name,classification:'local_sources_and_manual_observations',evidenceIds,observations:profile.observations.map(x=>({evidenceId:x.evidence_id,source:x.source,kind:x.kind,verification:x.verification,contentHash:x.content_hash,observation:x.observation})),opportunities:profile.opportunities.map(x=>({id:x.id,service:x.service,status:x.status,evidenceIds:x.evidenceIds,manualPriority:priorities.find(p=>p.opportunity_id===x.id)||null})),outcomes:profile.outcomes.map(x=>({id:x.id,kind:x.kind,evidenceId:x.evidence_id,createdAt:x.created_at,classification:'manually_recorded'})),risks:['The provided records do not independently establish buying intent','Source assertions and manually logged activities have not been externally verified'],gaps:[...(!profile.observations.length?['No cited organisation observations']:[]),...(!profile.opportunities.length?['No evidence-linked opportunity hypothesis recorded']:[]),...(!profile.opportunities.every(o=>priorities.some(p=>p.opportunity_id===o.id))?['At least one opportunity lacks explicit Management prioritisation']:[])],verification:'supplied_source_not_independently_verified',independentlyVerified:false,buyingIntentVerified:false,automaticOutreach:false};
  return this.store.transaction(()=>{
   const version=(this.store.db.prepare('SELECT MAX(version) v FROM hf_organisation_assessments WHERE tenant=? AND objective_id=? AND organisation_id=?').get(user.tenant,objectiveId,organisationId).v||0)+1;
   const id=randomUUID(),at=new Date().toISOString();this.store.db.prepare('INSERT INTO hf_organisation_assessments VALUES(?,?,?,?,?,?,?,?)').run(id,user.tenant,objectiveId,organisationId,version,JSON.stringify(assessment),user.id,at);
   this.intel.identity.audit(user.id,'organisation.assessment.create',{objectiveId,organisationId,version,evidenceIds});return {id,version,assessment,createdBy:user.id,createdAt:at,reviews:[]};
  });
 }
 assessmentHistory(user,objectiveId,organisationId){
  this.profile(user,objectiveId,organisationId);
  return this.store.db.prepare('SELECT id,version,assessment_json,created_by,created_at FROM hf_organisation_assessments WHERE tenant=? AND objective_id=? AND organisation_id=? ORDER BY version DESC').all(user.tenant,objectiveId,organisationId).map(x=>({id:x.id,version:x.version,assessment:JSON.parse(x.assessment_json),createdBy:x.created_by,createdAt:x.created_at,reviews:this.store.db.prepare('SELECT id,decision,reason,reviewer,created_at FROM hf_organisation_assessment_reviews WHERE tenant=? AND objective_id=? AND organisation_id=? AND assessment_id=? ORDER BY created_at,id').all(user.tenant,objectiveId,organisationId,x.id)}));
 }
 reviewAssessment(user,objectiveId,organisationId,{assessmentId,decision,reason}){
  this.intel.require(user,['management','super_user']);this.intel.editable(user,objectiveId);
  if(!['reviewed','needs_more_evidence','rejected'].includes(decision)||typeof reason!=='string'||reason.trim().length<8||reason.length>1000)throw Error('Invalid organisation assessment review');
  const history=this.assessmentHistory(user,objectiveId,organisationId);if(!history.length||history[0].id!==assessmentId)throw Error('Assessment is not current');
  return this.store.transaction(()=>{const id=randomUUID(),at=new Date().toISOString();this.store.db.prepare('INSERT INTO hf_organisation_assessment_reviews VALUES(?,?,?,?,?,?,?,?,?)').run(id,user.tenant,objectiveId,organisationId,assessmentId,decision,reason.trim(),user.id,at);this.intel.identity.audit(user.id,'organisation.assessment.review',{objectiveId,organisationId,assessmentId,decision});return {id,assessmentId,decision,reason:reason.trim(),reviewer:user.id,createdAt:at,externalActions:0}});
 }
 outcome(user,objectiveId,{organisationId,opportunityId=null,kind,description,evidenceId=null}){
  this.intel.require(user,['management','super_user']);
  // Outcomes are append-only observations, not research-evidence edits. Management must
  // be able to record real-world follow-up AFTER final report approval while the
  // approved report and its evidence remain immutable. Terminal rejected/cancelled
  // objectives are not eligible for new activity.
  const objective=this.intel.objective(user,objectiveId);
  if(['rejected','cancelled'].includes(objective.status))throw Error('Objective is closed');
  if(!['research_needed','manual_contact_logged','response_logged','meeting_logged','declined','completed','closed'].includes(kind)||typeof description!=='string'||description.trim().length<8||description.length>1200)throw Error('Invalid outcome');
  const org=this.store.db.prepare('SELECT 1 FROM hf_organisation_observations WHERE tenant=? AND objective_id=? AND organisation_id=?').get(user.tenant,objectiveId,organisationId);if(!org)throw Error('Organisation outside objective');
  if(opportunityId){const opportunity=this.store.db.prepare('SELECT organisation,organisation_id FROM hf_marketing_opportunities WHERE tenant=? AND objective_id=? AND id=?').get(user.tenant,objectiveId,opportunityId);if(!opportunity)throw Error('Opportunity outside objective');const profile=this.store.db.prepare('SELECT name_key FROM hf_organisation_directory WHERE tenant=? AND id=?').get(user.tenant,organisationId);const candidate=opportunity.organisation.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('en-NZ');if(candidate!==profile.name_key||opportunity.organisation_id&&opportunity.organisation_id!==organisationId)throw Error('Opportunity belongs to a different organisation')}
  if(evidenceId)this.evidence(user.tenant,objectiveId,evidenceId);
  const record={id:randomUUID(),kind,at:new Date().toISOString()};this.store.transaction(()=>{this.store.db.prepare('INSERT INTO hf_organisation_outcomes VALUES(?,?,?,?,?,?,?,?,?,?)').run(record.id,user.tenant,organisationId,objectiveId,opportunityId,kind,description.trim(),evidenceId,user.id,record.at);this.intel.identity.audit(user.id,'organisation.outcome',{objectiveId,organisationId,kind})});return {...record,externallyVerified:false,outboundActions:0};
 }
 outcomes(user,objectiveId){this.scope(user,objectiveId);return this.store.db.prepare('SELECT id,organisation_id,opportunity_id,kind,description,evidence_id,recorded_by,created_at FROM hf_organisation_outcomes WHERE tenant=? AND objective_id=? ORDER BY created_at,id').all(user.tenant,objectiveId)}
}
