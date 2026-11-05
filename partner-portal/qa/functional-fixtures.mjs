// Fictional initial data; milestone states are reached through the retained handlers.
import {myShiftFixture,signedRxFixture,RECORD} from './my-shift-fixture.mjs';
import {functionalFixture} from '../test/helpers/functional-fixture.mjs';
import {completeAssessment} from '../test/helpers/complete-assessment.mjs';
import {ensureRefundSchema} from '../platform/refunds.mjs';
import {economicsTerms} from '../platform/domain.mjs';
export const CASES=[['A','Verification required','new'],['B','Measurement pending','identity'],['C','Information requested','information'],['D','Clinical decline','declined'],['E','Signed prescription','signed'],['F','Pharmacy clarification','query'],['G','Pharmacy rejection','rejected'],['H','Dispatched with tracking','dispatched'],['I','Delivery exception','delivery_exception'],['J','Delivered order and repeat history','delivered'],['K','Refund submitted','refund'],['L','Cancellation supply hold','hold']];
const j=async(r)=>{const b=await r.json();if(!r.ok)throw Error('Fictional seed action '+r.status+' '+JSON.stringify(b));return b;};
export async function functionalDataset(code){
 const definition=CASES.find(c=>c[0]===code);if(!definition)throw Error('Unknown fictional case');
 const f=await functionalFixture(await myShiftFixture());await completeAssessment(f);await ensureRefundSchema(f.DB);
 Object.assign(f.env,{SSTRX_ENVIRONMENT:'synthetic',SSTRX_REFUND_TEST_EXECUTION_ENABLED:'true',STRIPE_MODE:'test',SSTRX_TEST_SIGNING:'true'});Object.assign(f.portalEnv,{SSTRX_PORTAL_ENABLED:'true',MY_SHIFT_REDESIGN_ENABLED:'true',SSTRX_FUNCTIONAL_V3_ENABLED:'true'});
 const order='SST-FICTIONAL-'+code+'-1042';f.sql.prepare('UPDATE medicine_orders SET order_number=?,stripe_checkout_session_id=?,stripe_payment_intent_id=? WHERE id=1').run(order,'cs_test_FICTIONAL_'+code,'pi_FICTIONAL_'+code);f.sql.prepare('UPDATE clinical_member_records SET order_number=? WHERE id=?').run(order,RECORD);
 const date=new Date().toISOString(),future=new Date(Date.now()+86400000).toISOString();
 for(const [id,role,label]of [[6,'operations','Operations reviewer'],[7,'support','SHIFT support'],[8,'operations','Delegated finance']]){const token='fictional-role-'+id+'-000000000000000000000000';f.tokens[id]=token;const hash=Buffer.from(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(token))).toString('hex');f.sql.prepare("INSERT INTO hq_users(id,email,name,password_hash,role,status,mfa_enabled) VALUES(?,?,?,?,?,'active',1)").run(id,'role-'+id+'@example.invalid',label,'!FICTIONAL',role);f.sql.prepare('INSERT INTO hq_sessions(hq_user_id,token_hash,expires_at) VALUES(?,?,?)').run(id,hash,future);}
 f.sql.prepare('INSERT INTO rx_finance_authorities VALUES(8,50,?,?,1)').run(future,'FICTIONAL-50-PENCE-LIMIT');
 const mode=definition[2],proof=[];
 if(mode!=='new'){await f.verify('identity');proof.push('native independent identity verification');}
 if(!['new','identity','information','declined'].includes(mode)){await f.verify('measurements');proof.push('native independent measurement verification');}
 if(mode==='information'){await j(await f.call('/information',{version:0,assessmentVersion:1,message:'FICTIONAL request: please update current medicine details.',requestedFields:['medicines1Details'],dueAt:future}));proof.push('native information request, work object and notification outbox');}
 if(mode==='declined'){const cookie=await f.login('CLNTEST');await j(await f.partner('/'+RECORD+'/action',cookie,{version:0,assessmentVersion:1,action:'start_review'}));await j(await f.partner('/'+RECORD+'/action',cookie,{version:1,assessmentVersion:1,action:'decision',outcome:'decline',rationale:'FICTIONAL test decline only',message:'Your clinician has reviewed your assessment. SHIFT will review the payment under the accepted terms.'}));proof.push('native clinical decline');}
 let signed;
 if(!['new','identity','information','declined','refund'].includes(mode)){signed=await signedRxFixture(f);proof.push('native review, member agreement, independent test key approval and verified fictional ES256 signature');}
 if(['query','rejected','dispatched','delivery_exception','delivered'].includes(mode)){
  const actions=mode==='query'?['query']:mode==='rejected'?['reject']:['accept','prepare','dispensed','dispatch',...mode==='delivery_exception'?['delivery_exception']:mode==='delivered'?['delivered']:[]];
  for(const action of actions){const current=JSON.parse(f.sql.prepare('SELECT state_json FROM partner_fulfilment WHERE order_number=?').get(order).state_json);await signed.call('/partners/fulfilment/'+order+'/action',signed.pharmacy,{version:current.version,action,...['query','reject','delivery_exception','delivered'].includes(action)?{message:'FICTIONAL '+action+' receipt',reason:'FICTIONAL acceptance only'}:{},...action==='dispatch'?{carrier:'dpd',trackingNumber:'TEST-'+code+'-NOT-A-SHIPMENT'}:{}});proof.push('native pharmacy '+action);}
 }
 if(mode==='hold'){await signed.call('/platform/supply-holds/'+order,signed.clinician,{action:'open',kind:'cancellation_requested',sourceReference:'FICTIONAL-CANCEL-'+code,clientReference:crypto.randomUUID()});proof.push('native cancellation concern blocking supply; cancellation acknowledgement and reissue still require acceptance');}
 if(mode==='refund'){
  const terms=economicsTerms({model:'shift_collects',supplierId:'FICTIONAL',sellingPence:100,outputTaxPence:0,taxTreatment:'FICTIONAL',approvalReference:'FICTIONAL-ACCEPTED-TERMS',costSourceReference:'FICTIONAL-COSTS'});f.sql.prepare('INSERT INTO rx_economics VALUES(?,1,?,?)').run(order,JSON.stringify(terms),date);f.sql.prepare("INSERT INTO rx_finance_entries VALUES(?,? ,?,'member_payment',100,'GBP','FICTIONAL',?,?)").run(crypto.randomUUID(),order,'payment-'+code,date,date);
  f.env.REFUND_TEST_TRANSPORT={fetch:async()=>Response.json({id:'re_FICTIONAL_'+code,amount:50,currency:'gbp',payment_intent:'pi_FICTIONAL_'+code,status:'pending'})};let r=await j(await f.hq('/platform/refunds',1,{orderReference:order,amountPence:50,reason:'FICTIONAL cancellation',termsReference:'FICTIONAL-ACCEPTED-TERMS',clientReference:crypto.randomUUID()}));r=await j(await f.hq('/platform/refunds/'+r.id+'/approve',1,{version:r.version,approvalReference:'FICTIONAL-FINANCE',exceptionDueAt:future}));await j(await f.hq('/platform/refunds/'+r.id+'/submit',1,{version:r.version}));proof.push('native refund request, explicit approval and simulated processor pending receipt');
 }
 return {...f,order,definition,proof,synthetic:true,releaseAcceptance:false};
}
