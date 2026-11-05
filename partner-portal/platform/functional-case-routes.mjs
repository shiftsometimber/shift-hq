import {caseView,caseAction,permission} from '../service/clinical-kernel.mjs';
import {withSharedOutbox,completeSharedResponse} from '../service/shared-workflow.mjs';
import {fail,readObject} from './domain.mjs';
import {verificationSummary,recordVerification,informationList,acknowledgeInformation,appendReadAudit} from './functional-casework.mjs';
export async function functionalCaseRoute(request,env,a,parts){
 if(parts[0]!=='cases')return null;
 if(env.SSTRX_FUNCTIONAL_V3_ENABLED!=='true')fail(404,'functional_casework_not_open');
 if(a.internal||a.orgAdmin||a.staff?.kind!=='clinician'||!permission(a.staff,'weight_management','review',new Date().toISOString()))fail(403,'assigned_clinician_required');
 const record=await env.DB.prepare('SELECT r.* FROM clinical_member_records r JOIN clinical_case_assignments x ON x.record_id=r.id WHERE r.id=? AND r.review_sharing=1 AND x.hq_user_id=? AND x.active=1 AND x.expires_at>?').bind(parts[1],a.id,new Date().toISOString()).first();
 if(!record)fail(404,'assigned_case_not_found');
 const latest=await env.DB.prepare('SELECT * FROM clinical_member_versions WHERE record_id=? ORDER BY version DESC LIMIT 1').bind(record.id).first();if(!latest)fail(409,'assessment_not_submitted');
 if(request.method==='GET'&&parts.length===2){
  let gates;try{const g=await verificationSummary(env,record,a.orgId,latest.version);gates={protocolVersion:g.protocol.version,requirements:g.requirements,ready:g.ready};}catch(e){if(e.status!==409)throw e;gates={ready:false,requirements:[],blocker:e.message};}
  await appendReadAudit(env,a,record,'assigned_clinical_review');
  return {record:{id:record.id,orderReference:record.order_number,memberId:record.user_id,assessmentVersion:latest.version,revision:record.revision},patient:{name:JSON.parse(latest.answers_json).fullName||'Member'},answerFields:Object.keys(JSON.parse(latest.answers_json)).sort(),workflow:await caseView(env,record,true),gates,informationRequests:await informationList(env,record,true),notificationsSent:false};
 }
 const b=await readObject(request);
 if(request.method==='POST'&&parts[2]==='verification'&&parts.length===3)return recordVerification(env,a,record,b);
 if(request.method==='POST'&&parts[2]==='information'&&parts.length===3){
  const result=await caseAction(withSharedOutbox(env),record,{...a.user,mfa:true,sessionHash:a.sessionHash},true,{...b,action:'request_information',evidenceKinds:b.evidenceKinds||[]});
  await completeSharedResponse(Response.json(result),request,env);return {workflow:result,informationRequests:await informationList(env,record,true),notificationsSent:false};
 }
 if(request.method==='POST'&&parts[2]==='information'&&parts[4]==='acknowledge'&&parts.length===5)return acknowledgeInformation(env,a,record,parts[3],b);
 fail(404,'case_action_not_found');
}
