import {randomUUID} from 'node:crypto';
/** Registry metadata only: never loads or executes a hub. */
const managers=new Set(['manager','super_user']);
export class HubRegistry {
 constructor(store){this.store=store}
 register(hub,{actor,role}={}){
  if(!actor||!managers.has(role))throw Error('Management authorisation required');
  if(!hub||!/^[-a-z0-9:]{3,80}$/.test(hub.id||'')||!/^\d+\.\d+\.\d+$/.test(hub.version||'')||!Array.isArray(hub.capabilities)||!hub.capabilities.every(x=>typeof x==='string'))throw Error('Invalid hub manifest');
  return this.store.transaction(db=>{
   const existing=db.get('hub-registry',hub.id);
   if(existing&&existing.version!==hub.version)throw Error('Version conflict: review and migrate explicitly');
   const entry={...hub,enabled:existing?.enabled??false,registeredAt:existing?.registeredAt??new Date().toISOString()};
   db.put('hub-registry',hub.id,entry);db.put('hub-audit',`${hub.id}:${Date.now()}`,{action:'register',actor,role,version:hub.version});return entry;
  });
 }
 setEnabled(id,enabled,{actor,role,reason}={}){
  if(!actor||!managers.has(role)||!reason?.trim()||typeof enabled!=='boolean')throw Error('Management authorisation and reason required');
  return this.store.transaction(db=>{const hub=db.get('hub-registry',id);if(!hub)throw Error('Unknown hub');const updated={...hub,enabled};db.put('hub-registry',id,updated);db.put('hub-audit',`${id}:${Date.now()}`,{action:'enablement',actor,reason,enabled});return updated});
 }
 /** Tenant-scoped manifest lifecycle over the same local KV registry. Metadata only:
  * registration never grants a mandate or executes code. These APIs require a caller
  * already authenticated by IdentityService at the actual HTTP trust boundary. */
 registerScoped(user,hub,identity){
  identity.require(user,['super_user','management']);
  if(!hub||!/^[-a-z0-9:]{3,80}$/.test(hub.id||'')||!/^\d+\.\d+\.\d+$/.test(hub.version||'')||
    !/^[-a-z0-9]{3,64}$/.test(hub.sector||'')||!/^[-a-z0-9]{3,64}$/.test(hub.department||'')||
    !Array.isArray(hub.capabilities)||!hub.capabilities.length||hub.capabilities.length>16||
    !hub.capabilities.every(x=>typeof x==='string'&&/^[-a-z0-9.]{3,80}$/.test(x)))throw Error('Invalid hub manifest');
  const key=`${user.tenant}:${hub.id}`;return this.store.transaction(db=>{
   const old=db.get('hub-registry-scoped',key);
   if(old&&old.version!==hub.version)throw Error('Version conflict: reviewed migration required');
   const now=new Date().toISOString(),entry={id:hub.id,tenant:user.tenant,version:hub.version,sector:hub.sector,department:hub.department,
    capabilities:[...new Set(hub.capabilities)],enabled:old?.enabled??false,registeredAt:old?.registeredAt??now,updatedAt:now,registeredBy:user.id};
   db.put('hub-registry-scoped',key,entry);db.put('hub-audit-scoped',randomUUID(),{tenant:user.tenant,hubId:hub.id,actor:user.id,action:'register',at:now});
   identity.audit(user.id,'hub.register',{tenant:user.tenant,id:hub.id,enabled:entry.enabled});return entry;
  });
 }
 setScopedEnabled(user,id,enabled,reason,identity){
  identity.require(user,['super_user','management']);
  if(!/^[-a-z0-9:]{3,80}$/.test(id||'')||typeof enabled!=='boolean'||typeof reason!=='string'||reason.trim().length<8||reason.length>500)throw Error('Invalid hub change');
  const key=`${user.tenant}:${id}`;return this.store.transaction(db=>{
   const old=db.get('hub-registry-scoped',key);if(!old)throw Error('Unknown hub');
   const now=new Date().toISOString(),entry={...old,enabled,updatedAt:now,changedBy:user.id};
   db.put('hub-registry-scoped',key,entry);db.put('hub-audit-scoped',randomUUID(),{tenant:user.tenant,hubId:id,actor:user.id,action:'enablement',reason:reason.trim(),enabled,at:now});
   identity.audit(user.id,'hub.enablement',{tenant:user.tenant,id,enabled});return entry;
  });
 }
 listScoped(user,identity){identity.require(user,['super_user','management','specialist','department_admin','operator']);
  return this.store.db.prepare("SELECT value FROM kv WHERE namespace='hub-registry-scoped' AND substr(key,1,?)=? ORDER BY key").all(user.tenant.length+1,`${user.tenant}:`).map(r=>JSON.parse(r.value));
 }
 scopedHistory(user,id,identity){identity.require(user,['super_user','management']);if(!/^[-a-z0-9:]{3,80}$/.test(id||''))throw Error('Invalid hub');
  // Stable append order: multiple actions can share the same millisecond timestamp.
  return this.store.db.prepare("SELECT value FROM kv WHERE namespace='hub-audit-scoped' ORDER BY rowid").all().map(r=>JSON.parse(r.value)).filter(x=>x.tenant===user.tenant&&x.hubId===id);
 }
 /** Explicit bridge from a tenant-scoped enabled hub to an already-reviewed local
  * specialist implementation. A manifest never grants code execution or a mandate.
  * Only capabilities actually advertised by the live sector registry are callable. */
 invokeScoped(user,objectiveId,{hubId,capability},identity,specialists){
  identity.require(user,['super_user','management','specialist','department_admin']);
  if(typeof hubId!=='string'||!/^[-a-z0-9:]{3,80}$/.test(hubId)||typeof capability!=='string'||!/^[-a-z0-9.]{3,80}$/.test(capability))throw Error('Invalid hub invocation');
  const hub=this.store.get('hub-registry-scoped',`${user.tenant}:${hubId}`);
  if(!hub||!hub.enabled)throw Error('Hub is not registered and enabled for tenant');
  if(!hub.capabilities.includes(capability))throw Error('Capability not declared by hub');
  const contract=specialists.discover(user,objectiveId,hub.sector);
  const supported=contract.enabled&&contract.capabilities.find(x=>x.id===capability&&x.department===hub.department);
  if(!supported)throw Error('No enabled reviewed specialist contract matches this hub');
  // The specialist's own editable-objective and role enforcement is authoritative;
  // hub registration never bypasses those controls.
  return this.store.transaction(()=>{
   const result=specialists.invoke(user,objectiveId,{sector:hub.sector,capability});
   const at=new Date().toISOString();
   this.store.put('hub-audit-scoped',randomUUID(),{tenant:user.tenant,hubId,actor:user.id,action:'invoke',objectiveId,capability,invocationId:result.id,at});
   identity.audit(user.id,'hub.specialist.invoke',{hubId,objectiveId,capability,invocationId:result.id});
   return {...result,hubId,execution:'reviewed_local_specialist_only',outboundActions:0};
  });
 }
 list(){return this.store.db.prepare("SELECT value FROM kv WHERE namespace='hub-registry'").all().map(r=>JSON.parse(r.value))}
}
