import {DatabaseSync} from 'node:sqlite';
export class TransactionalStore {
 static async open(path){return new TransactionalStore(path)}
 constructor(path){this.db=new DatabaseSync(path);this.db.exec("PRAGMA journal_mode=WAL; CREATE TABLE IF NOT EXISTS kv(namespace TEXT NOT NULL,key TEXT NOT NULL,value TEXT NOT NULL,PRIMARY KEY(namespace,key)); CREATE TABLE IF NOT EXISTS jobs(id TEXT PRIMARY KEY,payload TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0); CREATE TABLE IF NOT EXISTS leases(name TEXT PRIMARY KEY,owner TEXT NOT NULL,expires INTEGER NOT NULL);");}
 transaction(fn){if(this.db.isTransaction){this.db.exec('SAVEPOINT hf_nested');try{const value=fn(this);this.db.exec('RELEASE hf_nested');return value}catch(e){this.db.exec('ROLLBACK TO hf_nested; RELEASE hf_nested');throw e}}this.db.exec('BEGIN IMMEDIATE');try{const value=fn(this);this.db.exec('COMMIT');return value}catch(e){this.db.exec('ROLLBACK');throw e}}
 get(ns,key){const r=this.db.prepare('SELECT value FROM kv WHERE namespace=? AND key=?').get(ns,key);return r?JSON.parse(r.value):null}
 put(ns,key,value){this.db.prepare('INSERT INTO kv(namespace,key,value) VALUES(?,?,?) ON CONFLICT(namespace,key) DO UPDATE SET value=excluded.value').run(ns,key,JSON.stringify(value));return value}
 enqueue(id,payload){this.db.prepare('INSERT OR IGNORE INTO jobs(id,payload,status) VALUES(?,?,?)').run(id,JSON.stringify(payload),'pending')}
 jobs(){return this.db.prepare('SELECT * FROM jobs ORDER BY id').all().map(r=>({...r,payload:JSON.parse(r.payload)}))}
 acquireLease(name,owner,{ttlMs=120000}={}){const now=Date.now();this.db.prepare('DELETE FROM leases WHERE expires<=?').run(now);const r=this.db.prepare('INSERT OR IGNORE INTO leases(name,owner,expires) VALUES(?,?,?)').run(name,owner,now+ttlMs);return r.changes?{name,owner}:null}
 releaseLease(lease){if(lease)this.db.prepare('DELETE FROM leases WHERE name=? AND owner=?').run(lease.name,lease.owner)}
 close(){this.db.close()}
}
