// Explicit operator-approved local provisioning; never creates implicit authority.
import {TransactionalStore} from './core/transactional-store.mjs';
import {IdentityService} from './core/security/auth.mjs';
import {SecureWorkflow} from './core/secure-workflow.mjs';
import {join,dirname} from 'node:path';import {mkdir} from 'node:fs/promises';
const path=process.env.HF_DB||join(process.cwd(),'data/runtime/ecosystem.sqlite');await mkdir(dirname(path),{recursive:true});const store=await TransactionalStore.open(path);
try{const identity=new IdentityService(store),flow=new SecureWorkflow(store,identity);const session=identity.login(process.env.HF_ADMIN_USER,process.env.HF_ADMIN_PASSWORD);const actor=identity.authenticate(session.token);identity.require(actor,['super_user','management']);const expiry=Date.now()+30*86400000;for(const [service,department,types,destinations] of [['research-worker','research',['research.requested','decision.requested'],['research-worker','decision-worker']],['decision-worker','decision',['decision.requested'],['decision-worker']],['reporting-worker','reporting',['report.requested'],['reporting-worker']]]){const mandate=flow.mandates.create(actor,{service,department,tenant:actor.tenant,types,destinations,expiresAt:expiry});console.log('Provisioned',service,mandate)}identity.logout(session.token)}finally{store.close()}
