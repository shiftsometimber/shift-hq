import {ensurePlatformSchema} from './schema.mjs';
// Connect payment to the EXISTING member clinical record. No clinical answers,
// consent, evidence, decision or signature are inferred from payment.
export async function linkPaidOrder(env,orderNumber,memberId){
 await ensurePlatformSchema(env.DB);
 const order=await env.DB.prepare("SELECT id FROM medicine_orders WHERE order_number=? AND user_id=? AND status IN ('paid','succeeded','completed','fulfilled')").bind(orderNumber,memberId).first();if(!order)return null;
 const prior=await env.DB.prepare('SELECT id,revision,schema_version FROM clinical_member_records WHERE order_number=? AND user_id=? ORDER BY created_at LIMIT 1').bind(orderNumber,memberId).first();
 const id=prior?.id||crypto.randomUUID(),at=new Date().toISOString(),version='shift-compact-v5-draft-2026-10-23';
 await env.DB.batch([
  env.DB.prepare("INSERT INTO clinical_member_records(id,user_id,order_number,schema_version,created_at,updated_at) SELECT ?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM clinical_member_records WHERE order_number=? AND user_id=?)").bind(id,memberId,orderNumber,version,at,at,orderNumber,memberId),
  env.DB.prepare("INSERT OR IGNORE INTO rx_order_record_links SELECT ?,id,user_id,'paid_order_to_native_record',? FROM clinical_member_records WHERE order_number=? AND user_id=? ORDER BY created_at LIMIT 1").bind(orderNumber,at,orderNumber,memberId)
 ]);
 const record=await env.DB.prepare('SELECT r.id,r.revision,r.schema_version FROM clinical_member_records r JOIN rx_order_record_links l ON l.record_id=r.id WHERE l.order_number=? AND l.member_id=?').bind(orderNumber,memberId).first();
 return {id:record.id,revision:record.revision,schemaVersion:record.schema_version,requiresMemberAssessment:true,clinicalApproval:false};
}
export async function linkOutstandingPaidOrders(env,limit=50){
 if(env.SSTRX_PAID_RECORD_LINK_ENABLED!=='true')return {enabled:false};
 await ensurePlatformSchema(env.DB);
 const {results=[]}=await env.DB.prepare("SELECT order_number,user_id FROM medicine_orders WHERE status='paid' AND NOT EXISTS(SELECT 1 FROM rx_order_record_links l WHERE l.order_number=medicine_orders.order_number) ORDER BY id LIMIT ?").bind(Math.min(100,limit)).all();
 let linked=0;for(const order of results)if(await linkPaidOrder(env,order.order_number,order.user_id))linked++;
 return {linked,hasMore:results.length===limit};
}
