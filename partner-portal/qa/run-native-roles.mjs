// Full native API exercise. No browser, hosted acceptance or external transport.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {buildKernel} from '../service/build-kernel.mjs';
import {buildMemberKernel} from '../service/build-member-kernel.mjs';
if(!process.env.SSTRX_QA_CORE_ROOT||!path.isAbsolute(process.env.SSTRX_QA_CORE_ROOT))throw Error('Use an explicit current Core checkout. No deployed target is accepted.');
const fixtureRoot=process.env.SSTRX_QA_NATIVE_FIXTURE_ROOT;
if(fixtureRoot&&!path.isAbsolute(fixtureRoot))throw Error('Explicit local native fixture output must be absolute');
const coreRoot=await fs.realpath(process.env.SSTRX_QA_CORE_ROOT),out=fixtureRoot?pathToFileURL(path.resolve(fixtureRoot)+path.sep):new URL('../../.partner-qa/native-roles/',import.meta.url);
await fs.mkdir(out,{recursive:true,mode:0o700});
const originalFetch=globalThis.fetch;let blockedNetworkCalls=0;
globalThis.fetch=async()=>{blockedNetworkCalls++;throw Error('External network is disabled for native role acceptance')};
let f;
const report={startedAt:new Date().toISOString(),scope:'Fictional native accounts and same-database API workflow on the explicit current Core source. Local only; not hosted/browser/device/supplier acceptance.',result:'NOT RUN',externalMessagesSent:0,realPayments:0,realPrescriptions:0,realShipments:0,hostedLoginsAvailable:false};
try{
 await buildKernel();await buildMemberKernel();
 const {fullLoop}=await import('./full-loop-scenario.mjs');
 f=await fullLoop({sstrxCandidate:true,functionalV3:true});
 assert.equal(f.report.executionError,undefined,f.report.executionError);
 assert.ok(f.report.overall?.startsWith('PASS'),f.report.overall);
 assert.ok(!f.report.checks.some(c=>c.status==='FAIL'));
 assert.ok(!f.report.workarounds.some(x=>/second native clinical record|cs_live_SYNTHETIC/.test(x)));
 const {s,env}=f;
 Object.assign(env,{MY_SHIFT_REDESIGN_ENABLED:'true',SSTRX_SECURE_MESSAGES_ENABLED:'true',SSTRX_AUDIT_V3_ENABLED:'true'});
 const {default:member}=await import('../service/member-service.mjs');
 const {hqV3Route}=await import(pathToFileURL(path.join(coreRoot,'hq-v3-api.mjs')));
 const readJSON=async(r,status=200)=>{const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d};
 const request=(endpoint,cookie=s.ownerSession)=>new Request('https://api.shiftsometimber.co.uk/v1/hq/management/v3/'+endpoint,{headers:{Cookie:cookie}});
 const commercial=await readJSON(await hqV3Route(request('purchases'),env,f.ctx,s.nativeFetch));
 const operations=await readJSON(await s.callHq('/partner-desk/operations'));
 const snapshot=await readJSON(await member.fetch(new Request('https://my-timber.app/v1/member/my-shift',{headers:{Origin:'https://my-timber.app',Cookie:s.memberSession}}),env,f.ctx));
 const orders=s.sql.prepare('SELECT order_number FROM medicine_orders WHERE user_id=? ORDER BY id').all(s.member.id);
 assert.equal(orders.length,3);
 report.joinedOrders=[];
 for(const {order_number}of orders){
  const line=commercial.orders.find(o=>o.order_ref===order_number),ops=operations.records.find(o=>o.order_ref===order_number),own=snapshot.orders.find(o=>o.reference===order_number);
  assert.ok(line&&ops&&own,'Missing joined order '+order_number);assert.equal(line.rx_case_ref,ops.case_ref);assert.equal(own.recordId,ops.case_ref);
  const milestones=[];for(const key of ['accepted','dispensed','dispatched','delivered']){const hq=ops.milestones.find(m=>m.key===key),mine=own.timeline.find(m=>m.key===key);assert.ok(hq.confirmed&&mine.complete,key+' not confirmed');assert.equal(hq.at,mine.at,key+' receipt mismatch');milestones.push({key,at:hq.at,evidenceRef:hq.evidence_ref});}
  const detail=await readJSON(await hqV3Route(request('purchases/'+order_number),env,f.ctx,s.nativeFetch));assert.equal(detail.purchase.refs.case_ref,ops.case_ref);
  report.joinedOrders.push({orderReference:order_number,caseReference:ops.case_ref,sharedStatus:ops.last_confirmed_shared_stage,milestones});
 }
 for(const secret of [f.clinicalAnswers.deliveryAddress,f.clinicalAnswers.deliveryPostcode,'FICTIONAL clarification of submitted information','FICTIONAL — no patient or clinical prescription']){if(secret)assert.ok(!JSON.stringify(commercial).includes(secret)&&!JSON.stringify(operations).includes(secret),'Clinical/private field in HQ projection');}
 await readJSON(await hqV3Route(request('purchases',s.actors.dispenser.session),env,f.ctx,s.nativeFetch),403);
 const {ensureRefundSchema}=await import('../platform/refunds.mjs'),{ensureLifecycleSchema}=await import('../platform/prescription-lifecycle.mjs'),{ensureAuditSchema}=await import('../platform/audit-export.mjs');
 await ensureRefundSchema(env.DB);await ensureLifecycleSchema(env.DB);await ensureAuditSchema(env.DB);
 report.exports=[];
 for(const role of ['owner','operations','clinician','otherDispenser']){
  const response=['owner','operations'].includes(role)?await s.callHq('/platform/exports/'+f.report.recordId,{purpose:'FICTIONAL native role acceptance'},role):await f.partner('/platform/exports/'+f.report.recordId,await f.login(role),{purpose:'FICTIONAL native role acceptance'});
  const d=await readJSON(response);assert.equal(createHash('sha256').update(JSON.stringify(d.content)).digest('hex'),d.contentDigest);
  if(['owner','operations'].includes(role)){assert.equal(d.content.assessments,undefined);assert.ok(d.content.documents.every(x=>x.document===undefined));}
  if(role==='operations')assert.equal(d.content.finance,undefined);
  report.exports.push({role,scope:d.content.scope,receiptId:d.receiptId,contentDigest:d.contentDigest,documentBindingsVerified:d.content.documents.every(x=>x.cryptographicDocumentBindingVerified),assessmentBodiesIncluded:!!d.content.assessments});
 }
 const memberExport=await readJSON(await member.fetch(new Request('https://my-timber.app/v1/member/clinical-records/'+f.report.recordId+'/verified-export',{method:'POST',headers:{Origin:'https://my-timber.app',Cookie:s.memberSession,'Content-Type':'application/json'},body:JSON.stringify({purpose:'FICTIONAL member clinical copy'})}),env,f.ctx));
 assert.equal(createHash('sha256').update(JSON.stringify(memberExport.content)).digest('hex'),memberExport.contentDigest);assert.equal(memberExport.content.scope,'member');assert.equal(memberExport.content.finance,undefined);
 report.exports.push({role:'member',scope:'member',receiptId:memberExport.receiptId,contentDigest:memberExport.contentDigest,evidenceObjectsVerified:memberExport.content.evidenceObjectsVerified});
 const privateDir=new URL('private/',out);await fs.mkdir(privateDir,{recursive:true,mode:0o700});
 const dbFile=new URL('native-test.sqlite',privateDir);await fs.rm(dbFile,{force:true});s.sql.prepare('VACUUM INTO ?').run(dbFile.pathname);await fs.chmod(dbFile,0o600);
 const privateAccounts=Object.fromEntries([...s.secrets].map(([role,value])=>[role,{...value,role:role==='member'?'member':s.actors[role].user.role,username:{clinician:'CLNTEST',dispenser:'DSPTEST',otherDispenser:'DSPSWITCH'}[role]||value.email}]));
 await fs.writeFile(new URL('test-access.json',privateDir),JSON.stringify({fictional:true,hosted:false,createdAt:new Date().toISOString(),accounts:privateAccounts,environmentSecrets:{mfaEncryptionKey:env.HQ_MFA_ENCRYPTION_KEY,portalSessionKey:f.portalEnv.PORTAL_SESSION_KEY}},null,2),{mode:0o600});
 const objects=new URL('objects/',privateDir);await fs.mkdir(objects,{recursive:true,mode:0o700});const objectIndex=[];
 for(const [key,value]of f.files){const file=createHash('sha256').update(key).digest('hex')+'.bin';await fs.writeFile(new URL(file,objects),value.body,{mode:0o600});objectIndex.push({key,file,httpMetadata:value.httpMetadata});}
 await fs.writeFile(new URL('objects.json',privateDir),JSON.stringify(objectIndex),{mode:0o600});
 report.accounts={member:{id:s.member.id,email:s.summary.memberEmail,emailVerified:true},owner:{id:s.owner.id,role:s.owner.role,mfaEnabled:s.owner.mfaEnabled},roles:s.summary.actors,credentialsPublished:false,persistentIsolatedSnapshot:true};
 report.workflow=f.report;report.coreSource=s.summary.coreSource;report.transport=f.transport;report.blockedNetworkCalls=blockedNetworkCalls;assert.equal(blockedNetworkCalls,0);report.result='PASS — SYNTHETIC LOCAL API WORKFLOW';
 report.notProven=['Hosted login URLs and isolated deployed persistence','Automated browser/phone-size/physical-device evidence','Real provider/payment/courier transports','External email/push provider and device receipts','Complete 132-scenario v3.1 release acceptance'];
}catch(e){report.result='FAIL';report.error=e.stack;process.exitCode=1;}
finally{globalThis.fetch=originalFetch;f?.s.close();report.completedAt=new Date().toISOString();await fs.writeFile(new URL('report.json',out),JSON.stringify(report,null,2)+'\n');console.log(JSON.stringify({result:report.result,error:report.error||null,joinedOrders:report.joinedOrders?.length||0,exports:report.exports?.length||0,hostedLoginsAvailable:false,report:new URL('report.json',out).pathname}));}
