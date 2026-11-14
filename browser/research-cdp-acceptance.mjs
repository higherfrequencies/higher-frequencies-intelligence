/** Actual headless Chromium acceptance via built-in Node WebSocket/CDP. No npm dependency.
 * Runs local server with a temporary database; never connects to an external service. */
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import assert from 'node:assert/strict';
import {TransactionalStore} from '../core/transactional-store.mjs';
import {IdentityService} from '../core/security/auth.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
const portFree=()=>new Promise((resolve,reject)=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const port=s.address().port;s.close(()=>resolve(port))});s.once('error',reject)});
async function run(){
 const dir=await mkdtemp(join(tmpdir(),'hf-research-browser-'));let server,chrome,ws;
 try{
  const db=join(dir,'app.sqlite'),store=await TransactionalStore.open(db),identity=new IdentityService(store);
  const manager=identity.createUser({username:'browsermanager',password:'BrowserStrong!123456',role:'super_user',tenant:'internal'});identity.createUser({username:'browserexecutive',password:'BrowserStrong!123456',role:'executive',tenant:'internal'},manager);identity.createUser({username:'browseroutsider',password:'BrowserStrong!123456',role:'management',tenant:'external'},manager);store.close();
  const port=await portFree(),url=`http://127.0.0.1:${port}`;
  server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,HF_DB:db,PORT:String(port),HF_AUTOWORKERS:'0'},stdio:'ignore'});
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(url)).ok){ready=true;break}}catch{}await sleep(60)}assert.ok(ready,'Node local server started');
  const browserDir=join(dir,'chrome');chrome=spawn(process.env.HF_CHROMIUM||'/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${browserDir}`,'about:blank'],{stdio:'ignore'});
  let devtools;for(let i=0;i<100;i++){try{devtools=(await readFile(join(browserDir,'DevToolsActivePort'),'utf8')).trim().split('\n')[0];break}catch{}await sleep(60)}assert.ok(devtools,'Chromium debug port available');
  const pages=await (await fetch(`http://127.0.0.1:${devtools}/json/list`)).json(),page=pages.find(x=>x.type==='page');assert.ok(page,'Chromium page available');
  ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((resolve,reject)=>{ws.addEventListener('open',resolve,{once:true});ws.addEventListener('error',reject,{once:true})});
  let seq=0;const pending=new Map();ws.addEventListener('message',event=>{const msg=JSON.parse(event.data);if(msg.id&&pending.has(msg.id)){const [resolve,reject]=pending.get(msg.id);pending.delete(msg.id);msg.error?reject(Error(msg.error.message)):resolve(msg.result)}});
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,[resolve,reject]);ws.send(JSON.stringify({id,method,params}))});
  const evaluate=async expression=>{const result=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true});if(result.exceptionDetails)throw Error(result.exceptionDetails.text);return result.result.value};
  const until=async(check,label)=>{for(let i=0;i<120;i++){const blocked=await evaluate("location.href==='chrome-error://chromewebdata/' && document.body?.innerText?.includes('blocked')");if(blocked)throw Error('Chromium navigation blocked by managed browser policy; local application browser acceptance cannot execute in this environment');const value=await evaluate(check);if(value)return value;await sleep(80)}throw Error(`Chromium acceptance timeout: ${label}`)};
  await send('Page.enable');await send('Runtime.enable');await send('Page.navigate',{url});
  await until("Boolean(document.querySelector('#login input[name=username]'))",'login form').catch(async error=>{console.error('Chrome navigation state',await evaluate('JSON.stringify({url:location.href,title:document.title,body:document.body?.innerText?.slice(0,500)})'));throw error});
  await evaluate("document.querySelector('#login input[name=username]').value='browsermanager';document.querySelector('#login input[name=password]').value='BrowserStrong!123456';document.querySelector('#login').requestSubmit()");
  await until("document.querySelector('#notice')?.textContent==='Signed in'",'browser sign-in');
  await evaluate("document.querySelector('#objective input[name=title]').value='Browser Research approval fixture';document.querySelector('#objective').requestSubmit()");
  const objective=await until("document.querySelector('#intel-id')?.value||''",'created objective');assert.match(objective,/^[a-f0-9-]{36}$/);
  const fixtures=[{source:'Fixture 1',kind:'market',verification:'user_supplied',content:'Claim: Fictional region | example venues | 3 | period=2026'},{source:'Fixture 2',kind:'market',verification:'unverified',content:'Claim: Fictional region | example venues | 5 | period=2026'}];
  const serialized=JSON.stringify(fixtures);await evaluate(`(()=>{const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(serialized)}],'research.json',{type:'application/json'}));const input=document.querySelector('#intel-file');input.files=dt.files;document.querySelector('#intel-import').requestSubmit()})()`);
  await until("document.querySelector('#notice')?.textContent.includes('Imported 2 evidence records')",'Research browser import');
  await evaluate("document.querySelector('#intel-assign').click()");
  await until("document.querySelector('#notice')?.textContent.includes('Saved to local SQLite')",'assign Research task');
  await evaluate("document.querySelector('#intel-assess select[name=department]').value='research';document.querySelector('#intel-assess').requestSubmit()");
  await until("document.querySelector('#intel-analysis')?.textContent.includes('Conflicting supplied values')",'Research analysis in portal');
  await evaluate("document.querySelector('#research-claim-review input[name=subject]').value='Fictional region';document.querySelector('#research-claim-review input[name=predicate]').value='example venues';document.querySelector('#research-claim-review textarea[name=reason]').value='Fixture sources disagree, human investigation needed';document.querySelector('#research-claim-review').requestSubmit()");
  await until("document.querySelector('#research-reviews')?.textContent.includes('needs_more_evidence')",'Research review visible');
  await evaluate("document.querySelector('#research-approval input[type=checkbox]').checked=true;document.querySelector('#research-approval').requestSubmit()");
  await until("document.querySelector('#research-approval-status')?.textContent.startsWith('Approved Research snapshot')",'Management Research approval');
  // Reload from the actual local server: assessment and governance records must survive a browser refresh.
  await send('Page.reload',{ignoreCache:true});
  await until("Boolean(document.querySelector('#login input[name=username]'))",'Research page reload');
  await evaluate("document.querySelector('#intel-id').value="+JSON.stringify(objective)+";document.querySelector('#intel-select').requestSubmit()");
  await until("document.querySelector('#research-approval-status')?.textContent.startsWith('Approved Research snapshot')",'persistent approved Research snapshot after page reload');
  await until("document.querySelector('#research-reviews')?.textContent.includes('needs_more_evidence')",'persistent Management review after page reload');
  await evaluate("document.querySelector('#logout').click()");
  await until("document.querySelector('#status')?.textContent==='Signed out'",'browser logout');
  const loggedOutStatus=await evaluate(`fetch('/api/intelligence/objectives/${objective}/analysis?department=research',{credentials:'include'}).then(r=>r.status)`);
  assert.ok([401,403].includes(loggedOutStatus),'logged-out browser cannot access Research analysis');
  // Executive in the same tenant must not retrieve unapproved departmental intelligence.
  await evaluate("document.querySelector('#login input[name=username]').value='browserexecutive';document.querySelector('#login input[name=password]').value='BrowserStrong!123456';document.querySelector('#login').requestSubmit()");
  await until("fetch('/api/me',{credentials:'include'}).then(r=>r.ok?r.json().then(u=>u.role==='executive'):false)",'Executive sign-in');
  const executiveStatus=await evaluate(`fetch('/api/intelligence/objectives/${objective}/analysis?department=research',{credentials:'include'}).then(r=>r.status)`);
  assert.ok([401,403].includes(executiveStatus),'Executive cannot retrieve Research draft analysis');
  await evaluate("document.querySelector('#logout').click()");
  await until("document.querySelector('#status')?.textContent==='Signed out'",'Executive logout');
  // A separate Management tenant must not see this objective's evidence.
  await evaluate("document.querySelector('#login input[name=username]').value='browseroutsider';document.querySelector('#login input[name=password]').value='BrowserStrong!123456';document.querySelector('#login').requestSubmit()");
  await until("fetch('/api/me',{credentials:'include'}).then(r=>r.ok?r.json().then(u=>u.tenant==='external'):false)",'Other tenant sign-in');
  const outsiderStatus=await evaluate(`fetch('/api/intelligence/objectives/${objective}/evidence',{credentials:'include'}).then(r=>r.status)`);
  assert.ok([403,404].includes(outsiderStatus),'cross-tenant browser cannot view Research evidence');
  await evaluate("document.querySelector('#logout').click()");
  await until("document.querySelector('#status')?.textContent==='Signed out'",'other tenant logout');
  console.log('B1 Chromium browser acceptance PASSED: login, objective, evidence import, Research review, approval, refresh persistence, Executive draft restrictions, tenant isolation, logout.');
 }finally{
  ws?.close();for(const proc of [chrome,server])if(proc){proc.kill('SIGTERM');await Promise.race([new Promise(r=>proc.once('exit',r)),sleep(1500)]);if(proc.exitCode===null)proc.kill('SIGKILL')}
  await rm(dir,{recursive:true,force:true});
 }
}
run().catch(e=>{console.error('B1 Chromium browser acceptance FAILED:',e);process.exitCode=1});
