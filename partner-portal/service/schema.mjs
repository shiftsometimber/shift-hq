import {ensurePrescriptionSchema} from './vendor/core-prescription-workflow-v1.mjs';
import {ensureOrderReferenceRegistry} from './vendor/core-order-reference-v1.mjs';
const ready=new WeakMap();
export async function ensureSharedSchema(DB){
 if(ready.has(DB))return ready.get(DB);
 const task=(async()=>{
  await ensurePrescriptionSchema(DB);
  await ensureOrderReferenceRegistry(DB);
  await DB.prepare(`CREATE TABLE IF NOT EXISTS partner_workflow_sync(id INTEGER PRIMARY KEY AUTOINCREMENT,source_key TEXT NOT NULL UNIQUE,record_id TEXT NOT NULL,order_number TEXT NOT NULL,member_id INTEGER NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,created_at TEXT NOT NULL,completed_at TEXT)`).run();
  await DB.prepare(`CREATE INDEX IF NOT EXISTS partner_workflow_sync_pending ON partner_workflow_sync(status,id)`).run();
  await DB.prepare(`CREATE TABLE IF NOT EXISTS partner_hq_threads(id TEXT PRIMARY KEY,order_number TEXT NOT NULL,org_id TEXT NOT NULL,staff_id TEXT NOT NULL,subject TEXT NOT NULL,priority TEXT NOT NULL DEFAULT 'normal',status TEXT NOT NULL DEFAULT 'awaiting_hq',version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`).run();
  await DB.prepare(`CREATE TABLE IF NOT EXISTS partner_hq_messages(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES partner_hq_threads(id),version INTEGER NOT NULL,actor_id INTEGER NOT NULL,actor_kind TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(thread_id,version))`).run();
 })();ready.set(DB,task);try{await task}catch(e){ready.delete(DB);throw e;}
}
