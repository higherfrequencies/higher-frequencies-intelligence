/** Disposable, controlled evidence demonstration; never changes an owner's database. */
import assert from 'node:assert/strict';
import {mkdtemp,rm,readFile,writeFile,mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {createHash} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {TransactionalStore} from '../core/transactional-store.mjs';
import {IdentityService} from '../core/security/auth.mjs';
import {LiveIntelligence} from '../core/live-intelligence.mjs';
import {AdaptiveMonitoring} from '../core/adaptive-monitoring.mjs';
import {OperationalScheduler} from '../core/operational-scheduler.mjs';
import {ActivationIntelligence} from '../core/activation-intelligence.mjs';
import {RC7Orchestration} from '../core/rc7-orchestration.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const sample=JSON.parse(await readFile(join(root,'data/activation/christchurchnz-events-2026-11-13.json'),'utf8'));
const dir=await mkdtemp(join(tmpdir(),'hf-integrated-adaptive-'));
const file=join(dir,'demo.sqlite');let store;
const trace={classification:'controlled_attributed_fixture_not_live',source:sample.provider,events:[],originalRequirementClosures:0};
const note=(stage,data)=>trace.events.push({stage,...data});
try{
 let clock=Date.UTC(2026,10,14);
 store=new TransactionalStore(file);let auth=new IdentityService(store);
 const owner=auth.createUser({username:'controlled_demo',password:'ControlledOnlyPassword!123',role:'super_user'});
 let monitoring=new AdaptiveMonitoring(store,auth,{clock:()=>clock});let live=new LiveIntelligence(store,auth);live.monitor=monitoring;
 let education=new ActivationIntelligence(store,auth,live);let processing=new RC7Orchestration(store,auth,live,education);
 const a=sample.records[0],b=sample.records[1];const keyA=a.externalKey||a.url;
 let run=live.ingest(owner,{provider:sample.provider,records:[a],method:'manual_attributed_import'});assert.equal(run.created,1);
 const queued=processing.queueRun(owner,run.runId);note('A.ingest',{runId:run.runId,newEvidence:run.created,queued:queued.newlyQueued});
 const reportA=live.list(owner)[0];const kA=education.acquire(owner,reportA.id,{note:'Controlled reviewer confirms attributable record for internal reuse'});
 const briefA=education.synthesise(owner,reportA.id);
 education.review(owner,briefA.id,{status:'research_required',reason:'Confirm the actual commissioning contact and commercial need before outreach'});
 const observed=education.feedback(owner,reportA.id,{kind:'no_contact',note:'No verified commissioning contact; no outreach undertaken',observedAt:'2026-11-14'});
 const lesson=education.evaluate(owner,reportA.id,{feedbackId:observed.id,assessment:'unresolved',reason:'An event listing does not establish commercial demand or an authorised buyer'});
 assert.equal(education.relatedLessons(owner,reportA.id).length,0);education.reviewLesson(owner,lesson.id,{status:'approved',reason:'Only reuse after ensuring the new event requires commissioning verification'});
 note('A.governed_learning',{reportId:reportA.id,knowledgeId:kA.knowledgeId,briefId:briefA.id,outcomeId:observed.id,lessonId:lesson.id,approval:'explicit_controlled_super_user'});
 const unchanged=live.ingest(owner,{provider:sample.provider,records:[a],method:'manual_attributed_import'});assert.equal(unchanged.duplicates,1);
 const minor=live.ingest(owner,{provider:sample.provider,records:[{...a,description:(a.description||'')+' Editorial clarification'}],method:'manual_attributed_import'});assert.equal(minor.deferred,1);
 note('A.monitoring',{unchangedDuplicates:unchanged.duplicates,minorDeferred:minor.deferred,sourceHashRetained:true});
 run=live.ingest(owner,{provider:sample.provider,records:[b],method:'manual_attributed_import'});assert.equal(run.created,1);
 const reportB=live.list(owner).find(x=>x.id!==reportA.id);const kB=education.acquire(owner,reportB.id,{note:'Controlled second event evidence approved for research reuse'});
 const briefB=education.synthesise(owner,reportB.id);const reuse=education.reuse(owner,{briefId:briefB.id});assert.equal(reuse.length,1);assert.equal(reuse[0].source_lesson_id,lesson.id);
 assert.match(briefB.brief.decision.recommendationAdjustment,/Review prior approved outcome lessons/);
 note('B.knowledge_informed_report',{reportId:reportB.id,knowledgeId:kB.knowledgeId,briefId:briefB.id,lessonReused:lesson.id,recommendationAdjustment:briefB.brief.decision.recommendationAdjustment});
 const beforeNotices=education.notices(owner).length;assert.equal(education.synthesise(owner,reportB.id).unchanged,true);assert.equal(education.notices(owner).length,beforeNotices);
 note('B.report_suppression',{noticesBefore:beforeNotices,noticesAfter:education.notices(owner).length});
 // Item-specific due checks run on the existing source scheduler; no fake live fetch.
 clock+=8*86400000;
 let scheduler=new OperationalScheduler(store,auth,live,processing,{clock:()=>clock,monitoring});const scheduled=await scheduler.tick();
 assert.ok(scheduled.some(x=>x.source==='cached_only'));
 note('scheduled.reassessment',{dueWork:scheduled,monitoring:monitoring.summary(owner).states});
 store.close();store=new TransactionalStore(file);auth=new IdentityService(store);live=new LiveIntelligence(store,auth);education=new ActivationIntelligence(store,auth,live);monitoring=new AdaptiveMonitoring(store,auth,{clock:()=>clock});
 assert.equal(education.reuse(owner,{briefId:briefB.id}).length,1);assert.equal(education.lessons(owner,{status:'approved'}).length,1);assert.equal(store.db.prepare('PRAGMA integrity_check').get().integrity_check,'ok');
 note('restart',{integrity:'ok',approvedLessons:education.lessons(owner,{status:'approved'}).length,monitorItems:monitoring.summary(owner).monitored,persistedReuse:education.reuse(owner,{briefId:briefB.id}).length});
 trace.result='passed';trace.database='disposable SQLite; destroyed after execution';
}catch(e){trace.result='failed';trace.error=String(e.stack||e);process.exitCode=1}
finally{store?.close();await rm(dir,{force:true,recursive:true})}
const out=process.argv[2];if(out){await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(trace,null,2)+'\n')};console.log(JSON.stringify({result:trace.result,stages:trace.events.length,output:out}));
