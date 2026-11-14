/** Source-exact Research claims. Only explicit claims are parsed; unlabelled prose is never
 * promoted to facts. Verification labels are supplied metadata, not fact checking. */
const norm=x=>x.trim().toLocaleLowerCase('en-NZ').replace(/\s+/g,' ');
const optional=(x,max=180)=>x===undefined?'':typeof x==='string'&&x.length<=max?x.trim():null;
export function structuredClaims(evidence){
 const claims=[];
 for(const entry of evidence){
  let items=[];let data;try{data=JSON.parse(entry.content)}catch{}
  if(data&&typeof data==='object'&&!Array.isArray(data)&&Array.isArray(data.claims))items=data.claims.map((claim,index)=>({claim,index,representation:'explicit_json'}));
  else if(typeof entry.content==='string'){
   // Require a clear author-supplied delimiter, not a guessed semantic interpretation.
   entry.content.split(/\r?\n/).forEach((line,index)=>{
    const match=line.match(/^\s*(?:[-*]\s*)?Claim:\s*(.+)$/i);
    if(!match)return;
    const [subject,predicate,rawValue,...rest]=match[1].split('|').map(x=>x.trim());
    if(!subject||!predicate||!rawValue)return;
    const context={};for(const token of rest){const m=token.match(/^(period|scope|methodology)=(.*)$/i);if(m)context[m[1].toLowerCase()]=m[2].trim()}
    let value=rawValue;if(/^-?\d+(?:\.\d+)?$/.test(rawValue))value=Number(rawValue);
    items.push({claim:{subject,predicate,value,...context},index,representation:'explicit_text'});
   });
  }
  for(const {claim,index,representation} of items){
   if(!claim||typeof claim!=='object'||Array.isArray(claim))continue;
   const {subject,predicate,value}=claim;
   if(typeof subject!=='string'||!subject.trim()||subject.length>180||typeof predicate!=='string'||!predicate.trim()||predicate.length>180)continue;
   if(!(typeof value==='string'||typeof value==='boolean'||typeof value==='number'&&Number.isFinite(value))||typeof value==='string'&&(!value.trim()||value.length>500))continue;
   const period=optional(claim.period),scope=optional(claim.scope),methodology=optional(claim.methodology);
   if(period===null||scope===null||methodology===null)continue;
   claims.push({evidenceId:entry.id,source:entry.source,verification:entry.verification,claimIndex:index,subject:subject.trim(),predicate:predicate.trim(),value,period,scope,methodology,representation,assertionStatus:'supplied_unverified'});
  }
 }
 return claims.sort((a,b)=>a.source.localeCompare(b.source)||a.claimIndex-b.claimIndex||a.evidenceId.localeCompare(b.evidenceId));
}
export function claimKey(subject,predicate){return JSON.stringify([norm(subject),norm(predicate)])}
export function researchFindings(evidence){
 const claims=structuredClaims(evidence),byKey=new Map();
 for(const c of claims){const key=claimKey(c.subject,c.predicate);byKey.set(key,[...(byKey.get(key)||[]),c])}
 const comparisons=[],contradictionCandidates=[],contextDifferences=[];
 for(const group of byKey.values()){
  if(group.length<2)continue;
  const values=new Map();for(const c of group){const key=JSON.stringify(c.value);values.set(key,[...(values.get(key)||[]),c])}
  const sources=[...new Set(group.map(c=>c.source))];
  const contexts=new Map();for(const c of group){const key=JSON.stringify([norm(c.period),norm(c.scope),norm(c.methodology)]);contexts.set(key,[...(contexts.get(key)||[]),c])}
  const comparison={subject:group[0].subject,predicate:group[0].predicate,evidenceIds:[...new Set(group.map(c=>c.evidenceId))],sources,distinctValues:values.size,distinctContexts:contexts.size,agreementCandidate:values.size===1&&sources.length>1,independentlyVerified:false};
  comparisons.push(comparison);
  if(contexts.size>1)contextDifferences.push({...comparison,classification:'different_supplied_context',note:'Values may refer to different periods, scope or methods; compare matched contexts before interpreting a conflict.'});
  for(const sameContext of contexts.values()){
   const alternatives=new Map();for(const c of sameContext){const key=JSON.stringify(c.value);alternatives.set(key,[...(alternatives.get(key)||[]),c])}
   if(alternatives.size>1)contradictionCandidates.push({subject:group[0].subject,predicate:group[0].predicate,period:sameContext[0].period,scope:sameContext[0].scope,methodology:sameContext[0].methodology,alternatives:[...alternatives.values()].map(g=>({value:g[0].value,evidenceIds:[...new Set(g.map(c=>c.evidenceId))],sources:[...new Set(g.map(c=>c.source))]})),classification:'candidate_only',note:'Conflicting supplied values within the same stated context. Human review required; no independent fact verification.'});
  }
 }
 const sourceGroups=[...Map.groupBy(evidence,e=>e.source).entries()].map(([source,records])=>({source,evidenceIds:records.map(r=>r.id),categories:[...new Set(records.map(r=>r.kind))],verificationLabels:[...new Set(records.map(r=>r.verification))]}));
 const gaps=[];
 if(!evidence.length)gaps.push('No source evidence available');
 if(!claims.length)gaps.push('No explicit structured claims or labelled claims supplied; unlabelled prose is not treated as a fact');
 if(sourceGroups.length<2)gaps.push('Independent source comparison unavailable: fewer than two named sources');
 if(contradictionCandidates.length)gaps.push(`${contradictionCandidates.length} conflicting-value candidate(s) require contextual review`);
 if(contextDifferences.length)gaps.push(`${contextDifferences.length} comparison(s) have different supplied contexts`);
 return {claims,comparisons,contradictionCandidates,contextDifferences,sourceGroups,gaps,verificationPolicy:'Source labels and review dispositions are supplied metadata, no independent verification of facts performed'};
}
