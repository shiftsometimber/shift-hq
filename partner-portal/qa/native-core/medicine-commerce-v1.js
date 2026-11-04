import {ensureCheckoutAttempts,acquireCheckoutAttempt,prepareCheckoutAttempt,requestCheckoutSession,checkoutProblem} from './checkout-attempt-v1.mjs';
import {reserveOrderReference,attachOrderReference,updateOrderReferenceStatus,ensureOrderReferenceRegistry} from './order-reference-v1.js';
import {ensurePurchaseabilitySchema,authoritativePurchaseability} from './hq-purchaseability-v1.js';
import {sendTransactionalEmail,medicineEmailTemplates} from './transactional-email-v1.js';
import {HANDOVER_VERSION,PharmacyTransportError,pharmacyEndpoint,externalReference,digest,evidenceReceipts,pharmacyRequest,acceptedReceipt,secureResumeUrl} from './pharmacy-handover-v1.mjs';

const ALLOWED_ORIGINS = new Set([
  "https://shiftsometimber.co.uk",
  "https://www.shiftsometimber.co.uk",
]);
const CURRENCY = "gbp";
const DELIVERY_PENCE = 0;
const CLINICAL_CONSENT_VERSION = "medicine-clinical-intake-v1-2026-09-06";
const MAX_CLINICAL_FILE_BYTES = 8 * 1024 * 1024;
const CLINICAL_FILE_TYPES = new Set(["image/jpeg", "image/png", "image/heic", "image/heif"]);
const CLINICAL_STATES = new Set([
  "assessment_pending",
  "more_information_required",
  "approved",
  "declined",
  "refund_pending",
  "refunded",
  "dispensing",
  "dispatched",
  "fulfilled",
]);
const CLINICAL_TRANSITIONS = Object.freeze({
  assessment_pending: new Set(["more_information_required", "approved", "declined"]),
  more_information_required: new Set(["assessment_pending", "approved", "declined"]),
  approved: new Set(["dispensing", "declined", "refund_pending"]),
  declined: new Set(["refund_pending", "refunded"]),
  refund_pending: new Set(["refunded"]),
  dispensing: new Set(["dispatched", "refund_pending"]),
  dispatched: new Set(["fulfilled"]),
  fulfilled: new Set([]),
  refunded: new Set([]),
});

const clean = (value, max = 300) =>
  String(value ?? "")
    .trim()
    .slice(0, max);
const now = () => new Date().toISOString();
const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "no-store",
      "x-content-type-options": "nosniff",
      "referrer-policy": "no-referrer",
      "x-robots-tag": "noindex, nofollow",
      ...headers,
    },
  });
function cors(request) {
  const origin = request.headers.get("Origin") || "";
  return ALLOWED_ORIGINS.has(origin)
    ? {
        "access-control-allow-origin": origin,
        "access-control-allow-credentials": "true",
        "access-control-allow-methods": "GET, POST, OPTIONS",
        "access-control-allow-headers": "Content-Type",
        vary: "Origin",
      }
    : {};
}
function siteUrl(env) {
  return String(env.PUBLIC_SITE_URL || "https://shiftsometimber.co.uk").replace(
    /\/$/,
    "",
  );
}
function sessionTokens(request) {
  const tokens = [];
  for (const match of (request.headers.get("Cookie") || "").matchAll(
    /(?:^|;\s*)sst_session=([^;]+)/g,
  )) {
    try {
      const token = decodeURIComponent(match[1]);
      if (token && !tokens.includes(token)) tokens.push(token);
    } catch {}
  }
  return tokens.slice(0, 4);
}
async function sha256(value) {
  const bytes = new Uint8Array(
    await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(String(value)),
    ),
  );
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
async function member(request, env) {
  for (const token of sessionTokens(request)) {
    const row = await env.DB.prepare(
      `SELECT u.id,u.email,u.first_name,u.last_name,a.email_verified,s.expires_at,s.revoked_at FROM user_sessions s JOIN users u ON u.id=s.user_id LEFT JOIN user_auth a ON a.user_id=u.id WHERE s.token_hash=?`,
    )
      .bind(await sha256(token))
      .first();
    if (
      row &&
      !row.revoked_at &&
      Date.parse(row.expires_at) > Date.now()
    )
      return row;
  }
  return null;
}
async function body(request) {
  const text = await request.text();
  if (new TextEncoder().encode(text).length > 8192) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}
function hex(value) {
  return /^[a-f0-9]{64}$/i.test(value)
    ? Uint8Array.from(value.match(/.{2}/g), (x) => Number.parseInt(x, 16))
    : null;
}
function equal(a, b) {
  if (!a || !b || a.length !== b.length) return false;
  let different = 0;
  for (let i = 0; i < a.length; i++) different |= a[i] ^ b[i];
  return different === 0;
}
async function validSignature(payload, header, secret) {
  const parts = String(header || "")
      .split(",")
      .map((x) => x.split("=", 2)),
    timestamp = Number(parts.find(([k]) => k === "t")?.[1] || 0),
    signatures = parts
      .filter(([k]) => k === "v1")
      .map(([, v]) => hex(v))
      .filter(Boolean);
  if (
    !timestamp ||
    Math.abs(Math.floor(Date.now() / 1000) - timestamp) > 300 ||
    !signatures.length
  )
    return false;
  const key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["sign"],
    ),
    expected = new Uint8Array(
      await crypto.subtle.sign(
        "HMAC",
        key,
        new TextEncoder().encode(`${timestamp}.${payload}`),
      ),
    );
  return signatures.some((x) => equal(x, expected));
}

