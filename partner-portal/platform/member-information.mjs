import {fail,readObject,digest} from './domain.mjs';
import {informationList} from './functional-casework.mjs';
export async function memberInformationRoute(request,env,actor,original){
 const path=new URL(request.url).pathname,m=path.match(/^\/v1\/member\/clinical-records\/([a-f0-9-]{36})\/information(?:\/([a-f0-9-]{36})\/respond)?$/);if(!m)return null;
 const reply=(b,s=200)=>Response.json(b,{status:s,headers:{'Cache-Control':'no-store, private'}});
 try{
  if(env.SSTRX_FUNCTIONAL_V3_ENABLED!=='true')fail(404,'information_response_not_open');
  const record=await env.DB.prepare('SELECT * FROM clinical_member_records WHERE id=? AND user_id=?').bind(m[1],actor.id).first();if(!record)fail(404,'record_not_found');
  if(request.method==='GET'&&!m[2])return reply({requests:await informationList(env,record)});
  if(request.method!=='POST'||!m[2])fail(405,'method_not_allowed');const b=await readObject(request);
  if(!/^[a-f0-9-]{36}$/.test(b.clientReference||'')||!Number.isInteger(b.requestVersion)||b.accuracy!==true||b.reviewSharing!==true)fail(422,'confirmed_response_required');
  const payload=await digest(b),prior=await env.DB.prepare('SELECT * FROM rx_member_information_commands WHERE member_id=? AND client_reference=?').bind(actor.id,b.clientReference).first();
  if(prior&&(prior.payload_digest!==payload||prior.request_id!==m[2]))fail(409,'information_reference_conflict');if(prior?.state==='completed')return reply({recorded:true,duplicate:true,assessmentVersion:prior.assessment_version,clinicalApproval:false});
  const item=await env.DB.prepare('SELECT * FROM rx_information_work WHERE id=? AND record_id=?').bind(m[2],record.id).first();if(!item||item.state!=='open'||item.version!==b.requestVersion)fail(409,'information_request_changed');
  const fields=JSON.parse(item.fields_json);if(!b.answers||Array.isArray(b.answers)||Object.keys(b.answers).some(k=>!fields.includes(k)))fail(422,'only_requested_fields_may_be_changed');
  const invoke=async(suffix,body)=>{const u=new URL(request.url);u.pathname='/v1/member/clinical-records/'+record.id+suffix;return original.fetch(new Request(u,{method:'POST',headers:request.headers,body:JSON.stringify(body)}),env)};
  let assessmentVersion=prior?.assessment_version;
  if(!prior){
   if(record.revision!==b.revision)fail(409,'record_changed');const latest=await env.DB.prepare('SELECT * FROM clinical_member_versions WHERE record_id=? ORDER BY version DESC LIMIT 1').bind(record.id).first();
   const result=await invoke('/assessment',{schemaVersion:record.schema_version,revision:b.revision,answers:{...JSON.parse(latest.answers_json),...b.answers},submit:true,accuracy:true,reviewSharing:true,sstInformationCommand:{clientReference:b.clientReference,requestId:item.id,requestVersion:item.version,payloadDigest:payload}});
   if(!result.ok)return result;assessmentVersion=(await result.json()).revision;
  }
  const state=await env.DB.prepare('SELECT version FROM clinical_case_state WHERE record_id=?').bind(record.id).first();const result=await invoke('/workflow/action',{version:state.version,assessmentVersion,action:'reply',requestId:item.id,message:b.message||'Requested information updated'});
  if(!result.ok)return result;return reply({recorded:true,assessmentVersion,clinicalApproval:false,requiresClinicianAcknowledgement:true});
 }catch(e){return reply({error:e.status?e.message:'information_response_unavailable'},e.status||503);}
}
