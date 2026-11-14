/** Evidence-only live network probe. Does not ship account data, API keys or live user records. */
import {mkdtemp,writeFile,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {TransactionalStore} from '../core/transactional-store.mjs';import {IdentityService} from '../core/security/auth.mjs';import {LiveIntelligence} from '../core/live-intelligence.mjs';
const dir=await mkdtemp(join(tmpdir(),'hf-rc6-probe-'));let store;
try{
 store=new TransactionalStore(join(dir,'probe.sqlite'));const auth=new IdentityService(store),owner=auth.createUser({username:'rc6_probe_admin',password:'TestProbeOnly!2026Strong',role:'super_user'});const discovery=new LiveIntelligence(store,auth);
 const startedAt=new Date().toISOString();let outcome='unverified',failure=null;try{await discovery.run(owner,'beehive');outcome='real_application_request_processed'}catch(error){failure=String(error.message)}
 const runs=discovery.runs(owner).filter(x=>x.provider==='beehive').map(({provider,method,status,started_at,completed_at,counts,error})=>({provider,method,status,started_at,completed_at,counts,error}));
 const evidence={build:'HF18',startedAt,outcome,provider:'Beehive official RSS',testMethod:'real global fetch through application LiveIntelligence.run; no stub',recordsPersisted:discovery.overview(owner).sourceCount,failReason:failure,runHistory:runs,certifiedOperational:outcome==='real_application_request_processed'&&discovery.overview(owner).sourceCount>0};
 const dest=process.argv[2]||join(dir,'evidence.json');await writeFile(dest,JSON.stringify(evidence,null,2)+'\n');console.log(JSON.stringify(evidence,null,2));
}finally{store?.close();await rm(dir,{recursive:true,force:true})}
