import {readFile,writeFile} from 'node:fs/promises';import {randomUUID} from 'node:crypto';
export class StaffQueue{
 static async open(path){const q=new StaffQueue(path);try{q.tasks=JSON.parse(await readFile(path,'utf8'))}catch(e){if(e.code!=='ENOENT')throw e}return q}
 constructor(path){this.path=path;this.tasks=[]}
 async persist(){await writeFile(this.path,JSON.stringify(this.tasks,null,2))}
 snapshot(){return {tasks:structuredClone(this.tasks)}}
 async assign(input,actor){if(!actor)throw Error('Actor required');const existing=this.tasks.find(t=>t.sourceId===input.sourceId);if(existing)return {task:existing,created:false};const task={...input,id:randomUUID(),status:'pending',history:[],createdAt:new Date().toISOString()};this.tasks.push(task);await this.persist();return {task,created:true}}
 async transition(id,status,{actor,role,reason}={}){const task=this.tasks.find(t=>t.id===id);if(!task||!actor||role!==task.role)throw Error('Unauthorised transition');if(!['completed','blocked'].includes(status))throw Error('Invalid status');task.status=status;task.history.push({actor,reason,status,at:new Date().toISOString()});await this.persist();return task}
}
