/** Verified online SQLite snapshot; refuses to overwrite an existing backup. */
import {DatabaseSync, backup} from 'node:sqlite';
import {mkdir,stat} from 'node:fs/promises';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {validateBackup} from '../core/backup.mjs';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const database=resolve(process.env.HF_DB||join(root,'data/runtime/ecosystem.sqlite'));
const backupDir=resolve(process.argv[2]||join(root,'data/backups'));
if(backupDir===dirname(database))throw Error('Backups must use a separate directory from the active database');
await stat(database);
await mkdir(backupDir,{recursive:true,mode:0o700});
const filename='ecosystem-'+new Date().toISOString().replace(/[:.]/g,'-')+'-'+process.pid+'.sqlite';
const destination=join(backupDir,filename);
const source=new DatabaseSync(database,{readOnly:true});
try{await backup(source,destination)}finally{source.close()}
const result=await validateBackup(destination);
console.log(JSON.stringify({ok:true,backup:destination,...result}));