async function schema(env) {
  await ensurePurchaseabilitySchema(env.DB);
  await env.DB.batch([
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS medicine_inventory (variant_id INTEGER PRIMARY KEY,stock_on_hand INTEGER NOT NULL DEFAULT 0,reserved INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(variant_id) REFERENCES medicine_variants(id))`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS medicine_product_images (medicine_id INTEGER PRIMARY KEY,mime_type TEXT NOT NULL,image_base64 TEXT NOT NULL,alt_text TEXT NOT NULL,updated_by INTEGER,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(medicine_id) REFERENCES medicine_products(id))`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS medicine_orders (id INTEGER PRIMARY KEY AUTOINCREMENT,order_number TEXT NOT NULL UNIQUE,user_id INTEGER NOT NULL,email TEXT NOT NULL,medicine_id INTEGER NOT NULL,variant_id INTEGER NOT NULL,medicine_name TEXT NOT NULL,strength_label TEXT NOT NULL,unit_price_pence INTEGER NOT NULL,discount_code TEXT,discount_pence INTEGER NOT NULL DEFAULT 0,total_pence INTEGER NOT NULL,currency TEXT NOT NULL DEFAULT 'GBP',status TEXT NOT NULL DEFAULT 'pending',stripe_checkout_session_id TEXT UNIQUE,stripe_payment_intent_id TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS medicine_stripe_events (stripe_event_id TEXT PRIMARY KEY,event_type TEXT NOT NULL,received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,processed_at TEXT,processing_error TEXT)`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS medicine_prepay_verifications (token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL,variant_id INTEGER NOT NULL,partner_reference TEXT NOT NULL,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    ),
    env.DB.prepare(
      `CREATE TABLE IF NOT EXISTS medicine_clinical_intakes (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,variant_id INTEGER NOT NULL,public_reference TEXT NOT NULL UNIQUE,partner_reference TEXT NOT NULL UNIQUE,status TEXT NOT NULL DEFAULT 'submitted',gp_contact_consent INTEGER NOT NULL,consent_version TEXT NOT NULL,evidence_manifest_json TEXT NOT NULL,verification_issued_at TEXT,submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)`,
    ),
    env.DB.prepare(`CREATE TABLE IF NOT EXISTS medicine_intake_attempts (public_reference TEXT PRIMARY KEY,user_id INTEGER NOT NULL,variant_id INTEGER NOT NULL,submission_hash TEXT NOT NULL,payload_hash TEXT NOT NULL,state TEXT NOT NULL,partner_reference TEXT,consent_version TEXT NOT NULL,evidence_receipts_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,variant_id,submission_hash),FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)`),
  ]);
  await env.DB.prepare(`ALTER TABLE medicine_orders ADD COLUMN stripe_error_json TEXT`).run().catch(()=>{});
  await env.DB.prepare(`ALTER TABLE medicine_orders ADD COLUMN clinical_status TEXT NOT NULL DEFAULT 'not_started'`).run().catch(()=>{});
  await env.DB.prepare(`ALTER TABLE medicine_orders ADD COLUMN clinical_reason_code TEXT`).run().catch(()=>{});
  await env.DB.prepare(`ALTER TABLE medicine_orders ADD COLUMN clinical_updated_at TEXT`).run().catch(()=>{});
  await env.DB.prepare(`ALTER TABLE medicine_orders ADD COLUMN clinical_intake_submitted_at TEXT`).run().catch(()=>{});
  await env.DB.prepare(`ALTER TABLE medicine_orders ADD COLUMN journey_setup_required INTEGER NOT NULL DEFAULT 0`).run().catch(()=>{});
  await env.DB.prepare(`ALTER TABLE medicine_orders ADD COLUMN journey_setup_completed_at TEXT`).run().catch(()=>{});
  await env.DB.prepare(`ALTER TABLE medicine_orders ADD COLUMN reorder_of_order_id INTEGER`).run().catch(()=>{});
  await env.DB.prepare(`ALTER TABLE medicine_orders ADD COLUMN reorder_eligible_at TEXT`).run().catch(()=>{});
  await env.DB.prepare(`ALTER TABLE medicine_clinical_intakes ADD COLUMN public_reference TEXT`).run().catch(()=>{});
  await env.DB.prepare(`ALTER TABLE medicine_clinical_intakes ADD COLUMN verification_issued_at TEXT`).run().catch(()=>{});
  await env.DB.prepare(`ALTER TABLE medicine_clinical_intakes ADD COLUMN provider_patient_reference TEXT`).run().catch(()=>{});
  await env.DB.prepare(`ALTER TABLE medicine_clinical_intakes ADD COLUMN evidence_receipts_json TEXT NOT NULL DEFAULT '{}'`).run().catch(()=>{});
  await env.DB.prepare(`ALTER TABLE medicine_orders ADD COLUMN clinical_intake_reference TEXT`).run().catch(()=>{});
}

function formText(form, key, max = 1000) {
  return clean(form.get(key), max);
}
function clinicalFile(form, key) {
  const file = form.get(key);
  return file instanceof File && file.size > 0 ? file : null;
}
function validateClinicalFile(file, label) {
  if (!file) return `${label} is required.`;
  if (!CLINICAL_FILE_TYPES.has(String(file.type || "").toLowerCase())) return `${label} must be a JPEG, PNG or HEIC image.`;
  if (file.size > MAX_CLINICAL_FILE_BYTES) return `${label} must be smaller than 8 MB.`;
  return null;
}
// SHIFT service eligibility, not a general contraindication to GLP-1 treatment.
// Use the authoritative product form and a current answer on every request.
export function insulinEligibility(form, answer) {
  if (String(form || '').trim().toLowerCase() === 'tablet' || String(form || '').trim().toLowerCase() === 'capsule') return null;
  if (String(form || '').trim().toLowerCase() !== 'injection') return {error:'medicine_form_unconfirmed',status:409,message:'The treatment format needs confirming before this request can continue.'};
  if (answer === 'yes') return {error:'insulin_service_exclusion',status:422,message:'If you take insulin, you cannot use SHIFT’s weight-management injection service. Speak to the clinician who manages your diabetes about suitable options. Do not stop or reduce insulin to qualify.'};
  if (answer !== 'no') return {error:'insulin_answer_required',status:400,message:'Confirm whether you currently take insulin before continuing.'};
  return null;
}
export function bmiEligibility(item, assessment = {}) {
  const name=String(item?.name || '').toLowerCase();
  const standard=30,conditional=name.includes('orlistat')?28:27;
  if(!/mounjaro|wegovy|liraglutide|saxenda|foundayo|orlistat/.test(name))return {error:'eligibility_rules_unconfirmed',status:409,message:'The service criteria for this medicine need confirming before continuing.'};
  const height=Number(assessment.heightCm),weight=Number(assessment.weightKg);
  if(!Number.isFinite(height)||height<120||height>230||!Number.isFinite(weight)||weight<35||weight>320)return {error:'bmi_details_required',status:400,message:'Enter your current height and weight to complete SHIFT’s eligibility check.'};
  const bmi=weight/((height/100)**2);
  if(bmi<conditional || (bmi<standard && assessment.weightRelatedCondition==='no'))return {error:'bmi_service_exclusion',status:422,message:'Your BMI does not meet SHIFT’s criteria for this treatment. Explore wider health information at SHIFT Health or speak to your clinician about appropriate support. If you already use treatment, ask your prescriber about continuing care; do not change it yourself.'};
  if(bmi<standard && assessment.weightRelatedCondition!=='yes')return {error:'weight_related_condition_required',status:400,message:'Confirm whether you have a diagnosed weight-related condition. A prescriber must check whether it qualifies.'};
  return null;
}
// SHIFT's adult service boundary, not a medicine-specific prescribing decision.
// Validate the calendar date itself: Date.parse alone silently rolls invalid days.
export function adultServiceEligibility(dateOfBirth, referenceTime = new Date()) {
  const value = typeof dateOfBirth === 'string' ? dateOfBirth : '';
  const invalid = {error:'date_of_birth_invalid',status:400,message:'Enter a valid date of birth in the past.'};
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return invalid;
  const birth = new Date(value + 'T00:00:00Z');
  if (!Number.isFinite(birth.getTime()) || birth.toISOString().slice(0,10) !== value || value.slice(0,4) === '0000') return invalid;
  const parts = new Intl.DateTimeFormat('en-GB',{timeZone:'Europe/London',year:'numeric',month:'2-digit',day:'2-digit'}).formatToParts(referenceTime);
  const part = type => parts.find(p => p.type === type).value;
  const today = `${part('year')}-${part('month')}-${part('day')}`;
  if (value >= today) return invalid;
  const age = Number(today.slice(0,4)) - Number(value.slice(0,4)) - (today.slice(5) < value.slice(5) ? 1 : 0);
  if (age < 18) return {error:'adult_service_required',status:422,message:'SHIFT’s treatment assessment service is for adults aged 18 or over. Speak to your GP about appropriate support.'};
  return null;
}
const CLINICAL_INTAKE_FIELDS = [
  "dateOfBirth","heightCm","weightKg","weightRelatedCondition","conditions","medicines",
  "previousTreatment","previousMedicine","previousDose","lastDoseDate",
  "gpName","gpPractice","gpAddress","gpPostcode","gpPhone","nhsNumber",
];
function validatedIntakeAnswers(form) {
  const fields = {};
  const previousTreatment = String(form.get("previousTreatment") ?? "").trim();
  for (const key of CLINICAL_INTAKE_FIELDS) {
    if (previousTreatment === "no" && ["previousMedicine","previousDose","lastDoseDate"].includes(key)) { fields[key] = ""; continue; }
    const value = String(form.get(key) ?? "").trim();
    if (value.length > 1000) return {error:"clinical_answer_too_long",message:"An answer exceeds the 1,000-character limit. No information has been sent. Do not omit relevant information to make it fit; the pharmacy team needs the full details.",field:key};
    fields[key] = value;
  }
  const required = ["dateOfBirth","heightCm","weightKg","weightRelatedCondition","conditions","medicines","gpName","gpPractice","gpAddress","gpPostcode"];
  if (required.some(key => !fields[key])) return {error:"incomplete_clinical_form",message:"Complete every required clinical and GP field."};
  if (!["yes","no"].includes(previousTreatment)) return {error:"previous_treatment_answer_required",message:"Confirm whether you have used weight-loss medicine before."};
  if (!["yes","no"].includes(fields.weightRelatedCondition)) return {error:"weight_related_condition_required",message:"Confirm whether you have a diagnosed weight-related condition."};
  if (previousTreatment === "yes") {
    if (["previousMedicine","previousDose","lastDoseDate"].some(key => !fields[key])) return {error:"previous_treatment_details_required",message:"Enter the previous medicine, dose and last dose date."};
    const value = fields.lastDoseDate, date = new Date(value + "T00:00:00Z");
    const parts = new Intl.DateTimeFormat("en-GB",{timeZone:"Europe/London",year:"numeric",month:"2-digit",day:"2-digit"}).formatToParts(new Date());
    const part = type => parts.find(p => p.type === type).value;
    const today = `${part('year')}-${part('month')}-${part('day')}`;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(date.getTime()) || date.toISOString().slice(0,10) !== value || value.slice(0,4) === "0000" || value > today)
      return {error:"last_dose_date_invalid",message:"Enter a real last dose date that is not in the future."};
  }
  return {fields};
}
async function clinicalIntake(request, env) {
  const user = await member(request, env);
  if (!user) return json({ok:false,error:"account_required"},401,cors(request));
  if (Number(user.email_verified || 0) !== 1) return json({ok:false,error:"email_verification_required"},403,cors(request));
  if (!env.PHARMACY_CLINICAL_INTAKE_URL || !env.PHARMACY_INTEGRATION_SECRET)
    return json({ok:false,error:"clinical_intake_not_configured",message:"Clinical assessment is not open yet."},503,cors(request));
  await schema(env);
  let form;
  try { form = await request.formData(); } catch { return json({ok:false,error:"invalid_clinical_form"},400,cors(request)); }
  const allowedFields=new Set([...CLINICAL_INTAKE_FIELDS,'variantId','insulinUse','gpContactConsent','answersConfirmed','imageConsent','photoId','bodyFront','bodySide','submissionId','patientFirstName','patientLastName','patientPhone','patientAddress1','patientAddress2','patientTown','patientPostcode']);
  if([...form.keys()].some(key=>!allowedFields.has(key)||form.getAll(key).length!==1))return json({ok:false,error:'unexpected_or_duplicate_answer',message:'The assessment contains an unknown or repeated field. Nothing has been sent; reload the current form before submitting.'},400,cors(request));
  const variantId = Number(form.get("variantId"));
  const item = Number.isInteger(variantId) && variantId > 0 ? await env.DB.prepare(`SELECT v.id,m.form,m.name,v.strength_label,v.status variant_status,v.sellable variant_sellable,v.partner variant_partner,v.availability_state variant_availability,m.status medicine_status,m.sellable medicine_sellable,m.partner medicine_partner,m.availability_state medicine_availability,COALESCE(i.stock_on_hand,0) stock_on_hand,COALESCE(i.reserved,0) reserved FROM medicine_variants v JOIN medicine_products m ON m.id=v.medicine_id LEFT JOIN medicine_inventory i ON i.variant_id=v.id WHERE v.id=?`).bind(variantId).first() : null;
  const eligibility = item && (insulinEligibility(item.form, form.get('insulinUse')) || bmiEligibility(item,Object.fromEntries(['heightCm','weightKg','weightRelatedCondition'].map(key=>[key,form.get(key)]))));
  if (eligibility) return json({ok:false,error:eligibility.error,message:eligibility.message},eligibility.status,cors(request));
  const itemTruth=item?authoritativePurchaseability({product:{status:item.medicine_status,sellable:item.medicine_sellable,partner:item.medicine_partner,availability_state:item.medicine_availability},variant:{status:item.variant_status,sellable:item.variant_sellable,partner:item.variant_partner,availability_state:item.variant_availability},inventory:{stock_on_hand:item.stock_on_hand,reserved:item.reserved}}):null;
  if (!itemTruth?.canBuy) return json({ok:false,error:"out_of_stock",message:"Currently out of stock. No clinical evidence has been sent."},409,cors(request));
  const ageEligibility = adultServiceEligibility(form.get('dateOfBirth'));
  if (ageEligibility) return json({ok:false,error:ageEligibility.error,message:ageEligibility.message},ageEligibility.status,cors(request));
  const answers = validatedIntakeAnswers(form);
  if (answers.error) return json({ok:false,...answers},400,cors(request));
  const gpConsent = form.get("gpContactConsent") === "on";
  const accuracyConsent = form.get("answersConfirmed") === "on";
  const imageConsent = form.get("imageConsent") === "on";
  if (!gpConsent || !accuracyConsent || !imageConsent) return json({ok:false,error:"consent_required",message:"All clinical confirmations are required before submission."},400,cors(request));
  const files = {photoId:clinicalFile(form,"photoId"),bodyFront:clinicalFile(form,"bodyFront"),bodySide:clinicalFile(form,"bodySide")};
  for (const [key,label] of [["photoId","Photo ID"],["bodyFront","Front image"],["bodySide","Side image"]]) {
    const error = validateClinicalFile(files[key],label); if (error) return json({ok:false,error:"invalid_evidence",message:error},400,cors(request));
  }
  const patient = {};
  for (const [key,max] of Object.entries({patientFirstName:100,patientLastName:100,patientPhone:50,patientAddress1:120,patientAddress2:120,patientTown:100,patientPostcode:12})) {
    const value=String(form.get(key)??'').trim();
    if(value.length>max||/[\u0000-\u001f\u007f]/.test(value))return json({ok:false,error:'patient_details_invalid',field:key,message:'Check your contact details. Nothing has been sent.'},400,cors(request));
    patient[key]=value;
  }
  // Existing account identity is transmitted explicitly; editable contact details
  // are purpose-labelled. Partner-required fields remain an admission dependency.
  if(!form.has('patientFirstName'))patient.patientFirstName=user.first_name||'';
  if(!form.has('patientLastName'))patient.patientLastName=user.last_name||'';
  patient.patientEmail = user.email;
  const missingContact=['patientFirstName','patientLastName','patientPhone','patientAddress1','patientTown','patientPostcode'].find(key=>!patient[key]);
  if(missingContact)return json({ok:false,error:'patient_details_required',field:missingContact,message:'Complete your name, phone and address so the pharmacy can identify and contact you.'},400,cors(request));
  if(!/^\+?[\d ()\-.]{6,50}$/.test(patient.patientPhone))return json({ok:false,error:'patient_phone_invalid',field:'patientPhone',message:'Check your phone number.'},400,cors(request));
  const receipts=await evidenceReceipts(files),payloadHash=await digest(JSON.stringify({variantId,answers:answers.fields,patient,receipts,consentVersion:CLINICAL_CONSENT_VERSION}));
  const suppliedId=String(form.get('submissionId')??'');
  if(suppliedId&&!/^[a-f0-9-]{36}$/i.test(suppliedId))return json({ok:false,error:'invalid_submission_reference'},400,cors(request));
  const submissionHash=await digest(suppliedId||payloadHash),submittedAt=now(),publicReference=`SCI-${crypto.randomUUID()}`;
  const existing=await env.DB.prepare(`SELECT * FROM medicine_intake_attempts WHERE user_id=? AND variant_id=? AND submission_hash=?`).bind(user.id,variantId,submissionHash).first();
  if(existing)return existingIntakeAttempt(request,env,user,existing,payloadHash);
  // Validate configuration before claiming/sending; a broken endpoint never gets credentials.
  try{pharmacyEndpoint(env.PHARMACY_CLINICAL_INTAKE_URL);}catch{return json({ok:false,error:'pharmacy_configuration_invalid',message:'The secure pharmacy connection is unavailable. Your answers have not been sent.'},503,cors(request));}
  const claimed=await env.DB.prepare(`INSERT INTO medicine_intake_attempts(public_reference,user_id,variant_id,submission_hash,payload_hash,state,consent_version,evidence_receipts_json,created_at,updated_at) VALUES(?,?,?,?,?,'sending',?,?,?,?) ON CONFLICT(user_id,variant_id,submission_hash) DO NOTHING`).bind(publicReference,user.id,variantId,submissionHash,payloadHash,CLINICAL_CONSENT_VERSION,JSON.stringify(receipts),submittedAt,submittedAt).run();
  if(Number(claimed.meta?.changes||0)!==1){
    const current=await env.DB.prepare(`SELECT * FROM medicine_intake_attempts WHERE user_id=? AND variant_id=? AND submission_hash=?`).bind(user.id,variantId,submissionHash).first();
    return current?existingIntakeAttempt(request,env,user,current,payloadHash):json({ok:false,error:'submission_busy'},409,cors(request));
  }
  const partnerForm = new FormData();
  partnerForm.set("memberReference",String(user.id)); partnerForm.set("variantId",String(variantId)); partnerForm.set("journeyStage","prepay_verification");
  partnerForm.set('clientReference',publicReference);partnerForm.set('contractVersion',HANDOVER_VERSION);
  partnerForm.set('medicineName',item.name);partnerForm.set('strengthLabel',item.strength_label||'');
  partnerForm.set('providerReference',item.variant_partner||item.medicine_partner||'');
  for(const [key,value]of Object.entries(patient))partnerForm.set(key,value);
  if (item.form === 'injection') partnerForm.set('insulinUse','no');
  for (const [key,value] of Object.entries(answers.fields)) partnerForm.set(key,value);
  partnerForm.set("gpContactConsent","true"); partnerForm.set("answersConfirmed","true"); partnerForm.set("imageConsent","true"); partnerForm.set("consentVersion",CLINICAL_CONSENT_VERSION);
  partnerForm.set('consentRecordedAt',submittedAt);partnerForm.set('evidenceReceipts',JSON.stringify(receipts));
  for (const [key,file] of Object.entries(files)) partnerForm.set(key,file,key+({"image/jpeg":'.jpg',"image/png":'.png',"image/heic":'.heic',"image/heif":'.heif'}[file.type]||'.image'));
  try{
    const partner=acceptedReceipt(await pharmacyRequest(env,env.PHARMACY_CLINICAL_INTAKE_URL,partnerForm,publicReference));
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO medicine_clinical_intakes(user_id,variant_id,public_reference,partner_reference,status,gp_contact_consent,consent_version,evidence_manifest_json,evidence_receipts_json,provider_patient_reference,submitted_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(public_reference) DO NOTHING`).bind(user.id,variantId,publicReference,partner.reference,partner.status,1,CLINICAL_CONSENT_VERSION,JSON.stringify({photoId:true,bodyFront:true,bodySide:true}),JSON.stringify(receipts),partner.patientReference,submittedAt,submittedAt),
      env.DB.prepare(`UPDATE medicine_intake_attempts SET state='accepted',partner_reference=?,updated_at=? WHERE public_reference=?`).bind(partner.reference,now(),publicReference),
    ]);
    const recorded=await env.DB.prepare('SELECT partner_reference,provider_patient_reference FROM medicine_clinical_intakes WHERE public_reference=? AND user_id=?').bind(publicReference,user.id).first();
    if(recorded&&(recorded.partner_reference!==partner.reference||recorded.provider_patient_reference!==partner.patientReference))throw new PharmacyTransportError('pharmacy_receipt_mismatch',true);
    return intakeView(request,env,user,{public_reference:publicReference,variant_id:variantId,partner_reference:partner.reference,provider_patient_reference:partner.patientReference,status:partner.status});
  }catch(error){
    // An accepted request with a lost response is never silently sent a second time.
    await env.DB.prepare(`UPDATE medicine_intake_attempts SET state='delivery_unconfirmed',updated_at=? WHERE public_reference=? AND state='sending'`).bind(now(),publicReference).run();
    return json({ok:false,error:'clinical_delivery_unconfirmed',intakeReference:publicReference,status:'delivery_unconfirmed',message:'The pharmacy receipt has not been confirmed. No payment has been taken. Check this assessment again; do not start another submission.'},503,cors(request));
  }
}

