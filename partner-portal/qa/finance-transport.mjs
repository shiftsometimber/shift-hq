// Private-QA processor double over existing native refund and capture records.
// No network, account, ledger or refund authorisation is supplied by this module.
import {qaDatabaseAdmitted} from './database-boundary.mjs';
import {digest} from '../platform/domain.mjs';
const forbiddenDatabase='88f40aed-cb23-4372-8c94-8a73f48bc847';
const fictional=email=>typeof email==='string'&&/@example\.(?:test|invalid)$/.test(email);
const deny=(error,status=403)=>Response.json({error,simulation:true},{status});
async function admitted(env){
 if(env.SSTRX_QA_REFUNDS_ENABLED!=='true'||env.STRIPE_MODE!=='test'||env.SSTRX_PRICE_PAYMENT_MODE==='live'||env.STRIPE_SECRET_KEY||env.SSTRX_QA_DATABASE_ID===forbiddenDatabase||!await qaDatabaseAdmitted(env))throw Error('isolated_qa_refund_transport_required');
}
async function schema(DB){
 await DB.prepare('CREATE TABLE IF NOT EXISTS qa_simulated_refunds(idempotency_key TEXT PRIMARY KEY,refund_id TEXT NOT NULL UNIQUE,request_digest TEXT NOT NULL,response_json TEXT NOT NULL,created_at TEXT NOT NULL)').run();
 for(const action of ['UPDATE','DELETE'])await DB.prepare(`CREATE TRIGGER IF NOT EXISTS qa_simulated_refunds_no_${action.toLowerCase()} BEFORE ${action} ON qa_simulated_refunds BEGIN SELECT RAISE(ABORT,'immutable_qa_refund_receipt'); END`).run();
}
export function qaRefundTransport(env){return {async fetch(request){
 await admitted(env);
 const url=new URL(request.url);
 if(url.href!=='https://api.stripe.com/v1/refunds'||request.method!=='POST')return deny('qa_refund_route_not_admitted');
 const raw=await request.text();if(raw.length>8192)return deny('qa_refund_request_too_large',413);
 const body=new URLSearchParams(raw),allowed=['payment_intent','amount','metadata[sst_refund_id]','metadata[order_reference]'];
 if([...body.keys()].some(k=>!allowed.includes(k))||allowed.some(k=>body.getAll(k).length!==1))return deny('qa_refund_fields_required',400);
 const key=request.headers.get('Idempotency-Key'),id=body.get('metadata[sst_refund_id]'),order=body.get('metadata[order_reference]');
 const row=await env.DB.prepare('SELECT r.*,s.payment_id,s.payment_intent,s.captured_pence,m.user_id,m.variant_id,m.medicine_name,m.email order_email,m.stripe_checkout_session_id,m.stripe_payment_intent_id,m.total_pence,m.currency order_currency,u.email member_email FROM rx_refunds r JOIN rx_refund_sources s ON s.refund_id=r.id JOIN medicine_orders m ON m.order_number=r.order_number JOIN users u ON u.id=m.user_id WHERE r.id=? AND r.order_number=?').bind(id,order).first();
 if(!row||!fictional(row.member_email)||!fictional(row.order_email)||row.variant_id!==9911||!/^TEST[- ]/.test(row.medicine_name)||row.member_id!==row.user_id||row.payment_id!==null||row.currency!=='GBP'||String(row.order_currency).toUpperCase()!=='GBP'||row.idempotency_key!==key||!key||!row.approved_by||!row.approval_reference||!['submitting','unknown','submitted','completed'].includes(row.state))return deny('approved_owned_fictional_refund_required');
 const amount=Number(body.get('amount'));
 if(!/^[1-9]\d*$/.test(body.get('amount')||'')||!Number.isSafeInteger(amount)||amount!==row.amount_pence||amount>row.captured_pence||row.captured_pence!==row.total_pence||body.get('payment_intent')!==row.payment_intent||row.payment_intent!==row.stripe_payment_intent_id||!/^pi_test_QA_[a-f0-9]{32}$/.test(row.payment_intent||'')||!/^cs_test_QA_[a-f0-9]{32}$/.test(row.stripe_checkout_session_id||''))return deny('qa_refund_capture_mismatch');
 const captures=await env.DB.prepare("SELECT amount_pence,currency,payload_digest FROM medicine_payment_receipts WHERE order_number=? AND session_id=? AND payment_intent=? AND mode='test'").bind(row.order_number,row.stripe_checkout_session_id,row.payment_intent).all();
 if(!(captures.results||[]).length||(captures.results||[]).some(c=>c.amount_pence!==row.total_pence||c.currency!=='GBP'||!/^[a-f0-9]{64}$/.test(c.payload_digest||'')))return deny('native_qa_capture_receipt_required');
 const requestDigest=await digest({key,id,order,paymentIntent:row.payment_intent,amount}),response={id:'re_test_QA_'+(await digest(key)).slice(0,32),object:'refund',amount,currency:'gbp',payment_intent:row.payment_intent,status:'succeeded',livemode:false,simulation:true};
 await schema(env.DB);
 await env.DB.prepare('INSERT OR IGNORE INTO qa_simulated_refunds VALUES(?,?,?,?,?)').bind(key,id,requestDigest,JSON.stringify(response),new Date().toISOString()).run();
 const saved=await env.DB.prepare('SELECT refund_id,request_digest,response_json FROM qa_simulated_refunds WHERE idempotency_key=?').bind(key).first();
 if(!saved||saved.refund_id!==id||saved.request_digest!==requestDigest)return deny('qa_refund_idempotency_conflict',409);
 return Response.json(JSON.parse(saved.response_json),{headers:{'Cache-Control':'no-store, private'}});
}};}
export async function qaRefundEnvironment(env){
 if(env.SSTRX_QA_REFUNDS_ENABLED!=='true')return env;
 await admitted(env);
 if(env.REFUND_TEST_TRANSPORT||env.SSTRX_REFUND_TEST_EXECUTION_ENABLED)throw Error('qa_refund_binding_already_supplied');
 return {...env,SSTRX_REFUND_TEST_EXECUTION_ENABLED:'true',REFUND_TEST_TRANSPORT:qaRefundTransport(env)};
}
