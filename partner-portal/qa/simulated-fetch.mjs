// Injected ONLY into the private Core QA bundle. There is deliberately no
// native-fetch fallback, network proxy, real provider key or mutable global.
const hex=async s=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(s))),v=>v.toString(16).padStart(2,'0')).join('');
export async function fetch(input,init={}){
 const request=input instanceof Request?input:new Request(input,init),u=new URL(request.url);
 if(request.method!=='POST'||u.username||u.password||u.search||u.hash)throw Error('qa_external_transport_denied');
 const key=request.headers.get('Idempotency-Key')||'';
 if(u.href==='https://pharmacy.example.test/intake'&&/^SCI-[a-f0-9-]{36}$/i.test(key)){
  if(request.headers.get('authorization')!=='Bearer FICTIONAL-QA-PHARMACY-NO-TRANSPORT')throw Error('qa_pharmacy_key_required');
  const form=await request.formData();
  if(!/@example\.(?:test|invalid)$/i.test(form.get('patientEmail')||'')||form.get('clientReference')!==key)throw Error('qa_fictional_identity_required');
  const id=await hex(key);return Response.json({reference:'TEST-SIM-'+id.slice(0,32),patientReference:'TEST-MEMBER-'+form.get('memberReference'),status:'verified',verified:true,simulated:true});
 }
 if(u.href==='https://api.stripe.com/v1/checkout/sessions'&&/^SST-\d{8}-[A-F0-9]{8}$/.test(key)){
  if(request.headers.get('authorization')!=='Bearer sk_test_FICTIONAL_PRIVATE_QA_NO_ACCOUNT')throw Error('qa_checkout_key_required');
  const f=new URLSearchParams(await request.text());
  if(f.get('metadata[order_number]')!==key||!/@example\.(?:test|invalid)$/i.test(f.get('customer_email')||''))throw Error('qa_checkout_identity_required');
  const id='cs_test_QA_'+await hex(key);
  return Response.json({id,url:'https://my-qa.sstrx.co.uk/test-checkout?session_id='+id,simulated:true});
 }
 throw Error('qa_external_transport_denied');
}
