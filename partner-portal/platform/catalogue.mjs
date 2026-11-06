import {ensureCatalogueGovernanceSchema,readCatalogueAuthority,CATALOGUE_POLICY} from '../service/vendor/core-catalogue-governance-v31.mjs';
import {permission,authCondition} from '../service/clinical-kernel.mjs';
import {fail,readObject} from './domain.mjs';
export async function catalogueSignoff(request,env,a,variantId){
 if(env.HQ_CATALOGUE_V31_TEST_MODE!=='true'||env.SSTRX_ENVIRONMENT!=='synthetic')fail(503,'isolated_catalogue_test_environment_required');
 if(a.internal||a.orgAdmin||a.staff?.kind!=='clinician'||a.mfa!==true)fail(403,'catalogue_prescriber_required');
 const date=new Date().toISOString();let grants;try{grants=JSON.parse(env.CATALOGUE_SIGNOFF_TEST_GRANTS||'[]')}catch{grants=[]}
 const grant=Array.isArray(grants)&&grants.find(g=>g.user_id===a.id&&g.org_id===a.orgId&&g.variant_id===variantId&&g.permission==='catalogue_signoff'&&g.approval_ref&&g.expires_at>date);
 if(!grant)fail(403,'scoped_catalogue_signoff_grant_required');
 await ensureCatalogueGovernanceSchema(env.DB);
 const item=await env.DB.prepare("SELECT v.id,v.medicine_id,v.strength_label,v.selling_price_pence,v.catalogue_version,m.catalogue_version product_version,m.name,m.form FROM medicine_variants v JOIN medicine_products m ON m.id=v.medicine_id WHERE v.id=? AND m.name GLOB 'TEST-*'").bind(variantId).first();
 if(!item)fail(404,'test_medicine_variant_required');
 if(!permission(a.staff,'weight_management','issue_prescription',date,item.name))fail(403,'current_prescribing_scope_required');
 if(request.method==='GET')return {partition:'TEST',item,authority:await readCatalogueAuthority(env.DB,variantId),policy:CATALOGUE_POLICY,approval_ref:grant.approval_ref};
 if(request.method!=='POST')fail(405,'method_not_allowed');
 const b=await readObject(request);
 if(Object.keys(b).some(k=>!['productVersion','variantVersion','acknowledge'].includes(k))||b.acknowledge!==true||b.productVersion!==item.product_version||b.variantVersion!==item.catalogue_version)fail(409,'exact_catalogue_version_acknowledgement_required');
 const current=await env.DB.prepare('SELECT id,actor_id,approved_at FROM catalogue_prescriber_approvals WHERE variant_id=? AND product_version=? AND variant_version=?').bind(variantId,item.product_version,item.catalogue_version).first();
 if(current)return {recorded:true,replayed:true,approval:current,notificationsSent:false};
 const professional=await env.DB.prepare('SELECT version FROM partner_staff WHERE hq_user_id=?').bind(a.id).first(),organisation=await env.DB.prepare('SELECT version,state_json FROM partner_organisations WHERE id=?').bind(a.orgId).first();
 if(!professional||!organisation)fail(403,'current_prescriber_organisation_required');
 const org=JSON.parse(organisation.state_json),matching=a.staff.grants.filter(g=>g.credentialVersion===a.staff.credentialVersion&&!g.revokedAt&&g.area==='weight_management'&&g.actions.includes('issue_prescription')&&g.startsAt<=date&&g.expiresAt>date&&(!g.medicines.length||g.medicines.includes(item.name)));
 const dates=[grant.expires_at,org.expiresAt,...a.staff.checks.filter(c=>c.credentialVersion===a.staff.credentialVersion&&c.outcome==='verified').map(c=>c.expiresAt),...matching.map(g=>g.expiresAt)];
 if(dates.some(d=>!Number.isFinite(Date.parse(d))||d<=date))fail(403,'current_prescriber_credentials_required');
 const until=new Date(Math.min(...dates.map(Date.parse))).toISOString(),id=crypto.randomUUID(),g=authCondition(a,date);
 const result=await env.DB.batch([
  env.DB.prepare(`INSERT INTO catalogue_prescriber_approvals SELECT ?,?,?,?,?,?,?,?,?,?,?,? WHERE ${g.sql} AND EXISTS(SELECT 1 FROM medicine_variants v JOIN medicine_products m ON m.id=v.medicine_id WHERE v.id=? AND v.catalogue_version=? AND m.catalogue_version=?) AND EXISTS(SELECT 1 FROM partner_staff WHERE hq_user_id=? AND version=?) AND EXISTS(SELECT 1 FROM partner_organisations WHERE id=? AND version=?)`).bind(id,variantId,item.product_version,item.catalogue_version,a.id,a.orgId,professional.version,organisation.version,date,until,grant.approval_ref,CATALOGUE_POLICY,...g.args,variantId,item.catalogue_version,item.product_version,a.id,professional.version,a.orgId,organisation.version),
  env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,?,?,'catalogue_variant',?,'catalogue_prescriber_approved',?,? WHERE changes()=1").bind(crypto.randomUUID(),String(a.id),a.orgId,String(variantId),JSON.stringify({approvalId:id,productVersion:item.product_version,variantVersion:item.catalogue_version,approvalReference:grant.approval_ref,policy:CATALOGUE_POLICY}),date)
 ]);
 if(result[0].meta?.changes!==1)fail(409,'catalogue_or_access_changed');
 return {recorded:true,approval:{id,who:a.id,when:date,productVersion:item.product_version,variantVersion:item.catalogue_version},notificationsSent:false,patientPrescriptionCreated:false};
}
