/** Read-only, bounded and non-secret operational diagnostics for the local SQLite deployment. */
export function databaseIntegrity(store){
 const db=store.db;
 const integrity=db.prepare('PRAGMA integrity_check').all().map(row=>String(row.integrity_check));
 const foreignKeys=db.prepare('PRAGMA foreign_key_check').all().map(row=>({table:row.table,rowid:row.rowid,parent:row.parent,foreignKey:row.fkid}));
 const tables=db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name").all().map(row=>row.name);
 const mandatory=['hf_users','hf_events','hf_audit','hf_objectives'];
 const missing=mandatory.filter(name=>!tables.includes(name));
 const result={checkedAt:new Date().toISOString(),mode:'read_only',integrityOk:integrity.length===1&&integrity[0]==='ok',foreignKeysOk:foreignKeys.length===0,requiredTablesPresent:missing.length===0,missingTables:missing,foreignKeyViolations:foreignKeys.slice(0,20),integrityMessages:integrity.filter(x=>x!=='ok').slice(0,20),tableCount:tables.length,schemaVersion:db.prepare('PRAGMA user_version').get().user_version};
 return {...result,healthy:result.integrityOk&&result.foreignKeysOk&&result.requiredTablesPresent};
}
/** Do not return raw audit details: those can include usernames and sensitive resource names. */
export function auditSummary(store,{limit=50,action=''}={}){
 if(!Number.isInteger(limit)||limit<1||limit>100)throw Error('Invalid audit limit');
 if(typeof action!=='string'||action.length>100||/[^a-zA-Z0-9_.:-]/.test(action))throw Error('Invalid audit filter');
 const rows=action?store.db.prepare('SELECT id,at,actor,action FROM hf_audit WHERE action=? ORDER BY id DESC LIMIT ?').all(action,limit):store.db.prepare('SELECT id,at,actor,action FROM hf_audit ORDER BY id DESC LIMIT ?').all(limit);
 return {records:rows,total:store.db.prepare('SELECT COUNT(*) AS n FROM hf_audit').get().n,redactedDetails:true};
}