async function existingIntakeAttempt(request,env,user,attempt,payloadHash){
  if(attempt.payload_hash!==payloadHash)return json({ok:false,error:'submission_content_changed',intakeReference:attempt.public_reference,message:'This submission reference belongs to different answers. Check its status before starting another assessment.'},409,cors(request));
  if(attempt.state==='accepted'){
    const intake=await env.DB.prepare(`SELECT * FROM medicine_clinical_intakes WHERE public_reference=? AND user_id=?`).bind(attempt.public_reference,user.id).first();
    if(intake)return intakeView(request,env,user,intake);
  }
  return json({ok:true,accepted:false,verified:false,intakeReference:attempt.public_reference,status:attempt.state,message:'This assessment is already being sent or its receipt needs checking. No duplicate has been sent.'},202,cors(request));
}
async function intakeView(request,env,user,intake){
  const common={ok:true,accepted:true,verified:false,intakeReference:intake.public_reference,variantId:Number(intake.variant_id),status:intake.status,canResume:Boolean(env.PHARMACY_CLINICAL_RESUME_URL&&env.PHARMACY_PORTAL_ORIGIN),prescribingApproved:false};
  if(intake.status!=='verified')return json({...common,nextStep:intake.status==='more_information_required'?'secure_pharmacy_questions':intake.status==='declined'?'clinical_decision':'verification_review'},intake.status==='submitted'?202:200,cors(request));
  if(!intake.provider_patient_reference)return json({...common,error:'provider_patient_reference_required',message:'The pharmacy must confirm your patient reference before payment can open.'},409,cors(request));
  // Once consumed, reopening cannot mint a fresh payment authorisation.
  const consumed=await env.DB.prepare(`SELECT token_hash FROM medicine_prepay_verifications WHERE user_id=? AND variant_id=? AND partner_reference=? AND used_at IS NOT NULL`).bind(user.id,intake.variant_id,intake.partner_reference).first();
  if(consumed)return json({...common,status:'payment_started',nextStep:'my_timber'},200,cors(request));
  const token=crypto.randomUUID()+crypto.randomUUID(),expiresAt=new Date(Date.now()+30*60*1000).toISOString(),stamp=now();
  await env.DB.batch([env.DB.prepare(`INSERT INTO medicine_prepay_verifications(token_hash,user_id,variant_id,partner_reference,expires_at,created_at) VALUES(?,?,?,?,?,?)`).bind(await sha256(token),user.id,intake.variant_id,intake.partner_reference,expiresAt,stamp),env.DB.prepare(`UPDATE medicine_clinical_intakes SET verification_issued_at=?,updated_at=? WHERE public_reference=? AND user_id=?`).bind(stamp,stamp,intake.public_reference,user.id)]);
  return json({...common,verified:true,verificationToken:token,expiresAt,nextStep:'payment'},200,cors(request));
}
async function clinicalIntakeStatus(request, env) {
  const user=await member(request,env);if(!user)return json({ok:false,error:'unauthorised'},401,cors(request));
  await schema(env);const params=new URL(request.url).searchParams,reference=params.get('reference'),variantId=Number(params.get('variant'));
  if(reference&&(!/^SCI-[a-f0-9-]{36}$/i.test(reference)))return json({ok:false,error:'invalid_intake_reference'},400,cors(request));
  let intake;
  if(reference)intake=await env.DB.prepare(`SELECT * FROM medicine_clinical_intakes WHERE public_reference=? AND user_id=?`).bind(reference,user.id).first();
  else if(Number.isInteger(variantId)&&variantId>0)intake=await env.DB.prepare(`SELECT * FROM medicine_clinical_intakes WHERE variant_id=? AND user_id=? ORDER BY id DESC LIMIT 1`).bind(variantId,user.id).first();
  else return json({ok:false,error:'invalid_intake_reference'},400,cors(request));
  if(intake)return intakeView(request,env,user,intake);
  const attempt=reference?await env.DB.prepare(`SELECT * FROM medicine_intake_attempts WHERE public_reference=? AND user_id=?`).bind(reference,user.id).first():await env.DB.prepare(`SELECT * FROM medicine_intake_attempts WHERE variant_id=? AND user_id=? ORDER BY created_at DESC LIMIT 1`).bind(variantId,user.id).first();
  if(attempt)return json({ok:true,verified:false,intakeReference:attempt.public_reference,variantId:Number(attempt.variant_id),status:attempt.state,canResume:false,prescribingApproved:false},200,cors(request));
  return json({ok:false,error:'intake_not_found'},404,cors(request));
}
const INTAKE_TRANSITIONS={submitted:new Set(['more_information_required','verified','declined']),more_information_required:new Set(['submitted','verified','declined']),verified:new Set([]),declined:new Set([])};
async function pharmacyClinicalIntakeStatus(request,env){
  if(!env.PHARMACY_INTEGRATION_SECRET)return json({ok:false,error:'integration_not_configured'},503);
  const supplied=String(request.headers.get('authorization')||'').replace(/^Bearer\s+/i,'');
  if(!supplied||(await sha256(supplied))!==(await sha256(String(env.PHARMACY_INTEGRATION_SECRET))))return json({ok:false,error:'unauthorised'},401);
  await schema(env);const input=await body(request);
  let partnerReference,patientReference;try{partnerReference=externalReference(input?.partnerReference);patientReference=externalReference(input?.patientReference,false);}catch{return json({ok:false,error:'invalid_intake_status'},400);}
  const status=input?.status;
  if(!INTAKE_TRANSITIONS[status])return json({ok:false,error:'invalid_intake_status'},400);
  let intake=await env.DB.prepare(`SELECT * FROM medicine_clinical_intakes WHERE partner_reference=?`).bind(partnerReference).first();
  if(!intake&&/^SCI-[a-f0-9-]{36}$/i.test(input?.clientReference||'')){
    const attempt=await env.DB.prepare(`SELECT * FROM medicine_intake_attempts WHERE public_reference=?`).bind(input.clientReference).first();
    if(attempt&&['sending','delivery_unconfirmed'].includes(attempt.state)){
      if(status==='verified'&&!patientReference)return json({ok:false,error:'provider_patient_reference_required'},400);
      const stamp=now();
      await env.DB.batch([
        env.DB.prepare(`INSERT INTO medicine_clinical_intakes(user_id,variant_id,public_reference,partner_reference,status,gp_contact_consent,consent_version,evidence_manifest_json,evidence_receipts_json,provider_patient_reference,submitted_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(public_reference) DO NOTHING`).bind(attempt.user_id,attempt.variant_id,attempt.public_reference,partnerReference,status,1,attempt.consent_version,JSON.stringify({photoId:true,bodyFront:true,bodySide:true}),attempt.evidence_receipts_json,patientReference,attempt.created_at,stamp),
        env.DB.prepare(`UPDATE medicine_intake_attempts SET state='accepted',partner_reference=?,updated_at=? WHERE public_reference=? AND state IN ('sending','delivery_unconfirmed')`).bind(partnerReference,stamp,attempt.public_reference),
      ]);
      intake=await env.DB.prepare(`SELECT * FROM medicine_clinical_intakes WHERE public_reference=?`).bind(attempt.public_reference).first();
    }
  }
  if(!intake)return json({ok:false,error:'intake_not_found'},404);
  if(input?.clientReference&&input.clientReference!==intake.public_reference)return json({ok:false,error:'intake_reference_mismatch'},409);
  if(patientReference&&intake.provider_patient_reference&&patientReference!==intake.provider_patient_reference)return json({ok:false,error:'patient_reference_mismatch'},409);
  if(status==='verified'&&!(patientReference||intake.provider_patient_reference))return json({ok:false,error:'provider_patient_reference_required'},400);
  if(intake.status===status)return json({ok:true,status,duplicate:true});
  if(!INTAKE_TRANSITIONS[intake.status]?.has(status))return json({ok:false,error:'invalid_intake_transition'},409);
  const stamp=now(),result=await env.DB.prepare(`UPDATE medicine_clinical_intakes SET status=?,provider_patient_reference=COALESCE(provider_patient_reference,?),updated_at=? WHERE id=? AND status=?`).bind(status,patientReference,stamp,intake.id,intake.status).run();
  if(Number(result.meta?.changes||0)!==1)return json({ok:false,error:'intake_changed_retry_status'},409);
  return json({ok:true,status});
}
async function clinicalResume(request,env){
  const user=await member(request,env);if(!user)return json({ok:false,error:'unauthorised'},401,cors(request));
  if(!env.PHARMACY_CLINICAL_RESUME_URL||!env.PHARMACY_PORTAL_ORIGIN)return json({ok:false,error:'secure_pharmacy_route_unavailable',message:'The secure pharmacy questions route is not available yet. Your existing assessment is unchanged; do not submit a new one.'},503,cors(request));
  await schema(env);const input=await body(request);let reference=input?.intakeReference;
  if(input?.orderNumber){
    const order=await env.DB.prepare(`SELECT clinical_intake_reference FROM medicine_orders WHERE order_number=? AND user_id=?`).bind(String(input.orderNumber),user.id).first();
    if(!order)return json({ok:false,error:'order_not_found'},404,cors(request));reference=order.clinical_intake_reference;
  }
  const intake=await env.DB.prepare(`SELECT * FROM medicine_clinical_intakes WHERE public_reference=? AND user_id=?`).bind(String(reference||''),user.id).first();
  if(!intake)return json({ok:false,error:'intake_not_found'},404,cors(request));
  try{
    const result=await pharmacyRequest(env,env.PHARMACY_CLINICAL_RESUME_URL,{clientReference:intake.public_reference,partnerReference:intake.partner_reference,patientReference:intake.provider_patient_reference,purpose:'assessment_clarification'},crypto.randomUUID());
    if(result.reference!==intake.partner_reference||result.patientReference!==intake.provider_patient_reference)throw new PharmacyTransportError('pharmacy_resume_invalid');
    const expiresAt=Date.parse(result.expiresAt);
    if(!Number.isFinite(expiresAt)||expiresAt<=Date.now()||expiresAt>Date.now()+5*60*1000)throw new PharmacyTransportError('pharmacy_resume_invalid');
    const resumeUrl=secureResumeUrl(result.resumeUrl,env.PHARMACY_PORTAL_ORIGIN);
    return json({ok:true,resumeUrl,expiresAt:result.expiresAt},200,cors(request));
  }catch{return json({ok:false,error:'secure_pharmacy_route_unavailable',message:'The secure pharmacy questions route could not open. Your existing assessment is unchanged. Try this assessment again later.'},503,cors(request));}
}

