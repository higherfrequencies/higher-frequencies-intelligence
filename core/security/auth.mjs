import {randomBytes,scryptSync,timingSafeEqual,createHash} from 'node:crypto';
const roles=new Set(['super_user','executive','management','security','caretaker','department_admin','specialist','operator','external_admin','external_user']);
const privileged=new Set(['super_user','management']);
const digest=x=>createHash('sha256').update(x).digest('hex');
export class IdentityService{
 constructor(store){this.store=store;store.db.exec(`CREATE TABLE IF NOT EXISTS hf_users(id TEXT PRIMARY KEY,username TEXT UNIQUE NOT NULL,role TEXT NOT NULL,tenant TEXT NOT NULL,salt TEXT NOT NULL,hash TEXT NOT NULL,disabled INTEGER NOT NULL DEFAULT 0);CREATE TABLE IF NOT EXISTS hf_sessions(token_hash TEXT PRIMARY KEY,user_id TEXT NOT NULL,expires INTEGER NOT NULL,FOREIGN KEY(user_id) REFERENCES hf_users(id));CREATE TABLE IF NOT EXISTS hf_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,at TEXT NOT NULL,actor TEXT NOT NULL,action TEXT NOT NULL,details TEXT NOT NULL)`)}
 audit(actor,action,details={}){this.store.db.prepare('INSERT INTO hf_audit(at,actor,action,details) VALUES(?,?,?,?)').run(new Date().toISOString(),actor,action,JSON.stringify(details))}
 createUser({username,password,role='operator',tenant='internal'},actor=null){
  if(!roles.has(role)||!/^[-\w]{3,64}$/.test(username||'')||typeof password!=='string'||password.length<12||password.length>1024||!/^[-\w]{1,64}$/.test(tenant))throw Error('Invalid account fields');
  const n=this.store.db.prepare('SELECT COUNT(*) AS n FROM hf_users').get().n;
  if(n){const trusted=actor?.id&&this.store.db.prepare('SELECT role,tenant,disabled FROM hf_users WHERE id=?').get(actor.id);if(!trusted||trusted.disabled||trusted.role!==actor.role||trusted.tenant!==actor.tenant||!privileged.has(trusted.role)||trusted.tenant!=='internal')throw Error('Forbidden');}
  if(!n && (role!=='super_user'||tenant!=='internal'))throw Error('First user must be internal super_user');
  const salt=randomBytes(16).toString('hex'),hash=scryptSync(password,salt,64).toString('hex'),id=randomBytes(16).toString('hex');
  this.store.transaction(()=>{this.store.db.prepare('INSERT INTO hf_users(id,username,role,tenant,salt,hash) VALUES(?,?,?,?,?,?)').run(id,username,role,tenant,salt,hash);this.audit(actor?.id||'bootstrap','user.create',{id,role,tenant})});return {id,username,role,tenant};
 }
 login(username,password){const u=this.store.db.prepare('SELECT * FROM hf_users WHERE username=?').get(username);const candidate=scryptSync(typeof password==='string'?password:'',u?.salt||'00000000000000000000000000000000',64);const valid=u&&!u.disabled&&timingSafeEqual(candidate,Buffer.from(u.hash,'hex'));if(!valid){this.audit('anonymous','login.denied',{username:String(username).slice(0,64)});throw Error('Invalid credentials')};const token=randomBytes(32).toString('base64url'),expires=Date.now()+8*3600000;this.store.db.prepare('INSERT INTO hf_sessions(token_hash,user_id,expires) VALUES(?,?,?)').run(digest(token),u.id,expires);this.audit(u.id,'login.success');return {token,expires}}
 authenticate(token){if(typeof token!=='string'||token.length>200)return null;const u=this.store.db.prepare('SELECT u.id,u.username,u.role,u.tenant FROM hf_sessions s JOIN hf_users u ON u.id=s.user_id WHERE s.token_hash=? AND s.expires>? AND u.disabled=0').get(digest(token),Date.now());return u||null}
 logout(token){this.store.db.prepare('DELETE FROM hf_sessions WHERE token_hash=?').run(digest(token));}
 require(user,rolesAllowed,tenant=null){const persisted=user?.id&&this.store.db.prepare('SELECT role,tenant,disabled FROM hf_users WHERE id=?').get(user.id);if(!persisted||persisted.disabled||persisted.role!==user.role||persisted.tenant!==user.tenant||!rolesAllowed.includes(persisted.role)||(tenant&&persisted.tenant!==tenant&&persisted.role!=='super_user')){this.audit(user?.id||'anonymous','access.denied',{rolesAllowed,tenant});throw Error('Forbidden')}return user}
}
