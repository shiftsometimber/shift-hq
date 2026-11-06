// Native handlers retain account, catalogue, stock, idempotency and signature
// authority. This module supplies fictional transport only, on a marked QA DB.
export const QA_WEBHOOK_KEY='FICTIONAL-QA-WEBHOOK-NO-PROCESSOR';
export function simulatedCommerceEnv(env){return {...env,STRIPE_SECRET_KEY:'sk_test_FICTIONAL_PRIVATE_QA_NO_ACCOUNT',STRIPE_WEBHOOK_SECRET:QA_WEBHOOK_KEY,PHARMACY_CLINICAL_INTAKE_URL:'https://pharmacy.example.test/intake',PHARMACY_INTEGRATION_SECRET:'FICTIONAL-QA-PHARMACY-NO-TRANSPORT',PHARMACY_CATALOGUE_PARTNER_ID:'test-pharmacy-b'};}
const json=(error,status=403)=>Response.json({error,simulated:true},{status});
export async function confirmSimulatedCheckout(request,env,ctx,commerce){
 if(request.method!=='POST'||request.headers.get('Origin')!=='https://shiftsometimber.co.uk')return json('qa_origin_required');
 let body;try{body=await request.json()}catch{return json('invalid_json',400)}
 if(body.confirmFictionalPayment!==true||!/^cs_test_QA_[a-f0-9]{64}$/.test(body.sessionId||''))return json('explicit_fictional_confirmation_required',400);
 const headers=new Headers(request.headers);headers.delete('Content-Type');
 const owned=await commerce(new Request('https://api.shiftsometimber.co.uk/v1/commerce/medicine-order-status?session_id='+body.sessionId,{headers}),env,ctx);
 if(!owned.ok)return owned;
 const order=await owned.json();
 const event={id:'evt_test_QA_'+body.sessionId.slice(11),type:'checkout.session.completed',data:{object:{id:body.sessionId,metadata:{order_type:'medicine',order_number:order.orderNumber},payment_status:'paid',payment_intent:'pi_test_QA_'+body.sessionId.slice(11)}}},payload=JSON.stringify(event),time=Math.floor(Date.now()/1000);
 const key=await crypto.subtle.importKey('raw',new TextEncoder().encode(QA_WEBHOOK_KEY),{name:'HMAC',hash:'SHA-256'},false,['sign']);
 const sig=Array.from(new Uint8Array(await crypto.subtle.sign('HMAC',key,new TextEncoder().encode(time+'.'+payload))),x=>x.toString(16).padStart(2,'0')).join('');
 const receipt=await commerce(new Request('https://api.shiftsometimber.co.uk/v1/commerce/stripe/webhook',{method:'POST',headers:{'Content-Type':'application/json','stripe-signature':`t=${time},v1=${sig}`},body:payload}),env,ctx);
 if(!receipt.ok)return receipt;
 return Response.json({ok:true,simulated:true,realPayment:false,orderNumber:order.orderNumber,receipt:await receipt.json()});
}
