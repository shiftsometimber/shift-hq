// Isolated acceptance run. No production bindings, payment or outbound delivery.
import fs from 'node:fs/promises';
import {createHmac,randomBytes} from 'node:crypto';
import {nativeAccounts,totp} from './native-accounts.mjs';
import {medicineCommerceRoutes} from './native-core/medicine-commerce-v1.js';
import {ensureSharedSchema} from '../service/schema.mjs';
import clinical from '../service/clinical-service.mjs';
import memberService from '../service/member-service.mjs';
import portal from '../worker.mjs';
import sstrxPortal from '../sstrx-worker.mjs';
import {authenticator} from '../test/authenticator.mjs';
import {selectFutureSupplier,captureOrderRoute} from '../platform/integrations.mjs';
import {careFields,careChecks,CARE_HANDOVER_VERSION} from '../service/clinical-kernel.mjs';

export async function fullLoop({continueAfterPaymentBlock=false,sstrxCandidate=false}={}){
 const s=await nativeAccounts(),{sql,DB}=s;
 const checks=[],timings=[],transport=[],pending=[];
 const report={startedAt:new Date().toISOString(),scope:'Fresh isolated native-API run plus separate live public UI observation; not live clinical acceptance',timingLimit:'Local response wait only, excludes network and may exclude initial handler work; NOT live user-facing speed measurements.',accounts:s.summary,checks,timings,workarounds:[],outboundMessages:0,realPayments:0,realPrescriptions:0};
 const ctx={waitUntil(p){pending.push(p)}};
 const record=(stage,status,detail)=>{checks.push({stage,status,detail});console.log(JSON.stringify({stage,status,detail}));};
 async function result(stage,response,expected=200){const start=performance.now(),r=await response,body=await r.json();timings.push({stage,ms:Math.round(performance.now()-start),http:r.status});if(r.status!==expected)throw Object.assign(Error(stage+' HTTP '+r.status+' '+JSON.stringify(body)),{stage,body});return body;}
 const files=new Map(),bucket={async put(k,b,o){files.set(k,{body:new Uint8Array(b),httpMetadata:o?.httpMetadata});},async get(k){return files.get(k)||null},async delete(k){files.delete(k)}};
 const env={...s.env,HQ_AUTH:{fetch:s.nativeFetch},CLINICAL_PRIVATE_FILES:bucket,PARTNER_PRIVATE_FILES:bucket,PARTNER_OPERATIONS_ENABLED:'true',PARTNER_INTERNAL_SETUP_ONLY:'false',PARTNER_LOGIN_ENABLED:'true',PARTNER_FULFILMENT_ENABLED:'true',CLINICAL_CASEWORK_ENABLED:'true',CLINICAL_REVIEW_READY:'true',CLINICAL_CONTEXT_ENABLED:'false',PRESCRIPTION_WORKFLOW_ENABLED:'true',PRESCRIPTION_SIGNING_ENABLED:'true',PRESCRIPTION_SIGNATURE_POLICY_REFERENCE:'FICTIONAL-ACCEPTANCE-ONLY',PARTNER_CLINICAL_APPROVER_IDS:String(s.actors.governor.user.id),SHARED_ORDER_WORKFLOW_ENABLED:'true',CLINICAL_MEMBER_RECORDS_ENABLED:'true',NOTIFICATION_EVENTS_ENABLED:'true',PARTNER_NOTIFICATION_REVIEW_ENABLED:'true',PARTNER_TRACKING_READ_ENABLED:'true',PARTNER_MEMBER_REPLIES_ENABLED:'true',STRIPE_MODE:'test',STRIPE_SECRET_KEY:'sk_test_ISOLATED_NO_PROVIDER_ACCOUNT',STRIPE_WEBHOOK_SECRET:randomBytes(32).toString('hex'),PHARMACY_CLINICAL_INTAKE_URL:'https://pharmacy.example.test/intake',PHARMACY_INTEGRATION_SECRET:randomBytes(32).toString('hex')};
 if(sstrxCandidate)Object.assign(env,{SSTRX_PLATFORM_ENABLED:'true',SSTRX_PAID_RECORD_LINK_ENABLED:'true',SSTRX_ENVIRONMENT:'synthetic',SSTRX_TEST_SIGNING:'true'});
 const portalEnv={PARTNER_ACCESS_ENABLED:'true',PORTAL_SESSION_KEY:randomBytes(32).toString('hex'),HQ_AUTH:env.HQ_AUTH,CLINICAL:{fetch:r=>clinical.fetch(r,env,ctx)}};
 const req=(origin,path,body,cookie='',extra={})=>new Request(origin+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookie,...(!(body instanceof FormData)?{'Content-Type':'application/json'}:{}),...extra},body:body===undefined?undefined:body instanceof FormData||body instanceof Uint8Array?body:JSON.stringify(body)});
 const commerce=(path,body)=>medicineCommerceRoutes(req('https://shiftsometimber.co.uk','/v1/'+path,body,s.memberSession),env,ctx);
 const member=(path='',body,extra={})=>memberService.fetch(req('https://shiftsometimber.co.uk','/v1/member/clinical-records'+path,body,s.memberSession,extra),env,ctx);
 const hq=(path,body,actor='owner')=>clinical.fetch(req('https://hq.shiftsometimber.co.uk','/v1/hq/clinical'+path,body,s.actors[actor].session),env,ctx);
 // Logical API host is retained by the deployed native services.
 const logical=fn=>(path,body,...rest)=>fn(path,body,...rest);
 const originalFetch=globalThis.fetch;
 globalThis.fetch=async(url,options={})=>{
  const u=String(url);
  if(u==='https://pharmacy.example.test/intake'){transport.push({provider:'test pharmacy sink',action:'intake',reference:options.headers['Idempotency-Key']});return Response.json({reference:'TEST-PHARMACY-'+options.headers['Idempotency-Key'],patientReference:'TEST-PATIENT-1',status:'verified',verified:true});}
  if(u==='https://api.stripe.com/v1/checkout/sessions'){const form=new URLSearchParams(options.body);transport.push({provider:'test Stripe sink',action:'create_session',orderNumber:form.get('metadata[order_number]')});return Response.json({id:'cs_test_ISOLATED_'+crypto.randomUUID(),url:'https://checkout.example.test/NO-PAYMENT'});}
  throw Error('Outbound network denied in isolated acceptance: '+new URL(u).hostname);
 };
 try{
  await ensureSharedSchema(DB);
  // Catalogue and governance prerequisites are explicitly synthetic fixtures.
  await commerce('catalogue/medicines');
  const stamp=new Date().toISOString(),future=new Date(Date.now()+86400000).toISOString(),past=new Date(Date.now()-86400000).toISOString();
  sql.prepare("INSERT OR REPLACE INTO medicine_products(id,name,active_ingredient,form,status,description,sellable,availability_state,partner) VALUES(991,'TEST Mounjaro — NOT FOR SUPPLY','TEST ONLY','injection','available','ISOLATED TEST ONLY',1,'available','test-pharmacy')").run();
  sql.prepare("INSERT OR REPLACE INTO medicine_variants(id,medicine_id,strength_label,selling_price_pence,status,updated_at,sellable,availability_state,partner) VALUES(9911,991,'TEST 2.5 mg',16900,'available',?,1,'available','test-pharmacy')").run(stamp);
  sql.prepare('INSERT OR REPLACE INTO medicine_inventory VALUES(9911,20,0,?)').run(stamp);
  record('Fresh accounts','PASS','Native member registration, captured email verification, password login; native staff password login and real TOTP MFA for synthetic HQ/partner identities.');
  const form=new FormData();
  const answers={variantId:'9911',insulinUse:'no',dateOfBirth:'1980-01-01',heightCm:'175',weightKg:'110',weightRelatedCondition:'no',conditions:'None — fictional test declaration',medicines:'None — fictional test declaration',previousTreatment:'no',gpName:'TEST GP — NOT A REAL PRACTICE',gpPractice:'TEST ONLY',gpAddress:'TEST ONLY',gpPostcode:'AA1 1AA',gpContactConsent:'on',answersConfirmed:'on',imageConsent:'on',submissionId:crypto.randomUUID(),patientFirstName:'TEST Full Loop',patientLastName:'Member',patientPhone:'07700900000',patientAddress1:'TEST ADDRESS — NOT FOR DELIVERY',patientTown:'TEST TOWN',patientPostcode:'AA1 1AA'};
  for(const [k,v]of Object.entries(answers))form.set(k,v);
  const png=new Uint8Array(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jrZkAAAAASUVORK5CYII=','base64'));
  for(const k of ['photoId','bodyFront','bodySide'])form.set(k,new Blob([png],{type:'image/png'}),'TEST-PLACEHOLDER.png');
  const intake=await result('Clinical intake submission',commerce('commerce/medicine-clinical-intake',form));report.intakeReference=intake.intakeReference;
  record('Questionnaire and evidence intake','PASS','Fresh multipart assessment, three placeholder images and explicit consent accepted by native Core; provider verification is a local simulated pharmacy receipt.');
  const checkout=await result('Create checkout',commerce('commerce/medicine-checkout',{variantId:9911,insulinUse:'no',eligibility:{heightCm:175,weightKg:110,weightRelatedCondition:'no'},verificationToken:intake.verificationToken}),201);report.orderNumber=checkout.orderNumber;
  const before=sql.prepare('SELECT * FROM medicine_orders WHERE order_number=?').get(checkout.orderNumber),event={id:'evt_test_'+crypto.randomUUID(),type:'checkout.session.completed',data:{object:{id:before.stripe_checkout_session_id,metadata:{order_type:'medicine',order_number:checkout.orderNumber},payment_status:'paid',payment_intent:'pi_test_ISOLATED'}}},payload=JSON.stringify(event),time=Math.floor(Date.now()/1000),sig=createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(time+'.'+payload).digest('hex');
  await result('Payment callback',medicineCommerceRoutes(new Request('https://api.shiftsometimber.co.uk/v1/commerce/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':`t=${time},v1=${sig}`},body:payload}),env,ctx));
  await Promise.allSettled(pending.splice(0));
  record('Purchase processing','PASS','Native checkout generated '+checkout.orderNumber+'; signature-verified simulated test payment callback marked it paid. No card or Stripe account contacted.');
  report.paymentProvider='simulated local Stripe transport, cs_test session, no transaction';
  if(sstrxCandidate)await result('Paid-order native record reconciliation',memberService.fetch(req('https://shiftsometimber.co.uk','/v1/member/clinical-records',undefined,s.memberSession),env,ctx));
  const prior=sql.prepare('SELECT id FROM clinical_member_records WHERE order_number=?').get(checkout.orderNumber);
  record('Purchase → clinician assessment handover',prior?'PASS':'FAIL',prior?'Linked clinical record exists.':'Paid public intake created no clinician-facing clinical_member_records entry. Public intake and partner clinical record are separate stores; no automatic handover in this run.');
  if(!prior)report.workarounds.push('Created a second native clinical record via the member API to continue; public-intake answers/evidence were not automatically bridged.');
  // Call API-host routing while retaining the proper browser origin.
  const toApi=async(request,worker)=>{const u=new URL(request.url);u.hostname='api.shiftsometimber.co.uk';return worker.fetch(new Request(u,request),env,ctx)};
  s.callMember=(path='',body,extra={})=>toApi(req('https://shiftsometimber.co.uk','/v1/member/clinical-records'+path,body,s.memberSession,extra),memberService);
  s.callHq=(path,body,actor='owner')=>toApi(req('https://hq.shiftsometimber.co.uk','/v1/hq/clinical'+path,body,s.actors[actor].session),clinical);
  const created=await result('Create clinical record',s.callMember('',{orderNumber:checkout.orderNumber}),prior?200:201);report.recordId=created.id;
  let revision=created.revision;const evidence=[];
  for(const kind of ['photo_id','front_photo','scale_photo']){const upload=await result('Upload '+kind,s.callMember('/'+created.id+'/evidence',png,{'Content-Type':'image/png','X-Record-Revision':String(revision),'X-Evidence-Kind':kind}),201);revision=upload.revision;evidence.push({id:upload.id,kind});}
  const schemaResponse=await memberService.fetch(new Request('https://shiftsometimber.co.uk/assets/clinical-records/schema.mjs'),env,ctx),schemaSource=await schemaResponse.text();
  await fs.mkdir(new URL('../../.partner-qa/full-loop/',import.meta.url),{recursive:true});await fs.writeFile(new URL('../../.partner-qa/full-loop/schema.mjs',import.meta.url),schemaSource);
  const {schema,fields,active}=await import('../../.partner-qa/full-loop/schema.mjs?'+Date.now());
  const clinicalAnswers={requestPath:'Starting treatment',fullName:'TEST Full Loop Member',dateOfBirth:'1980-01-01',address:answers.patientAddress1,postcode:'AA1 1AA',deliveryAddress:'TEST ALTERNATIVE DELIVERY — DO NOT SHIP',deliveryPostcode:'BB1 1BB',email:s.summary.memberEmail,phone:'07700900000',heightCm:'175',weightKg:'110',gpName:answers.gpName,gpPractice:'TEST ONLY',gpAddress:'TEST ONLY',gpPostcode:'AA1 1AA',forMyself:'Yes',inUK:'Yes',insulinUse:'No',urgentSymptoms:'No',gpSharingChoice:'Yes',treatmentConfirmation:'I confirm'};
  for(let n=0;n<3;n++)for(const q of fields){if(!active(q,clinicalAnswers)||q.optional||clinicalAnswers[q.id]!==undefined)continue;clinicalAnswers[q.id]=q.type==='multi'?JSON.stringify([q.options.includes('None of the above')?'None of the above':q.options[0]]):q.options?(q.options.includes('No')?'No':q.options[0]):q.type==='number'?'1':q.type==='date'?'1980-01-01':'Fictional acceptance test only';}
  const submission=await s.callMember('/'+created.id+'/assessment',{schemaVersion:schema.version,revision,answers:clinicalAnswers,submit:true,accuracy:true,reviewSharing:true});
  const submittedBody=await submission.clone().json();
  if(!submission.ok){record('Submit partner clinical questionnaire','FAIL','Native member API returned '+submission.status+' '+submittedBody.error+' for a fresh completed assessment.');report.submissionError=submittedBody.error;return {s,env,portalEnv,report,files,transport,clinicalAnswers,created,evidence};}
  const submitted=await result('Submit partner clinical questionnaire',Promise.resolve(submission));report.assessmentVersion=submitted.revision;
  record('Submit partner clinical questionnaire','PASS','Fresh record and all required evidence submitted via native member API. Assessment version '+submitted.revision+'.');
  const f={s,env,portalEnv,report,files,transport,intakeAnswers:answers,png,commerce,clinicalAnswers,created,evidence,submitted,record,result,ctx,sstrxCandidate,portal:sstrxCandidate?sstrxPortal:portal};
  await downstream(f,{continueAfterPaymentBlock});if(sstrxCandidate&&!report.executionError){await organisationAcceptance(f);await repeatJourney(f);await supplierSwitchJourney(f)};return f;
 }catch(e){record(e.stage||'Execution','FAIL',e.message);report.executionError=e.message;return {s,env,portalEnv,report,files,transport};}
 finally{globalThis.fetch=originalFetch;report.completedAt=new Date().toISOString();await fs.mkdir(new URL('../../.partner-qa/full-loop/',import.meta.url),{recursive:true});await fs.writeFile(new URL('../../.partner-qa/full-loop/report.json',import.meta.url),JSON.stringify(report,null,2)+'\n');}
}
async function downstream(f,{continueAfterPaymentBlock}){
 const {s,env,portalEnv,report,created,evidence,submitted,record,result,ctx,portal}=f,{sql}=s;const PORTAL_ORIGIN=f.sstrxCandidate?'https://sstrx.shiftsometimber.co.uk':'https://partner.shiftsometimber.co.uk';if(f.sstrxCandidate)portalEnv.SSTRX_PORTAL_ENABLED='true';
 const stamp=new Date().toISOString(),future=new Date(Date.now()+86400000).toISOString(),past=new Date(Date.now()-86400000).toISOString();
 for(const [id,kind]of [['test-clinical-org','clinical'],['test-pharmacy','pharmacy']]){const org={id,kind,name:'TEST '+id,status:'approved',version:1,expiresAt:future,premises:'FICTIONAL ADDRESS — NO REAL PRACTICE',registration:'SYNTHETIC-NOT-A-REAL-REGISTRATION'};sql.prepare('INSERT OR IGNORE INTO partner_organisations VALUES(?,1,?,?)').run(id,JSON.stringify(org),stamp);}
 for(const [actor,kind,org]of [['clinician','clinician','test-clinical-org'],[f.dispenserActor||'dispenser','dispensing',f.pharmacyOrgId||'test-pharmacy']]){
  const id=s.actors[actor].user.id,profile={id:'test-professional-'+id,hqUserId:id,username:actor==='clinician'?'CLNTEST':actor==='dispenser'?'DSPTEST':'DSPSWITCH',kind,orgId:org,status:'active',version:1,credentialVersion:1,details:{name:'TEST '+actor,email:s.secrets.get(actor).email,profession:kind==='clinician'?'GP':'Pharmacist',regulator:kind==='clinician'?'GMC':'GPhC',registrationNumber:'SYNTHETIC-'+id,prescribingEntitlement:'Fictional acceptance only'},evidence:[],checks:['identity','registration','indemnity','agreements','competence'].map(kind=>({kind,credentialVersion:1,outcome:'verified',expiresAt:future})),grants:[{credentialVersion:1,area:'weight_management',startsAt:past,expiresAt:future,medicines:[],actions:kind==='clinician'?['review','query','clinical_decision','issue_prescription']:['view_fulfilment','query','supply_decision','prepare','dispatch','record_delivery','record_exception','cancel_supply']}],passwordSetAt:stamp};
  sql.prepare('INSERT OR IGNORE INTO partner_staff VALUES(?,?,?,?,?,1,?,?)').run(profile.id,id,profile.username,kind,org,JSON.stringify(profile),stamp);
 }
 for(const actor of ['governor','clinician'])sql.prepare("INSERT OR IGNORE INTO clinical_hq_staff VALUES(?,'clinician',1,'TEST-ONLY','GMC',?,?)").run(s.actors[actor].user.id,'SYNTHETIC-'+s.actors[actor].user.id,future);
 report.workarounds.push('Professional organisation approvals, credentials and scope grants are synthetic test fixtures, not regulator checks or approved real partner access.');
 async function login(actor){const data=s.secrets.get(actor),username=actor==='clinician'?'CLNTEST':actor==='dispenser'?'DSPTEST':actor==='otherDispenser'?'DSPSWITCH':data.email;
  const start=await portal.fetch(new Request(PORTAL_ORIGIN+'/api/login',{method:'POST',headers:{Origin:PORTAL_ORIGIN,'CF-Connecting-IP':'203.0.113.42','Content-Type':'application/json'},body:JSON.stringify({username,password:data.password})}),portalEnv);
  await result(actor+' partner password login',Promise.resolve(start));const cookie=start.headers.getSetCookie().find(x=>x.startsWith('__Host-shift_partner_mfa=')).split(';')[0];
  const end=await portal.fetch(new Request(PORTAL_ORIGIN+'/api/mfa',{method:'POST',headers:{Origin:PORTAL_ORIGIN,'CF-Connecting-IP':'203.0.113.42','Content-Type':'application/json',Cookie:cookie},body:JSON.stringify({code:totp(data.totpSecret)})}),portalEnv);await result(actor+' partner TOTP',Promise.resolve(end));return end.headers.getSetCookie().find(x=>/^__Host-shift_partner=[^;]/.test(x)).split(';')[0];}
 const partner=(path,cookie,body)=>portal.fetch(new Request(PORTAL_ORIGIN+'/api/clinical'+path,{method:body===undefined?'GET':'POST',headers:{Origin:PORTAL_ORIGIN,'CF-Connecting-IP':'203.0.113.42','Content-Type':'application/json',Cookie:cookie},body:body===undefined?undefined:JSON.stringify(body)}),portalEnv);
 f.partner=partner;f.login=login;
 await result('HQ assign fresh case',s.callHq('/partner-desk/assign',{recordId:created.id,staffUserId:s.actors.clinician.user.id,active:true}));
 const clinicianCookie=await login('clinician'),dispenserCookie=await login(f.dispenserActor||'dispenser');f.clinicianCookie=clinicianCookie;f.dispenserCookie=dispenserCookie;
 record('Partner login and permissions','PASS','Clinician and dispenser signed into the actual portal gateway with native passwords and MFA; approved scopes are fictional fixtures.');
 await result('Partner blocked from HQ-only counts',partner('/partner-desk/questions',dispenserCookie),403);
 record('Partner isolation','PASS','Dispenser receives HTTP 403 for HQ-only questions/counts endpoint.');
 const recordPath='/'+created.id;let caseVersion=0;
 const action=async(body)=>{const response=await result('Clinical '+body.action,partner(recordPath+'/action',clinicianCookie,{version:caseVersion,assessmentVersion:submitted.revision,...body}));caseVersion++;return response;};
 await action({action:'start_review'});
 if(f.sstrxCandidate){
  await action({action:'request_information',message:'FICTIONAL clarification of submitted information',evidenceKinds:[]});
  const requested=sql.prepare("SELECT id FROM clinical_case_events WHERE record_id=? AND kind='information_requested' ORDER BY version DESC LIMIT 1").get(created.id);
  const revised=await result('Member resubmits clarification',s.callMember(recordPath+'/assessment',{schemaVersion:created.schemaVersion,revision:submitted.revision,answers:f.clinicalAnswers,submit:true,accuracy:true,reviewSharing:true}));
  await result('Member replies to clinician',s.callMember(recordPath+'/workflow/action',{version:caseVersion,assessmentVersion:revised.revision,action:'reply',requestId:requested.id,message:'FICTIONAL member clarification'}));caseVersion++;submitted.revision=revised.revision;
  await action({action:'start_review'});record('C: Additional information','PASS (SYNTHETIC)','Clinician request → explicit member resubmission/reply → return to assigned review; no clinical answer inferred.');
 }
 for(const item of evidence.filter(e=>e.kind!=='photo_id'))await action({action:'review_evidence',evidenceId:item.id,outcome:'approve'});
 const handover={version:CARE_HANDOVER_VERSION};for(const [id,,type]of careFields)handover[id]=Array.isArray(type)?type[0]:type==='date'?new Date(Date.now()+(id==='followUpDate'?7:0)*86400000).toISOString().slice(0,10):'Fictional acceptance handover only';for(const [id]of careChecks)handover[id]=true;handover.medicine='TEST Mounjaro — NOT FOR SUPPLY';
 await action({action:'decision',outcome:'proceed',identityVerified:true,independentMeasurementsVerified:true,verification:'Fictional checks only — not a clinical decision',handover,rationale:'Fictional acceptance only',message:'TEST review complete'});
 record('Clinician review','PASS','Fresh assessment version '+submitted.revision+', medical evidence decisions and explicit identity verification recorded on the same generated order.');
 const proposalInput=version=>({version,partnerId:f.pharmacyOrgId||'test-pharmacy',expiresAt:future,reason:'TEST treatment proposal only',clinicalRationale:'FICTIONAL — no patient or clinical prescription',treatment:{variantId:9911,packs:1,quantity:'TEST one pack',dose:'TEST dose only',route:'TEST injection route',directions:'TEST ONLY — NOT FOR CLINICAL USE'}});
 let proposal=(await result('Create prescription proposal',partner('/prescriptions/'+created.id+'/proposal',clinicianCookie,proposalInput(0)))).prescription;
 await result('Member treatment agreement',s.callMember(recordPath+'/prescription/decision',{version:proposal.version,action:'accept',agreed:true}));
 const key=await authenticator({rpId:new URL(PORTAL_ORIGIN).hostname}),registration=await result('Register signing challenge',partner('/prescriptions/'+created.id+'/keys/challenge',clinicianCookie,{}));
 const createdKey=await result('Register signing key',partner('/prescriptions/'+created.id+'/keys/register',clinicianCookie,{challengeId:registration.id,proof:await key.register(registration.challenge,PORTAL_ORIGIN)}));
 await result('Independent signing key approval',s.callHq('/prescriptions/keys/'+createdKey.keyId+'/approve',{version:0,expiresAt:future,verificationReference:'FICTIONAL independent review only'},'governor'));
 let signing=await partner('/prescriptions/'+created.id+'/signing-challenge',clinicianCookie,{version:proposal.version+1,keyId:createdKey.keyId}),signingBody=await signing.clone().json();
 if(!signing.ok){record('Test payment → prescription signing','FAIL','A native paid cs_test checkout is rejected: HTTP '+signing.status+' '+signingBody.error+'. Signing recognises cs_live prefixes only.');report.paymentSigningError=signingBody.error;
  if(!continueAfterPaymentBlock)return;
  report.workarounds.push('DOWNSTREAM CONTINUATION ONLY: isolated order session ID replaced by cs_live_SYNTHETIC_NOT_A_PAYMENT; treatment re-proposed and member re-agreed. This is not real payment verification or a full-loop pass.');
  sql.prepare('UPDATE medicine_orders SET stripe_checkout_session_id=? WHERE order_number=?').run('cs_live_SYNTHETIC_NOT_A_PAYMENT',report.orderNumber);
  proposal=(await result('Re-propose after isolated payment workaround',partner('/prescriptions/'+created.id+'/proposal',clinicianCookie,proposalInput(proposal.version+1)))).prescription;
  await result('Member re-agreement after workaround',s.callMember(recordPath+'/prescription/decision',{version:proposal.version,action:'accept',agreed:true}));
  signing=await partner('/prescriptions/'+created.id+'/signing-challenge',clinicianCookie,{version:proposal.version+1,keyId:createdKey.keyId});signingBody=await result('Signing challenge after workaround',Promise.resolve(signing));
 }
 const issued=await result('Sign test prescription',partner('/prescriptions/'+created.id+'/sign',clinicianCookie,{version:proposal.version+1,challengeId:signingBody.id,document:signingBody.document,proof:await key.sign(signingBody.challenge,PORTAL_ORIGIN)}));
 report.testPrescriptionId=issued.prescription?.prescriptionId||issued.prescriptionId;record('Prescription → dispenser',f.sstrxCandidate?'PASS (SYNTHETIC)':'PASS WITH WORKAROUNDS',f.sstrxCandidate?'cs_test payment retained; origin-bound software authenticator proof verified; native pharmacy task created.':'Software authenticator proof verified; native service created pharmacy task. Both intake-bridge and payment-format workarounds remain.');
 const supply=JSON.parse(sql.prepare('SELECT state_json FROM partner_fulfilment WHERE order_number=?').get(report.orderNumber).state_json);report.delivery=supply.delivery;
 if(supply.delivery?.address!==f.clinicalAnswers.deliveryAddress||supply.delivery?.postcode!==f.clinicalAnswers.deliveryPostcode)throw Error('Alternative delivery address not transferred to dispensing');
 record('Delivery address handover','FIXED / PASS','Member’s complete alternative delivery address and postcode reach the pharmacy task from the immutable signed assessment. Dispatch now rejects an incomplete address.');
 const ask=await result('Pharmacy question to HQ',partner('/partner-desk/threads',dispenserCookie,{orderNumber:report.orderNumber,subject:'TEST handover question',priority:'normal',message:'FICTIONAL TEST: please confirm this handover.'}),201);
 const desk=await result('HQ receives pharmacy question',s.callHq('/partner-desk'));if(!desk.threads.some(t=>t.id===ask.id))throw Error('Fresh pharmacy thread not visible in HQ');
 await result('HQ reply',s.callHq('/partner-desk/threads/'+ask.id+'/reply',{version:1,message:'FICTIONAL TEST: handover acknowledged.'}));
 const conversation=await result('Partner receives HQ reply',partner('/partner-desk/threads/'+ask.id,dispenserCookie));if(!conversation.messages.some(m=>m.actor_kind==='hq'))throw Error('HQ response missing from partner view');
 record('Partner ↔ HQ communication','PASS','Question and reply persisted and visible on both private workspaces for this order; no email or external message sent.');
 const transitions=[];
 for(const [operation,expected]of [['accept','pharmacy_received'],['prepare','dispensing'],['dispatch','dispatched'],['delivered','fulfilled']]){
  const current=await result('Pharmacy order '+operation,partner('/partners/fulfilment/'+report.orderNumber,dispenserCookie));
  await result('Pharmacy '+operation,partner('/partners/fulfilment/'+report.orderNumber+'/action',dispenserCookie,{version:current.order.version,action:operation,carrier:'dpd',trackingNumber:'12345678901234',message:'FICTIONAL TEST ONLY — NO SHIPMENT'}));
  const memberOrders=await result('Member order after '+operation,medicineCommerceRoutes(new Request('https://api.shiftsometimber.co.uk/v1/treatment/orders',{headers:{Cookie:s.memberSession}}),env,ctx));
  const owner=await result('HQ order after '+operation,s.callHq('/partner-desk'));
  const core=sql.prepare('SELECT clinical_status FROM medicine_orders WHERE order_number=?').get(report.orderNumber),memberOrder=memberOrders.orders.find(o=>o.orderNumber===report.orderNumber),ownerOrder=owner.orders.find(o=>o.orderNumber===report.orderNumber);
  if(core.clinical_status!==expected||memberOrder?.clinicalStatus!==expected||ownerOrder?.sharedStatus!==expected)throw Error('Status divergence after '+operation);
  transitions.push({operation,core:core.clinical_status,member:memberOrder.clinicalStatus,hq:ownerOrder.sharedStatus});
 }
 report.statusTransitions=transitions;
 const tracking=await result('Member fulfilment tracking',s.callMember(recordPath+'/fulfilment'));report.memberTracking=tracking.fulfilment;
 record('Dispensing → delivery → member/HQ',f.sstrxCandidate?'PASS (SYNTHETIC)':'PASS WITH WORKAROUNDS','All four native pharmacy transitions synchronised to Core, member orders and HQ; test tracking visible in member record. No actual shipment.');
 report.pendingSharedSync=sql.prepare("SELECT count(*) n FROM partner_workflow_sync WHERE status='pending'").get().n;
 report.notificationChannels=sql.prepare('SELECT channel,status,count(*) count FROM clinical_notification_channels GROUP BY channel,status').all();
 report.sentNotificationChannels=sql.prepare('SELECT count(*) n FROM clinical_notification_channels WHERE provider_reference IS NOT NULL').get().n;
 record('Member proactive notifications','NOT PROVEN','Events exist, but channels await approval; zero provider-delivered clinical notifications. In-portal status updates work; email/push delivery is not demonstrated.');
 report.overall=f.sstrxCandidate?'PASS — isolated native-auth candidate workflow; provider/payment/courier transport simulated, public short intake not a commissioned clinical protocol. NOT LIVE ACCEPTANCE.':'FAIL — public availability, automatic intake handover, test-payment signing and proactive notification delivery prevent an unassisted complete live loop.';
}
async function organisationAcceptance(f){
 const {s,result,record}=f;
 for(const [actor,orgId,role]of [['clinicalAdmin','test-clinical-org','clinical_admin'],['pharmacyAdmin','test-pharmacy','pharmacy_admin']]){
  await result('Owner approves '+role+' membership',s.callHq('/platform/memberships',{userId:s.actors[actor].user.id,orgId,role,approvalReference:'FICTIONAL ORGANISATION ADMINISTRATION'}),201);
  const cookie=await f.login(actor),view=await result(role+' scoped overview',f.partner('/platform',cookie));if(view.role!==role||view.records.length!==1)throw Error('Organisation admin view failed');
  await result(role+' cannot prescribe',f.partner('/prescriptions/'+f.created.id,cookie),403);await result(role+' cannot read margin',f.partner('/platform/commercial/'+f.report.orderNumber,cookie),403);
  await result('Revoke '+role,s.callHq('/platform/memberships/'+s.actors[actor].user.id+'/revoke',{version:1,orgId}));await result(role+' revoked session',f.partner('/platform',cookie),401);
 }
 for(const actor of ['support','operations']){
  await result(actor+' operational overview',s.callHq('/platform',undefined,actor));await result(actor+' cannot prescribe',s.callHq('/'+f.created.id+'/action',{version:0,assessmentVersion:f.submitted.revision,action:'decision',outcome:'proceed'},actor),403);await result(actor+' cannot read margin',s.callHq('/platform/commercial/'+f.report.orderNumber,undefined,actor),403);
 }
 record('H: Eight requested account roles','PASS (SYNTHETIC)','Native member, prescriber, clinical/pharmacy administrators, pharmacy operator, support, operations and owner accounts exercised; separate governor retained. Admin access is organisation-scoped and cannot prescribe. Revocation rechecked on the next request.');
}
async function repeatJourney(f,{pharmacyOrgId,dispenserActor}={}){
 const {s,env,report,commerce,result,record,ctx}=f,previousOrder=report.orderNumber,previousRecord=f.created.id;
 await result('Qualified repeat review',f.partner('/platform/repeat-clearance',f.clinicianCookie,{recordId:previousRecord,eligibleAt:new Date().toISOString(),reviewReference:'FICTIONAL NEW REVIEW REQUIRED'}));
 const repeatRequest=await result('Member repeat request',s.callMember('/repeats',{previousOrderNumber:previousOrder,clientReference:crypto.randomUUID()}),201);
 const form=new FormData();for(const [k,v]of Object.entries({...f.intakeAnswers,submissionId:crypto.randomUUID()}))form.set(k,v);for(const key of ['photoId','bodyFront','bodySide'])form.set(key,new Blob([f.png],{type:'image/png'}),'FICTIONAL.png');
 const intake=await result('Repeat intake',commerce('commerce/medicine-clinical-intake',form));
 const checkout=await result('Repeat checkout',commerce('commerce/medicine-checkout',{variantId:9911,insulinUse:'no',eligibility:{heightCm:175,weightKg:110,weightRelatedCondition:'no'},reorderOfOrderNumber:previousOrder,verificationToken:intake.verificationToken}),201);
 const order=s.sql.prepare('SELECT * FROM medicine_orders WHERE order_number=?').get(checkout.orderNumber),event={id:'evt_test_'+crypto.randomUUID(),type:'checkout.session.completed',data:{object:{id:order.stripe_checkout_session_id,metadata:{order_type:'medicine',order_number:checkout.orderNumber},payment_status:'paid',payment_intent:'pi_test_REPEAT'}}},payload=JSON.stringify(event),time=Math.floor(Date.now()/1000),signature=createHmac('sha256',env.STRIPE_WEBHOOK_SECRET).update(time+'.'+payload).digest('hex');
 await result('Repeat test payment callback',medicineCommerceRoutes(new Request('https://api.shiftsometimber.co.uk/v1/commerce/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':`t=${time},v1=${signature}`},body:payload}),env,ctx));
 await result('Repeat record reconciliation',s.callMember(''));
 const created=await result('Open repeat native record',s.callMember('',{orderNumber:checkout.orderNumber}));
 let revision=created.revision;const evidence=[];for(const kind of ['photo_id','front_photo','scale_photo','prescription']){const uploaded=await result('Repeat evidence '+kind,s.callMember('/'+created.id+'/evidence',f.png,{'Content-Type':'image/png','X-Record-Revision':String(revision),'X-Evidence-Kind':kind}),201);revision=uploaded.revision;evidence.push({id:uploaded.id,kind});}
 const {fields,active}=await import('../../.partner-qa/full-loop/schema.mjs');const repeatAnswers={...f.clinicalAnswers,requestPath:'Repeat treatment'};
 for(let n=0;n<3;n++)for(const q of fields){if(!active(q,repeatAnswers)||q.optional||repeatAnswers[q.id]!==undefined)continue;repeatAnswers[q.id]=q.type==='multi'?JSON.stringify([q.options.includes('None of the above')?'None of the above':q.options[0]]):q.options?(q.options.includes('No')?'No':q.options[0]):q.type==='number'?'1':q.type==='date'?'2026-11-01':'Fictional repeat acceptance only';}
 const submitted=await result('Submit fresh repeat assessment',s.callMember('/'+created.id+'/assessment',{schemaVersion:created.schemaVersion,revision,answers:repeatAnswers,submit:true,accuracy:true,reviewSharing:true}));
 const original={orderNumber:previousOrder,recordId:previousRecord,prescriptionId:report.testPrescriptionId,transitions:report.statusTransitions};
 report.orderNumber=checkout.orderNumber;const next={...f,created,evidence,submitted,clinicalAnswers:repeatAnswers,pharmacyOrgId,dispenserActor};await downstream(next,{continueAfterPaymentBlock:false});
 const repeat=s.sql.prepare('SELECT * FROM medicine_orders WHERE order_number=?').get(checkout.orderNumber),previous=s.sql.prepare('SELECT * FROM medicine_orders WHERE order_number=?').get(previousOrder);
 if(repeat.reorder_of_order_id!==previous.id||created.id===previousRecord||repeat.clinical_status!=='fulfilled'||repeat.prescription_reference===previous.prescription_reference)throw Error('Repeat continuity failed');
 report.recordId=created.id;report.firstOrder=original;report.repeat={requestId:repeatRequest.id,orderNumber:checkout.orderNumber,recordId:created.id,previousOrderNumber:previousOrder,newPrescriptionId:report.testPrescriptionId,originalPrescriptionId:original.prescriptionId,clinicalStatus:repeat.clinical_status};
 Object.assign(f,{created,evidence,submitted,clinicalAnswers:repeatAnswers,clinicianCookie:next.clinicianCookie,dispenserCookie:next.dispenserCookie});
 record('D: Full repeat prescription','PASS (SYNTHETIC)','Fresh intake, native repeat checkout, cs_test callback, new assessment/review/signature and fulfilment. Original order/prescription retained.');
}
async function supplierSwitchJourney(f){
 const {s,report,record}=f,first=structuredClone(report.firstOrder),repeat=structuredClone(report.repeat),oldOrder=report.orderNumber,oldRecord=f.created.id;
 const at=new Date().toISOString(),future=new Date(Date.now()+86400000).toISOString(),org={id:'test-pharmacy-b',kind:'pharmacy',name:'FICTIONAL SUPPLIER B',status:'approved',version:1,expiresAt:future,premises:'FICTIONAL B ADDRESS',registration:'SYNTHETIC-NOT-A-REAL-REGISTRATION'};
 s.sql.prepare('INSERT INTO partner_organisations VALUES(?,1,?,?)').run(org.id,JSON.stringify(org),at);
 for(const [id,pharmacy]of [['fixture-a','test-pharmacy'],['fixture-b',org.id]]){s.sql.prepare("INSERT INTO rx_supplier_contracts VALUES(?,'test-clinical-org','synthetic',1,'approved',?,?)").run(id,JSON.stringify({pharmacyOrgId:pharmacy,services:['weight_management']}),at);s.sql.prepare('INSERT INTO rx_product_mappings VALUES(?,9911,?,?,?,?,1)').run(id,id+'-product','injection','FICTIONAL strength','one fictional pack');}
 const before=JSON.parse(s.sql.prepare('SELECT state_json FROM partner_fulfilment WHERE order_number=?').get(oldOrder).state_json);
 const original=await captureOrderRoute(s.DB,{orderNumber:oldOrder,memberId:s.member.id,clinicalOrgId:'test-clinical-org',pharmacyOrgId:'test-pharmacy',contractId:'fixture-a',prescriptionId:before.prescriptionId,variantId:9911,service:'weight_management',authorisationReference:'FICTIONAL INITIAL ROUTE'});
 await selectFutureSupplier(s.DB,{orgId:'test-clinical-org',service:'weight_management',contractId:'fixture-a',version:0,authorisationReference:'FICTIONAL A'});await selectFutureSupplier(s.DB,{orgId:'test-clinical-org',service:'weight_management',contractId:'fixture-b',version:1,authorisationReference:'FICTIONAL B'});
 await repeatJourney(f,{pharmacyOrgId:'test-pharmacy-b',dispenserActor:'otherDispenser'});
 const after=JSON.parse(s.sql.prepare('SELECT state_json FROM partner_fulfilment WHERE order_number=?').get(report.orderNumber).state_json);
 const current=await captureOrderRoute(s.DB,{orderNumber:report.orderNumber,memberId:s.member.id,clinicalOrgId:'test-clinical-org',pharmacyOrgId:'test-pharmacy-b',contractId:'fixture-b',prescriptionId:after.prescriptionId,variantId:9911,service:'weight_management',authorisationReference:'FICTIONAL NEW PRESCRIBER DESTINATION'});
 if(after.partnerId!=='test-pharmacy-b'||s.sql.prepare('SELECT pharmacy_org_id FROM rx_order_routes WHERE order_number=?').get(oldOrder).pharmacy_org_id!=='test-pharmacy')throw Error('Supplier switch changed historical route');
 const hidden=await f.partner('/partners/fulfilment/'+oldOrder,f.dispenserCookie);if(hidden.status!==404)throw Error('Supplier B can access Supplier A order');
 report.supplierSwitch={previousOrder:oldOrder,previousRecord:oldRecord,oldContract:original.contract_id,newOrder:report.orderNumber,newContract:current.contract_id,newPharmacy:after.partnerId,oldPharmacyUnchanged:true,oldOrderDeniedToNewPharmacy:true};report.firstOrder=first;report.repeat=repeat;
 record('G: New order to a different pharmacy','PASS (SYNTHETIC)','Future policy moved to B; new native checkout, clinician signature and fulfilment use Pharmacy B. Historical Pharmacy A route remains unchanged; B cannot read it. Member/account/checkout code unchanged.');
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1]){const f=await fullLoop({continueAfterPaymentBlock:process.argv.includes('--continue'),sstrxCandidate:process.argv.includes('--sstrx')});console.log(JSON.stringify({report:'.partner-qa/full-loop/report.json',orderNumber:f.report.orderNumber,recordId:f.report.recordId}));if(f.report.executionError||f.report.checks.some(c=>c.status==='FAIL'))process.exitCode=1;f.s.close();}
