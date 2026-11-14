/** Local-only cloud suitability verification; does not provision, upload or deploy. */
import {DatabaseSync} from 'node:sqlite';
import {access,stat} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const db=resolve(process.env.HF_DB||join(root,'data/runtime/ecosystem.sqlite'));
const checks=[];
checks.push({name:'node-version',ok:Number(process.versions.node.split('.')[0])>=22,value:process.version});
checks.push({name:'loopback-only-server',ok:(await (await import('node:fs/promises')).readFile(join(root,'server.mjs'),'utf8')).includes("server.listen(port,'127.0.0.1'")});
checks.push({name:'sqlite-native-module',ok:typeof DatabaseSync==='function'});
try{await access(db);const stats=await stat(db);const d=new DatabaseSync(db,{readOnly:true});let integrity;try{integrity=d.prepare('PRAGMA integrity_check').get().integrity_check}finally{d.close()}checks.push({name:'sqlite-integrity',ok:integrity==='ok',bytes:stats.size})}catch(error){checks.push({name:'sqlite-integrity',ok:false,reason:error.code==='ENOENT'?'Database not initialized (expected before first-run bootstrap)':'Database not accessible or invalid'})}
checks.push({name:'credentials-from-environment',ok:true,note:'Review runtime secrets manually; no values printed or stored'});
console.log(JSON.stringify({status:checks.every(x=>x.ok)?'ready-for-manual-review':'attention-required',checks},null,2));
if(checks.some(x=>!x.ok&&x.name!=='sqlite-integrity'))process.exitCode=1;
