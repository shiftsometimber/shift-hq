// Additive extensions in the SAME existing clinical/order D1. No patient copy.
const ready=new WeakMap();
export async function ensurePlatformSchema(DB){
 // Request-scoped transaction facades share the same underlying D1 schema cache.
 DB=DB.__sstrxBaseDB||DB;
 if(ready.has(DB))return ready.get(DB);
 const task=(async()=>{for(const sql of statements)await DB.prepare(sql).run()})();ready.set(DB,task);
 try{await task}catch(e){ready.delete(DB);throw e}
}
export const statements=[
 `CREATE TABLE IF NOT EXISTS rx_message_threads(id TEXT PRIMARY KEY,record_id TEXT NOT NULL REFERENCES clinical_member_records(id),order_number TEXT NOT NULL,member_id INTEGER NOT NULL,org_id TEXT NOT NULL REFERENCES partner_organisations(id),channel TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(record_id,org_id,channel))`,
 `CREATE TABLE IF NOT EXISTS rx_messages(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES rx_message_threads(id),version INTEGER NOT NULL,actor_kind TEXT NOT NULL,actor_id INTEGER NOT NULL,author_label TEXT NOT NULL,body TEXT NOT NULL,payload_digest TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(thread_id,version))`,
 `CREATE TABLE IF NOT EXISTS rx_message_reads(thread_id TEXT NOT NULL REFERENCES rx_message_threads(id),actor_kind TEXT NOT NULL,actor_id INTEGER NOT NULL,version INTEGER NOT NULL,read_at TEXT NOT NULL,PRIMARY KEY(thread_id,actor_kind,actor_id))`,
 `CREATE INDEX IF NOT EXISTS rx_message_inbox ON rx_message_threads(member_id,org_id,updated_at)`,
 `CREATE TABLE IF NOT EXISTS rx_message_alerts(id TEXT PRIMARY KEY,recipient_kind TEXT NOT NULL,recipient_id TEXT,source TEXT NOT NULL,source_id TEXT NOT NULL,source_version INTEGER NOT NULL,status TEXT NOT NULL,draft_id TEXT,created_at TEXT NOT NULL)`,

 `CREATE TABLE IF NOT EXISTS rx_access_requests(id TEXT PRIMARY KEY,duplicate_key TEXT NOT NULL,payload_digest TEXT NOT NULL,details_json TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,reviewed_by INTEGER,review_note TEXT,onboarding_staff_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
 `CREATE UNIQUE INDEX IF NOT EXISTS rx_one_open_access_request ON rx_access_requests(duplicate_key) WHERE status IN ('pending','needs_information','approved_for_onboarding','onboarding_started')`,
 `CREATE INDEX IF NOT EXISTS rx_access_request_queue ON rx_access_requests(status,created_at)`,
 `CREATE TABLE IF NOT EXISTS rx_access_request_limits(id TEXT PRIMARY KEY,attempts INTEGER NOT NULL,expires_at INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_action_claims(record_id TEXT NOT NULL REFERENCES clinical_member_records(id),source_key TEXT NOT NULL,owner_user_id INTEGER NOT NULL,version INTEGER NOT NULL,acknowledged_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(record_id,source_key))`,
 `CREATE TABLE IF NOT EXISTS rx_supply_holds(id TEXT PRIMARY KEY,order_number TEXT NOT NULL,kind TEXT NOT NULL,org_id TEXT,opened_by INTEGER NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL,source_reference TEXT NOT NULL,review_reference TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS rx_open_supply_holds ON rx_supply_holds(order_number,state)`,
 `CREATE TABLE IF NOT EXISTS rx_diagnostic_alerts(order_id TEXT PRIMARY KEY REFERENCES rx_diagnostic_orders(id),priority TEXT NOT NULL,due_at TEXT NOT NULL,source_reference TEXT NOT NULL,acknowledged_by INTEGER,ack_reference TEXT,ack_at TEXT,version INTEGER NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_diagnostic_orders(id TEXT PRIMARY KEY,record_id TEXT NOT NULL REFERENCES clinical_member_records(id),org_id TEXT NOT NULL,member_id INTEGER NOT NULL,requested_by INTEGER NOT NULL,contract_id TEXT NOT NULL,client_reference TEXT NOT NULL UNIQUE,status TEXT NOT NULL,version INTEGER NOT NULL,request_json TEXT NOT NULL,result_key TEXT,result_digest TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_diagnostic_events(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES rx_diagnostic_orders(id),event_reference TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,source_reference TEXT NOT NULL,occurred_at TEXT NOT NULL,created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_signing_origins(challenge_id TEXT PRIMARY KEY,origin TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_service_config(org_id TEXT NOT NULL,service TEXT NOT NULL,version INTEGER NOT NULL,config_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(org_id,service))`,
 `CREATE TABLE IF NOT EXISTS rx_supplier_contracts(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,adapter_id TEXT NOT NULL,version INTEGER NOT NULL,state TEXT NOT NULL,config_json TEXT NOT NULL,updated_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_product_mappings(contract_id TEXT NOT NULL REFERENCES rx_supplier_contracts(id),variant_id INTEGER NOT NULL,supplier_product_id TEXT NOT NULL,formulation TEXT NOT NULL,strength TEXT NOT NULL,pack_quantity TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(contract_id,variant_id))`,
 `CREATE TABLE IF NOT EXISTS rx_future_routing(org_id TEXT NOT NULL,service TEXT NOT NULL,version INTEGER NOT NULL,contract_id TEXT NOT NULL REFERENCES rx_supplier_contracts(id),authorisation_reference TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(org_id,service))`,
 `CREATE TABLE IF NOT EXISTS rx_order_routes(order_number TEXT PRIMARY KEY,member_id INTEGER NOT NULL,clinical_org_id TEXT NOT NULL,pharmacy_org_id TEXT NOT NULL,contract_id TEXT NOT NULL REFERENCES rx_supplier_contracts(id),contract_version INTEGER NOT NULL,service TEXT NOT NULL,prescription_id TEXT NOT NULL,product_mapping_json TEXT NOT NULL,authorisation_reference TEXT NOT NULL,created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_integration_jobs(id TEXT PRIMARY KEY,contract_id TEXT NOT NULL,order_number TEXT NOT NULL REFERENCES rx_order_routes(order_number),operation TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,payload_digest TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,remote_reference TEXT,last_code TEXT,next_attempt_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_integration_events(id TEXT PRIMARY KEY,contract_id TEXT NOT NULL,event_reference TEXT NOT NULL,order_number TEXT NOT NULL REFERENCES rx_order_routes(order_number),kind TEXT NOT NULL,occurred_at TEXT NOT NULL,received_at TEXT NOT NULL,payload_digest TEXT NOT NULL,verified_source TEXT NOT NULL,event_json TEXT NOT NULL,state TEXT NOT NULL,UNIQUE(contract_id,event_reference))`,
 `CREATE INDEX IF NOT EXISTS rx_integration_pending ON rx_integration_jobs(state,next_attempt_at)`,
 `CREATE TABLE IF NOT EXISTS rx_economics(order_number TEXT PRIMARY KEY,version INTEGER NOT NULL,terms_json TEXT NOT NULL,created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_finance_entries(id TEXT PRIMARY KEY,order_number TEXT NOT NULL REFERENCES rx_economics(order_number),event_reference TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,amount_pence INTEGER NOT NULL,currency TEXT NOT NULL,source_reference TEXT NOT NULL,occurred_at TEXT NOT NULL,created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_followups(id TEXT PRIMARY KEY,record_id TEXT NOT NULL REFERENCES clinical_member_records(id),org_id TEXT NOT NULL,assigned_user_id INTEGER NOT NULL,kind TEXT NOT NULL,due_at TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_repeat_requests(id TEXT PRIMARY KEY,previous_order_number TEXT NOT NULL,member_id INTEGER NOT NULL,client_reference TEXT NOT NULL UNIQUE,status TEXT NOT NULL,created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_platform_audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,org_id TEXT,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_order_record_links(order_number TEXT PRIMARY KEY,record_id TEXT NOT NULL UNIQUE REFERENCES clinical_member_records(id),member_id INTEGER NOT NULL,source TEXT NOT NULL,created_at TEXT NOT NULL)`,
 `CREATE TABLE IF NOT EXISTS rx_org_memberships(hq_user_id INTEGER NOT NULL,org_id TEXT NOT NULL REFERENCES partner_organisations(id),role TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(hq_user_id,org_id))`
];
