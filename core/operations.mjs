/** Read-only local operational summary; never exposes raw confidential payloads. */
export function operationsSnapshot(store){
 const count=ns=>store.db.prepare('SELECT COUNT(*) AS n FROM kv WHERE namespace=?').get(ns).n;
 const jobCounts=store.db.prepare('SELECT status,COUNT(*) AS n FROM jobs GROUP BY status').all();
 const intentCounts=store.db.prepare("SELECT json_extract(value,'$.status') AS status,COUNT(*) AS n FROM kv WHERE namespace='handoff-intents' GROUP BY status").all();
 const hasEvents=store.db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='hf_events'").get();const eventCounts=hasEvents?store.db.prepare("SELECT status,COUNT(*) AS n FROM hf_events GROUP BY status").all():[];
 return {events:Object.fromEntries(eventCounts.map(r=>[r.status,r.n])),generatedAt:new Date().toISOString(),source:'local-sqlite',hubCount:count('hub-registry'),researchAssessments:count('intelligence-assessments'),handoffCount:count('handoff-intents'),reconciliationRuns:count('reconciliation-runs'),learningProposals:count('learning-proposals'),jobs:Object.fromEntries(jobCounts.map(r=>[r.status,r.n])),handoffs:Object.fromEntries(intentCounts.map(r=>[r.status,r.n]))};
}
