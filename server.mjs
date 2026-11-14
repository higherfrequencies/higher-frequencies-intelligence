import {operationalAcceptance} from './core/operational-acceptance.mjs';
import {OperationalScheduler} from './core/operational-scheduler.mjs';
import {AdaptiveMonitoring} from './core/adaptive-monitoring.mjs';
import {RC7Orchestration} from './core/rc7-orchestration.mjs';
import {sourceRegistry} from './core/source-registry.mjs';
import {PublicExplorer} from './core/public-explorer.mjs';
import {createServer} from 'node:http';
import {readFile,mkdir,readdir,stat,chmod} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,join} from 'node:path';
import {TransactionalStore} from './core/transactional-store.mjs';
import {IdentityService} from './core/security/auth.mjs';
import {SecureWorkflow} from './core/secure-workflow.mjs';
import {DepartmentAutomation} from './core/automation.mjs';
import {ServiceCredentials} from './core/security/service-credentials.mjs';
import {backupDatabase} from './core/backup.mjs';
import {databaseIntegrity,auditSummary} from './core/operational-diagnostics.mjs';
import {IntelligenceWorkbench} from './core/intelligence-workbench.mjs';
import {PublicResearch} from './core/public-research.mjs';
import {DecisionWorkbench} from './core/decision-workbench.mjs';
import {MarketingWorkspace} from './core/marketing-workspace.mjs';
import {MarketingRecommendations} from './core/marketing-recommendations.mjs';
import {FinanceWorkspace} from './core/finance-workspace.mjs';
import {CollectiveReviews} from './core/collective-reviews.mjs';
import {ExecutiveBriefing} from './core/executive-briefing.mjs';
import {OrganisationDirectory} from './core/organisation-directory.mjs';
import {CommercialFollowups} from './core/commercial-followups.mjs';
import {SectorSpecialists} from './core/sector-specialists.mjs';
import {EcosystemCoordinator} from './core/ecosystem-coordinator.mjs';
import {IntelligenceCity} from './core/intelligence-city.mjs';
import {HubRegistry} from './core/hub-registry.mjs';
import {LiveIntelligence} from './core/live-intelligence.mjs';
import {ActivationIntelligence} from './core/activation-intelligence.mjs';
import {randomBytes,createHash} from 'node:crypto';
const root=dirname(fileURLToPath(import.meta.url));const path=process.env.HF_DB||join(root,'data/runtime/ecosystem.sqlite');await mkdir(dirname(path),{recursive:true});const store=await TransactionalStore.open(path);const identity=new IdentityService(store),workflow=new SecureWorkflow(store,identity);new ServiceCredentials(store).bootstrapRuntime();const intelligence=new IntelligenceWorkbench(store,identity);const publicResearch=new PublicResearch(store,intelligence);const decisionWorkbench=new DecisionWorkbench(store,intelligence);const marketingWorkspace=new MarketingWorkspace(store,intelligence);const marketingRecommendations=new MarketingRecommendations(store,intelligence);const financeWorkspace=new FinanceWorkspace(store,intelligence);const collectiveReviews=new CollectiveReviews(store,intelligence);const executiveBriefing=new ExecutiveBriefing(store,intelligence);const organisationDirectory=new OrganisationDirectory(store,intelligence);const commercialFollowups=new CommercialFollowups(store,intelligence);const sectorSpecialists=new SectorSpecialists(store,intelligence);const automation=new DepartmentAutomation(workflow,{workbench:intelligence});const coordinator=new EcosystemCoordinator(store,intelligence,automation.orchestration,sectorSpecialists);automation.coordinator=coordinator;coordinator.reconcileSystem();const hubs=new HubRegistry(store);coordinator.hubs=hubs;const city=new IntelligenceCity(store,identity,sectorSpecialists,coordinator,automation.orchestration,hubs);if(process.env.HF_AUTOWORKERS!=='0')automation.start();const liveIntelligence=new LiveIntelligence(store,identity);const monitoring=new AdaptiveMonitoring(store,identity);liveIntelligence.monitor=monitoring;const activationIntelligence=new ActivationIntelligence(store,identity,liveIntelligence);const rc7=new RC7Orchestration(store,identity,liveIntelligence,activationIntelligence);const scheduler=new OperationalScheduler(store,identity,liveIntelligence,rc7,{monitoring});if(process.env.HF_SOURCE_SCHEDULER!=='0')scheduler.start();const port=Number(process.env.PORT||4173);
const json=(res,status,data)=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8'}).end(JSON.stringify(data))};
const readBody=async req=>{let text='';for await(const chunk of req){text+=chunk;if(text.length>16384)throw Error('Body too large')}return JSON.parse(text||'{}')};
const token=req=>(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('hf_session='))?.slice(11);
const cookie=(value,maxAge)=>`hf_session=${value}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${maxAge}${process.env.HF_HTTPS==='1'?'; Secure':''}`;
const csrf=new Map();const loginFailures=new Map();const activeStreams=new Set();
const buildInfo=JSON.parse(await readFile(join(root,'build-info.json'),'utf8'));
const publicSnapshot=JSON.parse(await readFile(join(root,'data/activation/christchurchnz-events-2026-11-13.json'),'utf8'));const publicExplorer=new PublicExplorer(publicSnapshot);
const dashboardHtml=await readFile(join(root,'dashboard/index.html'),'utf8');const inlineScript=dashboardHtml.match(/<script>([\s\S]*?)<\/script>/)?.[1]||'';const scriptHash=createHash('sha256').update(inlineScript).digest('base64');
const server=createServer(async(req,res)=>{res.setHeader('Cache-Control','no-store');res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('X-Frame-Options','DENY');res.setHeader('Referrer-Policy','no-referrer');res.setHeader('Content-Security-Policy',`default-src 'self'; connect-src 'self'; script-src 'self' 'sha256-${scriptHash}'; style-src 'self' 'unsafe-inline'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'`);const url=new URL(req.url,'http://localhost');const user=identity.authenticate(token(req));try{
 if(req.method==='GET'&&(url.pathname==='/'||url.pathname==='/index.html')){res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}).end(dashboardHtml);return}
 if(req.method==='GET'&&url.pathname==='/api/public/explorer')return json(res,200,publicExplorer.search({q:url.searchParams.get('q')||'',type:url.searchParams.get('type')||'',region:url.searchParams.get('region')||''}));
 if(req.method==='GET'&&url.pathname==='/api/build')return json(res,200,buildInfo);
 if(req.method==='GET'&&url.pathname==='/favicon.ico'){res.writeHead(204).end();return}
 if(req.method==='POST'){const origin=req.headers.origin;if(origin&&new URL(origin).host!==req.headers.host)return json(res,403,{error:'Forbidden'});if(user&&url.pathname!=='/api/logout'&&req.headers['x-hf-csrf']!==csrf.get(token(req)))return json(res,403,{error:'CSRF validation failed'});}
 if(url.pathname==='/api/login'&&req.method==='POST'){const ip=req.socket.remoteAddress||'unknown';const state=loginFailures.get(ip)||{n:0,until:0};if(state.until>Date.now())return json(res,429,{error:'Too many attempts'});const b=await readBody(req);let session;try{session=identity.login(b.username,b.password)}catch(e){state.n++;state.until=state.n>=5?Date.now()+60000:0;loginFailures.set(ip,state);workflow.incidents.record({category:'authentication_failure',actor:String(b.username||'anonymous').slice(0,64),resource:'login'});throw e}loginFailures.delete(ip);const csrfToken=randomBytes(24).toString('base64url');csrf.set(session.token,csrfToken);res.setHeader('Set-Cookie',cookie(session.token,28800));return json(res,200,{authenticated:true,expires:session.expires,csrf:csrfToken})}
 if(url.pathname==='/api/logout'&&req.method==='POST'){if(user){identity.audit(user.id,'session.revoked');identity.logout(token(req));csrf.delete(token(req))}res.setHeader('Set-Cookie',cookie('',0));return json(res,200,{ok:true})}
 if(!user){identity.audit('anonymous','http.denied',{route:url.pathname});return json(res,401,{error:'Authentication required'})}
 // RC5 shared-evidence Education, Marketing, Finance, Collective and Decision assessments.
 if(url.pathname==='/api/monitoring/summary'&&req.method==='GET')return json(res,200,monitoring.summary(user));
 if(url.pathname==='/api/monitoring/items'&&req.method==='GET')return json(res,200,monitoring.list(user,{dueOnly:url.searchParams.get('due')==='1'}));
 if(url.pathname==='/api/monitoring/claim-reviews'&&req.method==='GET')return json(res,200,monitoring.claimReviews(user));
 if(url.pathname==='/api/operations/schedules'&&req.method==='GET')return json(res,200,scheduler.list(user));
 if(url.pathname==='/api/operations/schedules'&&req.method==='POST')return json(res,200,scheduler.configure(user,await readBody(req)));
 if(url.pathname==='/api/rc7/queue'&&req.method==='GET')return json(res,200,rc7.list(user));
 if(url.pathname==='/api/operations/acceptance'&&req.method==='GET')return json(res,200,operationalAcceptance(user,{identity,store,flow:rc7,activation:activationIntelligence,scheduler,provider:url.searchParams.get('provider')||'beehive'}));
 if(url.pathname==='/api/rc81/evidence-audit'&&req.method==='GET')return json(res,200,rc7.evidenceAudit(user,{provider:url.searchParams.get('provider')||'beehive',limit:url.searchParams.get('limit')||100}));
 if(url.pathname==='/api/rc7/reconcile'&&req.method==='POST')return json(res,200,rc7.reconcile(user,await readBody(req)));
 const rc7Approve=url.pathname.match(/^\/api\/rc7\/reports\/([a-f0-9-]+)\/review$/);
 if(rc7Approve&&req.method==='POST')return json(res,201,rc7.approve(user,rc7Approve[1],await readBody(req)));
 if(url.pathname==='/api/learning/lessons'&&req.method==='GET')return json(res,200,activationIntelligence.lessons(user,{status:url.searchParams.get('status')||''}));
 if(url.pathname==='/api/learning/lessons'&&req.method==='POST'){const b=await readBody(req);return json(res,201,activationIntelligence.evaluate(user,b.reportId,b));}
 const learningReview=url.pathname.match(/^\/api\/learning\/lessons\/([a-f0-9-]+)\/review$/);
 if(learningReview&&req.method==='POST')return json(res,200,activationIntelligence.reviewLesson(user,learningReview[1],await readBody(req)));
 const learningReuse=url.pathname.match(/^\/api\/learning\/briefs\/([a-f0-9-]+)\/reuse$/);
 if(learningReuse&&req.method==='GET')return json(res,200,activationIntelligence.reuse(user,{briefId:learningReuse[1]}));
 if(url.pathname==='/api/activation/summary'&&req.method==='GET')return json(res,200,activationIntelligence.summary(user));
 if(url.pathname==='/api/activation/knowledge'&&req.method==='GET')return json(res,200,activationIntelligence.knowledge(user,{q:url.searchParams.get('q')||''}));
 if(url.pathname==='/api/activation/inbox'&&req.method==='GET')return json(res,200,activationIntelligence.notices(user));
 const activationNotice=url.pathname.match(/^\/api\/activation\/inbox\/([a-f0-9-]+)\/read$/);
 if(activationNotice&&req.method==='POST')return json(res,200,activationIntelligence.readNotice(user,activationNotice[1]));
 if(url.pathname==='/api/activation/signals'&&req.method==='GET')return json(res,200,activationIntelligence.signals(user));
 if(url.pathname==='/api/activation/forecast-readiness'&&req.method==='GET')return json(res,200,activationIntelligence.readiness(user));
 if(url.pathname==='/api/activation/briefs'&&req.method==='GET')return json(res,200,activationIntelligence.briefs(user));
 const activationBrief=url.pathname.match(/^\/api\/activation\/briefs\/([a-f0-9-]+)(?:\/(review))?$/);
 if(activationBrief){if(req.method==='GET'&&!activationBrief[2])return json(res,200,activationIntelligence.brief(user,activationBrief[1]));if(req.method==='POST'&&activationBrief[2])return json(res,200,activationIntelligence.review(user,activationBrief[1],await readBody(req)));}
 const activationKnowledge=url.pathname.match(/^\/api\/activation\/knowledge\/([a-f0-9-]+)(?:\/(revise))?$/);
 if(activationKnowledge){if(req.method==='GET'&&!activationKnowledge[2])return json(res,200,activationIntelligence.versions(user,activationKnowledge[1]));if(req.method==='POST'&&activationKnowledge[2])return json(res,201,activationIntelligence.revise(user,activationKnowledge[1],await readBody(req)));}
 const activationSource=url.pathname.match(/^\/api\/activation\/reports\/([a-f0-9-]+)\/(learn|synthesise|feedback)$/);
 if(activationSource&&req.method==='POST'){const id=activationSource[1],op=activationSource[2],b=await readBody(req);if(op==='learn')return json(res,201,activationIntelligence.acquire(user,id,b));if(op==='synthesise')return json(res,201,activationIntelligence.synthesise(user,id));if(op==='feedback')return json(res,201,activationIntelligence.feedback(user,id,b));}
 if(url.pathname==='/api/discovery/source-registry'&&req.method==='GET')return json(res,200,sourceRegistry.map(s=>({...s,automationVerified:liveIntelligence.catalogue(user).find(x=>x.id===s.id)?.operationalVerified===true,status:liveIntelligence.catalogue(user).find(x=>x.id===s.id)?.status||'not_implemented'})));
 if(url.pathname==='/api/discovery/catalogue'&&req.method==='GET')return json(res,200,liveIntelligence.catalogue(user));
 if(url.pathname==='/api/discovery/profile'&&req.method==='GET')return json(res,200,liveIntelligence.profile(user));
 if(url.pathname==='/api/discovery/profile'&&req.method==='POST')return json(res,200,liveIntelligence.configure(user,await readBody(req)));
 if(url.pathname==='/api/discovery/overview'&&req.method==='GET')return json(res,200,liveIntelligence.overview(user));
 if(url.pathname==='/api/discovery/inbox'&&req.method==='GET')return json(res,200,liveIntelligence.inbox(user));
 if(url.pathname==='/api/discovery/reports'&&req.method==='GET')return json(res,200,liveIntelligence.list(user,{q:url.searchParams.get('q')||'',priority:url.searchParams.get('priority')||'',status:url.searchParams.get('status')||''}));
 if(url.pathname==='/api/discovery/runs'&&req.method==='GET')return json(res,200,liveIntelligence.runs(user));
 if(url.pathname==='/api/discovery/import'&&req.method==='POST'){const result=liveIntelligence.ingest(user,await readBody(req));return json(res,201,{...result,processing:rc7.queueRun(user,result.runId)});}
 if(url.pathname==='/api/discovery/demo-import'&&req.method==='POST'){
  const sample=JSON.parse(await readFile(join(root,'data/activation/christchurchnz-events-2026-11-13.json'),'utf8'));
  const result=liveIntelligence.ingest(user,{provider:sample.provider,records:sample.records,method:'manual_attributed_import'});return json(res,201,{...result,processing:rc7.queueRun(user,result.runId),sampleMetadata:sample.metadata});
 }
 const discoveryRun=url.pathname.match(/^\/api\/discovery\/run\/(datagovt|ticketmaster|beehive)$/);
 if(discoveryRun&&req.method==='POST'){const result=await liveIntelligence.run(user,discoveryRun[1]);return json(res,201,{...result,processing:rc7.queueRun(user,result.runId)});}
 const discoveryReport=url.pathname.match(/^\/api\/discovery\/reports\/([a-f0-9-]+)(?:\/(review))?$/);
 if(discoveryReport){if(req.method==='GET'&&!discoveryReport[2])return json(res,200,liveIntelligence.get(user,discoveryReport[1]));if(req.method==='POST'&&discoveryReport[2])return json(res,200,liveIntelligence.review(user,discoveryReport[1],await readBody(req)));}
 const discoveryRead=url.pathname.match(/^\/api\/discovery\/inbox\/([a-f0-9-]+)\/read$/);
 if(discoveryRead&&req.method==='POST')return json(res,200,liveIntelligence.markRead(user,discoveryRead[1]));
 if(url.pathname==='/api/me'&&req.method==='GET')return json(res,200,user);
 if(url.pathname==='/api/executive/briefing'&&req.method==='GET')return json(res,200,executiveBriefing.list(user));
 if(url.pathname==='/api/csrf'&&req.method==='GET'){let current=csrf.get(token(req));if(!current){current=randomBytes(24).toString('base64url');csrf.set(token(req),current)}return json(res,200,{csrf:current})}
 if(url.pathname==='/api/users'&&req.method==='POST'){identity.require(user,['super_user']);const b=await readBody(req);return json(res,201,identity.createUser(b,user))}
 if(url.pathname==='/api/objectives'&&req.method==='POST'){const b=await readBody(req);return json(res,201,workflow.create(user,b.title))}
 if(url.pathname==='/api/objectives'&&req.method==='GET')return json(res,200,workflow.list(user));
 const match=url.pathname.match(/^\/api\/objectives\/([a-f0-9-]+)(?:\/(review|reject|approve|decline|reopen))?$/);
 if(match){if(req.method==='GET'&&!match[2])return json(res,200,workflow.get(user,match[1]));if(req.method==='POST'&&match[2])return json(res,200,workflow.transition(user,match[1],match[2],await readBody(req)))}
 const reportReviewRoute=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/reports\/(reviews|revise)$/);
 if(reportReviewRoute){const id=reportReviewRoute[1],op=reportReviewRoute[2];if(req.method==='GET'&&op==='reviews')return json(res,200,workflow.intelReports.reviews(user,id));if(req.method==='POST'&&op==='reviews')return json(res,201,workflow.intelReports.review(user,id,await readBody(req)));if(req.method==='POST'&&op==='revise')return json(res,201,workflow.intelReports.revise(user,id));}
 const reportRoute=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/reports(?:\/export)?$/);
 if(reportRoute&&req.method==='GET'){
  const id=reportRoute[1];
  if(url.pathname.endsWith('/export'))return json(res,200,JSON.parse(workflow.intelReports.export(user,id)));
  return json(res,200,workflow.intelReports.list(user,id));
 }
 if(url.pathname==='/api/intelligence/provision'&&req.method==='POST'){
  identity.require(user,['management','super_user']);
  // One explicit Management action provisions both historic reporting workflow and
  // cross-department workers. No credentials are returned to the browser.
  const legacy=[['research-worker','research',['research.requested','decision.requested'],['research-worker','decision-worker']],['decision-worker','decision',['decision.requested'],['decision-worker']],['reporting-worker','reporting',['report.requested'],['reporting-worker']]];
  const workflowIds=[];
  for(const [service,department,types,destinations] of legacy){
   if(types.every(type=>destinations.some(d=>workflow.mandates.check(service,user.tenant,type,d))))continue;
   workflowIds.push(workflow.mandates.create(user,{service,department,tenant:user.tenant,types,destinations,expiresAt:Date.now()+30*86400000}));
  }
  return json(res,201,{workflowMandatesCreated:workflowIds.length,departments:automation.orchestration.provision(user,user.tenant).map(({department})=>department)});
 }
 const coordinatorRoute=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/coordination(?:\/(route|history|reconcile|states|capabilities|traffic))?$/);
 if(coordinatorRoute){const id=coordinatorRoute[1],op=coordinatorRoute[2];if(req.method==='GET'&&!op)return json(res,200,coordinator.overview(user,id));if(req.method==='GET'&&op==='history')return json(res,200,coordinator.history(user,id));if(req.method==='GET'&&op==='states')return json(res,200,coordinator.stateHistory(user,id));if(req.method==='GET'&&op==='capabilities')return json(res,200,coordinator.capabilities(user,id,url.searchParams.get('sector')||'general-business'));if(req.method==='GET'&&op==='traffic')return json(res,200,coordinator.trafficDecision(user,id,{sector:url.searchParams.get('sector')||'general-business',department:url.searchParams.get('department')||'research',classification:url.searchParams.get('classification')||'internal'}));if(req.method==='POST'&&op==='reconcile')return json(res,200,coordinator.reconcile(user,id));if(req.method==='POST'&&op==='route')return json(res,201,coordinator.route(user,id,await readBody(req)));}
 if(url.pathname==='/api/hubs'&&req.method==='GET')return json(res,200,hubs.listScoped(user,identity));
 if(url.pathname==='/api/hubs'&&req.method==='POST')return json(res,201,hubs.registerScoped(user,await readBody(req),identity));
 const hubRoute=url.pathname.match(/^\/api\/hubs\/([-a-z0-9:]{3,80})\/(enable|history|invoke)$/);
 if(hubRoute&&hubRoute[2]==='invoke'&&req.method==='POST'){const body=await readBody(req);return json(res,201,hubs.invokeScoped(user,body.objectiveId,{hubId:hubRoute[1],capability:body.capability},identity,sectorSpecialists));}
 if(hubRoute&&hubRoute[2]==='history'&&req.method==='GET')return json(res,200,hubs.scopedHistory(user,hubRoute[1],identity));
 if(hubRoute&&hubRoute[2]==='enable'&&req.method==='POST'){const body=await readBody(req);return json(res,200,hubs.setScopedEnabled(user,hubRoute[1],body.enabled,body.reason,identity));}
 if(url.pathname==='/api/sectors'&&req.method==='GET')return json(res,200,sectorSpecialists.list(user));
 const sectorRoute=url.pathname.match(/^\/api\/sectors\/([a-z-]+)\/enable$/);
 if(sectorRoute&&req.method==='POST'){const b=await readBody(req);return json(res,200,sectorSpecialists.setEnabled(user,sectorRoute[1],b.enabled,b.reason));}
 const specialistRoute=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/specialists(?:\/(invoke))?$/);
 if(specialistRoute){const id=specialistRoute[1];if(req.method==='GET'){
  const sector=url.searchParams.get('sector');return json(res,200,sector?sectorSpecialists.discover(user,id,sector):sectorSpecialists.history(user,id));
 }if(req.method==='POST'&&specialistRoute[2]==='invoke')return json(res,201,sectorSpecialists.invoke(user,id,await readBody(req)));}
 const commercialRoute=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/commercial\/(followups|followup-state|proposals|proposal-reviews)$/);
 if(commercialRoute){const id=commercialRoute[1],operation=commercialRoute[2];if(req.method==='GET'&&(operation==='followups'||operation==='proposals'))return json(res,200,commercialFollowups.list(user,id));if(req.method==='POST'&&operation==='followups')return json(res,201,commercialFollowups.schedule(user,id,await readBody(req)));if(req.method==='POST'&&operation==='followup-state')return json(res,201,commercialFollowups.transition(user,id,await readBody(req)));if(req.method==='POST'&&operation==='proposals')return json(res,201,commercialFollowups.prepareProposal(user,id,await readBody(req)));if(req.method==='POST'&&operation==='proposal-reviews')return json(res,201,commercialFollowups.reviewProposal(user,id,await readBody(req)));}
 const nzbnImport=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/organisations\/nzbn-csv$/);
 if(nzbnImport&&req.method==='POST')return json(res,201,organisationDirectory.importNzbnCsv(user,nzbnImport[1],await readBody(req)));
 const orgImport=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/organisations\/import$/);
 if(orgImport&&req.method==='POST')return json(res,201,organisationDirectory.importEvidence(user,orgImport[1],await readBody(req)));
 const quarterRoute=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/organisations\/quarterly$/);
 if(quarterRoute&&req.method==='GET')return json(res,200,organisationDirectory.quarterlyProgress(user,quarterRoute[1],{year:url.searchParams.get('year')||undefined,quarter:url.searchParams.get('quarter')||undefined}));
 const classificationRoute=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/organisations\/([a-f0-9-]+)\/classifications$/);
 if(classificationRoute&&req.method==='POST')return json(res,201,organisationDirectory.classify(user,classificationRoute[1],classificationRoute[2],await readBody(req)));
 const orgAssessmentRoute=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/organisations\/([a-f0-9-]+)\/assessments(?:\/(review))?$/);
 if(orgAssessmentRoute){const id=orgAssessmentRoute[1],org=orgAssessmentRoute[2],action=orgAssessmentRoute[3];if(req.method==='GET'&&!action)return json(res,200,organisationDirectory.assessmentHistory(user,id,org));if(req.method==='POST'&&!action)return json(res,201,organisationDirectory.assess(user,id,org));if(req.method==='POST'&&action==='review')return json(res,201,organisationDirectory.reviewAssessment(user,id,org,await readBody(req)));}
 const orgProfileRoute=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/organisations\/([a-f0-9-]+)\/profile$/);
 if(orgProfileRoute&&req.method==='GET')return json(res,200,organisationDirectory.profile(user,orgProfileRoute[1],orgProfileRoute[2]));
 const orgRoute=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/organisations(?:\/(outcomes))?$/);
 if(orgRoute){const id=orgRoute[1],op=orgRoute[2];if(req.method==='GET'&&!op)return json(res,200,organisationDirectory.list(user,id,{q:url.searchParams.get('q')||''}));if(req.method==='POST'&&!op)return json(res,201,organisationDirectory.add(user,id,await readBody(req)));if(req.method==='GET'&&op==='outcomes')return json(res,200,organisationDirectory.outcomes(user,id));if(req.method==='POST'&&op==='outcomes')return json(res,201,organisationDirectory.outcome(user,id,await readBody(req)));}
 const collectiveReviewRoute=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/collective\/reviews$/);
 if(collectiveReviewRoute){const id=collectiveReviewRoute[1];if(req.method==='GET')return json(res,200,collectiveReviews.history(user,id));if(req.method==='POST')return json(res,201,collectiveReviews.review(user,id,await readBody(req)));}
 const financeComparisonRoute=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/finance\/(comparisons|comparison-reviews)$/);
 if(financeComparisonRoute){const id=financeComparisonRoute[1],op=financeComparisonRoute[2];if(req.method==='GET'&&op==='comparisons')return json(res,200,financeWorkspace.comparisonHistory(user,id));if(req.method==='POST'&&op==='comparisons')return json(res,201,financeWorkspace.compare(user,id,await readBody(req)));if(req.method==='POST'&&op==='comparison-reviews')return json(res,201,financeWorkspace.reviewComparison(user,id,await readBody(req)));}
 const financeRoute=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/finance\/(scenarios|reviews)$/);
 if(financeRoute){const id=financeRoute[1],op=financeRoute[2];if(req.method==='GET'&&op==='scenarios')return json(res,200,financeWorkspace.scenarios(user,id));if(req.method==='GET'&&op==='reviews')return json(res,200,financeWorkspace.history(user,id));if(req.method==='POST'&&op==='reviews')return json(res,201,financeWorkspace.review(user,id,await readBody(req)));}
 const recommendationsRoute=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/marketing\/recommendations(?:\/(generate|review))?$/);
 if(recommendationsRoute){const id=recommendationsRoute[1],op=recommendationsRoute[2];if(req.method==='GET'&&!op)return json(res,200,marketingRecommendations.history(user,id));if(req.method==='POST'&&op==='generate')return json(res,201,marketingRecommendations.generate(user,id));if(req.method==='POST'&&op==='review')return json(res,201,marketingRecommendations.review(user,id,await readBody(req)));}
 const campaignPlanReviewsRoute=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/marketing\/campaign-plan-reviews$/);
 if(campaignPlanReviewsRoute){if(req.method==='GET')return json(res,200,marketingWorkspace.campaignPlanReviews(user,campaignPlanReviewsRoute[1]));if(req.method==='POST')return json(res,201,marketingWorkspace.reviewCampaignPlan(user,campaignPlanReviewsRoute[1],await readBody(req)));}
 const campaignPlanRoute=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/marketing\/campaign-plans$/);
 if(campaignPlanRoute){if(req.method==='GET')return json(res,200,marketingWorkspace.campaignPlans(user,campaignPlanRoute[1]));if(req.method==='POST')return json(res,201,marketingWorkspace.planCampaign(user,campaignPlanRoute[1],await readBody(req)));}
 const pipelineRoute=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/marketing\/pipeline$/);
 if(pipelineRoute&&req.method==='GET')return json(res,200,marketingWorkspace.pipeline(user,pipelineRoute[1]));
 const marketingRoute=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/marketing(?:\/(opportunities|campaigns|review|prioritise))?$/);
 if(marketingRoute){const id=marketingRoute[1],op=marketingRoute[2];if(req.method==='GET'&&!op)return json(res,200,marketingWorkspace.records(user,id));if(req.method==='POST'&&op==='opportunities')return json(res,201,marketingWorkspace.opportunity(user,id,await readBody(req)));if(req.method==='POST'&&op==='campaigns')return json(res,201,marketingWorkspace.campaign(user,id,await readBody(req)));if(req.method==='POST'&&op==='review')return json(res,200,marketingWorkspace.review(user,id,await readBody(req)));if(req.method==='POST'&&op==='prioritise')return json(res,201,marketingWorkspace.prioritise(user,id,await readBody(req)));}
 const decisions=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/decisions(?:\/(review))?$/);
 if(decisions){const id=decisions[1];if(req.method==='GET'&&!decisions[2])return json(res,200,decisionWorkbench.history(user,id));if(req.method==='POST'&&!decisions[2])return json(res,201,decisionWorkbench.create(user,id,await readBody(req)));if(req.method==='POST'&&decisions[2])return json(res,200,decisionWorkbench.review(user,id,await readBody(req)));}
 if(url.pathname==='/api/public-research'&&req.method==='GET')return json(res,200,publicResearch.list(user));
 const publicImport=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/public-sources\/([a-z0-9-]+)\/import$/);
 if(publicImport&&req.method==='POST')return json(res,201,publicResearch.import(user,publicImport[1],publicImport[2]));
 const publicOrganisationImport=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)\/public-organisations\/([a-z0-9-]+)\/import$/);
 if(publicOrganisationImport&&req.method==='POST')return json(res,201,publicResearch.importOrganisation(user,publicOrganisationImport[1],publicOrganisationImport[2],organisationDirectory));
 if(url.pathname==='/api/intelligence/overview'&&req.method==='GET')return json(res,200,intelligence.overview(user));
 const intel=url.pathname.match(/^\/api\/intelligence\/objectives\/([a-f0-9-]+)(?:\/(evidence|search|claims|research-approval|import|analysis|tasks|assessments|improvements|assign|assess|timeline))?$/);
 if(intel){const id=intel[1],op=intel[2];
  if(req.method==='GET'&&op==='timeline')return json(res,200,automation.orchestration.timeline(user,id));
  if(req.method==='GET'&&op==='claims')return json(res,200,intelligence.claimReviews(user,id));
  if(req.method==='GET'&&op==='research-approval')return json(res,200,intelligence.researchApproval(user,id));
  if(req.method==='POST'&&op==='research-approval')return json(res,201,intelligence.approveResearch(user,id,await readBody(req)));
  if(req.method==='POST'&&op==='claims')return json(res,201,intelligence.reviewClaim(user,id,await readBody(req)));
  if(req.method==='GET'&&op==='analysis')return json(res,200,intelligence.analysis(user,id,url.searchParams.get('department')||'research'));
  if(req.method==='POST'&&op==='import')return json(res,201,intelligence.importEvidence(user,id,await readBody(req)));
  if(req.method==='GET'&&op==='search')return json(res,200,intelligence.searchEvidence(user,id,{query:url.searchParams.get('q')||'',kind:url.searchParams.get('kind')||'',source:url.searchParams.get('source')||'',limit:Number(url.searchParams.get('limit')||50)}));
  if(req.method==='GET'&&op==='evidence')return json(res,200,intelligence.evidence(user,id));
  if(req.method==='GET'&&op==='tasks')return json(res,200,intelligence.tasks(user,id));
  if(req.method==='GET'&&op==='assessments')return json(res,200,intelligence.assessments(user,id));
  if(req.method==='GET'&&op==='improvements')return json(res,200,intelligence.improvements(user,id));
  if(req.method==='POST'&&op==='evidence')return json(res,201,intelligence.addEvidence(user,id,await readBody(req)));
  if(req.method==='POST'&&op==='assign')return json(res,200,intelligence.assign(user,id,(await readBody(req)).departments));
  if(req.method==='POST'&&op==='assess')return json(res,200,intelligence.assess(user,id,(await readBody(req)).department));
  if(req.method==='POST'&&op==='improvements'){const b=await readBody(req);return json(res,201,intelligence.propose(user,id,b.observation,b.proposal,{evidenceIds:b.evidenceIds||[]}));}
 }
 if(url.pathname.match(/^\/api\/intelligence\/improvements\/[a-f0-9-]+\/review$/)&&req.method==='POST'){const b=await readBody(req);return json(res,200,intelligence.reviewImprovement(user,url.pathname.split('/')[4],b.decision,b.reason));}
 if(url.pathname==='/api/city'&&req.method==='GET'){const snapshot=city.snapshot(user,url.searchParams.get('objective')||null);return json(res,200,user.role==='super_user'?{...snapshot,rc5EvidenceFlow:{knowledge:activationIntelligence.knowledge(user).length,briefs:activationIntelligence.briefs(user).length,unreadStrategicNotices:activationIntelligence.notices(user).filter(x=>x.state==='unread').length,sourceAutomationVerified:false}}:snapshot)}
 if(url.pathname==='/api/operations'&&req.method==='GET')return json(res,200,workflow.snapshot(user));
 if(url.pathname==='/api/backups'&&['GET','POST'].includes(req.method)){
  identity.require(user,['super_user']);
  const directory=join(dirname(path),'backups');await mkdir(directory,{recursive:true,mode:0o700});
  if(req.method==='POST'){
   // Server-selected filename only: no caller-supplied path and no destructive restore over a live database.
   const fileName=`higher-frequency-${new Date().toISOString().replace(/[:.]/g,'-')}-${randomBytes(4).toString('hex')}.sqlite`;
   const result=await backupDatabase(store,join(directory,fileName));
   // Protect local backup contents (including users and credentials) using host filesystem permissions.
   if(process.platform!=='win32')await chmod(join(directory,fileName),0o600);
   identity.audit(user.id,'backup.created',{fileName,bytes:result.bytes,schemaVersion:result.schemaVersion});
   return json(res,201,{fileName,valid:result.valid,bytes:result.bytes,schemaVersion:result.schemaVersion,storedLocally:true,remoteTransfer:false});
  }
  const names=(await readdir(directory)).filter(name=>/^higher-frequency-[0-9TZ-]+-[a-f0-9]{8}\.sqlite$/.test(name)).sort().reverse().slice(0,50);
  const results=[];for(const name of names){const info=await stat(join(directory,name));if(info.isFile())results.push({fileName:name,bytes:info.size,createdAt:info.mtime.toISOString()})}
  return json(res,200,{backups:results,storage:'local_application_data_only',restore:'offline_only_by_administrator'});
 }
 if(url.pathname==='/api/diagnostics/integrity'&&req.method==='GET'){identity.require(user,['super_user']);return json(res,200,databaseIntegrity(store))}
 if(url.pathname==='/api/security/audit'&&req.method==='GET'){identity.require(user,['super_user']);return json(res,200,auditSummary(store,{limit:Number(url.searchParams.get('limit')||50),action:url.searchParams.get('action')||''}))}
 if(url.pathname==='/api/health'&&req.method==='GET'){identity.require(user,['super_user','management','caretaker']);return json(res,200,automation.inspect())}
 if(url.pathname.match(/^\/api\/caretaker\/[a-f0-9-]+\/recover$/)&&req.method==='POST'){return json(res,200,automation.caretaker.recover(user,url.pathname.split('/')[3],workflow.events))}
 if(url.pathname.match(/^\/api\/caretaker\/[a-f0-9-]+\/verify$/)&&req.method==='POST'){return json(res,200,automation.caretaker.verifyRecovery(user,url.pathname.split('/')[3]))}
 if(url.pathname.match(/^\/api\/caretaker\/[a-f0-9-]+$/)&&req.method==='POST'){const b=await readBody(req);return json(res,200,automation.caretaker.update(user,url.pathname.split('/').pop(),b.status,b.diagnostic||''))}
 if(url.pathname.match(/^\/api\/events\/[a-f0-9-]+\/replay$/)&&req.method==='POST'){return json(res,200,{replayed:workflow.events.replay(url.pathname.split('/')[3],user)})}
 if(url.pathname==='/api/caretaker'&&req.method==='GET'){automation.caretaker.list(user);automation.caretaker.scan();return json(res,200,automation.caretaker.list(user))}
 if(url.pathname==='/api/security'&&req.method==='GET')return json(res,200,workflow.incidents.list(user));
 if(url.pathname.match(/^\/api\/security\/[a-f0-9-]+$/)&&req.method==='GET')return json(res,200,workflow.incidents.get(user,url.pathname.split('/').pop()));
 if(url.pathname.match(/^\/api\/security\/[a-f0-9-]+\/evidence$/)&&req.method==='POST'){const b=await readBody(req);return json(res,200,workflow.incidents.addEvidence(user,url.pathname.split('/')[3],b.reference))}
 if(url.pathname.match(/^\/api\/security\/[a-f0-9-]+$/)&&req.method==='POST'){const b=await readBody(req);return json(res,200,workflow.incidents.update(user,url.pathname.split('/').pop(),b))}
 if(url.pathname==='/api/service-credentials'&&req.method==='GET')return json(res,200,new ServiceCredentials(store).list(user,user.tenant));
 if(url.pathname==='/api/service-credentials/rotate'&&req.method==='POST'){const b=await readBody(req);return json(res,201,new ServiceCredentials(store).rotateRuntime(user,b.service,user.tenant,b.expiresAt))}
 if(url.pathname.match(/^\/api\/service-credentials\/[a-f0-9-]+\/revoke$/)&&req.method==='POST'){new ServiceCredentials(store).revoke(user,url.pathname.split('/')[3]);return json(res,200,{revoked:true})}
 if(url.pathname==='/api/mandates/history'&&req.method==='GET')return json(res,200,workflow.mandates.history(user));
 if(url.pathname==='/api/mandates'&&req.method==='GET')return json(res,200,workflow.mandates.list(user));
 if(url.pathname==='/api/mandates'&&req.method==='POST'){const b=await readBody(req);return json(res,201,{id:workflow.mandates.create(user,b)})}
 if(url.pathname.match(/^\/api\/mandates\/[a-f0-9-]+\/revoke$/)&&req.method==='POST'){workflow.mandates.revoke(user,url.pathname.split('/')[3],(await readBody(req)).reason||'');return json(res,200,{revoked:true})}
 if(url.pathname==='/api/worker/run'&&req.method==='POST'){identity.require(user,['super_user','management']);const b=await readBody(req);return json(res,200,workflow.process(b.worker,user.tenant))}
 if(url.pathname==='/api/events'&&req.method==='GET'){workflow.snapshot(user);res.writeHead(200,{'Content-Type':'text/event-stream','Connection':'keep-alive'});const send=()=>{try{const live=identity.authenticate(token(req));if(!live||live.role!==user.role||live.tenant!==user.tenant)throw Error('Session changed');res.write(`event: operations\ndata: ${JSON.stringify(workflow.snapshot(live))}\n\n`)}catch{res.write('event: expired\ndata: {}\n\n');clearInterval(interval);res.end()}};const interval=setInterval(send,2000);activeStreams.add(res);req.on('close',()=>{clearInterval(interval);activeStreams.delete(res)});send();return}
 return json(res,404,{error:'Not found'});
 }catch(e){const msg=e.message||'Error';
  if(url.pathname.startsWith('/api/discovery/run/')){
   if(msg==='HF_TICKETMASTER_API_KEY is not configured')return json(res,503,{error:'Ticketmaster API key not configured on the local server (HF_TICKETMASTER_API_KEY).'});
   if(/fetch failed|aborted|timeout|API returned|Unexpected catalogue|Provider returned no usable records|response too large/i.test(msg))return json(res,503,{error:'Authorised external source could not complete: '+msg.slice(0,110)});
  }
  const code=/Forbidden/.test(msg)?403:/Invalid credentials/.test(msg)?401:/Not found/.test(msg)?404:400;return json(res,code,{error:code===400?'Invalid request':msg})}});
server.listen(port,'127.0.0.1',()=>console.log(`Higher Frequency: http://127.0.0.1:${port}`));
let shuttingDown=false;function shutdown(){if(shuttingDown)return;shuttingDown=true;scheduler.stop();automation.stop();for(const stream of activeStreams){try{stream.end()}catch{}}activeStreams.clear();server.close(()=>{try{store.db.prepare('PRAGMA wal_checkpoint(TRUNCATE)').get();store.close();process.exit(0)}catch(error){console.error('Higher Frequency shutdown:',error.message);process.exit(1)}})}process.on('SIGINT',shutdown);process.on('SIGTERM',shutdown);