async function clinicalContext(request,env){
  const user=await member(request,env);if(!user)return json({ok:false,error:'account_required'},401,cors(request));
  return json({ok:true,accountReference:await sha256('clinical-account:'+user.id),emailVerified:Number(user.email_verified||0)===1,patientFirstName:user.first_name||'',patientLastName:user.last_name||'',patientEmail:user.email,assessmentAvailable:Boolean(env.PHARMACY_CLINICAL_INTAKE_URL&&env.PHARMACY_INTEGRATION_SECRET)},200,cors(request));
}

async function prepayVerification(request, env) {
  const user = await member(request, env);
  if (!user) return json({ok:false,error:"account_required"},401,cors(request));
  if (Number(user.email_verified || 0) !== 1)
    return json({ok:false,error:"email_verification_required"},403,cors(request));
  if (!env.PHARMACY_PREPAY_VERIFICATION_URL || !env.PHARMACY_INTEGRATION_SECRET)
    return json({ok:false,error:"verification_not_configured",message:"Clinical verification is not open yet."},503,cors(request));
  await schema(env);
  const input=await body(request),variantId=Number(input?.variantId);
  if (!Number.isInteger(variantId)||variantId<1||!input?.assessment)
    return json({ok:false,error:"invalid_verification_request"},400,cors(request));
  const item=await env.DB.prepare(`SELECT v.id,m.form,m.name,v.strength_label,v.status variant_status,v.sellable variant_sellable,v.partner variant_partner,v.availability_state variant_availability,m.status medicine_status,m.sellable medicine_sellable,m.partner medicine_partner,m.availability_state medicine_availability,COALESCE(i.stock_on_hand,0) stock_on_hand,COALESCE(i.reserved,0) reserved FROM medicine_variants v JOIN medicine_products m ON m.id=v.medicine_id LEFT JOIN medicine_inventory i ON i.variant_id=v.id WHERE v.id=?`).bind(variantId).first();
  const eligibility = item && (insulinEligibility(item.form, input.assessment.insulinUse) || bmiEligibility(item,input.assessment));
  if (eligibility) return json({ok:false,error:eligibility.error,message:eligibility.message},eligibility.status,cors(request));
  const itemTruth=item?authoritativePurchaseability({product:{status:item.medicine_status,sellable:item.medicine_sellable,partner:item.medicine_partner,availability_state:item.medicine_availability},variant:{status:item.variant_status,sellable:item.variant_sellable,partner:item.variant_partner,availability_state:item.variant_availability},inventory:{stock_on_hand:item.stock_on_hand,reserved:item.reserved}}):null;
  if (!itemTruth?.canBuy) return json({ok:false,error:"out_of_stock",message:"Currently out of stock."},409,cors(request));
  const ageEligibility = adultServiceEligibility(input.assessment.dateOfBirth);
  if (ageEligibility) return json({ok:false,error:ageEligibility.error,message:ageEligibility.message},ageEligibility.status,cors(request));
  return json({ok:false,error:'complete_clinical_intake_required',nextStep:'clinical_intake',message:'Continue the complete secure assessment before payment. This older verification route cannot replace the required answers, consent and evidence.'},409,cors(request));
}

