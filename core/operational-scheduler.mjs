/** Explicitly enabled, local-process-only retrieval scheduling.
 * Reuses authorised LiveIntelligence, RC7 handoffs and SQLite; no hidden credentials,
 * impersonated users, external outreach, or attempts while the application is closed.
 */
const periods={daily:86400000,weekly:604800000};
const permitted=new Set(['beehive','datagovt','ticketmaster']);
export class OperationalScheduler {
 constructor(store,identity,live,processing,{clock=()=>Date.now(),intervalMs=60000,monitoring=null}={}){
  this.store=store;this.identity=identity;this.live=live;this.processing=processing;this.clock=clock;this.intervalMs=intervalMs;this.timer=null;this.running=new Set();this.monitoring=monitoring;
  store.db.exec(`CREATE TABLE IF NOT EXISTS hf_source_schedules(tenant TEXT NOT NULL,provider TEXT NOT NULL,owner_id TEXT NOT NULL,enabled INTEGER NOT NULL DEFAULT 0,frequency TEXT NOT NULL,next_at INTEGER NOT NULL,last_at INTEGER,last_result TEXT NOT NULL DEFAULT 'not_run',last_error TEXT,updated_at TEXT NOT NULL,PRIMARY KEY(tenant,provider));`);
 }
 require(user){this.identity.require(user,['super_user'],user?.tenant);return user.tenant}
 list(user){const tenant=this.require(user);return this.store.db.prepare('SELECT provider,enabled,frequency,next_at,last_at,last_result,last_error,updated_at FROM hf_source_schedules WHERE tenant=? ORDER BY provider').all(tenant).map(x=>({...x,enabled:!!x.enabled,localProcessOnly:true}));}
 configure(user,{provider,frequency='daily',enabled=false}={}){
  const tenant=this.require(user);if(!permitted.has(provider)||!Object.hasOwn(periods,frequency)||typeof enabled!=='boolean')throw Error('Invalid retrieval schedule');
  if(enabled&&!this.live.profile(user).sources[provider])throw Error('Source must be enabled in discovery settings');
  if(enabled&&provider==='ticketmaster'&&!process.env.HF_TICKETMASTER_API_KEY)throw Error('Ticketmaster credentials not configured');
  const at=this.clock(),previous=this.store.db.prepare('SELECT * FROM hf_source_schedules WHERE tenant=? AND provider=?').get(tenant,provider);
  // Changes never force a new fetch immediately; no accumulated catch-up runs.
  const next=enabled?(previous?.enabled&&previous.frequency===frequency?Math.max(at,previous.next_at):at+60000):0;
  this.store.db.prepare(`INSERT INTO hf_source_schedules(tenant,provider,owner_id,enabled,frequency,next_at,last_at,last_result,last_error,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?) ON CONFLICT(tenant,provider) DO UPDATE SET owner_id=excluded.owner_id,enabled=excluded.enabled,frequency=excluded.frequency,next_at=excluded.next_at,updated_at=excluded.updated_at`).run(tenant,provider,user.id,enabled?1:0,frequency,next,previous?.last_at||null,previous?.last_result||'not_run',previous?.last_error||null,new Date(at).toISOString());
  this.identity.audit(user.id,'discovery.schedule.configure',{tenant,provider,frequency,enabled,localProcessOnly:true});return this.list(user).find(x=>x.provider===provider);
 }
 async tick(){const at=this.clock();const due=this.store.db.prepare('SELECT * FROM hf_source_schedules WHERE enabled=1 AND next_at<=? ORDER BY next_at LIMIT 8').all(at);const results=[];
  for(const item of due){const key=item.tenant+':'+item.provider;if(this.running.has(key))continue;
   const owner=this.store.db.prepare('SELECT id,username,role,tenant,disabled FROM hf_users WHERE id=? AND tenant=?').get(item.owner_id,item.tenant);
   if(!owner||owner.disabled||owner.role!=='super_user'){this.store.db.prepare(`UPDATE hf_source_schedules SET enabled=0,last_result='disabled',last_error='Owner account no longer authorised',updated_at=? WHERE tenant=? AND provider=?`).run(new Date(at).toISOString(),item.tenant,item.provider);continue}
   this.running.add(key);
   // Claim the due interval before external I/O to prevent duplicate attempts after restart.
   this.store.db.prepare(`UPDATE hf_source_schedules SET next_at=?,last_at=?,last_result='running',last_error=NULL,updated_at=? WHERE tenant=? AND provider=? AND enabled=1`).run(at+periods[item.frequency],at,new Date(at).toISOString(),item.tenant,item.provider);
   try{const run=await this.live.run(owner,item.provider);const processing=this.processing.queueRun(owner,run.runId);this.store.db.prepare(`UPDATE hf_source_schedules SET last_result='completed',last_error=NULL,updated_at=? WHERE tenant=? AND provider=?`).run(new Date(this.clock()).toISOString(),item.tenant,item.provider);results.push({provider:item.provider,tenant:item.tenant,status:'completed',newReports:run.created+run.updated,newReviewItems:processing.newlyQueued});}
   catch(error){const diagnostic=String(error?.message||'External request failed').slice(0,160);this.store.db.prepare(`UPDATE hf_source_schedules SET last_result='failed',last_error=?,updated_at=? WHERE tenant=? AND provider=?`).run(diagnostic,new Date(this.clock()).toISOString(),item.tenant,item.provider);this.identity.audit(owner.id,'discovery.schedule.failed',{provider:item.provider,error:diagnostic});results.push({provider:item.provider,tenant:item.tenant,status:'failed'});}
   finally{this.running.delete(key)}
  }
  // Item-specific due work is coordinated by the existing scheduler, never a parallel timer.
  if(this.monitoring){
   const tenants=this.store.db.prepare('SELECT DISTINCT tenant FROM hf_monitor_items WHERE next_at<=? LIMIT 4').all(this.clock());
   let providerFetches=0;
   for(const {tenant} of tenants){
    const owner=this.store.db.prepare("SELECT id,username,role,tenant,disabled FROM hf_users WHERE tenant=? AND role='super_user' AND disabled=0 ORDER BY id LIMIT 1").get(tenant);
    if(!owner)continue;
    for(const item of this.monitoring.claimDue(owner,{limit:8})){
     const key=tenant+':'+item.provider;
     try{
      // Reuse a provider retrieval just performed by this tick when available.
      const fresh=results.some(r=>r.tenant===tenant&&r.provider===item.provider&&r.status==='completed');
      const profile=this.live.profile(owner);
      const permittedFetch=permitted.has(item.provider)&&!!profile.sources[item.provider];
      if(!fresh&&permittedFetch&&providerFetches<2&&!this.running.has(key)){
       providerFetches++;this.running.add(key);
       try{const run=await this.live.run(owner,item.provider);this.processing.queueRun(owner,run.runId);results.push({provider:item.provider,tenant,status:'item_retrieval_completed',newReports:run.created+run.updated});}
       catch(error){this.monitoring.failed(owner,{provider:item.provider,externalKey:item.externalKey,error:String(error?.message||'Retrieval failed')});results.push({provider:item.provider,tenant,status:'item_retrieval_failed'});}
       finally{this.running.delete(key)}
      }
      // If the item was not refreshed by an authorised provider call, inspect its cached state.
      const after=this.store.db.prepare('SELECT checked_at,source_hash FROM hf_monitor_items WHERE tenant=? AND provider=? AND external_key=?').get(tenant,item.provider,item.externalKey);
      if(after&&after.checked_at===item.lastCheckedAt){const result=this.monitoring.inspectCached(owner,item,{reason:fresh?'Provider returned no changed record':'Provider did not return an updated item'});results.push({provider:item.provider,tenant,externalKey:item.externalKey,status:result.state,source:result.source});}
     }catch(error){this.monitoring.failed(owner,{provider:item.provider,externalKey:item.externalKey,error:String(error?.message||'Item check failed')});results.push({provider:item.provider,tenant,status:'item_failed'});}
    }
   }
  }
  return results;
 }
 start(){if(this.timer)return;this.timer=setInterval(()=>{this.tick().catch(e=>console.error('Scheduled intelligence run:',e.message))},this.intervalMs);this.timer.unref?.()}
 stop(){if(this.timer)clearInterval(this.timer);this.timer=null}
}
