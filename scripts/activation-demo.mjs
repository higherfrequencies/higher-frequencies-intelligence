/** Reproducible integration demo against REAL manually attributed ChristchurchNZ facts.
 * Source snapshots are not synthetic, and are NOT fetched automatically from the publisher.
 * No external credentials, no outbound contact, no lasting demo account in distributed database.
 */
import {spawn} from 'node:child_process';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {TransactionalStore} from '../core/transactional-store.mjs';
import {IdentityService} from '../core/security/auth.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const portFree=()=>new Promise(resolve=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const n=s.address().port;s.close(()=>resolve(n))})});
const records=JSON.parse(await readFile(join(root,'data/activation/christchurchnz-events-2026-11-13.json'),'utf8'));
async function main(){const dir=await mkdtemp(join(tmpdir(),'hf-real-demo-')),db=join(dir,'demo.sqlite'),port=await portFree(),base='http://127.0.0.1:'+port;let child;
 const evidence={executedAt:new Date().toISOString(),release:'intelligence-activation-rc4-development-preview',source:'ChristchurchNZ website factual observations',retrieval:'manually transcribed source listings on 2026-11-13; NOT a live feed',sourcePage:records.metadata.sourceCatalogue,snapshots:records.records.map(x=>({title:x.title,url:x.url,sourceObservedAt:x.sourceObservedAt})),steps:[],limitations:['No direct publisher API request made during demonstration','Browser native navigation subject to environment enterprise policy','No actual customer buying interest verified','Automatic research scheduler not enabled']};
 const step=(name,data)=>evidence.steps.push({name,passed:true,data});
 const start=async()=>{child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,HF_DB:db,PORT:String(port),HF_AUTOWORKERS:'0'},stdio:'ignore'});for(let i=0;i<120;i++){try{if((await fetch(base+'/')).ok)return}catch{}await sleep(50)}throw Error('Server did not start')};
 const stop=async()=>{if(!child)return;const p=child;child=null;p.kill('SIGTERM');await Promise.race([new Promise(r=>p.once('exit',r)),sleep(3000)])};
 try{const store=new TransactionalStore(db),identity=new IdentityService(store);identity.createUser({username:'activationowner',password:'LocalOnlyDemoPass!12345',role:'super_user',tenant:'internal'});store.close();await start();const login=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username:'activationowner',password:'LocalOnlyDemoPass!12345'})});assert.equal(login.status,200);const cookie=login.headers.get('set-cookie').split(';')[0],csrf=(await login.json()).csrf;
 const req=async(path,method='GET',body)=>{const r=await fetch(base+path,{method,headers:{Cookie:cookie,'X-HF-CSRF':csrf,'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});const obj=await r.json();assert.ok(r.ok,`HTTP ${r.status} ${path}: ${JSON.stringify(obj)}`);return obj};
 step('Super User signed in once', {role:(await req('/api/me')).role});
 const imported=await req('/api/discovery/demo-import','POST',{});assert.equal(imported.created,5);step('Five real observations imported from attributable manual source snapshot',{created:imported.created,duplicates:imported.duplicates,mode:imported.method});
 const reports=await req('/api/discovery/reports');assert.equal(reports.length,5);assert.ok(reports.every(r=>r.report.customerInterestVerified===false));step('Source evidence and commercial assessments persisted',{reports:reports.map(r=>({title:r.subject,priority:r.priority,organiser:r.report.organiser,services:r.report.services,confidence:r.report.confidence,sourceUrl:r.report.sourceUrl,sourceHash:r.report.sourceHash}))});
 const inbox=await req('/api/discovery/inbox');assert.equal(inbox.length,5);step('Five notifications present in authenticated inbox',{total:inbox.length,unread:inbox.filter(x=>x.state==='unread').length});
 const selected=await req('/api/discovery/reports/'+inbox[0].report_id);assert.ok(selected.source.source_json.includes('christchurchnz'));step('Notification navigated to full report with hashed source evidence',{reportId:selected.id,subject:selected.subject,sourceId:selected.source_id});
 await req('/api/discovery/inbox/'+inbox[0].id+'/read','POST',{});assert.equal((await req('/api/discovery/inbox')).filter(x=>x.state==='read').length,1);step('Read state persisted',{notificationId:inbox[0].id});
 await req('/api/discovery/reports/'+selected.id+'/review','POST',{status:'research_required',reason:'Verify organiser authority and existing media arrangements'});step('Management decision recorded with explicit rationale',{status:'research_required'});
 const repeat=await req('/api/discovery/demo-import','POST',{});assert.equal(repeat.duplicates,5);step('Duplicate replay prevented five unnecessary reports and alerts',{duplicates:repeat.duplicates,notifications:(await req('/api/discovery/inbox')).length});
 const before=await req('/api/discovery/overview');assert.equal(before.reportCount,5);await stop();await start();const after=await req('/api/discovery/overview');assert.equal(after.reportCount,5);assert.equal(after.unread,4);assert.equal((await req('/api/discovery/reports/'+selected.id)).review_status,'research_required');step('SQLite report, read state and Management decision survive server restart',{before,after});
 const check=new TransactionalStore(db);const integrity=check.db.prepare('PRAGMA integrity_check').get().integrity_check;assert.equal(integrity,'ok');check.close();step('SQLite integrity check passed',{integrity});
 evidence.result='PASS';
 }catch(err){evidence.result='FAIL';evidence.error=err.message;throw err}
 finally{await stop();const out=process.env.HF_DEMO_EVIDENCE||join(root,'docs/test-evidence/RC4-ACTIVATION-LIVE-WORKFLOW.json');await mkdir(dirname(out),{recursive:true});await writeFile(out,JSON.stringify(evidence,null,2)+'\n');await rm(dir,{recursive:true,force:true});console.log('Activation demo:',evidence.result,'evidence:',out)}
}
main().catch(e=>{console.error(e);process.exitCode=1});
