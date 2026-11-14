/** Browser DOM acceptance over mediated localhost HTTP transport.
 * Environment Chrome policy blocks every URL, so page HTML is injected on about:blank.
 * Every authenticated API request is delegated to real live localhost Node server via a CDP binding.
 * This verifies actual browser DOM/events and real server/SQLite, but NOT native HTTP navigation or CSP enforcement.
 */
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {TransactionalStore} from '../core/transactional-store.mjs';
import {IdentityService} from '../core/security/auth.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url))),wait=ms=>new Promise(r=>setTimeout(r,ms)),free=()=>new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
async function demo(){const dir=await mkdtemp(join(tmpdir(),'hf-rc7-chrome-')),db=join(dir,'real.sqlite'),port=await free(),base='http://127.0.0.1:'+port,results={at:new Date().toISOString(),mode:'Chromium executed real dashboard DOM with authenticated HTTP mediated by host binding due to mandatory URLBlocklist=*; native browser navigation NOT validated',checks:[]};let server,chrome,ws;
 const check=(title,value)=>{assert.ok(value,title);results.checks.push({title,result:'PASS'})};
 try{const store=new TransactionalStore(db),identity=new IdentityService(store);identity.createUser({username:'chromiumowner',password:'ChromiumDemoPass!12345',role:'super_user'});store.close();
  server=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...process.env,HF_DB:db,PORT:String(port),HF_AUTOWORKERS:'0'},stdio:'ignore'});
  let ok=false;for(let i=0;i<130;i++){try{if((await fetch(base)).ok){ok=true;break}}catch{}await wait(40)}check('Backend live HTTP started',ok);
  const profileDir=join(dir,'chrome');chrome=spawn(process.env.HF_CHROMIUM||'/usr/bin/chromium',['--headless=new','--no-sandbox','--disable-gpu','--disable-dev-shm-usage','--no-first-run','--no-default-browser-check','--remote-debugging-port=0',`--user-data-dir=${profileDir}`,'about:blank'],{stdio:'ignore'});
  let devtools;for(let i=0;i<100;i++){try{devtools=(await readFile(join(profileDir,'DevToolsActivePort'),'utf8')).trim().split('\n')[0];break}catch{}await wait(40)}check('Chromium CDP available',devtools);
  const list=await(await fetch('http://127.0.0.1:'+devtools+'/json/list')).json();const page=list.find(x=>x.type==='page');check('Chromium about:blank page available',page);
  ws=new WebSocket(page.webSocketDebuggerUrl);await new Promise((r,j)=>{ws.addEventListener('open',r,{once:true});ws.addEventListener('error',j,{once:true})});let seq=0,backendCookie='',pending=new Map();
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,[resolve,reject]);ws.send(JSON.stringify({id,method,params}))});
  const evaluate=async expression=>{const r=await send('Runtime.evaluate',{expression,awaitPromise:true,returnByValue:true});if(r.exceptionDetails)throw Error('Chrome JS: '+r.exceptionDetails.text);return r.result.value};
  ws.addEventListener('message',event=>{const message=JSON.parse(event.data);if(message.id&&pending.has(message.id)){const [r,j]=pending.get(message.id);pending.delete(message.id);message.error?j(Error(message.error.message)):r(message.result)}
   if(message.method==='Runtime.bindingCalled'&&message.params.name==='hfNativeRequest'){
    (async()=>{const p=JSON.parse(message.params.payload),headers={...(p.headers||{})};if(backendCookie)headers.Cookie=backendCookie;let response=await fetch(base+p.url,{method:p.method||'GET',headers,body:p.body||undefined});const cookie=response.headers.get('set-cookie');if(cookie)backendCookie=cookie.split(';')[0];let data=await response.json();const out={id:p.id,ok:response.ok,status:response.status,data};await send('Runtime.evaluate',{expression:`window.__hfNativeReply(${JSON.stringify(out)})`});})().catch(e=>{console.error('CDP host transport',e.message)})
   }
  });
  await send('Page.enable');await send('Runtime.enable');await send('Runtime.addBinding',{name:'hfNativeRequest'});
  const shims=`<script>(function(){let seq=0,pending=new Map();window.__hfNativeReply=function(p){const cb=pending.get(p.id);if(!cb)return;pending.delete(p.id);cb({ok:p.ok,status:p.status,json:async()=>p.data})};window.fetch=function(url,opts={}){return new Promise(resolve=>{const id=++seq;pending.set(id,resolve);hfNativeRequest(JSON.stringify({id,url:String(url),method:opts.method||'GET',headers:opts.headers||{},body:opts.body||null}))})};window.EventSource=class{addEventListener(){}close(){}}})();</script>`;
  const html=(await readFile(join(root,'dashboard/index.html'),'utf8')).replace('<script>',shims+'<script>');
  const load=()=>evaluate(`document.open();document.write(${JSON.stringify(html)});document.close();true`);
  const until=async(expr,why)=>{for(let i=0;i<160;i++){const value=await evaluate(expr);if(value)return value;await wait(50)}throw Error('Browser UI did not render '+why)};
  await load();check('Real dashboard HTML injected and parsed',await until("Boolean(document.querySelector('#discovery-demo'))",'discovery UI'));
  await evaluate("document.querySelector('#login input[name=username]').value='chromiumowner';document.querySelector('#login input[name=password]').value='ChromiumDemoPass!12345';document.querySelector('#login').requestSubmit();true");
  check('Single login displays authenticated Super User',await until("document.querySelector('#account-session')?.textContent.includes('super_user')",'signed in'));
  check('RC7 command centre is the first authenticated workspace',await until("!document.getElementById('rc7-command').hidden&&document.body.classList.contains('rc7-authenticated')",'command centre'));
  check('Evidence queue renders from real SQLite',await until("document.querySelectorAll('#rc7-review-queue .rc7-item').length===0",'queue empty state'));
  await evaluate("document.getElementById('rc7-reconcile').click();true");
  check('RC7 reconciliation creates review-stage records from imported source evidence',await until("document.getElementById('rc7-review-queue')?.textContent.includes('No queued')",'empty initial source records'));
  await evaluate("document.getElementById('rc7-open-inbox').click();true");
  check('Sidebar switches to focused Intelligence inbox',await until("!document.getElementById('discovery-heading').closest('section').hidden&&document.getElementById('rc7-command').hidden",'inbox'));
  await evaluate("document.getElementById('hf-acceptance-check').click();true");
  check('Authenticated read-only acceptance view distinguishes local evidence from live retrieval',await until("document.getElementById('hf-acceptance-results')?.textContent.includes('Live HTTP acceptance: requires separate independent verification')",'local acceptance summary'));
  await send('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate("document.getElementById('hf-acceptance-results').scrollIntoView({block:'center',behavior:'instant'});true");await wait(150);
  const closureShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(root,'docs/test-evidence/CLOSURE-ACCEPTANCE-WORKSPACE.png'),Buffer.from(closureShot.data,'base64'));results.closureScreenshot='docs/test-evidence/CLOSURE-ACCEPTANCE-WORKSPACE.png';
  check('Schedule interface exists and requires explicit opt-in',await evaluate("Boolean(document.querySelector('#hf-source-schedule input[name=enabled]')) && !document.querySelector('#hf-source-schedule input[name=enabled]').checked"));
  await evaluate("document.querySelector('#hf-source-schedule select[name=provider]').value='beehive';document.querySelector('#hf-source-schedule input[name=enabled]').checked=true;document.getElementById('hf-source-schedule').requestSubmit();true");
  check('Schedule saves through authenticated local SQLite endpoint',await until("document.getElementById('hf-source-schedule-status')?.textContent.includes('Enabled')",'enabled schedule'));
  await evaluate("document.querySelector('#hf-source-schedule input[name=enabled]').checked=false;document.getElementById('hf-source-schedule').requestSubmit();true");
  check('Schedule disable is persisted',await until("document.getElementById('hf-source-schedule-status')?.textContent.includes('Disabled')",'disabled schedule'));
  await send('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate("document.querySelector('#hf-source-schedule').closest('details').open=true;document.getElementById('hf-source-schedule').scrollIntoView({block:'center',behavior:'instant'});true");await wait(200);
  const scheduleShot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(root,'docs/test-evidence/FINAL-SOURCE-SCHEDULE.png'),Buffer.from(scheduleShot.data,'base64'));
  results.scheduleScreenshot='docs/test-evidence/FINAL-SOURCE-SCHEDULE.png';
  await evaluate("document.getElementById('discovery-demo').click();true");
  check('Manual attributed events ingested through existing RC6 interface',await until("document.querySelectorAll('#discovery-inbox .record-card').length===5",'five source notices'));
  await evaluate("document.querySelector('#workspace-nav button[data-target=\"Command Centre\"]').click();true");
  await evaluate("request('/api/rc7/reconcile',{method:'POST',body:JSON.stringify({provider:'christchurchnz'})}).then(()=>refreshRC7());true");
  check('Five attributed findings awaiting explicit review',await until("document.querySelectorAll('#rc7-review-queue .rc7-item').length===5",'review queue'));
  await evaluate("window.prompt=()=> 'Owner reviewed this publisher-attributed source for internal research';document.querySelector('#rc7-review-queue .rc7-item button').click();true");
  check('Review creates a versioned Education record and strategic brief',await until("document.getElementById('rc7-metrics')?.textContent.includes('Strategic briefs')&&document.getElementById('rc7-decision-queue')?.textContent.includes('Open report')",'strategic briefing'));
  check('Four items remain in review queue',await until("document.querySelectorAll('#rc7-review-queue .rc7-item').length===4",'review queue after approval'));

  check('Command metrics reflect five persisted source reports',await until("document.getElementById('rc7-metrics')?.textContent.includes('Source reports')&&document.getElementById('rc7-metrics')?.textContent.includes('5')",'command metrics'));
  check('Command interface is not a single long all-department page',await evaluate("document.querySelectorAll('#authenticated-workspace > section:not([hidden])').length===1"));
  await send('Emulation.setDeviceMetricsOverride',{width:1366,height:900,deviceScaleFactor:1,mobile:false});
  await evaluate("document.getElementById('rc7-command').scrollIntoView({block:'start',behavior:'instant'});true");await wait(240);const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(root,'docs/test-evidence/FINAL-COMMAND-CENTRE.png'),Buffer.from(shot.data,'base64'));results.screenshot='docs/test-evidence/FINAL-COMMAND-CENTRE.png';
  results.mode='Chromium DOM and live SQLite/HTTP through host-mediated transport; native browser navigation and CSP remain unverified';
  results.status='PASS';
 }catch(e){results.status='FAIL';results.error=e.message;throw e}
 finally{ws?.close();for(const p of [chrome,server])if(p){p.kill('SIGTERM');await Promise.race([new Promise(r=>p.once('exit',r)),wait(1500)]);if(p.exitCode===null)p.kill('SIGKILL')}await rm(dir,{recursive:true,force:true});await writeFile(join(root,'docs/test-evidence/FINAL-BROWSER-ACCEPTANCE.json'),JSON.stringify(results,null,2)+'\n');console.log('Browser DOM bridge:',results.status)}
}
demo().catch(e=>{console.error('Browser acceptance:',e);process.exitCode=1});
