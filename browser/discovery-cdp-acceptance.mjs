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
async function demo(){const dir=await mkdtemp(join(tmpdir(),'hf-activation-chrome-')),db=join(dir,'real.sqlite'),port=await free(),base='http://127.0.0.1:'+port,results={at:new Date().toISOString(),mode:'Chromium executed real dashboard DOM with authenticated HTTP mediated by host binding due to mandatory URLBlocklist=*; native browser navigation NOT validated',checks:[]};let server,chrome,ws;
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
  check('Intelligence inbox is default authenticated workspace',await until("document.querySelector('#discovery-heading')&&!document.querySelector('#discovery-heading').closest('section').hidden",'visible inbox'));
  await evaluate("document.getElementById('discovery-demo').click();true");
  check('Five genuine records visible in browser metrics',await until("document.getElementById('discovery-metrics')?.textContent.includes('Sourced records5')",'five items'));
  check('Real notifications appear in browser',await until("document.querySelectorAll('#discovery-inbox .record-card').length===5",'notifications'));
  await evaluate("document.querySelector('#discovery-inbox .record-card button').click();true");
  check('Browser opens evidence-backed report from notification',await until("!document.querySelector('#discovery-detail').hidden&&document.querySelector('#discovery-detail a')?.href.includes('christchurchnz.com')",'full report'));
  await evaluate("document.querySelector('#discovery-detail').scrollIntoView({behavior:'instant',block:'start'});true");await wait(180);const screenshot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});const dest=join(root,'docs/test-evidence/RC4-CHROMIUM-REPORT.png');await writeFile(dest,Buffer.from(screenshot.data,'base64'));results.screenshot='docs/test-evidence/RC4-CHROMIUM-REPORT.png';
  await send('Page.navigate',{url:'about:blank'});await wait(180);await load();check('UI remounts and stored report/notifications persist',await until("document.querySelectorAll('#discovery-inbox .record-card').length===5",'reload persistence'));
  check('Notification read state preserved after reload',await until("document.getElementById('discovery-inbox')?.textContent.includes('Read')",'read state'));
  results.status='PASS';
 }catch(e){results.status='FAIL';results.error=e.message;throw e}
 finally{ws?.close();for(const p of [chrome,server])if(p){p.kill('SIGTERM');await Promise.race([new Promise(r=>p.once('exit',r)),wait(1500)]);if(p.exitCode===null)p.kill('SIGKILL')}await rm(dir,{recursive:true,force:true});await writeFile(join(root,'docs/test-evidence/RC4-BROWSER-ACCEPTANCE.json'),JSON.stringify(results,null,2)+'\n');console.log('Browser DOM bridge:',results.status)}
}
demo().catch(e=>{console.error('Browser acceptance:',e);process.exitCode=1});
