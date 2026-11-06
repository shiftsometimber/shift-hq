import {qaDatabaseAdmitted} from './database-boundary.mjs';
export const QA_PAYMENT_KEY='sk_test_FICTIONAL_QA_NO_PROCESSOR_ACCOUNT';
export const QA_CALLBACK_KEY='whsec_FICTIONAL_QA_INTERNAL_CALLBACK_ONLY';
export const QA_PHARMACY='https://pharmacy.example.test/intake';
const json=(body,status=200)=>Response.json(body,{status,headers:{'Cache-Control':'no-store, private'}});
const sha=async value=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),x=>x.toString(16).padStart(2,'0')).join('');
export async function qaCommerceAdmitted(env){
 return env.SSTRX_QA_COMMERCE_ENABLED==='true'&&env.STRIPE_MODE==='test'&&env.SSTRX_QA_DATABASE_ID!=='88f40aed-cb23-4372-8c94-8a73f48bc847'&&await qaDatabaseAdmitted(env);
}
async function admitted(env){
 if(!await qaCommerceAdmitted(env)||env.STRIPE_SECRET_KEY!==QA_PAYMENT_KEY||env.PHARMACY_CLINICAL_INTAKE_URL!==QA_PHARMACY||env.PHARMACY_INTEGRATION_SECRET!=='FICTIONAL_QA_NO_PROVIDER_ACCOUNT')throw Error('isolated_commerce_transport_required');
}
async function schema(DB){
 await DB.prepare('CREATE TABLE IF NOT EXISTS qa_simulated_transport_events(id TEXT PRIMARY KEY,kind TEXT NOT NULL,member_id INTEGER NOT NULL,request_digest TEXT NOT NULL,response_json TEXT NOT NULL,created_at TEXT NOT NULL)').run();
 await DB.prepare('CREATE TABLE IF NOT EXISTS qa_simulated_checkouts(id TEXT PRIMARY KEY,order_number TEXT NOT NULL UNIQUE,member_id INTEGER NOT NULL,request_digest TEXT NOT NULL,session_json TEXT NOT NULL,outcome TEXT NOT NULL DEFAULT \'open\',event_type TEXT,event_id TEXT,created_at TEXT NOT NULL,completed_at TEXT)').run();
 await DB.prepare('ALTER TABLE qa_simulated_checkouts ADD COLUMN event_created INTEGER').run().catch(()=>{});
}
export async function qaCheckout(env,id){
 await admitted(env);await schema(env.DB);
 return env.DB.prepare('SELECT q.*,o.status order_status,o.total_pence,o.currency,o.variant_id,u.email FROM qa_simulated_checkouts q JOIN medicine_orders o ON o.order_number=q.order_number AND o.user_id=q.member_id JOIN users u ON u.id=q.member_id WHERE q.id=?').bind(id).first();
}
export async function qaCommerceFetch(env,input,options={}){
 await admitted(env);await schema(env.DB);
 const u=new URL(String(input)),method=options.method||'GET';
 if(u.href===QA_PHARMACY&&method==='POST'){
  const f=options.body;if(!(f instanceof FormData))return json({error:'fictional_multipart_required'},400);
  const memberId=Number(f.get('memberReference')),variantId=Number(f.get('variantId')),reference=options.headers?.['Idempotency-Key'];
  const user=await env.DB.prepare('SELECT email FROM users WHERE id=?').bind(memberId).first();
  if(!user||!/@example\.(?:test|invalid)$/.test(user.email)||variantId!==9911||!/^SCI-[a-f0-9-]{36}$/.test(reference||'')||!/^TEST\b/.test(f.get('patientFirstName')||'')||!/^TEST\b/.test(f.get('patientAddress1')||'')||f.get('patientPhone')!=='07700900000'||f.get('gpPractice')!=='TEST ONLY'||[...f.values()].some(v=>typeof v!=='string'&&v.size>4096))return json({error:'fictional_intake_required'},403);
  const entries=[];for(const [key,value]of f){entries.push([key,typeof value==='string'?value:{bytes:value.size,type:value.type,sha256:await sha(Array.from(new Uint8Array(await value.arrayBuffer())).join(','))}]);}entries.sort((a,b)=>a[0].localeCompare(b[0]));
  const digest=await sha(JSON.stringify(entries)),response={reference:'TEST-PHARMACY-'+reference,patientReference:'TEST-PATIENT-'+memberId,status:'verified',verified:true,simulation:true};
  await env.DB.prepare('INSERT OR IGNORE INTO qa_simulated_transport_events VALUES(?,?,?,?,?,?)').bind(reference,'intake',memberId,digest,JSON.stringify(response),new Date().toISOString()).run();
  const saved=await env.DB.prepare('SELECT request_digest,response_json FROM qa_simulated_transport_events WHERE id=? AND member_id=?').bind(reference,memberId).first();
  return saved?.request_digest===digest?json(JSON.parse(saved.response_json)):json({error:'simulated_intake_reference_changed'},409);
 }
 if(u.origin==='https://api.stripe.com'&&u.pathname==='/v1/checkout/sessions'&&method==='POST'){
  const f=new URLSearchParams(options.body),number=f.get('metadata[order_number]'),key=options.headers?.['Idempotency-Key'];
  const order=await env.DB.prepare('SELECT o.*,u.email member_email FROM medicine_orders o JOIN users u ON u.id=o.user_id WHERE o.order_number=?').bind(number).first();
  if(!order||!/@example\.(?:test|invalid)$/.test(order.member_email)||order.variant_id!==9911||!/^TEST[- ]/.test(order.medicine_name)||key!==number||f.get('metadata[order_type]')!=='medicine'||Number(f.get('metadata[user_id]'))!==order.user_id||f.get('client_reference_id')!==number||Number(f.get('line_items[0][price_data][unit_amount]'))!==order.total_pence||f.get('line_items[0][price_data][currency]')!=='gbp')return json({error:'fictional_owned_order_required'},403);
  const digest=await sha(f.toString()),id='cs_test_QA_'+(await sha(number)).slice(0,32),session={id,object:'checkout.session',mode:'payment',status:'open',payment_status:'unpaid',livemode:false,amount_total:order.total_pence,currency:'gbp',client_reference_id:number,metadata:{order_number:number,order_type:'medicine',user_id:String(order.user_id)},url:'https://my-qa.sstrx.co.uk/qa/checkout/'+id,simulation:true};
  await env.DB.prepare('INSERT OR IGNORE INTO qa_simulated_checkouts(id,order_number,member_id,request_digest,session_json,created_at) VALUES(?,?,?,?,?,?)').bind(id,number,order.user_id,digest,JSON.stringify(session),new Date().toISOString()).run();
  const saved=await env.DB.prepare('SELECT request_digest,session_json FROM qa_simulated_checkouts WHERE id=?').bind(id).first();
  return saved?.request_digest===digest?json(JSON.parse(saved.session_json)):json({error:'simulated_checkout_selection_changed'},409);
 }
 if(u.origin==='https://api.stripe.com'&&/^\/v1\/checkout\/sessions\/cs_test_QA_[a-f0-9]{32}$/.test(u.pathname)&&method==='GET'){
  const row=await qaCheckout(env,u.pathname.split('/').pop());if(!row)return json({error:'simulated_checkout_not_found'},404);
  const session=JSON.parse(row.session_json);return json({...session,status:row.outcome==='paid'?'complete':row.outcome==='expired'?'expired':'open',payment_status:row.order_status==='paid'?'paid':'unpaid'});
 }
 throw Error('external_transport_not_in_qa_contract');
}
export async function qaCompleteCheckout(request,env,ctx,medicineRoutes,authenticate){
 const path=new URL(request.url).pathname,match=path.match(/^\/v1\/qa\/checkout\/(cs_test_QA_[a-f0-9]{32})$/);if(!match)return null;
 await admitted(env);const identity=await authenticate(request,env,ctx);if(!identity)return json({error:'native_member_sign_in_required'},401);
 const row=await qaCheckout(env,match[1]);if(!row||row.member_id!==Number(identity.id))return json({error:'simulated_checkout_not_found'},404);
 const read=()=>json({simulation:true,id:row.id,orderNumber:row.order_number,amountPence:row.total_pence,currency:row.currency,outcome:row.outcome,nativeStatus:row.order_status});
 if(request.method==='GET')return read();
 if(request.method!=='POST')return json({error:'method_not_allowed'},405);
 if(request.headers.get('Origin')!=='https://shiftsometimber.co.uk')return json({error:'same_origin_required'},403);
 const b=await request.json().catch(()=>null);if(!b||Object.keys(b).some(k=>k!=='action')||!['complete','expire'].includes(b.action))return json({error:'simulation_action_required'},400);
 const kind=b.action==='complete'?'checkout.session.completed':'checkout.session.expired',eventId='evt_test_QA_'+row.id;
 if(row.event_type&&row.event_type!==kind)return json({error:'simulated_outcome_already_selected'},409);
 await env.DB.prepare("UPDATE qa_simulated_checkouts SET outcome='processing',event_type=?,event_id=?,event_created=COALESCE(event_created,?) WHERE id=? AND outcome='open'").bind(kind,eventId,Math.floor(Date.now()/1000),row.id).run();
 const stored=await qaCheckout(env,row.id);if(stored.event_type!==kind)return json({error:'simulated_outcome_already_selected'},409);
 if(['paid','expired'].includes(stored.outcome))return json({simulation:true,duplicate:true,orderNumber:stored.order_number,outcome:stored.outcome,nativeStatus:stored.order_status});
 const session={...JSON.parse(stored.session_json),payment_status:b.action==='complete'?'paid':'unpaid',payment_intent:b.action==='complete'?'pi_test_QA_'+stored.id.slice(11):null};
 const event={created:stored.event_created,id:eventId,type:kind,livemode:false,data:{object:session}},raw=JSON.stringify(event),seconds=Math.floor(Date.now()/1000),key=await crypto.subtle.importKey('raw',new TextEncoder().encode(QA_CALLBACK_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const signature=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(seconds+'.'+raw))),x=>x.toString(16).padStart(2,'0')).join('');
 const response=await medicineRoutes(new Request('https://api.shiftsometimber.co.uk/v1/commerce/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','Stripe-Signature':'t='+seconds+',v1='+signature},body:raw}),env,ctx);
 if(!response?.ok)return json({error:'simulated_receipt_requires_reconciliation',simulation:true,orderNumber:row.order_number},503);
 const confirmed=await qaCheckout(env,row.id),expected=b.action==='complete'?'paid':'failed';if(confirmed.order_status!==expected)return json({error:'native_receipt_not_confirmed'},503);
 const outcome=b.action==='complete'?'paid':'expired';await env.DB.prepare('UPDATE qa_simulated_checkouts SET outcome=?,completed_at=? WHERE id=? AND event_type=?').bind(outcome,new Date().toISOString(),row.id,kind).run();
 return json({simulation:true,orderNumber:row.order_number,outcome,nativeStatus:expected});
}
