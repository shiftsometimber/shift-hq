import {qaDatabaseAdmitted} from './database-boundary.mjs';
import {fail,digest,text} from '../platform/domain.mjs';
import {financeGuard} from '../platform/refunds.mjs';
import {captureOrderRoute,queueSubmission,submitJob} from '../platform/integrations.mjs';
export async function setupStubProvider(env,a,action,b){
 if(!a.internal||!a.commercial)fail(403,'owner_integration_access_required');
 if(env.SSTRX_QA_FULFILMENT_ENABLED!=='true'||!await qaDatabaseAdmitted(env))fail(503,'isolated_stub_provider_required');
 const date=new Date().toISOString(),g=financeGuard(env,a),active=await env.DB.prepare('SELECT 1 ok WHERE '+g.sql).bind(...g.args).first();if(!active)fail(409,'integration_access_changed');
 text(b.approvalReference,300);
 if(action==='stub-contract'){
  text(b.contractReference,120);if(!/^TEST[-_][A-Za-z0-9_-]+$/.test(b.contractReference)||!Number.isSafeInteger(b.variantId))fail(422,'test_contract_and_variant_required');
  for(const [id,kind]of [[b.clinicalOrgId,'clinical'],[b.pharmacyOrgId,'pharmacy']]){const row=await env.DB.prepare('SELECT state_json FROM partner_organisations WHERE id=?').bind(id).first(),o=row?JSON.parse(row.state_json):null;if(!o||o.status!=='approved'||o.kind!==kind||o.expiresAt<=date)fail(409,'approved_test_organisations_required');}
  const v=await env.DB.prepare('SELECT v.id,v.strength_label,m.name FROM medicine_variants v JOIN medicine_products m ON m.id=v.medicine_id WHERE v.id=?').bind(b.variantId).first();if(!v||!/^(?:TEST[- ]|Synthetic )/.test(v.name))fail(409,'fictional_catalogue_variant_required');
  const id='TEST-STUB-CONTRACT-'+(await digest(b.contractReference)).slice(0,24),config={variantId:b.variantId,pharmacyOrgId:b.pharmacyOrgId,services:['weight_management'],contractReference:b.contractReference,approvalReference:b.approvalReference,simulation:true,receiptContract:{schemaVersion:'sst-rx-event-v1',approvalReference:b.approvalReference}},configJson=JSON.stringify(config);
  const prior=await env.DB.prepare('SELECT * FROM rx_supplier_contracts WHERE id=?').bind(id).first();if(prior&&(prior.org_id!==b.clinicalOrgId||prior.config_json!==configJson))fail(409,'stub_contract_reference_conflict');
  const oldMapping=await env.DB.prepare('SELECT variant_id FROM rx_product_mappings WHERE contract_id=?').bind(id).first();if(oldMapping&&oldMapping.variant_id!==b.variantId)fail(409,'stub_contract_reference_conflict');
  await env.DB.batch([env.DB.prepare(`INSERT OR IGNORE INTO rx_supplier_contracts SELECT ?,?,'synthetic',1,'approved',?,? WHERE ${g.sql}`).bind(id,b.clinicalOrgId,configJson,date,...g.args),env.DB.prepare("INSERT OR IGNORE INTO rx_product_mappings SELECT ?,?,?,'TEST-FORMULATION',?,'TEST-ONE-PACK',1 WHERE EXISTS(SELECT 1 FROM rx_supplier_contracts WHERE id=? AND config_json=?)").bind(id,v.id,'TEST-STUB-SKU-'+v.id,v.strength_label,id,configJson)]);
  const saved=await env.DB.prepare('SELECT * FROM rx_supplier_contracts WHERE id=?').bind(id).first();if(!saved||saved.config_json!==configJson)fail(409,'integration_access_changed');
  await env.DB.prepare("INSERT OR IGNORE INTO rx_platform_audit VALUES(?,?,NULL,'supplier_contract',?,'fictional_stub_configured',?,?)").bind('stub-contract:'+id,String(a.id),id,JSON.stringify({variantId:v.id,approvalReference:b.approvalReference,simulation:true}),date).run();
  return {simulation:true,contractId:id,version:1,duplicate:!!prior,realSupplierCommissioned:false};
 }
 if(action!=='stub-handover')fail(404,'not_found');
 const c=await env.DB.prepare("SELECT * FROM rx_supplier_contracts WHERE id=? AND adapter_id='synthetic' AND state='approved'").bind(b.contractId).first();if(!c)fail(404,'test_contract_not_found');
 const config=JSON.parse(c.config_json);if(!config.simulation)fail(409,'explicit_test_contract_required');
 const r=await env.DB.prepare("SELECT m.order_number,m.user_id,m.variant_id,m.email,m.medicine_name,m.stripe_checkout_session_id,f.partner_id,json_extract(f.state_json,'$.prescriptionId') prescription_id FROM medicine_orders m JOIN partner_fulfilment f ON f.order_number=m.order_number AND f.member_id=m.user_id WHERE m.order_number=?").bind(b.orderReference).first();
 if(!r||!/@example\.(?:test|invalid)$/.test(r.email)||!/^(?:TEST[- ]|Synthetic )/.test(r.medicine_name)||!/^cs_test_/.test(r.stripe_checkout_session_id||'')||r.partner_id!==config.pharmacyOrgId)fail(409,'matching_signed_test_order_required');
 const route=await captureOrderRoute(env.DB,{orderNumber:r.order_number,memberId:r.user_id,clinicalOrgId:c.org_id,pharmacyOrgId:r.partner_id,contractId:c.id,prescriptionId:r.prescription_id,variantId:r.variant_id,service:'weight_management',authorisationReference:b.approvalReference},env),job=await queueSubmission(env.DB,route),result=await submitJob(env,job.id);
 await env.DB.prepare("INSERT OR IGNORE INTO rx_platform_audit VALUES(?,?,NULL,'supplier_route',?,'fictional_stub_handover',?,?)").bind('stub-route:'+job.id,String(a.id),r.order_number,JSON.stringify({contractId:c.id,jobId:job.id,approvalReference:b.approvalReference,simulation:true}),date).run();
 return {simulation:true,jobId:job.id,orderReference:r.order_number,...result,realSupplierOrderCreated:false};
}
