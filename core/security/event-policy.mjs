import {SecurityIncidents} from './incidents.mjs';
import {ServiceMandates} from './mandates.mjs';
import {ServiceCredentials} from './service-credentials.mjs';
/** Central, deny-by-default policy for protected workflow events. Caller identities are
 * resolved from SQLite; payload identity/role fields are never trusted. */
export class EventPolicy {
 constructor(store){this.store=store;this.mandates=new ServiceMandates(store);this.incidents=new SecurityIncidents(store);this.credentials=new ServiceCredentials(store)}
 deny(action,actor,event,reason){try{this.incidents.record({category:'event_authorisation',severity:'high',source:'exchange',actor:String(actor||'unknown'),resource:`${action}:${event?.id||event?.type||'unknown'}`,tenant:typeof event?.tenant==='string'?event.tenant:'internal',correlationId:event?.correlation_id||event?.correlationId||null})}catch{}throw Error(`Event denied: ${reason}`)}
 check(action,principal,event){const type=event?.type,source=event?.source,destination=event?.destination,tenant=event?.tenant||event?.payload?.tenant;
  if(event?.tenant&&event?.payload?.tenant&&event.tenant!==event.payload.tenant)this.deny(action,principal?.id,event,'conflicting tenant');
  if(!principal||typeof principal.id!=='string'||!['submit','claim','consume','commit','ack','fail','recover','forward'].includes(action)||!/^[-\w.]{3,100}$/.test(type||'')||!/^[-\w.]{2,100}$/.test(destination||'')||!/^[-\w]{2,100}$/.test(tenant||''))this.deny(action,principal?.id,event,'invalid contract');
  // An event that names a governed objective cannot target an unrelated tenant or
  // correlation. Workflows without an objective reference remain legacy internal contracts.
  const objectiveId=event?.payload?.objectiveId;
  if(objectiveId!==undefined){
   if(typeof objectiveId!=='string'||(event.correlationId&&event.correlationId!==objectiveId)||(event.correlation_id&&event.correlation_id!==objectiveId))this.deny(action,principal?.id,event,'correlation mismatch');
   const objective=this.store.db.prepare("SELECT tenant,status FROM hf_objectives WHERE id=?").get(objectiveId);
   if(!objective||objective.tenant!==tenant||['rejected','cancelled'].includes(objective.status))this.deny(action,principal?.id,event,'objective scope');
  }
  if(principal.kind==='user'){
   const u=this.store.db.prepare('SELECT id,role,tenant,disabled FROM hf_users WHERE id=?').get(principal.id);
   if(!u||u.disabled||u.tenant!==tenant||!['management','super_user'].includes(u.role)||!['submit','forward'].includes(action)||source!=='management'||!['research.requested','report.requested','intel.research','intel.marketing','intel.finance'].includes(type)||destination!==(type==='research.requested'?'research-worker':type==='report.requested'?'reporting-worker':`intel-${type.split('.')[1]}-worker`))this.deny(action,principal.id,event,'user scope');
   return true;
  }
  if(principal.kind==='service'){
   if(principal.tenant && principal.tenant!==tenant)this.deny(action,principal.id,event,'service tenant mismatch');
   const s=this.store.db.prepare('SELECT * FROM hf_service_identities WHERE id=? AND active=1').get(principal.id);
   // Every service operation requires an active, matching credential. An absent
   // credential is never evidence of an internal/trusted caller.
   if(!this.credentials.verify({id:principal.credentialId,secret:principal.credentialSecret,service:principal.id,tenant}))this.deny(action,principal.id,event,'service credential required');
   if(!s||s.department!==principal.department||!this.mandates.check(principal.id,tenant,type,destination))this.deny(action,principal.id,event,'service mandate');
   if(['claim','consume','commit','ack','fail','recover'].includes(action)&&destination!==principal.id)this.deny(action,principal.id,event,'wrong destination');
   // A valid destination mandate does not legitimise a forged persisted origin.
   if(['claim','consume','commit','ack','fail','recover'].includes(action)){
    const permittedOrigin=(source==='management'&&(['research.requested','report.requested'].includes(type)||type===`intel.${s.department}`)) ||
      (source==='research-worker'&&type==='decision.requested'&&destination==='decision-worker') ||
      (source===destination&&source===principal.id&&type===`intel.${s.department}`);
    if(!permittedOrigin)this.deny(action,principal.id,event,'untrusted event origin');
    if(event.correlation_id&&event.payload?.objectiveId&&event.correlation_id!==event.payload.objectiveId)this.deny(action,principal.id,event,'correlation mismatch');
   }
   if(['submit','forward'].includes(action)&&source!==principal.id)this.deny(action,principal.id,event,'forged source');
   // A Research->Decision handoff must be caused by a currently owned and
   // unexpired Research event lease, not merely a worker claiming an origin name.
   if(['submit','forward'].includes(action)&&type==='decision.requested'&&destination==='decision-worker'){
    const cause=event.causationId||event.causation_id;
    const prior=typeof cause==='string'&&this.store.db.prepare("SELECT type,source,destination,correlation_id,status,lease_owner,lease_until,payload FROM hf_events WHERE id=?").get(cause);
    if(!prior||prior.type!=='research.requested'||prior.source!=='management'||prior.destination!==principal.id||prior.status!=='leased'||prior.lease_owner!==principal.id||prior.lease_until<=Date.now()||prior.correlation_id!==(event.correlationId||event.correlation_id)||JSON.parse(prior.payload).tenant!==tenant)this.deny(action,principal.id,event,'causation lease required');
   }

   // Service forwarding is an explicit protocol contract, not just a broad mandate destination.
   if(['submit','forward'].includes(action)){
    const permitted=(principal.id==='research-worker'&&type==='decision.requested'&&destination==='decision-worker') ||
      (principal.id.startsWith('intel-')&&type===`intel.${s.department}`&&destination===principal.id);
    if(!permitted)this.deny(action,principal.id,event,'service forwarding contract');
   }
   return true;
  }
  this.deny(action,principal.id,event,'unknown identity');
 }
}
