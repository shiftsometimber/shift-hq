// One unresolved checkout per member/channel. Stored parameters and identity
// survive lost browser/provider responses; never recycle an ambiguous key.
const stamp=()=>new Date().toISOString();
const hash=async value=>[...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join('');
export async function ensureCheckoutAttempts(DB){
 await DB.exec(`CREATE TABLE IF NOT EXISTS checkout_attempts (
  id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,channel TEXT NOT NULL,fingerprint TEXT NOT NULL,
  state TEXT NOT NULL DEFAULT 'preparing',active INTEGER NOT NULL DEFAULT 1,
  order_number TEXT NOT NULL UNIQUE,form_body TEXT,claim_token TEXT,
  session_id TEXT,checkout_url TEXT,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
 );CREATE UNIQUE INDEX IF NOT EXISTS idx_checkout_attempt_active ON checkout_attempts(user_id,channel) WHERE active=1;`.replace(/\s+/g,' ').replaceAll(';',';\n')); // One complete statement per D1 exec line.
}
export async function acquireCheckoutAttempt(DB,{userId,channel,selection}){
 await ensureCheckoutAttempts(DB);
 const fingerprint=await hash(JSON.stringify(selection)),id=crypto.randomUUID(),date=stamp();
 const reference=`SST-${date.slice(0,10).replaceAll('-','')}-${id.replaceAll('-','').slice(0,8).toUpperCase()}`;
 await DB.prepare(`INSERT OR IGNORE INTO checkout_attempts(id,user_id,channel,fingerprint,order_number,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`).bind(id,userId,channel,fingerprint,reference,date,date).run();
 const row=await DB.prepare('SELECT * FROM checkout_attempts WHERE user_id=? AND channel=? AND active=1').bind(userId,channel).first();
 if(!row)throw Error('checkout_attempt_unavailable');
 return {attempt:row,conflict:row.fingerprint!==fingerprint};
}
export function checkoutGuard(attempt,claim){return `EXISTS(SELECT 1 FROM checkout_attempts WHERE id='${attempt.id}' AND claim_token='${claim}' AND state='building')`}
export async function prepareCheckoutAttempt(DB,attempt,{availableSql,availableArgs=[],form,statements}){
 const claim=crypto.randomUUID(),guard=checkoutGuard(attempt,claim),date=stamp();
 const writes=[DB.prepare(`UPDATE checkout_attempts SET state='building',claim_token=?,updated_at=? WHERE id=? AND state='preparing' AND (${availableSql})`).bind(claim,date,attempt.id,...availableArgs),...statements(guard),DB.prepare(`UPDATE checkout_attempts SET state='ready',form_body=?,updated_at=? WHERE id=? AND claim_token=? AND state='building'`).bind(String(form),date,attempt.id,claim)];
 await DB.batch(writes);
 return DB.prepare('SELECT * FROM checkout_attempts WHERE id=?').bind(attempt.id).first();
}
export async function requestCheckoutSession(env,attempt){
 if(attempt.state==='rejected')return {ok:false,error:'checkout_requires_reconciliation',status:409};
 if(!['ready','unknown','open'].includes(attempt.state))return {ok:false,error:'checkout_preparing',status:409};
 if(attempt.session_id&&attempt.checkout_url)return {ok:true,id:attempt.session_id,url:attempt.checkout_url};
 // Stripe may forget idempotency keys after 24 hours. Do not replay unknown
 // requests beyond that window or silently free their reservations.
 if(Date.now()-Date.parse(attempt.created_at)>23*60*60*1000)return {ok:false,error:'checkout_requires_reconciliation',status:409};
 try{
  const r=await fetch('https://api.stripe.com/v1/checkout/sessions',{method:'POST',headers:{authorization:`Bearer ${env.STRIPE_SECRET_KEY}`,'Content-Type':'application/x-www-form-urlencoded','Idempotency-Key':attempt.order_number},body:attempt.form_body,signal:AbortSignal.timeout(15000)});
  const session=await r.json().catch(()=>null);
  if(r.ok&&session?.id&&session?.url){
   await env.DB.prepare("UPDATE checkout_attempts SET state='open',session_id=?,checkout_url=?,last_error=NULL,updated_at=? WHERE id=? AND active=1").bind(session.id,session.url,stamp(),attempt.id).run();
   return {ok:true,id:session.id,url:session.url};
  }
  // 5xx, 409 and malformed responses can follow provider acceptance. Even
  // clear validation rejection stays one recoverable attempt until reviewed.
  const rejected=r.status>=400&&r.status<500&&![409,429].includes(r.status);
  await env.DB.prepare("UPDATE checkout_attempts SET state=?,last_error=?,updated_at=? WHERE id=? AND active=1 AND session_id IS NULL").bind(rejected?'rejected':'unknown',r.ok?'invalid_provider_response':`provider_http_${r.status}`,stamp(),attempt.id).run();
  if(rejected)return {ok:false,error:'checkout_requires_reconciliation',status:409};
 }catch{
  await env.DB.prepare("UPDATE checkout_attempts SET state='unknown',last_error='provider_or_persistence_outcome_unknown',updated_at=? WHERE id=? AND active=1 AND session_id IS NULL").bind(stamp(),attempt.id).run().catch(()=>{});
 }
 return {ok:false,error:'checkout_outcome_unknown',status:503};
}
export function checkoutProblem(result){return {ok:false,error:result.error,message:['checkout_selection_conflict','checkout_requires_reconciliation'].includes(result.error)?'An earlier checkout needs to be resolved before changing this order. Please contact support.':'We could not confirm checkout yet. Retry this same order; please do not start another purchase. If it continues, contact support.'}}
