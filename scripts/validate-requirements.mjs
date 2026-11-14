import {readFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const register=JSON.parse(readFileSync(resolve(root,'docs/requirements-register.json'),'utf8'));
const ids=new Set(),errors=[];
const allowed=new Set(['VERIFIED COMPLETE','OPERATIONAL WITH LIMITATIONS','PARTIALLY IMPLEMENTED','NOT IMPLEMENTED','BLOCKED','NOT VERIFIED']);
for(const r of register.requirements){
 if(!/^[A-Z]+\d*(?:\.\d{2})?$/.test(r.id))errors.push(`Invalid ID ${r.id}`);
 if(ids.has(r.id))errors.push(`Duplicate ${r.id}`);ids.add(r.id);
 if(!allowed.has(r.status))errors.push(`Invalid status ${r.id}`);
 if(r.checked&&r.status!=='VERIFIED COMPLETE')errors.push(`Invalid check ${r.id}`);
 if(r.checked&&(!r.test_files?.length||!r.verification_result||r.verification_result.startsWith('Not verified')))errors.push(`Missing executed evidence ${r.id}`);
 for(const path of [...r.source_files,...r.test_files])if(!existsSync(resolve(root,path)))errors.push(`Missing path ${r.id}: ${path}`);
}
for(const r of register.requirements){
 if(r.parent&&!ids.has(r.parent))errors.push(`Missing parent ${r.id}`);
 if(r.checked&&register.requirements.some(c=>c.parent===r.id&&!c.checked))errors.push(`Checked parent with unchecked children ${r.id}`);
}
const counts=Object.fromEntries([...allowed].map(s=>[s,register.requirements.filter(r=>r.status===s).length]));
const mandatory=register.requirements.filter(r=>r.mandatory&&!r.checked);
console.log(JSON.stringify({total:register.requirements.length,mandatory:register.requirements.filter(r=>r.mandatory).length,optional:register.requirements.filter(r=>!r.mandatory).length,uncheckedMandatory:mandatory.length,counts,errors},null,2));
if(errors.length||process.argv.includes('--release')&&mandatory.length)process.exitCode=1;
