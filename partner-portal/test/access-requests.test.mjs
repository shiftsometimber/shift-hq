import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import {publicAccessRequest,signAccessRequest} from '../platform/access-requests.mjs';
import portal from '../sstrx-worker.mjs';
const ORIGIN='https://sstrx.shiftsometimber.co.uk';
const json=async(r,status=200)=>{const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;};
const form=()=>({clientReference:crypto.randomUUID(),fullName:'Fictional Access Applicant',workEmail:'fictional-access@example.test',phone:'01625 000000',organisation:'Fictional Clinical Organisation',requestedRole:'clinician',registrationReference:'SYNTHETIC PUBLIC REFERENCE',notes:'FICTIONAL ACCESS REQUEST ONLY',contactConfirmation:true,website:''});
async function setup(){const f=await fixture();await ensurePlatformSchema(f.DB);Object.assign(f.env,{SSTRX_PLATFORM_ENABLED:'true',SSTRX_ACCESS_REQUESTS_ENABLED:'true',SSTRX_ACCESS_REQUEST_KEY:'SYNTHETIC-NONPRODUCTION-KEY-000000000000'});Object.assign(f.portalEnv,{SSTRX_PORTAL_ENABLED:'true',SSTRX_ACCESS_REQUESTS_ENABLED:'true',SSTRX_ACCESS_REQUEST_KEY:f.env.SSTRX_ACCESS_REQUEST_KEY});return f;}
const submit=(f,b,origin=ORIGIN)=>portal.fetch(new Request(ORIGIN+'/api/access-request',{method:'POST',headers:{Origin:origin,'Content-Type':'application/json','CF-Connecting-IP':'203.0.113.17'},body:JSON.stringify(b)}),f.portalEnv);
test('homepage CTA → anonymous form → protected native approval queue; no login, permission, email or clinical approval is created',async()=>{
 const f=await setup();try{const body=form(),users=f.sql.prepare('SELECT COUNT(*) n FROM hq_users').get().n,staff=f.sql.prepare('SELECT COUNT(*) n FROM partner_staff').get().n;const home=await portal.fetch(new Request(ORIGIN+'/'),f.portalEnv);assert.match(await home.text(),/href="\/request-access">Request access/);const page=await portal.fetch(new Request(ORIGIN+'/request-access'),f.portalEnv);assert.match(await page.text(),/Send request for approval/);assert.match(page.headers.get('X-Robots-Tag'),/noindex/);
 const result=await json(await submit(f,body),202);assert.equal(result.accessGranted,false);assert.deepEqual(Object.keys(result).sort(),['accessGranted','received','reference']);const list=await json(await f.hq('/platform/access-requests'));assert.equal(list.requests[0].details.fullName,body.fullName);assert.equal(list.requests[0].status,'pending');assert.equal(list.requests[0].contactDetailsVerified,false);assert.equal((await json(await f.hq('/partner-desk'))).counts.accessRequestsPending,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM hq_users').get().n,users);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM partner_staff').get().n,staff);assert.equal(f.authCalls.length>0,true);
 }finally{f.close()}
});
test('transport rejects a forged source, wrong origin, changed bytes and expired proof before accepting a contact request',async()=>{
 const f=await setup();try{const b=form(),raw=JSON.stringify(b),proof=await signAccessRequest(f.env.SSTRX_ACCESS_REQUEST_KEY,raw,'203.0.113.1'),request=(body,headers)=>new Request('https://api.shiftsometimber.co.uk/v1/hq/clinical/access-requests',{method:'POST',headers:{Origin:ORIGIN,'Content-Type':'application/json',...headers},body});
 await json(await publicAccessRequest(request(raw,{}),f.env),403);await json(await publicAccessRequest(request(JSON.stringify({...b,fullName:'Changed'}),proof),f.env),403);const old=await signAccessRequest(f.env.SSTRX_ACCESS_REQUEST_KEY,raw,'203.0.113.1',Date.now()-600000);await json(await publicAccessRequest(request(raw,old),f.env),403);await json(await submit(f,b,'https://untrusted.example'),403);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_access_requests').get().n,0);
 }finally{f.close()}
});
test('idempotent submission and normalised pending duplicate do not create another request or reveal an applicant status',async()=>{
 const f=await setup();try{const b=form(),first=await json(await submit(f,b),202);await json(await submit(f,b),202);const other=await json(await submit(f,{...b,clientReference:crypto.randomUUID(),workEmail:b.workEmail.toUpperCase()}),202);assert.equal(first.received,other.received);assert.equal(first.accessGranted,other.accessGranted);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_access_requests').get().n,1);await json(await submit(f,{...b,fullName:'Different person'}),409);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_platform_audit WHERE entity_type='access_request' AND action='submitted'").get().n,1);
 }finally{f.close()}
});
test('validation, anti-automation trap, bounded input and source rate limit fail closed without storing malformed applicants',async()=>{
 const f=await setup();try{await json(await submit(f,{...form(),contactConfirmation:false}),422);await json(await submit(f,{...form(),workEmail:'invalid'}),422);await json(await submit(f,{...form(),website:'filled bot field'}),202);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_access_requests').get().n,0);await json(await submit(f,form()),202);await json(await submit(f,form()),202);await json(await submit(f,form()),429);const large=await submit(f,{...form(),notes:'x'.repeat(7000)});assert.equal(large.status,413);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_access_requests').get().n,1);
 }finally{f.close()}
});
test('only the owner/admin approves requests; changed or duplicate decisions are refused and a draft uses the existing native onboarding model',async()=>{
 const f=await setup();try{const b=form();await json(await submit(f,b),202);const c=await f.login('CLNTEST');await json(await f.partner('/platform/access-requests',c),403);await json(await f.hq('/platform/access-requests/'+b.clientReference+'/review',3,{version:1,decision:'approved_for_onboarding',reviewNote:'FICTIONAL'}),403);
 const result=await json(await f.hq('/platform/access-requests/'+b.clientReference+'/review',1,{version:1,decision:'approved_for_onboarding',reviewNote:'FICTIONAL OWNER APPROVAL FOR ONBOARDING ONLY'}));assert.equal(result.accessGranted,false);assert.equal(result.notificationsSent,false);await json(await f.hq('/platform/access-requests/'+b.clientReference+'/review',1,{version:1,decision:'declined',reviewNote:'FICTIONAL'}),409);
 const before=f.sql.prepare('SELECT COUNT(*) n FROM hq_users').get().n,profile=await json(await f.hq('/platform/access-requests/'+b.clientReference+'/onboarding',1,{version:2,orgId:'clinical-org'}),201);assert.equal(profile.credentialsCreated,false);const s=JSON.parse(f.sql.prepare('SELECT state_json FROM partner_staff WHERE id=?').get(profile.staffId).state_json);assert.equal(s.status,'draft');assert.equal(s.details.name,b.fullName);assert.equal(s.details.email,b.workEmail);assert.equal(s.hqUserId,null);assert.deepEqual(s.grants,[]);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM hq_users').get().n,before);await json(await f.hq('/platform/access-requests/'+b.clientReference+'/onboarding',1,{version:2,orgId:'clinical-org'}),409);
 }finally{f.close()}
});
test('public service stays unavailable until the feature and private transport binding are configured',async()=>{
 const f=await setup();try{f.portalEnv.SSTRX_ACCESS_REQUESTS_ENABLED='false';await json(await submit(f,form()),503);f.portalEnv.SSTRX_ACCESS_REQUESTS_ENABLED='true';delete f.portalEnv.SSTRX_ACCESS_REQUEST_KEY;await json(await submit(f,form()),503);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_access_requests').get().n,0);}finally{f.close()}
});