function journeyComplete(preferences) {
  let parsed = {}, journey = {}, wholeMan = {};
  try { parsed = JSON.parse(preferences || "{}"); journey = parsed.myJourney || {}; wholeMan = parsed.wholeMan || {}; } catch {}
  const setup = journey.setup || {}, weight = journey.weight || {};
  const priorities = journey.lifeBack?.priorities || wholeMan.lifeBackPriorities || wholeMan.life_back_priorities || [];
  const direction = setup.targetMode === "maintenance"
    ? Number(weight.maintenanceLowKg) >= 25 && Number(weight.maintenanceHighKg) >= Number(weight.maintenanceLowKg)
    : Number(weight.targetKg) >= 25;
  return Boolean(/^\d{4}-\d{2}-\d{2}$/.test(String(setup.startDate || "")) && Number(weight.startKg) >= 25 && Number(weight.currentKg) >= 25 && direction && Array.isArray(priorities) && priorities.length >= 1 && priorities.length <= 2);
}

function memberTreatmentView(order, setupComplete) {
  const clinicalStatus = order.clinical_status || "not_started";
  const clarificationRequired = clinicalStatus === 'more_information_required';
  const clinicalIntakeRequired = order.status === "paid" && !clarificationRequired && clinicalStatus === "assessment_pending" && !order.clinical_intake_submitted_at;
  const setupRequired = Boolean(Number(order.journey_setup_required)) && ["approved", "dispensing", "dispatched", "fulfilled"].includes(clinicalStatus) && !setupComplete;
  const copy = {
    not_started: ["Payment not confirmed", "Your clinical assessment starts after payment is confirmed."],
    assessment_pending: clinicalIntakeRequired ? ["Clinical checks required", "Complete the compulsory health, GP, ID and body-image checks so the pharmacy partner can review your order."] : ["Clinical assessment in progress", "The pharmacy partner has your information and is reviewing it. My Shift will show the outcome here."],
    more_information_required: ["The clinical team needs more information", "Open the secure pharmacy questions for this assessment. Your earlier submission stays attached; no new assessment or payment is needed."],
    approved: setupRequired ? ["Approved — set up My Journey", "Take two minutes to set your starting point before ongoing support and reordering open."] : ["Treatment approved", "Weekly support is ready in My Timber."],
    declined: ["Treatment not approved", "The clinical team decided this treatment is not suitable. Refund progress will appear here."],
    refund_pending: ["Refund being processed", "The payment is being returned through the original payment method."],
    refunded: ["Refund completed", "The payment has been returned through the original payment method."],
    dispensing: ["Approved and being prepared", "The pharmacy is preparing your treatment."],
    dispatched: ["Treatment dispatched", "Your treatment is on the way."],
    fulfilled: ["Treatment delivered", "Keep the weekly My Journey check-in going; reorder opens only when eligible."],
  }[clinicalStatus] || ["Treatment update", "Your latest treatment status is shown here."];
  return {
    orderNumber: order.order_number,
    variantId: Number(order.variant_id),
    medicineName: order.medicine_name,
    strengthLabel: order.strength_label,
    totalPence: Number(order.total_pence),
    currency: order.currency,
    paymentStatus: order.status,
    clinicalStatus,
    headline: copy[0],
    message: copy[1],
    reasonCode: order.clinical_reason_code || null,
    journeySetupRequired: setupRequired,
    clinicalIntakeRequired,
    clarificationRequired,
    journeySetupComplete: setupComplete,
    reorderEligibleAt: order.reorder_eligible_at || null,
    canReorder: setupComplete && clinicalStatus === "fulfilled" && Boolean(order.reorder_eligible_at) && Number.isFinite(Date.parse(order.reorder_eligible_at)) && Date.parse(order.reorder_eligible_at) <= Date.now(),
    createdAt: order.created_at,
    updatedAt: order.updated_at,
  };
}

export async function reconcileExpiredReservations(env) {
  // Age is a signal to check, not evidence that Stripe cannot still take payment.
  if(!env.STRIPE_SECRET_KEY)return 0;
  const {results=[]}=await env.DB.prepare(`SELECT id,order_number,variant_id,stripe_checkout_session_id FROM medicine_orders WHERE status IN ('pending','checkout_open') AND created_at<? ORDER BY id LIMIT 20`).bind(new Date(Date.now()-40*60*1000).toISOString()).all();
  let count=0;
  for(const order of results){
    if(!order.stripe_checkout_session_id)continue;
    let session;
    try{const response=await fetch('https://api.stripe.com/v1/checkout/sessions/'+encodeURIComponent(order.stripe_checkout_session_id),{headers:{authorization:`Bearer ${env.STRIPE_SECRET_KEY}`},signal:AbortSignal.timeout(8000)});if(!response.ok)continue;session=await response.json()}catch{continue}
    if(session.id!==order.stripe_checkout_session_id||session.status!=='expired'||session.payment_status==='paid')continue;
    await ensureOrderReferenceRegistry(env.DB);await ensureCheckoutAttempts(env.DB);
    const date=now(),condition="EXISTS(SELECT 1 FROM medicine_orders WHERE id=? AND status IN ('pending','checkout_open'))";
    const result=await env.DB.batch([
      env.DB.prepare(`UPDATE medicine_inventory SET reserved=MAX(0,reserved-1),updated_at=? WHERE variant_id=? AND ${condition}`).bind(date,order.variant_id,order.id),
      env.DB.prepare(`UPDATE order_reference_registry SET status='expired',updated_at=? WHERE order_number=? AND ${condition}`).bind(date,order.order_number,order.id),
      env.DB.prepare(`UPDATE checkout_attempts SET active=0,state='expired',updated_at=? WHERE order_number=? AND ${condition}`).bind(date,order.order_number,order.id),
      env.DB.prepare("UPDATE medicine_orders SET status='expired',updated_at=? WHERE id=? AND status IN ('pending','checkout_open')").bind(date,order.id)
    ]);count+=Number(result[3]?.meta?.changes||0);
  }
  return count;
}

async function catalogue(env) {
  await schema(env);
  const rows =
    (
      await env.DB.prepare(
        `SELECT m.id medicine_id,m.name,m.active_ingredient,m.form,m.description,m.status medicine_status,m.sellable medicine_sellable,m.partner medicine_partner,m.availability_state medicine_availability,mi.alt_text image_alt,mi.updated_at image_updated_at,CASE WHEN mi.medicine_id IS NULL THEN 0 ELSE 1 END has_image,v.id variant_id,v.strength_label,v.selling_price_pence,v.status variant_status,v.sellable variant_sellable,v.partner variant_partner,v.availability_state variant_availability,COALESCE(i.stock_on_hand,0) stock_on_hand,COALESCE(i.reserved,0) reserved FROM medicine_products m JOIN medicine_variants v ON v.medicine_id=m.id LEFT JOIN medicine_inventory i ON i.variant_id=v.id LEFT JOIN medicine_product_images mi ON mi.medicine_id=m.id WHERE m.status NOT IN ('draft','archived') AND v.status!='archived' ORDER BY m.sort_order,m.name,v.sort_order,v.id`,
      ).all()
    ).results || [];
  const products = [];
  for (const row of rows) {
    const medicineName = String(row.name || "").trim().toLowerCase();
    const originalLabel = String(row.strength_label || "").trim();
    const strengthLabel = medicineName === "orlistat" && /^\d+$/.test(originalLabel)
      ? `120 mg · ${originalLabel} capsules`
      : medicineName === "liraglutide" && /^3(?:\.0)?(?:\s*mg)?$/i.test(originalLabel)
        ? "3.0 mg"
        : medicineName === "liraglutide" && /^\d(?:\.\d)?(?:\s*mg)?$/i.test(originalLabel)
          ? `${originalLabel.replace(/\s*mg$/i, "")} mg`
          : originalLabel;
    let product = products.find((x) => x.id === row.medicine_id);
    if (!product) {
      product = {
        id: row.medicine_id,
        name: row.name,
        activeIngredient: row.active_ingredient,
        form: row.form,
        description: row.description,
        status: row.medicine_status,
        imageUrl: row.has_image ? `/v1/catalogue/medicine-images/${row.medicine_id}?v=${encodeURIComponent(row.image_updated_at || "")}` : "",
        imageAlt: row.image_alt || "",
        variants: [],
      };
      products.push(product);
    }
    const remaining = Math.max(
      0,
      Number(row.stock_on_hand) - Number(row.reserved),
    );
    const duplicate = product.variants.find(
      (variant) => variant.strengthLabel.toLowerCase() === strengthLabel.toLowerCase(),
    );
    if (duplicate) continue;
    product.variants.push({
      id: row.variant_id,
      strengthLabel,
      pricePence: Number(row.selling_price_pence),
      status: authoritativePurchaseability({product:{status:row.medicine_status,sellable:row.medicine_sellable,partner:row.medicine_partner,availability_state:row.medicine_availability},variant:{status:row.variant_status,sellable:row.variant_sellable,partner:row.variant_partner,availability_state:row.variant_availability},inventory:{stock_on_hand:row.stock_on_hand,reserved:row.reserved}}).canBuy ? "available" : "out_of_stock",
      remaining,
    });
  }
  return products;
}

