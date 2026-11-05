// A public contact request is not an identity, professional approval or login.
// Transport proof is minted only by the existing branded gateway. No messages sent.
import {ensurePlatformSchema} from './schema.mjs';
import {digest,fail,text,readObject} from './domain.mjs';
export const ACCESS_REQUEST_ROLES=Object.freeze({clinician:'Clinician / prescriber',clinical_admin:'Clinical organisation administrator',pharmacy_operator:'Pharmacy professional',pharmacy_admin:'Pharmacy administrator'});
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
const hex=b=>Array.from(new Uint8Array(b),x=>x.toString(16).padStart(2,'0')).join('');
async function key(secret){if(typeof secret!=='string'||secret.length<32)fail(503,'access_requests_not_available');return crypto.subtle.importKey('raw',new TextEncoder().encode(secret),{name:'HMAC',hash:'SHA-256'},false,['sign','verify']);}
export async function signAccessRequest(secret,raw,clientAddress,issuedAt=Date.now()){
 const k=await key(secret),stamp=String(issuedAt),clientHash=hex(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode('request-source:'+clientAddress+':'+Math.floor(issuedAt/86400000))));
 const proof=hex(await crypto.subtle.sign('HMAC',k,new TextEncoder().encode(stamp+'\n'+clientHash+'\n'+raw)));return {'X-SST-Request-Time':stamp,'X-SST-Request-Source':clientHash,'X-SST-Request-Proof':proof};
}
async function verify(request,env,raw){
 const time=request.headers.get('X-SST-Request-Time'),source=request.headers.get('X-SST-Request-Source'),proof=request.headers.get('X-SST-Request-Proof');
 if(!/^\d{13}$/.test(time||'')||Math.abs(Date.now()-Number(time))>300000||!/^[a-f0-9]{64}$/.test(source||'')||!/^[a-f0-9]{64}$/.test(proof||''))fail(403,'request_transport_not_verified');
 const valid=await crypto.subtle.verify('HMAC',await key(env.SSTRX_ACCESS_REQUEST_KEY),Uint8Array.from(proof.match(/../g),x=>parseInt(x,16)),new TextEncoder().encode(time+'\n'+source+'\n'+raw));if(!valid)fail(403,'request_transport_not_verified');return source;
}
export function accessDetails(input){
 if(!UUID.test(input.clientReference||''))fail(422,'valid_request_reference_required');
 const d={fullName:text(input.fullName?.trim(),160),workEmail:text(input.workEmail?.trim().toLowerCase(),200),phone:text(input.phone?.trim(),50),organisation:text(input.organisation?.trim(),200),requestedRole:input.requestedRole,registrationReference:input.registrationReference?.trim()||'',notes:input.notes?.trim()||'',contactConfirmation:input.contactConfirmation===true};
 if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(d.workEmail)||!/[0-9]{5}/.test(d.phone.replace(/[^0-9]/g,''))||!Object.hasOwn(ACCESS_REQUEST_ROLES,d.requestedRole)||!d.contactConfirmation)fail(422,'complete_work_contact_details_required');
 if(d.registrationReference)text(d.registrationReference,120);if(d.notes)text(d.notes.replace(/[\r\n\t]+/g,' '),1000);d.notes=d.notes.replace(/[\r\n\t]+/g,' ');
 return d;
}
const reply=(b,status)=>Response.json(b,{status,headers:{'Cache-Control':'no-store, private','X-Content-Type-Options':'nosniff','X-Robots-Tag':'noindex, nofollow'}});
export async function publicAccessRequest(request,env){
 try{
  if(env.SSTRX_ACCESS_REQUESTS_ENABLED!=='true')fail(503,'access_requests_not_available');
  if(request.method!=='POST'||request.headers.get('Origin')!=='https://sstrx.shiftsometimber.co.uk')fail(403,'request_origin_not_allowed');
  const b=await readObject(request,6500),source=await verify(request,env,JSON.stringify(b));await ensurePlatformSchema(env.DB);
  const now=Date.now(),bucket=source+':'+Math.floor(now/900000),rate=await env.DB.prepare('INSERT INTO rx_access_request_limits VALUES(?,1,?) ON CONFLICT(id) DO UPDATE SET attempts=attempts+1 WHERE attempts<5 RETURNING attempts').bind(bucket,now+1800000).run();if(rate.meta.changes!==1)fail(429,'please_try_again_later');
  // Obvious automated submissions receive no account/status information.
  if(b.website)return reply({received:true,reference:b.clientReference,accessGranted:false},202);
  const details=accessDetails(b),payload=await digest(details),duplicateKey=await digest([details.workEmail,details.organisation.toLowerCase(),details.requestedRole]);
  const existing=await env.DB.prepare('SELECT payload_digest FROM rx_access_requests WHERE id=?').bind(b.clientReference).first();if(existing&&existing.payload_digest!==payload)fail(409,'request_reference_changed');
  const at=new Date().toISOString();if(!existing){
   const capacity=await env.DB.prepare("SELECT COUNT(*) n FROM rx_access_requests WHERE status IN ('pending','needs_information')").first();if(capacity.n>=1000)fail(503,'access_requests_temporarily_unavailable');
   await env.DB.batch([
    env.DB.prepare("INSERT OR IGNORE INTO rx_access_requests VALUES(?,?,?,?,'pending',1,NULL,NULL,NULL,?,?)").bind(b.clientReference,duplicateKey,payload,JSON.stringify(details),at,at),
    env.DB.prepare("INSERT INTO rx_platform_audit SELECT ?,'access-request',NULL,'access_request',?,'submitted','{}',? WHERE changes()=1").bind(crypto.randomUUID(),b.clientReference,at)
   ]);
  }
  await env.DB.prepare('DELETE FROM rx_access_request_limits WHERE expires_at<?').bind(now).run();
  return reply({received:true,reference:b.clientReference,accessGranted:false},202);
 }catch(e){return reply({error:e.status?e.message:'access_requests_temporarily_unavailable'},e.status||503);}
}
