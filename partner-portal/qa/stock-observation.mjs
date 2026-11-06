// Explicit fictional stock observations for the existing private QA provider.
// Never a supplier stock feed or a way to renew production inventory.
import {qaDatabaseAdmitted} from './database-boundary.mjs';
import {authCondition,permission} from '../service/clinical-kernel.mjs';
import {fail,digest} from '../platform/domain.mjs';
const iso=()=>new Date().toISOString();
const fictional=s=>typeof s==='string'&&/@example\.(test|invalid)$/.test(s);
async function admitted(env){
 if(env.SSTRX_QA_FULFILMENT_ENABLED!=='true'||env.SSTRX_QA_DATABASE_ID!=='3a891880-ea14-4a57-a02e-7f6f3de7f785'||!await qaDatabaseAdmitted(env))fail(403,'isolated_fictional_stock_required');
}
async function inventory(env,route){
 const row=await env.DB.prepare('SELECT i.*,m.medicine_name,m.email,u.email member_email FROM medicine_inventory i JOIN medicine_orders m ON m.variant_id=i.variant_id JOIN users u ON u.id=m.user_id WHERE m.order_number=? AND m.user_id=? AND i.variant_id=9911').bind(route.order_number,route.member_id).first();
 if(!row||!/^TEST[- ]/.test(row.medicine_name)||!fictional(row.email)||!fictional(row.member_email))fail(403,'owned_fictional_stock_required');
 return row;
}
export async function qaStockStatus(env,route){
 if(env.SSTRX_QA_FULFILMENT_ENABLED!=='true'||env.SSTRX_QA_DATABASE_ID!=='3a891880-ea14-4a57-a02e-7f6f3de7f785'||!await qaDatabaseAdmitted(env))return null;
 let row;try{row=await inventory(env,route);}catch(e){if(e.message==='owned_fictional_stock_required')return null;throw e;}
 return {simulation:true,variantId:9911,stockOnHand:row.stock_on_hand,reserved:row.reserved,updatedAt:row.updated_at,fresh:Date.now()-Date.parse(row.updated_at)<=300000&&Date.parse(row.updated_at)<=Date.now()};
}
async function schema(DB){
 await DB.prepare('CREATE TABLE IF NOT EXISTS qa_stub_stock_observations(client_reference TEXT PRIMARY KEY,request_digest TEXT NOT NULL,order_number TEXT NOT NULL,pharmacy_org_id TEXT NOT NULL,actor_id INTEGER NOT NULL,stock_on_hand INTEGER NOT NULL,reserved INTEGER NOT NULL,source_reference TEXT NOT NULL,observed_at TEXT NOT NULL,previous_updated_at TEXT NOT NULL,mutation_token TEXT NOT NULL)').run();
 for(const verb of ['UPDATE','DELETE'])await DB.prepare('CREATE TRIGGER IF NOT EXISTS qa_stub_stock_no_'+verb.toLowerCase()+" BEFORE "+verb+" ON qa_stub_stock_observations BEGIN SELECT RAISE(ABORT,'immutable_fictional_stock_observation'); END").run();
}
export async function recordQaStockObservation(env,actor,route,body){
 await admitted(env);
 if(actor.internal||actor.orgAdmin||!actor.mfa||actor.staff?.kind!=='dispensing'||actor.orgId!==route.pharmacy_org_id)fail(403,'assigned_pharmacy_stock_observation_required');
 if(body.acknowledgeSyntheticObservation!==true||typeof body.clientReference!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(body.clientReference)||!/^TEST[- ][A-Za-z0-9 _:.\/-]{4,150}$/.test(body.sourceReference||''))fail(422,'explicit_fictional_stock_observation_required');
 for(const key of ['stockOnHand','expectedStockOnHand','expectedReserved'])if(!Number.isSafeInteger(body[key])||body[key]<0||body[key]>100000)fail(422,'valid_fictional_stock_counts_required');
 if(typeof body.expectedUpdatedAt!=='string'||!Number.isFinite(Date.parse(body.expectedUpdatedAt)))fail(422,'expected_native_stock_revision_required');
 const current=await inventory(env,route),date=iso(),g=authCondition(actor,date);
 const profile=await env.DB.prepare('SELECT id,version,state_json FROM partner_staff WHERE hq_user_id=?').bind(actor.id).first();
 const org=await env.DB.prepare('SELECT version,state_json FROM partner_organisations WHERE id=?').bind(actor.orgId).first();
 if(!profile||!org)fail(403,'current_pharmacy_required');
 const staff=JSON.parse(profile.state_json),organisation=JSON.parse(org.state_json);
 if(staff.status!=='active'||staff.kind!=='dispensing'||staff.orgId!==actor.orgId||Number(staff.hqUserId)!==Number(actor.id)||staff.version!==actor.staff.version||organisation.kind!=='pharmacy'||organisation.status!=='approved'||organisation.expiresAt<=date||!permission(staff,route.service,'supply_decision',date,current.medicine_name))fail(403,'current_pharmacy_required');
 const guard='('+g.sql+") AND EXISTS(SELECT 1 FROM partner_staff WHERE id=? AND version=? AND state_json=?) AND EXISTS(SELECT 1 FROM partner_organisations WHERE id=? AND version=? AND state_json=? AND json_extract(state_json,'$.status')='approved' AND json_extract(state_json,'$.expiresAt')>?) AND EXISTS(SELECT 1 FROM rx_order_routes WHERE order_number=? AND pharmacy_org_id=? AND prescription_id=? AND contract_id=?) AND EXISTS(SELECT 1 FROM sstrx_qa_environment WHERE environment='joined-v31' AND database_id=? AND synthetic_only=1)";
 const guardArgs=[...g.args,profile.id,profile.version,profile.state_json,actor.orgId,org.version,org.state_json,date,route.order_number,actor.orgId,route.prescription_id,route.contract_id,env.SSTRX_QA_DATABASE_ID];
 const active=await env.DB.prepare('SELECT 1 present WHERE '+guard).bind(...guardArgs).first();if(!active)fail(403,'current_pharmacy_required');
 const requestDigest=await digest({actorId:actor.id,pharmacyOrgId:actor.orgId,orderReference:route.order_number,body});
 await schema(env.DB);
 const existing=await env.DB.prepare('SELECT * FROM qa_stub_stock_observations WHERE client_reference=?').bind(body.clientReference).first();
 if(existing){if(existing.request_digest!==requestDigest)fail(409,'fictional_stock_reference_conflict');return {simulation:true,recorded:true,duplicate:true,observedAt:existing.observed_at,stockOnHand:existing.stock_on_hand,reserved:existing.reserved,realStockVerified:false};}
 if(current.updated_at!==body.expectedUpdatedAt||current.stock_on_hand!==body.expectedStockOnHand||current.reserved!==body.expectedReserved)fail(409,'native_stock_changed');
 if(body.stockOnHand<current.reserved)fail(409,'stock_below_reservation');
 const mutationToken=crypto.randomUUID();
 await env.DB.batch([
  env.DB.prepare('UPDATE medicine_inventory SET stock_on_hand=?,updated_at=? WHERE variant_id=9911 AND updated_at=? AND stock_on_hand=? AND reserved=? AND '+guard).bind(body.stockOnHand,date,current.updated_at,current.stock_on_hand,current.reserved,...guardArgs),
  env.DB.prepare('INSERT INTO qa_stub_stock_observations SELECT ?,?,?,?,?,?,?,?,?,?,? WHERE changes()=1').bind(body.clientReference,requestDigest,route.order_number,actor.orgId,actor.id,body.stockOnHand,current.reserved,body.sourceReference,date,current.updated_at,mutationToken),
  env.DB.prepare("INSERT OR IGNORE INTO partner_audit SELECT ?, 'order', ?, (SELECT COALESCE(MAX(version),-1)+1 FROM partner_audit WHERE entity_type='order' AND entity_id=?), ?, 'fictional_stock_observed', ?, ? WHERE EXISTS(SELECT 1 FROM qa_stub_stock_observations WHERE client_reference=? AND request_digest=?)").bind('qa-stock:'+body.clientReference,route.order_number,route.order_number,String(actor.id),JSON.stringify({simulation:true,variantId:9911,sourceReference:body.sourceReference,stockOnHand:body.stockOnHand,reserved:current.reserved,realStockVerified:false}),date,body.clientReference,requestDigest)
 ]);
 const saved=await env.DB.prepare('SELECT * FROM qa_stub_stock_observations WHERE client_reference=?').bind(body.clientReference).first();
 if(!saved||saved.request_digest!==requestDigest)fail(409,'stock_or_pharmacy_access_changed');
 return {simulation:true,recorded:true,duplicate:saved.mutation_token!==mutationToken,observedAt:saved.observed_at,stockOnHand:saved.stock_on_hand,reserved:saved.reserved,realStockVerified:false};
}
