/** Windows launcher for the existing loopback-only Node application; no third-party packages. */
import {spawn,spawnSync} from 'node:child_process';
import {existsSync,readFileSync} from 'node:fs';
import {mkdir} from 'node:fs/promises';
import {join,dirname} from 'node:path';
import {fileURLToPath} from 'node:url';
import {createInterface} from 'node:readline/promises';
import {stdin as input,stdout as output} from 'node:process';
import {DatabaseSync} from 'node:sqlite';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const database=process.env.HF_DB||join(root,'data','runtime','ecosystem.sqlite');
const address='http://127.0.0.1:'+String(process.env.PORT||4173);
async function needsBootstrap(){if(!existsSync(database))return true;const db=new DatabaseSync(database);try{return !db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='hf_users'").get()||db.prepare('SELECT COUNT(*) AS count FROM hf_users').get().count===0}finally{db.close()}}
async function hiddenPassword(question){
 if(process.env.HF_BOOTSTRAP_PASSWORD)return process.env.HF_BOOTSTRAP_PASSWORD;
 if(!input.isTTY)throw Error('Interactive terminal required for first-run password entry');
 input.setRawMode(true);output.write(question);
 return await new Promise((resolve,reject)=>{
  let value='';let done=false;
  const cleanup=()=>{input.removeListener('data',onData);input.removeListener('end',onEnd);input.pause()};
  const finish=(error=null)=>{if(done)return;done=true;cleanup();if(error)reject(error);else{output.write('\n');resolve(value)}};
  const onEnd=()=>finish(Error('Password input interrupted'));
  const onData=chunk=>{for(const byte of chunk){
   if(byte===3){finish(Error('Password entry cancelled'));return}
   if(byte===13||byte===10){finish();return}
   if(byte===8||byte===127){if(value.length){value=value.slice(0,-1);output.write('\b \b')}continue}
   if(byte>=32&&byte<=126&&value.length<1024){value+=String.fromCharCode(byte);output.write('*')}
  }};
  input.setRawMode(true);input.on('data',onData);input.once('end',onEnd);input.resume();
 });
}
async function main(){if(Number(process.versions.node.split('.')[0])<22)throw Error('Node.js version 22 or later is required');await mkdir(dirname(database),{recursive:true});if(await needsBootstrap()){
 console.log('First launch: create your local administrator (no cloud account required).');
 const rl=createInterface({input,output});let username;try{username=process.env.HF_BOOTSTRAP_USER||await rl.question('Administrator username (3–64 letters/numbers): ')}finally{rl.close()}
 if(!/^[-\w]{3,64}$/.test(username||''))throw Error('Username must be 3–64 letters, numbers, underscores or hyphens.');
 console.log('Password: 12–1024 characters. Typed characters appear as *; the password is not displayed or logged.');
 let password;
 try{
  password=await hiddenPassword('Administrator password: ');
  if(password.length<12||password.length>1024)throw Error('Password must contain 12–1024 characters. No account was created.');
  if(!process.env.HF_BOOTSTRAP_PASSWORD){const confirmation=await hiddenPassword('Confirm administrator password: ');if(confirmation!==password)throw Error('Passwords do not match. No account was created.');}
 }finally{if(input.isTTY){input.setRawMode(false);input.pause()}}
 const result=spawnSync(process.execPath,['bootstrap.mjs'],{cwd:root,env:{...process.env,HF_DB:database,HF_BOOTSTRAP_USER:username,HF_BOOTSTRAP_PASSWORD:password},stdio:'inherit'});
 if(result.status!==0)throw Error('Administrator setup failed; correct the details and relaunch');
 }
 const build=JSON.parse(readFileSync(join(root,'build-info.json'),'utf8'));console.log('Higher Frequencies build '+build.buildId);
 console.log('Starting Higher Frequency on '+address+' (Ctrl+C to stop).');
 const {HF_BOOTSTRAP_PASSWORD:_discardPassword,HF_BOOTSTRAP_USER:_discardUser,...runtimeEnvironment}=process.env;
 const child=spawn(process.execPath,['server.mjs'],{cwd:root,env:{...runtimeEnvironment,HF_DB:database},stdio:'inherit'});
 let stopping=false;const stop=()=>{if(!stopping){stopping=true;child.kill('SIGTERM')}};
 process.once('SIGINT',stop);process.once('SIGTERM',stop);
 let ready=false;for(let i=0;i<100&&!stopping;i++){if(child.exitCode!==null||child.signalCode!==null)break;try{const response=await fetch(address,{signal:AbortSignal.timeout(750)});if(response.ok){ready=true;break}}catch{}await new Promise(resolve=>setTimeout(resolve,100))}
 if(!ready){stop();throw Error('Local server did not become ready; check the messages above or whether port '+String(process.env.PORT||4173)+' is already in use')}
 console.log('Operations Centre ready: '+address);
 if(process.platform==='win32'&&process.env.HF_NO_BROWSER!=='1')spawn('cmd.exe',['/c','start','""',address],{stdio:'ignore',windowsHide:true}).on('error',e=>console.warn('Open the URL manually:',e.message));
 await new Promise(resolve=>child.once('exit',resolve));if(!stopping&&child.exitCode)process.exitCode=child.exitCode;
}
main().catch(error=>{console.error('Higher Frequency launcher:',error.message);process.exitCode=1});
