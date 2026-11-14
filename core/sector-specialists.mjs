import {randomUUID} from 'node:crypto';
import {marketingAnalysis} from './commercial-analysis.mjs';

/** Built-in specialist contracts: only declared, reviewed local algorithms are callable. */
export const SUPPORTED_SECTORS=Object.freeze([
 'creative-industries','hospitality','retail','professional-services',
 'construction','education','financial-markets','general-business'
]);
const BUILT_IN_CAPABILITIES=Object.freeze([{id:'commercial-service-fit',version:'1.0.0',department:'marketing',description:'Compare explicitly supplied audience service declarations with cited competitors. No inferred buying intent or outreach.'}]);
const FINANCIAL_MARKETS_CAPABILITY=Object.freeze({id:'market-observation-review',version:'1.0.0',department:'finance',description:'Review cited, supplied market observations and identify missing source, period, and unit fields. No investments, prices, trades, forecasts, or financial-baseline changes.'});
const capabilitiesFor=sector=>sector==='financial-markets'?[...BUILT_IN_CAPABILITIES,FINANCIAL_MARKETS_CAPABILITY]:BUILT_IN_CAPABILITIES;
/** Financial markets future contract: auditable descriptive observations, never a prediction or investment decision. */
export function financialMarketsObservationReview(evidence){
 const observations=[],gaps=[],rejected=[];
 for(const row of evidence.filter(x=>x.kind==='market')){
  let data;try{data=JSON.parse(row.content)}catch{rejected.push({evidenceId:row.id,reason:'Market evidence is not structured JSON'});continue}
  if(!data||Array.isArray(data)||typeof data!=='object'||typeof data.indicator!=='string'||!data.indicator.trim()||data.indicator.length>120||typeof data.period!=='string'||!/^\d{4}(?:-\d{2}(?:-\d{2})?)?$/.test(data.period)||typeof data.unit!=='string'||!data.unit.trim()||data.unit.length>40||typeof data.value!=='number'||!Number.isFinite(data.value)){
   rejected.push({evidenceId:row.id,reason:'Indicator, ISO period, unit and finite numeric value required'});continue;
  }
  observations.push({evidenceId:row.id,source:row.source,verification:row.verification,indicator:data.indicator.trim(),period:data.period,unit:data.unit.trim(),value:data.value,classification:'source_supplied_not_independently_verified'});
 }
 if(!observations.length)gaps.push('No sufficiently structured market observations for descriptive review');
 if(observations.length<2)gaps.push('No historical series suitable for comparisons or forecasting');
 if(new Set(observations.map(x=>x.source)).size<2)gaps.push('No independent second-source verification');
 return {observations,rejected,gaps,assessment:'Descriptive source-supplied observations only',predictionAvailable:false,investmentAdvice:false,outboundActions:0,financialBaselineChanges:0};
}
export class SectorSpecialists {
 constructor(store,workbench){
  this.store=store;this.intel=workbench;
  store.db.exec(`CREATE TABLE IF NOT EXISTS hf_sector_configuration(
    tenant TEXT NOT NULL,sector TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 1,
    changed_by TEXT NOT NULL,changed_at TEXT NOT NULL,PRIMARY KEY(tenant,sector));
   CREATE TABLE IF NOT EXISTS hf_specialist_invocations(
    id TEXT PRIMARY KEY,tenant TEXT NOT NULL,objective_id TEXT NOT NULL,
    sector TEXT NOT NULL,capability TEXT NOT NULL,version TEXT NOT NULL,
    input_evidence_ids TEXT NOT NULL,result_json TEXT NOT NULL,actor TEXT NOT NULL,
    created_at TEXT NOT NULL);
   CREATE INDEX IF NOT EXISTS hf_specialist_scope ON hf_specialist_invocations(tenant,objective_id,created_at);`);
 }
 #ensure(user){this.intel.require(user,['super_user','management','specialist','department_admin','operator','executive']);const now=new Date().toISOString();
  const insert=this.store.db.prepare('INSERT OR IGNORE INTO hf_sector_configuration(tenant,sector,enabled,changed_by,changed_at) VALUES(?,?,1,?,?)');
  this.store.transaction(()=>{for(const sector of SUPPORTED_SECTORS)insert.run(user.tenant,sector,'system-builtin',now)});
 }
 list(user){this.#ensure(user);return this.store.db.prepare('SELECT sector,enabled,changed_at FROM hf_sector_configuration WHERE tenant=? ORDER BY sector').all(user.tenant).map(r=>({...r,enabled:!!r.enabled,capabilities:capabilitiesFor(r.sector).map(c=>({...c,externalActions:0}))}));}
 setEnabled(user,sector,enabled,reason){
  this.intel.require(user,['super_user','management']);this.#ensure(user);
  if(!SUPPORTED_SECTORS.includes(sector)||typeof enabled!=='boolean'||typeof reason!=='string'||reason.trim().length<8||reason.length>500)throw Error('Invalid sector update');
  const at=new Date().toISOString();return this.store.transaction(()=>{
   this.store.db.prepare('UPDATE hf_sector_configuration SET enabled=?,changed_by=?,changed_at=? WHERE tenant=? AND sector=?').run(Number(enabled),user.id,at,user.tenant,sector);
   this.intel.identity.audit(user.id,'sector.enablement',{sector,tenant:user.tenant,enabled,reason:reason.trim()});
   return {sector,enabled,updatedAt:at};
  });
 }
 discover(user,objectiveId,sector){this.intel.objective(user,objectiveId);this.#ensure(user);const row=this.store.db.prepare('SELECT enabled FROM hf_sector_configuration WHERE tenant=? AND sector=?').get(user.tenant,sector);if(!row)throw Error('Sector unavailable');return {sector,enabled:!!row.enabled,capabilities:row.enabled?capabilitiesFor(sector).map(c=>({...c})):[]};}
 invoke(user,objectiveId,{sector,capability}){
  this.intel.require(user,['super_user','management','specialist','department_admin']);this.intel.editable(user,objectiveId);
  const discovered=this.discover(user,objectiveId,sector);
  if(!discovered.enabled||!discovered.capabilities.some(c=>c.id===capability))throw Error('Capability unavailable');
  const evidence=this.store.db.prepare('SELECT id,kind,source,content,verification FROM hf_intel_evidence WHERE tenant=? AND objective_id=? ORDER BY id').all(user.tenant,objectiveId);
  let output;
  if(capability==='commercial-service-fit'){
   const m=marketingAnalysis(evidence);
   output={serviceFit:m.serviceFit,competitorComparisons:m.competitorComparisons,recommendations:m.recommendations,risks:m.risks,gaps:m.gaps,limitations:['Analysis uses only manually provided records; no purchasing intent or independent business verification'],classification:'supplied_evidence_only',outboundActions:0};
  }else if(capability==='market-observation-review'&&sector==='financial-markets'){
   output=financialMarketsObservationReview(evidence);
  }else throw Error('Capability unavailable');
  return this.store.transaction(()=>{
   const entry={id:randomUUID(),sector,capability,version:'1.0.0',evidenceIds:evidence.map(e=>e.id),output,createdAt:new Date().toISOString()};
   this.store.db.prepare('INSERT INTO hf_specialist_invocations VALUES(?,?,?,?,?,?,?,?,?,?)').run(entry.id,user.tenant,objectiveId,sector,capability,entry.version,JSON.stringify(entry.evidenceIds),JSON.stringify(output),user.id,entry.createdAt);
   this.intel.identity.audit(user.id,'specialist.invoke',{objectiveId,sector,capability,invocationId:entry.id,evidenceCount:entry.evidenceIds.length});
   return entry;
  });
 }
 history(user,objectiveId){this.intel.objective(user,objectiveId);return this.store.db.prepare('SELECT id,sector,capability,version,input_evidence_ids,result_json,actor,created_at FROM hf_specialist_invocations WHERE tenant=? AND objective_id=? ORDER BY created_at DESC,id DESC LIMIT 100').all(user.tenant,objectiveId).map(x=>({...x,evidenceIds:JSON.parse(x.input_evidence_ids),result:JSON.parse(x.result_json),input_evidence_ids:undefined,result_json:undefined}));}
}
