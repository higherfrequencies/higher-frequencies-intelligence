import {readFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
const catalogue=JSON.parse(readFileSync(fileURLToPath(new URL('../data/public-research/catalogue.json',import.meta.url)),'utf8'));
/** Offline snapshots of publicly published figures, not a live external data connector. */
export class PublicResearch {
 constructor(store,workbench){this.store=store;this.workbench=workbench;store.db.exec(`CREATE TABLE IF NOT EXISTS hf_public_sources(id TEXT PRIMARY KEY,publisher TEXT NOT NULL,title TEXT NOT NULL,source_url TEXT NOT NULL,published_at TEXT,observed_at TEXT NOT NULL,record_json TEXT NOT NULL,sha256 TEXT NOT NULL);CREATE TABLE IF NOT EXISTS hf_public_imports(tenant TEXT NOT NULL,objective_id TEXT NOT NULL,source_id TEXT NOT NULL,evidence_id TEXT NOT NULL,imported_at TEXT NOT NULL,PRIMARY KEY(tenant,objective_id,source_id));`);for(const row of catalogue){const raw=JSON.stringify(row),hash=createHash('sha256').update(raw).digest('hex');store.db.prepare('INSERT OR IGNORE INTO hf_public_sources VALUES(?,?,?,?,?,?,?,?)').run(row.id,row.publisher,row.title,row.sourceUrl,row.publishedAt,row.observedAt,raw,hash)}}
 list(user){this.workbench.require(user,['management','super_user','specialist','department_admin','operator']);return this.store.db.prepare('SELECT id,publisher,title,source_url,published_at,observed_at,record_json,sha256 FROM hf_public_sources ORDER BY id').all().map(({record_json,...x})=>({...x,kind:JSON.parse(record_json).kind||'market',classification:'cached_public_source_not_live'}))}
 import(user,objectiveId,sourceId){this.workbench.require(user,['management','super_user','specialist','department_admin']);this.workbench.editable(user,objectiveId);const row=this.store.db.prepare('SELECT * FROM hf_public_sources WHERE id=?').get(sourceId);if(!row)throw Error('Source not found');return this.store.transaction(()=>{const prior=this.store.db.prepare('SELECT evidence_id FROM hf_public_imports WHERE tenant=? AND objective_id=? AND source_id=?').get(user.tenant,objectiveId,sourceId);if(prior)return {evidenceId:prior.evidence_id,duplicate:true};const item=JSON.parse(row.record_json);const content=JSON.stringify({claims:item.claims,organisation:item.organisation||null,sourceMetadata:{publisher:item.publisher,sourceUrl:item.sourceUrl,publishedAt:item.publishedAt,observedAt:item.observedAt,period:item.period,scope:item.scope,limitations:item.limitations,classification:'cached_public_observation'}});const evidence=this.workbench.addEvidence(user,objectiveId,{kind:item.kind==='organisation'?'organisation':'market',source:item.sourceUrl,content,verification:'unverified'});this.store.db.prepare('INSERT INTO hf_public_imports VALUES(?,?,?,?,?)').run(user.tenant,objectiveId,sourceId,evidence.id,new Date().toISOString());this.workbench.identity.audit(user.id,'public_source.import',{objectiveId,sourceId,evidenceId:evidence.id});return {evidenceId:evidence.id,duplicate:false}})}
 /** Register a sourced public organisation observation using the existing directory.
     This does not claim independent company-register verification or customer intent.
     Source evidence and organisation observation are created in one transaction. */
 importOrganisation(user,objectiveId,sourceId,directory){
  this.workbench.require(user,['management','super_user','specialist','department_admin']);
  this.workbench.editable(user,objectiveId);
  const row=this.store.db.prepare('SELECT record_json FROM hf_public_sources WHERE id=?').get(sourceId);
  if(!row)throw Error('Source not found');const snapshot=JSON.parse(row.record_json);
  if(snapshot.kind!=='organisation'||!snapshot.organisation)throw Error('Source does not describe an organisation');
  return this.store.transaction(()=>{
   const evidence=this.import(user,objectiveId,sourceId);
   const org=directory.add(user,objectiveId,{...snapshot.organisation,evidenceId:evidence.evidenceId});
   return {organisationId:org.id,evidenceId:evidence.evidenceId,duplicate:org.observationDuplicate,
    sourceUrl:snapshot.sourceUrl,observedAt:snapshot.observedAt,
    verification:'published_source_observed_not_independently_company_register_verified',
    intentVerified:false,externalRequests:0,outboundActions:0};
  });
 }
}
