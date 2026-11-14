/** Bounded, disposable real-server acceptance. Never uses production data or network APIs. */
import {spawn} from 'node:child_process';
import {mkdtemp,rm,readFile,writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {performance} from 'node:perf_hooks';
import {TransactionalStore} from '../core/transactional-store.mjs';
import {IdentityService} from '../core/security/auth.mjs';
const ROOT=dirname(dirname(fileURLToPath(import.meta.url))),count=40;
const temp=await mkdtemp(join(tmpdir(),'hf-release-stress-'));const db=join(temp,'db.sqlite');
const port=55000+Math.floor(Math.random()*3000),base=`http://127.0.0.1:${port}`;let child;
const percentile=(times,p)=>{const sorted=[...times].sort((a,b)=>a-b);return Math.round(sorted[Math.min(sorted.length-1,Math.ceil(sorted.length*p)-1)]*100)/100};
const now=()=>performance.now();
const report={workload:{concurrentObjectiveWrites:count,foreignTenantDeniedReads:count,database:'temporary_SQLite',host:'127.0.0.1',externalSources:0},measurements:{},errors:[],accepted:false};
let code=1;
try{
 const store=await TransactionalStore.open(db),identity=new IdentityService(store),admin=identity.createUser({username:'stressadmin',password:'StrongTestPassword123!',role:'super_user'});
 identity.createUser({username:'stressforeign',password:'StrongTestPassword123!',role:'management',tenant:'foreign'},admin);store.close();
 child=spawn(process.execPath,['server.mjs'],{cwd:ROOT,env:{...process.env,HF_DB:db,HF_AUTOWORKERS:'0',PORT:String(port)},stdio:'ignore'});
 let ready=false;for(let i=0;i<100;i++){try{if((await fetch(base+'/')).ok){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,50))}if(!ready)throw Error('Local server not ready');
 async function login(username){const r=await fetch(base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({username,password:'StrongTestPassword123!'})});if(!r.ok)throw Error('Login failed');return {cookie:r.headers.get('set-cookie').split(';')[0],csrf:(await r.json()).csrf}}
 const adminSession=await login('stressadmin');
 const writeStart=now();const writes=await Promise.all(Array.from({length:count},async(_,i)=>{const t=now();const response=await fetch(base+'/api/objectives',{method:'POST',headers:{Cookie:adminSession.cookie,'X-HF-CSRF':adminSession.csrf,'Content-Type':'application/json'},body:JSON.stringify({title:`Fixture objective ${i} no external data`})});const payload=await response.json();return {status:response.status,id:payload.id,ms:now()-t}}));
 const writeDuration=now()-writeStart;const accepted=writes.filter(x=>x.status===201&&x.id),failedWrites=writes.filter(x=>x.status!==201||!x.id);report.errors.push(...failedWrites.map(x=>`Unexpected write status ${x.status}`));
 report.measurements.writes={count:accepted.length,errors:failedWrites.length,wallMs:Math.round(writeDuration),p50Ms:percentile(writes.map(x=>x.ms),.5),p95Ms:percentile(writes.map(x=>x.ms),.95),maxMs:percentile(writes.map(x=>x.ms),1)};
 const foreign=await login('stressforeign');const denialStart=now();const denials=await Promise.all(accepted.map(async x=>{const t=now(),r=await fetch(base+'/api/objectives/'+x.id,{headers:{Cookie:foreign.cookie}});return {status:r.status,ms:now()-t}}));
 report.measurements.crossTenant={attempts:denials.length,denied:denials.filter(x=>x.status===404).length,errors:denials.filter(x=>x.status!==404).length,wallMs:Math.round(now()-denialStart),p95Ms:percentile(denials.map(x=>x.ms),.95)};
 try{const status=await readFile(`/proc/${child.pid}/status`,'utf8');report.measurements.processRssKiB=Number(status.match(/^VmRSS:\s+(\d+)/m)?.[1])||null}catch{report.measurements.processRssKiB=null}
 await new Promise(resolve=>{child.once('exit',resolve);child.kill('SIGTERM')});child=null;
 const check=await TransactionalStore.open(db);report.measurements.persistedObjectiveCount=check.db.prepare('SELECT COUNT(*) n FROM hf_objectives').get().n;report.measurements.integrity=check.db.prepare('PRAGMA integrity_check').get().integrity_check;check.close();
 report.accepted=report.errors.length===0&&accepted.length===count&&report.measurements.crossTenant.errors===0&&report.measurements.persistedObjectiveCount===count&&report.measurements.integrity==='ok';code=report.accepted?0:1;
}catch(e){report.errors.push(e.message)}finally{if(child){child.kill('SIGTERM');await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)resolve();else child.once('exit',resolve)})}await rm(temp,{recursive:true,force:true});const dest=process.argv[2];if(dest)await writeFile(dest,JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify(report,null,2));process.exitCode=code}
