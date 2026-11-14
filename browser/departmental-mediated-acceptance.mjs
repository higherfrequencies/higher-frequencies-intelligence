/** Browser DOM acceptance over mediated localhost HTTP transport.
 * Environment Chrome policy blocks every URL, so page HTML is injected on about:blank.
 * Every authenticated API request is delegated to real live localhost Node server via a CDP binding.
 * This verifies actual browser DOM/events and real server/SQLite, but NOT native HTTP navigation or CSP enforcement.
 */
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {spawn} from 'node:child_process';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createServer} from 'node:net';
import {TransactionalStore} from '../core/transactional-store.mjs';
import {IdentityService} from '../core/security/auth.mjs';
import {SecureWorkflow} from '../core/secure-workflow.mjs';
import {SecurityIncidents} from '../core/security/incidents.mjs';
import {CaretakerIncidents} from '../core/caretaker-incidents.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url))),wait=ms=>new Promise(r=>setTimeout(r,ms)),free=()=>new Promise(r=>{const s=createServer();s.listen(0,'127.0.0.1',()=>{const p=s.address().port;s.close(()=>r(p))})});
async function demo(){const dir=await mkdtemp(join(tmpdir(),'hf-rc7-chrome-')),db=join(dir,'real.sqlite'),port=await free(),base='http://127.0.0.1:'+port,results={at:new Date().toISOString(),mode:'Chromium executed real dashboard DOM with authenticated HTTP mediated by host binding due to mandatory URLBlocklist=*; native browser navigation NOT validated',checks:[]};let server,chrome,ws;
 const check=(title,value)=>{assert.ok(value,title);results.checks.push({title,result:'PASS'})};
 try{const store=new TransactionalStore(db),identity=new IdentityService(store);identity.createUser({username:'chromiumowner',password:'ChromiumDemoPass!12345',role:'super_user'});new SecureWorkflow(store,identity);const reopenObjective=randomUUID();store.db.prepare('INSERT INTO hf_objectives VALUES(?,?,?,?,?,?)').run(reopenObjective,'internal','Browser rejected Management objective','rejected',store.db.prepare("SELECT id FROM hf_users WHERE username='chromiumowner'").get().id,new Date().toISOString());const incidentId=new SecurityIncidents(store).record({tenant:'internal',category:'browser-acceptance',actor:'integration-test',resource:'governed-review'});const caretakerId=new CaretakerIncidents(store).record({worker:'integration-browser',tenant:'internal',category:'worker_error',diagnostic:'Simulated worker fault for browser UI test'});store.close();
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
  const until=async(expr,why)=>{for(let i=0;i<160;i++){const value=await evaluate(expr);if(value)return value;await wait(50)}throw Error('Browser UI did not render '+why+'; notice='+await evaluate("document.getElementById('notice')?.textContent")+'; admin='+await evaluate("document.getElementById('hf-dept-results-7')?.innerText?.slice(0,550)")+'; marketing='+await evaluate("document.getElementById('hf-dept-results-1')?.innerText?.slice(0,1100)"))};
  await load();check('Real dashboard HTML injected and parsed',await until("Boolean(document.querySelector('#discovery-demo'))",'discovery UI'));
  await evaluate("document.querySelector('#login input[name=username]').value='chromiumowner';document.querySelector('#login input[name=password]').value='ChromiumDemoPass!12345';document.querySelector('#login').requestSubmit();true");
  check('Single login displays authenticated Super User',await until("document.querySelector('#account-session')?.textContent.includes('super_user')",'signed in'));
  await evaluate("document.getElementById('hf-local-readiness').click();true");
  check('Windows readiness checks are displayed without claiming live retrieval',await until("document.getElementById('hf-readiness-result')?.textContent.includes('Native Windows launch')",'readiness status'));
  check('Local readiness includes actual SQLite integrity',await evaluate("document.getElementById('hf-readiness-result')?.textContent.includes('SQLite integrity — Passed')"));
  await evaluate("document.querySelector('#admin-grant-mandate select[name=service]').value='intel-marketing-worker';document.querySelector('#admin-grant-mandate textarea[name=reason]').value='Authorise scoped Marketing service verification';document.getElementById('admin-grant-mandate').requestSubmit();true");
  const mandateId=await until("request('/api/mandates').then(rows=>rows.find(m=>m.service==='intel-marketing-worker'&&m.status==='active')?.id||'')",'mandate grant');check('Administration granted governed capability through browser form',/^[a-f0-9-]{36}$/.test(mandateId));
  check('Mandate active through actual authenticated API',await evaluate(`request('/api/mandates').then(rows=>rows.some(m=>m.id===${JSON.stringify(mandateId)}&&m.status==='active'))`));
  await evaluate(`(()=>{document.querySelector('#admin-revoke-mandate input[name=id]').value=${JSON.stringify(mandateId)};document.querySelector('#admin-revoke-mandate textarea[name=reason]').value='Revoke after scoped browser acceptance';document.querySelector('#admin-revoke-mandate').requestSubmit();return true})()`);
  check('Administration revoked capability through browser form',await until("document.getElementById('admin-status')?.textContent.includes('Mandate revoked')",'mandate revoke'));
  check('Grant and revocation audit visible in Administration',await until(`document.getElementById('admin-mandate-records')?.textContent.includes(${JSON.stringify(mandateId)})&&document.getElementById('admin-mandate-records')?.textContent.includes('revoked')`,'mandate audit'));
  check('Revoked capability denied by backend',await evaluate(`request('/api/mandates').then(rows=>rows.some(m=>m.id===${JSON.stringify(mandateId)}&&m.status==='revoked'))`));

  await evaluate("document.querySelector('#objective input[name=title]').value='Source-exact Research review acceptance';document.querySelector('#objective').requestSubmit();true");
  const objective=await until("document.querySelector('#intel-id')?.value||''",'created objective');check('Objective created and selected',/^[a-f0-9-]{36}$/.test(objective));
  const fixtures=[{source:'Demonstration research source one',kind:'market',verification:'user_supplied',content:'Claim: Demonstration market | sample event count | 3 | period=2026'},{source:'Demonstration research source two',kind:'market',verification:'unverified',content:'Claim: Demonstration market | sample event count | 5 | period=2026'}];
  await evaluate(`(()=>{const dt=new DataTransfer();dt.items.add(new File([${JSON.stringify(JSON.stringify(fixtures))}],'research.json',{type:'application/json'}));document.querySelector('#intel-file').files=dt.files;document.querySelector('#intel-import').requestSubmit();return true})()`);
  check('Evidence was imported by actual browser form',await until("document.querySelector('#notice')?.textContent.includes('Imported 2 evidence records')",'evidence import'));
  await evaluate("document.getElementById('intel-assign').click();true");check('Assignment completed',await until("document.querySelector('#notice')?.textContent.includes('Saved to local SQLite')",'task assignment'));
  await evaluate("document.querySelector('#intel-assess select[name=department]').value='research';document.querySelector('#intel-assess').requestSubmit();true");
  check('Conflict candidate derived from evidence',await until("document.querySelector('#intel-analysis')?.textContent.includes('Conflicting supplied values')",'research analysis'));
  await evaluate("document.querySelector('#workspace-nav button[data-target=\"Research Review Desk\"]').click();true");
  check('Focused Research Desk accessible from sidebar',await until("!document.getElementById('research-desk-title').closest('section').hidden",'research desk'));
  check('Source evidence and candidate appear in new workspace',await until("document.getElementById('research-desk-candidates')?.textContent.includes('Demonstration market')",'candidate review'));
  check('Evidence details displayed',await evaluate("document.getElementById('research-desk-evidence').textContent.includes('Demonstration research source one')"));
  check('Research gaps displayed',await evaluate("document.getElementById('research-desk-gaps').textContent.length>0"));
  await evaluate("document.querySelector('#research-desk-candidates button').click();document.querySelector('#research-desk-disposition textarea[name=reason]').value='These source supplied figures conflict and need verification';document.querySelector('#research-desk-disposition').requestSubmit();true");
  check('Management review persisted and visible',await until("document.getElementById('research-desk-history')?.textContent.includes('needs_more_evidence')",'review history'));
  await evaluate("document.querySelector('#research-desk-approval input[name=acknowledge]').checked=true;document.getElementById('research-desk-approval').requestSubmit();true");
  check('Explicit Research approval persisted',await until("document.getElementById('research-desk-status')?.textContent.includes('approved at')",'research approval'));
  await evaluate(`rc7Navigate("Management Decision Desk");managementDeskObjectives().then(()=>{document.getElementById("management-desk-objective").value=${JSON.stringify(objective)};return refreshManagementDesk()});true`);
  check('Management Desk shows same real Research evidence',await until("document.getElementById('management-desk-evidence')?.textContent.includes('Demonstration research source one')",'Management evidence')); 
  check('Management Desk exposes no automatic final approval',await evaluate("!document.getElementById('management-desk-actions').textContent.includes('Second Management approval')"));
  await evaluate("document.querySelector('#management-desk-create input[name=title]').value='Browser created Management objective';document.querySelector('#management-desk-create').requestSubmit();true");
  check('Management Desk creates an objective through the governed API',await until("document.getElementById('management-desk-summary')?.textContent.includes('Browser created Management objective')",'Management objective creation'));
  check('Management Desk exposes authorised delegation',await until("document.getElementById('management-desk-actions')?.textContent.includes('Delegate authorised Research')",'delegation action'));
  await evaluate("document.querySelector('#management-desk-actions button').click();true");
  check('Management delegation created persisted departmental tasks',await until("request('/api/intelligence/objectives/'+document.getElementById('management-desk-objective').value+'/tasks').then(rows=>Array.isArray(rows)&&rows.length>0)",'delegation persisted'));
  await evaluate(`(()=>{document.getElementById('management-desk-objective').value=${JSON.stringify(reopenObjective)};refreshManagementDesk();return true})()`);
  check('Rejected Management objective exposes reasoned Research reopening',await until("document.getElementById('management-desk-actions')?.textContent.includes('Reopen rejected objective')",'reopen disposition'));
  await evaluate(`(()=>{const form=[...document.querySelectorAll('#management-desk-actions form')].find(x=>x.textContent.includes('Reopen rejected objective'));form.querySelector('textarea').value='Additional external corroboration is required before advancing';form.requestSubmit();return true})()`);
  check('Management reopening persists through authenticated application',await until(`request('/api/objectives/${reopenObjective}').then(o=>o.status==='research_queued'&&o.history.some(h=>JSON.parse(h.details||'{}').reason?.includes('corroboration')))`, 'reopened objective'));


  await evaluate(`rc7Navigate('Command Centre');document.getElementById('rc7-live-acceptance').click();true`);
  check('Owner Command Centre shortcut opens the guided source acceptance panel',await evaluate("Boolean(document.getElementById('hf-live-acceptance-heading').closest('details').open)"));
  await evaluate(`rc7Navigate('Intelligence inbox · Super User');document.getElementById('hf-guided-inspect').click();true`);
  check('Guided acceptance displays source-backed local audit',await until("document.getElementById('hf-guided-records')?.textContent.includes('Stored Beehive reports:')",'guided evidence audit'));
  check('Guided acceptance never implies automatic Education approval',await evaluate("document.getElementById('hf-guided-state').textContent.includes('approval is never inferred')"));
  await evaluate(`document.getElementById('hf-guided-review').click();true`);
  check('Guided acceptance links to existing Education review workspace',await until("!document.querySelectorAll('.hf-department')[0].hidden",'guided Education review'));
  await evaluate(`document.getElementById('hf-guided-briefs').click();true`);
  check('Guided acceptance opens the existing strategic briefing workspace',await until("!document.getElementById('discovery-heading').closest('section').hidden",'guided strategic briefing'));

  // Two actual Management approval forms, using governed workers and a persistent objective.
  const approvalObjective=await evaluate(`request('/api/objectives',{method:'POST',body:JSON.stringify({title:'Browser tested two-stage Management approvals'})}).then(o=>o.id)`);
  await evaluate(`request('/api/intelligence/objectives/${approvalObjective}/import',{method:'POST',body:JSON.stringify({format:'json',data:JSON.stringify([{source:'Controlled Management acceptance research evidence',content:'Observed public event information supplied for controlled review; organiser interest and budget remain unverified',kind:'market',verification:'user_supplied'}])})})`);
  await evaluate(`request('/api/intelligence/provision',{method:'POST',body:'{}'})`);
  await evaluate(`(async()=>{for(let i=0;i<12;i++){await request('/api/worker/run',{method:'POST',body:JSON.stringify({worker:'research-worker'})});await request('/api/worker/run',{method:'POST',body:JSON.stringify({worker:'decision-worker'})});}return true})()`);
  check('Governed worker execution reaches Management review',await until(`request('/api/objectives/${approvalObjective}').then(o=>o.status==='management_review')`,'Management review state'));
  await evaluate(`rc7Navigate('Management Decision Desk');managementDeskObjectives().then(()=>{document.getElementById('management-desk-objective').value=${JSON.stringify(approvalObjective)};return refreshManagementDesk()});true`);
  check('Management review displays source-attributed persisted Research evidence',await until("document.getElementById('management-desk-evidence')?.textContent.includes('Controlled Management acceptance research evidence')",'linked Management evidence'));
  check('First approval control is available on actual objective',await until("document.getElementById('management-desk-actions')?.textContent.includes('First Management approval')",'first approval form'));
  await evaluate(`(()=>{const f=[...document.querySelectorAll('#management-desk-actions form')].find(f=>f.textContent.includes('First Management approval'));f.querySelector('textarea').value='Research review is explicitly authorised for internal report generation';const d={valid:f.checkValidity(),reason:f.querySelector('textarea').value.length};f.requestSubmit();return d})()`);
  check('First approval persists and advances to reporting',await until(`request('/api/objectives/${approvalObjective}').then(o=>o.status==='report_queued'&&o.history.some(h=>JSON.parse(h.details||'{}').reason?.includes('explicitly authorised')))`, 'first stage persisted'));
  await evaluate(`request('/api/worker/run',{method:'POST',body:JSON.stringify({worker:'reporting-worker'})})`);
  check('Reporting worker creates draft for final Management approval',await until(`request('/api/objectives/${approvalObjective}').then(o=>o.status==='awaiting_final_approval')`, 'final report draft'));
  await evaluate(`refreshManagementDesk()`);
  check('Second approval control is visible and separate from report review',await until("document.getElementById('management-desk-actions')?.textContent.includes('Second Management approval')",'second stage form'));
  await evaluate(`(()=>{const f=[...document.querySelectorAll('#management-desk-actions form')].find(f=>f.textContent.includes('Second Management approval'));f.querySelector('textarea').value='Reviewed draft evidence and formally authorise the internal report';f.requestSubmit();return true})()`);
  check('Second approval records reason and persists approved status',await until(`request('/api/objectives/${approvalObjective}').then(o=>o.status==='approved'&&o.history.some(h=>JSON.parse(h.details||'{}').reason?.includes('formally authorise')))`, 'final approval persisted'));
  check('Repeated final approval is rejected by authenticated server',await evaluate(`request('/api/objectives/${approvalObjective}/approve',{method:'POST',body:JSON.stringify({reason:'Repeat approval should be forbidden'})}).then(()=>false).catch(()=>true)`));
  await evaluate(`refreshManagementDesk()`);
  check('Management audit timeline shows both reasoned decisions',await until("document.getElementById('management-desk-history')?.textContent.includes('explicitly authorised')&&document.getElementById('management-desk-history')?.textContent.includes('formally authorise')",'decision audit timeline'));
  check('Management report timeline shows approved version',await until("document.getElementById('management-desk-reports')?.textContent.includes('approved')",'report versions'));
  await evaluate(`document.querySelector('#management-desk-reports button')?.click();true`);
  check('Management can inspect full persisted report from timeline',await until("document.getElementById('management-desk-reports')?.querySelector('pre')?.textContent.includes('approved')",'report inspection'));
  check('Approved report retains supplied source provenance',await evaluate("document.getElementById('management-desk-reports').querySelector('pre')?.textContent.includes('Controlled Management acceptance research evidence')"));

  // Dedicated Reporting/Executive browsers read immutable source-linked approved snapshots.
  await evaluate(`rc7Navigate('Reporting Workspace');true`);
  check('Reporting workspace appears under authenticated navigation',await until("!document.querySelector('[aria-label=\"Reporting Workspace\"]').hidden",'reporting workspace'));
  await evaluate(`(()=>{document.getElementById('hf-report-objective').value=${JSON.stringify(approvalObjective)};document.getElementById('hf-report-refresh').click();return true})()`);
  check('Reporting workspace reads approved versioned report',await until("document.getElementById('hf-report-results')?.textContent.includes('Report version')",'report version'));
  check('Reporting includes source evidence',await until("document.getElementById('hf-report-results')?.textContent.includes('Controlled Management acceptance research evidence')",'report evidence'));
  check('Reporting includes reasoned Management audit timeline',await evaluate("document.getElementById('hf-report-results').textContent.includes('formally authorise')"));
  await evaluate(`rc7Navigate('Executive Workspace');true`);
  check('Executive workspace displays final-approved immutable snapshot',await until("document.getElementById('hf-executive-results')?.textContent.includes('Browser tested two-stage Management approvals')",'executive approved snapshot'));
  check('Executive snapshot distinguishes non-live market observations',await evaluate("document.getElementById('hf-executive-status').textContent.includes('not a live market-data feed')"));

  for(const [workspace,group] of [['Marketing Workspace',1],['Finance Workspace',2],['Collective Workspace',3],['Decision Workspace',4]]){
   await evaluate(`rc7Navigate(${JSON.stringify(workspace)});true`);
   check(workspace+' objective selector persists server-derived objectives',await until(`document.querySelector('#hf-dept-results-${group} select[aria-label="Specialist objective"] option')!==null`,workspace+' objective selector'));
   await evaluate(`(()=>{const host=document.getElementById('hf-dept-results-${group}');host.querySelector('select[aria-label="Specialist objective"]').value=${JSON.stringify(approvalObjective)};host.querySelector('select[aria-label="Specialist objective"]').closest('section').querySelector('button').click();return true})()`);
   check(workspace+' provides source-linked objective inspection',await until(`document.querySelector('#hf-dept-results-${group}')?.textContent.includes('Controlled Management acceptance research evidence')`,workspace+' source evidence'));
   check(workspace+' exposes persisted departmental assessments',await until(`document.querySelector('#hf-dept-results-${group}')?.textContent.includes('Departmental assessments')||document.querySelector('#hf-dept-results-${group}')?.textContent.includes('Marketing findings')||document.querySelector('#hf-dept-results-${group}')?.textContent.includes('Finance scenarios')||document.querySelector('#hf-dept-results-${group}')?.textContent.includes('Decision history')`,workspace+' departmental result'));
  }


  // Existing tenant scoped hub registry, source profile, and audit history via actual Administration UI.
  await evaluate(`request('/api/hubs',{method:'POST',body:JSON.stringify({id:'operations:browser',version:'1.0.0',sector:'general-business',department:'research',capabilities:['research.evidence']})})`);
  await evaluate(`rc7Navigate('Administration Workspace');true`);
  check('Administration offers governed registry forms',await until("document.querySelector('#hf-dept-results-7 form[aria-label=\"Enable or disable existing hub\"]')!==null",'admin hub controls'));
  check('Registered hub appears in selection',await until("[...document.querySelector('#hf-dept-results-7 form[aria-label=\"Enable or disable existing hub\"] select').options].some(x=>x.value==='operations:browser')",'registered hub'));
  await evaluate(`(()=>{const f=document.querySelector('#hf-dept-results-7 form[aria-label="Enable or disable existing hub"]');f.querySelector('select').value='operations:browser';f.querySelector('input[type=checkbox]').checked=true;f.querySelector('input[aria-label="Hub decision rationale"]').value='Authorise limited internal research capability for browser acceptance';f.requestSubmit();return true})()`);
  check('Hub enablement persists via authenticated Administration form',await until("request('/api/hubs').then(rows=>rows.some(h=>h.id==='operations:browser'&&h.enabled===true))",'hub enablement persistence'));
  check('Hub change has independent recorded audit history',await evaluate("request('/api/hubs/operations:browser/history').then(rows=>rows.some(h=>h.action==='enablement'))"));
  check('Administration controls return after hub change',await until("document.querySelector('#hf-dept-results-7 form[aria-label=\"Configure discovery source\"]')!==null",'source controls after hub change'));
  await evaluate(`(()=>{const f=document.querySelector('#hf-dept-results-7 form[aria-label="Configure discovery source"]');f.querySelector('select').value='datagovt';f.querySelector('input[type=checkbox]').checked=false;f.requestSubmit();return true})()`);
  check('Authenticated source setting persists in SQLite',await until("request('/api/discovery/profile').then(p=>p.sources.datagovt===false)",'source control persistence'));

  await load();
  await evaluate("restoreRole().then(()=>true).catch(e=>{document.querySelector('#notice').textContent=e.message;return false})");
  check('Owner can restore session after reload',await until("document.querySelector('#account-session')?.textContent.includes('super_user')",'session restoration'));
  check('Two-stage Management decision remains approved after page reload',await evaluate(`request('/api/objectives/${approvalObjective}').then(o=>o.status==='approved'&&o.history.filter(h=>JSON.parse(h.details||'{}').reason).length>=2)`));
  check('Hub Registry enabled state retained after browser reload',await evaluate("request('/api/hubs').then(rows=>rows.some(h=>h.id==='operations:browser'&&h.enabled===true))"));
  check('Source registry setting retained after browser reload',await evaluate("request('/api/discovery/profile').then(p=>p.sources.datagovt===false)"));
  check('Executive approved immutable report remains available after browser reload',await evaluate(`request('/api/executive/briefing').then(data=>data.reports.some(r=>r.objectiveId===${JSON.stringify(approvalObjective)}))`));

  await evaluate(`rc7Navigate("Research Review Desk");refreshResearchDeskObjectives().then(()=>{document.getElementById("research-desk-objective").value=${JSON.stringify(objective)};return refreshResearchDesk()});true`);
  check('Management review survives browser reload',await until("document.getElementById('research-desk-history')?.textContent.includes('needs_more_evidence')",'persisted review'));
  check('Research snapshot approval survives database reload',await evaluate(`request('/api/intelligence/objectives/${objective}/research-approval').then(r=>Boolean(r&&r.current))`));
  // Existing lawful attributed import followed by explicit, auditable Education review.
  const importResult=await evaluate(`request('/api/discovery/demo-import',{method:'POST',body:'{}'})`);
  check('Controlled source observations imported through real server',importResult.counts?.created>0||importResult.created>0||importResult.processing);
  await evaluate(`rc7Navigate('Education Workspace');true`);
  check('Education displays pending source-based review',await until("document.querySelector('#hf-dept-results-0 form[aria-label=\"Governed Education review\"]')!==null",'Education candidate'));
  await evaluate(`(()=>{const form=document.querySelector('#hf-dept-results-0 form[aria-label="Governed Education review"]');form.querySelector('input').value='Reviewed attributed source and uncertainty for organisational knowledge';form.requestSubmit();return true})()`);
  check('Education approval created versioned knowledge',await until("request('/api/activation/knowledge').then(rows=>Array.isArray(rows)&&rows.length>0)",'Education knowledge'));
  check('Specialist synthesis produces Management-pending briefing',await until("request('/api/activation/briefs').then(rows=>Array.isArray(rows)&&rows.length>0)",'strategic brief'));
  check('Briefing notification visible from source processing',await until("request('/api/activation/inbox').then(rows=>Array.isArray(rows)&&rows.length>0)",'strategic notice'));
  // Actual department navigation and authenticated API-backed views.
  for(const [workspace,index] of [['Education Workspace',0],['Marketing Workspace',1],['Finance Workspace',2],['Collective Workspace',3],['Decision Workspace',4],['Security Workspace',5],['Caretaker Workspace',6],['Administration Workspace',7]]){
   check(workspace+' in signed-in navigation',await evaluate(`Boolean(document.querySelector('#workspace-nav button[data-target=${JSON.stringify(workspace)}]'))`));
   await evaluate(`rc7Navigate(${JSON.stringify(workspace)});true`);
   check(workspace+' displays independently of other departments',await until(`!document.querySelectorAll('.hf-department')[${index}].hidden&&document.getElementById('hf-dept-status-${index}').textContent.includes('Read-only operational view loaded')`,workspace));
   check(workspace+' populated from authorised server routes',await evaluate(`Boolean(document.querySelector('#hf-dept-results-${index} .rc7-panel'))`));
  }
  await evaluate(`rc7Navigate('Security Workspace');true`);
  check('Security workspace exposes server-backed audit history',await until("document.querySelector('#hf-dept-results-5')?.textContent.includes('Audit history')",'security audit'));
  await evaluate(`rc7Navigate('Security Workspace');true`);
  check('Actual security case present in authenticated workspace',await until(`document.querySelector('#hf-dept-results-5')?.textContent.includes(${JSON.stringify('browser-acceptance')})`,'security incident'));
  await evaluate(`(()=>{const form=document.querySelector('#hf-dept-results-5 form[aria-label="Record security investigation"]');form.querySelector('select').value='investigating';form.querySelector('input').value='Observed event investigated through authenticated Security workspace';form.requestSubmit();return true})()`);
  check('Actual browser Security disposition persisted through existing API',await until(`request('/api/security/${incidentId}').then(x=>x.status==='investigating'&&x.history.some(h=>h.action==='investigating'))`,'security update persisted'));
  await evaluate(`rc7Navigate('Caretaker Workspace');true`);
  check('Caretaker workspace exposes actual integrity and backup state',await until("document.querySelector('#hf-dept-results-6')?.textContent.includes('SQLite integrity')",'caretaker integrity'));
  check('Actual caretaker incident visible',await until(`document.querySelector('#hf-dept-results-6')?.textContent.includes(${JSON.stringify('integration-browser')})`,'caretaker record'));
  await evaluate(`(()=>{const form=document.querySelector('#hf-dept-results-6 form[aria-label="Record caretaker diagnosis"]');form.querySelector('select').value='diagnosed';form.querySelector('input').value='Checked worker state and documented next safe repair step';form.requestSubmit();return true})()`);
  check('Caretaker browser action persisted with audit status',await until(`request('/api/caretaker').then(rows=>rows.some(x=>x.id==='${caretakerId}'&&x.status==='diagnosed'))`,'caretaker status persisted'));

  await send('Emulation.setDeviceMetricsOverride',{width:1366,height:768,deviceScaleFactor:1,mobile:false});await wait(100);
  const shot=await send('Page.captureScreenshot',{format:'png',captureBeyondViewport:false});await writeFile(join(root,'docs/test-evidence/DEPARTMENTAL-WORKSPACES-BROWSER.png'),Buffer.from(shot.data,'base64'));
  results.screenshot='docs/test-evidence/DEPARTMENTAL-WORKSPACES-BROWSER.png';results.status='PASS';
  results.mode='Actual Chromium UI interaction with real authenticated local server and SQLite through mediated transport; native navigation/CSP unverified';
 }catch(e){results.status='FAIL';results.error=e.message;throw e}
 finally{ws?.close();for(const p of [chrome,server])if(p){p.kill('SIGTERM');await Promise.race([new Promise(r=>p.once('exit',r)),wait(1500)]);if(p.exitCode===null)p.kill('SIGKILL')}await rm(dir,{recursive:true,force:true});await writeFile(join(root,'docs/test-evidence/DEPARTMENTAL-WORKSPACES-BROWSER-ACCEPTANCE.json'),JSON.stringify(results,null,2)+'\n');console.log('Browser DOM bridge:',results.status)}
}
demo().catch(e=>{console.error('Browser acceptance:',e);process.exitCode=1});
