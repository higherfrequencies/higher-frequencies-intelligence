/** Lossless classification and routing advice. Original evidence is never rewritten. */
import {randomUUID} from 'node:crypto';
const validClassifications=new Set(['public','internal','restricted','confidential']);
export function classifyInformation(record,{now=Date.now()}={}){
 if(!record||typeof record.id!=='string'||!record.id.trim()||typeof record.source!=='string'||!record.source.trim())throw Error('Record id and source required');
 const classification=record.classification||'internal';
 if(!validClassifications.has(classification))throw Error('Unsupported classification');
 const evidence=Array.isArray(record.evidence)?record.evidence:[];
 const verified=evidence.some(e=>e?.verified===true&&typeof e.sourceId==='string'&&e.sourceId.trim());
 const review=record.reviewAt==null?null:Date.parse(record.reviewAt);
 if(record.reviewAt!=null&&!Number.isFinite(review))throw Error('Invalid review date');
 const restricted=['restricted','confidential'].includes(classification);
 const destination=restricted?'restricted-review':!verified?'verification':review!==null&&review<=now?'watchlist':'research';
 return {recordId:record.id,classification,destination,verified,source:record.source,reviewAt:record.reviewAt||null,reason:restricted?'Restricted access':!verified?'Evidence requires verification':destination==='watchlist'?'Review due':'Verified evidence available',retained:true};
}
export class InformationIntelligence{
 constructor(store){this.store=store;}
 ingest(record,options={}){
  const classification=classifyInformation(record,options);
  return this.store.transaction(db=>{
   const prior=db.get('information-original',record.id);
   if(prior&&JSON.stringify(prior)!==JSON.stringify(record))throw Error('Conflicting record id; preserve original and submit a new revision');
   if(!prior)db.put('information-original',record.id,record);
   db.put('information-classification',record.id,classification);
   db.put('information-audit',randomUUID(),{recordId:record.id,action:prior?'reassess':'ingest',classification,at:new Date().toISOString()});
   return classification;
  });
 }
 get(id,{role}={}){
  if(!['super_user','manager','caretaker','research','secretary','admin'].includes(role))throw Error('Unauthorized');
  const classification=this.store.get('information-classification',id);
  if(!classification)return null;
  if(['restricted','confidential'].includes(classification.classification)&&!['super_user','manager'].includes(role))return null;
  return {classification,original:role==='caretaker'?undefined:this.store.get('information-original',id)};
 }
}
