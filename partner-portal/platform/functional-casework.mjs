// Work objects in the existing clinical D1; assessment answers remain in native immutable versions.
import {fail,text,digest} from './domain.mjs';
const now=()=>new Date().toISOString();
const rows=async q=>(await q.all()).results||[];
export const FUNCTIONAL_SCHEMA=[
 `CREATE TABLE IF NOT EXISTS rx_case_verifications(record_id TEXT NOT NULL REFERENCES clinical_member_records(id),assessment_version INTEGER NOT NULL,requirement TEXT NOT NULL,state TEXT NOT NULL,method TEXT NOT NULL,source_reference TEXT NOT NULL,verified_by INTEGER NOT NULL,expires_at TEXT NOT NULL,exception_reason TEXT,protocol_version INTEGER NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL,PRIMARY KEY(record_id,assessment_version,requirement))`,
 `CREATE TABLE IF NOT EXISTS rx_information_work(id TEXT PRIMARY KEY REFERENCES clinical_case_events(id),record_id TEXT NOT NULL REFERENCES clinical_member_records(id),requested_by INTEGER NOT NULL,assessment_version INTEGER NOT NULL,fields_json TEXT NOT NULL,due_at TEXT NOT NULL,state TEXT NOT NULL,response_version INTEGER,acknowledged_by INTEGER,acknowledged_at TEXT,version INTEGER NOT NULL,created_at TEXT NOT NULL)`,
 `CREATE INDEX IF NOT EXISTS rx_information_pending ON rx_information_work(record_id,state,due_at)`,
 `CREATE TABLE IF NOT EXISTS rx_functional_audit(id TEXT PRIMARY KEY,previous_hash TEXT NOT NULL,entry_hash TEXT NOT NULL UNIQUE,actor_id TEXT NOT NULL,org_id TEXT,record_id TEXT,action TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL)`
];
const ready=new WeakMap();
export async function ensureFunctionalSchema(DB){DB=DB.__sstrxBaseDB||DB;if(ready.has(DB))return ready.get(DB);const p=(async()=>{for(const s of FUNCTIONAL_SCHEMA)await DB.prepare(s).run()})();ready.set(DB,p);try{await p}catch(e){ready.delete(DB);throw e}}
export async function caseProtocol(env,orgId){
 const row=await env.DB.prepare("SELECT * FROM rx_service_config WHERE org_id=? AND service='weight_management'").bind(orgId).first();
 const protocol=row?JSON.parse(row.config_json).verificationProtocol:null;
 if(!protocol?.approvalReference||!Number.isInteger(protocol.version)||protocol.version<1||!Array.isArray(protocol.requirements)||!protocol.requirements.length)fail(409,'approved_verification_protocol_required');
 if(protocol.requirements.some(r=>!r.id||!Array.isArray(r.methods)||!r.methods.length)||new Set(protocol.requirements.map(r=>r.id)).size!==protocol.requirements.length)fail(409,'invalid_verification_protocol');
 return {row,protocol};
}
export async function verificationSummary(env,record,orgId,assessmentVersion){
 const {row,protocol}=await caseProtocol(env,orgId),checks=await rows(env.DB.prepare('SELECT * FROM rx_case_verifications WHERE record_id=? AND assessment_version=?').bind(record.id,assessmentVersion));
 const requirements=protocol.requirements.map(r=>{const c=checks.find(c=>c.requirement===r.id);const complete=!!c&&c.protocol_version===protocol.version&&c.expires_at>now()&&(c.state==='verified'||c.state==='exception'&&r.allowException===true&&!!c.exception_reason);return {id:r.id,label:r.label||r.id,methods:r.methods,allowException:r.allowException===true,state:complete?c.state:'pending',complete,sourceReference:c?.source_reference||null,expiresAt:c?.expires_at||null,version:c?.version||0}});
 return {row,protocol,requirements,ready:requirements.every(r=>r.complete)};
}
// This proof is also attached to the native final INSERT/UPDATE. A protocol,
// verification or acknowledgement changing between reads cannot race approval.
export async function caseGateProof(env,record,proof,assessmentVersion){
 if(env.SSTRX_FUNCTIONAL_V3_ENABLED!=='true')return {sql:'1=1',args:[]};
 const orgId=proof.organisationId||proof.orgId||proof.id;
 const {row,protocol,requirements,ready}=await verificationSummary(env,record,orgId,assessmentVersion);
 if(!ready)throw Object.assign(Error('mandatory_verification_pending'),{status:409,requirements:requirements.filter(r=>!r.complete).map(r=>r.id)});
 const pending=await env.DB.prepare("SELECT id FROM rx_information_work WHERE record_id=? AND state!='acknowledged' LIMIT 1").bind(record.id).first();
 if(pending)fail(409,'information_acknowledgement_required');
 let sql="EXISTS(SELECT 1 FROM rx_service_config WHERE org_id=? AND service='weight_management' AND version=? AND config_json=?) AND NOT EXISTS(SELECT 1 FROM rx_information_work WHERE record_id=? AND state!='acknowledged')";
 const args=[orgId,row.version,row.config_json,record.id];
 for(const r of protocol.requirements){sql+=" AND EXISTS(SELECT 1 FROM rx_case_verifications WHERE record_id=? AND assessment_version=? AND requirement=? AND protocol_version=? AND expires_at>? AND (state='verified' OR (?=1 AND state='exception' AND exception_reason IS NOT NULL AND exception_reason<>'')))";args.push(record.id,assessmentVersion,r.id,protocol.version,now(),r.allowException===true?1:0);}
 return {sql,args};
}
export function currentClinicalGuard(a,record,date=now()){
 return {sql:"EXISTS(SELECT 1 FROM hq_sessions s JOIN hq_users u ON u.id=s.hq_user_id WHERE s.hq_user_id=? AND s.token_hash=? AND s.revoked_at IS NULL AND s.expires_at>? AND u.status='active' AND u.role='clinical' AND u.mfa_enabled=1) AND EXISTS(SELECT 1 FROM clinical_case_assignments WHERE record_id=? AND hq_user_id=? AND active=1 AND expires_at>?) AND EXISTS(SELECT 1 FROM partner_staff WHERE id=? AND version=? AND state_json=?) AND EXISTS(SELECT 1 FROM partner_organisations WHERE id=? AND json_extract(state_json,'$.status')='approved' AND json_extract(state_json,'$.expiresAt')>?)",args:[a.id,a.sessionHash,date,record.id,a.id,date,a.staff.id,a.staff.version,JSON.stringify(a.staff),a.orgId,date]};
}
export async function recordVerification(env,a,record,b){
 const latest=await env.DB.prepare('SELECT version FROM clinical_member_versions WHERE record_id=? AND submitted=1 ORDER BY version DESC LIMIT 1').bind(record.id).first();
 if(!latest||latest.version!==b.assessmentVersion)fail(409,'assessment_changed');
 const {row,protocol}=await caseProtocol(env,a.orgId),requirement=protocol.requirements.find(r=>r.id===b.requirement);if(!requirement)fail(422,'protocol_requirement_required');
 if(!['verified','failed','exception'].includes(b.state)||!requirement.methods.includes(b.method))fail(422,'approved_verification_method_required');text(b.sourceReference,400);
 if(!Number.isFinite(Date.parse(b.expiresAt))||b.expiresAt<=now()||Date.parse(b.expiresAt)>Date.now()+366*86400000)fail(422,'valid_verification_expiry_required');
 if(b.state==='exception'){if(requirement.allowException!==true)fail(403,'protocol_forbids_exception');text(b.reason,1000);}
 const old=await env.DB.prepare('SELECT version FROM rx_case_verifications WHERE record_id=? AND assessment_version=? AND requirement=?').bind(record.id,latest.version,b.requirement).first();if((old?.version||0)!==b.version)fail(409,'verification_changed');
 const g=currentClinicalGuard(a,record),date=now(),r=await env.DB.batch([
  env.DB.prepare(`INSERT INTO rx_case_verifications SELECT ?,?,?,?,?,?,?,?,?,?,1,? WHERE ${g.sql} AND EXISTS(SELECT 1 FROM clinical_member_records WHERE id=? AND revision=? AND review_sharing=1) AND EXISTS(SELECT 1 FROM rx_service_config WHERE org_id=? AND service='weight_management' AND version=? AND config_json=?) ON CONFLICT(record_id,assessment_version,requirement) DO UPDATE SET state=excluded.state,method=excluded.method,source_reference=excluded.source_reference,verified_by=excluded.verified_by,expires_at=excluded.expires_at,exception_reason=excluded.exception_reason,protocol_version=excluded.protocol_version,version=rx_case_verifications.version+1,created_at=excluded.created_at WHERE rx_case_verifications.version=?`).bind(record.id,latest.version,b.requirement,b.state,b.method,b.sourceReference,a.id,b.expiresAt,b.state==='exception'?b.reason:null,protocol.version,date,...g.args,record.id,record.revision,a.orgId,row.version,row.config_json,b.version),
  env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,?,?,'verification',?,'verification_recorded',?,? WHERE changes()=1").bind(crypto.randomUUID(),String(a.id),a.orgId,record.id,JSON.stringify({requirement:b.requirement,assessmentVersion:latest.version,protocolVersion:protocol.version,state:b.state,sourceReference:b.sourceReference,expiresAt:b.expiresAt}),date)
 ]);if(r[0].meta.changes!==1)fail(409,'verification_or_access_changed');return {recorded:true,version:b.version+1,clinicalApproval:false};
}
export async function informationStatements(env,record,actor,reviewer,b,id,kind,assessment,date){
 if(env.SSTRX_FUNCTIONAL_V3_ENABLED!=='true')return [];
 if(kind==='information_requested'){
  const fields=b.requestedFields||[];
  if(!Array.isArray(fields)||fields.length>40||new Set(fields).size!==fields.length||fields.some(f=>typeof f!=='string'||!/^[A-Za-z][A-Za-z0-9_.:-]{0,99}$/.test(f)))fail(422,'valid_information_fields_required');
  if(!Number.isFinite(Date.parse(b.dueAt))||b.dueAt<=date)fail(422,'information_deadline_required');
  return [env.DB.prepare("INSERT INTO rx_information_work SELECT ?,?,?,?,?,?,'open',NULL,NULL,NULL,1,? WHERE EXISTS(SELECT 1 FROM clinical_case_events WHERE id=?)").bind(id,record.id,actor.id,assessment.version,JSON.stringify(fields),b.dueAt,date,id)];
 }
 if(kind==='member_reply')return [env.DB.prepare("UPDATE rx_information_work SET state='resubmitted',response_version=?,version=version+1 WHERE id=? AND record_id=? AND state='open' AND EXISTS(SELECT 1 FROM clinical_case_events WHERE id=?)").bind(assessment.version,b.requestId,record.id,id)];
 return [];
}
export async function informationList(env,record,clinical=false){
 const rs=await rows(env.DB.prepare('SELECT w.*,e.public_json FROM rx_information_work w JOIN clinical_case_events e ON e.id=w.id WHERE w.record_id=? ORDER BY w.created_at DESC').bind(record.id));
 const result=[];
 for(const r of rs){const base={id:r.id,recordId:r.record_id,orderReference:record.order_number,fields:JSON.parse(r.fields_json),message:JSON.parse(r.public_json).message,dueAt:r.due_at,status:r.state==='open'&&r.due_at<now()?'expired':r.state,version:r.version,assessmentVersion:r.assessment_version,responseVersion:r.response_version,acknowledgedAt:r.acknowledged_at};
  if(clinical&&r.response_version){const vs=await rows(env.DB.prepare('SELECT version,answers_json FROM clinical_member_versions WHERE record_id=? AND version IN (?,?)').bind(record.id,r.assessment_version,r.response_version));const from=JSON.parse(vs.find(v=>v.version===r.assessment_version)?.answers_json||'{}'),to=JSON.parse(vs.find(v=>v.version===r.response_version)?.answers_json||'{}');base.diff=[...new Set([...Object.keys(from),...Object.keys(to)])].filter(k=>JSON.stringify(from[k])!==JSON.stringify(to[k])).map(field=>({field,before:from[field]??null,after:to[field]??null}));}
  result.push(base);
 }
 return result;
}
export async function acknowledgeInformation(env,a,record,id,b){
 const item=await env.DB.prepare('SELECT * FROM rx_information_work WHERE id=? AND record_id=?').bind(id,record.id).first();if(!item)fail(404,'information_request_not_found');
 const latest=await env.DB.prepare('SELECT MAX(version) version FROM clinical_member_versions WHERE record_id=?').bind(record.id).first();
 if(item.state!=='resubmitted'||item.version!==b.version||item.response_version!==b.responseVersion||latest.version!==item.response_version)fail(409,'information_response_changed');
 const g=currentClinicalGuard(a,record),date=now(),r=await env.DB.batch([
  env.DB.prepare(`UPDATE rx_information_work SET state='acknowledged',acknowledged_by=?,acknowledged_at=?,version=version+1 WHERE id=? AND version=? AND response_version=? AND state='resubmitted' AND ${g.sql} AND (SELECT MAX(version) FROM clinical_member_versions WHERE record_id=?)=?`).bind(a.id,date,id,b.version,b.responseVersion,...g.args,record.id,b.responseVersion),
  env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,?,?,'information_request',?,'response_acknowledged',?,? WHERE changes()=1").bind(crypto.randomUUID(),String(a.id),a.orgId,id,JSON.stringify({responseVersion:b.responseVersion}),date)
 ]);if(r[0].meta.changes!==1)fail(409,'information_or_access_changed');return {acknowledged:true,version:b.version+1};
}
export async function appendReadAudit(env,a,record,purpose){
 text(purpose,100);const date=now(),id=crypto.randomUUID();
 const previous=await env.DB.prepare('SELECT entry_hash FROM rx_functional_audit ORDER BY rowid DESC LIMIT 1').first();const prior=previous?.entry_hash||'genesis';
 const detail={actor:a.id,org:a.orgId,record:record.id,action:'clinical_record_viewed',purpose,assessmentVersion:record.revision,at:date};const hash=await digest(prior+'|'+JSON.stringify(detail));
 const g=currentClinicalGuard(a,record),r=await env.DB.prepare(`INSERT INTO rx_functional_audit SELECT ?,?,?,?,?,?,'clinical_record_viewed',?,? WHERE ${g.sql} AND COALESCE((SELECT entry_hash FROM rx_functional_audit ORDER BY rowid DESC LIMIT 1),'genesis')=?`).bind(id,prior,hash,String(a.id),a.orgId,record.id,JSON.stringify(detail),date,...g.args,prior).run();if(r.meta.changes!==1)fail(409,'audit_or_access_changed');return {id,hash};
}