async function discount(env, code, subtotal) {
  const key = clean(code, 60).toUpperCase();
  if (!key) return { code: "", amount: 0 };
  const row = await env.DB.prepare(
    `SELECT * FROM commerce_discount_codes WHERE upper(code)=? AND active=1`,
  )
    .bind(key)
    .first()
    .catch(() => null);
  const stamp = Date.now();
  if (
    !row ||
    (row.starts_at && Date.parse(row.starts_at) > stamp) ||
    (row.ends_at && Date.parse(row.ends_at) < stamp) ||
    Number(row.minimum_subtotal_pence || 0) > subtotal
  )
    return null;
  const amount =
    row.discount_type === "percent"
      ? Math.floor((subtotal * Math.min(100, Number(row.discount_value))) / 100)
      : Math.min(subtotal, Number(row.discount_value));
  return { code: key, amount: Math.max(0, amount) };
}

function stripeForm(order, item, user, env) {
  const form = new URLSearchParams(),
    put = (k, v) => form.append(k, String(v));
  put("mode", "payment");
  put("expires_at", Math.floor(Date.now() / 1000) + 30 * 60);
  put("payment_method_types[0]", "card");
  put(
    "success_url",
    `${siteUrl(env)}/order-success?session_id={CHECKOUT_SESSION_ID}`,
  );
  put("cancel_url", `${siteUrl(env)}/treatment-order?checkout=cancelled`);
  put("client_reference_id", order.orderNumber);
  put("customer_creation", "always");
  put("customer_email", user.email);
  put("billing_address_collection", "required");
  put("metadata[order_number]", order.orderNumber);
  put("metadata[order_type]", "medicine");
  put("metadata[user_id]", user.id);
  put("payment_intent_data[metadata][order_number]", order.orderNumber);
  put("payment_intent_data[metadata][order_type]", "medicine");
  put("line_items[0][price_data][currency]", CURRENCY);
  put("line_items[0][price_data][unit_amount]", order.totalPence);
  put(
    "line_items[0][price_data][product_data][name]",
    `${item.name} ${item.strength_label}`,
  );
  put(
    "line_items[0][price_data][product_data][description]",
    "Shift Some Timber treatment order",
  );
  put("line_items[0][quantity]", "1");
  return form;
}

async function checkout(request, env) {
  const user=await member(request,env);
  if(!user)return json({ok:false,error:'account_required',message:'Create or sign in to My Shift before ordering.'},401,cors(request));
  if(Number(user.email_verified||0)!==1)return json({ok:false,error:'email_verification_required'},403,cors(request));
  if(!env.STRIPE_SECRET_KEY)return json({ok:false,error:'payments_not_configured'},503,cors(request));
  const mode=String(env.STRIPE_MODE||'test').toLowerCase(),key=String(env.STRIPE_SECRET_KEY);
  if(!['test','live'].includes(mode)||!key.startsWith(mode==='live'?'sk_live_':'sk_test_'))return json({ok:false,error:'stripe_mode_mismatch'},503,cors(request));
  await schema(env);
  const input=await body(request),variantId=Number(input?.variantId);
  if(!Number.isInteger(variantId)||variantId<1)return json({ok:false,error:'invalid_variant'},400,cors(request));
  const eligibilityItem=await env.DB.prepare('SELECT m.form,m.name FROM medicine_variants v JOIN medicine_products m ON m.id=v.medicine_id WHERE v.id=?').bind(variantId).first();
  if(!eligibilityItem)return json({ok:false,error:'invalid_variant'},400,cors(request));
  const eligibility=insulinEligibility(eligibilityItem.form,input.insulinUse)||bmiEligibility(eligibilityItem,input.eligibility);
  if(eligibility)return json({ok:false,error:eligibility.error,message:eligibility.message},eligibility.status,cors(request));
  const reorderNumber=clean(input?.reorderOfOrderNumber,80),verificationToken=clean(input?.verificationToken,160),verificationHash=verificationToken?await sha256(verificationToken):'';
  const acquired=await acquireCheckoutAttempt(env.DB,{userId:user.id,channel:'medicine',selection:{variantId,reorderNumber,verificationHash,discountCode:clean(input?.discountCode,80).toUpperCase()}});
  if(acquired.conflict)return json(checkoutProblem({error:'checkout_selection_conflict'}),409,cors(request));
  let attempt=acquired.attempt;
  const reject=async(error,status=409,message)=>{
    await env.DB.prepare("UPDATE checkout_attempts SET active=0,state='unavailable',updated_at=? WHERE id=? AND state='preparing'").bind(now(),attempt.id).run();
    return json({ok:false,error,...(message?{message}:{})},status,cors(request));
  };
  if(attempt.state==='preparing'){
    let reorderOf=null,verification=null;
    if(reorderNumber){
      reorderOf=await env.DB.prepare('SELECT id,variant_id,clinical_status,reorder_eligible_at FROM medicine_orders WHERE order_number=? AND user_id=?').bind(reorderNumber,user.id).first();
      if(!reorderOf||reorderOf.clinical_status!=='fulfilled'||!reorderOf.reorder_eligible_at||!Number.isFinite(Date.parse(reorderOf.reorder_eligible_at))||Date.parse(reorderOf.reorder_eligible_at)>Date.now())return reject('reorder_not_eligible');
      if(Number(reorderOf.variant_id)!==variantId)return reject('reorder_variant_mismatch',400);
    }
    {
      if(!verificationToken)return reject('prepay_verification_required',409,'Complete verification before payment.');
      verification=await env.DB.prepare('SELECT token_hash,partner_reference,expires_at FROM medicine_prepay_verifications WHERE token_hash=? AND user_id=? AND variant_id=? AND used_at IS NULL AND expires_at>?').bind(verificationHash,user.id,variantId,now()).first();
      if(!verification)return reject('invalid_or_expired_verification',409,'Verification has expired or does not match this treatment. Complete it again before payment.');
    }
    const linkedIntake=await env.DB.prepare('SELECT public_reference FROM medicine_clinical_intakes WHERE partner_reference=? AND user_id=? AND variant_id=? AND status=\'verified\'').bind(verification.partner_reference,user.id,variantId).first();
    if(!linkedIntake)return reject('verified_assessment_reference_required',409,'The pharmacy assessment reference must be confirmed before payment.');
    const item=await env.DB.prepare(`SELECT v.id variant_id,v.medicine_id,v.strength_label,v.selling_price_pence,v.status variant_status,v.sellable variant_sellable,v.partner variant_partner,v.availability_state variant_availability,m.name,m.status medicine_status,m.sellable medicine_sellable,m.partner medicine_partner,m.availability_state medicine_availability,COALESCE(i.stock_on_hand,0) stock_on_hand,COALESCE(i.reserved,0) reserved FROM medicine_variants v JOIN medicine_products m ON m.id=v.medicine_id LEFT JOIN medicine_inventory i ON i.variant_id=v.id WHERE v.id=?`).bind(variantId).first();
    const truth=item?authoritativePurchaseability({product:{status:item.medicine_status,sellable:item.medicine_sellable,partner:item.medicine_partner,availability_state:item.medicine_availability},variant:{status:item.variant_status,sellable:item.variant_sellable,partner:item.variant_partner,availability_state:item.variant_availability},inventory:{stock_on_hand:item.stock_on_hand,reserved:item.reserved}}):null;
    if(!truth?.canBuy)return reject('out_of_stock',409,'Currently out of stock.');
    const offer=await discount(env,input?.discountCode,Number(item.selling_price_pence));
    if(input?.discountCode&&!offer)return reject('invalid_discount_code',400);
    const order={orderNumber:attempt.order_number,totalPence:Number(item.selling_price_pence)-Number(offer?.amount||0)},date=now();
    await ensureOrderReferenceRegistry(env.DB);
    const availableSql=`EXISTS(SELECT 1 FROM medicine_inventory WHERE variant_id=? AND stock_on_hand-reserved>0)`+(verification?` AND EXISTS(SELECT 1 FROM medicine_prepay_verifications WHERE token_hash=? AND user_id=? AND variant_id=? AND used_at IS NULL AND expires_at>?) AND NOT EXISTS(SELECT 1 FROM medicine_prepay_verifications WHERE user_id=? AND partner_reference=? AND used_at IS NOT NULL)`:'');
    attempt=await prepareCheckoutAttempt(env.DB,attempt,{availableSql,availableArgs:[variantId,...(verification?[verificationHash,user.id,variantId,date,user.id,verification.partner_reference]:[])],form:stripeForm(order,item,user,env),statements:guard=>[
      env.DB.prepare(`INSERT INTO medicine_orders(order_number,user_id,email,medicine_id,variant_id,medicine_name,strength_label,unit_price_pence,discount_code,discount_pence,total_pence,reorder_of_order_id,clinical_intake_submitted_at,clinical_intake_reference,created_at,updated_at) SELECT ?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,? WHERE ${guard}`).bind(order.orderNumber,user.id,user.email,item.medicine_id,variantId,item.name,item.strength_label,item.selling_price_pence,offer?.code||null,offer?.amount||0,order.totalPence,reorderOf?.id||null,verification?date:null,linkedIntake.public_reference,date,date),
      env.DB.prepare(`INSERT INTO order_reference_registry(order_number,channel,user_id,source_table,source_id,status,created_at,updated_at) SELECT ?,'medicine',?,'medicine_orders',(SELECT id FROM medicine_orders WHERE order_number=?),'pending',?,? WHERE ${guard}`).bind(order.orderNumber,user.id,order.orderNumber,date,date),
      env.DB.prepare(`UPDATE medicine_inventory SET reserved=reserved+1,updated_at=? WHERE variant_id=? AND ${guard}`).bind(date,variantId),
      ...(verification?[env.DB.prepare(`UPDATE medicine_prepay_verifications SET used_at=? WHERE token_hash=? AND ${guard}`).bind(date,verificationHash)]:[])
    ]});
    if(attempt.state==='preparing')return reject('stock_or_verification_changed',409,'Stock or verification changed. Please check your selection before trying again.');
  }
  const session=await requestCheckoutSession(env,attempt);
  if(!session.ok)return json(checkoutProblem(session),session.status,cors(request));
  const date=now();
  await env.DB.batch([
    env.DB.prepare("UPDATE medicine_orders SET stripe_checkout_session_id=?,status=CASE WHEN status='pending' THEN 'checkout_open' ELSE status END,updated_at=? WHERE order_number=?").bind(session.id,date,attempt.order_number),
    env.DB.prepare("UPDATE order_reference_registry SET status='checkout_open',updated_at=? WHERE order_number=? AND status='pending'").bind(date,attempt.order_number)
  ]);
  const order=await env.DB.prepare('SELECT total_pence FROM medicine_orders WHERE order_number=? AND user_id=?').bind(attempt.order_number,user.id).first();
  return json({ok:true,checkoutUrl:session.url,orderNumber:attempt.order_number,totalPence:order.total_pence},201,cors(request));
}

