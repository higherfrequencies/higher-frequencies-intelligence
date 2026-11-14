/** Auditable 116-item registry inventory; never upgrades acceptance status from mere code existence. */
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {resolve} from 'node:path';
const root=resolve(import.meta.dirname,'..');
const registry=JSON.parse(readFileSync(resolve(root,'docs/requirements-register.json'),'utf8'));
const original=registry.requirements.filter(r=>r.mandatory);
if(original.length!==116)throw Error('Mandatory requirement count changed');
const classification=r=>{
 if(r.checked&&r.status==='VERIFIED COMPLETE')return 'Previously marked verified complete; prior evidence references require individual acceptance review';
 if(r.status==='BLOCKED')return 'Blocked by documented validation or external evidence dependency';
 if(r.id.startsWith('C6')||r.id==='C7.05'||r.id==='R9')return 'Requires native/browser acceptance beyond automated tests';
 if(r.id==='R10'||r.id==='C7')return 'Requires installation and restart acceptance on target operating system';
 if(r.status==='PARTIALLY IMPLEMENTED')return 'Partial implementation or integration';
 return 'Implemented or documented, but missing executed acceptance verification';
};
const records=original.map(r=>({id:r.id,parent:r.parent,originalDescription:r.description,acceptanceCriteria:r.acceptance_criteria,subsystem:r.subsystem,registryStatus:r.status,registryChecked:r.checked,classification:classification(r),implementationReferences:r.source_files||[],tests:r.test_files||[],pathsPresent:[...(r.source_files||[]),...(r.test_files||[])].every(p=>existsSync(resolve(root,p))),priorVerification:r.verification_result||null,remainingDependency:r.checked?'Re-examine source evidence and required operational acceptance, rather than upgrade automatically':r.acceptance_criteria,independentlyReverifiedThisRelease:['HF-WIN-20261114-CONTRACT-CLOSURE','HF-WIN-20261114-RESEARCH-WORKSPACE-CLOSURE'].includes(r.completion_build)}));
const open=records.filter(r=>!r.registryChecked);
const output={generatedAt:new Date().toISOString(),source:'docs/requirements-register.json',originalDefinitionsPreserved:true,mandatory:records.length,previouslyMarkedComplete:records.length-open.length,notYetVerified:open.length,openIds:open.map(r=>r.id),reviewMethod:'Registry definitions and source/test path checks only; tests and execution evidence are separately reported. No unchecked requirement is silently closed.',records};
const target=resolve(root,'docs/FINAL-CLOSURE-MATRIX.json');writeFileSync(target,JSON.stringify(output,null,2)+'\n');console.log(JSON.stringify({mandatory:records.length,previouslyMarkedComplete:output.previouslyMarkedComplete,remaining:open.length,openIds:output.openIds,allReferencedPathsPresent:records.every(r=>r.pathsPresent)}));
