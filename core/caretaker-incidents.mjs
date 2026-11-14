import {randomUUID} from 'node:crypto';
export class CaretakerIncidents {
 constructor(store){this.store=store;store.db.exec(`CREATE TABLE IF NOT EXISTS hf_caretaker_incidents(id TEXT PRIMARY KEY,event_id TEXT,worker TEXT NOT NULL,tenant TEXT NOT NULL,category TEXT NOT NULL,status TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,detected_at TEXT NOT NULL,updated_at TEXT NOT NULL,diagnostic TEXT NOT NULL);CREATE UNIQUE INDEX IF NOT EXISTS hf_caretaker_event_category ON hf_caretaker_incidents(event_id,category) WHERE event_id IS NOT NULL;CREATE TABLE IF NOT EXISTS hf_caretaker_history(id INTEGER PRIMARY KEY AUTOINCREMENT,incident_id TEXT NOT NULL,at TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL)`)}
 record({eventId=null,worker='unknown',tenant='internal',category,diagnostic=''}={}){
  if(!['expired_lease','dead_letter','worker_error','stalled_task'].includes(category))throw Error('Invalid category');
  const now=new Date().toISOString(),id=randomUUID();let actual=id;
  this.store.transaction(()=>{
   // Worker health failures without an event ID share one open case per worker.
   if(!eventId&&category==='worker_error'){
    const prior=this.store.db.prepare("SELECT id FROM hf_caretaker_incidents WHERE event_id IS NULL AND worker=? AND tenant=? AND category='worker_error' AND status NOT IN ('resolved','verified') ORDER BY detected_at DESC LIMIT 1").get(worker,tenant);
    if(prior){actual=prior.id;return}
   }
   const created=this.store.db.prepare('INSERT OR IGNORE INTO hf_caretaker_incidents VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,eventId,worker,tenant,category,'detected',0,now,now,String(diagnostic).slice(0,200));
   actual=eventId?this.store.db.prepare('SELECT id FROM hf_caretaker_incidents WHERE event_id=? AND category=?').get(eventId,category)?.id:id;
   if(created.changes)this.store.db.prepare('INSERT INTO hf_caretaker_history(incident_id,at,action,details) VALUES(?,?,?,?)').run(actual,now,'detected','{}');
  });return actual;
 }
 scan({stalledMs=15*60*1000}={}){
  if(!Number.isSafeInteger(stalledMs)||stalledMs<1000||stalledMs>30*86400000)throw Error('Invalid stall threshold');
  const now=Date.now();
  const expired=this.store.db.prepare("SELECT id,destination,payload FROM hf_events WHERE status='leased' AND lease_until<=?").all(now);
  const dead=this.store.db.prepare("SELECT id,destination,payload FROM hf_events WHERE status='dead_letter'").all();
  const stalled=this.store.db.prepare("SELECT id,destination,payload FROM hf_events WHERE status='pending' AND available_at<=? AND created_at<=?").all(now,new Date(now-stalledMs).toISOString());
  for(const [rows,category] of [[expired,'expired_lease'],[dead,'dead_letter'],[stalled,'stalled_task']])for(const e of rows){let tenant='internal';try{tenant=JSON.parse(e.payload).tenant||'internal'}catch{}this.record({eventId:e.id,worker:e.destination,tenant,category})}
  const health=this.store.db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hf_worker_health'").get();
  if(health){for(const worker of this.store.db.prepare('SELECT worker,failures FROM hf_worker_health WHERE failures>=3').all()){
   const id=this.record({worker:worker.worker,category:'worker_error',diagnostic:`${worker.failures} consecutive worker failures`});
   const row=this.store.db.prepare('SELECT status FROM hf_caretaker_incidents WHERE id=?').get(id);
   if(row&&row.status!=='escalated')this.store.transaction(()=>{this.store.db.prepare("UPDATE hf_caretaker_incidents SET status='escalated',diagnostic=?,updated_at=? WHERE id=?").run(`${worker.failures} consecutive worker failures`,new Date().toISOString(),id);this.store.db.prepare('INSERT INTO hf_caretaker_history(incident_id,at,action,details) VALUES(?,?,?,?)').run(id,new Date().toISOString(),'escalated',JSON.stringify({reason:'failure_threshold',failures:worker.failures}))});
  }}
  return {expired:expired.length,dead:dead.length,stalled:stalled.length};
 }
 require(user,roles){const live=user?.id&&this.store.db.prepare('SELECT role,tenant,disabled FROM hf_users WHERE id=?').get(user.id);if(!live||live.disabled||live.role!==user.role||live.tenant!==user.tenant||!roles.includes(live.role))throw Error('Forbidden');return live}
 list(user){this.require(user,['super_user','caretaker','management']);return this.store.db.prepare('SELECT * FROM hf_caretaker_incidents WHERE tenant=? ORDER BY detected_at DESC LIMIT 100').all(user.tenant)}
 /** Human-authorised dead-letter recovery delegates all event authority checks to SecureExchange. */
 recover(user,id,exchange){
  this.require(user,['super_user','management']);
  if(!exchange||typeof exchange.replay!=='function')throw Error('Guarded exchange required');
  const row=this.store.db.prepare('SELECT * FROM hf_caretaker_incidents WHERE id=? AND tenant=?').get(id,user.tenant);
  if(!row||row.category!=='dead_letter'||!row.event_id)throw Error('Not recoverable');
  return this.store.transaction(()=>{
   // replay itself checks active service, mandate, origin authority, objective and tenant.
   exchange.replay(row.event_id,user);
   const now=new Date().toISOString();
   this.store.db.prepare('UPDATE hf_caretaker_incidents SET status=?,attempts=attempts+1,updated_at=?,diagnostic=? WHERE id=? AND tenant=?').run('attempted',now,'Administrator authorised event replay; awaiting verified worker outcome',id,user.tenant);
   this.store.db.prepare('INSERT INTO hf_caretaker_history(incident_id,at,action,details) VALUES(?,?,?,?)').run(id,now,'replay_authorised',JSON.stringify({actor:user.id,eventId:row.event_id}));
   return this.store.db.prepare('SELECT * FROM hf_caretaker_incidents WHERE id=?').get(id);
  });
 }
 verifyRecovery(user,id){
  this.require(user,['super_user','caretaker','management']);
  const row=this.store.db.prepare('SELECT * FROM hf_caretaker_incidents WHERE id=? AND tenant=?').get(id,user.tenant);
  if(!row||!row.event_id)throw Error('Not found');
  const event=this.store.db.prepare('SELECT status FROM hf_events WHERE id=?').get(row.event_id);
  if(event?.status!=='acknowledged')throw Error('Recovery not yet verified');
  return this.store.transaction(()=>{
   const now=new Date().toISOString();
   if(row.status!=='verified'){
    this.store.db.prepare('UPDATE hf_caretaker_incidents SET status=?,updated_at=?,diagnostic=? WHERE id=?').run('verified',now,'Event acknowledged after current authorisation checks',id);
    this.store.db.prepare('INSERT INTO hf_caretaker_history(incident_id,at,action,details) VALUES(?,?,?,?)').run(id,now,'verified',JSON.stringify({actor:user.id,eventId:row.event_id}));
   }
   return this.store.db.prepare('SELECT * FROM hf_caretaker_incidents WHERE id=?').get(id);
  });
 }
 update(user,id,status,diagnostic=''){
  this.require(user,['super_user','caretaker']);
  // A manual status update can never manufacture an attempted or verified recovery.
  if(!['diagnosed','scheduled','resolved','escalated'].includes(status)||typeof diagnostic!=='string'||diagnostic.length>200)throw Error('Forbidden');
  return this.store.transaction(()=>{
   const row=this.store.db.prepare('SELECT * FROM hf_caretaker_incidents WHERE id=? AND tenant=?').get(id,user.tenant);
   if(!row)throw Error('Not found');
   if(status==='resolved'&&!(row.status==='verified'||row.category==='worker_error'&&diagnostic.trim().length>=10))throw Error('Verified outcome or documented worker resolution required');
   const now=new Date().toISOString();
   this.store.db.prepare('UPDATE hf_caretaker_incidents SET status=?,updated_at=?,diagnostic=? WHERE id=?').run(status,now,diagnostic,id);
   this.store.db.prepare('INSERT INTO hf_caretaker_history(incident_id,at,action,details) VALUES(?,?,?,?)').run(id,now,status,JSON.stringify({actor:user.id,diagnostic}));
   return this.store.db.prepare('SELECT * FROM hf_caretaker_incidents WHERE id=?').get(id)
  });
 }
}
