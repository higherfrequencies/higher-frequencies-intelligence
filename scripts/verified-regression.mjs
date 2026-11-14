/** Reproducible per-file regression runner with explicit child lifetime and failure evidence.
 * Usage: node scripts/verified-regression.mjs [--workers=2] [--timeout=60000] [--out=path]
 * Does not waive tests, retry failed tests, or count unfinished tests as passed.
 */
import {spawn} from 'node:child_process';
import {readdir, mkdir, writeFile} from 'node:fs/promises';
import {join, dirname, resolve} from 'node:path';
import {cpus, freemem, totalmem} from 'node:os';
import {fileURLToPath} from 'node:url';
const root=dirname(dirname(fileURLToPath(import.meta.url)));
const args=Object.fromEntries(process.argv.slice(2).filter(x=>x.startsWith('--')).map(x=>{const [key,...parts]=x.slice(2).split('=');return [key,parts.join('=')]}));
const workers=Math.max(1,Math.min(8,Number(args.workers||2)));
const timeoutMs=Math.max(5000,Number(args.timeout||60000));
const tests=(await readdir(join(root,'tests'))).filter(n=>n.endsWith('.test.mjs')&&(!args.match||n.includes(args.match))).sort();
const output=args.out?resolve(args.out):resolve(root,'docs/test-evidence/VERIFIED-REGRESSION.json');
const startedAt=new Date().toISOString();let next=0;const records=[];const progress=output.replace(/\.json$/i,'.progress.json');const running=new Map();
async function checkpoint(){await mkdir(dirname(progress),{recursive:true});await writeFile(progress,JSON.stringify({startedAt,updatedAt:new Date().toISOString(),platform:process.platform,node:process.version,workers,concurrent: [...running.values()],completed:records.filter(Boolean),availableMemoryBytes:freemem(),totalMemoryBytes:totalmem(),cpuCount:cpus().length},null,2))}
async function run(file,workerId){return new Promise(resolveRun=>{
 const start=Date.now(); const child=spawn(process.execPath,['--test','--test-concurrency=1',join(root,'tests',file)],{cwd:root,env:{...process.env},stdio:['ignore','pipe','pipe'],detached:process.platform!=='win32'});
 const entry={workerId,file,pid:child.pid,startedAt:new Date().toISOString(),startEpochMs:start,dbPath:process.env.HF_DB||'test_specific',port:process.env.PORT||'test_specific',scheduler:'test_selected'};running.set(workerId,entry);
 let stdout='',stderr='',timedOut=false,finished=false;
 const cap=(prev,bytes)=> (prev+bytes.toString()).slice(-12000);
 child.stdout.on('data',b=>stdout=cap(stdout,b));child.stderr.on('data',b=>stderr=cap(stderr,b));
 const killTree=()=>{try{if(process.platform==='win32'){spawn('taskkill',['/pid',String(child.pid),'/T','/F'],{stdio:'ignore'}).unref()}else process.kill(-child.pid,'SIGKILL')}catch{try{child.kill('SIGKILL')}catch{}}};
 const timer=setTimeout(()=>{timedOut=true;killTree()},timeoutMs);timer.unref();
 const finish=(code,signal,error)=>{if(finished)return;finished=true;clearTimeout(timer);running.delete(workerId);
 const passed=Number([...stdout.matchAll(/^\s*# pass (\d+)/gm)].at(-1)?.[1]||0);
 const failed=Number([...stdout.matchAll(/^\s*# fail (\d+)/gm)].at(-1)?.[1]||0);
 resolveRun({file,workerId,pid:child.pid,startedAt:entry.startedAt,endedAt:new Date().toISOString(),status:timedOut?'timeout':error?'spawn-error':code===0&&passed>0&&failed===0?'passed':'failed',passed,failed,exitCode:code,signal,durationMs:Date.now()-start,stderr:stderr.slice(-1800),stdoutTail:stdout.slice(-2400),...(error?{error:String(error)}:{})});
 };
 child.on('error',e=>finish(null,null,e));child.on('close',(code,signal)=>finish(code,signal));
 })}
async function worker(workerId){while(next<tests.length){const index=next++;const result=await run(tests[index],workerId);records[index]=result;await checkpoint();console.log(`${index+1}/${tests.length} ${result.status} ${result.file} (${result.passed} passed, ${result.durationMs}ms)`);}}
await checkpoint();await Promise.all(Array.from({length:workers},(_,i)=>worker(i+1)));
const passed=records.reduce((sum,r)=>sum+r.passed,0),failedFiles=records.filter(r=>r.status!=='passed');
const summary={startedAt,finishedAt:new Date().toISOString(),runtime:process.version,platform:process.platform,workers,timeoutMs,testFiles:tests.length,diagnosticProgress:progress,completedFiles:records.length,passedAssertions:passed,failedFiles:failedFiles.length,complete:records.length===tests.length&&failedFiles.length===0,notes:['One child per test file to identify hangs and avoid test-harness resource leakage','Failed/timed-out files are never counted as passing; no retries','Parallelism can still expose application/port collisions; this runner records individual failures'],records};
await mkdir(dirname(output),{recursive:true});await writeFile(output,JSON.stringify(summary,null,2));console.log(JSON.stringify({complete:summary.complete,passedAssertions:passed,failedFiles:failedFiles.map(x=>x.file),output}));if(!summary.complete)process.exitCode=1;