async function webhook(request, env, ctx) {
  const payload = await request.clone().text(),
    event = JSON.parse(payload || "null");
  if (event?.data?.object?.metadata?.order_type !== "medicine") return null;
  if (
    !env.STRIPE_WEBHOOK_SECRET ||
    !(await validSignature(
      payload,
      request.headers.get("stripe-signature"),
      env.STRIPE_WEBHOOK_SECRET,
    ))
  )
    return json({ ok: false, error: "invalid_signature" }, 400);
  await schema(env);
  const inserted = await env.DB.prepare(
    `INSERT OR IGNORE INTO medicine_stripe_events(stripe_event_id,event_type,received_at) VALUES(?,?,?)`,
  )
    .bind(clean(event.id, 200), clean(event.type, 100), now())
    .run();
  if (Number(inserted.meta?.changes || 0) !== 1) {
    const previous = await env.DB.prepare("SELECT processed_at FROM medicine_stripe_events WHERE stripe_event_id=?").bind(event.id).first();
    if (previous?.processed_at) return json({ ok: true, duplicate: true });
  }
  const session = event.data.object,
    number = clean(
      session.metadata?.order_number || session.client_reference_id,
      80,
    ),
    order = await env.DB.prepare(
      "SELECT * FROM medicine_orders WHERE order_number=?",
    )
      .bind(number)
      .first();
  // A transient lookup failure must stay retryable, not be acknowledged as complete.
  if (!order) return json({ ok: false, error: "medicine_order_not_found" }, 503);
  await ensureOrderReferenceRegistry(env.DB);
  await ensureCheckoutAttempts(env.DB);
  let notifyPaid = false;
  try {
    const stamp = now(), statements = [];
    const paid = ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(event.type) && session.payment_status === "paid";
    const failed = ["checkout.session.expired", "checkout.session.async_payment_failed", "payment_intent.payment_failed"].includes(event.type);
    // Conditions are evaluated inside the transaction, not against the earlier read.
    // Distinct Stripe events and concurrent deliveries must settle one order only once.
    const payable = "status IN ('pending','checkout_open','failed','expired')";
    const reserved = "status IN ('pending','checkout_open')";
    if (paid) {
      statements.push(
        env.DB.prepare(`UPDATE medicine_inventory SET stock_on_hand=MAX(0,stock_on_hand-1),reserved=MAX(0,reserved-CASE WHEN EXISTS(SELECT 1 FROM medicine_orders WHERE id=? AND ${reserved}) THEN 1 ELSE 0 END),updated_at=? WHERE variant_id=? AND EXISTS(SELECT 1 FROM medicine_orders WHERE id=? AND ${payable})`).bind(order.id,stamp,order.variant_id,order.id),
        env.DB.prepare(`UPDATE order_reference_registry SET status='paid',updated_at=? WHERE order_number=? AND EXISTS(SELECT 1 FROM medicine_orders WHERE id=? AND ${payable})`).bind(stamp,number,order.id),
        env.DB.prepare(`UPDATE medicine_orders SET status='paid',clinical_status='assessment_pending',clinical_updated_at=?,stripe_payment_intent_id=?,updated_at=? WHERE id=? AND ${payable}`).bind(stamp,clean(session.payment_intent,200),stamp,order.id)
      );
    } else if (failed) {
      statements.push(
        env.DB.prepare(`UPDATE medicine_inventory SET reserved=MAX(0,reserved-1),updated_at=? WHERE variant_id=? AND EXISTS(SELECT 1 FROM medicine_orders WHERE id=? AND ${reserved})`).bind(stamp,order.variant_id,order.id),
        env.DB.prepare(`UPDATE order_reference_registry SET status='failed',updated_at=? WHERE order_number=? AND EXISTS(SELECT 1 FROM medicine_orders WHERE id=? AND ${reserved})`).bind(stamp,number,order.id),
        env.DB.prepare(`UPDATE medicine_orders SET status='failed',updated_at=? WHERE id=? AND ${reserved}`).bind(stamp,order.id)
      );
    }
    if(paid||event.type==='checkout.session.expired')statements.push(env.DB.prepare("UPDATE checkout_attempts SET active=0,state=?,updated_at=? WHERE order_number=?").bind(paid?'paid':'expired',stamp,number));
    // The event is complete only when order, inventory and registry commit together.
    statements.push(env.DB.prepare("UPDATE medicine_stripe_events SET processed_at=?,processing_error=NULL WHERE stripe_event_id=?").bind(stamp,event.id));
    const result = await env.DB.batch(statements);
    notifyPaid = paid && Number(result[2]?.meta?.changes || 0) === 1;
  } catch (error) {
    await env.DB.prepare("UPDATE medicine_stripe_events SET processing_error=? WHERE stripe_event_id=? AND processed_at IS NULL")
      .bind(clean(error?.message,1000),event.id).run().catch(()=>{});
    throw error;
  }
  if (notifyPaid) {
    const mail=medicineEmailTemplates.orderConfirmation({orderNumber:number});
    const delivery=sendTransactionalEmail(env,{to:order.email,userId:order.user_id,internalNotify:true,includeMatt:true,eventReference:'medicine:'+number+':payment:'+event.id,templateVersion:'medicine-order-confirmation-v1',...mail});
    if(ctx?.waitUntil) ctx.waitUntil(delivery); else await delivery;
  }
  return json({ ok: true });
}

// Read-only basket recovery. Never create a second checkout while an existing
// attempt may have been accepted by Stripe.
async function activePurchaseBasket(request, env) {
  const user = await member(request, env);
  if (!user) return json({ok:false,error:"unauthorised"},401,cors(request));
  await ensureCheckoutAttempts(env.DB);
  const rows = await env.DB.prepare(
    "SELECT channel,state,session_id,checkout_url,order_number,created_at FROM checkout_attempts WHERE user_id=? AND active=1 AND channel IN ('medicine','apparel') ORDER BY created_at DESC LIMIT 2"
  ).bind(user.id).all();
  const resume = new URL(request.url).searchParams.get("resume") === "1";
  const attempts = [];
  for (const row of rows.results || []) {
    const item = {channel:row.channel,state:row.state,canResume:false};
    // Labels come only from this authenticated member's existing order.
    if (row.channel === "medicine") {
      const order = await env.DB.prepare(
        "SELECT medicine_name,strength_label FROM medicine_orders WHERE order_number=? AND user_id=?"
      ).bind(row.order_number,user.id).first().catch(()=>null);
      if (order) item.label = [order.medicine_name,order.strength_label].filter(Boolean).join(" · ").slice(0,120);
    } else {
      const order = await env.DB.prepare(
        "SELECT COUNT(*) lines,COALESCE(SUM(quantity),0) units FROM commerce_order_items WHERE order_id=(SELECT id FROM orders WHERE order_number=? AND user_id=?)"
      ).bind(row.order_number,user.id).first().catch(()=>null);
      if (order?.units>0) item.label = "Timber Mill · " + Math.min(99,Number(order.units)) + " item(s)";
    }
    if (row.state === "open" && row.session_id && row.checkout_url) {
      if (!resume) item.canResume = true; // Actual Stripe status must be checked on tap.
      else {
        try {
          const response = await fetch("https://api.stripe.com/v1/checkout/sessions/" + encodeURIComponent(row.session_id), {
            headers:{authorization:"Bearer " + env.STRIPE_SECRET_KEY},
            signal:AbortSignal.timeout(7000)
          });
          const session = response.ok ? await response.json() : null;
          if (session?.id === row.session_id && session.status === "open" &&
              session.payment_status !== "paid" &&
              new URL(row.checkout_url).hostname === "checkout.stripe.com") {
            item.canResume = true;
            item.checkoutUrl = row.checkout_url;
          } else {
            item.reason = session?.status === "expired" ? "checkout_expired" : "checkout_not_confirmed";
          }
        } catch {item.reason = "checkout_status_unavailable";}
      }
    } else item.reason = "checkout_requires_reconciliation";
    attempts.push(item);
  }
  return json({
    ok:true,
    accountReference:await sha256("basket-owner:" + user.id),
    attempts
  },200,cors(request));
}

