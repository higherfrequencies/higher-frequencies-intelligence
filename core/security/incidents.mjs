import {randomUUID} from 'node:crypto';
const statuses=new Set(['open','investigating','escalated','resolved']);
const severities=new Set(['low','medium','high','critical']);
/** Tenant-scoped security incident case management with append-only investigative history. */
export class SecurityIncidents {
 constructor(store){
  this.store=store;
  store.db.exec(`CREATE TABLE IF NOT EXISTS hf_security_incidents(id TEXT PRIMARY KEY,at TEXT NOT NULL,category TEXT NOT NULL,severity TEXT NOT NULL,source TEXT NOT NULL,actor TEXT NOT NULL,resource TEXT NOT NULL,tenant TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',assigned_to TEXT,correlation_id TEXT);
  CREATE TABLE IF NOT EXISTS hf_security_incident_history(id INTEGER PRIMARY KEY AUTOINCREMENT,incident_id TEXT NOT NULL,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,notes TEXT NOT NULL);
  CREATE TABLE IF NOT EXISTS hf_security_incident_evidence(id TEXT PRIMARY KEY,incident_id TEXT NOT NULL,tenant TEXT NOT NULL,reference TEXT NOT NULL,added_by TEXT NOT NULL,at TEXT NOT NULL,UNIQUE(incident_id,reference));`);
 }
 require(user,modify=false){
  const live=user?.id&&this.store.db.prepare('SELECT id,role,tenant,disabled FROM hf_users WHERE id=?').get(user.id);
  if(!live||live.disabled||live.role!==user.role||live.tenant!==user.tenant||!['super_user','security','management'].includes(live.role)||(modify&&live.role==='management'))throw Error('Forbidden');
  return live;
 }
 #log(id,actor,action,notes=''){this.store.db.prepare('INSERT INTO hf_security_incident_history(incident_id,at,actor,action,notes) VALUES(?,?,?,?,?)').run(id,new Date().toISOString(),actor,action,notes)}
 record({category='access_violation',severity='medium',source='backend',actor='unknown',resource='unknown',tenant='internal',correlationId=null}={}){
  if(!severities.has(severity)||typeof tenant!=='string'||!/^[-\w]{2,100}$/.test(tenant))throw Error('Invalid incident');
  const id=randomUUID();this.store.transaction(()=>{
   this.store.db.prepare('INSERT INTO hf_security_incidents(id,at,category,severity,source,actor,resource,tenant,status,correlation_id) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,new Date().toISOString(),String(category).slice(0,100),severity,String(source).slice(0,100),String(actor).slice(0,100),String(resource).slice(0,200),tenant,'open',correlationId);
   this.#log(id,String(actor).slice(0,100),'created',String(category).slice(0,100));
  });return id;
 }
 list(user){this.require(user);return this.store.db.prepare('SELECT * FROM hf_security_incidents WHERE tenant=? ORDER BY at DESC LIMIT 100').all(user.tenant)}
 get(user,id){this.require(user);const incident=this.store.db.prepare('SELECT * FROM hf_security_incidents WHERE id=? AND tenant=?').get(id,user.tenant);if(!incident)throw Error('Not found');return {...incident,history:this.store.db.prepare('SELECT at,actor,action,notes FROM hf_security_incident_history WHERE incident_id=? ORDER BY id').all(id),evidence:this.store.db.prepare('SELECT id,reference,added_by,at FROM hf_security_incident_evidence WHERE incident_id=? AND tenant=? ORDER BY at,id').all(id,user.tenant)}}
 update(user,id,{status,notes='',assignedTo=undefined,severity=undefined}){
  this.require(user,true);
  if(!statuses.has(status)||typeof notes!=='string'||notes.length>1000||(severity!==undefined&&!severities.has(severity)))throw Error('Invalid incident update');
  return this.store.transaction(()=>{
   const row=this.store.db.prepare('SELECT * FROM hf_security_incidents WHERE id=? AND tenant=?').get(id,user.tenant);if(!row)throw Error('Not found');
   const owner=assignedTo===undefined?row.assigned_to:assignedTo;
   if(owner!==null){const u=this.store.db.prepare('SELECT role,tenant,disabled FROM hf_users WHERE id=?').get(owner);if(!u||u.disabled||u.tenant!==user.tenant||!['super_user','security'].includes(u.role))throw Error('Invalid incident owner')}
   if(status==='resolved'&&!notes.trim())throw Error('Resolution notes required');
   this.store.db.prepare('UPDATE hf_security_incidents SET status=?,assigned_to=?,severity=? WHERE id=? AND tenant=?').run(status,owner,severity||row.severity,id,user.tenant);
   this.#log(id,user.id,status,notes);
   if(row.assigned_to!==owner)this.#log(id,user.id,'assigned',String(owner||'unassigned'));
   if(severity&&severity!==row.severity)this.#log(id,user.id,'severity_changed',`${row.severity} -> ${severity}`);
   return this.get(user,id);
  });
 }
 addEvidence(user,id,reference){this.require(user,true);if(typeof reference!=='string'||reference.length>300||!/^[-\w./:#]{3,300}$/.test(reference))throw Error('Invalid evidence reference');return this.store.transaction(()=>{this.get(user,id);const key=randomUUID();const result=this.store.db.prepare('INSERT OR IGNORE INTO hf_security_incident_evidence(id,incident_id,tenant,reference,added_by,at) VALUES(?,?,?,?,?,?)').run(key,id,user.tenant,reference,user.id,new Date().toISOString());if(result.changes)this.#log(id,user.id,'evidence_linked',reference);return this.get(user,id)})}
}
