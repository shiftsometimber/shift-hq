const clean=(value,max=120)=>String(value??'').trim().slice(0,max);
const iso=()=>new Date().toISOString();

export async function ensureOrderReferenceRegistry(DB){
  await DB.exec(`CREATE TABLE IF NOT EXISTS order_reference_registry (
    order_number TEXT PRIMARY KEY,
    channel TEXT NOT NULL CHECK(channel IN ('apparel','medicine','pharmacy','membership','service','other')),
    source_table TEXT,
    source_id INTEGER,
    user_id INTEGER,
    status TEXT NOT NULL DEFAULT 'reserved',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE UNIQUE INDEX IF NOT EXISTS idx_order_reference_source
    ON order_reference_registry(source_table,source_id)
    WHERE source_table IS NOT NULL AND source_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_order_reference_user ON order_reference_registry(user_id,created_at);`.replace(/\s+/g,' ').replaceAll(';',';\n')); // D1 exec separates statements by newline.
}

function candidate(){
  const day=new Date().toISOString().slice(0,10).replaceAll('-','');
  const random=crypto.randomUUID().replaceAll('-','').slice(0,8).toUpperCase();
  return `SST-${day}-${random}`;
}

export async function reserveOrderReference(DB,{channel,userId=null}={}){
  await ensureOrderReferenceRegistry(DB);
  const safeChannel=['apparel','medicine','pharmacy','membership','service','other'].includes(channel)?channel:'other';
  for(let attempt=0;attempt<8;attempt++){
    const orderNumber=candidate(),stamp=iso();
    try{
      await DB.prepare(`INSERT INTO order_reference_registry(order_number,channel,user_id,status,created_at,updated_at) VALUES(?,?,?,'reserved',?,?)`)
        .bind(orderNumber,safeChannel,Number(userId)||null,stamp,stamp).run();
      return orderNumber;
    }catch(error){
      if(!/unique|constraint/i.test(String(error?.message||error))||attempt===7)throw error;
    }
  }
  throw new Error('order_reference_unavailable');
}

export async function attachOrderReference(DB,orderNumber,{sourceTable,sourceId,status='pending'}={}){
  const stamp=iso();
  await DB.prepare(`UPDATE order_reference_registry SET source_table=?,source_id=?,status=?,updated_at=? WHERE order_number=?`)
    .bind(clean(sourceTable,80)||null,Number(sourceId)||null,clean(status,40)||'pending',stamp,clean(orderNumber,80)).run();
}

export async function updateOrderReferenceStatus(DB,orderNumber,status){
  await ensureOrderReferenceRegistry(DB);
  await DB.prepare(`UPDATE order_reference_registry SET status=?,updated_at=? WHERE order_number=?`)
    .bind(clean(status,40)||'unknown',iso(),clean(orderNumber,80)).run();
}
