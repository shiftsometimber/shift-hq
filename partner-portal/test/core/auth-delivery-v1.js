export async function ensureAuthDelivery(DB){await DB.exec(`CREATE TABLE IF NOT EXISTS auth_delivery_events(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,email_hash TEXT NOT NULL,event_type TEXT NOT NULL,status TEXT NOT NULL,provider_id TEXT,error_code TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);CREATE INDEX IF NOT EXISTS idx_auth_delivery_time ON auth_delivery_events(event_type,status,created_at);`)}
// Audit persistence is observational. An outage must not turn an already
// accepted email into a failed send or invalidate its token through a retry.
// Token/password/session writes remain fail closed in their owning handlers.
export async function recordAuthDelivery(DB,{userId=null,email,eventType,status,providerId=null,errorCode=null,eventReference=null,templateVersion=null,recipientRole=null}){
 try{
  await ensureAuthDelivery(DB);
  const emailHash=await sha256(String(email||'').trim().toLowerCase());
  const result=await DB.prepare(`INSERT INTO auth_delivery_events(user_id,email_hash,event_type,status,provider_id,error_code,created_at) VALUES(?,?,?,?,?,?,CURRENT_TIMESTAMP)`).bind(userId,emailHash,eventType,status,providerId,errorCode).run();
  if(eventReference!==null){
   if(!/^[A-Za-z0-9_:./-]{1,180}$/.test(eventReference)||!/^[-A-Za-z0-9_.]{1,80}$/.test(templateVersion||'')||!['member','operator'].includes(recipientRole))throw Error('invalid_delivery_link');
   const deliveryId=Number(result?.meta?.last_row_id);if(!Number.isSafeInteger(deliveryId)||deliveryId<1)throw Error('delivery_reference_unavailable');
   await DB.prepare(`CREATE TABLE IF NOT EXISTS auth_delivery_event_links(delivery_event_id INTEGER PRIMARY KEY,event_reference TEXT NOT NULL,template_version TEXT NOT NULL,recipient_role TEXT NOT NULL,recorded_at TEXT NOT NULL,FOREIGN KEY(delivery_event_id) REFERENCES auth_delivery_events(id) ON DELETE CASCADE)`).run();
   await DB.prepare('INSERT INTO auth_delivery_event_links VALUES(?,?,?,?,CURRENT_TIMESTAMP)').bind(deliveryId,eventReference,templateVersion,recipientRole).run();
  }
  return{recorded:true};
 }catch{
  console.warn('auth_delivery_audit_unavailable');
  return{recorded:false};
 }
}
export async function authDeliveryHealth(DB,{hours=24}={}){await ensureAuthDelivery(DB);const{results=[]}=await DB.prepare(`SELECT event_type,status,COUNT(*) count,MAX(created_at) last_at FROM auth_delivery_events WHERE created_at>=datetime('now',?) GROUP BY event_type,status`).bind(`-${Math.max(1,Number(hours)||24)} hours`).all();return{windowHours:hours,events:results.map(x=>({...x,count:Number(x.count||0)}))}}
async function sha256(v){const d=new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(v)));return[...d].map(x=>x.toString(16).padStart(2,'0')).join('')}
