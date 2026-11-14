/** Deterministic, provenance-linked commercial assessments. Nothing here implies sales intent. */
const serviceNames=['commercial photography','business promotional video','recurring content'];
const finite=x=>typeof x==='number'&&Number.isFinite(x)&&x>=0&&x<=1e12;
const validCurrency=x=>typeof x==='string'&&/^[A-Z]{3}$/.test(x)&&Intl.supportedValuesOf('currency').includes(x);
const parsed=e=>{try{const v=JSON.parse(e.content);return v&&typeof v==='object'&&!Array.isArray(v)?v:null}catch{return null}};
export function marketingAnalysis(evidence){
 const records=evidence.map(e=>({e,value:parsed(e)}));const audiences=[],competitors=[],organisations=[],opportunities=[],campaigns=[],risks=[],assumptions=[],gaps=[];
 for(const {e,value:v} of records){if(!v)continue;
  if(e.kind==='audience'&&typeof v.segment==='string'&&v.segment.trim())audiences.push({segment:v.segment,needs:Array.isArray(v.needs)?v.needs.filter(x=>typeof x==='string').slice(0,12):[],explicitServices:Array.isArray(v.services)?v.services.filter(x=>serviceNames.includes(x)):[],evidenceIds:[e.id],source:e.source,verification:e.verification||'unverified'});
  if(e.kind==='competitor'&&typeof v.name==='string'&&v.name.trim())competitors.push({name:v.name,services:Array.isArray(v.services)?v.services.filter(x=>typeof x==='string').slice(0,12):[],evidenceIds:[e.id],source:e.source,verification:e.verification||'unverified',independentVerification:false});
  if(e.kind==='organisation'&&typeof v.name==='string'&&v.name.trim())organisations.push({name:v.name,sector:typeof v.sector==='string'?v.sector:null,evidenceIds:[e.id],source:e.source});
  if(e.kind==='market'&&Array.isArray(v.opportunities))for(const o of v.opportunities){if(typeof o?.description==='string'&&o.description.trim())opportunities.push({description:o.description,service:serviceNames.includes(o.service)?o.service:null,confidence:'hypothesis',evidenceIds:[e.id],source:e.source,priority:'unranked',intentVerified:false})}
  if(e.kind==='market'&&Array.isArray(v.campaigns))for(const c of v.campaigns){if(typeof c?.audience==='string'&&typeof c?.message==='string')campaigns.push({audience:c.audience,message:c.message,evidenceIds:[e.id],status:'draft_only',publicationAuthorised:false})}
 }
 if(!audiences.length)gaps.push('No structured audience segment and needs evidence');if(!competitors.length)gaps.push('No structured competitor comparison evidence');if(!organisations.length)gaps.push('No structured organisation profile evidence');if(!opportunities.length)gaps.push('No explicit opportunity candidates supplied');
 // Service fit is recorded only where an audience source explicitly names the service.
 // No algorithm infers a buying signal from sector growth, demographics or generic prose.
 const serviceFit=[];
 for(const audience of audiences)for(const service of audience.explicitServices){
  const related=competitors.filter(c=>c.services.includes(service));
  serviceFit.push({segment:audience.segment,service,evidenceIds:[...new Set([...(audience.evidenceIds||[]),...related.flatMap(c=>c.evidenceIds)])],competitorCount:related.length,competitorNames:related.map(c=>c.name),classification:'source_declared_service_fit_candidate',confidence:'unverified_supplied_assertion',intentVerified:false,recommendation:'Validate the segment need, source currency and consent before proposing outreach'});
 }
 if(audiences.length&&!serviceFit.length)gaps.push('Audience evidence does not explicitly map needs to Higher Frequencies services; no service-fit ranking performed');
 const competitorComparisons=serviceNames.map(service=>({service,competitors:competitors.filter(c=>c.services.includes(service)).map(c=>({name:c.name,evidenceIds:c.evidenceIds})),comparisonBasis:'explicit supplied service labels only',marketShare:null,conclusion:'No independent competitor verification or market share inferred'}));
 const recommendations=serviceFit.map(f=>({action:'Investigate explicitly declared service fit',service:f.service,audience:f.segment,evidenceIds:f.evidenceIds,approvalRequired:true,publicationAuthorised:false,confidence:'hypothesis'}));
 risks.push('Sector-level statistics do not demonstrate individual purchasing intent');
 assumptions.push('Service fit must be confirmed by a human; no contacts, prospect intent or lead ranking inferred');
 return {audiences,competitors,competitorComparisons,serviceFit,recommendations,organisations,opportunities,campaigns,risks,assumptions,gaps,serviceCatalogue:serviceNames,processing:'local_evidence_only',outboundActions:0};
}
export function financeAnalysis(evidence){
 const scenarios=[],rejected=[],gaps=[],risks=[];
 for(const e of evidence.filter(e=>e.kind==='cost')){
  const x=parsed(e);if(!x){rejected.push({evidenceId:e.id,reason:'Structured JSON required'});continue}
  if(!finite(x.revenue)||!finite(x.cost)||!validCurrency(x.currency)||typeof x.period!=='string'||!/^\d{4}-(?:0[1-9]|1[0-2])$/.test(x.period)){
   rejected.push({evidenceId:e.id,reason:'Revenue and cost must be finite nonnegative amounts no greater than 1 trillion; supported ISO 4217 currency and YYYY-MM period required'});continue;
  }
  if(x.tax!==undefined&&!finite(x.tax)){rejected.push({evidenceId:e.id,reason:'Tax must be a nonnegative explicit number'});continue}
  const difference=x.revenue-x.cost-(x.tax??0),margin=x.revenue===0?null:difference/x.revenue*100;
  if(!Number.isFinite(difference)||!Number.isFinite(margin??0)){rejected.push({evidenceId:e.id,reason:'Non-finite calculation result'});continue}
  scenarios.push({evidenceId:e.id,source:e.source,currency:x.currency,period:x.period,name:typeof x.scenario==='string'?x.scenario.slice(0,100):'supplied',revenue:x.revenue,cost:x.cost,tax:x.tax??null,taxTreatment:x.tax===undefined?'tax_not_supplied':'explicit_supplied_tax',difference,marginPercent:margin===null?null:Number(margin.toFixed(4)),formula:'revenue - cost - explicit tax (if provided)',verification:'supplied_figures_only'});
  if(difference<0)risks.push(`Evidence ${e.id}: stated expenses exceed stated revenue`);
 }
 if(!scenarios.length)gaps.push('No valid structured period-specific financial evidence. No projections calculated');
 const comparisons=[];for(let i=0;i<scenarios.length;i++)for(let j=i+1;j<scenarios.length;j++){
  const a=scenarios[i],b=scenarios[j];if(a.currency!==b.currency||a.period!==b.period){comparisons.push({evidenceIds:[a.evidenceId,b.evidenceId],status:'not_comparable',reason:'Different period or currency; no conversion inferred'});continue}
  comparisons.push({evidenceIds:[a.evidenceId,b.evidenceId],status:'comparable',period:a.period,currency:a.currency,differenceDelta:b.difference-a.difference,marginDelta:a.marginPercent===null||b.marginPercent===null?null:b.marginPercent-a.marginPercent});
 }
 return {scenarios,rejected,comparisons,risks,gaps,assumptions:['Inputs are supplied records, not approved Higher Frequencies forecasts','No currency conversion, GST status or tax estimate inferred'],originalBudgetsModified:false};
}
export function collectiveAnalysis(assessments){
 const present=new Map(assessments.map(x=>[x.department,x]));const names=['research','marketing','finance'];const gaps=[],findings=[],risks=[],opportunities=[];const ids=new Set();
 for(const name of names){const a=present.get(name);if(!a){gaps.push(`Missing ${name} assessment`);continue}for(const id of a.evidenceIds||[])ids.add(id);for(const limitation of a.limitations||[])gaps.push(`${name}: ${limitation}`);for(const risk of a.risks||[])risks.push({department:name,description:risk});for(const o of a.opportunities||[])opportunities.push({department:name,description:o});findings.push({department:name,summary:a.summary,confidence:a.confidence,evidenceIds:a.evidenceIds||[]});}
 const research=present.get('research')?.research||{};const conflicts=(research.contradictionCandidates||[]).map(c=>({type:'source_claim_conflict_candidate',subject:c.subject,predicate:c.predicate,evidenceIds:c.alternatives.flatMap(x=>x.evidenceIds),independentlyVerified:false}));
 const marketing=present.get('marketing')?.marketing;if(marketing)for(const opportunity of marketing.opportunities||[])opportunities.push({department:'marketing',description:opportunity.description,evidenceIds:opportunity.evidenceIds,confidence:'hypothesis',intentVerified:false});
 const finance=present.get('finance')?.finance;if(finance)for(const s of finance.scenarios||[])if(s.difference<0)risks.push({department:'finance',description:`Supplied scenario ${s.name} has negative difference`,evidenceIds:[s.evidenceId]});
 const evidenceDepartments=new Map();for(const finding of findings)for(const id of finding.evidenceIds){if(!evidenceDepartments.has(id))evidenceDepartments.set(id,new Set());evidenceDepartments.get(id).add(finding.department)}
 // A shared underlying document across departments is NOT corroboration by independent sources.
 const sharedEvidence=[...evidenceDepartments].filter(([,departments])=>departments.size>1).map(([evidenceId,departments])=>({evidenceId,departments:[...departments],independentCorroboration:false}));
 const distinctRisks=[...new Map(risks.map(r=>[r.department+':'+r.description,r])).values()];
 const distinctOpportunities=[...new Map(opportunities.map(o=>[o.department+':'+o.description,o])).values()];
 const uncertainty={missingDepartments:names.filter(d=>!present.has(d)),unresolvedConflictCandidates:conflicts.length,independentVerificationPerformed:false,sharedSourceCount:sharedEvidence.length};
 return {findings,conflicts,risks:distinctRisks,opportunities:distinctOpportunities,sharedEvidence,uncertainty,gaps:[...new Set(gaps)],evidenceIds:[...ids],confidence:gaps.length||conflicts.length?'insufficient':'supplied_evidence_only',verification:'Departmental agreement is not independent source verification',alternatives:[],externalActions:0};
}
