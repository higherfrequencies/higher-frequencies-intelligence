import {DurableEvents} from './durable-events.mjs';
import {EventPolicy} from './security/event-policy.mjs';
import {ServiceCredentials} from './security/service-credentials.mjs';
/** Guarded facade over the existing SQLite durable event transport. */
export class SecureExchange {
 #raw;
 constructor(store){this.store=store;this.#raw=new DurableEvents(store);this.policy=new EventPolicy(store);this.credentials=new ServiceCredentials(store)}
 /** Authenticate a credential-backed service principal for guarded operations. */
 authenticateService(credential,department){if(!this.credentials.verify(credential)){this.policy.deny('authenticate',credential?.service,null,'service credential invalid')}const s=this.store.db.prepare('SELECT department FROM hf_service_identities WHERE id=? AND active=1').get(credential.service);if(!s||s.department!==department){this.policy.deny('authenticate',credential?.service,null,'service department invalid')}return {kind:'service',id:credential.service,department,tenant:credential.tenant,credentialId:credential.id,credentialSecret:credential.secret}}
 publish(event,principal){this.policy.check('submit',principal,event);return this.#raw.publish(event,{id:principal.id,role:principal.kind})}
 claim(principal,opts={}){
  if(principal?.kind!=='service')this.policy.deny('claim',principal?.id,null,'service required');
  const select=()=>{const now=Date.now();const e=this.store.db.prepare("SELECT * FROM hf_events WHERE destination=? AND (? IS NULL OR id=?) AND ((status='pending' AND available_at<=?) OR (status='leased' AND lease_until<=?)) ORDER BY created_at,id LIMIT 1").get(principal.id,opts.eventId||null,opts.eventId||null,now,now);if(!e)return null;let payload;try{payload=JSON.parse(e.payload)}catch{this.policy.deny('claim',principal.id,e,'invalid payload')}return {...e,payload,tenant:payload?.tenant}};
  // Audit an initial denial outside the write transaction, so rollback cannot erase it.
  const candidate=select();if(!candidate)return null;this.policy.check('claim',principal,candidate);
  return this.store.transaction(()=>{
   const current=select();if(!current)return null;
   this.policy.check('claim',principal,current);
   return this.#raw.claim(principal.id,{...opts,destination:principal.id,eventId:current.id});
  });
 }

 check(action,principal,event){return this.policy.check(action,principal,event)}
 /** Resolve the canonical persisted event, never authorise using caller-controlled metadata. */
 #leasedEvent(event){
  if(!event||typeof event.id!=='string')throw Error('Invalid event reference');
  const row=this.store.db.prepare('SELECT * FROM hf_events WHERE id=?').get(event.id);
  if(!row)throw Error('Event unavailable');
  let payload;try{payload=JSON.parse(row.payload)}catch{throw Error('Invalid persisted event')}
  if(!payload||typeof payload.tenant!=='string')throw Error('Invalid persisted tenant');
  return {...row,payload,tenant:payload.tenant};
 }
 acknowledge(event,principal){
  const canonical=this.#leasedEvent(event);
  this.policy.check('ack',principal,canonical);
  if(canonical.status!=='leased'||canonical.lease_owner!==principal.id||canonical.lease_until<=Date.now())throw Error('Lease unavailable'); // Denials are audited outside the transaction.
  return this.store.transaction(()=>{const current=this.#leasedEvent(event);this.policy.check('ack',principal,current);if(current.status!=='leased'||current.lease_owner!==principal.id||current.lease_until<=Date.now())throw Error('Lease unavailable');return this.#raw.acknowledge(current.id,principal.id)});
 }
 fail(event,principal,error,opts){
  const canonical=this.#leasedEvent(event);
  this.policy.check('fail',principal,canonical);
  if(canonical.status!=='leased'||canonical.lease_owner!==principal.id||canonical.lease_until<=Date.now())throw Error('Lease unavailable');
  return this.store.transaction(()=>{const current=this.#leasedEvent(event);this.policy.check('fail',principal,current);if(current.status!=='leased'||current.lease_owner!==principal.id||current.lease_until<=Date.now())throw Error('Lease unavailable');return this.#raw.fail(current.id,principal.id,error,opts)});
 }
 /** Administrative replay only requeues; it never executes work or overrides current mandates. */
 replay(eventId,user){
  const u=user?.id&&this.store.db.prepare('SELECT id,role,tenant,disabled FROM hf_users WHERE id=?').get(user.id);
  if(!u||u.disabled||!['super_user','management'].includes(u.role))throw Error('Replay forbidden');
  const e=this.store.db.prepare("SELECT * FROM hf_events WHERE id=? AND status='dead_letter'").get(eventId);
  if(!e)throw Error('Event unavailable');
  let payload;try{payload=JSON.parse(e.payload)}catch{throw Error('Invalid event')}
  if(payload?.tenant!==u.tenant)throw Error('Event unavailable');
  if(payload?.objectiveId!==e.correlation_id)throw Error('Event contract rejected');
  const objective=this.store.db.prepare('SELECT created_by,status FROM hf_objectives WHERE id=? AND tenant=?').get(e.correlation_id,u.tenant);
  if(!objective||['rejected','cancelled'].includes(objective.status))throw Error('Objective unavailable');
  if(e.source==='management'){
   const creator=this.store.db.prepare('SELECT role,tenant,disabled FROM hf_users WHERE id=?').get(objective.created_by);
   if(!creator||creator.disabled||creator.tenant!==u.tenant||!['management','super_user'].includes(creator.role)||!['research.requested','report.requested'].includes(e.type))throw Error('Origin authority revoked');
  }else if(e.source!==e.destination){
   if(!(e.source==='research-worker'&&e.type==='decision.requested'&&e.destination==='decision-worker'&&this.policy.mandates.check(e.source,u.tenant,e.type,e.destination)))throw Error('Forwarding authority denied');
  }else if(!e.type.startsWith('intel.'))throw Error('Origin contract rejected');

  const service=this.store.db.prepare('SELECT department FROM hf_service_identities WHERE id=? AND active=1').get(e.destination);
  if(!service||!this.policy.mandates.check(e.destination,u.tenant,e.type,e.destination)){
   this.policy.deny('recover',e.destination,{...e,tenant:u.tenant},'current mandate required');
  }
  return this.store.transaction(()=>{
   if(!this.policy.mandates.check(e.destination,u.tenant,e.type,e.destination))throw Error('Replay authority changed');
   const changed=this.store.db.prepare("UPDATE hf_events SET status='pending',available_at=0,lease_owner=NULL,lease_until=0,last_error=NULL WHERE id=? AND status='dead_letter'").run(eventId);
   if(changed.changes!==1)throw Error('Event state changed');
   this.store.db.exec('CREATE TABLE IF NOT EXISTS hf_event_replay_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,event_id TEXT NOT NULL,actor TEXT NOT NULL,at TEXT NOT NULL)');
   this.store.db.prepare('INSERT INTO hf_event_replay_audit(event_id,actor,at) VALUES(?,?,?)').run(eventId,u.id,new Date().toISOString());
   return true;
  });
 }
 counts(){return this.#raw.counts()}
 trace(correlation){return this.#raw.trace(correlation)}
}
