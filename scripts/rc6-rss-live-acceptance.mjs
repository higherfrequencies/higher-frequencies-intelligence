/** Live-source acceptance in an isolated, never-production SQLite database.
 * This script makes actual Node fetch requests; it never mocks or silently
 * approves publisher claims as organisational knowledge. Run once on a machine
 * with authorised HTTPS access, then inspect and review using the existing UI.
 */
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomBytes} from 'node:crypto';
import {TransactionalStore} from '../core/transactional-store.mjs';
import {IdentityService} from '../core/security/auth.mjs';
import {LiveIntelligence} from '../core/live-intelligence.mjs';
import {ActivationIntelligence} from '../core/activation-intelligence.mjs';
import {RC7Orchestration} from '../core/rc7-orchestration.mjs';
const directory=resolve(process.argv[2]||'./live-acceptance');await mkdir(directory,{recursive:true});
const evidence={startedAt:new Date().toISOString(),provider:'beehive',endpoint:'https://www.beehive.govt.nz/rss.xml',method:'unmocked_official_api',status:'not_run',fullAcceptance:false,manualEducationReviewRequired:true,managementApprovalRequired:true};let store;
try{
 store=new TransactionalStore(join(directory,'acceptance.sqlite'));
 const identity=new IdentityService(store);
 let owner=store.db.prepare("SELECT id,username,role,tenant FROM hf_users WHERE username='rss_acceptance_owner'").get();
 if(!owner){const password=randomBytes(24).toString('base64url');owner=identity.createUser({username:'rss_acceptance_owner',password,role:'super_user'});console.error('SCRATCH DATABASE LOGIN (shown once only; store securely): rss_acceptance_owner / '+password)}
 const live=new LiveIntelligence(store,identity),education=new ActivationIntelligence(store,identity,live),queue=new RC7Orchestration(store,identity,live,education);
 const result=await live.run(owner,'beehive'),handoff=queue.queueRun(owner,result.runId);
 // A second real request verifies stable identifiers and deduplication only when the first succeeded.
 const second=await live.run(owner,'beehive'),secondHandoff=queue.queueRun(owner,second.runId);
 const audit=queue.evidenceAudit(owner);const sources=audit.evidence.map(r=>({reportId:r.reportId,sourceUrl:r.url,sha256:r.sourceHash,retrievedAt:r.retrievedAt,method:r.method,processing:r.processing.map(p=>({stage:p.stage,status:p.status}))}));
 evidence.firstRun={...result,handoff};evidence.secondRun={...second,handoff:secondHandoff};evidence.sources=sources;
 evidence.sqliteIntegrity=store.db.prepare('PRAGMA integrity_check').get().integrity_check;
 evidence.status=evidence.sqliteIntegrity==='ok'&&result.received>0?'live_retrieval_and_review_queue_verified':'failed_validation';
 evidence.fullAcceptance=false;evidence.reason='Education and Management approvals remain explicit UI actions; this script cannot silently promote knowledge or approve proposals';
}catch(error){evidence.status='failed';evidence.error=String(error?.message||error).slice(0,300);evidence.networkCode=error?.cause?.code||error?.code||null;}
finally{evidence.completedAt=new Date().toISOString();store?.close();await writeFile(join(directory,'live-acceptance-evidence.json'),JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));if(evidence.status!=='live_retrieval_and_review_queue_verified')process.exitCode=2}
