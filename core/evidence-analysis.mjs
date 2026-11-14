import {researchFindings} from './research-findings.mjs';
import {marketingAnalysis,financeAnalysis,collectiveAnalysis} from './commercial-analysis.mjs';
import {createHash} from 'node:crypto';
export const digest=s=>createHash('sha256').update(s.trim().replace(/\s+/g,' ').toLowerCase()).digest('hex');
export function parseEvidenceImport({format,data,source='Local import',kind='source',verification='unverified'}){
 if(typeof data!=='string'||Buffer.byteLength(data)>12000||!data.trim())throw Error('Invalid import size');
 if(!['csv','json','txt','md'].includes(format))throw Error('Unsupported import format');
 let rows=[];
 if(format==='json'){
  let parsed;try{parsed=JSON.parse(data)}catch{throw Error('Invalid JSON')}
  if(!Array.isArray(parsed))throw Error('JSON must be an array');rows=parsed;
 }else if(format==='csv'){
  // RFC4180-compatible quoted fields, including escaped quotes and embedded newlines.
  const records=[];let field='',record=[],quoted=false;
  for(let i=0;i<data.length;i++){const c=data[i];if(c==='"'){if(quoted&&data[i+1]==='"'){field+='"';i++}else quoted=!quoted}else if(c===','&&!quoted){record.push(field);field=''}else if((c==='\n'||c==='\r')&&!quoted){if(c==='\r'&&data[i+1]==='\n')i++;record.push(field);if(record.some(x=>x.trim()))records.push(record);record=[];field=''}else field+=c}
  if(quoted)throw Error('Unterminated CSV quote');record.push(field);if(record.some(x=>x.trim()))records.push(record);
  const headers=records.shift()?.map(x=>x.trim());if(!headers||!headers.includes('content')||!headers.includes('source'))throw Error('CSV requires source and content headers');rows=records.map(cols=>Object.fromEntries(headers.map((h,i)=>[h,cols[i]||''])));
 }else rows=[{source,content:data,kind,verification}];
 if(!rows.length||rows.length>50)throw Error('Import requires 1–50 records');
 return rows.map((r,i)=>{if(!r||typeof r!=='object'||Array.isArray(r))throw Error(`Invalid record ${i+1}`);const entry={source:r.source??source,content:r.content,kind:r.kind||kind,verification:r.verification||verification};if(typeof entry.source!=='string'||!entry.source.trim()||entry.source.length>250||typeof entry.content!=='string'||!entry.content.trim()||entry.content.length>10000||!['source','organisation','market','competitor','cost','audience'].includes(entry.kind)||!['unverified','user_supplied','verified'].includes(entry.verification))throw Error(`Invalid record ${i+1}`);return entry});
}
export function analyseEvidence(department,evidence,prior=[]){
 const verified=evidence.filter(e=>e.verification==='verified');const limitations=[];const evidenceIds=evidence.map(e=>e.id);const groups=new Map();for(const e of evidence){const hash=digest(e.content||'');groups.set(hash,[...(groups.get(hash)||[]),e.id])}
 const duplicates=[...groups.values()].filter(g=>g.length>1);const observations=[];const risks=[];const opportunities=[];
 if(!evidence.length)limitations.push('No evidence supplied');
 if(evidence.length)limitations.push('No independent source verification performed; verification labels are user assertions');
 if(duplicates.length)observations.push(`${duplicates.length} exact normalised-content duplicate group(s) detected`);
 let research=null,marketing=null,finance=null,collective=null;
 if(department==='research'){
  research=researchFindings(evidence);
  for(const gap of research.gaps)if(!limitations.includes(gap))limitations.push(gap);
  observations.push(`${research.claims.length} explicit claim(s), ${research.comparisons.length} source comparison(s), ${research.contradictionCandidates.length} conflicting-value candidate(s)`);
  observations.push(`${evidence.length} source record(s) available; ${verified.length} labelled verified by submitters (not independently checked)`);
  const kinds=[...new Set(evidence.map(e=>e.kind))];observations.push(`Available evidence categories: ${kinds.join(', ')||'none'}`);
  if(!evidence.some(e=>e.kind==='organisation'))limitations.push('No organisation profile evidence');
 }else if(department==='marketing'){
  marketing=marketingAnalysis(evidence);
  for(const g of marketing.gaps)limitations.push(g);
  risks.push(...marketing.risks);
  opportunities.push(...marketing.opportunities.map(o=>o.description));
  const audience=evidence.filter(e=>e.kind==='audience'),competitors=evidence.filter(e=>e.kind==='competitor');
  observations.push(`${audience.length} audience record(s), ${competitors.length} competitor record(s)`);
  if(!audience.length)limitations.push('Audience information not supplied');
  if(!competitors.length)limitations.push('Competitor comparison unavailable');
  if(audience.length)opportunities.push('Audience evidence available for human-reviewed campaign planning; no prospect contact authorised');
 }else if(department==='finance'){
  finance=financeAnalysis(evidence);
  for(const g of finance.gaps)limitations.push(g);
  risks.push(...finance.risks);
  const costs=evidence.filter(e=>e.kind==='cost');observations.push(`${costs.length} financial evidence record(s)`);
  // Preserve legacy arithmetic observations for supplied records, but distinguish them
  // explicitly from validated period-specific scenarios used for commercial decisions.
  const inputs=[];for(const e of costs){try{const x=JSON.parse(e.content);if(x&&typeof x==='object'&&!Array.isArray(x)&&Number.isFinite(x.revenue)&&Number.isFinite(x.cost)&&x.revenue>=0&&x.cost>=0&&typeof x.currency==='string'&&/^[A-Z]{3}$/.test(x.currency))inputs.push({id:e.id,revenue:x.revenue,cost:x.cost,currency:x.currency})}catch{}}
  if(!finance.scenarios.length)limitations.push('No validated period-specific financial scenario; margin cannot be used for decisions and provisional arithmetic is not a decision-ready calculation');
  for(const x of inputs){const profit=x.revenue-x.cost;const margin=x.revenue>0?(profit/x.revenue*100).toFixed(2)+'%':'undefined (zero revenue)';const valid=finance.scenarios.some(v=>v.evidenceId===x.id);observations.push(`Evidence ${x.id}: ${valid?'validated scenario':'provisional supplied arithmetic only; missing period or other scenario input'} — revenue ${x.revenue} ${x.currency}, cost ${x.cost} ${x.currency}, difference ${profit} ${x.currency}, margin ${margin}`)}
  for(const x of finance.rejected)observations.push(`Evidence ${x.evidenceId}: not a validated scenario (${x.reason})`);
 }else if(department==='collective'){
  collective=collectiveAnalysis(prior);
  for(const g of collective.gaps)limitations.push(g);
  risks.push(...collective.risks.map(r=>r.description));
  opportunities.push(...collective.opportunities.map(o=>o.description));
  observations.push(`Contributing departments: ${prior.map(p=>p.department).join(', ')||'none'}`);
  for(const p of prior){if(p.confidence==='insufficient')limitations.push(`${p.department} assessment reports insufficient evidence`);for(const l of p.limitations||[])if(!limitations.includes(l))limitations.push(l)}
 }else if(department==='executive'||department==='education'){
  observations.push(`${prior.length} prior departmental assessment(s) recorded`);
  if(prior.some(p=>p.confidence==='insufficient'))limitations.push('Prior assessments contain unresolved evidence gaps');
 }
 const confidence='insufficient'; // No trusted external verification integration exists; a user-selected label cannot establish independent verification.
 return {summary:`${department} evidence analysis: ${observations.join('; ')||'no supported analytical observations'}. Source verification has not been independently performed.`,confidence,evidenceIds,limitations,observations,risks,opportunities,duplicates,...(research?{research}:{}),...(marketing?{marketing}:{}),...(finance?{finance}:{}),...(collective?{collective}:{})};
}
