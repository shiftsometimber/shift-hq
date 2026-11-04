// Provider-neutral receipt contract. This records an external prescriber's signed
// prescription; it neither creates an electronic signature nor makes decisions.
export const PRESCRIPTION_STATES = Object.freeze([
  'prescription_signed','sent_to_pharmacy','pharmacy_received','dispensing','dispatched','fulfilled'
]);
const previous = Object.freeze({prescription_signed:'approved',sent_to_pharmacy:'prescription_signed',pharmacy_received:'sent_to_pharmacy',dispensing:'pharmacy_received',dispatched:'dispensing',fulfilled:'dispatched'});
const fields = Object.freeze({
  prescription_workflow_version:'INTEGER NOT NULL DEFAULT 0',
  prescription_reference:'TEXT', signed_record_reference:'TEXT', prescriber_reference:'TEXT',
  prescription_json:'TEXT', prescription_signed_at:'TEXT', prescription_sent_at:'TEXT',
  pharmacy_received_at:'TEXT', pharmacy_receipt_reference:'TEXT',
  prescription_event_reference:'TEXT', prescription_event_at:'TEXT'
});
export async function ensurePrescriptionSchema(DB) {
  const {results=[]}=await DB.prepare('PRAGMA table_info(medicine_orders)').all();
  const existing=new Set(results.map(x=>x.name));
  for(const [name,type] of Object.entries(fields)) if(!existing.has(name)) {
    try {await DB.prepare(`ALTER TABLE medicine_orders ADD COLUMN ${name} ${type}`).run();}
    catch(error) {if(!/duplicate column name/i.test(String(error?.message)))throw error;}
  }
  await DB.prepare(`CREATE TABLE IF NOT EXISTS medicine_prescription_events (
    event_reference TEXT PRIMARY KEY, order_id INTEGER NOT NULL,
    payload_hash TEXT NOT NULL, from_status TEXT NOT NULL, to_status TEXT NOT NULL,
    prescription_reference TEXT NOT NULL, occurred_at TEXT NOT NULL, received_at TEXT NOT NULL,
    FOREIGN KEY(order_id) REFERENCES medicine_orders(id)
  )`).run();
}
const fail=(error,status=400)=>({ok:false,error,httpStatus:status});
function text(value,max=160) {
  return typeof value==='string' && value.length>0 && value.length<=max && value===value.trim() && !/[\u0000-\u001f\u007f]/.test(value) ? value : null;
}
function date(value) {
  if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})$/.test(value))return null;
  const day=value.slice(0,10),calendar=Date.parse(day+'T00:00:00Z');
  if(!Number.isFinite(calendar)||new Date(calendar).toISOString().slice(0,10)!==day)return null;
  const n=Date.parse(value);return Number.isFinite(n)?new Date(n).toISOString():null;
}
export function validatePrescriptionEvent(order,input,now=new Date()) {
  if(!PRESCRIPTION_STATES.includes(input?.status))return fail('invalid_prescription_status');
  const allowed=new Set(['orderNumber','status','eventReference','prescriptionReference','occurredAt','signedRecordReference','prescriberReference','prescription','pharmacyReceiptReference','reorderEligibleAt']);
  if(Object.keys(input).some(k=>!allowed.has(k)))return fail('unknown_prescription_field');
  const eventReference=text(input.eventReference),reference=text(input.prescriptionReference),occurredAt=date(input.occurredAt);
  if(!eventReference||!reference||!occurredAt||Date.parse(occurredAt)>now.getTime()+300000)return fail('prescription_event_required');
  if(order.status!=='paid')return fail('paid_order_required',409);
  if(order.prescription_reference&&order.prescription_reference!==reference)return fail('prescription_reference_mismatch',409);
  if(input.status!=='prescription_signed'&&(input.prescription||input.signedRecordReference||input.prescriberReference))return fail('prescription_already_signed',409);
  let prescription=null,signedRecordReference=null,prescriberReference=null;
  if(input.status==='prescription_signed') {
    signedRecordReference=text(input.signedRecordReference);prescriberReference=text(input.prescriberReference);
    const p=input.prescription;
    if(!signedRecordReference||!prescriberReference||!p||typeof p!=='object'||Array.isArray(p))return fail('signed_prescription_required');
    const keys=['medicineName','strengthLabel','formulation','directions','quantity'];
    if(Object.keys(p).some(k=>!keys.includes(k))||keys.some(k=>!text(p[k],k==='directions'?1000:200)))return fail('prescribed_medicine_required');
    prescription=Object.fromEntries(keys.map(k=>[k,p[k]]));
  }
  const receipt=text(input.pharmacyReceiptReference);
  if(input.status==='pharmacy_received'&&!text(input.pharmacyReceiptReference))return fail('pharmacy_receipt_required');
  if(input.pharmacyReceiptReference&&input.status!=='pharmacy_received')return fail('unexpected_pharmacy_receipt');
  const reorderAt=input.reorderEligibleAt?date(input.reorderEligibleAt):null;
  if(input.reorderEligibleAt&&(!reorderAt||input.status!=='fulfilled'))return fail('invalid_reorder_date');
  return {ok:true,event:{eventReference,orderNumber:order.order_number,status:input.status,prescriptionReference:reference,occurredAt,signedRecordReference,prescriberReference,prescription,pharmacyReceiptReference:receipt||null,reorderEligibleAt:reorderAt}};
}
async function hash(value) {return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value))),n=>n.toString(16).padStart(2,'0')).join('');}
export async function applyPrescriptionEvent(DB,order,input) {
  const checked=validatePrescriptionEvent(order,input);if(!checked.ok)return checked;
  const e=checked.event,payloadHash=await hash(JSON.stringify(e));
  const duplicate=async()=>{
    const old=await DB.prepare('SELECT order_id,payload_hash FROM medicine_prescription_events WHERE event_reference=?').bind(e.eventReference).first();
    return old?(Number(old.order_id)===Number(order.id)&&old.payload_hash===payloadHash?{ok:true,duplicate:true,orderNumber:order.order_number,status:order.clinical_status}:fail('prescription_event_conflict',409)):null;
  };
  const old=await duplicate();if(old)return old;
  if(order.clinical_status!==previous[e.status])return fail('invalid_prescription_transition',409);
  if(order.prescription_event_at&&Date.parse(e.occurredAt)<Date.parse(order.prescription_event_at))return fail('prescription_event_out_of_order',409);
  if(e.status!=='prescription_signed'&&(!order.signed_record_reference||!order.prescriber_reference||!order.prescription_json))return fail('signed_prescription_required',409);
  const stamp=new Date().toISOString();
  let result;
  try {
    result=await DB.batch([
      DB.prepare(`UPDATE medicine_orders SET clinical_status=?,clinical_updated_at=?,updated_at=?,
        prescription_workflow_version=1,prescription_reference=?,
        signed_record_reference=COALESCE(signed_record_reference,?),prescriber_reference=COALESCE(prescriber_reference,?),
        prescription_json=COALESCE(prescription_json,?),
        prescription_signed_at=CASE WHEN ?='prescription_signed' THEN ? ELSE prescription_signed_at END,
        prescription_sent_at=CASE WHEN ?='sent_to_pharmacy' THEN ? ELSE prescription_sent_at END,
        pharmacy_received_at=CASE WHEN ?='pharmacy_received' THEN ? ELSE pharmacy_received_at END,
        pharmacy_receipt_reference=COALESCE(pharmacy_receipt_reference,?),
        prescription_event_reference=?,prescription_event_at=?,reorder_eligible_at=COALESCE(?,reorder_eligible_at)
        WHERE id=? AND clinical_status=? AND prescription_event_reference IS ?`)
        .bind(e.status,stamp,stamp,e.prescriptionReference,e.signedRecordReference,e.prescriberReference,e.prescription?JSON.stringify(e.prescription):null,
          e.status,e.occurredAt,e.status,e.occurredAt,e.status,e.occurredAt,e.pharmacyReceiptReference,e.eventReference,e.occurredAt,e.reorderEligibleAt,
          order.id,order.clinical_status,order.prescription_event_reference||null),
      DB.prepare(`INSERT INTO medicine_prescription_events(event_reference,order_id,payload_hash,from_status,to_status,prescription_reference,occurred_at,received_at)
        SELECT ?,?,?,?,?,?,?,? WHERE changes()=1`).bind(e.eventReference,order.id,payloadHash,order.clinical_status,e.status,e.prescriptionReference,e.occurredAt,stamp),
      DB.prepare(`UPDATE order_reference_registry SET status=?,updated_at=? WHERE order_number=? AND EXISTS (
        SELECT 1 FROM medicine_orders WHERE id=? AND clinical_status=? AND prescription_event_reference=?)`)
        .bind(e.status,stamp,order.order_number,order.id,e.status,e.eventReference)
    ]);
  } catch(error) {
    // A concurrent delivery of the same event can collide with the ledger key.
    // The whole batch rolls back; only an identical existing receipt is success.
    const raced=await duplicate();if(raced)return raced;throw error;
  }
  if(Number(result[0]?.meta?.changes)!==1){const raced=await duplicate();return raced||fail('order_status_changed',409);}
  return {ok:true,orderNumber:order.order_number,previousStatus:order.clinical_status,status:e.status,prescriptionReference:e.prescriptionReference};
}
export function memberPrescription(order) {
  if(!order.prescription_reference)return null;
  let medicine;try{medicine=JSON.parse(order.prescription_json||'null');}catch{return null;}
  return {reference:order.prescription_reference,signedAt:order.prescription_signed_at||null,sentAt:order.prescription_sent_at||null,
    pharmacyReceivedAt:order.pharmacy_received_at||null,medicine};
}