async function orderStatus(request, env) {
  const id = clean(new URL(request.url).searchParams.get("session_id"), 200);
  if (!/^cs_(test|live)_[A-Za-z0-9_]+$/.test(id))
    return json({ ok: false, error: "invalid_session" }, 400, cors(request));
  await schema(env);
  const user=await member(request,env);
  if(!user)return json({ok:false,error:"unauthorised"},401,cors(request));
  const order = await env.DB.prepare(
    "SELECT order_number,variant_id,medicine_name,strength_label,status,clinical_status FROM medicine_orders WHERE stripe_checkout_session_id=? AND user_id=?",
  )
    .bind(id,user.id)
    .first();
  return order
    ? json(
        { ok: true, orderNumber: order.order_number, variantId:Number(order.variant_id), medicineName:order.medicine_name, strengthLabel:order.strength_label, status:order.status, paymentStatus:order.status, clinicalStatus:order.clinical_status||"not_started" },
        200,
        cors(request),
      )
    : json({ ok: false, error: "order_not_found" }, 404, cors(request));
}

async function treatmentOrders(request, env) {
  const user = await member(request, env);
  if (!user) return json({ ok: false, error: "unauthorised" }, 401, cors(request));
  await schema(env);
  const state = await env.DB.prepare(`SELECT preferences FROM member_state WHERE user_id=?`).bind(user.id).first().catch(() => null);
  const setupComplete = journeyComplete(state?.preferences);
  if (setupComplete) {
    await env.DB.prepare(`UPDATE medicine_orders SET journey_setup_completed_at=COALESCE(journey_setup_completed_at,?),updated_at=updated_at WHERE user_id=? AND clinical_status='approved' AND journey_setup_required=1`).bind(now(), user.id).run();
  }
  const { results = [] } = await env.DB.prepare(
    `SELECT * FROM medicine_orders WHERE user_id=? AND status NOT IN ('pending','checkout_open','expired','failed') ORDER BY created_at DESC,id DESC LIMIT 50`,
  ).bind(user.id).all();
  return json({ ok: true, accountReference:await sha256('clinical-account:'+user.id), setupComplete, orders: results.map((row) => memberTreatmentView(row, setupComplete)) }, 200, cors(request));
}

async function confirmJourneySetup(request, env) {
  const user = await member(request, env);
  if (!user) return json({ ok: false, error: "unauthorised" }, 401, cors(request));
  await schema(env);
  const state = await env.DB.prepare(`SELECT preferences FROM member_state WHERE user_id=?`).bind(user.id).first().catch(() => null);
  if (!journeyComplete(state?.preferences)) return json({ ok: false, error: "journey_setup_incomplete", message: "Finish the required My Journey starting point and choose what you want your Life Back for." }, 409, cors(request));
  const stamp = now();
  const result = await env.DB.prepare(`UPDATE medicine_orders SET journey_setup_completed_at=COALESCE(journey_setup_completed_at,?),updated_at=? WHERE user_id=? AND clinical_status='approved' AND journey_setup_required=1`).bind(stamp, stamp, user.id).run();
  return json({ ok: true, completed: Number(result.meta?.changes || 0) }, 200, cors(request));
}

async function pharmacyStatus(request, env) {
  if (!env.PHARMACY_INTEGRATION_SECRET) return json({ ok: false, error: "integration_not_configured" }, 503);
  const supplied = String(request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "");
  const [a, b] = await Promise.all([sha256(supplied), sha256(String(env.PHARMACY_INTEGRATION_SECRET))]);
  if (!supplied || a !== b) return json({ ok: false, error: "unauthorised" }, 401);
  await schema(env);
  const input = await body(request), orderNumber = clean(input?.orderNumber, 80), next = clean(input?.status, 60);
  const reasonCode = clean(input?.reasonCode, 60);
  if (!orderNumber || !CLINICAL_STATES.has(next) || (reasonCode && !/^[a-z0-9_:-]+$/i.test(reasonCode)))
    return json({ ok: false, error: "invalid_status_update" }, 400);
  const order = await env.DB.prepare(`SELECT * FROM medicine_orders WHERE order_number=?`).bind(orderNumber).first();
  if (!order) return json({ ok: false, error: "order_not_found" }, 404);
  const current = order.clinical_status || "not_started";
  if(current===next)return json({ok:true,orderNumber,status:next,duplicate:true});
  if (current !== next && !CLINICAL_TRANSITIONS[current]?.has(next))
    return json({ ok: false, error: "invalid_status_transition", current, requested: next }, 409);
  const stamp = now(), journeyRequired = next === "approved" ? 1 : Number(order.journey_setup_required || 0);
  const reorderAt = next === "fulfilled" ? clean(input?.reorderEligibleAt, 40) || null : order.reorder_eligible_at;
  if (reorderAt && !/^\d{4}-\d{2}-\d{2}T/.test(reorderAt)) return json({ ok: false, error: "invalid_reorder_date" }, 400);
  const paymentStatus = next === "refunded" ? "refunded" : order.status;
  const changed=await env.DB.prepare(`UPDATE medicine_orders SET clinical_status=?,clinical_reason_code=?,clinical_updated_at=?,journey_setup_required=?,reorder_eligible_at=?,status=?,updated_at=? WHERE id=? AND clinical_status=?`).bind(next, reasonCode || null, stamp, journeyRequired, reorderAt, paymentStatus, stamp, order.id,current).run();
  if(Number(changed.meta?.changes||0)!==1)return json({ok:false,error:'order_status_changed'},409);
  await updateOrderReferenceStatus(env.DB, orderNumber, next);
  await env.DB.prepare(`INSERT INTO audit_log(user_id,action,entity_type,entity_id,metadata,created_at) VALUES(?,?,?,?,?,?)`).bind(order.user_id, "medicine.clinical_status", "medicine_order", String(order.id), JSON.stringify({ from: current, to: next, reasonCode: reasonCode || null }), stamp).run().catch(() => null);
  const mail=medicineEmailTemplates.clinicalStatus({status:next});
  await sendTransactionalEmail(env,{to:order.email,userId:order.user_id,internalNotify:true,includeMatt:true,eventReference:'medicine:'+orderNumber+':clinical:'+next+':'+stamp,templateVersion:'medicine-clinical-status-v1',...mail});
  return json({ ok: true, orderNumber, previousStatus: current, status: next, journeySetupRequired: Boolean(journeyRequired), reorderEligibleAt: reorderAt });
}

export async function medicineCommerceRoutes(request, env, ctx) {
  const path = new URL(request.url).pathname.replace(/\/+$/, "") || "/";
  const memberWrites=["/v1/commerce/medicine-checkout","/v1/commerce/medicine-prepay-verification","/v1/commerce/medicine-clinical-intake","/v1/commerce/medicine-clinical-intake-resume"];
  if(request.method==='POST'&&memberWrites.includes(path)&&request.headers.has('Origin')&&!ALLOWED_ORIGINS.has(request.headers.get('Origin')))return json({ok:false,error:'origin_not_allowed'},403);
  if (request.method === "OPTIONS" && memberWrites.includes(path))
    return new Response(null, { status: 204, headers: cors(request) });
  if (request.method === "GET" && path === "/v1/catalogue/medicines") {
    if (!env.DB) return json({ ok: true, products: [] }, 200, cors(request));
    return json(
      { ok: true, products: await catalogue(env) },
      200,
      cors(request),
    );
  }
  if (request.method === "GET" && path === "/v1/commerce/active-checkout") return activePurchaseBasket(request,env);
  if (request.method === "GET" && path === "/v1/commerce/medicine-order-status")
    return orderStatus(request, env);
  if(request.method==='GET'&&path==='/v1/commerce/medicine-clinical-context')return clinicalContext(request,env);
  if(request.method==='POST'&&path==='/v1/commerce/medicine-clinical-intake-resume')return clinicalResume(request,env);
  if (request.method === "GET" && path === "/v1/commerce/medicine-clinical-intake-status")
    return clinicalIntakeStatus(request, env);
  if (request.method === "GET" && path === "/v1/treatment/orders")
    return treatmentOrders(request, env);
  if (request.method === "POST" && path === "/v1/treatment/journey-setup-complete")
    return confirmJourneySetup(request, env);
  if (request.method === "POST" && path === "/v1/integrations/pharmacy/treatment-status")
    return pharmacyStatus(request, env);
  if (request.method === "POST" && path === "/v1/integrations/pharmacy/clinical-intake-status")
    return pharmacyClinicalIntakeStatus(request, env);
  if (request.method === "POST" && path === "/v1/commerce/medicine-checkout")
    return checkout(request, env);
  if (request.method === "POST" && path === "/v1/commerce/medicine-prepay-verification")
    return prepayVerification(request, env);
  if (request.method === "POST" && path === "/v1/commerce/medicine-clinical-intake")
    return clinicalIntake(request, env);
  if (request.method === "POST" && path === "/v1/commerce/stripe/webhook")
    return webhook(request, env, ctx);
  return null;
}
export const medicineCommerceInternals = { journeyComplete, memberTreatmentView, clinicalTransitions: CLINICAL_TRANSITIONS };

