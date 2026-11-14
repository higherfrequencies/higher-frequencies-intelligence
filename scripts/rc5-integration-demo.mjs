/** RC5 reproducible live local HTTP + SQLite workflow using real source-attributed records.
 * NOT a live ChristchurchNZ API; no synthetic organisations, customers or sales outcomes.
 */
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {TransactionalStore} from '../core/transactional-store.mjs';
import {IdentityService} from '../core/security/auth.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url))),pause=n=>new Promise(r=>setTimeout(r,n)),free=()=>new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
const source=JSON.parse(await readFile(join(root,'data/activation/christchurchnz-events-2026-11-13.json'),'utf8'));
async function demo(){const dir=await mkdtemp(join(tmpdir(),'hf-rc5-http-')),db=join(dir,'rc5.sqlite'),port=await free(),base=`http://127.0.0.1:${port}`,ev={at:new Date().toISOString(),classification:'RC5 development preview; not live external source acceptance',sourcePublisher:'ChristchurchNZ',sourceMode:'manual factual snapshot with direct publisher URLs; NOT an automated external feed',records:source.records.map(x=>({title:x.title,url:x.url,startDate:x.startDate})),steps:[],externalAPI:{provider:'data.govt.nz',runAttempted:false,succeeded:false},limitations:['No accessible outbound DNS in application sandbox','No verified buyer interest, budgets, financial historical series or forecast','Managed Chromium native navigation and native Windows acceptance not certified']};let server;
 const step=(description,result)=>ev.steps.push({description,passed:true,result});
 const run=async()=>{server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,HF_DB:db,PORT:String(port),HF_AUTOWORKERS:'0'},stdio:'ignore'});for(let n=0;n<150;n++){try{if((await fetch(base)).ok)return}catch{}await pause(40)}throw Error('App did not start')};
 const stop=async()=>{if(server){const s=server;server=null;s.kill('SIGTERM');await Promise.race([new Promise(r=>s.once('exit',r)),pause(2000)])}};
 try{const dbstore=new TransactionalStore(db),identity=new IdentityService(dbstore);identity.createUser({username:'demo_rc5_owner',password:'DemoOnlySuperUser!12345',role:'super_user'});dbstore.close();await run();
  const response=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'demo_rc5_owner',password:'DemoOnlySuperUser!12345'})});assert.equal(response.status,200);const cookie=response.headers.get('set-cookie').split(';')[0];let csrf=(await response.json()).csrf;
  const req=async(path,method='GET',body)=>{const response=await fetch(base+path,{method,headers:{Cookie:cookie,'X-HF-CSRF':csrf,'Content-Type':'application/json'},body:body==null?undefined:JSON.stringify(body)});const data=await response.json();assert.equal(response.ok,true,`${path} ${response.status} ${JSON.stringify(data)}`);return data};
  step('One authenticated Super User session',{role:(await req('/api/me')).role});const ing=await req('/api/discovery/demo-import','POST',{});assert.equal(ing.created,5);step('Genuine dated publisher-attributed event facts persisted',ing);
  const reports=await req('/api/discovery/reports');assert.equal(reports.length,5);const learned=[];
  for(const report of reports){const k=await req(`/api/activation/reports/${report.id}/learn`,'POST',{note:'Reviewed publisher facts for internal research reuse; no independent verification'});assert.equal(k.version,1);const b=await req(`/api/activation/reports/${report.id}/synthesise`,'POST',{});assert.equal(b.version,1);assert.equal(b.brief.finance.revenueForecast,null);assert.equal(b.brief.marketing.customerInterestVerified,false);assert.deepEqual(b.brief.marketing.evidenceIds,b.brief.finance.evidenceIds);learned.push({title:report.subject,sourceUrl:report.report.sourceUrl,knowledgeId:k.knowledgeId,knowledgeVersion:1,briefId:b.id,priority:report.priority,services:b.brief.marketing.potentialServices,finance:b.brief.finance.commercialViability,sourceHash:b.brief.sourceHash})}
  step('Education reviewed/versioned real observations and Marketing + Finance reused identical source IDs',{count:learned.length,findings:learned});
  const briefs=await req('/api/activation/briefs');assert.equal(briefs.length,5);const notices=await req('/api/activation/inbox');assert.equal(notices.length,5);step('Collective/Decision generated searchable briefs and direct briefing notifications',{briefs:briefs.length,notices:5,unread:5});
  const first=await req('/api/activation/briefs/'+notices[0].brief_id);assert.equal(first.id,notices[0].brief_id);await req('/api/activation/inbox/'+notices[0].id+'/read','POST',{});step('Notification navigated to combined report and was marked read',{briefId:first.id,sourceId:first.brief.sourceId});
  const decision=await req(`/api/activation/briefs/${first.id}/review`,'POST',{status:'research_required',reason:'Confirm commissioning authority, media rights, existing supplier and buyer interest'});assert.equal(decision.noExternalAction,true);step('Explicit Management decision (no outreach)',decision);
  const learnedRecord=learned.find(x=>x.briefId===first.id);assert.ok(learnedRecord);const revision=await req(`/api/activation/knowledge/${learnedRecord.knowledgeId}/revise`,'POST',{conclusion:'The observed event listing alone does not show seasonal commercial demand or confirmed commissions',reason:'Keep descriptive evidence separate from marketing predictions'});assert.equal(revision.version,2);
  const followup=await req(`/api/activation/reports/${first.report_id}/synthesise`,'POST',{});assert.equal(followup.version,2);assert.equal((await req(`/api/activation/briefs/${first.id}`)).review_status,'research_required');step('Reused revised Education knowledge; prior reviewed decision remains immutable',{educationVersion:revision.version,briefVersion:followup.version,priorManagement:'research_required'});
  const calendar=await req('/api/activation/signals');assert.equal(calendar.reduce((n,x)=>n+x.observedListings,0),5);assert.ok(calendar.some(x=>x.month==='2026-11'&&x.observedListings===3));assert.ok(calendar.every(x=>x.seasonalityVerified===false));step('Geographic/calendar signal observed without pretending seasonal trends',{calendar:calendar.map(x=>({region:x.region,month:x.month,listings:x.observedListings,interpretation:x.classification,seasonalityVerified:x.seasonalityVerified}))});
  const forecast=await req('/api/activation/forecast-readiness');assert.equal(forecast.forecastAvailable,false);step('Forecast gate correctly withheld unsupported numeric predictions',forecast);
  const reimport=await req('/api/discovery/demo-import','POST',{});assert.equal(reimport.duplicates,5);step('Repeat real-facts import preserved deduplication',reimport);
  await stop();await run();const knowledge=await req('/api/activation/knowledge');assert.equal(knowledge.length,5);assert.equal((await req('/api/activation/briefs')).length,6);assert.equal((await req('/api/activation/inbox')).filter(x=>x.state==='read').length,1);
  csrf=(await req('/api/csrf')).csrf; // Server restart invalidates in-memory CSRF cache.
  const inspect=new TransactionalStore(db);const integrity=inspect.db.prepare('PRAGMA integrity_check').get().integrity_check;assert.equal(integrity,'ok');const audit=inspect.db.prepare("SELECT action,COUNT(*) n FROM hf_audit WHERE action LIKE 'education.%' OR action LIKE 'intelligence.collective.%' GROUP BY action").all();inspect.close();step('SQLite restart recovery, integrity and audit history',{knowledge:5,briefs:6,notices:6,integrity,audit});
  // Attempt the actual official CKAN connector through the same running application,
  // never reclassify an HTTP failure as a completed ingestion run.
  ev.externalAPI.runAttempted=true;
  const liveResponse=await fetch(base+'/api/discovery/run/datagovt',{method:'POST',headers:{Cookie:cookie,'X-HF-CSRF':csrf,'Content-Type':'application/json'},body:'{}'});
  const liveResult=await liveResponse.json();ev.externalAPI.httpStatus=liveResponse.status;
  ev.externalAPI.succeeded=liveResponse.ok;ev.externalAPI.result=liveResult;
  const runs=await req('/api/discovery/runs');ev.externalAPI.recordedRunStatus=runs[0]?.status;
  if(liveResponse.ok){const datasets=(await req('/api/discovery/reports')).filter(x=>x.report.provider==='datagovt');assert.ok(datasets.length>0,'External feed must actually persist results');ev.externalAPI.persistedDatasetReports=datasets.length;step('Live external CKAN response processed into SQLite',liveResult)}
  else{assert.equal(ev.externalAPI.recordedRunStatus,'failed');step('Live connector attempted but honestly recorded as unsuccessful, without synthetic records',{httpStatus:liveResponse.status,runStatus:'failed',reason:liveResult.error})}
  ev.status='PASS';ev.httpCallsUsedRealServer=true;ev.networkExternalRequestConfirmed=liveResponse.ok;
 }catch(error){ev.status='FAIL';ev.error=error.message;throw error}finally{await stop();await writeFile(join(root,'docs/test-evidence/RC5-HTTP-REAL-EVIDENCE.json'),JSON.stringify(ev,null,2)+'\n');await rm(dir,{recursive:true,force:true});console.log('RC5 authenticated HTTP + SQLite workflow:',ev.status)}
}
demo().catch(e=>{console.error(e);process.exitCode=1});
