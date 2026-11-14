import {randomBytes, createHash, timingSafeEqual, randomUUID} from 'node:crypto';
const runtimeSecrets=new WeakMap();
/** Persistent, revocable credentials for service principals crossing a process boundary.
 * Secrets are returned once and never persisted or logged. */
export class ServiceCredentials {
 constructor(store){this.store=store;store.db.exec(`CREATE TABLE IF NOT EXISTS hf_service_credentials(id TEXT PRIMARY KEY,service TEXT NOT NULL,tenant TEXT NOT NULL,digest TEXT NOT NULL,issued_by TEXT NOT NULL,created_at INTEGER NOT NULL,expires_at INTEGER NOT NULL,revoked_at INTEGER);CREATE INDEX IF NOT EXISTS hf_credentials_service ON hf_service_credentials(service,tenant);CREATE TABLE IF NOT EXISTS hf_service_credential_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,credential_id TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,at INTEGER NOT NULL);`)}
 #admin(actor,tenant){const u=actor?.id&&this.store.db.prepare('SELECT role,tenant,disabled FROM hf_users WHERE id=?').get(actor.id);if(!u||u.disabled||u.tenant!==tenant||!['super_user','management'].includes(u.role))throw Error('Credential administration forbidden');return u}
 issue(actor,{service,tenant,expiresAt}){this.#admin(actor,tenant);const s=this.store.db.prepare('SELECT active FROM hf_service_identities WHERE id=?').get(service);if(!s?.active||!Number.isSafeInteger(expiresAt)||expiresAt<=Date.now()||expiresAt>Date.now()+90*86400000)throw Error('Credential provisioning denied');const id=randomUUID(),secret=randomBytes(32).toString('base64url'),digest=createHash('sha256').update(secret).digest('hex');this.store.transaction(()=>{this.store.db.prepare('INSERT INTO hf_service_credentials VALUES(?,?,?,?,?,?,?,NULL)').run(id,service,tenant,digest,actor.id,Date.now(),expiresAt);this.#audit(id,actor.id,'issued')});return {id,secret,service,tenant,expiresAt}}
 /** Internal process-only worker bootstrap; not an HTTP authentication mechanism. */
 provisionRuntime(actor,service,tenant,expiresAt){const credential=this.issue(actor,{service,tenant,expiresAt});let map=runtimeSecrets.get(this.store);if(!map){map=new Map();runtimeSecrets.set(this.store,map)}map.set(`${service}:${tenant}`,credential);return {id:credential.id,service,tenant,expiresAt}}
 /** Administrator rotation for a locally managed worker; no secret leaves the process. */
 rotateRuntime(actor,service,tenant,expiresAt){
  this.#admin(actor,tenant);
  const active=this.store.db.prepare("SELECT MAX(expires_at) AS until FROM hf_service_mandates WHERE service=? AND tenant=? AND status='active' AND expires_at>?").get(service,tenant,Date.now());
  if(!active?.until||!Number.isSafeInteger(expiresAt)||expiresAt>active.until)throw Error('Active service mandate required');
  return this.store.transaction(()=>{
   const issued=this.provisionRuntime(actor,service,tenant,expiresAt);
   const previous=this.store.db.prepare('SELECT id FROM hf_service_credentials WHERE service=? AND tenant=? AND revoked_at IS NULL AND id<>?').all(service,tenant,issued.id);
   for(const row of previous){this.store.db.prepare('UPDATE hf_service_credentials SET revoked_at=? WHERE id=?').run(Date.now(),row.id);this.#audit(row.id,actor.id,'rotated')}
   this.#audit(issued.id,actor.id,'rotation_issued');
   return issued;
  });
 }
 bootstrapRuntime(){const rows=this.store.db.prepare("SELECT service,tenant,issuer,MAX(expires_at) expires_at FROM hf_service_mandates WHERE status='active' AND expires_at>? GROUP BY service,tenant,issuer").all(Date.now());for(const row of rows){const u=this.store.db.prepare('SELECT id,role,tenant,disabled FROM hf_users WHERE id=?').get(row.issuer);if(!u||u.disabled||u.tenant!==row.tenant||!['super_user','management'].includes(u.role))continue;this.provisionRuntime(u,row.service,row.tenant,row.expires_at)}}
 runtimePrincipal(service,department,tenant){const c=runtimeSecrets.get(this.store)?.get(`${service}:${tenant}`);if(!c||!this.verify(c))throw Error('Worker credential unavailable');return {kind:'service',id:service,department,tenant,credentialId:c.id,credentialSecret:c.secret}}
 #audit(id,actor,action){this.store.db.prepare('INSERT INTO hf_service_credential_audit(credential_id,actor,action,at) VALUES(?,?,?,?)').run(id,actor,action,Date.now())}
 verify({id,secret,service,tenant}={}){if(typeof id!=='string'||typeof secret!=='string'||typeof service!=='string'||typeof tenant!=='string')return false;const c=this.store.db.prepare('SELECT * FROM hf_service_credentials WHERE id=? AND service=? AND tenant=?').get(id,service,tenant);if(!c||c.revoked_at!==null||c.expires_at<=Date.now()||!this.store.db.prepare('SELECT 1 FROM hf_service_identities WHERE id=? AND active=1').get(service))return false;const digest=createHash('sha256').update(secret).digest();return timingSafeEqual(digest,Buffer.from(c.digest,'hex'))}
 revoke(actor,id){const c=this.store.db.prepare('SELECT tenant FROM hf_service_credentials WHERE id=?').get(id);if(!c)throw Error('Credential unavailable');this.#admin(actor,c.tenant);this.store.transaction(()=>{this.store.db.prepare('UPDATE hf_service_credentials SET revoked_at=? WHERE id=? AND revoked_at IS NULL').run(Date.now(),id);this.#audit(id,actor.id,'revoked')})}
 list(actor,tenant){this.#admin(actor,tenant);return this.store.db.prepare('SELECT id,service,tenant,issued_by,created_at,expires_at,revoked_at FROM hf_service_credentials WHERE tenant=? ORDER BY created_at DESC').all(tenant)}
}
