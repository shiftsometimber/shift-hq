var __defProp = Object.defineProperty;
var __name = (target, value) => __defProp(target, "name", { value, configurable: true });

// prescriptions/domain.mjs
var fail = /* @__PURE__ */ __name((status, code) => {
  throw Object.assign(Error(code), { status });
}, "fail");
var text = /* @__PURE__ */ __name((v, max = 4e3) => {
  if (typeof v !== "string" || !v.trim() || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) fail(422, "prescription_text_required");
  return v.trim();
}, "text");
var canonical = /* @__PURE__ */ __name((value) => JSON.stringify(value, (_, v) => v && typeof v === "object" && !Array.isArray(v) ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]])) : v), "canonical");
var digest = /* @__PURE__ */ __name(async (value) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(typeof value === "string" ? value : canonical(value)))), (b) => b.toString(16).padStart(2, "0")).join(""), "digest");
function treatment(input) {
  if (!input || !Number.isSafeInteger(input.variantId) || input.variantId < 1 || !Number.isSafeInteger(input.packs) || input.packs < 1 || input.packs > 12) fail(422, "prescription_variant_and_packs_required");
  return {
    variantId: input.variantId,
    medicine: text(input.medicine, 200),
    strength: text(input.strength, 120),
    packs: input.packs,
    quantity: text(input.quantity, 300),
    dose: text(input.dose, 300),
    route: text(input.route, 200),
    directions: text(input.directions, 2e3)
  };
}
__name(treatment, "treatment");
function priceComparison(original, proposal) {
  for (const n of [original.totalPence, proposal.totalPence]) if (!Number.isSafeInteger(n) || n < 0 || n > 1e8) fail(422, "verified_price_required");
  if (original.currency !== "GBP" || proposal.currency !== "GBP") fail(422, "gbp_price_required");
  const deltaPence = proposal.totalPence - original.totalPence;
  return {
    currency: "GBP",
    originalTotalPence: original.totalPence,
    revisedTotalPence: proposal.totalPence,
    deltaPence,
    adjustment: deltaPence < 0 ? "refund_review" : deltaPence > 0 ? "payment_required" : "none",
    amountPence: Math.abs(deltaPence),
    paymentState: proposal.paymentState || "not_verified",
    refundState: deltaPence < 0 ? "awaiting_admin_review" : "not_required"
  };
}
__name(priceComparison, "priceComparison");
function propose(previous, input, context, date) {
  if (previous?.status === "issued") fail(409, "issued_prescription_requires_pharmacy_hold");
  if (previous?.status === "cancelled" || previous?.status === "declined") fail(409, "closed_prescription_request");
  const s = {
    recordId: context.recordId,
    orderNumber: context.orderNumber,
    memberId: context.memberId,
    version: (previous?.version || 0) + 1,
    status: "awaiting_member",
    assessmentVersion: context.assessmentVersion,
    assessmentDigest: context.assessmentDigest,
    recordRevision: context.recordRevision,
    caseVersion: context.caseVersion,
    treatment: treatment(input.treatment),
    originalTreatment: previous?.originalTreatment || context.originalTreatment,
    reason: text(input.reason, 2e3),
    clinicalRationale: text(input.clinicalRationale, 4e3),
    partnerId: text(input.partnerId, 100),
    expiresAt: input.expiresAt,
    prescriber: context.prescriber,
    patient: context.patient,
    quote: context.quote,
    comparison: priceComparison(context.originalPrice, context.quote),
    acceptance: null,
    question: null,
    createdAt: previous?.createdAt || date,
    updatedAt: date
  };
  if (typeof s.expiresAt !== "string" || !Number.isFinite(Date.parse(s.expiresAt)) || s.expiresAt <= date || Date.parse(s.expiresAt) - Date.parse(date) > 7 * 864e5) fail(422, "proposal_expiry_within_seven_days_required");
  return s;
}
__name(propose, "propose");
function decline(previous, reason, date) {
  if (!previous || ["issued", "cancelled", "declined"].includes(previous.status)) fail(409, "proposal_not_open");
  return { ...structuredClone(previous), version: previous.version + 1, status: "declined", reason: text(reason, 2e3), acceptance: null, updatedAt: date };
}
__name(decline, "decline");
function prescriberQuery(previous, message, date) {
  if (!previous || ["issued", "cancelled", "declined"].includes(previous.status)) fail(409, "proposal_not_open");
  return { ...structuredClone(previous), version: previous.version + 1, status: "clinician_query", acceptance: null, question: null, clinicianQuestion: { message: text(message, 2e3), at: date }, updatedAt: date };
}
__name(prescriberQuery, "prescriberQuery");
function documentFor(s, date) {
  if (s.status !== "accepted" || !s.acceptance || s.expiresAt <= date) fail(409, "current_member_agreement_required");
  if (s.comparison.paymentState !== "settled") fail(409, "payment_reconciliation_required");
  return {
    schema: "shift-prescription-v1",
    recordId: s.recordId,
    orderNumber: s.orderNumber,
    memberId: s.memberId,
    proposalVersion: s.version,
    assessmentVersion: s.assessmentVersion,
    assessmentDigest: s.assessmentDigest,
    patient: s.patient,
    prescriber: s.prescriber,
    treatment: s.treatment,
    partnerId: s.partnerId,
    agreement: s.acceptance,
    price: s.comparison,
    proposalExpiresAt: s.expiresAt
  };
}
__name(documentFor, "documentFor");
function memberView(s, date = (/* @__PURE__ */ new Date()).toISOString()) {
  if (!s) return null;
  return {
    recordId: s.recordId,
    orderNumber: s.orderNumber,
    version: s.version,
    status: s.expiresAt <= date && s.status !== "issued" ? "expired" : s.status,
    treatment: s.treatment,
    originalTreatment: s.originalTreatment,
    reason: s.reason,
    prescriberName: s.prescriber.name,
    comparison: s.comparison,
    question: s.question,
    clinicianQuestion: s.clinicianQuestion || null,
    expiresAt: s.expiresAt,
    updatedAt: s.updatedAt,
    canRespond: s.status === "awaiting_member" && s.expiresAt > date,
    canCancel: ["awaiting_member", "member_question", "accepted", "clinician_query"].includes(s.status),
    canAsk: ["awaiting_member", "member_question", "accepted", "clinician_query"].includes(s.status),
    prescriptionId: s.prescriptionId || null,
    issuedAt: s.issuedAt || null
  };
}
__name(memberView, "memberView");

// partner-operations/notification-events.mjs
var NOTIFICATION_KINDS = /* @__PURE__ */ new Set(["prescription_query", "prescription_proposed", "prescription_accepted", "prescription_cancelled", "prescription_question", "prescription_declined", "prescription_issued", "assessment_submitted", "evidence_uploaded", "review_started", "evidence_reviewed", "information_requested", "clinical_decision", "member_reply", "app_updates_reviewed", "prescription_received", "fulfilment_accept", "fulfilment_query", "fulfilment_reject", "fulfilment_prepare", "fulfilment_dispatch", "fulfilment_delivered", "fulfilment_delivery_exception", "fulfilment_returned", "fulfilment_cancel", "member_fulfilment_reply"]);
var CHANNELS = ["email", "whatsapp", "app"];
var q = /* @__PURE__ */ __name((env, s, ...a) => env.DB.prepare(s).bind(...a), "q");
function notificationContent(kind) {
  const titles = { prescription_query: "Action needed: your clinician has a question", prescription_proposed: "Action needed: review your proposed treatment", prescription_accepted: "Your treatment agreement has been recorded", prescription_cancelled: "Your treatment request has been cancelled", prescription_question: "Your treatment question has been received", prescription_declined: "Your treatment request has been updated", prescription_issued: "Your prescription has been signed", assessment_submitted: "Your assessment has been received", evidence_uploaded: "Your document has been received", review_started: "Your clinical review has started", evidence_reviewed: "Your document review has been updated", information_requested: "Action needed: check My Shift", clinical_decision: "Your clinical review has been updated", member_reply: "Your reply has been received", app_updates_reviewed: "Your shared updates have been reviewed", prescription_received: "Your prescription handover has been received", fulfilment_accept: "Your order is with the dispensing team", fulfilment_query: "Action needed: check My Shift", fulfilment_reject: "Your supply request has been updated", fulfilment_prepare: "Your order is being prepared", fulfilment_dispatch: "Your order has been dispatched", fulfilment_delivered: "A delivery update has been recorded", fulfilment_delivery_exception: "Action needed: check your delivery update", fulfilment_returned: "A return has been recorded", fulfilment_cancel: "Your supply request has been cancelled", member_fulfilment_reply: "Your reply has been received" };
  if (!NOTIFICATION_KINDS.has(kind)) return null;
  return { title: titles[kind], body: "Sign in to My Shift to read the update, see the latest status and check whether anything is needed from you." };
}
__name(notificationContent, "notificationContent");
function notificationEventStatements(env, record, event) {
  if (env.NOTIFICATION_EVENTS_ENABLED !== "true") return [];
  const content = notificationContent(event.kind);
  if (!content) return [];
  if (!Number.isInteger(record.user_id) || record.user_id < 1 || !/^[a-f0-9-]{36}$/.test(record.id)) throw Error("owned_notification_record_required");
  const sources = { prescription: ["EXISTS(SELECT 1 FROM clinical_prescription_events WHERE id=? AND record_id=?)", [event.sourceId, record.id]], case: ["EXISTS(SELECT 1 FROM clinical_case_events WHERE id=? AND record_id=?)", [event.sourceId, record.id]], evidence: ["EXISTS(SELECT 1 FROM clinical_member_evidence WHERE id=? AND record_id=?)", [event.sourceId, record.id]], assessment: ["EXISTS(SELECT 1 FROM clinical_member_versions WHERE record_id=? AND version=? AND submitted=1)", [record.id, event.sourceId]], partner: ["EXISTS(SELECT 1 FROM partner_audit WHERE id=? AND entity_type='order' AND entity_id=?)", [event.sourceId, record.order_number]] };
  const guard2 = sources[event.source];
  if (!guard2) throw Error("unsupported_notification_source");
  const id = event.id, link = "/member/treatment-records?record=" + record.id;
  const out = [q(env, "INSERT OR IGNORE INTO clinical_notification_events SELECT ?,?,?,?,?,?,?,?,? WHERE " + guard2[0] + " AND EXISTS(SELECT 1 FROM clinical_member_records WHERE id=? AND user_id=?)", id, record.user_id, record.id, record.order_number || null, event.kind, content.title, content.body, link, event.at, ...guard2[1], record.id, record.user_id)];
  for (const channel of CHANNELS) out.push(q(env, "INSERT OR IGNORE INTO clinical_notification_channels SELECT ?,?,'awaiting_approval',NULL,NULL,? WHERE EXISTS(SELECT 1 FROM clinical_notification_events WHERE id=? AND member_id=? AND record_id=? AND kind=?)", id, channel, event.at, id, record.user_id, record.id, event.kind));
  out.push(q(env, "UPDATE clinical_case_outbox SET status='channel_review' WHERE event_id=? AND recipient_user_id=? AND recipient_kind='member' AND status='pending' AND EXISTS(SELECT 1 FROM clinical_notification_events WHERE id=? AND member_id=?)", event.sourceId, record.user_id, id, record.user_id));
  const previousKinds = ["member_reply", "clinical_decision"].includes(event.kind) ? ["information_requested"] : event.kind.startsWith("fulfilment_") || event.kind === "member_fulfilment_reply" ? ["fulfilment_query"] : [];
  if (previousKinds.length) {
    const previous = "SELECT id FROM clinical_notification_events WHERE record_id=? AND member_id=? AND kind=? AND id<>? AND created_at<=? AND EXISTS(SELECT 1 FROM clinical_notification_events WHERE id=? AND record_id=? AND member_id=?)", args = [record.id, record.user_id, previousKinds[0], id, event.at, id, record.id, record.user_id];
    out.push(q(env, "UPDATE clinical_notification_channels SET status='superseded',updated_at=? WHERE status IN ('awaiting_approval','prepared') AND event_id IN (" + previous + ")", event.at, ...args));
    out.push(q(env, "UPDATE clinical_case_outbox SET status='superseded' WHERE status='pending' AND id IN (SELECT 'channel:'||id||':email' FROM (" + previous + ") UNION ALL SELECT 'channel:'||id||':app' FROM (" + previous + "))", ...args, ...args));
  }
  return out;
}
__name(notificationEventStatements, "notificationEventStatements");
async function orderEventStatements(env, order, event) {
  if (env.NOTIFICATION_EVENTS_ENABLED !== "true") return [];
  const record = await q(env, "SELECT id,user_id,order_number FROM clinical_member_records WHERE order_number=? AND user_id=? ORDER BY updated_at DESC LIMIT 1", order.orderNumber, order.memberId).first();
  if (!record) return [];
  return notificationEventStatements(env, record, { id: "partner:" + event.id, kind: event.action, source: "partner", sourceId: event.id, at: event.at });
}
__name(orderEventStatements, "orderEventStatements");
var digest2 = /* @__PURE__ */ __name(async (value) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))), (b) => b.toString(16).padStart(2, "0")).join(""), "digest");
async function prepareEventChannels(env, eventId, actor2, sessionGuard, date = (/* @__PURE__ */ new Date()).toISOString()) {
  if (env.NOTIFICATION_EVENTS_ENABLED !== "true") throw Object.assign(Error("notification_events_not_enabled"), { status: 503 });
  if (actor2.role !== "owner" || !actor2.mfa) throw Object.assign(Error("owner_mfa_required"), { status: 403 });
  const access = sessionGuard();
  if (!await q(env, "SELECT 1 ok WHERE " + access.sql, ...access.args).first()) throw Object.assign(Error("access_revoked"), { status: 403 });
  const event = await q(env, "SELECT * FROM clinical_notification_events WHERE id=?", eventId).first();
  if (!event) throw Object.assign(Error("notification_event_not_found"), { status: 404 });
  const recipient = await q(env, "SELECT u.id,u.email,a.email_verified FROM users u JOIN user_auth a ON a.user_id=u.id WHERE u.id=?", event.member_id).first();
  if (!recipient || recipient.email_verified !== 1) throw Object.assign(Error("verified_member_required"), { status: 409 });
  const drafts = [];
  for (const channel of ["email", "app"]) {
    const id = crypto.randomUUID(), sourceId = "channel:" + event.id + ":" + channel, key = "clinical:" + sourceId, payload = { notificationEvent: key, channel: channel === "app" ? "notification" : "email", from: "hq@shiftsometimber.co.uk", replyTo: "hello@shiftsometimber.co.uk", cc: [], bcc: [], recipients: [{ email: recipient.email.toLowerCase(), userId: recipient.id, name: "", accountVerified: true }], subject: event.title, body: event.body + "\n\nhttps://shiftsometimber.co.uk" + event.link, scheduledAt: date, attachment: null, push: channel === "app" ? { title: "My Shift update", body: "You have an update. Sign in to read it securely.", url: "/member/notifications" } : null, serviceOnly: true };
    const hash3 = await digest2(payload), g = sessionGuard();
    const result = await env.DB.batch([
      q(env, "UPDATE clinical_notification_channels SET status='prepared',draft_id=?,updated_at=? WHERE event_id=? AND channel=? AND status='awaiting_approval' AND " + g.sql + " AND EXISTS(SELECT 1 FROM users u JOIN user_auth a ON a.user_id=u.id WHERE u.id=? AND lower(u.email)=? AND a.email_verified=1)", id, date, event.id, channel, ...g.args, recipient.id, recipient.email.toLowerCase()),
      q(env, "INSERT OR IGNORE INTO clinical_case_outbox SELECT ?,?,?,'member','member_case_update',?,'pending',? WHERE EXISTS(SELECT 1 FROM clinical_notification_channels WHERE event_id=? AND channel=? AND draft_id=?)", sourceId, sourceId, event.member_id, event.link, date, event.id, channel, id),
      q(env, "INSERT OR IGNORE INTO hq_notification_intents(event_key,source,source_id,occurred_at,recipient_kind,recipient_user_id,template,link,state,draft_id,created_at,updated_at) SELECT ?,'clinical_case_outbox',?,?,'member',?,'member_case_update',?,'prepared',?,?,? WHERE EXISTS(SELECT 1 FROM clinical_notification_channels WHERE event_id=? AND channel=? AND draft_id=?)", key, sourceId, date, event.member_id, event.link, id, date, date, event.id, channel, id),
      q(env, "INSERT INTO hq_comms_drafts(id,hash,payload_json,status,scheduled_at,created_by,created_at) SELECT ?,?,?,'draft',?,?,? WHERE EXISTS(SELECT 1 FROM clinical_notification_channels WHERE event_id=? AND channel=? AND draft_id=?)", id, hash3, JSON.stringify(payload), date, actor2.id, date, event.id, channel, id),
      q(env, "INSERT INTO hq_comms_recipients(draft_id,email,user_id,status) SELECT ?,?,?,'pending' WHERE EXISTS(SELECT 1 FROM hq_comms_drafts WHERE id=?)", id, recipient.email.toLowerCase(), recipient.id, id),
      q(env, "INSERT INTO hq_comms_audit(draft_id,actor_id,action,at) SELECT ?,?,'event_channel_draft_prepared',? WHERE EXISTS(SELECT 1 FROM hq_comms_drafts WHERE id=?)", id, actor2.id, date, id)
    ]);
    if (result[0].meta?.changes === 1) drafts.push({ id, channel, hash: hash3, payload, status: "draft", approvalRequired: true });
  }
  return { drafts, whatsapp: { status: "awaiting_approved_template_and_verified_opt_in", text: event.title + ". " + event.body + " https://shiftsometimber.co.uk" + event.link }, sent: false, deliveryIntegration: "canonical_shared_contract_prepared_awaiting_central_release" };
}
__name(prepareEventChannels, "prepareEventChannels");

// care-handover.mjs
var CARE_HANDOVER_VERSION = "shift-care-handover-v1";
var careFields = [
  ["consultationMode", "Consultation mode", ["Video", "In person", "Secure two-way consultation with corroborating records"]],
  ["consultedOn", "Consultation date", "date"],
  ["identityReference", "Identity check method and evidence reference", "text"],
  ["measurementSource", "Independent measurement verification", ["Video consultation", "In-person measurement", "Clinical records", "Another healthcare provider"]],
  ["verifiedOn", "Verification date", "date"],
  ["verificationReference", "Measurement source reference and findings", "text"],
  ["historyReference", "Medical history and medicines reconciliation source and findings", "text"],
  ["eligibilityReason", "Eligibility and benefit-risk reasoning against the clinical protocol", "text"],
  ["medicationEvidence", "Current treatment dose, last dose, supply evidence and restart or switching plan", "text"],
  ["gpPlan", "GP communication plan", ["Notify verified GP", "Sharing declined", "No GP"]],
  ["gpReference", "Verified GP route reference or refusal and clinical justification", "text"],
  ["medicine", "Proposed medicine", "text"],
  ["dose", "Proposed strength and dose", "text"],
  ["directions", "Proposed directions and route", "text"],
  ["quantity", "Proposed quantity", "text"],
  ["protocolReference", "Clinician-approved protocol reference and version", "text"],
  ["followUpDate", "Next review date", "date"],
  ["followUpOwner", "Who owns the next review", "text"],
  ["monitoringPlan", "Monitoring, escalation and repeat treatment plan", "text"]
];
var careChecks = [["historyReviewed", "History, allergies, interactions and current medicines reviewed"], ["safeguardingReviewed", "Capacity, safeguarding and eating-disorder concerns considered and resolved or escalated"], ["informationDiscussed", "Treatment options, material risks, practical use and questions discussed"], ["safetyNetProvided", "Medicine-specific safety advice and urgent contact arrangements provided"]];
var validDate = /* @__PURE__ */ __name((v) => typeof v === "string" && /^\d{4}-\d\d-\d\d$/.test(v) && Number.isFinite(Date.parse(v)) && new Date(v).toISOString().slice(0, 10) === v, "validDate");
function validateCareHandover(input, today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10)) {
  const fail6 = /* @__PURE__ */ __name((k) => {
    throw Object.assign(Error("handover_required_" + k), { status: 422 });
  }, "fail");
  if (!input || input.version !== CARE_HANDOVER_VERSION) fail6("version");
  const out = { version: CARE_HANDOVER_VERSION };
  for (const [id, , type] of careFields) {
    const v = input[id];
    if (typeof v !== "string" || !v.trim() || v.length > 4e3 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) fail6(id);
    if (Array.isArray(type) && !type.includes(v)) fail6(id);
    if (type === "date" && !validDate(v)) fail6(id);
    out[id] = v.trim();
  }
  for (const [id] of careChecks) {
    if (input[id] !== true) fail6(id);
    out[id] = true;
  }
  if (out.consultedOn > today || out.verifiedOn > today) fail6("future_verification");
  if (out.followUpDate <= out.consultedOn || out.followUpDate <= today) fail6("follow_up_date");
  return out;
}
__name(validateCareHandover, "validateCareHandover");

// partner-operations/domain.mjs
var AREAS = ["weight_management", "testosterone", "sexual_health", "other"];
var ACTIONS = { clinician: ["review", "query", "clinical_decision", "issue_prescription"], dispensing: ["view_fulfilment", "query", "supply_decision", "prepare", "dispatch", "record_delivery", "record_exception", "cancel_supply"] };
var EVIDENCE = ["photo_id", "selfie", "indemnity", "qualification", "agreement"];
var CHECKS = ["identity", "registration", "indemnity", "agreements", "competence"];
var fail2 = /* @__PURE__ */ __name((status, code) => {
  throw Object.assign(Error(code), { status });
}, "fail");
var text2 = /* @__PURE__ */ __name((v, max = 1e3) => {
  if (typeof v !== "string" || !v.trim() || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) fail2(422, "valid_text_required");
  return v.trim();
}, "text");
var future = /* @__PURE__ */ __name((v, now4) => {
  if (typeof v !== "string" || !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d\.\d{3}Z$/.test(v) || !Number.isFinite(Date.parse(v)) || new Date(v).toISOString() !== v || v <= now4) fail2(422, "future_review_date_required");
  return v;
}, "future");
var ops = /* @__PURE__ */ __name((a) => a?.mfa === true && ["owner", "admin"].includes(a.role), "ops");
var own = /* @__PURE__ */ __name((s, a) => String(s.hqUserId) === String(a.id), "own");
function newStaff(b, id, now4) {
  if (!Object.hasOwn(ACTIONS, b.kind)) fail2(422, "invalid_staff_kind");
  return {
    id,
    kind: b.kind,
    orgId: text2(b.orgId, 100),
    version: 0,
    status: "draft",
    hqUserId: null,
    username: null,
    credentialVersion: 0,
    details: { name: text2(b.name, 160), email: text2(b.email, 200).toLowerCase() },
    evidence: [],
    checks: [],
    grants: [],
    createdAt: now4,
    updatedAt: now4
  };
}
__name(newStaff, "newStaff");
function credentialsCurrent(s, now4) {
  return CHECKS.every((kind) => s.checks.some((c) => c.kind === kind && c.credentialVersion === s.credentialVersion && c.outcome === "verified" && c.expiresAt > now4));
}
__name(credentialsCurrent, "credentialsCurrent");
function permission(s, area, action, now4, medicine) {
  if (s.status !== "active" || !s.hqUserId || !credentialsCurrent(s, now4)) return false;
  return s.grants.some((g) => g.credentialVersion === s.credentialVersion && !g.revokedAt && g.area === area && g.actions.includes(action) && g.startsAt <= now4 && g.expiresAt > now4 && (!g.medicines.length || medicine && g.medicines.includes(medicine)));
}
__name(permission, "permission");
function staffAction(original, b, actor2, now4, id) {
  if (!Number.isInteger(b.version) || b.version !== original.version) fail2(409, "profile_changed");
  const s = structuredClone(original), admin2 = ops(actor2), app = actor2.application === s.id;
  const requireAdmin = /* @__PURE__ */ __name(() => {
    if (!admin2) fail2(403, "owner_approval_required");
    if (own(s, actor2)) fail2(403, "self_approval_forbidden");
  }, "requireAdmin");
  const metadata = {};
  if (b.action === "details") {
    if (!admin2 && !app) fail2(403, "application_access_required");
    if (["approved", "credentials_pending", "active", "suspended", "rejected"].includes(s.status)) fail2(409, "approved_details_require_reapplication");
    const d = b.details;
    if (!d || typeof d !== "object") fail2(422, "details_required");
    if (s.hqUserId && ["name", "email"].some((k) => d[k] !== void 0 && d[k] !== s.details[k])) fail2(409, "provisioned_identity_change_requires_separate_review");
    const keys = ["name", "email", "professionalContact", "profession", "regulator", "registrationNumber", "prescribingEntitlement", "experience", "indemnityProvider", "policyReference", "registrationReviewAt"];
    if (Object.keys(d).some((k) => !keys.includes(k))) fail2(422, "unknown_application_field");
    for (const [k, v] of Object.entries(d)) s.details[k] = text2(v, k === "experience" ? 4e3 : 300);
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s.details.email)) fail2(422, "valid_email_required");
    s.details.email = s.details.email.toLowerCase();
    s.credentialVersion++;
    s.status = "draft";
  } else if (b.action === "evidence") {
    if (!admin2 && !app) fail2(403, "application_access_required");
    if (!["draft", "more_information", "submitted"].includes(s.status)) fail2(409, "reapplication_required");
    if (!EVIDENCE.includes(b.evidence?.kind) || !/^[a-f0-9]{64}$/.test(b.evidence.digest) || !b.evidence.id) fail2(422, "verified_upload_required");
    s.evidence.push(b.evidence);
    s.credentialVersion++;
    s.status = "draft";
    metadata.kind = b.evidence.kind;
    metadata.evidenceId = b.evidence.id;
  } else if (b.action === "hold_evidence" || b.action === "release_evidence_hold") {
    requireAdmin();
    const e = s.evidence.find((e2) => e2.id === b.evidenceId && !e2.purgedAt);
    if (!e) fail2(404, "evidence_not_found");
    if (e.deletionPendingAt) fail2(409, "evidence_deletion_already_pending");
    metadata.evidenceId = e.id;
    metadata.reason = text2(b.reason, 2e3);
    if (b.action === "hold_evidence") {
      e.legalHold = { reason: metadata.reason, actorId: String(actor2.id), at: now4, reviewAt: future(b.reviewAt, now4) };
      metadata.reviewAt = e.legalHold.reviewAt;
    } else {
      if (!e.legalHold) fail2(409, "evidence_not_on_hold");
      delete e.legalHold;
    }
  } else if (b.action === "submit") {
    if (!admin2 && !app) fail2(403, "application_access_required");
    if (!["draft", "more_information"].includes(s.status)) fail2(409, "application_not_editable");
    for (const k of ["name", "email", "professionalContact", "profession", "regulator", "registrationNumber", "indemnityProvider", "experience"]) text2(s.details[k], 4e3);
    for (const k of EVIDENCE) if (!s.evidence.some((e) => e.kind === k && e.retentionUntil > now4)) fail2(422, "missing_" + k);
    if (b.declaration !== true) fail2(422, "application_declaration_required");
    s.status = "submitted";
    s.submittedAt = now4;
  } else if (b.action === "check") {
    requireAdmin();
    if (!["submitted", "checks_underway", "more_information"].includes(s.status)) fail2(409, "submitted_application_required");
    if (!CHECKS.includes(b.kind) || !["verified", "rejected"].includes(b.outcome)) fail2(422, "invalid_verification_check");
    const check = { id, kind: b.kind, outcome: b.outcome, source: text2(b.source, 2e3), reviewedBy: String(actor2.id), checkedAt: now4, expiresAt: future(b.expiresAt, now4), credentialVersion: s.credentialVersion };
    s.checks = s.checks.filter((c) => c.kind !== b.kind || c.credentialVersion !== s.credentialVersion);
    s.checks.push(check);
    s.status = b.outcome === "verified" ? "checks_underway" : "more_information";
    metadata.kind = b.kind;
    metadata.outcome = b.outcome;
  } else if (b.action === "query" || b.action === "reject") {
    requireAdmin();
    if (s.status === "active") fail2(409, "suspend_active_profile_first");
    s.status = b.action === "query" ? "more_information" : "rejected";
    s.applicationMessage = text2(b.message, 3e3);
  } else if (b.action === "approve") {
    requireAdmin();
    if (s.status !== "checks_underway" || !credentialsCurrent(s, now4)) fail2(422, "current_verifications_required");
    if (!/^(CLN|DSP)-[A-F0-9]{12}$/.test(b.username) || !b.username.startsWith(s.kind === "clinician" ? "CLN-" : "DSP-")) fail2(422, "generated_username_required");
    if (s.username && s.username !== b.username) fail2(409, "allocated_username_is_permanent");
    s.username = b.username;
    s.status = s.hqUserId ? "credentials_pending" : "approved";
    s.approvedBy = String(actor2.id);
    s.approvedAt = now4;
    metadata.username = s.username;
  } else if (b.action === "grant") {
    if (!actor2.mfa || !(s.kind === "clinician" ? actor2.clinicalGovernor : actor2.pharmacyGovernor)) fail2(403, "qualified_scope_approver_required");
    if (own(s, actor2)) fail2(403, "self_approval_forbidden");
    if (!["approved", "credentials_pending", "active"].includes(s.status) || !credentialsCurrent(s, now4)) fail2(422, "approved_current_profile_required");
    if (!AREAS.includes(b.area) || !Array.isArray(b.actions) || !b.actions.length || new Set(b.actions).size !== b.actions.length || b.actions.some((x) => !ACTIONS[s.kind].includes(x))) fail2(422, "invalid_scope");
    if (!Array.isArray(b.medicines) || b.medicines.length > 30 || b.medicines.some((v) => typeof v !== "string" || !v.trim() || v.length > 120)) fail2(422, "invalid_medicine_restrictions");
    const grant = { id, credentialVersion: s.credentialVersion, area: b.area, actions: b.actions, medicines: b.medicines, restrictions: text2(b.restrictions, 2e3), approvalReference: text2(b.approvalReference, 1e3), approvedBy: String(actor2.id), startsAt: now4, expiresAt: future(b.expiresAt, now4) };
    s.grants.push(grant);
    metadata.grantId = id;
    metadata.area = b.area;
    metadata.actions = b.actions;
  } else if (b.action === "revoke_grant") {
    requireAdmin();
    const g = s.grants.find((g2) => g2.id === b.grantId && !g2.revokedAt);
    if (!g) fail2(404, "grant_not_found");
    g.revokedAt = now4;
    metadata.grantId = g.id;
    metadata.reason = text2(b.reason);
  } else if (b.action === "activate") {
    requireAdmin();
    if (s.status !== "credentials_pending" || !s.passwordSetAt || !b.accountMfaVerified || !s.hqUserId || !credentialsCurrent(s, now4)) fail2(422, "credentials_mfa_and_checks_required");
    if (!s.grants.some((g) => g.credentialVersion === s.credentialVersion && !g.revokedAt && g.expiresAt > now4)) fail2(422, "approved_scope_required");
    s.status = "active";
  } else if (b.action === "renew") {
    requireAdmin();
    if (!["active", "suspended", "approved", "credentials_pending"].includes(s.status)) fail2(409, "approved_profile_required");
    s.status = "draft";
    s.credentialVersion++;
    metadata.reason = text2(b.reason);
  } else if (b.action === "suspend") {
    requireAdmin();
    if (!["active", "approved", "credentials_pending"].includes(s.status)) fail2(409, "profile_not_approved");
    s.status = "suspended";
    metadata.reason = text2(b.reason);
  } else fail2(422, "unknown_staff_action");
  s.version++;
  s.updatedAt = now4;
  return { state: s, event: { id, action: "staff_" + b.action, actorId: String(actor2.id), at: now4, details: metadata } };
}
__name(staffAction, "staffAction");
var CARRIERS = { royal_mail: /* @__PURE__ */ __name((n) => "https://www.royalmail.com/track-your-item#/tracking-results/" + encodeURIComponent(n), "royal_mail"), dpd: /* @__PURE__ */ __name((n) => "https://track.dpd.co.uk/parcels/" + encodeURIComponent(n), "dpd") };
function fulfilmentAction(original, b, staff2, actor2, now4, id, { prescriptionCurrent = false, stockAvailable = false } = {}) {
  if (b.version !== original.version || !Number.isInteger(b.version)) fail2(409, "order_changed");
  if (!actor2.mfa || staff2.orgId !== original.partnerId || String(staff2.hqUserId) !== String(actor2.id)) fail2(404, "order_not_found");
  const required = { accept: "supply_decision", reject: "supply_decision", query: "query", prepare: "prepare", dispatch: "dispatch", delivered: "record_delivery", delivery_exception: "record_exception", returned: "record_delivery", cancel: "cancel_supply" }[b.action];
  if (!required || !permission(staff2, original.area, required, now4, original.medicine)) fail2(403, "dispensing_permission_required");
  const transitions = { accept: ["received", "query"], reject: ["received", "query", "accepted", "preparing"], query: ["received", "accepted", "preparing"], prepare: ["accepted"], dispatch: ["preparing"], delivered: ["dispatched", "delivery_exception"], delivery_exception: ["dispatched"], returned: ["dispatched", "delivery_exception", "delivered"], cancel: ["received", "query", "accepted", "preparing"] };
  if (!transitions[b.action].includes(original.status)) fail2(409, "invalid_fulfilment_transition");
  if (["accept", "prepare", "dispatch"].includes(b.action) && (!prescriptionCurrent || !original.prescriptionId)) fail2(422, "current_issued_prescription_required");
  if (["prepare", "dispatch"].includes(b.action) && !stockAvailable) fail2(409, "stock_unavailable");
  const s = structuredClone(original), detail = {};
  s.status = { accept: "accepted", reject: "rejected", query: "query", prepare: "preparing", dispatch: "dispatched", delivered: "delivered", delivery_exception: "delivery_exception", returned: "returned", cancel: "cancelled" }[b.action];
  if (["reject", "query", "delivery_exception", "returned", "cancel", "delivered"].includes(b.action)) {
    s.message = text2(b.message, 2e3);
    detail.messagePresent = true;
  }
  if (b.action === "query") {
    s.queryId = id;
    s.memberReply = null;
  }
  if (["delivered", "delivery_exception", "returned"].includes(b.action)) s.deliveryUpdate = { kind: b.action, source: "pharmacy_manual_record", recordedAt: now4, note: s.message };
  if (b.action === "dispatch") {
    if (!Object.hasOwn(CARRIERS, b.carrier) || typeof b.trackingNumber !== "string" || !/^[A-Za-z0-9-]{6,50}$/.test(b.trackingNumber)) fail2(422, "valid_carrier_tracking_required");
    s.tracking = { carrier: b.carrier, number: b.trackingNumber, url: CARRIERS[b.carrier](b.trackingNumber), dispatchedAt: now4 };
    detail.carrier = b.carrier;
  }
  s.version++;
  s.updatedAt = now4;
  return { state: s, event: { id, action: "fulfilment_" + b.action, actorId: String(actor2.id), at: now4, details: detail } };
}
__name(fulfilmentAction, "fulfilmentAction");
function memberTracking(s) {
  return { orderNumber: s.orderNumber, status: s.status, updatedAt: s.updatedAt, tracking: s.tracking || null, actionNeeded: s.status === "query" && !s.memberReply, prescriptionId: s.prescriptionId, deliveryUpdate: s.deliveryUpdate || null };
}
__name(memberTracking, "memberTracking");

// partner-operations/auth-limits.mjs
var hash = /* @__PURE__ */ __name(async (v) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(v))), (b) => b.toString(16).padStart(2, "0")).join(""), "hash");
async function limitProfessionalAuth(request, env, kind, subject, at = Date.now()) {
  const ip = request.headers.get("CF-Connecting-IP");
  if (!ip || ip.length > 80 || !env.DB) fail2(503, "auth_rate_limit_unavailable");
  const seconds = Math.floor(at / 1e3), bucket = Math.floor(seconds / 300) * 300, day = Math.floor(seconds / 86400) * 86400;
  const definitions = [["ip:" + ip, bucket, 20, seconds + 600], ["daily-ip:" + ip, day, 150, day + 172800], ["subject:" + kind + ":" + subject, bucket, kind === "mfa" ? 6 : 8, seconds + 600]];
  const statements = [];
  for (const [scope, start, , expiry] of definitions) {
    const key = await hash(scope);
    statements.push(env.DB.prepare("INSERT INTO partner_auth_limits(scope_hash,window_start,expires_at,attempt_count) VALUES(?,?,?,1) ON CONFLICT(scope_hash,window_start) DO UPDATE SET attempt_count=attempt_count+1 RETURNING attempt_count").bind(key, start, expiry));
  }
  let result;
  try {
    await env.DB.prepare("DELETE FROM partner_auth_limits WHERE rowid IN (SELECT rowid FROM partner_auth_limits WHERE expires_at<=? LIMIT 100)").bind(seconds).run();
    result = await env.DB.batch(statements);
  } catch {
    fail2(503, "auth_rate_limit_unavailable");
  }
  if (result.length !== definitions.length) fail2(503, "auth_rate_limit_unavailable");
  for (let i = 0; i < result.length; i++) {
    const count = result[i].results?.[0]?.attempt_count;
    if (!Number.isInteger(count)) fail2(503, "auth_rate_limit_unavailable");
    if (count > definitions[i][2]) fail2(429, "too_many_authentication_attempts");
  }
}
__name(limitProfessionalAuth, "limitProfessionalAuth");

// partner-operations/evidence-retention.mjs
function evidencePurgePlan(s, date) {
  return s.evidence.filter((e) => !e.purgedAt && e.retentionUntil <= date).map((e) => ({ evidenceId: e.id, kind: e.kind, retentionUntil: e.retentionUntil, held: !!e.legalHold, pending: !!e.deletionPendingAt, eligible: !e.legalHold }));
}
__name(evidencePurgePlan, "evidencePurgePlan");
async function purgeStaffEvidence(env, original, evidenceId, actor2, commit2, { date = (/* @__PURE__ */ new Date()).toISOString(), id = crypto.randomUUID(), dryRun = true } = {}) {
  const plan = evidencePurgePlan(original, date), item = plan.find((e2) => e2.evidenceId === evidenceId);
  if (dryRun) return { dryRun: true, plan };
  if (!actor2?.mfa || !["owner", "admin"].includes(actor2.role)) fail2(403, "owner_approval_required");
  if (env.PARTNER_EVIDENCE_PURGE_ENABLED !== "true" || typeof env.PARTNER_RETENTION_POLICY_REFERENCE !== "string" || !env.PARTNER_RETENTION_POLICY_REFERENCE.trim() || !env.PARTNER_PRIVATE_FILES) fail2(503, "retention_policy_not_commissioned");
  if (!item) fail2(422, "expired_evidence_required");
  if (item.held) fail2(409, "evidence_on_legal_hold");
  let s = structuredClone(original), e = s.evidence.find((e2) => e2.id === evidenceId);
  if (!e.objectKey || !e.objectKey.startsWith("staff/" + s.id + "/")) fail2(422, "verified_private_evidence_key_required");
  if (!e.deletionPendingAt) {
    e.deletionPendingAt = date;
    s.version++;
    s.updatedAt = date;
    s = await commit2(original, { state: s, event: { id, action: "staff_evidence_purge_requested", actorId: String(actor2.id), at: date, details: { evidenceId, policyReference: env.PARTNER_RETENTION_POLICY_REFERENCE } } });
  }
  try {
    await env.PARTNER_PRIVATE_FILES.delete(e.objectKey);
  } catch {
    fail2(503, "private_evidence_deletion_pending");
  }
  const next = structuredClone(s), entry = next.evidence.find((e2) => e2.id === evidenceId);
  delete entry.objectKey;
  delete entry.deletionPendingAt;
  entry.purgedAt = date;
  next.version++;
  next.updatedAt = date;
  const saved = await commit2(s, { state: next, event: { id: crypto.randomUUID(), action: "staff_evidence_purged", actorId: String(actor2.id), at: date, details: { evidenceId, policyReference: env.PARTNER_RETENTION_POLICY_REFERENCE } } });
  return { dryRun: false, state: saved, evidenceId, purged: true };
}
__name(purgeStaffEvidence, "purgeStaffEvidence");

// partner-operations/invitation-drafts.mjs
function invitationContent(kind, name, organisation) {
  if (!["partner", "clinician"].includes(kind)) fail2(422, "invalid_invitation_kind");
  const clinician = kind === "clinician";
  return { subject: clinician ? "Invitation to join SHIFT as a clinician / GP" : "An invitation to partner with SHIFT", body: "Hello " + name + ",\n\n" + (clinician ? "We would like to invite you to complete a clinician / GP profile with SHIFT, linked to " + organisation + ".\n\nOur onboarding covers your professional registration, prescribing entitlement, relevant competence, indemnity and identity verification. HQ approval and a separately approved treatment scope are required before access. Verified prescribers may review cases and sign prescriptions only within their approved scope. Joining does not automatically grant prescribing permissions." : "We would like to explore bringing " + organisation + " into SHIFT as a clinical or dispensing partner. Our setup brings member information, clinical review, prescription handover and dispensing updates together under one order reference.\n\nWe will agree the relevant organisation checks, responsibilities and permissions before access is activated.") + "\n\nProfessional onboarding is not open yet. We will provide the secure next steps once it is available. Please do not email identity documents, selfies, passwords or patient information.\n\nBest wishes,\nThe SHIFT team" };
}
__name(invitationContent, "invitationContent");
async function prepareInvitation(env, b, actor2, guard2, date = (/* @__PURE__ */ new Date()).toISOString()) {
  if (!actor2.mfa || !["owner", "admin"].includes(actor2.role)) fail2(403, "owner_approval_required");
  const q3 = /* @__PURE__ */ __name((sql2, ...args) => env.DB.prepare(sql2).bind(...args), "q");
  const access = guard2();
  if (!await q3("SELECT 1 ok WHERE " + access.sql, ...access.args).first()) fail2(403, "access_revoked");
  const orgRow = await q3("SELECT state_json FROM partner_organisations WHERE id=?", text2(b.orgId, 100)).first();
  if (!orgRow) fail2(404, "partner_not_found");
  const org = JSON.parse(orgRow.state_json);
  let staff2 = null, name, email;
  if (b.kind === "clinician") {
    const row = await q3("SELECT state_json FROM partner_staff WHERE id=?", text2(b.staffId, 100)).first();
    if (!row) fail2(404, "clinician_not_found");
    staff2 = JSON.parse(row.state_json);
    if (staff2.kind !== "clinician" || staff2.orgId !== org.id || org.kind !== "clinical") fail2(422, "matching_clinician_and_partner_required");
    if (b.profileVersion !== staff2.version) fail2(409, "profile_changed");
    if (!["draft", "submitted", "checks_underway", "more_information"].includes(staff2.status)) fail2(409, "application_not_invitable");
    name = staff2.details.name;
    email = staff2.details.email.toLowerCase();
  } else if (b.kind === "partner") {
    name = text2(b.name, 160);
    email = text2(b.email, 200).toLowerCase();
  } else fail2(422, "invalid_invitation_kind");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) fail2(422, "valid_email_required");
  const previous = await q3("SELECT * FROM partner_invitation_drafts WHERE kind=? AND org_id=? AND COALESCE(staff_id,'')=? AND COALESCE(profile_version,-1)=? AND recipient_email=?", b.kind, org.id, staff2?.id || "", staff2?.version ?? -1, email).first();
  if (previous) return { draft: previous, sent: false, accessGranted: false, reused: true };
  const id = crypto.randomUUID(), content = invitationContent(b.kind, name, org.name), g = guard2();
  const rs = await env.DB.batch([
    q3("INSERT INTO partner_invitation_drafts SELECT ?,?,?,?,?,?,?,?,?,'held_onboarding_closed',?,? WHERE " + g.sql + " AND EXISTS(SELECT 1 FROM partner_organisations WHERE id=? AND version=?)" + (staff2 ? " AND EXISTS(SELECT 1 FROM partner_staff WHERE id=? AND version=?)" : ""), id, b.kind, org.id, staff2?.id || null, staff2?.version ?? null, name, email, content.subject, content.body, actor2.id, date, ...g.args, org.id, org.version, ...staff2 ? [staff2.id, staff2.version] : []),
    q3("INSERT INTO partner_audit SELECT ?,?,?,0,?,?,?,? WHERE EXISTS(SELECT 1 FROM partner_invitation_drafts WHERE id=?)", crypto.randomUUID(), "invitation", id, String(actor2.id), "invitation_draft_prepared", JSON.stringify({ kind: b.kind, orgId: org.id, staffId: staff2?.id || null, sent: false, accessGranted: false }), date, id)
  ]);
  if (rs[0].meta?.changes !== 1) fail2(409, "profile_or_access_changed");
  return { draft: await q3("SELECT * FROM partner_invitation_drafts WHERE id=?", id).first(), sent: false, accessGranted: false, reused: false };
}
__name(prepareInvitation, "prepareInvitation");

// partner-operations/notification-review.mjs
function orderNotificationReviewStatements(env, order, event) {
  if (env.PARTNER_NOTIFICATION_REVIEW_ENABLED !== "true") return [];
  const q3 = /* @__PURE__ */ __name((s, ...a) => env.DB.prepare(s).bind(...a), "q"), link = "'/member/treatment-records?record='||r.id";
  return [
    q3("UPDATE clinical_case_outbox SET status='superseded' WHERE recipient_kind='member' AND recipient_user_id=? AND status='pending' AND event_id IN (SELECT id FROM partner_audit WHERE entity_type='order' AND entity_id=? AND id<>?) AND EXISTS(SELECT 1 FROM partner_audit WHERE id=?)", order.memberId, order.orderNumber, event.id, event.id),
    q3("INSERT OR IGNORE INTO clinical_case_outbox SELECT ?,?,?, 'member',?," + link + ",'pending',? FROM clinical_member_records r WHERE r.order_number=? AND r.user_id=? AND EXISTS(SELECT 1 FROM partner_audit WHERE id=?) ORDER BY r.updated_at DESC LIMIT 1", "partner:" + event.id, event.id, order.memberId, order.status === "query" && !order.memberReply ? "member_action_needed" : "member_case_update", event.at, order.orderNumber, order.memberId, event.id),
    q3("UPDATE partner_notification_outbox SET status='review_only' WHERE event_id=? AND EXISTS(SELECT 1 FROM clinical_case_outbox WHERE id=? AND status='pending')", event.id, "partner:" + event.id)
  ];
}
__name(orderNotificationReviewStatements, "orderNotificationReviewStatements");

// partner-operations/member-fulfilment.mjs
var q2 = /* @__PURE__ */ __name((env, s, ...a) => env.DB.prepare(s).bind(...a), "q");
var rows = /* @__PURE__ */ __name(async (s) => (await s.all()).results || [], "rows");
var readable = /* @__PURE__ */ __name((env) => env.PARTNER_TRACKING_READ_ENABLED === "true" || env.PARTNER_FULFILMENT_ENABLED === "true", "readable");
async function memberFulfilment(env, record) {
  if (!readable(env) || !record.order_number) return null;
  const row = await q2(env, "SELECT state_json FROM partner_fulfilment WHERE order_number=? AND member_id=?", record.order_number, record.user_id).first();
  if (!row) return null;
  const s = JSON.parse(row.state_json);
  const events = await rows(q2(env, "SELECT action,created_at FROM partner_audit WHERE entity_type='order' AND entity_id=? ORDER BY version", record.order_number));
  return {
    ...memberTracking(s),
    version: s.version,
    queryId: s.status === "query" ? s.queryId || null : null,
    canReply: env.PARTNER_MEMBER_REPLIES_ENABLED === "true" && s.status === "query" && !!s.queryId && !s.memberReply,
    message: ["query", "rejected", "cancelled", "delivery_exception", "returned"].includes(s.status) ? s.message || null : null,
    memberReply: s.memberReply ? { message: s.memberReply.message, createdAt: s.memberReply.createdAt } : null,
    events
  };
}
__name(memberFulfilment, "memberFulfilment");

// partner-operations/api.mjs
var PARTNER_BASE = "/v1/hq/clinical/partners";
var ORIGIN = "https://hq.shiftsometimber.co.uk";
var now = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "now");
var uid = /* @__PURE__ */ __name(() => crypto.randomUUID(), "uid");
var digest3 = /* @__PURE__ */ __name(async (data) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", typeof data === "string" ? new TextEncoder().encode(data) : data)), (n) => n.toString(16).padStart(2, "0")).join(""), "digest");
var random = /* @__PURE__ */ __name(() => Array.from(crypto.getRandomValues(new Uint8Array(32)), (n) => n.toString(16).padStart(2, "0")).join(""), "random");
var json = /* @__PURE__ */ __name((body2, status = 200) => Response.json(body2, { status, headers: { "Cache-Control": "no-store, private", "Vary": "Origin", "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Credentials": "true", "X-Content-Type-Options": "nosniff" } }), "json");
var query = /* @__PURE__ */ __name((env, sql2, ...args) => env.DB.prepare(sql2).bind(...args), "query");
var rows2 = /* @__PURE__ */ __name(async (q3) => (await q3.all()).results || [], "rows");
var admin = /* @__PURE__ */ __name((a) => a.mfa && ["owner", "admin"].includes(a.role), "admin");
var parse = /* @__PURE__ */ __name((row) => row ? JSON.parse(row.state_json) : null, "parse");
var staff = /* @__PURE__ */ __name(async (env, id) => parse(await query(env, "SELECT state_json FROM partner_staff WHERE id=?", id).first()), "staff");
async function body(request, max = 24e3) {
  const reader = request.body?.getReader();
  let length = 0, parts = [];
  if (reader) while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    length += value.length;
    if (length > max) {
      await reader.cancel();
      fail2(413, "request_too_large");
    }
    parts.push(value);
  }
  const all = new Uint8Array(length);
  let offset = 0;
  for (const p of parts) {
    all.set(p, offset);
    offset += p.length;
  }
  return all;
}
__name(body, "body");
async function readJson(request) {
  try {
    return JSON.parse(new TextDecoder().decode(await body(request)));
  } catch (e) {
    if (e.status) throw e;
    fail2(400, "invalid_json");
  }
}
__name(readJson, "readJson");
function authCondition(a, date) {
  if (a.application) return { sql: "EXISTS(SELECT 1 FROM partner_access_tokens WHERE token_hash=? AND staff_id=? AND kind='application' AND used_at IS NULL AND expires_at>?)", args: [a.tokenHash, a.application, date] };
  return { sql: "EXISTS(SELECT 1 FROM hq_users h JOIN hq_sessions ss ON ss.hq_user_id=h.id WHERE h.id=? AND h.role=? AND h.status='active' AND h.mfa_enabled=1 AND ss.token_hash=? AND ss.revoked_at IS NULL AND julianday(ss.expires_at)>julianday(?))" + (a.clinicalGovernor || a.pharmacyGovernor ? " AND EXISTS(SELECT 1 FROM clinical_hq_staff WHERE user_id=? AND active=1 AND expires_at>? AND registration_number<>'' AND verified_by<>'')" : ""), args: [a.id, a.role, a.sessionHash, date, ...a.clinicalGovernor || a.pharmacyGovernor ? [a.id, date] : []] };
}
__name(authCondition, "authCondition");
async function audit(env, a, type, id, action, details = {}) {
  const g = authCondition(a, now()), n = await query(env, "INSERT INTO partner_audit SELECT ?,?,?,(SELECT COALESCE(MAX(version),-1)+1 FROM partner_audit WHERE entity_type=? AND entity_id=?),?,?,?,? WHERE " + g.sql, uid(), type, id, type, id, String(a.id), action, JSON.stringify(details), now(), ...g.args).run();
  if (n.meta?.changes !== 1) fail2(403, "access_revoked");
}
__name(audit, "audit");
async function saveStaff(env, original, result, a, extra = [], organisation = null) {
  const s = result.state, e = result.event, g = authCondition(a, e.at);
  const r = await env.DB.batch([
    query(env, "UPDATE partner_staff SET state_json=?,version=?,username=?,hq_user_id=?,updated_at=? WHERE id=? AND version=? AND " + g.sql + (organisation ? " AND EXISTS(SELECT 1 FROM partner_organisations WHERE id=? AND version=? AND state_json=?)" : ""), JSON.stringify(s), s.version, s.username, s.hqUserId, e.at, s.id, original.version, ...g.args, ...organisation ? [organisation.id, organisation.version, JSON.stringify(organisation)] : []),
    query(env, "INSERT INTO partner_audit SELECT ?,?,?,(SELECT COALESCE(MAX(version),-1)+1 FROM partner_audit WHERE entity_type=? AND entity_id=?),?,?,?,? WHERE changes()=1", e.id, "staff", s.id, "staff", s.id, e.actorId, e.action, JSON.stringify({ ...e.details, profileVersion: s.version, snapshot: publicStaff(s) }), e.at),
    ...extra
  ]);
  if (r[0].meta?.changes !== 1) fail2(409, "profile_changed_or_access_revoked");
  return s;
}
__name(saveStaff, "saveStaff");
async function currentPartner(env, s, date = now()) {
  const org = parse(await query(env, "SELECT state_json FROM partner_organisations WHERE id=?", s.orgId).first());
  if (!org || org.status !== "approved" || org.expiresAt <= date || org.kind !== (s.kind === "clinician" ? "clinical" : "pharmacy")) fail2(403, "approved_current_partner_required");
  return org;
}
__name(currentPartner, "currentPartner");
async function clinicianPermission(env, actor2, action = "review", medicine) {
  if (env.PARTNER_OPERATIONS_ENABLED !== "true") return null;
  const s = parse(await query(env, "SELECT state_json FROM partner_staff WHERE hq_user_id=?", actor2.id).first());
  if (!s || s.kind !== "clinician" || actor2.role === "clinical" && actor2.mfaEnabled !== true || !permission(s, "weight_management", action, now(), medicine)) fail2(403, "clinical_scope_not_approved");
  const org = await currentPartner(env, s);
  return { staffId: s.id, version: s.version, organisationId: org.id, organisationVersion: org.version };
}
__name(clinicianPermission, "clinicianPermission");
function summary(s) {
  return { id: s.id, kind: s.kind, orgId: s.orgId, version: s.version, status: s.status, username: s.username, name: s.details.name, updatedAt: s.updatedAt };
}
__name(summary, "summary");
function publicStaff(s) {
  return { ...s, evidence: s.evidence.map(({ objectKey, ...e }) => e) };
}
__name(publicStaff, "publicStaff");
async function actorFor(request, env, authenticate, application = false) {
  if (application) {
    const raw = request.headers.get("X-Application-Token");
    if (!raw || !/^[a-f0-9]{64}$/.test(raw)) fail2(401, "application_link_required");
    const tokenHash = await digest3(raw), row = await query(env, "SELECT staff_id FROM partner_access_tokens WHERE token_hash=? AND kind='application' AND used_at IS NULL AND expires_at>?", tokenHash, now()).first();
    if (!row) fail2(401, "application_link_expired");
    return { id: "application:" + row.staff_id, application: row.staff_id, tokenHash };
  }
  const access = await authenticate(request, env);
  if (access.response) return { response: access.response };
  const u = access.user;
  if (!u) fail2(401, "hq_sign_in_required");
  if (!u.mfaEnabled) fail2(403, "hq_mfa_required");
  const token2 = (request.headers.get("cookie") || "").match(/(?:^|;\s*)sst_hq_session=([^;]+)/)?.[1];
  if (!token2) fail2(401, "hq_session_required");
  const a = { id: u.id, role: u.role, mfa: true, sessionHash: await digest3(decodeURIComponent(token2)) };
  for (const [field, key] of [["clinicalGovernor", "PARTNER_CLINICAL_APPROVER_IDS"], ["pharmacyGovernor", "PARTNER_PHARMACY_APPROVER_IDS"]]) {
    if ((env[key] || "").split(",").map((x) => x.trim()).includes(String(u.id))) {
      const verified = await query(env, "SELECT user_id FROM clinical_hq_staff WHERE user_id=? AND active=1 AND role='clinician' AND expires_at>? AND registration_number<>'' AND verified_by<>''", u.id, now()).first();
      a[field] = !!verified;
    }
  }
  return a;
}
__name(actorFor, "actorFor");
async function token(env, s, kind, a) {
  const raw = random(), date = now(), expiresAt = new Date(Date.now() + (kind === "application" ? 7 * 864e5 : 864e5)).toISOString(), g = authCondition(a, date), auditId = uid();
  const rs = await env.DB.batch([
    query(env, "INSERT INTO partner_audit SELECT ?,?,?,(SELECT COALESCE(MAX(version),-1)+1 FROM partner_audit WHERE entity_type=? AND entity_id=?),?,?,?,? WHERE " + g.sql, auditId, "staff", s.id, "staff", s.id, String(a.id), kind + "_link_created", "{}", date, ...g.args),
    query(env, "UPDATE partner_access_tokens SET used_at=? WHERE staff_id=? AND kind=? AND used_at IS NULL AND changes()=1", date, s.id, kind),
    query(env, "INSERT INTO partner_access_tokens SELECT ?,?,?,?,NULL,?,? WHERE EXISTS(SELECT 1 FROM partner_audit WHERE id=?)", await digest3(raw), s.id, kind, expiresAt, a.id, date, auditId)
  ]);
  if (rs[0].meta?.changes !== 1) fail2(403, "access_revoked");
  return { link: ORIGIN + "/clinical-portal/partners/" + kind + "#" + raw, expiresAt, sent: false };
}
__name(token, "token");
async function passwordHash(password) {
  if (typeof password !== "string" || password.length < 15 || password.length > 128) fail2(422, "password_15_to_128_characters_required");
  const salt = crypto.getRandomValues(new Uint8Array(16)), key = await crypto.subtle.importKey("raw", new TextEncoder().encode(password), "PBKDF2", false, ["deriveBits"]), bits = new Uint8Array(await crypto.subtle.deriveBits({ name: "PBKDF2", hash: "SHA-256", salt, iterations: 1e5 }, key, 256));
  const b642 = /* @__PURE__ */ __name((v) => btoa(String.fromCharCode(...v)).replaceAll("+", "-").replaceAll("/", "_").replaceAll("=", ""), "b64");
  return "pbkdf2$100000$" + b642(salt) + "$" + b642(bits);
}
__name(passwordHash, "passwordHash");
async function partnerRoute(request, env, authenticate, adapters = {}) {
  const path = new URL(request.url).pathname;
  if (path !== PARTNER_BASE && !path.startsWith(PARTNER_BASE + "/")) return null;
  try {
    if (request.headers.has("Origin") && request.headers.get("Origin") !== ORIGIN) fail2(403, "origin_forbidden");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Application-Token, X-Profile-Version, X-Evidence-Kind", "Cache-Control": "no-store" } });
    if (!["GET", "POST"].includes(request.method)) fail2(405, "method_not_allowed");
    if (request.method === "POST" && request.headers.get("Origin") !== ORIGIN) fail2(403, "origin_required");
    if (env.PARTNER_OPERATIONS_ENABLED !== "true") fail2(503, "partner_operations_not_commissioned");
    const p = path.slice(PARTNER_BASE.length).split("/").filter(Boolean), internalSetup = env.PARTNER_INTERNAL_SETUP_ONLY === "true";
    const internalSupplyRead = p[0] === "fulfilment" && request.method === "GET" && p.length <= 2;
    if (internalSetup && (p[0] === "login" || p[0] === "activation" || p[0] === "application" || p[0] === "fulfilment" && !internalSupplyRead || p.length > 1 && !["action", "audit"].includes(p[1]) && p[0] !== "organisations" && !internalSupplyRead)) fail2(503, "professional_onboarding_not_open");
    if (p[0] === "login" && p[1] === "verify" && p.length === 2 && request.method === "POST") {
      if (env.PARTNER_LOGIN_ENABLED !== "true" || !env.HQ_AUTH) fail2(503, "partner_login_not_commissioned");
      const b = await readJson(request);
      await limitProfessionalAuth(request, env, "mfa", text2(b.challenge, 200));
      return env.HQ_AUTH.fetch(new Request("https://api.shiftsometimber.co.uk/v1/hq/auth/mfa/verify", { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ challenge: text2(b.challenge, 200), code: text2(b.code, 6) }), redirect: "manual" }));
    }
    if (p[0] === "activation" && p.length === 1 && request.method === "POST") {
      const b = await readJson(request), t = await query(env, "SELECT * FROM partner_access_tokens WHERE token_hash=? AND kind='activation' AND used_at IS NULL AND expires_at>?", await digest3(text2(b.token, 64)), now()).first();
      if (!t) fail2(401, "activation_link_expired");
      const s2 = await staff(env, t.staff_id);
      if (s2.status !== "credentials_pending" || !s2.hqUserId) fail2(409, "activation_not_pending");
      const date = now(), hash3 = await passwordHash(b.password), next = { ...s2, passwordSetAt: date, version: s2.version + 1, updatedAt: date }, event = uid();
      const rs = await env.DB.batch([
        query(env, "UPDATE partner_access_tokens SET used_at=? WHERE token_hash=? AND used_at IS NULL AND expires_at>? AND EXISTS(SELECT 1 FROM partner_staff WHERE id=? AND version=?)", date, t.token_hash, date, s2.id, s2.version),
        query(env, "UPDATE hq_users SET password_hash=?,updated_at=? WHERE id=? AND changes()=1", hash3, date, s2.hqUserId),
        query(env, "UPDATE partner_staff SET state_json=?,version=?,updated_at=? WHERE id=? AND version=? AND changes()=1", JSON.stringify(next), next.version, date, s2.id, s2.version),
        query(env, "INSERT INTO partner_audit SELECT ?,?,?,(SELECT COALESCE(MAX(version),-1)+1 FROM partner_audit WHERE entity_type=? AND entity_id=?),?,?,?,? WHERE changes()=1", event, "staff", s2.id, "staff", s2.id, String(s2.hqUserId), "password_created", "{}", date)
      ]);
      if (rs[2].meta?.changes !== 1) fail2(409, "activation_already_used");
      return json({ passwordCreated: true, username: s2.username, next: "Sign in and configure HQ MFA. Patient access remains unavailable until HQ activation." });
    }
    if (p[0] === "login" && p.length === 1 && request.method === "POST") {
      if (env.PARTNER_LOGIN_ENABLED !== "true") fail2(503, "partner_login_not_commissioned");
      const b = await readJson(request), username = text2(b.username, 32).toUpperCase();
      await limitProfessionalAuth(request, env, "login", username);
      const r = await query(env, "SELECT state_json FROM partner_staff WHERE username=?", username).first(), s2 = parse(r);
      if (!s2 || !s2.passwordSetAt || !["credentials_pending", "active"].includes(s2.status)) fail2(401, "invalid_credentials");
      if (typeof b.password !== "string" || b.password.length > 128) fail2(401, "invalid_credentials");
      if (!env.HQ_AUTH) fail2(503, "hq_authentication_unavailable");
      return env.HQ_AUTH.fetch(new Request("https://api.shiftsometimber.co.uk/v1/hq/auth/login", { method: "POST", headers: { Origin: ORIGIN, "Content-Type": "application/json" }, body: JSON.stringify({ email: s2.details.email, password: b.password }), redirect: "manual" }));
    }
    const app = p[0] === "application", a = await actorFor(request, env, authenticate, app);
    if (a.response) return a.response;
    const administrator = admin(a), governor = a.clinicalGovernor || a.pharmacyGovernor;
    if (internalSetup && !administrator) fail2(403, "internal_owner_access_required");
    if (p[0] === "invitations" && p.length === 1) {
      if (!administrator) fail2(403, "owner_approval_required");
      await audit(env, a, "directory", "invitations", "invitation_drafts_viewed");
      if (request.method === "GET") return json({ drafts: await rows2(query(env, "SELECT * FROM partner_invitation_drafts ORDER BY created_at DESC LIMIT 100")), sent: false });
      return json(await prepareInvitation(env, await readJson(request), a, () => authCondition(a, now())), 201);
    }
    if (p[0] === "organisations") {
      if (!administrator) fail2(403, "owner_approval_required");
      if (p.length === 2 && request.method === "POST") {
        const original = parse(await query(env, "SELECT state_json FROM partner_organisations WHERE id=?", p[1]).first());
        if (!original) fail2(404, "partner_not_found");
        const b2 = await readJson(request);
        if (b2.version !== original.version) fail2(409, "partner_changed");
        if (!["approve", "suspend"].includes(b2.action)) fail2(422, "invalid_partner_action");
        const date2 = now(), s3 = { ...original, version: original.version + 1, status: b2.action === "approve" ? "approved" : "suspended", verifiedBy: String(a.id), verifiedAt: date2, verificationReference: text2(b2.verificationReference, 2e3), expiresAt: future(b2.expiresAt, date2) }, g2 = authCondition(a, date2), event = uid();
        const rs2 = await env.DB.batch([query(env, "UPDATE partner_organisations SET state_json=?,version=?,updated_at=? WHERE id=? AND version=? AND " + g2.sql, JSON.stringify(s3), s3.version, date2, s3.id, original.version, ...g2.args), query(env, "INSERT INTO partner_audit SELECT ?,?,?,(SELECT COALESCE(MAX(version),-1)+1 FROM partner_audit WHERE entity_type=? AND entity_id=?),?,?,?,? WHERE changes()=1", event, "organisation", s3.id, "organisation", s3.id, String(a.id), "organisation_" + b2.action, JSON.stringify({ verificationReference: s3.verificationReference }), date2)]);
        if (rs2[0].meta?.changes !== 1) fail2(409, "partner_changed");
        return json(s3);
      }
      if (p.length !== 1) fail2(404, "not_found");
      if (request.method === "GET") {
        await audit(env, a, "directory", "organisations", "organisations_viewed");
        return json({ organisations: (await rows2(query(env, "SELECT state_json FROM partner_organisations ORDER BY updated_at DESC LIMIT 200"))).map(parse) });
      }
      const b = await readJson(request);
      if (!["clinical", "pharmacy"].includes(b.kind)) fail2(422, "invalid_organisation_kind");
      const id = uid(), date = now(), s2 = { id, kind: b.kind, name: text2(b.name, 200), registration: text2(b.registration, 100), premises: text2(b.premises, 1e3), superintendent: text2(b.superintendent, 300), contact: text2(b.contact, 300), status: "pending", version: 0 };
      const g = authCondition(a, date);
      const rs = await env.DB.batch([query(env, "INSERT INTO partner_organisations SELECT ?,0,?,? WHERE " + g.sql, id, JSON.stringify(s2), date, ...g.args), query(env, "INSERT INTO partner_audit SELECT ?,?,?,0,?,?,?,? WHERE changes()=1", uid(), "organisation", id, String(a.id), "organisation_created", "{}", date)]);
      if (rs[0].meta?.changes !== 1) fail2(403, "access_revoked");
      return json(s2, 201);
    }
    if (p[0] === "fulfilment") return await fulfilmentRoute(request, env, a, p.slice(1), adapters);
    if (!p.length) {
      if (!administrator && !governor) fail2(403, "partner_directory_forbidden");
      if (request.method === "GET") {
        await audit(env, a, "directory", "staff", "staff_directory_viewed");
        return json({ staff: (await rows2(query(env, "SELECT state_json FROM partner_staff ORDER BY updated_at DESC LIMIT 200"))).map((r) => summary(parse(r))), providerAssignments: { prescribingClinicianOrGP: { displayName: "TBC", status: "unassigned", verified: false }, dispensingPharmacy: { displayName: "TBC", status: "unassigned", verified: false } }, capabilities: { administrator, internalSetupOnly: internalSetup, clinicalGovernor: !!a.clinicalGovernor, pharmacyGovernor: !!a.pharmacyGovernor } });
      }
      if (!administrator) fail2(403, "owner_approval_required");
      const b = await readJson(request), id = uid(), date = now(), s2 = newStaff(b, id, date);
      const organisation = parse(await query(env, "SELECT state_json FROM partner_organisations WHERE id=?", s2.orgId).first());
      if (!organisation || organisation.kind !== (s2.kind === "clinician" ? "clinical" : "pharmacy")) fail2(422, "matching_partner_organisation_required");
      const g = authCondition(a, date);
      const rs = await env.DB.batch([query(env, "INSERT INTO partner_staff SELECT ?,NULL,NULL,?,?,0,?,? WHERE " + g.sql, id, s2.kind, s2.orgId, JSON.stringify(s2), date, ...g.args), query(env, "INSERT INTO partner_audit SELECT ?,?,?,0,?,?,?,? WHERE changes()=1", uid(), "staff", id, String(a.id), "application_created", "{}", date)]);
      if (rs[0].meta?.changes !== 1) fail2(403, "access_revoked");
      return json(publicStaff(s2), 201);
    }
    let s;
    if (app) s = await staff(env, a.application);
    else if (p[0] === "me") s = parse(await query(env, "SELECT state_json FROM partner_staff WHERE hq_user_id=?", a.id).first());
    else s = await staff(env, p[0]);
    const relevantGovernor = s && (s.kind === "clinician" ? a.clinicalGovernor : a.pharmacyGovernor);
    if (!s || !(administrator || relevantGovernor || String(s.hqUserId) === String(a.id) || a.application === s.id)) fail2(404, "staff_not_found");
    if (app && !["draft", "submitted", "checks_underway", "more_information"].includes(s.status)) fail2(401, "application_link_closed");
    if (p.length === 1 && request.method === "GET") {
      await audit(env, a, "staff", s.id, "staff_profile_viewed");
      return json(publicStaff(s));
    }
    if (p[1] === "audit" && p.length === 2 && request.method === "GET") {
      if (!administrator && !relevantGovernor) fail2(403, "compliance_audit_forbidden");
      await audit(env, a, "staff", s.id, "staff_audit_viewed");
      return json({ events: await rows2(query(env, "SELECT id,actor_id,action,details_json,created_at FROM partner_audit WHERE entity_type='staff' AND entity_id=? ORDER BY version DESC LIMIT 300", s.id)) });
    }
    if (p[1] === "link" && request.method === "POST" && p.length === 2) {
      if (!administrator) fail2(403, "owner_approval_required");
      if (!["draft", "more_information", "submitted", "checks_underway"].includes(s.status)) fail2(409, "application_not_editable");
      return json(await token(env, s, "application", a));
    }
    if (p[1] === "credentials" && request.method === "POST" && p.length === 2) {
      if (!administrator) fail2(403, "owner_approval_required");
      if (!["approved", "credentials_pending"].includes(s.status) || !credentialsCurrent(s, now())) fail2(422, "approved_current_profile_required");
      if (!s.hqUserId) {
        const date = now(), next = { ...s, status: "credentials_pending", version: s.version + 1, updatedAt: date }, g = authCondition(a, date), event = uid();
        const rs = await env.DB.batch([
          query(env, "UPDATE partner_staff SET version=?,updated_at=? WHERE id=? AND version=? AND " + g.sql, next.version, date, s.id, s.version, ...g.args),
          query(env, "INSERT INTO hq_users(email,name,password_hash,role,status,mfa_enabled,created_at,updated_at) SELECT ?,?,'!activation_pending','clinical','active',0,?,? WHERE changes()=1", s.details.email, s.details.name, date, date),
          query(env, "UPDATE partner_staff SET hq_user_id=(SELECT id FROM hq_users WHERE email=?),state_json=json_set(?,'$.hqUserId',(SELECT id FROM hq_users WHERE email=?)) WHERE id=? AND version=? AND changes()=1", s.details.email, JSON.stringify(next), s.details.email, s.id, next.version),
          query(env, "INSERT INTO partner_audit SELECT ?,?,?,(SELECT COALESCE(MAX(version),-1)+1 FROM partner_audit WHERE entity_type=? AND entity_id=?),?,?,?,? WHERE changes()=1", event, "staff", s.id, "staff", s.id, String(a.id), "credentials_prepared", "{}", date)
        ]);
        if (rs[0].meta?.changes !== 1) fail2(409, "profile_changed");
        s = await staff(env, s.id);
      }
      if (s.passwordSetAt) fail2(409, "use_existing_hq_password_recovery");
      return json(await token(env, s, "activation", a));
    }
    if (p[1] === "retention" && p.length === 2 && request.method === "POST") {
      if (!administrator) fail2(403, "owner_approval_required");
      const b = await readJson(request);
      if (b.version !== s.version) fail2(409, "profile_changed");
      if (b.dryRun !== void 0 && typeof b.dryRun !== "boolean") fail2(422, "boolean_dry_run_required");
      const result = await purgeStaffEvidence(env, s, b.evidenceId, a, (original, result2) => saveStaff(env, original, result2, a), { dryRun: b.dryRun !== false });
      return json({ ...result, ...result.state ? { state: publicStaff(result.state) } : {} });
    }
    if (p[1] === "evidence") {
      if (!administrator && !app) fail2(403, "identity_evidence_restricted_to_verifiers");
      if (request.method === "POST" && p.length === 2) {
        if (!env.PARTNER_PRIVATE_FILES) fail2(503, "private_staff_storage_unavailable");
        const kind = request.headers.get("X-Evidence-Kind"), mime = (request.headers.get("Content-Type") || "").split(";")[0];
        if (!EVIDENCE.includes(kind) || !["image/png", "image/jpeg"].includes(mime)) fail2(422, "png_or_jpeg_required");
        const data = await body(request, 5 * 1024 * 1024), png = data[0] === 137 && data[1] === 80 && data[2] === 78 && data[3] === 71 && data[4] === 13 && data[5] === 10 && data[6] === 26 && data[7] === 10, jpeg = data[0] === 255 && data[1] === 216 && data[2] === 255;
        if (data.length < 16 || !(mime === "image/png" ? png : jpeg)) fail2(422, "invalid_image");
        const retentionUntil = future(env.PARTNER_EVIDENCE_RETENTION_UNTIL, now());
        const id = uid(), objectKey = "staff/" + s.id + "/" + id, e = { id, kind, mime, objectKey, digest: await digest3(data), uploadedAt: now(), retentionUntil };
        const result = staffAction(s, { action: "evidence", version: Number(request.headers.get("X-Profile-Version")), evidence: e }, a, now(), uid());
        await env.PARTNER_PRIVATE_FILES.put(objectKey, data, { httpMetadata: { contentType: mime } });
        try {
          s = await saveStaff(env, s, result, a);
        } catch (error) {
          await env.PARTNER_PRIVATE_FILES.delete(objectKey);
          throw error;
        }
        return json(publicStaff(s), 201);
      }
      if (request.method === "GET" && p.length === 3) {
        const e = s.evidence.find((e2) => e2.id === p[2]);
        if (!e || e.retentionUntil <= now()) fail2(404, "evidence_not_available");
        const object = await env.PARTNER_PRIVATE_FILES?.get(e.objectKey);
        if (!object) fail2(503, "evidence_unavailable");
        const current = await staff(env, s.id);
        if (current.version !== s.version) fail2(409, "profile_changed");
        await audit(env, a, "staff", s.id, "staff_evidence_viewed", { evidenceId: e.id });
        return new Response(object.body, { headers: { "Content-Type": e.mime, "Content-Disposition": "inline", "Cache-Control": "no-store, private", "Access-Control-Allow-Origin": ORIGIN, "Access-Control-Allow-Credentials": "true", "Vary": "Origin", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" } });
      }
    }
    if (p[1] === "action" && request.method === "POST" && p.length === 2) {
      const b = await readJson(request);
      if (internalSetup && !["details", "query", "reject", "suspend", "revoke_grant", "hold_evidence", "release_evidence_hold"].includes(b.action)) fail2(503, "professional_onboarding_not_open");
      if (b.action === "evidence") fail2(403, "use_verified_upload_route");
      const organisation = ["approve", "activate", "grant"].includes(b.action) ? await currentPartner(env, s) : null;
      if (b.action === "approve") b.username = s.username || (s.kind === "clinician" ? "CLN-" : "DSP-") + random().slice(0, 12).toUpperCase();
      if (b.action === "activate") {
        const u = await query(env, "SELECT mfa_enabled,status FROM hq_users WHERE id=?", s.hqUserId).first();
        b.accountMfaVerified = u?.mfa_enabled === 1 && u.status === "active";
      }
      const result = staffAction(s, b, a, now(), uid()), projection = [];
      if (b.action === "activate" && result.state.kind === "clinician") {
        const next = result.state, expires = next.checks.map((c) => c.expiresAt).sort()[0];
        projection.push(query(env, "INSERT INTO clinical_hq_staff(user_id,role,active,verified_by,registration_body,registration_number,expires_at) SELECT ?,'clinician',1,?,?,?,? WHERE EXISTS(SELECT 1 FROM partner_audit WHERE id=?) ON CONFLICT(user_id) DO UPDATE SET active=excluded.active,verified_by=excluded.verified_by,registration_body=excluded.registration_body,registration_number=excluded.registration_number,expires_at=excluded.expires_at", next.hqUserId, next.approvedBy, next.details.regulator, next.details.registrationNumber, expires, result.event.id));
      }
      s = await saveStaff(env, s, result, a, projection, organisation);
      return json(publicStaff(s));
    }
    fail2(404, "not_found");
  } catch (e) {
    return json({ error: e.status ? e.message : "partner_operations_unavailable" }, e.status || 503);
  }
}
__name(partnerRoute, "partnerRoute");
async function fulfilmentRoute(request, env, a, p, adapters) {
  if (!a.mfa) fail2(403, "hq_mfa_required");
  const administrator = admin(a), s = parse(await query(env, "SELECT state_json FROM partner_staff WHERE hq_user_id=?", a.id).first());
  if (!administrator && (!s || s.kind !== "dispensing" || s.status !== "active" || !credentialsCurrent(s, now()))) fail2(403, "verified_dispensing_account_required");
  const organisation = !administrator ? await currentPartner(env, s) : null;
  if (!p.length && request.method === "GET") {
    const result = await rows2(administrator ? query(env, "SELECT state_json FROM partner_fulfilment ORDER BY updated_at DESC LIMIT 200") : query(env, "SELECT state_json FROM partner_fulfilment WHERE partner_id=? ORDER BY updated_at DESC LIMIT 200", s.orgId));
    await audit(env, a, "directory", "fulfilment", "fulfilment_queue_viewed");
    return json({ orders: result.map(parse).filter((o) => administrator || permission(s, o.area, "view_fulfilment", now(), o.medicine)).map((o) => ({ orderNumber: o.orderNumber, status: o.status, version: o.version, updatedAt: o.updatedAt, memberReplyReceived: !!o.memberReply })), oversight: administrator });
  }
  const order = decodeURIComponent(p[0] || ""), f = parse(await query(env, "SELECT state_json FROM partner_fulfilment WHERE order_number=?", order).first());
  if (!f || !administrator && (s.orgId !== f.partnerId || !permission(s, f.area, "view_fulfilment", now(), f.medicine))) fail2(404, "order_not_found");
  if (p.length === 1 && request.method === "GET") {
    await audit(env, a, "order", order, "fulfilment_viewed");
    const events = await rows2(query(env, "SELECT actor_id,action,created_at FROM partner_audit WHERE entity_type='order' AND entity_id=? ORDER BY version", order));
    return json({ order: administrator ? { ...memberTracking(f), version: f.version, partnerId: f.partnerId } : f, events, oversight: administrator, ...!administrator ? { prescription: await internalPrescriptionDocument(env, f) } : {} });
  }
  if (p[1] === "action" && p.length === 2 && request.method === "POST") {
    if (administrator) fail2(403, "pharmacy_staff_account_required");
    if (env.PARTNER_FULFILMENT_ENABLED !== "true") fail2(503, "dispensing_not_commissioned");
    const b = await readJson(request), current = ["accept", "prepare", "dispatch"].includes(b.action) ? await adapters.prescriptionCurrent?.(f) : false, stock = ["prepare", "dispatch"].includes(b.action) ? await adapters.stockAvailable?.(f) : false, date = now(), result = fulfilmentAction(f, b, s, a, date, uid(), { prescriptionCurrent: current === true, stockAvailable: stock === true }), g = authCondition(a, date);
    const rs = await env.DB.batch([
      query(env, "UPDATE partner_fulfilment SET state_json=?,version=?,updated_at=? WHERE order_number=? AND version=? AND " + g.sql + " AND EXISTS(SELECT 1 FROM partner_staff WHERE id=? AND version=? AND state_json=?) AND EXISTS(SELECT 1 FROM partner_organisations WHERE id=? AND version=? AND state_json=?)", JSON.stringify(result.state), result.state.version, date, order, f.version, ...g.args, s.id, s.version, JSON.stringify(s), organisation.id, organisation.version, JSON.stringify(organisation)),
      query(env, "INSERT INTO partner_audit SELECT ?,?,?,(SELECT COALESCE(MAX(version),-1)+1 FROM partner_audit WHERE entity_type=? AND entity_id=?),?,?,?,? WHERE changes()=1", result.event.id, "order", order, "order", order, String(a.id), result.event.action, JSON.stringify({ ...result.event.details, source: "partner_portal", orderVersion: result.state.version, permissionVersion: s.version, beforeStatus: f.status, afterStatus: result.state.status, memberMessage: result.state.message || null, tracking: result.state.tracking || null }), date),
      query(env, "INSERT INTO partner_notification_outbox SELECT ?,?,?,?,?,'draft',? WHERE EXISTS(SELECT 1 FROM partner_audit WHERE id=?)", uid(), result.event.id, order, f.memberId, "order_status_update", date, result.event.id),
      ...orderNotificationReviewStatements(env, result.state, result.event),
      ...await orderEventStatements(env, result.state, result.event)
    ]);
    if (rs[0].meta?.changes !== 1) fail2(409, "order_or_permissions_changed");
    return json({ order: result.state, notificationStatus: "draft_not_sent" });
  }
  fail2(404, "not_found");
}
__name(fulfilmentRoute, "fulfilmentRoute");

// clinical-context.mjs
var CONTEXT_NOTICE = "clinical-app-sharing-v1";
var fail3 = /* @__PURE__ */ __name((status, code) => {
  throw Object.assign(Error(code), { status });
}, "fail");
var rows3 = /* @__PURE__ */ __name(async (q3) => (await q3.all()).results, "rows");
var hash2 = /* @__PURE__ */ __name(async (value) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))), (b) => b.toString(16).padStart(2, "0")).join(""), "hash");
async function contextSharing(env, record) {
  if (env.CLINICAL_CONTEXT_ENABLED !== "true") return { enabled: false, revision: 0, scopes: [], noticeVersion: CONTEXT_NOTICE };
  const row = await env.DB.prepare("SELECT * FROM clinical_context_sharing WHERE record_id=? ORDER BY revision DESC LIMIT 1").bind(record.id).first();
  return { enabled: true, revision: row?.revision || 0, scopes: row ? JSON.parse(row.scopes_json) : [], noticeVersion: CONTEXT_NOTICE, changedAt: row?.created_at || null };
}
__name(contextSharing, "contextSharing");
async function columns(env, table) {
  return new Set((await rows3(env.DB.prepare("PRAGMA table_info(" + table + ")"))).map((c) => c.name));
}
__name(columns, "columns");
var has = /* @__PURE__ */ __name((set, names) => names.every((n) => set.has(n)), "has");
async function clinicalContext(env, record) {
  const sharing = await contextSharing(env, record);
  if (!sharing.enabled) return { enabled: false, sharing, orders: [], updates: [], sources: [], digest: null };
  const now4 = /* @__PURE__ */ new Date(), since = new Date(now4.getTime() - 90 * 864e5).toISOString(), until = now4.toISOString(), updates = [], sources = [];
  const orderColumns = await columns(env, "medicine_orders");
  let orders = [], orderSource = "unavailable";
  if (has(orderColumns, ["order_number", "user_id", "medicine_name", "strength_label", "status", "created_at"])) {
    orders = await rows3(env.DB.prepare("SELECT order_number,medicine_name,strength_label,status,created_at" + (orderColumns.has("clinical_status") ? ",clinical_status" : "") + " FROM medicine_orders WHERE user_id=? ORDER BY created_at DESC,order_number DESC LIMIT 201").bind(record.user_id));
    orderSource = "available";
  }
  const moreOrders = orders.length > 200;
  orders = orders.slice(0, 200).map((o) => ({ ...o, prescriptionStatus: "Issuance not verified in this system" }));
  const scopes = new Set(sharing.scopes), progress = await columns(env, "progress_entries");
  if (scopes.has("weight")) {
    if (has(progress, ["id", "user_id", "recorded_on", "weight_kg", "created_at"])) {
      const weights = await rows3(env.DB.prepare("SELECT id,recorded_on,weight_kg,created_at" + (progress.has("source") ? ",source" : "") + " FROM progress_entries WHERE user_id=? AND weight_kg IS NOT NULL AND recorded_on>=? AND recorded_on<=? ORDER BY recorded_on DESC,id DESC LIMIT 1001").bind(record.user_id, since.slice(0, 10), until.slice(0, 10)));
      sources.push({ name: "progress_entries", status: "available", truncated: weights.length > 1e3 });
      for (const r of weights.slice(0, 1e3)) updates.push({ id: "progress:" + r.id, kind: "weight", occurredAt: r.recorded_on, recordedAt: r.created_at, source: "My Timber weight log", reportedBy: r.source ? "recorded source " + r.source : "member", details: { weightKg: r.weight_kg } });
    } else sources.push({ name: "progress_entries", status: "unavailable" });
  }
  if (scopes.size) {
    const events = await columns(env, "member_treatment_events"), treatments = await columns(env, "member_treatment_records");
    if (has(events, ["id", "user_id", "treatment_id", "kind", "body_json", "source", "occurred_at", "created_at"]) && has(treatments, ["id", "user_id", "medicine"])) {
      const entries = await rows3(env.DB.prepare("SELECT e.id,e.kind,e.body_json,e.source,e.occurred_at,e.created_at,t.medicine FROM member_treatment_events e JOIN member_treatment_records t ON t.id=e.treatment_id AND t.user_id=e.user_id WHERE e.user_id=? AND e.kind IN ('dose_taken','checkin') AND e.occurred_at>=? AND e.occurred_at<=? ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1001").bind(record.user_id, since, until));
      sources.push({ name: "member_treatment_events", status: "available", truncated: entries.length > 1e3 });
      for (const r of entries.slice(0, 1e3)) {
        const body2 = JSON.parse(r.body_json), base2 = { id: "treatment:" + r.id, occurredAt: r.occurred_at, recordedAt: r.created_at, source: "My Timber treatment log", reportedBy: r.source === "member" ? "member" : "recorded source " + r.source, medicine: r.medicine };
        if (r.kind === "dose_taken" && scopes.has("doses")) updates.push({ ...base2, kind: "dose", details: { doseStrength: body2.doseStrength || "Not recorded" } });
        const c = body2.checkin;
        if (r.kind === "checkin" && c) {
          const details = {};
          if (scopes.has("weight") && c.weight != null) details.weightKg = c.weight;
          if (scopes.has("symptoms")) {
            for (const k of ["sideEffects", "symptomType", "symptomSeverity", "symptomImpact", "symptomStartedAt", "appetite", "energy"]) if (c[k] !== void 0) details[k] = c[k];
          }
          if (Object.keys(details).length) updates.push({ ...base2, kind: "treatment_checkin", details });
        }
      }
    } else sources.push({ name: "member_treatment_events", status: "unavailable" });
  }
  updates.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
  const latestSharing = await contextSharing(env, record);
  if (latestSharing.revision !== sharing.revision) fail3(409, "sharing_changed");
  const digest4 = await hash2({ sharingRevision: sharing.revision, orders, updates, sources, orderSource });
  return { enabled: true, sharing, orders, orderSource, moreOrders, updates, sources, windowDays: 90, since: since.slice(0, 10), digest: digest4, continuousMonitoring: false };
}
__name(clinicalContext, "clinicalContext");

// casework.mjs
var kinds = /* @__PURE__ */ new Set(["photo_id", "front_photo", "scale_photo", "prescription"]);
var fail4 = /* @__PURE__ */ __name((status, code) => {
  throw Object.assign(Error(code), { status });
}, "fail");
var rows4 = /* @__PURE__ */ __name(async (q3) => (await q3.all()).results, "rows");
var now2 = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "now");
var clean = /* @__PURE__ */ __name((v, max = 4e3) => {
  if (typeof v !== "string" || !v.trim() || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) fail4(422, "message_required");
  return v.trim();
}, "clean");
async function clinicalStaff(env, actor2, role) {
  const staff2 = await env.DB.prepare("SELECT * FROM clinical_hq_staff WHERE user_id=? AND active=1 AND expires_at>?").bind(actor2.id, now2()).first();
  if (!staff2 || staff2.role !== role || !staff2.verified_by || role === "clinician" && (!staff2.registration_number || !staff2.registration_body)) fail4(403, "clinical_role_required");
  if (role === "clinician") await clinicianPermission(env, actor2);
  return staff2;
}
__name(clinicalStaff, "clinicalStaff");
async function caseView(env, record, reviewer = false) {
  const state = await env.DB.prepare("SELECT * FROM clinical_case_state WHERE record_id=?").bind(record.id).first();
  const events = await rows4(env.DB.prepare("SELECT * FROM clinical_case_events WHERE record_id=? ORDER BY version").bind(record.id));
  const latest = await env.DB.prepare("SELECT version,submitted FROM clinical_member_versions WHERE record_id=? ORDER BY version DESC LIMIT 1").bind(record.id).first();
  const answered = new Set(events.filter((e) => e.kind === "member_reply").map((e) => JSON.parse(e.public_json).requestId));
  const pending = events.some((e) => e.kind === "information_requested" && !answered.has(e.id));
  const stale = !!state && state.assessment_version !== latest?.version;
  const prescription = await memberPrescription(env, record);
  return { version: state?.version || 0, status: prescription?.status === "issued" ? "prescription_issued" : !record.review_sharing ? "draft" : pending ? "needs_information" : stale ? "awaiting_review" : state?.status || record.status, assessmentVersion: latest?.version || 0, decisionOutdated: stale, events: events.filter((e) => reviewer || e.kind !== "internal_note").map((e) => ({ id: e.id, version: e.version, assessmentVersion: e.assessment_version, kind: e.kind, createdAt: e.created_at, ...JSON.parse(e.public_json), ...reviewer ? { clinical: JSON.parse(e.private_json), actorUserId: e.actor_user_id, actorKind: e.actor_kind } : {} })), prescription, prescriptionIssued: prescription?.status === "issued", pharmacyReleased: prescription?.status === "issued", fulfilment: await memberFulfilment(env, record) };
}
__name(caseView, "caseView");
async function caseQueue(env, actor2, operations = false) {
  await clinicalStaff(env, actor2, operations ? "operations" : "clinician");
  const records = operations ? await rows4(env.DB.prepare("SELECT id,user_id,order_number,status,revision,review_sharing,updated_at FROM clinical_member_records ORDER BY updated_at DESC LIMIT 200")) : await rows4(env.DB.prepare("SELECT r.* FROM clinical_member_records r JOIN clinical_case_assignments a ON a.record_id=r.id WHERE a.hq_user_id=? AND a.active=1 AND a.expires_at>? ORDER BY r.updated_at LIMIT 200").bind(actor2.id, now2()));
  const out = [];
  for (const r of records) {
    const view2 = await caseView(env, { ...r, review_sharing: r.review_sharing });
    out.push({ id: r.id, memberId: r.user_id, orderNumber: r.order_number, status: !r.review_sharing && view2.events.some((e) => e.kind === "information_requested") ? "needs_information" : view2.status, availableForReview: !!r.review_sharing, updatedAt: r.updated_at, caseVersion: view2.version, assessmentVersion: view2.assessmentVersion, decisionOutdated: view2.decisionOutdated, prescriptionIssued: view2.prescriptionIssued });
  }
  return { records: out, limit: 200, operations };
}
__name(caseQueue, "caseQueue");
async function caseAction(env, record, actor2, reviewer, b) {
  if (!b || !Number.isInteger(b.version) || !Number.isInteger(b.assessmentVersion)) fail4(422, "version_required");
  if (reviewer) {
    const staff2 = await clinicalStaff(env, actor2, "clinician");
    if (actor2.role !== "clinical") fail4(403, "clinical_role_required");
  }
  const assessment = await env.DB.prepare("SELECT * FROM clinical_member_versions WHERE record_id=? ORDER BY version DESC LIMIT 1").bind(record.id).first();
  if (!assessment || !assessment.submitted || !record.review_sharing || b.assessmentVersion !== assessment.version) fail4(409, "submitted_assessment_required");
  await env.DB.prepare("INSERT OR IGNORE INTO clinical_case_state VALUES(?,0,?,?,?)").bind(record.id, "awaiting_review", assessment.version, now2()).run();
  const state = await env.DB.prepare("SELECT * FROM clinical_case_state WHERE record_id=?").bind(record.id).first();
  if (state.version !== b.version) fail4(409, "case_changed");
  const effective = state.assessment_version === assessment.version ? state.status : "awaiting_review";
  const history = await rows4(env.DB.prepare("SELECT * FROM clinical_case_events WHERE record_id=? ORDER BY version").bind(record.id));
  const answered = new Set(history.filter((e) => e.kind === "member_reply").map((e) => JSON.parse(e.public_json).requestId));
  const outstanding = history.filter((e) => e.kind === "information_requested" && !answered.has(e.id));
  const permissionProof = reviewer ? await clinicianPermission(env, actor2, b.action === "decision" ? "clinical_decision" : b.action === "request_information" || b.action === "review_evidence" && b.outcome !== "approve" ? "query" : "review", b.handover?.medicine) : null;
  let kind, status = effective, publicData = {}, privateData = {}, recipient;
  if (!reviewer) {
    if (b.action !== "reply") fail4(403, "member_action_not_allowed");
    const requested = outstanding.find((e) => e.id === b.requestId);
    if (!requested) fail4(409, "request_not_open");
    if (assessment.version <= requested.assessment_version) fail4(409, "resubmit_updated_assessment");
    const req = JSON.parse(requested.public_json), files = JSON.parse(assessment.evidence_json), old = await env.DB.prepare("SELECT evidence_json FROM clinical_member_versions WHERE record_id=? AND version=?").bind(record.id, requested.assessment_version).first(), oldIds = new Set(JSON.parse(old.evidence_json).map((e) => e.id));
    for (const k of req.evidenceKinds) if (!files.some((e) => e.kind === k && !oldIds.has(e.id))) fail4(422, "replacement_evidence_required");
    kind = "member_reply";
    publicData = { requestId: requested.id, message: clean(b.message) };
    status = outstanding.length > 1 ? "needs_information" : "awaiting_review";
    recipient = requested.actor_user_id;
  } else if (b.action === "review_evidence") {
    if (!["awaiting_review", "in_review", "needs_information"].includes(effective)) fail4(409, "case_closed");
    const files = JSON.parse(assessment.evidence_json), file = files.find((e) => e.id === b.evidenceId);
    if (!file || file.kind === "photo_id") fail4(422, "medical_evidence_required");
    if (!["approve", "reject", "query"].includes(b.outcome)) fail4(422, "invalid_evidence_decision");
    if (outstanding.some((e) => JSON.parse(e.public_json).evidenceId === file.id)) fail4(409, "request_already_open");
    publicData = { evidenceId: file.id, evidenceKind: file.kind, evidenceDigest: file.digest, outcome: b.outcome, message: b.outcome === "approve" ? "Document accepted." : clean(b.message) };
    if (b.outcome === "approve") {
      kind = "evidence_reviewed";
    } else {
      kind = "information_requested";
      publicData.evidenceKinds = b.outcome === "reject" ? [file.kind] : [];
      status = "needs_information";
      recipient = record.user_id;
    }
  } else if (b.action === "request_information") {
    if (!["awaiting_review", "in_review", "needs_information"].includes(effective)) fail4(409, "case_closed");
    if (!Array.isArray(b.evidenceKinds) || b.evidenceKinds.length > 4 || new Set(b.evidenceKinds).size !== b.evidenceKinds.length || b.evidenceKinds.some((k) => !kinds.has(k))) fail4(422, "invalid_evidence_kind");
    if (outstanding.length) fail4(409, "request_already_open");
    kind = "information_requested";
    status = "needs_information";
    publicData = { message: clean(b.message), evidenceKinds: b.evidenceKinds };
    recipient = record.user_id;
  } else if (b.action === "start_review") {
    if (effective !== "awaiting_review" || outstanding.length) fail4(409, "case_not_ready");
    kind = "review_started";
    status = "in_review";
  } else if (b.action === "review_updates") {
    const context = await clinicalContext(env, record);
    if (!context.enabled || !context.updates.length) fail4(409, "no_shared_updates");
    if (b.digest !== context.digest) fail4(409, "updates_changed");
    kind = "app_updates_reviewed";
    publicData = { message: "Your shared My Timber updates were reviewed.", count: context.updates.length };
    privateData = { digest: context.digest, sharingRevision: context.sharing.revision, updates: context.updates, sources: context.sources };
  } else if (b.action === "note") {
    kind = "internal_note";
    privateData = { note: clean(b.note) };
  } else if (b.action === "decision") {
    if (effective !== "in_review" || outstanding.length) fail4(409, "case_not_ready");
    if (!["proceed", "decline", "consultation"].includes(b.outcome)) fail4(422, "invalid_decision");
    if (b.outcome === "proceed") {
      const latestFiles = /* @__PURE__ */ new Map();
      for (const e of JSON.parse(assessment.evidence_json)) latestFiles.set(e.kind, e);
      for (const file of latestFiles.values()) {
        if (file.kind === "photo_id") continue;
        const review = history.filter((e) => {
          const d = JSON.parse(e.public_json);
          return d.evidenceId === file.id && d.evidenceDigest === file.digest;
        }).at(-1);
        if (!review || JSON.parse(review.public_json).outcome !== "approve") fail4(422, "medical_evidence_approval_required");
      }
      if (b.identityVerified !== true || b.independentMeasurementsVerified !== true) fail4(422, "verification_required");
      privateData.verification = clean(b.verification);
      privateData.handover = validateCareHandover(b.handover);
    }
    kind = "clinical_decision";
    status = { proceed: "ready_for_prescription", decline: "declined", consultation: "consultation_required" }[b.outcome];
    publicData = { outcome: b.outcome, message: clean(b.message) };
    privateData.rationale = clean(b.rationale);
    recipient = record.user_id;
  } else fail4(422, "unknown_case_action");
  const sharingGuard = kind === "app_updates_reviewed" ? " AND COALESCE((SELECT MAX(revision) FROM clinical_context_sharing WHERE record_id=?),0)=?" : "";
  const sharingArgs = kind === "app_updates_reviewed" ? [record.id, privateData.sharingRevision] : [];
  if (permissionProof) privateData.permissionVersion = permissionProof.version;
  const id = crypto.randomUUID(), date = now2(), version = state.version + 1;
  const staffGuard = reviewer ? " AND EXISTS(SELECT 1 FROM clinical_case_assignments WHERE record_id=? AND hq_user_id=? AND active=1 AND expires_at>?) AND EXISTS(SELECT 1 FROM clinical_hq_staff WHERE user_id=? AND active=1 AND role='clinician' AND verified_by IS NOT NULL AND verified_by<>'' AND registration_number IS NOT NULL AND registration_number<>'' AND registration_body IS NOT NULL AND registration_body<>'' AND expires_at>?)" : "";
  const staffArgs = reviewer ? [record.id, actor2.id, date, actor2.id, date] : [];
  const scopeGuard = permissionProof ? " AND EXISTS(SELECT 1 FROM partner_staff WHERE id=? AND version=?) AND EXISTS(SELECT 1 FROM partner_organisations WHERE id=? AND version=?)" : "";
  const scopeArgs = permissionProof ? [permissionProof.staffId, permissionProof.version, permissionProof.organisationId, permissionProof.organisationVersion] : [];
  const statements = [env.DB.prepare("INSERT INTO clinical_case_events(id,record_id,version,assessment_version,actor_user_id,actor_kind,kind,public_json,private_json,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM clinical_case_state WHERE record_id=? AND version=?) AND EXISTS(SELECT 1 FROM clinical_member_records WHERE id=? AND revision=? AND review_sharing=1)" + sharingGuard + staffGuard + scopeGuard).bind(id, record.id, version, assessment.version, actor2.id, reviewer ? "hq" : "member", kind, JSON.stringify(publicData), JSON.stringify(privateData), date, record.id, state.version, record.id, record.revision, ...sharingArgs, ...staffArgs, ...scopeArgs)];
  statements.push(env.DB.prepare("UPDATE clinical_case_state SET version=?,status=?,assessment_version=?,updated_at=? WHERE record_id=? AND version=? AND EXISTS(SELECT 1 FROM clinical_case_events WHERE id=?)").bind(version, status, assessment.version, date, record.id, state.version, id));
  if (recipient !== void 0) statements.push(env.DB.prepare("INSERT INTO clinical_case_outbox SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM clinical_case_events WHERE id=?)").bind(crypto.randomUUID(), id, recipient, reviewer ? "member" : "hq", reviewer ? kind === "information_requested" ? "member_action_needed" : "member_case_update" : "reviewer_case_update", (reviewer ? "/member/treatment-records?record=" : "/?view=clinical&record=") + record.id, "pending", date, id));
  statements.push(...notificationEventStatements(env, record, { id, kind, source: "case", sourceId: id, at: date }));
  const result = await env.DB.batch(statements);
  if (Number(result[0].meta?.changes) !== 1) fail4(409, "case_changed");
  return caseView(env, record, reviewer);
}
__name(caseAction, "caseAction");

// prescriptions/store.mjs
var query2 = /* @__PURE__ */ __name((env, sql2, ...args) => env.DB.prepare(sql2).bind(...args), "query");
var rows5 = /* @__PURE__ */ __name(async (statement) => (await statement.all()).results || [], "rows");
var now3 = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "now");
async function requestState(env, record) {
  if (env.PRESCRIPTION_WORKFLOW_ENABLED !== "true") return null;
  const row = await query2(env, "SELECT state_json FROM clinical_prescription_requests WHERE record_id=? AND member_id=? AND order_number=?", record.id, record.user_id, record.order_number).first();
  return row ? JSON.parse(row.state_json) : null;
}
__name(requestState, "requestState");
async function memberPrescription(env, record) {
  const s = await requestState(env, record);
  if (!s) return null;
  const view2 = memberView(s);
  const clinical = await query2(env, "SELECT version FROM clinical_case_state WHERE record_id=?", record.id).first();
  if (s.recordRevision !== record.revision || !record.review_sharing || clinical?.version !== s.caseVersion) {
    view2.status = "needs_review";
    view2.canRespond = false;
  }
  return view2;
}
__name(memberPrescription, "memberPrescription");
async function clinicianContext(env, actor2, recordId, medicine) {
  if (env.PRESCRIPTION_WORKFLOW_ENABLED !== "true" || env.CLINICAL_CASEWORK_ENABLED !== "true" || env.CLINICAL_REVIEW_READY !== "true") fail(503, "prescription_workflow_not_commissioned");
  if (actor2.role !== "clinical" || !actor2.mfa) fail(403, "verified_prescriber_required");
  const identity = { id: actor2.id, role: actor2.role, mfaEnabled: true }, retainedStaff = await clinicalStaff(env, identity, "clinician");
  const record = await query2(env, "SELECT * FROM clinical_member_records WHERE id=?", recordId).first();
  if (!record || !record.review_sharing || !record.order_number || !await query2(env, "SELECT 1 ok FROM clinical_case_assignments WHERE record_id=? AND hq_user_id=? AND active=1 AND expires_at>?", record.id, actor2.id, now3()).first()) fail(404, "prescription_case_not_found");
  const assessment = await query2(env, "SELECT * FROM clinical_member_versions WHERE record_id=? ORDER BY version DESC LIMIT 1", recordId).first();
  const state = await query2(env, "SELECT * FROM clinical_case_state WHERE record_id=?", recordId).first();
  if (!assessment?.submitted || !state || state.assessment_version !== assessment.version || !["ready_for_prescription", "prescription_issued"].includes(state.status)) fail(409, "completed_current_clinical_review_required");
  const proof = await clinicianPermission(env, identity, "issue_prescription", medicine);
  if (!proof) fail(403, "explicit_prescribing_scope_required");
  const professional = JSON.parse((await query2(env, "SELECT state_json FROM partner_staff WHERE id=?", proof.staffId).first()).state_json);
  const organisation = JSON.parse((await query2(env, "SELECT state_json FROM partner_organisations WHERE id=?", proof.organisationId).first()).state_json);
  text(professional.details.prescribingEntitlement, 1e3);
  if (professional.details.registrationNumber !== retainedStaff.registration_number || professional.details.regulator !== retainedStaff.registration_body) fail(403, "prescriber_registration_records_mismatch");
  const answers = JSON.parse(assessment.answers_json);
  const patient = { name: text(answers.fullName, 200), dateOfBirth: text(answers.dateOfBirth, 30), address: text(answers.address, 500), postcode: text(answers.postcode, 30) };
  const prescriber = {
    id: actor2.id,
    profileId: professional.id,
    profileVersion: professional.version,
    organisationId: organisation.id,
    organisationVersion: organisation.version,
    name: text(professional.details.name, 200),
    registrationBody: text(professional.details.regulator, 100),
    registrationNumber: text(professional.details.registrationNumber, 100),
    qualification: text(professional.details.profession, 200),
    practiceAddress: text(organisation.premises, 1e3)
  };
  const order = await query2(env, "SELECT * FROM medicine_orders WHERE order_number=? AND user_id=?", record.order_number, record.user_id).first();
  if (!order || order.currency !== "GBP" || !Number.isSafeInteger(order.total_pence) || order.total_pence < 0) fail(409, "owned_priced_order_required");
  return { record, assessment, state, proof, professional, organisation, order, patient, prescriber, actor: actor2 };
}
__name(clinicianContext, "clinicianContext");
async function quoteFor(env, context, variantId, packs) {
  const { order } = context;
  if (!Number.isSafeInteger(variantId) || !Number.isSafeInteger(packs) || packs < 1 || packs > 12) fail(422, "prescription_variant_and_packs_required");
  const variant = await query2(env, "SELECT * FROM medicine_variants WHERE id=? AND medicine_id=?", variantId, order.medicine_id).first();
  if (!variant || !["active", "published"].includes(variant.status)) fail(422, "available_same_medicine_variant_required");
  if (!Number.isSafeInteger(variant.selling_price_pence) || variant.selling_price_pence < 0) fail(409, "catalogue_price_unavailable");
  const unchanged = variant.id === order.variant_id && packs === 1;
  if (!unchanged && (order.discount_pence !== 0 || order.discount_code)) fail(409, "discounted_alternative_needs_finance_quote");
  const totalPence = unchanged ? order.total_pence : variant.selling_price_pence * packs;
  const paid = ["paid", "succeeded", "completed", "fulfilled"].includes(order.status) && /^cs_live_/.test(order.stripe_checkout_session_id || "");
  return { variant, quote: {
    currency: "GBP",
    totalPence,
    unitPricePence: variant.selling_price_pence,
    packs,
    paymentState: paid && totalPence <= order.total_pence ? "settled" : totalPence > order.total_pence ? "additional_payment_required" : "not_verified",
    catalogueUpdatedAt: variant.updated_at,
    orderStatus: order.status,
    originalTotalPence: order.total_pence,
    orderUpdatedAt: order.updated_at,
    originalVariantId: order.variant_id,
    originalDiscountPence: order.discount_pence,
    originalDiscountCode: order.discount_code || null
  } };
}
__name(quoteFor, "quoteFor");
async function currentProposal(env, actor2, recordId) {
  const row = await query2(env, "SELECT state_json FROM clinical_prescription_requests WHERE record_id=?", recordId).first();
  if (!row) fail(404, "prescription_not_found");
  const s = JSON.parse(row.state_json), context = await clinicianContext(env, actor2, recordId, s.treatment.medicine);
  if (s.prescriber.id !== actor2.id || s.prescriber.profileVersion !== context.professional.version || s.prescriber.organisationVersion !== context.organisation.version || s.recordRevision !== context.record.revision || s.assessmentVersion !== context.assessment.version || s.assessmentDigest !== context.assessment.digest || s.caseVersion !== context.state.version) fail(409, "prescription_review_changed");
  const priced = await quoteFor(env, context, s.treatment.variantId, s.treatment.packs);
  if (await digest(priced.quote) !== await digest(s.quote)) fail(409, "prescription_price_changed");
  context.variant = priced.variant;
  context.quote = priced.quote;
  return { s, context };
}
__name(currentProposal, "currentProposal");
function sourceGuard(env, context) {
  const { record, assessment, state, order, variant, professional, organisation } = context;
  let sql2 = "EXISTS(SELECT 1 FROM clinical_member_records r JOIN clinical_member_versions a ON a.record_id=r.id JOIN clinical_case_state c ON c.record_id=r.id WHERE r.id=? AND r.user_id=? AND r.order_number=? AND r.revision=? AND r.review_sharing=1 AND a.version=? AND a.digest=? AND a.submitted=1 AND a.version=(SELECT MAX(version) FROM clinical_member_versions WHERE record_id=r.id) AND c.version=? AND c.assessment_version=a.version AND c.status='ready_for_prescription')";
  const args = [record.id, record.user_id, record.order_number, record.revision, assessment.version, assessment.digest, state.version];
  sql2 += " AND EXISTS(SELECT 1 FROM medicine_orders WHERE order_number=? AND user_id=? AND variant_id=? AND total_pence=? AND currency=? AND status=? AND updated_at=? AND discount_pence=? AND COALESCE(discount_code,'')=?)";
  args.push(order.order_number, order.user_id, order.variant_id, order.total_pence, order.currency, order.status, order.updated_at, order.discount_pence, order.discount_code || "");
  if (variant) {
    sql2 += " AND EXISTS(SELECT 1 FROM medicine_variants WHERE id=? AND medicine_id=? AND status=? AND selling_price_pence=? AND updated_at=?)";
    args.push(variant.id, variant.medicine_id, variant.status, variant.selling_price_pence, variant.updated_at);
  }
  if (professional) {
    const date = now3();
    sql2 += " AND EXISTS(SELECT 1 FROM partner_staff WHERE id=? AND version=? AND state_json=?) AND EXISTS(SELECT 1 FROM partner_organisations WHERE id=? AND version=? AND state_json=? AND json_extract(state_json,'$.expiresAt')>?)";
    args.push(professional.id, professional.version, JSON.stringify(professional), organisation.id, organisation.version, JSON.stringify(organisation), date);
    sql2 += " AND EXISTS(SELECT 1 FROM partner_staff p,json_each(p.state_json,'$.grants') g WHERE p.id=? AND json_extract(g.value,'$.credentialVersion')=json_extract(p.state_json,'$.credentialVersion') AND json_extract(g.value,'$.area')='weight_management' AND json_extract(g.value,'$.revokedAt') IS NULL AND json_extract(g.value,'$.startsAt')<=? AND json_extract(g.value,'$.expiresAt')>? AND EXISTS(SELECT 1 FROM json_each(g.value,'$.actions') a WHERE a.value='issue_prescription') AND (json_array_length(g.value,'$.medicines')=0 OR EXISTS(SELECT 1 FROM json_each(g.value,'$.medicines') m WHERE m.value=?)))";
    args.push(professional.id, date, date, order.medicine_name);
  }
  sql2 += " AND NOT EXISTS(SELECT 1 FROM partner_fulfilment WHERE order_number=?)";
  args.push(record.order_number);
  return { sql: sql2, args };
}
__name(sourceGuard, "sourceGuard");
function clinicianGuard(env, context) {
  const a = authCondition(context.actor, now3()), r = sourceGuard(env, context), date = now3();
  return { sql: r.sql + " AND " + a.sql + " AND EXISTS(SELECT 1 FROM clinical_case_assignments WHERE record_id=? AND hq_user_id=? AND active=1 AND expires_at>?) AND EXISTS(SELECT 1 FROM clinical_hq_staff WHERE user_id=? AND active=1 AND role='clinician' AND verified_by<>'' AND registration_body<>'' AND registration_number<>'' AND expires_at>?)", args: [...r.args, ...a.args, context.record.id, context.actor.id, date, context.actor.id, date] };
}
__name(clinicianGuard, "clinicianGuard");
async function commit(env, previous, s, event, guard2, extra = []) {
  const current = previous ? "EXISTS(SELECT 1 FROM clinical_prescription_requests WHERE record_id=? AND version=?)" : "NOT EXISTS(SELECT 1 FROM clinical_prescription_requests WHERE record_id=?)";
  const currentArgs = previous ? [s.recordId, previous.version] : [s.recordId];
  const statements = [
    query2(env, "INSERT INTO clinical_prescription_events SELECT ?,?,?,?,?,?,?,? WHERE " + current + " AND " + guard2.sql, event.id, s.recordId, s.version, event.kind, event.actorKind, event.actorId, JSON.stringify(event.public || {}), event.at, ...currentArgs, ...guard2.args),
    query2(env, "INSERT INTO clinical_prescription_versions SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM clinical_prescription_events WHERE id=?)", s.recordId, s.version, JSON.stringify(s), s.updatedAt, event.id),
    query2(env, "INSERT INTO clinical_prescription_requests SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM clinical_prescription_events WHERE id=?) ON CONFLICT(record_id) DO UPDATE SET version=excluded.version,state_json=excluded.state_json,updated_at=excluded.updated_at", s.recordId, s.orderNumber, s.memberId, s.version, JSON.stringify(s), s.updatedAt, event.id),
    ...extra
  ];
  if (event.kind !== "prescription_issued") statements.push(query2(env, "UPDATE clinical_prescription_finance_tasks SET status='superseded' WHERE record_id=? AND request_version<? AND status='awaiting_review' AND EXISTS(SELECT 1 FROM clinical_prescription_events WHERE id=?)", s.recordId, s.version, event.id));
  if (s.comparison.adjustment !== "none" && event.kind === "prescription_accepted") statements.push(financeStatement(env, s, event, s.comparison.adjustment, s.comparison.amountPence));
  if (["prescription_cancelled", "prescription_declined"].includes(event.kind)) statements.push(financeStatement(env, s, event, "cancellation_review", s.quote.originalTotalPence));
  const out = await env.DB.batch(statements);
  if (out[0].meta?.changes !== 1) fail(409, "prescription_or_access_changed");
  return s;
}
__name(commit, "commit");
function financeStatement(env, s, event, kind, amount) {
  return query2(env, "INSERT OR IGNORE INTO clinical_prescription_finance_tasks SELECT ?,?,?,?,?,?,?,'awaiting_review',?,? WHERE EXISTS(SELECT 1 FROM clinical_prescription_events WHERE id=?)", "rx-finance:" + s.recordId + ":" + s.version + ":" + kind, s.recordId, s.version, s.orderNumber, kind, amount, "GBP", JSON.stringify({ originalTotalPence: s.quote.originalTotalPence, revisedTotalPence: s.quote.totalPence, originalOrderStatus: s.quote.orderStatus, providerRefundVerified: false, reason: "Review and reconcile against payment provider before acting. No refund or charge executed." }), event.at, event.id);
}
__name(financeStatement, "financeStatement");
async function variantsFor(env, context) {
  return (await rows5(query2(env, "SELECT v.id,v.strength_label,v.selling_price_pence,v.status,i.stock_on_hand,i.reserved,i.updated_at AS stock_updated_at FROM medicine_variants v LEFT JOIN medicine_inventory i ON i.variant_id=v.id WHERE v.medicine_id=? AND v.status IN ('active','published') ORDER BY v.sort_order,v.id", context.order.medicine_id))).map((v) => ({ id: v.id, strength: v.strength_label, unitPricePence: v.selling_price_pence, currency: "GBP", stockStatus: v.stock_on_hand === null ? "unavailable" : v.stock_on_hand - v.reserved > 0 ? "recorded_available" : "no_stock", stockUpdatedAt: v.stock_updated_at }));
}
__name(variantsFor, "variantsFor");

// prescriptions/signing.mjs
var RP_ID = "hq.shiftsometimber.co.uk";
var RP_ORIGIN = "https://hq.shiftsometimber.co.uk";
var b64 = /* @__PURE__ */ __name((bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, ""), "b64");
function unb64(s, max = 16e3) {
  if (typeof s !== "string" || !s.length || s.length > max || !/^[A-Za-z0-9_-]+$/.test(s)) fail(422, "invalid_signing_proof");
  try {
    const bytes = Uint8Array.from(atob(s.replaceAll("-", "+").replaceAll("_", "/")), (c) => c.charCodeAt(0));
    if (b64(bytes) !== s) fail(422, "invalid_signing_proof");
    return bytes;
  } catch {
    fail(422, "invalid_signing_proof");
  }
}
__name(unb64, "unb64");
function documentChallenge(documentDigest, prescriberId, nonce) {
  return b64(new TextEncoder().encode(JSON.stringify({ purpose: "shift-prescription-signature-v1", documentDigest, prescriberId, nonce })));
}
__name(documentChallenge, "documentChallenge");
function verifyDocumentChallenge(challenge, documentDigest, prescriberId) {
  let data;
  try {
    data = JSON.parse(new TextDecoder().decode(unb64(challenge, 2e3)));
  } catch {
    fail(403, "signature_not_bound_to_prescription");
  }
  if (data.purpose !== "shift-prescription-signature-v1" || data.documentDigest !== documentDigest || data.prescriberId !== prescriberId || unb64(data.nonce, 100).length !== 32) fail(403, "signature_not_bound_to_prescription");
}
__name(verifyDocumentChallenge, "verifyDocumentChallenge");
var concat = /* @__PURE__ */ __name((...arrays) => {
  const out = new Uint8Array(arrays.reduce((n, a) => n + a.length, 0));
  let i = 0;
  for (const a of arrays) {
    out.set(a, i);
    i += a.length;
  }
  return out;
}, "concat");
var sha = /* @__PURE__ */ __name(async (b) => new Uint8Array(await crypto.subtle.digest("SHA-256", b)), "sha");
var same = /* @__PURE__ */ __name((a, b) => a.length === b.length && a.every((v, i) => v === b[i]), "same");
function clientData(input, type, challenge) {
  const bytes = unb64(input, 6e3);
  let d;
  try {
    d = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    fail(422, "invalid_signing_client_data");
  }
  if (d.type !== type || d.origin !== RP_ORIGIN || d.challenge !== challenge || d.crossOrigin === true || d.topOrigin && d.topOrigin !== RP_ORIGIN) fail(403, "signing_origin_or_challenge_mismatch");
  return bytes;
}
__name(clientData, "clientData");
function readCbor(bytes, start = 0) {
  let offset = start, nodes = 0;
  const parse2 = /* @__PURE__ */ __name((depth = 0) => {
    if (depth > 8 || ++nodes > 100 || offset >= bytes.length) fail(422, "invalid_signing_cbor");
    const initial = bytes[offset++], major = initial >> 5, extra = initial & 31;
    let size;
    if (extra < 24) size = extra;
    else if (extra === 24) {
      if (offset >= bytes.length) fail(422, "invalid_signing_cbor");
      size = bytes[offset++];
    } else if (extra === 25) {
      if (offset + 2 > bytes.length) fail(422, "invalid_signing_cbor");
      size = bytes[offset++] * 256 + bytes[offset++];
    } else fail(422, "unsupported_signing_cbor");
    if (major === 0) return size;
    if (major === 1) return -1 - size;
    if (major === 2 || major === 3) {
      if (size > 16e3 || offset + size > bytes.length) fail(422, "invalid_signing_cbor");
      const v = bytes.slice(offset, offset += size);
      return major === 2 ? v : new TextDecoder().decode(v);
    }
    if (major === 4) {
      if (size > 20) fail(422, "invalid_signing_cbor");
      return Array.from({ length: size }, () => parse2(depth + 1));
    }
    if (major === 5) {
      if (size > 20) fail(422, "invalid_signing_cbor");
      const out = /* @__PURE__ */ new Map();
      for (let i = 0; i < size; i++) {
        const k = parse2(depth + 1);
        if (out.has(k)) fail(422, "duplicate_signing_cbor_key");
        out.set(k, parse2(depth + 1));
      }
      return out;
    }
    fail(422, "unsupported_signing_cbor");
  }, "parse");
  const value = parse2();
  return { value, offset };
}
__name(readCbor, "readCbor");
async function authenticator(bytes, registration) {
  if (bytes.length < 37 || !same(bytes.slice(0, 32), await sha(new TextEncoder().encode(RP_ID)))) fail(403, "signing_rp_mismatch");
  const flags = bytes[32];
  if ((flags & 5) !== 5 || (flags & 24) !== 0) fail(403, "verified_single_device_signing_key_required");
  if (registration && !(flags & 64) || !registration && flags & 64) fail(422, "invalid_authenticator_flags");
  return { flags, counter: new DataView(bytes.buffer, bytes.byteOffset + 33, 4).getUint32(0) };
}
__name(authenticator, "authenticator");
async function verifyRegistration(proof, challenge) {
  clientData(proof.clientDataJSON, "webauthn.create", challenge);
  const attestation = unb64(proof.attestationObject), parsed = readCbor(attestation);
  if (parsed.offset !== attestation.length || !(parsed.value instanceof Map) || parsed.value.get("fmt") !== "none") fail(422, "none_attestation_required");
  const bytes = parsed.value.get("authData");
  if (!(bytes instanceof Uint8Array)) fail(422, "invalid_attestation_auth_data");
  const { flags, counter } = await authenticator(bytes, true);
  if (bytes.length < 55) fail(422, "invalid_attestation_auth_data");
  const n = bytes[53] * 256 + bytes[54];
  if (n < 16 || n > 1024 || bytes.length < 55 + n) fail(422, "invalid_signing_credential");
  const id = b64(bytes.slice(55, 55 + n));
  if (id !== proof.credentialId) fail(422, "signing_credential_mismatch");
  const key = readCbor(bytes, 55 + n), k = key.value;
  if (!(k instanceof Map) || k.get(1) !== 2 || k.get(3) !== -7 || k.get(-1) !== 1 || k.get(-2)?.length !== 32 || k.get(-3)?.length !== 32) fail(422, "es256_signing_key_required");
  if (flags & 128) {
    const ext = readCbor(bytes, key.offset);
    if (ext.offset !== bytes.length) fail(422, "invalid_authenticator_extensions");
  } else if (key.offset !== bytes.length) fail(422, "invalid_authenticator_data_length");
  const jwk = { kty: "EC", crv: "P-256", x: b64(k.get(-2)), y: b64(k.get(-3)), ext: true };
  try {
    await crypto.subtle.importKey("jwk", jwk, { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  } catch {
    fail(422, "invalid_signing_public_key");
  }
  return { credentialId: id, publicKey: jwk, counter };
}
__name(verifyRegistration, "verifyRegistration");
function derToRaw(bytes) {
  if (bytes.length < 8 || bytes.length > 72 || bytes[0] !== 48 || bytes[1] !== bytes.length - 2) fail(422, "invalid_signing_signature");
  let i = 2;
  const out = new Uint8Array(64);
  for (let part = 0; part < 2; part++) {
    if (bytes[i++] !== 2) fail(422, "invalid_signing_signature");
    const n = bytes[i++];
    if (n < 1 || n > 33 || i + n > bytes.length || bytes[i] & 128) fail(422, "invalid_signing_signature");
    let v = bytes.slice(i, i + n);
    i += n;
    if (v.length > 1 && v[0] === 0) {
      if (!(v[1] & 128)) fail(422, "noncanonical_signing_signature");
      v = v.slice(1);
    }
    if (v.length > 32) fail(422, "invalid_signing_signature");
    out.set(v, part * 32 + 32 - v.length);
  }
  if (i !== bytes.length) fail(422, "invalid_signing_signature");
  return out;
}
__name(derToRaw, "derToRaw");
async function verifyAssertion(proof, challenge, key, userId, { historical = false } = {}) {
  if (proof.credentialId !== key.credential_id) fail(403, "signing_key_mismatch");
  const client = clientData(proof.clientDataJSON, "webauthn.get", challenge), auth = unb64(proof.authenticatorData, 6e3), { flags, counter } = await authenticator(auth, false);
  if (flags & 128) {
    const ext = readCbor(auth, 37);
    if (ext.offset !== auth.length) fail(422, "invalid_authenticator_extensions");
  } else if (auth.length !== 37) fail(422, "invalid_authenticator_data_length");
  if (proof.userHandle && new TextDecoder().decode(unb64(proof.userHandle)) !== "hq-prescriber:" + userId) fail(403, "signing_user_mismatch");
  if (!historical && (key.sign_count || counter) && counter <= key.sign_count) fail(409, "signing_counter_replay");
  let publicKey;
  try {
    publicKey = await crypto.subtle.importKey("jwk", JSON.parse(key.public_key_json), { name: "ECDSA", namedCurve: "P-256" }, false, ["verify"]);
  } catch {
    fail(503, "signing_key_unavailable");
  }
  const ok = await crypto.subtle.verify({ name: "ECDSA", hash: "SHA-256" }, publicKey, derToRaw(unb64(proof.signature, 200)), concat(auth, await sha(client)));
  if (!ok) fail(403, "invalid_prescription_signature");
  return { counter, credentialId: proof.credentialId };
}
__name(verifyAssertion, "verifyAssertion");
async function verifySignedDocument(document, storedProof, key) {
  const hash3 = await digest(document);
  verifyDocumentChallenge(storedProof.challenge, hash3, document.prescriber.id);
  await verifyAssertion(storedProof.proof, storedProof.challenge, key, document.prescriber.id, { historical: true });
  return { verified: true, digest: hash3, prescriberId: document.prescriber.id };
}
__name(verifySignedDocument, "verifySignedDocument");

// prescriptions/dispensing.mjs
async function internalPrescriptionCurrent(env, order) {
  if (env.PRESCRIPTION_SIGNING_ENABLED !== "true") return false;
  const row = await query2(env, "SELECT r.state_json,s.document_json,s.digest,s.key_id FROM clinical_prescription_requests r JOIN clinical_prescription_signatures s ON s.record_id=r.record_id AND s.id=? AND s.version=r.version WHERE r.order_number=? AND r.member_id=?", order.prescriptionId, order.orderNumber, order.memberId).first();
  if (!row) return false;
  const state = JSON.parse(row.state_json), doc = JSON.parse(row.document_json);
  if (state.status !== "issued" || state.prescriptionId !== order.prescriptionId || state.partnerId !== order.partnerId || state.version !== order.prescriptionVersion || await digest(doc) !== row.digest || doc.partnerId !== order.partnerId || doc.memberId !== order.memberId || canonical(doc.treatment) !== canonical(order.treatment)) return false;
  const live = await query2(env, "SELECT r.revision,r.review_sharing,a.version,a.digest FROM clinical_member_records r JOIN clinical_member_versions a ON a.record_id=r.id WHERE r.id=? AND r.user_id=? ORDER BY a.version DESC LIMIT 1", state.recordId, order.memberId).first();
  if (!live || !live.review_sharing || live.revision !== state.recordRevision || live.version !== state.assessmentVersion || live.digest !== state.assessmentDigest) return false;
  const key = await query2(env, "SELECT id FROM clinical_prescriber_signing_keys WHERE id=? AND status='approved' AND expires_at>?", row.key_id, now3()).first();
  return !!key;
}
__name(internalPrescriptionCurrent, "internalPrescriptionCurrent");
async function internalStockAvailable(env, order) {
  if (!await internalPrescriptionCurrent(env, order)) return false;
  const row = await query2(env, "SELECT i.stock_on_hand,i.reserved,i.updated_at FROM medicine_inventory i JOIN medicine_variants v ON v.id=i.variant_id WHERE v.id=? AND v.status='active' AND v.sellable=1", order.variantId).first();
  const updated = row?.updated_at, stamp2 = typeof updated === "string" ? Date.parse(updated.includes("T") ? updated : updated.replace(" ", "T") + "Z") : NaN;
  return !!row && Number.isInteger(order.packs) && order.packs > 0 && row.stock_on_hand - row.reserved >= order.packs && Number.isFinite(stamp2) && stamp2 <= Date.now() && Date.now() - stamp2 <= 3e5;
}
__name(internalStockAvailable, "internalStockAvailable");
var internalDispensingAdapters = /* @__PURE__ */ __name((env) => ({ prescriptionCurrent: /* @__PURE__ */ __name((order) => internalPrescriptionCurrent(env, order), "prescriptionCurrent"), stockAvailable: /* @__PURE__ */ __name((order) => internalStockAvailable(env, order), "stockAvailable") }), "internalDispensingAdapters");
async function internalPrescriptionDocument(env, order) {
  if (env.PRESCRIPTION_WORKFLOW_ENABLED !== "true" || !order.recordId) return null;
  const row = await query2(env, "SELECT document_json,digest,proof_json,key_id,created_at FROM clinical_prescription_signatures WHERE id=? AND record_id=? AND version=?", order.prescriptionId, order.recordId, order.prescriptionVersion).first();
  if (!row) fail(503, "signed_prescription_unavailable");
  const document = JSON.parse(row.document_json);
  if (document.orderNumber !== order.orderNumber || document.memberId !== order.memberId || document.partnerId !== order.partnerId || await digest(document) !== row.digest) fail(503, "signed_prescription_integrity_failure");
  const key = await query2(env, "SELECT * FROM clinical_prescriber_signing_keys WHERE id=?", row.key_id).first();
  if (!key) fail(503, "prescription_signing_key_unavailable");
  const proof = JSON.parse(row.proof_json);
  await verifySignedDocument(document, proof, key);
  return { document, digest: row.digest, signedAt: row.created_at, signatureMethod: proof.scheme, cryptographicDocumentBindingVerified: true, current: await internalPrescriptionCurrent(env, order) };
}
__name(internalPrescriptionDocument, "internalPrescriptionDocument");

// prescriptions/api.mjs
var BASE = "/v1/hq/clinical/prescriptions";
var ORIGIN2 = "https://hq.shiftsometimber.co.uk";
var uuid = /^[a-f0-9-]{36}$/;
var issuingDay = /* @__PURE__ */ __name(() => new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" }).format(/* @__PURE__ */ new Date()), "issuingDay");
var json2 = /* @__PURE__ */ __name((body2, status = 200) => Response.json(body2, { status, headers: { "Cache-Control": "no-store, private", "Access-Control-Allow-Origin": ORIGIN2, "Access-Control-Allow-Credentials": "true", "Vary": "Origin", "X-Content-Type-Options": "nosniff" } }), "json");
var eventFor = /* @__PURE__ */ __name((kind, actor2, publicData = {}) => ({ id: crypto.randomUUID(), kind, actorKind: "hq", actorId: actor2.id, at: now3(), public: publicData }), "eventFor");
var activeKey = /* @__PURE__ */ __name((key, context, date) => key && key.hq_user_id === context.actor.id && key.status === "approved" && key.expires_at > date && key.profile_version === context.professional.version && key.organisation_version === context.organisation.version && key.reviewed_by && key.reviewed_by !== context.actor.id && key.verification_reference, "activeKey");
function signingOpen(env) {
  if (env.PRESCRIPTION_SIGNING_ENABLED !== "true" || !env.PRESCRIPTION_SIGNATURE_POLICY_REFERENCE) fail(503, "prescription_signing_awaiting_commissioning");
}
__name(signingOpen, "signingOpen");
function alerts(env, s, event, recipient = "member") {
  const exists = "EXISTS(SELECT 1 FROM clinical_prescription_events WHERE id=?)", out = [];
  if (recipient === "member") {
    out.push(query2(env, "INSERT OR IGNORE INTO clinical_case_outbox SELECT ?,?,?,'member',?,?,'pending',? WHERE " + exists, "prescription:" + event.id, event.id, s.memberId, ["prescription_proposed", "prescription_query"].includes(event.kind) ? "member_action_needed" : "member_case_update", "/member/treatment-records?record=" + s.recordId, event.at, event.id));
    out.push(...notificationEventStatements(env, { id: s.recordId, user_id: s.memberId, order_number: s.orderNumber }, { id: "prescription:" + event.id, kind: event.kind, source: "prescription", sourceId: event.id, at: event.at }));
  } else out.push(query2(env, "INSERT OR IGNORE INTO clinical_case_outbox SELECT ?,?,?,'hq','reviewer_case_update',?,'pending',? WHERE " + exists, "prescription:" + event.id, event.id, s.prescriber.id, "/?view=clinical&record=" + s.recordId, event.at, event.id));
  out.push(query2(env, "UPDATE clinical_notification_channels SET status='superseded',updated_at=? WHERE status IN ('awaiting_approval','prepared') AND event_id IN (SELECT n.id FROM clinical_notification_events n JOIN clinical_prescription_events e ON n.id='prescription:'||e.id WHERE e.record_id=? AND e.id<>? AND e.kind IN ('prescription_proposed','prescription_query')) AND " + exists, event.at, s.recordId, event.id, event.id));
  out.push(query2(env, "UPDATE clinical_case_outbox SET status='superseded' WHERE status='pending' AND event_id IN (SELECT id FROM clinical_prescription_events WHERE record_id=? AND id<>? AND kind IN ('prescription_proposed','prescription_query')) AND " + exists, s.recordId, event.id, event.id));
  return out;
}
__name(alerts, "alerts");
async function unusedChallenge(env, id, actor2, kind, recordId) {
  const c = await query2(env, "SELECT * FROM clinical_prescription_challenges WHERE id=? AND hq_user_id=? AND session_hash=? AND kind=? AND used_at IS NULL AND expires_at>?", id, actor2.id, actor2.sessionHash, kind, now3()).first();
  if (!c || c.record_id !== recordId) fail(409, "signing_challenge_expired_or_used");
  return c;
}
__name(unusedChallenge, "unusedChallenge");
async function newChallenge(env, context, kind, key = null, document = null) {
  signingOpen(env);
  const { actor: actor2, record } = context, date = now3(), id = crypto.randomUUID(), nonce = b64(crypto.getRandomValues(new Uint8Array(32))), documentDigest = document ? await digest(document) : null, challenge = document ? documentChallenge(documentDigest, actor2.id, nonce) : nonce, g = clinicianGuard(env, context), expires = new Date(Date.now() + 12e4).toISOString();
  const r = await query2(env, "INSERT INTO clinical_prescription_challenges SELECT ?,?,?,?,?,?,?,?,?,?,NULL,? WHERE " + g.sql, id, record.id, actor2.id, actor2.sessionHash, kind, context.requestVersion || null, documentDigest, challenge, key?.id || null, expires, date, ...g.args).run();
  if (r.meta?.changes !== 1) fail(409, "prescriber_access_changed");
  return { id, challenge, expiresAt: expires, rpId: RP_ID, userVerification: "required", credentialId: key?.credential_id || null, document };
}
__name(newChallenge, "newChallenge");
async function prescriptionHqRoute(request, env, authenticate) {
  const path = new URL(request.url).pathname;
  if (path !== BASE && !path.startsWith(BASE + "/")) return null;
  try {
    const origin3 = request.headers.get("Origin");
    if (origin3 && origin3 !== ORIGIN2) fail(403, "origin_forbidden");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": ORIGIN2, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Cache-Control": "no-store", "Vary": "Origin" } });
    if (!["GET", "POST"].includes(request.method)) fail(405, "method_not_allowed");
    if (request.method === "POST" && origin3 !== ORIGIN2) fail(403, "origin_required");
    const actor2 = await actorFor(request, env, authenticate);
    if (actor2.response) return actor2.response;
    if (env.PRESCRIPTION_WORKFLOW_ENABLED !== "true") fail(503, "prescription_workflow_not_commissioned");
    const p = path.slice(BASE.length).split("/").filter(Boolean);
    if (p[0] === "finance" && p.length === 1 && request.method === "GET") {
      if (!["owner", "admin"].includes(actor2.role)) fail(403, "finance_review_forbidden");
      const g = authCondition(actor2, now3());
      return json2({ tasks: await rows5(query2(env, "SELECT id,record_id,request_version,order_number,kind,amount_pence,currency,status,created_at FROM clinical_prescription_finance_tasks WHERE " + g.sql + " ORDER BY created_at DESC LIMIT 200", ...g.args)), paymentsExecuted: false });
    }
    if (p[0] === "keys" && p.length === 3 && p[2] === "approve" && request.method === "POST") {
      signingOpen(env);
      if (!actor2.clinicalGovernor) fail(403, "qualified_scope_approver_required");
      const b2 = await readJson(request), key = await query2(env, "SELECT * FROM clinical_prescriber_signing_keys WHERE id=?", p[1]).first();
      if (!key || key.status !== "pending") fail(409, "pending_signing_key_required");
      if (key.hq_user_id === actor2.id) fail(403, "self_approval_forbidden");
      if (b2.version !== key.version || typeof b2.expiresAt !== "string" || !Number.isFinite(Date.parse(b2.expiresAt)) || new Date(b2.expiresAt).toISOString() !== b2.expiresAt || b2.expiresAt <= now3() || Date.parse(b2.expiresAt) > Date.now() + 366 * 864e5) fail(422, "current_key_and_review_expiry_required");
      const profile = await query2(env, "SELECT version FROM partner_staff WHERE hq_user_id=?", key.hq_user_id).first();
      if (!profile || profile.version !== key.profile_version) fail(409, "prescriber_profile_changed");
      const reference = text(b2.verificationReference, 2e3), g = authCondition(actor2, now3()), r = await env.DB.batch([
        query2(env, "UPDATE clinical_prescriber_signing_keys SET status='approved',version=version+1,reviewed_by=?,verification_reference=?,expires_at=? WHERE id=? AND status='pending' AND version=? AND " + g.sql, actor2.id, reference, b2.expiresAt, key.id, key.version, ...g.args),
        query2(env, "INSERT INTO partner_audit SELECT ?, 'signing_key',?,(SELECT COALESCE(MAX(version),-1)+1 FROM partner_audit WHERE entity_type='signing_key' AND entity_id=?),?,'signing_key_approved',?,? WHERE changes()=1", crypto.randomUUID(), key.id, key.id, String(actor2.id), JSON.stringify({ ownerUserId: key.hq_user_id, signaturePolicyReference: env.PRESCRIPTION_SIGNATURE_POLICY_REFERENCE, verificationReference: reference }), now3())
      ]);
      if (r[0].meta?.changes !== 1) fail(409, "signing_key_or_access_changed");
      return json2({ approved: true });
    }
    if (!uuid.test(p[0] || "")) fail(404, "prescription_case_not_found");
    if (env.CLINICAL_CASEWORK_ENABLED !== "true" || env.CLINICAL_REVIEW_READY !== "true") fail(503, "prescription_workflow_not_commissioned");
    const recordId = p[0];
    if (p.length === 1 && request.method === "GET") {
      const order = await query2(env, "SELECT o.medicine_name FROM medicine_orders o JOIN clinical_member_records r ON r.order_number=o.order_number AND r.user_id=o.user_id WHERE r.id=?", recordId).first();
      const context2 = await clinicianContext(env, actor2, recordId, order?.medicine_name), s2 = await requestState(env, context2.record);
      const pharmacies = await rows5(query2(env, "SELECT id,state_json FROM partner_organisations WHERE json_extract(state_json,'$.kind')='pharmacy' AND json_extract(state_json,'$.status')='approved' AND json_extract(state_json,'$.expiresAt')>?", now3()));
      const keys = await rows5(query2(env, "SELECT id,status,expires_at,profile_version,organisation_version FROM clinical_prescriber_signing_keys WHERE hq_user_id=?", actor2.id));
      return json2({ prescription: s2, originalTreatment: { medicine: context2.order.medicine_name, strength: context2.order.strength_label, packs: 1, variantId: context2.order.variant_id }, originalPrice: { totalPence: context2.order.total_pence, currency: "GBP" }, variants: await variantsFor(env, context2), pharmacies: pharmacies.map((o) => ({ id: o.id, name: JSON.parse(o.state_json).name })), keys, canSign: env.PRESCRIPTION_SIGNING_ENABLED === "true" && !!env.PRESCRIPTION_SIGNATURE_POLICY_REFERENCE, initialVersion: s2?.version || 0 });
    }
    if (request.method !== "POST") fail(405, "method_not_allowed");
    const b = await readJson(request);
    if (p[1] === "proposal" && p.length === 2 && request.method === "POST") {
      const owned = await query2(env, "SELECT o.medicine_name FROM medicine_orders o JOIN clinical_member_records r ON r.order_number=o.order_number AND r.user_id=o.user_id WHERE r.id=?", recordId).first();
      const context2 = await clinicianContext(env, actor2, recordId, owned?.medicine_name), previous = await requestState(env, context2.record);
      if (b.version !== (previous?.version || 0)) fail(409, "prescription_changed");
      const pharmacy = await query2(env, "SELECT version,state_json FROM partner_organisations WHERE id=? AND json_extract(state_json,'$.kind')='pharmacy' AND json_extract(state_json,'$.status')='approved' AND json_extract(state_json,'$.expiresAt')>?", b.partnerId, now3()).first();
      if (!pharmacy) fail(422, "approved_dispensing_partner_required");
      const priced = await quoteFor(env, context2, b.treatment?.variantId, b.treatment?.packs);
      context2.variant = priced.variant;
      const date = now3(), s2 = propose(
        previous,
        { ...b, treatment: { ...b.treatment, medicine: context2.order.medicine_name, strength: priced.variant.strength_label } },
        {
          recordId,
          orderNumber: context2.record.order_number,
          memberId: context2.record.user_id,
          assessmentVersion: context2.assessment.version,
          assessmentDigest: context2.assessment.digest,
          recordRevision: context2.record.revision,
          caseVersion: context2.state.version,
          originalTreatment: { medicine: context2.order.medicine_name, strength: context2.order.strength_label, packs: 1, variantId: context2.order.variant_id },
          originalPrice: { totalPence: context2.order.total_pence, currency: "GBP" },
          quote: priced.quote,
          prescriber: context2.prescriber,
          patient: context2.patient
        },
        date
      );
      const event = eventFor("prescription_proposed", actor2, { message: s2.reason }), g = clinicianGuard(env, context2);
      g.sql += " AND EXISTS(SELECT 1 FROM partner_organisations WHERE id=? AND version=? AND state_json=?)";
      g.args.push(b.partnerId, pharmacy.version, pharmacy.state_json);
      await commit(env, previous, s2, event, g, alerts(env, s2, event));
      return json2({ prescription: s2, messagesSent: false });
    }
    const { s, context } = await currentProposal(env, actor2, recordId);
    if (p[1] === "query" && p.length === 2 && request.method === "POST") {
      if (b.version !== s.version) fail(409, "prescription_changed");
      const next = prescriberQuery(s, b.message, now3()), event = eventFor("prescription_query", actor2, { message: next.clinicianQuestion.message });
      await commit(env, s, next, event, clinicianGuard(env, context), alerts(env, next, event));
      return json2({ prescription: next, messagesSent: false });
    }
    if (p[1] === "decline" && p.length === 2 && request.method === "POST") {
      if (b.version !== s.version) fail(409, "prescription_changed");
      const next = decline(s, b.reason, now3()), event = eventFor("prescription_declined", actor2, { message: next.reason });
      await commit(env, s, next, event, clinicianGuard(env, context), alerts(env, next, event));
      return json2({ prescription: next, messagesSent: false });
    }
    if (p[1] === "keys" && p[2] === "challenge" && p.length === 3) {
      context.requestVersion = s.version;
      return json2(await newChallenge(env, context, "register"));
    }
    if (p[1] === "keys" && p[2] === "register" && p.length === 3) {
      signingOpen(env);
      const c = await unusedChallenge(env, b.challengeId, actor2, "register", recordId), proof = await verifyRegistration(b.proof, c.challenge), g = clinicianGuard(env, context), id = crypto.randomUUID();
      const result = await env.DB.batch([
        query2(env, "UPDATE clinical_prescription_challenges SET used_at=? WHERE id=? AND used_at IS NULL AND expires_at>? AND " + g.sql, now3(), c.id, now3(), ...g.args),
        query2(env, "INSERT INTO clinical_prescriber_signing_keys SELECT ?,?,?,?,'pending',0,?,?,?,NULL,NULL,?,? WHERE changes()=1", id, actor2.id, proof.credentialId, JSON.stringify(proof.publicKey), proof.counter, context.professional.version, context.organisation.version, new Date(Date.now() + 30 * 864e5).toISOString(), now3()),
        query2(env, "INSERT INTO partner_audit SELECT ?,'signing_key',?,0,?,'signing_key_registered','{}',? WHERE changes()=1", crypto.randomUUID(), id, String(actor2.id), now3())
      ]);
      if (result[0].meta?.changes !== 1) fail(409, "signing_challenge_or_access_changed");
      return json2({ keyId: id, status: "pending_independent_review" });
    }
    if (p[1] === "signing-challenge" && p.length === 2) {
      signingOpen(env);
      if (b.version !== s.version) fail(409, "prescription_changed");
      const key = await query2(env, "SELECT * FROM clinical_prescriber_signing_keys WHERE id=?", b.keyId).first();
      if (!activeKey(key, context, now3())) fail(403, "approved_current_signing_key_required");
      context.requestVersion = s.version;
      const doc = { ...documentFor(s, now3()), prescriptionId: crypto.randomUUID(), issuedOn: issuingDay() };
      return json2(await newChallenge(env, context, "sign", key, doc));
    }
    if (p[1] === "sign" && p.length === 2) {
      signingOpen(env);
      if (b.version !== s.version) fail(409, "prescription_changed");
      const c = await unusedChallenge(env, b.challengeId, actor2, "sign", recordId), key = await query2(env, "SELECT * FROM clinical_prescriber_signing_keys WHERE id=?", c.key_id).first();
      if (!activeKey(key, context, now3())) fail(403, "approved_current_signing_key_required");
      const doc = b.document;
      if (!uuid.test(doc?.prescriptionId || "") || doc.issuedOn !== issuingDay() || await digest(doc) !== c.document_digest || c.request_version !== s.version || canonical({ ...doc, prescriptionId: void 0, issuedOn: void 0 }) !== canonical(documentFor(s, now3()))) fail(409, "prescription_document_changed");
      verifyDocumentChallenge(c.challenge, c.document_digest, actor2.id);
      const verified = await verifyAssertion(b.proof, c.challenge, key, actor2.id);
      const current = await currentProposal(env, actor2, recordId);
      if (current.s.version !== s.version) fail(409, "prescription_changed");
      const date = now3(), next = { ...s, version: s.version + 1, status: "issued", prescriptionId: doc.prescriptionId, issuedAt: date, updatedAt: date }, event = eventFor("prescription_issued", actor2), g = clinicianGuard(env, current.context);
      g.sql += " AND EXISTS(SELECT 1 FROM clinical_prescription_challenges WHERE id=? AND used_at IS NULL AND expires_at>? AND request_version=? AND document_digest=?) AND EXISTS(SELECT 1 FROM clinical_prescriber_signing_keys WHERE id=? AND status='approved' AND version=? AND sign_count=? AND expires_at>?)";
      g.args.push(c.id, date, s.version, c.document_digest, key.id, key.version, key.sign_count, date);
      const pharmacy = await query2(env, "SELECT version,state_json FROM partner_organisations WHERE id=? AND json_extract(state_json,'$.kind')='pharmacy' AND json_extract(state_json,'$.status')='approved' AND json_extract(state_json,'$.expiresAt')>?", s.partnerId, date).first();
      if (!pharmacy) fail(409, "dispensing_partner_changed");
      g.sql += " AND EXISTS(SELECT 1 FROM partner_organisations WHERE id=? AND version=? AND state_json=?)";
      g.args.push(s.partnerId, pharmacy.version, pharmacy.state_json);
      const f = { orderNumber: s.orderNumber, partnerId: s.partnerId, memberId: s.memberId, prescriptionId: doc.prescriptionId, prescriptionVersion: next.version, recordId: s.recordId, area: "weight_management", medicine: s.treatment.medicine, variantId: s.treatment.variantId, packs: s.treatment.packs, patient: s.patient, directions: s.treatment.directions, quantity: s.treatment.quantity, treatment: s.treatment, status: "received", version: 0, updatedAt: date }, auditId = crypto.randomUUID(), exists = "EXISTS(SELECT 1 FROM clinical_prescription_events WHERE id=?)";
      const extra = [
        query2(env, "UPDATE clinical_prescription_challenges SET used_at=? WHERE id=? AND " + exists, date, c.id, event.id),
        query2(env, "UPDATE clinical_prescriber_signing_keys SET sign_count=? WHERE id=? AND " + exists, verified.counter, key.id, event.id),
        query2(env, "INSERT INTO clinical_prescription_signatures SELECT ?,?,?,?,?,?,?,? WHERE " + exists, doc.prescriptionId, s.recordId, next.version, c.document_digest, canonical(doc), key.id, JSON.stringify({ scheme: "webauthn-es256", challenge: c.challenge, proof: b.proof, publicKey: JSON.parse(key.public_key_json), signaturePolicyReference: env.PRESCRIPTION_SIGNATURE_POLICY_REFERENCE }), date, event.id),
        query2(env, "INSERT INTO partner_fulfilment SELECT ?,?,?,0,?,? WHERE " + exists, s.orderNumber, s.partnerId, s.memberId, JSON.stringify(f), date, event.id),
        query2(env, "INSERT INTO partner_audit SELECT ?,'order',?,0,?,'prescription_received',?,? WHERE " + exists, auditId, s.orderNumber, String(actor2.id), JSON.stringify({ prescriptionId: doc.prescriptionId, prescriptionDigest: c.document_digest }), date, event.id),
        ...orderNotificationReviewStatements(env, f, { id: auditId, at: date }),
        ...await orderEventStatements(env, f, { id: auditId, at: date, action: "prescription_received" }),
        query2(env, "INSERT OR IGNORE INTO clinical_case_outbox SELECT 'pharmacy:'||?||':'||p.hq_user_id,?,p.hq_user_id,'hq','dispensing_action_needed',?,'pending',? FROM partner_staff p WHERE p.org_id=? AND p.kind='dispensing' AND json_extract(p.state_json,'$.status')='active' AND " + exists, event.id, event.id, "/clinical-portal/dispensing?order=" + encodeURIComponent(s.orderNumber), date, s.partnerId, event.id)
      ];
      await commit(env, s, next, event, g, extra);
      return json2({ prescription: next, pharmacyTaskCreated: true, memberUpdatePrepared: true, messagesSent: false });
    }
    fail(404, "not_found");
  } catch (e) {
    return json2({ error: e.status ? e.message : "prescription_workflow_unavailable" }, e.status || 503);
  }
}
__name(prescriptionHqRoute, "prescriptionHqRoute");

// compact-schema.mjs
var schema = {
  "version": "shift-compact-v5-draft-2026-10-23",
  "status": "private_fictional_only_not_clinically_approved",
  "sections": [
    {
      "title": "Core details",
      "questions": [
        {
          "id": "fullName",
          "label": "Full name",
          "type": "text",
          "optional": false
        },
        {
          "id": "dateOfBirth",
          "label": "Date of birth",
          "type": "date",
          "optional": false
        },
        {
          "id": "address",
          "label": "Home address",
          "type": "text",
          "optional": false
        },
        {
          "id": "postcode",
          "label": "Postcode",
          "type": "text",
          "optional": false
        },
        {
          "id": "email",
          "label": "Email",
          "type": "text",
          "optional": false
        },
        {
          "id": "phone",
          "label": "Mobile",
          "type": "text",
          "optional": false
        },
        {
          "id": "deliveryAddress",
          "label": "Delivery address if different",
          "type": "text",
          "optional": true
        },
        {
          "id": "deliveryPostcode",
          "label": "Delivery postcode if different",
          "type": "text",
          "optional": true
        },
        {
          "id": "heightCm",
          "label": "Height in cm",
          "type": "number",
          "optional": false
        },
        {
          "id": "weightKg",
          "label": "Weight in kg",
          "type": "number",
          "optional": false
        },
        {
          "id": "gpName",
          "label": "GP name if known",
          "type": "text",
          "optional": true
        },
        {
          "id": "gpPractice",
          "label": "GP practice",
          "type": "text",
          "optional": false
        },
        {
          "id": "gpAddress",
          "label": "GP address",
          "type": "text",
          "optional": false
        },
        {
          "id": "gpPostcode",
          "label": "GP postcode",
          "type": "text",
          "optional": false
        },
        {
          "id": "insulinUse",
          "label": "Do you use insulin?",
          "type": "select",
          "options": [
            "Yes",
            "No"
          ]
        },
        {
          "id": "weightRelatedCondition",
          "label": "Weight-related condition",
          "type": "select",
          "options": [
            "Yes",
            "No",
            "Not sure"
          ],
          "optional": true
        },
        {
          "id": "previousMedicine",
          "label": "Medicine",
          "type": "text",
          "paths": [
            "Switching provider or medicine",
            "Restarting after a break",
            "Repeat treatment"
          ]
        },
        {
          "id": "previousDose",
          "label": "Actual dose",
          "type": "text",
          "paths": [
            "Switching provider or medicine",
            "Restarting after a break",
            "Repeat treatment"
          ]
        },
        {
          "id": "lastDoseDate",
          "label": "Last dose date",
          "type": "date",
          "paths": [
            "Switching provider or medicine",
            "Restarting after a break",
            "Repeat treatment"
          ]
        }
      ]
    },
    {
      "title": "Your request",
      "questions": [
        {
          "id": "requestPath",
          "label": "Which best describes your request?",
          "type": "select",
          "options": [
            "Starting treatment",
            "Switching provider or medicine",
            "Restarting after a break",
            "Repeat treatment"
          ]
        },
        {
          "id": "forMyself",
          "label": "Is this treatment for you?",
          "type": "select",
          "options": [
            "Yes",
            "No"
          ]
        },
        {
          "id": "inUK",
          "label": "Are you currently in the UK?",
          "type": "select",
          "options": [
            "No",
            "Yes",
            "Not sure"
          ]
        }
      ]
    },
    {
      "title": "Current or previous treatment",
      "questions": [
        {
          "id": "timeOnDose",
          "label": "How long have you taken your current or most recent dose?",
          "type": "text",
          "paths": [
            "Switching provider or medicine",
            "Restarting after a break",
            "Repeat treatment"
          ]
        },
        {
          "id": "nextDoseDate",
          "label": "When is your next dose expected?",
          "type": "date",
          "paths": [
            "Switching provider or medicine",
            "Restarting after a break",
            "Repeat treatment"
          ],
          "optional": true,
          "allowFuture": true
        },
        {
          "id": "missedDoses",
          "label": "Have you missed doses or had a break?",
          "type": "select",
          "paths": [
            "Switching provider or medicine",
            "Restarting after a break",
            "Repeat treatment"
          ],
          "options": [
            "No",
            "Yes",
            "Not sure"
          ]
        },
        {
          "id": "missedDosesDetails",
          "label": "Give the dates or length of the break.",
          "type": "textarea",
          "when": [
            "missedDoses",
            [
              "Yes",
              "Not sure"
            ]
          ],
          "paths": [
            "Switching provider or medicine",
            "Restarting after a break",
            "Repeat treatment"
          ]
        },
        {
          "id": "sideEffects",
          "label": "Have you had any side effects?",
          "type": "select",
          "paths": [
            "Switching provider or medicine",
            "Restarting after a break",
            "Repeat treatment"
          ],
          "options": [
            "No",
            "Yes",
            "Not sure"
          ]
        },
        {
          "id": "sideEffectsDetails",
          "label": "What happened, and is it still happening?",
          "type": "textarea",
          "when": [
            "sideEffects",
            [
              "Yes",
              "Not sure"
            ]
          ],
          "paths": [
            "Switching provider or medicine",
            "Restarting after a break",
            "Repeat treatment"
          ]
        },
        {
          "id": "previousProvider",
          "label": "Who prescribed your previous treatment?",
          "type": "text",
          "paths": [
            "Switching provider or medicine",
            "Restarting after a break",
            "Repeat treatment"
          ]
        }
      ]
    },
    {
      "title": "Medical conditions",
      "questions": [
        {
          "id": "conditionList",
          "label": "Do you have any of the following medical conditions?",
          "type": "multi",
          "options": [
            "Prediabetes",
            "Type 2 diabetes",
            "High blood pressure",
            "High cholesterol",
            "Heart or blood vessel disease (e.g., heart attack, stroke, atrial fibrillation)",
            "Erectile dysfunction",
            "Obstructive sleep apnoea",
            "Asthma",
            "Osteoarthritis",
            "Acid reflux or gastro-oesophageal reflux disease (GORD)",
            "Chronic back pain",
            "Depression",
            "PCOS",
            "NAFLD (Non-Alcoholic Fatty Liver Disease) or MASLD (Metabolic dysfunction-associated steatotic liver disease)",
            "None of the above"
          ]
        }
      ]
    },
    {
      "title": "Medical history",
      "questions": [
        {
          "id": "medicalHistory",
          "label": "Have you ever been diagnosed with any of the following?",
          "type": "select",
          "items": [
            "Severe liver or liver transplant",
            "Kidney disease (eGFR less than 30mL/min)",
            "Heart failure with shortness of breath",
            "History of pancreatitis (inflammation of the pancreas)",
            "Personal or family history (first-degree relatives) of multiple endocrine neoplasia type 2 and medullary thyroid carcinoma",
            "Active cancer, requiring monitoring or treatment",
            "Type 1 diabetes",
            "Diabetes-related eye problems (e.g., diabetic retinopathy)",
            "A current eating disorder or a history of an eating disorder (e.g., anorexia, bulimia, binge eating disorder)",
            "A history of gallstones (if you still have your gallbladder) or gallbladder disease",
            "Any weight loss procedures or surgery in the last 12 months (e.g., gastric sleeve, gastric band, gastric bypass, gastric balloon)",
            "Previous history of bowel or intestinal surgery (excluding appendectomy)",
            "Any uncontrolled or clinically significant endocrine (hormonal) disorder, such as Addison\u2019s disease, Cushing\u2019s syndrome, congenital adrenal hyperplasia, acromegaly, or another growth hormone disorder",
            "Chronic malabsorption syndrome",
            "Current gastrointestinal stoma (e.g. colostomy, ileostomy or other stoma following bowel surgery)",
            "Severe digestive conditions (e.g., Crohn\u2019s disease, ulcerative colitis or gastroparesis)"
          ],
          "options": [
            "Yes - I have one of the above listed conditions",
            "I have other medical conditions",
            "None of the above",
            "Not sure"
          ]
        },
        {
          "id": "medicalHistoryDetails",
          "label": "Please give details.",
          "type": "textarea",
          "when": [
            "medicalHistory",
            [
              "Yes - I have one of the above listed conditions",
              "I have other medical conditions",
              "Not sure"
            ]
          ]
        }
      ]
    },
    {
      "title": "Medicines 1 of 2",
      "questions": [
        {
          "id": "medicines1",
          "label": "Are you currently taking any medications? (1 of 2)",
          "type": "select",
          "items": [
            "Weight loss medication (Orlistat, MySimba)",
            "Parkinson\u2019s medication (levodopa, pramipexole, ropinirole, amantadine, bromocriptine, cabergoline, pergolide, rasagiline, selegiline)",
            "Epilepsy medication (carbamazepine, phenytoin, phenobarbital, primidone, sodium valproate/valproic acid, fenfluramine, divalproex, zonisamide, ethosuximide)",
            "Diabetes medication (insulin, sulfonylureas)",
            "Blood thinners (warfarin, acenocoumarol, phenidione)",
            "Medication that requires close monitoring (azathioprine, lithium, methotrexate, theophylline, mycophenolate mofetil, clozapine, colchicine, isoprenaline)",
            "Immunosuppressants (ciclosporin, tacrolimus, sirolimus)",
            "Medication to control your heart rate (flecainide, quinidine, procainamide, disopyramide, amiodarone, digoxin)"
          ],
          "options": [
            "Yes - I am currently taking one of the above listed medications",
            "I take other medication",
            "None of the above",
            "Not sure"
          ]
        },
        {
          "id": "medicines1Details",
          "label": "List the medicines and doses, including any other prescribed medicines, over-the-counter products, supplements or herbal remedies.",
          "type": "textarea",
          "when": [
            "medicines1",
            [
              "Yes - I am currently taking one of the above listed medications",
              "I take other medication",
              "Not sure"
            ]
          ]
        }
      ]
    },
    {
      "title": "Medicines 2 of 2",
      "questions": [
        {
          "id": "medicines2",
          "label": "Are you currently taking any medications? (2 of 2)",
          "type": "select",
          "items": [
            "Certain antibiotics (Clarithromycin, rifabutin or rifampicin)",
            "Certain antiviral medicines (Paxlovid, ritonavir, cobicistat, telaprevir, nevirapine, efavirenz or etravirine)",
            "Certain antifungal medicines (Itraconazole, oral ketoconazole, posaconazole or voriconazole)",
            "Other medicines (Dexamethasone, modafinil, repaglinide, lumacaftor/ivacaftor, bosentan, gemfibrozil, oral topotecan, simvastatin or rosuvastatin)",
            "Herbal medicines (St John\u2019s wort)"
          ],
          "options": [
            "Yes - I am currently taking one of the above listed medications",
            "None of the above",
            "Not sure"
          ]
        },
        {
          "id": "medicines2Details",
          "label": "List the medicines and doses, including any other prescribed medicines, over-the-counter products, supplements or herbal remedies.",
          "type": "textarea",
          "when": [
            "medicines2",
            [
              "Yes - I am currently taking one of the above listed medications",
              "Not sure"
            ]
          ]
        }
      ]
    },
    {
      "title": "Allergies",
      "questions": [
        {
          "id": "allergies",
          "label": "Are you allergic to any medications?",
          "type": "select",
          "options": [
            "No",
            "Yes",
            "Not sure"
          ]
        },
        {
          "id": "allergiesDetails",
          "label": "What are you allergic to, and what reaction did you have?",
          "type": "textarea",
          "when": [
            "allergies",
            [
              "Yes",
              "Not sure"
            ]
          ]
        },
        {
          "id": "otherAllergies",
          "label": "Do you have any other allergies, including food, latex, plasters or insect stings?",
          "type": "select",
          "options": [
            "No",
            "Yes",
            "Not sure"
          ]
        },
        {
          "id": "otherAllergiesDetails",
          "label": "What are you allergic to, and what reaction did you have?",
          "type": "textarea",
          "when": [
            "otherAllergies",
            [
              "Yes",
              "Not sure"
            ]
          ]
        }
      ]
    },
    {
      "title": "Pregnancy and breastfeeding",
      "questions": [
        {
          "id": "pregnancyPossible",
          "label": "Could you become pregnant?",
          "type": "select",
          "options": [
            "No",
            "Yes",
            "Not sure"
          ]
        },
        {
          "id": "pregnancyStatus",
          "label": "Are you pregnant, planning a pregnancy or breastfeeding?",
          "type": "select",
          "when": [
            "pregnancyPossible",
            [
              "Yes",
              "Not sure"
            ]
          ],
          "options": [
            "No",
            "Pregnant",
            "Planning a pregnancy",
            "Breastfeeding",
            "Not sure"
          ]
        },
        {
          "id": "contraception",
          "label": "What contraception do you use, if any?",
          "type": "text",
          "when": [
            "pregnancyPossible",
            [
              "Yes",
              "Not sure"
            ]
          ]
        }
      ]
    },
    {
      "title": "Current symptoms",
      "questions": [
        {
          "id": "urgentSymptoms",
          "label": "Do you currently have severe persistent stomach pain, sudden loss of vision or a severe allergic reaction?",
          "type": "select",
          "options": [
            "No",
            "Yes",
            "Not sure"
          ]
        },
        {
          "id": "urgentSymptomsDetails",
          "label": "Describe your symptoms and advice already sought. Do not wait for this form to be reviewed to seek medical help.",
          "type": "textarea",
          "when": [
            "urgentSymptoms",
            [
              "Yes",
              "Not sure"
            ]
          ]
        }
      ]
    },
    {
      "title": "GP sharing and confirmations",
      "questions": [
        {
          "id": "gpSharingChoice",
          "label": "May the treating clinical service contact your GP and share relevant care information?",
          "type": "select",
          "options": [
            "Yes",
            "No",
            "Not sure"
          ]
        },
        {
          "id": "gpSharingDetails",
          "label": "Please explain your concerns or restrictions.",
          "type": "textarea",
          "when": [
            "gpSharingChoice",
            [
              "No",
              "Not sure"
            ]
          ]
        },
        {
          "id": "treatmentConfirmation",
          "label": "Please read the treatment information. Can you confirm these points?",
          "type": "select",
          "items": [
            "My answers are complete and accurate; treatment is for my own use.",
            "I will read the medicine leaflet and follow the clinical team\u2019s advice.",
            "I understand treatment requires a prescriber\u2019s decision; payment does not guarantee a prescription.",
            "I will report side effects, new medicines and health changes, and seek urgent medical help for serious symptoms.",
            "I will not combine weight-loss medicines without specific prescriber instructions.",
            "I will follow medicine-specific missed-dose instructions and ask the clinical team about restarting after a break.",
            "If an off-label treatment is proposed, the clinician must explain the specific proposal and obtain consent.",
            "This private environment holds fictional test information only."
          ],
          "options": [
            "I confirm",
            "I need to discuss this"
          ]
        },
        {
          "id": "treatmentConfirmationDetails",
          "label": "What would you like clarified?",
          "type": "textarea",
          "when": [
            "treatmentConfirmation",
            [
              "I need to discuss this"
            ]
          ]
        }
      ]
    }
  ],
  "sourceReference": "competitor-screen-reference-2026-10-23",
  "matchingLimit": "Visible competitor lists retained; uncertainty and targeted safety/treatment branches are explicit SHIFT additions, not unseen competitor transcriptions."
};
var fields = schema.sections.flatMap((s) => s.questions);

// clinician-presentation.mjs
var caseLabels = { draft: "Pending", awaiting_review: "Pending", in_review: "To action", needs_information: "Referred back", consultation_required: "To action", ready_for_prescription: "Ready for prescription", prescription_issued: "Signed off", declined: "Rejected" };
var withheld = /* @__PURE__ */ new Set(["email", "phone", "address", "postcode", "deliveryAddress", "deliveryPostcode", "gpAddress", "gpPostcode", "gpName"]);
var allowed = new Set(fields.map((f) => f.id).filter((id) => !withheld.has(id)));
function clinicianAnswers(answers) {
  return Object.fromEntries(Object.entries(answers).filter(([k]) => allowed.has(k)));
}
__name(clinicianAnswers, "clinicianAnswers");
function questionLabel(key) {
  return fields.find((f) => f.id === key)?.label || key.replaceAll("_", " ");
}
__name(questionLabel, "questionLabel");
function questionnaireSnapshot() {
  return { schemaVersion: schema.version, questions: fields.map(({ id, label, items, options }) => ({ id, label, ...items ? { items } : {}, ...options ? { options } : {} })) };
}
__name(questionnaireSnapshot, "questionnaireSnapshot");
function questionnaireContext(assessment) {
  let declarations;
  try {
    declarations = JSON.parse(assessment.declarations_json || "{}");
  } catch {
    declarations = {};
  }
  const saved = declarations.questionnaire;
  const matched = saved?.schemaVersion === assessment.schema_version && Array.isArray(saved.questions);
  const source = matched ? saved : assessment.schema_version === schema.version ? questionnaireSnapshot() : null;
  return { schemaVersion: assessment.schema_version, status: matched ? "submitted_snapshot" : source ? "catalogue_reference" : "unavailable", questions: source ? source.questions.filter((q3) => allowed.has(q3.id)) : [] };
}
__name(questionnaireContext, "questionnaireContext");

// hq-clinical-api.mjs
var base = "/v1/hq/clinical";
var origin = "https://hq.shiftsometimber.co.uk";
var json3 = /* @__PURE__ */ __name((v, status = 200) => new Response(JSON.stringify(v), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff", "Vary": "Origin", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" } }), "json");
var fail5 = /* @__PURE__ */ __name((status, code) => {
  throw Object.assign(Error(code), { status });
}, "fail");
async function hqClinicalRoute(request, env, authenticate) {
  let auditActor = null, auditRecord = null;
  const path = new URL(request.url).pathname;
  if (path !== base && !path.startsWith(base + "/")) return null;
  try {
    if (request.headers.has("Origin") && request.headers.get("Origin") !== origin) fail5(403, "origin_forbidden");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Cache-Control": "no-store" } });
    if (!["GET", "POST"].includes(request.method)) fail5(405, "method_not_allowed");
    if (request.method === "POST" && request.headers.get("Origin") !== origin) fail5(403, "origin_required");
    const access = await authenticate(request, env);
    if (access.response) return access.response;
    const actor2 = access.user;
    if (!actor2) fail5(401, "hq_sign_in_required");
    auditActor = actor2;
    if (env.CLINICAL_CASEWORK_ENABLED !== "true" || env.CLINICAL_REVIEW_READY !== "true") fail5(503, "clinical_casework_not_open");
    const parts = path.slice(base.length).split("/").filter(Boolean);
    const operations = ["owner", "admin", "operations"].includes(actor2.role);
    if (!operations && actor2.role !== "clinical") fail5(403, "clinical_role_required");
    if (!parts.length && request.method === "GET") {
      const queue = await caseQueue(env, actor2, operations);
      if (queue.records.length) await env.DB.batch(queue.records.map((r) => env.DB.prepare("INSERT INTO clinical_member_audit VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(), r.id, actor2.id, "hq_case_list_viewed", JSON.stringify({ actorKind: "hq", scope: operations ? "operations" : "assigned_clinician" }), (/* @__PURE__ */ new Date()).toISOString())));
      return json3({ ...queue, records: queue.records.map((r) => ({ ...r, displayStatus: caseLabels[r.status] || "Pending" })) });
    }
    if (operations && parts[0] === "staff" && parts.length === 1 && request.method === "GET") {
      await clinicalStaff(env, actor2, "operations");
      return json3({ staff: (await env.DB.prepare("SELECT user_id,registration_body,registration_number,expires_at FROM clinical_hq_staff WHERE active=1 AND role='clinician' AND expires_at>?").bind((/* @__PURE__ */ new Date()).toISOString()).all()).results });
    }
    if (operations && parts[1] === "assignment" && parts.length === 2 && request.method === "POST") {
      await clinicalStaff(env, actor2, "operations");
      if (!/^[a-f0-9-]{36}$/.test(parts[0])) fail5(404, "case_not_found");
      if (Number(request.headers.get("content-length")) > 2e3) fail5(413, "request_too_large");
      const raw = await request.text();
      if (raw.length > 2e3) fail5(413, "request_too_large");
      let b;
      try {
        b = JSON.parse(raw);
      } catch {
        fail5(400, "invalid_json");
      }
      if (!Number.isInteger(b.staffUserId) || typeof b.active !== "boolean") fail5(422, "invalid_assignment");
      const candidate = await clinicalStaff(env, { id: b.staffUserId }, "clinician");
      const record2 = await env.DB.prepare("SELECT id,user_id,review_sharing FROM clinical_member_records WHERE id=?").bind(parts[0]).first();
      if (!record2) fail5(404, "case_not_found");
      const date = (/* @__PURE__ */ new Date()).toISOString(), expiry = new Date(Math.min(Date.parse(candidate.expires_at), Date.now() + 7 * 864e5)).toISOString();
      const statements = [env.DB.prepare("INSERT INTO clinical_case_assignments(record_id,hq_user_id,active,expires_at) VALUES(?,?,?,?) ON CONFLICT(record_id,hq_user_id) DO UPDATE SET active=excluded.active,expires_at=excluded.expires_at").bind(record2.id, b.staffUserId, b.active ? 1 : 0, expiry), env.DB.prepare("INSERT INTO clinical_member_audit VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(), record2.id, actor2.id, "hq_assignment_changed", JSON.stringify({ actorKind: "hq", reviewerHqUserId: b.staffUserId, active: b.active, expiresAt: expiry }), date)];
      if (b.active && record2.review_sharing) statements.push(env.DB.prepare("INSERT INTO clinical_case_outbox VALUES(?,?,?,?,?,?,?,?)").bind(crypto.randomUUID(), "assignment:" + crypto.randomUUID(), b.staffUserId, "hq", "reviewer_case_update", "/?view=clinical&record=" + record2.id, "pending", date));
      await env.DB.batch(statements);
      return json3({ assigned: b.active, staffUserId: b.staffUserId, expiresAt: expiry });
    }
    if (operations) fail5(403, "clinical_role_required");
    await clinicalStaff(env, actor2, "clinician");
    const id = parts[0];
    if (!/^[a-f0-9-]{36}$/.test(id)) fail5(404, "case_not_found");
    const record = await env.DB.prepare("SELECT * FROM clinical_member_records WHERE id=?").bind(id).first();
    const assigned = await env.DB.prepare("SELECT 1 FROM clinical_case_assignments WHERE record_id=? AND hq_user_id=? AND active=1 AND expires_at>?").bind(id, actor2.id, (/* @__PURE__ */ new Date()).toISOString()).first();
    if (!record || !assigned || !record.review_sharing) fail5(404, "case_not_found");
    auditRecord = record.id;
    const assertAccess = /* @__PURE__ */ __name(async (sharingRevision) => {
      await clinicalStaff(env, actor2, "clinician");
      const live = await env.DB.prepare("SELECT r.revision FROM clinical_member_records r JOIN clinical_case_assignments a ON a.record_id=r.id WHERE r.id=? AND r.review_sharing=1 AND a.hq_user_id=? AND a.active=1 AND a.expires_at>?").bind(id, actor2.id, (/* @__PURE__ */ new Date()).toISOString()).first();
      if (!live) fail5(404, "case_not_found");
      if (live.revision !== record.revision) fail5(409, "case_changed");
      if (sharingRevision !== void 0 && (await contextSharing(env, record)).revision !== sharingRevision) fail5(409, "sharing_changed");
    }, "assertAccess");
    if (parts.length === 1 && request.method === "GET") {
      const assessment = await env.DB.prepare("SELECT * FROM clinical_member_versions WHERE record_id=? ORDER BY version DESC LIMIT 1").bind(id).first();
      if (!assessment?.submitted) fail5(409, "submitted_assessment_required");
      await env.DB.prepare("INSERT INTO clinical_member_audit VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(), id, actor2.id, "hq_clinician_viewed", JSON.stringify({ actorKind: "hq", version: assessment.version }), (/* @__PURE__ */ new Date()).toISOString()).run();
      const workflow = await caseView(env, record, true);
      await assertAccess();
      return json3({ record, assessment: { version: assessment.version, answers: clinicianAnswers(JSON.parse(assessment.answers_json)), evidence: JSON.parse(assessment.evidence_json), declarations: JSON.parse(assessment.declarations_json), digest: assessment.digest }, workflow, answerLabels: Object.fromEntries(Object.keys(clinicianAnswers(JSON.parse(assessment.answers_json))).map((k) => [k, questionLabel(k)])), questionContext: questionnaireContext(assessment), contactFieldsWithheld: true, displayStatus: caseLabels[workflow.status] || "Pending", prescriptionIssued: workflow.prescriptionIssued, pharmacyReleased: workflow.pharmacyReleased });
    }
    if (parts[1] === "context" && parts.length === 2 && request.method === "GET") {
      const context = await clinicalContext(env, record);
      if (context.enabled) await env.DB.prepare("INSERT INTO clinical_member_audit VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(), id, actor2.id, "hq_clinical_context_viewed", JSON.stringify({ actorKind: "hq", sharingRevision: context.sharing.revision, digest: context.digest }), (/* @__PURE__ */ new Date()).toISOString()).run();
      await assertAccess(context.sharing.revision);
      return json3(context);
    }
    if (parts[1] === "audit" && parts.length === 2 && request.method === "GET") {
      const url = new URL(request.url), before = url.searchParams.get("before"), beforeId = url.searchParams.get("beforeId");
      if (before && (!/^\d{4}-\d\d-\d\dT/.test(before) || !beforeId)) fail5(400, "invalid_audit_cursor");
      await env.DB.prepare("INSERT INTO clinical_member_audit VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(), id, actor2.id, "hq_audit_viewed", JSON.stringify({ actorKind: "hq" }), (/* @__PURE__ */ new Date()).toISOString()).run();
      const sql2 = "SELECT id,actor_user_id,action,details_json,created_at FROM clinical_member_audit WHERE record_id=? UNION ALL SELECT id,actor_user_id,kind AS action,json_object('actorKind',actor_kind,'assessmentVersion',assessment_version,'public',json(public_json),'clinical',json(private_json)) AS details_json,created_at FROM clinical_case_events WHERE record_id=?";
      const all = (await env.DB.prepare("SELECT * FROM (" + sql2 + ")" + (before ? " WHERE (created_at<? OR (created_at=? AND id<?))" : "") + " ORDER BY created_at DESC,id DESC LIMIT 101").bind(id, id, ...before ? [before, before, beforeId] : []).all()).results;
      const events = all.slice(0, 100).map((e) => ({ ...e, details: JSON.parse(e.details_json), details_json: void 0 }));
      const last = events.at(-1);
      await assertAccess();
      return json3({ events, next: all.length > 100 ? { before: last.created_at, beforeId: last.id } : null });
    }
    if (parts[1] === "evidence" && parts.length === 3 && request.method === "GET") {
      const purpose = new URL(request.url).searchParams.get("view") || "preview";
      if (!["preview", "enlarge"].includes(purpose)) fail5(400, "invalid_evidence_view");
      if (["document", "iframe"].includes(request.headers.get("Sec-Fetch-Dest"))) fail5(403, "portal_view_required");
      const latest = await env.DB.prepare("SELECT version,evidence_json FROM clinical_member_versions WHERE record_id=? ORDER BY version DESC LIMIT 1").bind(id).first();
      if (!latest || !JSON.parse(latest.evidence_json).some((e2) => e2.id === parts[2])) fail5(404, "evidence_not_found");
      const e = await env.DB.prepare("SELECT * FROM clinical_member_evidence WHERE id=? AND record_id=?").bind(parts[2], id).first();
      if (!e) fail5(404, "evidence_not_found");
      const object = await env.CLINICAL_PRIVATE_FILES.get(e.object_key);
      if (!object) fail5(503, "evidence_unavailable");
      await env.DB.prepare("INSERT INTO clinical_member_audit VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(), id, actor2.id, purpose === "enlarge" ? "hq_evidence_enlarged" : "hq_evidence_previewed", JSON.stringify({ actorKind: "hq", evidenceId: e.id, assessmentVersion: latest.version }), (/* @__PURE__ */ new Date()).toISOString()).run();
      await assertAccess();
      return new Response(object.body, { headers: { "Content-Type": e.mime, "Content-Disposition": "inline", "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'", "Access-Control-Allow-Origin": origin, "Access-Control-Allow-Credentials": "true" } });
    }
    if (parts[1] === "action" && parts.length === 2 && request.method === "POST") {
      const reader = request.body?.getReader();
      let n = 0, chunks = [];
      if (reader) while (true) {
        const { value, done } = await reader.read();
        if (done) break;
        n += value.length;
        if (n > 2e4) {
          await reader.cancel();
          fail5(413, "request_too_large");
        }
        chunks.push(value);
      }
      const bytes = new Uint8Array(n);
      let offset = 0;
      for (const c of chunks) {
        bytes.set(c, offset);
        offset += c.length;
      }
      let b;
      try {
        b = JSON.parse(new TextDecoder().decode(bytes));
      } catch {
        fail5(400, "invalid_json");
      }
      return json3(await caseAction(env, record, actor2, true, b));
    }
    fail5(404, "not_found");
  } catch (e) {
    if (auditActor && auditRecord) {
      try {
        await env.DB.prepare("INSERT INTO clinical_member_audit VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(), auditRecord, auditActor.id, "hq_case_action_denied", JSON.stringify({ actorKind: "hq", method: request.method, reason: e.status ? e.message : "unavailable" }), (/* @__PURE__ */ new Date()).toISOString()).run();
      } catch {
        return json3({ error: "clinical_audit_unavailable" }, 503);
      }
    }
    return json3({ error: e.status ? e.message : "clinical_casework_unavailable" }, e.status || 503);
  }
}
__name(hqClinicalRoute, "hqClinicalRoute");

// portal-release-assets.mjs
var shell = '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Clinician portal \xB7 SHIFT</title><link rel="stylesheet" href="/clinical-assets/portal-shell.css"></head><body class="clinician-only"><div class="shell"><aside><nav aria-label="Clinician navigation"></nav></aside><main><header><div class="eyebrow">SHIFT SOME TIMBER \xB7 HQ</div><h1 id="title">Clinician portal</h1><p>Clinical casework is awaiting commissioning.</p><a href="/">HQ sign-in</a> \xB7 <a href="/clinical-portal/my-profile">My professional profile</a><span id="hqUserChip"></span></header><section class="view active" id="welcome"><h2>Your clinical workspace</h2><p>The portal is deployed. Real-patient review, prescribing, AI identity verification and automatic notifications remain switched off.</p><p>Use your existing HQ sign-in. Clinical access will require a verified clinician account and assigned cases after commissioning.</p><p><a href="/clinical-portal/demo">Open interactive clinician demo</a></p><button id="openClinical" type="button">Open clinician portal</button></section></main></div><script type="module" src="/clinical-assets/client.mjs"><\/script><script type="module" src="/clinical-assets/portal-shell.mjs"><\/script></body></html>\n';
var assets = { "/clinical-assets/client.mjs": { "type": "text/javascript; charset=utf-8", "body": `import {mountPrescription} from '/clinical-assets/prescription-clinician.mjs';
import {clinicalCare,appendCare} from '/clinical-assets/care-form.mjs';
// Mounted into the existing HQ shell. HQ session cookies are the only authentication.
const API='https://api.shiftsometimber.co.uk/v1/hq/clinical';
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
let section,content,notice,current,busy=false,serial=0,active=false,detailPane,orderList,selectedId,knownRole=null,lastIdentity='',identifying=false;const mediaUrls=new Set();let viewer;
const label=v=>String(v||'').replaceAll('_',' ');
function clearMedia(){if(viewer){viewer.close();viewer.remove();viewer=null;}for(const url of mediaUrls)URL.revokeObjectURL(url);mediaUrls.clear();}
function clear(){clearMedia();serial++;current=null;content?.replaceChildren();if(notice)notice.textContent='Sign in to HQ to load clinical cases.';}
async function api(path='',body){const r=await fetch(API+path,{method:body===undefined?'GET':'POST',credentials:'include',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(r.status===401){clear();throw Error('Your HQ session ended. Sign in again.');}if(!r.ok){const e=await r.json();throw Error(label(e.error));}return r.json();}
function button(text,fn){const b=el('button',text);b.type='button';b.onclick=async()=>{if(busy)return;busy=true;b.disabled=true;const n=serial;try{await fn();}catch(e){if(n===serial)notice.textContent=e.message;}finally{busy=false;b.disabled=false;}};return b;}
const statusLabels={draft:'Pending',awaiting_review:'Pending',in_review:'To action',needs_information:'Referred back',consultation_required:'To action',ready_for_prescription:'Ready for prescription',prescription_issued:'Signed off',declined:'Rejected'};
async function queue(){
 clearMedia();const n=++serial;current=null;content.replaceChildren();notice.textContent='Loading orders\u2026';const data=await api();const staff=data.operations?(await api('/staff')).staff:[];if(n!==serial||!active)return;
 document.body.classList.toggle('clinician-only',!data.operations);for(const b of document.querySelectorAll('header button'))if(/HQ settings/i.test(b.textContent))b.hidden=!data.operations;for(const other of document.querySelectorAll('main>.view'))if(other!==section)other.inert=!data.operations;
 notice.textContent=data.operations?'Assign verified clinicians to orders.':'Review your assigned orders and keep all communication in the member portal.';
 const workspace=el('div');workspace.className='clinical-workspace';const left=el('aside');left.className='clinical-orders';left.append(el('h2','Clinician portal'));const filters=el('select');filters.setAttribute('aria-label','Filter clinical cases');for(const v of ['All orders','Pending','To action','Referred back','Ready for prescription','Signed off','Rejected']){const o=el('option',v);o.value=v;filters.append(o);}const search=el('input');search.placeholder='Find order number';search.setAttribute('aria-label','Find clinical case');orderList=el('div');left.append(filters,search,button('Refresh orders',queue),orderList);detailPane=el('div');detailPane.className='clinical-detail';detailPane.append(el('h2','Select an order'),el('p','The member\u2019s clinical card and available actions will appear here.'));workspace.append(left,detailPane);content.append(workspace);
 function draw(){orderList.replaceChildren();const shown=data.records.filter(r=>(filters.value==='All orders'||(r.displayStatus||statusLabels[r.status])===filters.value)&&((r.orderNumber||'')+' '+r.id).toLowerCase().includes(search.value.toLowerCase()));if(!shown.length)orderList.append(el('p','No orders in this view.'));for(const r of shown){const row=el('article');row.dataset.clinicalMember=String(r.memberId);row.className='clinical-order-row';const title=r.orderNumber||'Unlinked request',status=r.displayStatus||statusLabels[r.status]||'Pending';const badge=el('span',status);badge.className='clinical-status';badge.dataset.status=status;
 if(!data.operations){const choose=button(title,()=>open(r.id));choose.className='clinical-order';choose.disabled=r.availableForReview===false;if(choose.disabled)choose.title='The member is updating this record. Review resumes after submission.';choose.dataset.order=r.id;choose.setAttribute('aria-label','Open order '+title);choose.append(badge);row.append(choose);}else{row.append(el('strong',title),badge);const choose=el('select');choose.setAttribute('aria-label','Assign clinician for '+r.id);for(const s of staff){const o=el('option','HQ user '+s.user_id+' \xB7 '+s.registration_body+' '+s.registration_number);o.value=s.user_id;choose.append(o);}row.append(choose,button('Assign clinician',async()=>{if(!choose.value)throw Error('No verified clinician is provisioned.');await api('/'+r.id+'/assignment',{staffUserId:Number(choose.value),active:true});notice.textContent='Clinician assigned.';}),button('Revoke selected clinician',async()=>{if(!choose.value)throw Error('Choose a clinician.');await api('/'+r.id+'/assignment',{staffUserId:Number(choose.value),active:false});notice.textContent='Clinician access revoked.';}));}orderList.append(row);}}
 filters.onchange=search.oninput=draw;draw();
}
async function open(id){clearMedia();const n=++serial;current=null;selectedId=id;detailPane.replaceChildren(el('p','Loading order\u2026'));const data=await api('/'+id);if(n!==serial||!active)return;current=data;for(const b of orderList.querySelectorAll('[data-order]')){b.classList.toggle('selected',b.dataset.order===id);b.setAttribute('aria-pressed',String(b.dataset.order===id));}drawCase();}
async function action(body){const n=serial;await api('/'+current.record.id+'/action',{version:current.workflow.version,assessmentVersion:current.assessment.version,...body});if(n===serial&&active){const id=current.record.id;await queue();await open(id);}}
function textField(form,name,title){const w=el('label',title),i=el('textarea');i.name=name;i.required=true;i.maxLength=4000;w.append(i);form.append(w);return i;}
function check(form,name,title){const w=el('label'),i=el('input');i.type='checkbox';i.name=name;w.append(i,el('span',title));form.append(w);return i;}
async function loadEvidence(recordId,e,purpose,captured){
 const response=await fetch(API+'/'+recordId+'/evidence/'+e.id+'?view='+purpose,{credentials:'include',cache:'no-store'});
 if(response.status===401){clear();throw Error('Your session ended. Sign in again.');}if(!response.ok)throw Error('This evidence is not available. Refresh the order.');const blob=await response.blob();if(captured!==serial||!active||current?.record.id!==recordId)return null;const url=URL.createObjectURL(blob);mediaUrls.add(url);return url;
}
async function enlargeEvidence(recordId,e){const captured=serial,url=await loadEvidence(recordId,e,'enlarge',captured);if(!url)return;if(viewer){viewer.close();viewer.remove();}viewer=el('dialog');viewer.className='clinical-image-viewer';viewer.setAttribute('aria-label','Enlarged '+label(e.kind));const bar=el('div');bar.className='clinical-viewer-bar';bar.append(el('h2',label(e.kind)),button('Close photo',()=>{viewer.close();viewer.remove();viewer=null;URL.revokeObjectURL(url);mediaUrls.delete(url);}));viewer.append(bar);if(e.mime.startsWith('image/')){const image=el('img');image.src=url;image.alt='Enlarged '+label(e.kind);image.draggable=false;image.oncontextmenu=event=>event.preventDefault();viewer.append(image);}else{const frame=el('iframe');frame.src=url+'#toolbar=0&navpanes=0';frame.title='Prescription evidence';viewer.append(frame);}viewer.addEventListener('cancel',()=>{URL.revokeObjectURL(url);mediaUrls.delete(url);});document.body.append(viewer);viewer.showModal();}
async function drawContext(record,workflow,host){
 const captured=serial,data=await api('/'+record.id+'/context');if(captured!==serial||current?.record.id!==record.id)return;
 if(!data.enabled){host.append(el('p','Order history and My Timber sharing are not enabled in this environment.'));return;}
 const orders=el('details');orders.className='clinical-card';orders.append(el('summary','SHIFT order and prescription history \xB7 '+data.orders.length));
 if(data.orderSource!=='available')orders.append(el('p','Order history source unavailable. This does not mean there are no previous orders.'));
 else if(!data.orders.length)orders.append(el('p','No SHIFT medicine orders recorded.'));
 else {const table=el('table'),head=el('tr');for(const name of ['Order','Date','Treatment','Order status','Prescription'])head.append(el('th',name));table.append(head);for(const o of data.orders){const tr=el('tr');for(const v of [o.order_number,o.created_at.slice(0,10),o.medicine_name+' '+o.strength_label,label(o.status),o.prescriptionStatus])tr.append(el('td',v));table.append(tr);}const wrap=el('div');wrap.className='clinical-history-table';wrap.append(table);orders.append(wrap);if(data.moreOrders)orders.append(el('p','Showing the latest 200 orders.'));orders.append(el('p','An order or clinical approval is not proof that a prescription was issued.'));}host.append(orders);
 const panel=el('details');panel.className='clinical-card';const last=workflow.events.filter(e=>e.kind==='app_updates_reviewed').at(-1),seen=new Set((last?.clinical?.updates||[]).map(e=>JSON.stringify(e))),newCount=data.updates.filter(e=>!seen.has(JSON.stringify(e))).length;
 panel.append(el('summary','My Timber updates \xB7 '+newCount+' new / changed updates'),el('p','Relevant updates shared by the member \xB7 Last 90 days \xB7 Not continuously monitored.'));
 if(!data.sharing.scopes.length)panel.append(el('p','The member has not enabled optional app sharing for this assessment.'));
 else if(!data.updates.length)panel.append(el('p','No shared updates returned for this period.'));
 if(last)panel.append(el('p','Last reviewed '+new Date(last.createdAt).toLocaleString('en-GB',{timeZone:'Europe/London'})+' \xB7 Assessment '+last.assessmentVersion));
 const entries=el('div');for(const e of data.updates){const item=el('article');item.append(el('strong',e.occurredAt.slice(0,10)+' \xB7 '+label(e.kind)+(seen.has(JSON.stringify(e))?'':' \xB7 NEW')),el('p',e.source+' \xB7 '+e.reportedBy+(e.medicine?' \xB7 '+e.medicine:'')));for(const [k,v]of Object.entries(e.details))item.append(el('p',({weightKg:'Weight (kg)',doseStrength:'Dose',sideEffects:'Reported side effects',symptomType:'Symptom',symptomSeverity:'Severity out of 10',symptomImpact:'Impact',symptomStartedAt:'Symptom started',appetite:'Appetite',energy:'Energy'}[k]||label(k))+': '+v));entries.append(item);}panel.append(entries);
 for(const source of data.sources)if(source.status!=='available'||source.truncated)panel.append(el('p',source.name+': '+(source.truncated?'History truncated \u2014 review the underlying member record.':'Source unavailable; do not assume no updates.')));
 if(data.updates.length)panel.append(button('Mark updates reviewed',()=>action({action:'review_updates',digest:data.digest})));
 host.append(panel);
}
function drawCase(){detailPane.replaceChildren();const {record,assessment,workflow}=current;notice.textContent=current.displayStatus||statusLabels[workflow.status];detailPane.append(el('h2',record.order_number||'Treatment request'),el('p',(current.displayStatus||statusLabels[workflow.status])+' \xB7 Assessment '+assessment.version));if(workflow.status==='ready_for_prescription')detailPane.append(el('p','Clinical review completed. Prescription signing and member agreement are recorded separately.'));
 const summary=el('article');summary.className='clinical-card';summary.append(el('h3','Member clinical card'));const a=assessment.answers;for(const [key,title]of [['fullName','Name'],['dateOfBirth','DOB'],['heightCm','Height (cm)'],['weightKg','Weight (kg)'],['previousMedicine','Current / previous medicine'],['previousDose','Dose'],['gpPractice','GP practice']])if(a[key])summary.append(el('p',title+': '+a[key]));summary.append(el('small','Member details from submitted assessment '+assessment.version+' \xB7 '+new Date(record.updated_at).toLocaleDateString('en-GB')));detailPane.append(summary);const contextHost=el('div');contextHost.className='clinical-context';detailPane.append(contextHost);drawContext(record,workflow,contextHost).catch(e=>{if(current?.record.id===record.id)contextHost.append(el('p','Clinical history could not be loaded: '+e.message));});
 const details=el('details');details.append(el('summary','Questionnaire, GP details and declarations'));const questionMap=new Map((current.questionContext?.questions||[]).map(q=>[q.id,q]));details.append(el('p',current.questionContext?.status==='submitted_snapshot'?'Question wording retained with this submitted assessment.':current.questionContext?.status==='catalogue_reference'?'Question wording from the matching schema catalogue; no historical snapshot is available for this older record.':'Original question context unavailable. Obtain clarification before relying on ambiguous answers.'));for(const [k,v]of Object.entries(a)){const q=questionMap.get(k);details.append(el('strong',q?.label||current.answerLabels?.[k]||label(k)));if(q?.items?.length){const list=el('ul');for(const item of q.items)list.append(el('li',item));details.append(list);}let answer=v;try{if(Array.isArray(JSON.parse(v)))answer=JSON.parse(v).join(', ');}catch{}details.append(el('p','Answer: '+answer));}const declarations=assessment.declarations;details.append(el('p','Declarations: accuracy '+(declarations.accuracy?'confirmed':'not confirmed')+' \xB7 clinical sharing '+(declarations.reviewSharing?'confirmed':'not confirmed')+' \xB7 version '+(declarations.version||assessment.version)));detailPane.append(details);
 const docs=el('article');docs.className='clinical-card clinical-evidence';docs.append(el('h3','Photos and evidence'),el('p','Select a photo to enlarge it.'));const grid=el('div');grid.className='clinical-photo-grid';docs.append(grid);
 for(const e of assessment.evidence){const tile=el('figure');tile.className='clinical-photo';const title=label(e.kind);const preview=button('Enlarge '+title,()=>enlargeEvidence(record.id,e));preview.className='clinical-photo-button';preview.setAttribute('aria-label','Enlarge '+title);if(e.mime.startsWith('image/')){const image=el('img');image.alt=title+' preview';image.draggable=false;image.oncontextmenu=event=>event.preventDefault();preview.prepend(image);loadEvidence(record.id,e,'preview',serial).then(url=>{if(url)image.src=url;}).catch(error=>{if(current?.record.id===record.id)notice.textContent=error.message;});}else{preview.prepend(el('span','PDF'));}tile.append(preview,el('figcaption',title),el('small','Uploaded '+new Date(e.uploaded_at).toLocaleDateString('en-GB')));
 if(e.kind==='photo_id'){tile.append(el('p','SHIFT AI ID check: awaiting connection'),el('small','No automatic verification has been completed. Independent identity verification is required before sign-off.'));}
 else {const latest=workflow.events.filter(event=>event.evidenceId===e.id&&event.evidenceDigest===e.digest).at(-1);tile.append(el('p','Review: '+(latest?({approve:'Approved',reject:'Rejected \u2014 replacement requested',query:'Query sent'}[latest.outcome]||'Pending'):'Pending')));if(['awaiting_review','in_review','needs_information'].includes(workflow.status)){const controls=el('details');controls.append(el('summary','Review this document'));const form=el('form');const reason=textField(form,'reason','Reason or question for the member');reason.required=false;form.onsubmit=event=>event.preventDefault();for(const [outcome,title]of [['approve','Approve'],['reject','Reject'],['query','Query']])form.append(button(title,()=>{reason.required=outcome!=='approve';if(form.reportValidity())return action({action:'review_evidence',evidenceId:e.id,outcome,message:reason.value});}));controls.append(form);tile.append(controls);}}
 grid.append(tile);}detailPane.append(docs);
 const history=el('details');history.className='clinical-card';history.append(el('summary','History and audit trail'));for(const e of workflow.events){history.append(el('strong',label(e.kind)),el('p',new Date(e.createdAt).toLocaleString('en-GB')+' \xB7 Assessment '+e.assessmentVersion));if(e.message)history.append(el('p',e.message));appendCare(history,e.clinical?.handover);if(e.clinical?.note)history.append(el('p','Internal: '+e.clinical.note));if(e.clinical?.rationale)history.append(el('p','Clinical rationale: '+e.clinical.rationale));}history.append(button('Load audit trail',async()=>{const panel=el('div');history.append(panel);let cursor='';async function more(){const data=await api('/'+record.id+'/audit'+cursor);for(const e of data.events){panel.append(el('p',new Date(e.created_at).toLocaleString('en-GB')+' \xB7 '+label(e.action)+' \xB7 '+(e.details.actorKind||'member')+' #'+e.actor_user_id));}if(data.next){cursor='?'+new URLSearchParams(data.next);panel.append(button('Earlier activity',more));}}await more();}));detailPane.append(history);
 if(workflow.status==='awaiting_review')detailPane.append(button('Start review',()=>action({action:'start_review'})));
 if(['awaiting_review','in_review'].includes(workflow.status)){
 const form=el('form');form.className='clinical-card';form.append(el('h3','Ask for more information'));const message=textField(form,'message','Explain what is needed and why');for(const k of ['photo_id','front_photo','scale_photo','prescription'])check(form,k,'Replacement '+label(k));form.append(button('Send request to member profile',()=>{if(!form.reportValidity())return;return action({action:'request_information',message:message.value,evidenceKinds:['photo_id','front_photo','scale_photo','prescription'].filter(k=>form.elements[k].checked)});}));form.append(el('p','The request appears in My Timber. A branded notification is queued; email and opted-in WhatsApp delivery require their notification connections.'));detailPane.append(form);
 }
 if(workflow.status==='in_review'){
 const form=el('form');form.className='clinical-card';form.append(el('h3','Record clinical decision'));const outcome=el('select');outcome.setAttribute('aria-label','Clinical outcome');outcome.required=true;for(const [v,t]of [['','Choose an action'],['proceed','Approve clinical review'],['decline','Decline treatment'],['consultation','Request consultation']]){const o=el('option',t);o.value=v;outcome.append(o);}form.append(outcome);const message=textField(form,'message','Explanation for the member'),rationale=textField(form,'rationale','Private clinical rationale');const identity=check(form,'identity','Identity independently checked'),measure=check(form,'measure','Measurements independently verified');const verification=textField(form,'verification','Verification method, source and date');verification.required=false;const care=clinicalCare(form);form.append(button('Record decision',()=>{care.requireForProceed(outcome.value==='proceed');if(!form.reportValidity())return;return action({action:'decision',handover:care.value(),outcome:outcome.value,message:message.value,rationale:rationale.value,identityVerified:identity.checked,independentMeasurementsVerified:measure.checked,verification:verification.value});}));detailPane.append(form);
 }
 const prescriptionHost=el('article');prescriptionHost.className='clinical-card';detailPane.append(prescriptionHost);const captured=serial;mountPrescription(prescriptionHost,{node:el,button,request:(path,body)=>api('/prescriptions'+path,body),record,workflow,onChanged:()=>open(record.id),isCurrent:()=>serial===captured&&active}).catch(e=>{if(serial===captured)prescriptionHost.append(el('p',e.message));});
 const notes=el('form');notes.className='clinical-card';notes.append(el('h3','Private clinical note'));const note=textField(notes,'note','Only visible to authorised clinicians');notes.append(button('Save internal note',()=>{if(notes.reportValidity())return action({action:'note',note:note.value});}));detailPane.append(notes);
 for(const form of detailPane.querySelectorAll('form.clinical-card')){form.onsubmit=e=>e.preventDefault();const fold=el('details');fold.className='clinical-action';fold.append(el('summary',form.querySelector('h3')?.textContent||'Action'));form.before(fold);fold.append(form);}
}
async function showPortal(){active=true;document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active',s===section));document.querySelectorAll('nav button[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view==='clinical'));const title=document.getElementById('title');if(title)title.textContent='Clinician portal';await queue();const requested=new URLSearchParams(location.search).get('record');if(requested&&content.querySelector('button')&&/^[a-f0-9-]{36}$/.test(requested))await open(requested);}
function linkMemberCard(){if(!section||typeof window.openPerson!=='function'||window.openPerson.clinicalLinked)return;const original=window.openPerson;const wrapped=async function(id){await original(id);const host=document.getElementById('personContent');if(host){document.getElementById('clinical-member-link')?.remove();const link=button('View clinical cases for this member',async()=>{document.getElementById('personModal')?.close();await showPortal();for(const row of content.querySelectorAll('[data-clinical-member]'))row.hidden=row.dataset.clinicalMember!==String(id);});link.id='clinical-member-link';host.append(link);}};wrapped.clinicalLinked=true;window.openPerson=wrapped;}
function install(){linkMemberCard();if(section){const b=document.querySelector('nav button[data-view="clinical"]'),nav=document.querySelector('aside nav');if(b?.closest('details'))nav.insertBefore(b,nav.children[1]);return true;}const nav=document.querySelector('aside nav'),main=document.querySelector('main');if(!nav||!main)return false;section=el('section');section.id='clinical';section.className='view';const head=el('div');head.className='toolbar';head.append(el('h2','Clinician portal'));notice=el('p','Sign in to HQ to load clinical cases.');notice.setAttribute('role','status');content=el('div');section.append(notice,content);main.append(section);const b=button('Clinician portal',showPortal);b.dataset.view='clinical';const activate=b.onclick;b.addEventListener('click',e=>{e.stopImmediatePropagation();activate(e);},true);nav.append(b);nav.addEventListener('click',e=>{if(e.target.closest('button[data-view]')?.dataset.view!=='clinical'){active=false;clear();}});document.getElementById('logoutBtn')?.addEventListener('click',()=>{knownRole=null;lastIdentity='';syncWorkspaceLinks(null);clear();});const css=el('link');css.rel='stylesheet';css.href='/clinical-assets/hq.css';document.head.append(css);return true;}
function syncWorkspaceLinks(role){const old=document.getElementById('clinical-workspace-links');if(!['owner','admin'].includes(role)){old?.remove();return;}const nav=document.querySelector('aside nav');if(!nav||old)return;const group=el('div');group.id='clinical-workspace-links';group.setAttribute('aria-label','Professional workspaces');for(const [label,path]of [['People & partners','/clinical-portal/partners'],['Dispensing oversight','/clinical-portal/dispensing'],['Internal test orders','/clinical-portal/commissioning']]){const a=el('a',label);a.href=path;group.append(a);}nav.append(group);}
async function identify(){if(identifying)return;identifying=true;const n=serial;try{const r=await fetch('https://api.shiftsometimber.co.uk/v1/hq/me',{credentials:'include',cache:'no-store'});if(!r.ok){syncWorkspaceLinks(null);return;}const data=await r.json();if(n!==serial)return;knownRole=data.user?.role;syncWorkspaceLinks(knownRole);document.body.classList.toggle('clinician-only',knownRole==='clinical');if(knownRole==='clinical'&&section){active=true;await showPortal();}}catch(e){if(notice)notice.textContent=e.message;}finally{identifying=false;}}
const observer=new MutationObserver(()=>{install();const identity=document.getElementById('hqUserChip')?.textContent||'';if(identity&&identity!==lastIdentity){lastIdentity=identity;identify();}if(knownRole==='clinical'&&section&&!section.classList.contains('active')){active=true;document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v===section));}if(section&&!section.classList.contains('active')&&active){active=false;clear();}});observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});install();identify();window.addEventListener('pagehide',clear);window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
` }, "/clinical-assets/hq.css": { "type": "text/css; charset=utf-8", "body": '#clinical .clinical-card{background:#e7e3da;color:#050505;border:1px solid #707762;border-radius:10px;padding:20px;margin:16px 0}#clinical textarea,#clinical select,#clinical input:not([type=checkbox]){font:inherit;display:block;width:100%;padding:12px;margin:8px 0 18px;border:1px solid #707762;border-radius:5px;background:#fff;color:#050505}#clinical textarea{min-height:90px}#clinical label{display:block;margin:12px 0}#clinical button{min-height:44px;padding:10px 16px;margin:6px;background:#050505;color:#e7e3da;border:0;border-radius:5px;cursor:pointer}#clinical h2,#clinical h3{color:inherit}#clinical a{color:#40502e;text-decoration:underline}#clinical p{overflow-wrap:anywhere;line-height:1.5}#clinical details{padding:16px;border:1px solid #707762}#clinical summary{cursor:pointer;font-weight:700}#clinical :focus-visible{outline:3px solid #707762;outline-offset:3px}\nbody.clinician-only>aside{display:none!important}body.clinician-only>main{margin-left:0!important;width:100%!important;max-width:none!important}body.clinician-only #hqSettings,body.clinician-only #settingsBtn,body.clinician-only #hqUserChip{display:none!important}body.clinician-only main>.view:not(#clinical){display:none!important}.clinical-workspace{display:grid;grid-template-columns:minmax(250px,300px) minmax(0,1fr);gap:24px;align-items:start}.clinical-orders{position:sticky;top:16px;background:#050505;color:#e7e3da;padding:20px;border-radius:10px}.clinical-orders h2{font-size:20px}.clinical-detail{min-width:0}.clinical-order-row{margin:10px 0}.clinical-orders .clinical-order{width:100%;display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0!important;padding:14px!important;text-align:left;background:#22251f!important;border:1px solid #707762!important}.clinical-order.selected{outline:2px solid #e7e3da}.clinical-status{display:inline-block;white-space:nowrap;padding:5px 8px;border-radius:5px;background:#e7e3da;color:#050505;font-size:12px;font-weight:bold}.clinical-status[data-status="To action"]{background:#ecd397}.clinical-status[data-status="Referred back"]{background:#d8bd9f}.clinical-status[data-status="Signed off"]{background:#bcc9ac}.clinical-status[data-status="Rejected"]{background:#e4b4ae}#clinical .clinical-orders input,#clinical .clinical-orders select{margin-bottom:10px}#clinical .clinical-orders button:not(.clinical-order){border:1px solid #707762}#clinical .clinical-card label:has(input[type=checkbox]){display:flex;align-items:center;gap:10px}#clinical .clinical-card label input[type=checkbox]{flex:0 0 auto;margin:0}#clinical .clinical-card h3{margin-top:0}@media(max-width:800px){.clinical-workspace{grid-template-columns:1fr}.clinical-orders{position:static}.clinical-detail{width:100%}body.clinician-only main{padding:14px!important}}\n\nbody.clinician-only .shell{grid-template-columns:1fr!important}body.clinician-only .shell>aside{display:none!important}body.clinician-only .shell>main{margin:0!important;width:100%!important;max-width:none!important;padding:24px!important}.clinical-orders{display:block!important}.clinical-orders h2{color:#e7e3da!important}\n\nbody.clinician-only #notice{display:none!important}#clinical .clinical-action{margin:12px 0;border-radius:8px;background:#e7e3da}#clinical .clinical-action>summary{padding:5px 0}#clinical .clinical-action .clinical-card{border:0;margin:12px 0 0;padding:0}#clinical .clinical-action .clinical-card>h3{display:none}\n/* SHIFT review desk: cream canvas, white cards, black chrome, ash-green emphasis. */\nbody.clinician-only{background:#e7e3da;color:#111410}body.clinician-only .shell>main{padding:0 28px 32px!important}body.clinician-only main>header{margin:0 -28px 24px;padding:24px 28px;background:#050505;color:#e7e3da;border-bottom:5px solid #707762}body.clinician-only header .eyebrow{color:#b9c2ab;letter-spacing:.18em}body.clinician-only header h1{font-size:28px;margin:6px 0 0;color:#fff}body.clinician-only header button{background:#050505;color:#e7e3da;border-color:#707762}#clinical .clinical-card{background:#fff;border:1px solid #d7dbd2;border-top:4px solid #707762;box-shadow:0 5px 20px #05050508;border-radius:12px;padding:22px}#clinical .clinical-card h3{font-size:19px;color:#172014}#clinical .clinical-detail>h2{font-size:25px;letter-spacing:-.03em}#clinical .clinical-detail>p{color:#50594b}#clinical .clinical-action{background:#fff;border:1px solid #d7dbd2;border-left:5px solid #707762;box-shadow:0 3px 12px #05050506}#clinical .clinical-action[open]{border-left-color:#050505}#clinical .clinical-action .clinical-card{box-shadow:none;border:0;padding:8px 0 0}#clinical .clinical-orders{box-shadow:0 10px 24px #05050518;border-top:5px solid #707762;padding:22px}#clinical .clinical-order.selected{background:#707762!important;outline:0;border-color:#b5bea7!important}#clinical .clinical-orders .clinical-order:hover{border-color:#e7e3da!important}.clinical-evidence>p{font-size:14px;color:#626b5b}.clinical-photo-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:16px}.clinical-photo{margin:0;min-width:0}.clinical-photo-button{display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;width:100%;margin:0!important;padding:10px!important;background:#f2f3ee!important;color:#111410!important;border:1px solid #d7dbd2!important;font-size:12px!important;min-height:180px!important;overflow:hidden}.clinical-photo-button img{width:100%;height:150px;object-fit:contain;background:#e9ece3;border-radius:5px}.clinical-photo figcaption{font-weight:700;font-size:14px;margin:10px 0 4px}.clinical-photo small{font-size:11px;color:#626b5b}.clinical-image-viewer{width:min(1100px,95vw);height:min(900px,94vh);padding:0;border:0;border-radius:14px;background:#11140f;color:#e7e3da;box-shadow:0 25px 100px #0008}.clinical-image-viewer::backdrop{background:#050505d9;backdrop-filter:blur(5px)}.clinical-viewer-bar{display:flex;align-items:center;justify-content:space-between;padding:15px 22px;background:#050505;border-bottom:3px solid #707762}.clinical-viewer-bar h2{font-size:18px;margin:0}.clinical-viewer-bar button{padding:10px 16px;background:#e7e3da;color:#050505;border:0;border-radius:6px;font:inherit;cursor:pointer}.clinical-image-viewer>img{display:block;width:100%;height:calc(100% - 76px);object-fit:contain;padding:16px}.clinical-image-viewer iframe{width:100%;height:calc(100% - 76px);border:0}@media(max-width:800px){body.clinician-only .shell>main{padding:0 14px 24px!important}body.clinician-only main>header{margin:0 -14px 18px;padding:18px 14px}.clinical-photo-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.clinical-photo-button{min-height:155px!important}.clinical-photo-button img{height:120px}}@media(max-width:400px){.clinical-photo-grid{grid-template-columns:1fr}}\n.clinical-context{display:grid;gap:14px;margin:14px 0}.clinical-history-table{overflow-x:auto}.clinical-history-table table{width:100%;border-collapse:collapse;font-size:13px}.clinical-history-table th,.clinical-history-table td{text-align:left;padding:12px 9px;border-bottom:1px solid #d7dbd2;vertical-align:top}.clinical-history-table th{background:#e7e3da}.clinical-context article{padding:14px 0;border-bottom:1px solid #d7dbd2}.clinical-context article p{margin:6px 0}\n\n#clinical-workspace-links{margin-top:16px;padding-top:12px;border-top:1px solid #707762}#clinical-workspace-links a{display:block;margin:6px 0;padding:11px 12px;border-radius:6px;text-decoration:none;font:inherit;background:#707762;color:#fff}body.clinician-only #clinical-workspace-links{display:none!important}\n' }, "/clinical-assets/portal-shell.css": { "type": "text/css; charset=utf-8", "body": "*{box-sizing:border-box}body{margin:0;font:16px/1.5 system-ui,sans-serif;background:#e7e3da;color:#050505}main{padding:0 28px 32px}header{margin:0 -28px 24px;padding:24px 28px;background:#050505;color:#e7e3da;border-bottom:5px solid #707762}header a{color:#e7e3da}header h1{margin:6px 0;font-size:28px}.eyebrow{letter-spacing:.18em;color:#b9c2ab;font-size:12px}.view{display:none}.view.active{display:block}button{font:inherit;min-height:44px;border:0;border-radius:6px;background:#050505;color:#e7e3da;padding:12px 18px;cursor:pointer}#hqUserChip{display:none}body.clinician-only main>#welcome.view.active{display:block!important}#welcome{max-width:720px;padding:24px;background:#fff;border-top:4px solid #707762;border-radius:12px}:focus-visible{outline:3px solid #707762;outline-offset:4px}@media(max-width:800px){main{padding:0 14px 24px}header{margin:0 -14px 18px;padding:18px 14px}}" }, "/clinical-assets/portal-shell.mjs": { "type": "text/javascript; charset=utf-8", "body": "document.getElementById('openClinical')?.addEventListener('click',()=>document.querySelector('nav button[data-view=clinical]')?.click());" }, "/clinical-assets/prescription-clinician.mjs": { "type": "text/javascript; charset=utf-8", "body": "const enc=new TextEncoder();\nconst b64=buffer=>btoa(String.fromCharCode(...new Uint8Array(buffer))).replaceAll('+','-').replaceAll('/','_').replace(/=+$/,'');\nconst bytes=s=>Uint8Array.from(atob(s.replaceAll('-','+').replaceAll('_','/')),c=>c.charCodeAt(0));\nconst money=p=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(p/100);\nconst canonical=v=>JSON.stringify(v,(_,x)=>x&&typeof x==='object'&&!Array.isArray(x)?Object.fromEntries(Object.keys(x).sort().map(k=>[k,x[k]])):x);\nconst input=(node,host,label,name,value='',type='text')=>{const wrap=node('label',label),field=node(type==='textarea'?'textarea':'input');field.name=name;if(type!=='textarea')field.type=type;field.value=value;field.required=true;field.maxLength=2000;wrap.append(field);host.append(wrap);return field;};\nexport async function mountPrescription(host,{node,button,request,record,workflow,onChanged,onError,isCurrent=()=>true}){\n const heading=node('h3','Prescription and treatment options');host.append(heading);\n if(!['ready_for_prescription','prescription_issued'].includes(workflow.status)){host.append(node('p','Complete the clinical review and evidence checks before preparing a prescription.'));return;}\n const data=await request('/'+record.id);if(!isCurrent())return;\n const s=data.prescription,care=workflow.events.filter(e=>e.kind==='clinical_decision'&&e.outcome==='proceed').at(-1)?.clinical?.handover||{},current=s?.treatment||{};\n host.append(node('p','One order reference links the member agreement, signed prescription and assigned dispensing task.'));\n if(s){host.append(node('strong','Status: '+s.status.replaceAll('_',' ')),node('p','Current proposal '+s.version+' \xB7 '+s.treatment.strength+' \xB7 '+money(s.comparison.revisedTotalPence)));if(s.question)host.append(node('h4','Question from the member'),node('p',s.question.message));}\n if(s?.status==='issued'){host.append(node('p','Prescription '+s.prescriptionId+' is in the assigned dispensing queue. Changes now need a pharmacy hold and a new clinical review.'));return;}\n if(['cancelled','declined'].includes(s?.status)){host.append(node('p','This request is closed. Any payment adjustment is awaiting admin review.'));return;}\n const form=node('form');form.onsubmit=e=>e.preventDefault();\n const variantLabel=node('label','Dose / strength'),variant=node('select');variant.setAttribute('aria-label','Proposed dose or strength');variant.required=true;\n for(const v of data.variants){const o=node('option',v.strength+' \xB7 '+money(v.unitPricePence)+' per pack'+(v.stockStatus==='no_stock'?' \xB7 no recorded stock':v.stockStatus==='unavailable'?' \xB7 stock unverified':''));o.value=String(v.id);variant.append(o);}variant.value=String(current.variantId||data.originalTreatment.variantId||data.variants.find(v=>v.strength===data.originalTreatment.strength)?.id||'');variantLabel.append(variant);form.append(variantLabel);\n const packs=input(node,form,'Number of packs','packs',current.packs||1,'number');packs.min='1';packs.max='12';\n const dose=input(node,form,'Prescribed dose and frequency','dose',current.dose||care.dose||''),quantity=input(node,form,'Quantity and pack contents','quantity',current.quantity||care.quantity||''),route=input(node,form,'Route','route',current.route||''),directions=input(node,form,'Complete directions for use','directions',current.directions||care.directions||'','textarea');\n const reason=input(node,form,'Explain the proposed treatment to the member','reason',s?.reason||'','textarea'),rationale=input(node,form,'Private clinical rationale','rationale',s?.clinicalRationale||'','textarea');\n const pharmacyLabel=node('label','Assigned dispensing pharmacy'),pharmacy=node('select');pharmacy.setAttribute('aria-label','Assigned dispensing pharmacy');pharmacy.required=true;const empty=node('option','Select approved pharmacy');empty.value='';pharmacy.append(empty);for(const p of data.pharmacies){const o=node('option',p.name);o.value=p.id;pharmacy.append(o);}pharmacy.value=s?.partnerId||'';pharmacyLabel.append(pharmacy);form.append(pharmacyLabel);\n if(!data.pharmacies.length)form.append(node('p','Pharmacy: TBC. A verified pharmacy assignment is needed before publishing a real proposal.'));\n const price=node('p');form.append(price);function refreshPrice(){const v=data.variants.find(v=>String(v.id)===variant.value),n=Number(packs.value);price.textContent=v&&Number.isInteger(n)?'Indicative catalogue total: '+money(v.unitPricePence*n)+'. The server verifies the final total and any discount before publication.':'Choose a strength and quantity.';}variant.onchange=packs.oninput=refreshPrice;refreshPrice();\n form.append(button(s?'Revise alternative':'Offer alternative / prepare draft',async()=>{if(!form.reportValidity())return;await request('/'+record.id+'/proposal',{version:s?.version||0,partnerId:pharmacy.value,expiresAt:new Date(Date.now()+48*3600000).toISOString(),reason:reason.value,clinicalRationale:rationale.value,treatment:{variantId:Number(variant.value),packs:Number(packs.value),dose:dose.value,quantity:quantity.value,route:route.value,directions:directions.value}});await onChanged();}));host.append(form);\n if(s){const query=node('details');query.append(node('summary','Query member'));const question=input(node,query,'Question for the member','prescriptionQuery','','textarea');query.append(button('Query',async()=>{if(!question.value.trim())throw Error('Enter the question for the member.');await request('/'+record.id+'/query',{version:s.version,message:question.value});await onChanged();}));host.append(query);const decline=node('details');decline.append(node('summary','Decline treatment request'));const why=input(node,decline,'Reason and next steps for the member','declineReason','','textarea');decline.append(button('Decline',async()=>{if(!why.value.trim())throw Error('Explain the decision to the member.');await request('/'+record.id+'/decline',{version:s.version,reason:why.value});await onChanged();}));host.append(decline);}\n if(!s||s.status!=='accepted'){host.append(node('p','Approve & sign becomes available after the member agrees to the current treatment and price.'));return;}\n if(!data.canSign){host.append(node('p','Prescription signing is awaiting service commissioning. The member agreement is saved; no prescription has been issued.'));return;}\n const active=data.keys.filter(k=>k.status==='approved'&&k.expires_at>new Date().toISOString());\n if(!active.length){host.append(node('p','An individually controlled signing credential needs independent approval before it can be used.'));\n  host.append(button('Register signing credential',async()=>{if(!window.PublicKeyCredential)throw Error('Use a browser supporting security keys.');const c=await request('/'+record.id+'/keys/challenge',{});const credential=await navigator.credentials.create({publicKey:{challenge:bytes(c.challenge),rp:{id:c.rpId,name:'SHIFT HQ prescribing'},user:{id:enc.encode('hq-prescriber:'+s.prescriber.id),name:s.prescriber.name,displayName:s.prescriber.name},pubKeyCredParams:[{type:'public-key',alg:-7}],authenticatorSelection:{userVerification:'required',residentKey:'discouraged'},attestation:'none',timeout:60000}});if(!credential)throw Error('Signing credential registration was cancelled.');if(!isCurrent())throw Error('Prescription view changed. Open the current order again.');await request('/'+record.id+'/keys/register',{challengeId:c.id,proof:{credentialId:b64(credential.rawId),clientDataJSON:b64(credential.response.clientDataJSON),attestationObject:b64(credential.response.attestationObject)}});await onChanged();}));return;\n }\n const preview=node('div');host.append(preview);\n host.append(button('Approve & sign',async()=>{\n  const c=await request('/'+record.id+'/signing-challenge',{version:s.version,keyId:active[0].id});if(!isCurrent())return;const d=c.document,context=JSON.parse(new TextDecoder().decode(bytes(c.challenge))),hash=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',enc.encode(canonical(d)))),b=>b.toString(16).padStart(2,'0')).join('');if(context.purpose!=='shift-prescription-signature-v1'||context.documentDigest!==hash||context.prescriberId!==d.prescriber.id)throw Error('Signing proof does not match the prescription. Reload and review it again.');preview.replaceChildren(node('h4','Confirm the exact prescription'));\n  for(const line of [d.patient.name+' \xB7 '+d.patient.dateOfBirth,d.patient.address+' \xB7 '+d.patient.postcode,d.treatment.medicine+' \xB7 '+d.treatment.strength,'Dose: '+d.treatment.dose,'Quantity: '+d.treatment.quantity,'Route: '+d.treatment.route,'Directions: '+d.treatment.directions,'Prescriber: '+d.prescriber.name+' \xB7 '+d.prescriber.registrationBody+' '+d.prescriber.registrationNumber,'Practice: '+d.prescriber.practiceAddress,'Date: '+d.issuedOn,'Agreed total: '+money(d.price.revisedTotalPence)])preview.append(node('p',line));\n  preview.append(button('Confirm & sign prescription',async()=>{const credential=await navigator.credentials.get({publicKey:{challenge:bytes(c.challenge),rpId:c.rpId,allowCredentials:[{type:'public-key',id:bytes(c.credentialId)}],userVerification:'required',timeout:60000}});if(!credential)throw Error('Prescription signing was cancelled.');if(!isCurrent())throw Error('Prescription view changed. Review the current order before signing.');await request('/'+record.id+'/sign',{version:s.version,challengeId:c.id,document:d,proof:{credentialId:b64(credential.rawId),clientDataJSON:b64(credential.response.clientDataJSON),authenticatorData:b64(credential.response.authenticatorData),signature:b64(credential.response.signature),userHandle:credential.response.userHandle?b64(credential.response.userHandle):null}});await onChanged();}));\n }));\n}\n" }, "/clinical-assets/care-form.mjs": { "type": "text/javascript; charset=utf-8", "body": "import {careFields,careChecks,CARE_HANDOVER_VERSION} from '/clinical-assets/care-contract.mjs';\nexport function clinicalCare(form,{demo=false}={}){const fold=document.createElement('details');fold.open=demo;const summary=document.createElement('summary');summary.textContent='Clinical handover and care plan'+(demo?' \xB7 fictional demonstration':'');fold.append(summary);const caption=document.createElement('p');caption.textContent='For a suitable-to-proceed decision, record verification sources, clinical reasoning and the care plan. This record is not a prescription.';fold.append(caption);const inputs={};for(const [id,title,type]of careFields){const label=document.createElement('label');label.textContent=title;let field;if(Array.isArray(type)){field=document.createElement('select');for(const value of ['',...type]){const option=document.createElement('option');option.value=value;option.textContent=value||'Choose';field.append(option);}}else{field=document.createElement(type==='date'?'input':'textarea');if(type==='date')field.type='date';field.maxLength=4000;}field.name='care_'+id;label.append(field);inputs[id]=field;fold.append(label);}for(const [id,title]of careChecks){const label=document.createElement('label'),field=document.createElement('input');field.type='checkbox';label.append(field,document.createTextNode(title));inputs[id]=field;fold.append(label);}const fill=document.createElement('button');fill.type='button';fill.textContent='Fill fictional example care plan';fill.onclick=()=>{const today=new Date().toISOString().slice(0,10),later=new Date(Date.now()+28*86400000).toISOString().slice(0,10);for(const [id,,type]of careFields)inputs[id].value=Array.isArray(type)?type[0]:type==='date'?(id==='followUpDate'?later:today):'Fictional demonstration record \u2014 clinician approval required for real care.';inputs.medicine.value='DEMO MEDICINE \u2014 not a prescription';inputs.dose.value='Illustrative dose only';inputs.quantity.value='Illustrative quantity only';for(const [id]of careChecks)inputs[id].checked=true;};if(demo)fold.prepend(fill);form.append(fold);return {requireForProceed(proceed){for(const field of Object.values(inputs))field.required=proceed;},value(){return {version:CARE_HANDOVER_VERSION,...Object.fromEntries(Object.entries(inputs).map(([id,field])=>[id,field.type==='checkbox'?field.checked:field.value]))};}};}\nexport function appendCare(host,plan){if(!plan)return;const detail=document.createElement('details');detail.className='clinical-card';const summary=document.createElement('summary');summary.textContent='Recorded clinical handover and follow-up plan';detail.append(summary);for(const [id,title]of careFields){const p=document.createElement('p');p.textContent=title+': '+plan[id];detail.append(p);}host.append(detail);}\n" }, "/clinical-assets/care-contract.mjs": { "type": "text/javascript; charset=utf-8", "body": "// A recording contract, not clinical eligibility or dosing guidance.\nexport const CARE_HANDOVER_VERSION='shift-care-handover-v1';\nexport const careFields=[\n ['consultationMode','Consultation mode',['Video','In person','Secure two-way consultation with corroborating records']],\n ['consultedOn','Consultation date','date'],\n ['identityReference','Identity check method and evidence reference','text'],\n ['measurementSource','Independent measurement verification',['Video consultation','In-person measurement','Clinical records','Another healthcare provider']],\n ['verifiedOn','Verification date','date'],\n ['verificationReference','Measurement source reference and findings','text'],\n ['historyReference','Medical history and medicines reconciliation source and findings','text'],\n ['eligibilityReason','Eligibility and benefit-risk reasoning against the clinical protocol','text'],\n ['medicationEvidence','Current treatment dose, last dose, supply evidence and restart or switching plan','text'],\n ['gpPlan','GP communication plan',['Notify verified GP','Sharing declined','No GP']],\n ['gpReference','Verified GP route reference or refusal and clinical justification','text'],\n ['medicine','Proposed medicine','text'],['dose','Proposed strength and dose','text'],\n ['directions','Proposed directions and route','text'],['quantity','Proposed quantity','text'],\n ['protocolReference','Clinician-approved protocol reference and version','text'],\n ['followUpDate','Next review date','date'],['followUpOwner','Who owns the next review','text'],\n ['monitoringPlan','Monitoring, escalation and repeat treatment plan','text']\n];\nexport const careChecks=[['historyReviewed','History, allergies, interactions and current medicines reviewed'],['safeguardingReviewed','Capacity, safeguarding and eating-disorder concerns considered and resolved or escalated'],['informationDiscussed','Treatment options, material risks, practical use and questions discussed'],['safetyNetProvided','Medicine-specific safety advice and urgent contact arrangements provided']];\nconst validDate=v=>typeof v==='string'&&/^\\d{4}-\\d\\d-\\d\\d$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;\nexport function validateCareHandover(input,today=new Date().toISOString().slice(0,10)){\n const fail=k=>{throw Object.assign(Error('handover_required_'+k),{status:422});};\n if(!input||input.version!==CARE_HANDOVER_VERSION)fail('version');const out={version:CARE_HANDOVER_VERSION};\n for(const [id,,type]of careFields){const v=input[id];if(typeof v!=='string'||!v.trim()||v.length>4000||/[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]/.test(v))fail(id);if(Array.isArray(type)&&!type.includes(v))fail(id);if(type==='date'&&!validDate(v))fail(id);out[id]=v.trim();}\n for(const [id]of careChecks){if(input[id]!==true)fail(id);out[id]=true;}\n if(out.consultedOn>today||out.verifiedOn>today)fail('future_verification');if(out.followUpDate<=out.consultedOn||out.followUpDate<=today)fail('follow_up_date');\n return out;\n}\n" }, "/clinical-assets/demo-care.mjs": { "type": "text/javascript; charset=utf-8", "body": "import {clinicalCare,appendCare} from '/clinical-assets/care-form.mjs';\nexport const demoCare=form=>clinicalCare(form,{demo:true});\nexport const appendDemoCare=appendCare;\n" }, "/clinical-assets/demo-questionnaire.mjs": { "type": "text/javascript; charset=utf-8", "body": 'export const questionContext={"schemaVersion":"shift-compact-v5-draft-2026-10-23","status":"submitted_snapshot","questions":[{"id":"fullName","label":"Full name"},{"id":"dateOfBirth","label":"Date of birth"},{"id":"heightCm","label":"Height in cm"},{"id":"weightKg","label":"Weight in kg"},{"id":"gpPractice","label":"GP practice"},{"id":"insulinUse","label":"Do you use insulin?","options":["Yes","No"]},{"id":"weightRelatedCondition","label":"Weight-related condition","options":["Yes","No","Not sure"]},{"id":"previousMedicine","label":"Medicine"},{"id":"previousDose","label":"Actual dose"},{"id":"lastDoseDate","label":"Last dose date"},{"id":"requestPath","label":"Which best describes your request?","options":["Starting treatment","Switching provider or medicine","Restarting after a break","Repeat treatment"]},{"id":"forMyself","label":"Is this treatment for you?","options":["Yes","No"]},{"id":"inUK","label":"Are you currently in the UK?","options":["No","Yes","Not sure"]},{"id":"timeOnDose","label":"How long have you taken your current or most recent dose?"},{"id":"nextDoseDate","label":"When is your next dose expected?"},{"id":"missedDoses","label":"Have you missed doses or had a break?","options":["No","Yes","Not sure"]},{"id":"missedDosesDetails","label":"Give the dates or length of the break."},{"id":"sideEffects","label":"Have you had any side effects?","options":["No","Yes","Not sure"]},{"id":"sideEffectsDetails","label":"What happened, and is it still happening?"},{"id":"previousProvider","label":"Who prescribed your previous treatment?"},{"id":"conditionList","label":"Do you have any of the following medical conditions?","options":["Prediabetes","Type 2 diabetes","High blood pressure","High cholesterol","Heart or blood vessel disease (e.g., heart attack, stroke, atrial fibrillation)","Erectile dysfunction","Obstructive sleep apnoea","Asthma","Osteoarthritis","Acid reflux or gastro-oesophageal reflux disease (GORD)","Chronic back pain","Depression","PCOS","NAFLD (Non-Alcoholic Fatty Liver Disease) or MASLD (Metabolic dysfunction-associated steatotic liver disease)","None of the above"]},{"id":"medicalHistory","label":"Have you ever been diagnosed with any of the following?","items":["Severe liver or liver transplant","Kidney disease (eGFR less than 30mL/min)","Heart failure with shortness of breath","History of pancreatitis (inflammation of the pancreas)","Personal or family history (first-degree relatives) of multiple endocrine neoplasia type 2 and medullary thyroid carcinoma","Active cancer, requiring monitoring or treatment","Type 1 diabetes","Diabetes-related eye problems (e.g., diabetic retinopathy)","A current eating disorder or a history of an eating disorder (e.g., anorexia, bulimia, binge eating disorder)","A history of gallstones (if you still have your gallbladder) or gallbladder disease","Any weight loss procedures or surgery in the last 12 months (e.g., gastric sleeve, gastric band, gastric bypass, gastric balloon)","Previous history of bowel or intestinal surgery (excluding appendectomy)","Any uncontrolled or clinically significant endocrine (hormonal) disorder, such as Addison\u2019s disease, Cushing\u2019s syndrome, congenital adrenal hyperplasia, acromegaly, or another growth hormone disorder","Chronic malabsorption syndrome","Current gastrointestinal stoma (e.g. colostomy, ileostomy or other stoma following bowel surgery)","Severe digestive conditions (e.g., Crohn\u2019s disease, ulcerative colitis or gastroparesis)"],"options":["Yes - I have one of the above listed conditions","I have other medical conditions","None of the above","Not sure"]},{"id":"medicalHistoryDetails","label":"Please give details."},{"id":"medicines1","label":"Are you currently taking any medications? (1 of 2)","items":["Weight loss medication (Orlistat, MySimba)","Parkinson\u2019s medication (levodopa, pramipexole, ropinirole, amantadine, bromocriptine, cabergoline, pergolide, rasagiline, selegiline)","Epilepsy medication (carbamazepine, phenytoin, phenobarbital, primidone, sodium valproate/valproic acid, fenfluramine, divalproex, zonisamide, ethosuximide)","Diabetes medication (insulin, sulfonylureas)","Blood thinners (warfarin, acenocoumarol, phenidione)","Medication that requires close monitoring (azathioprine, lithium, methotrexate, theophylline, mycophenolate mofetil, clozapine, colchicine, isoprenaline)","Immunosuppressants (ciclosporin, tacrolimus, sirolimus)","Medication to control your heart rate (flecainide, quinidine, procainamide, disopyramide, amiodarone, digoxin)"],"options":["Yes - I am currently taking one of the above listed medications","I take other medication","None of the above","Not sure"]},{"id":"medicines1Details","label":"List the medicines and doses, including any other prescribed medicines, over-the-counter products, supplements or herbal remedies."},{"id":"medicines2","label":"Are you currently taking any medications? (2 of 2)","items":["Certain antibiotics (Clarithromycin, rifabutin or rifampicin)","Certain antiviral medicines (Paxlovid, ritonavir, cobicistat, telaprevir, nevirapine, efavirenz or etravirine)","Certain antifungal medicines (Itraconazole, oral ketoconazole, posaconazole or voriconazole)","Other medicines (Dexamethasone, modafinil, repaglinide, lumacaftor/ivacaftor, bosentan, gemfibrozil, oral topotecan, simvastatin or rosuvastatin)","Herbal medicines (St John\u2019s wort)"],"options":["Yes - I am currently taking one of the above listed medications","None of the above","Not sure"]},{"id":"medicines2Details","label":"List the medicines and doses, including any other prescribed medicines, over-the-counter products, supplements or herbal remedies."},{"id":"allergies","label":"Are you allergic to any medications?","options":["No","Yes","Not sure"]},{"id":"allergiesDetails","label":"What are you allergic to, and what reaction did you have?"},{"id":"otherAllergies","label":"Do you have any other allergies, including food, latex, plasters or insect stings?","options":["No","Yes","Not sure"]},{"id":"otherAllergiesDetails","label":"What are you allergic to, and what reaction did you have?"},{"id":"pregnancyPossible","label":"Could you become pregnant?","options":["No","Yes","Not sure"]},{"id":"pregnancyStatus","label":"Are you pregnant, planning a pregnancy or breastfeeding?","options":["No","Pregnant","Planning a pregnancy","Breastfeeding","Not sure"]},{"id":"contraception","label":"What contraception do you use, if any?"},{"id":"urgentSymptoms","label":"Do you currently have severe persistent stomach pain, sudden loss of vision or a severe allergic reaction?","options":["No","Yes","Not sure"]},{"id":"urgentSymptomsDetails","label":"Describe your symptoms and advice already sought. Do not wait for this form to be reviewed to seek medical help."},{"id":"gpSharingChoice","label":"May the treating clinical service contact your GP and share relevant care information?","options":["Yes","No","Not sure"]},{"id":"gpSharingDetails","label":"Please explain your concerns or restrictions."},{"id":"treatmentConfirmation","label":"Please read the treatment information. Can you confirm these points?","items":["My answers are complete and accurate; treatment is for my own use.","I will read the medicine leaflet and follow the clinical team\u2019s advice.","I understand treatment requires a prescriber\u2019s decision; payment does not guarantee a prescription.","I will report side effects, new medicines and health changes, and seek urgent medical help for serious symptoms.","I will not combine weight-loss medicines without specific prescriber instructions.","I will follow medicine-specific missed-dose instructions and ask the clinical team about restarting after a break.","If an off-label treatment is proposed, the clinician must explain the specific proposal and obtain consent.","This private environment holds fictional test information only."],"options":["I confirm","I need to discuss this"]},{"id":"treatmentConfirmationDetails","label":"What would you like clarified?"}]};' }, "/clinical-assets/demo-adapter.mjs": { "type": "text/javascript; charset=utf-8", "body": `import {questionContext} from '/clinical-assets/demo-questionnaire.mjs';
import {validateCareHandover} from '/clinical-assets/care-contract.mjs';
// Browser-only fictional simulation. No production API, database, uploads or message sender.
const KEY='shift-clinician-demo-v1',base='/v1/hq/clinical';
const labels={awaiting_review:'Pending',in_review:'To action',needs_information:'Referred back',ready_for_prescription:'Signed off',declined:'Rejected'};
const at=()=>new Date().toISOString(),json=(v,status=200)=>Response.json(v,{status});
function initial(){return {selected:null,cases:['awaiting_review','in_review','needs_information','ready_for_prescription','declined'].map((status,i)=>({id:'00000000-0000-4000-8000-'+String(i+1).padStart(12,'0'),order:'DEMO-'+String(i+1).padStart(4,'0'),name:['Alex Example','Ben Example','Chris Example','Dan Example','Evan Example'][i],status,version:0,assessmentVersion:1,evidenceRevision:1,events:status==='needs_information'?[{id:'seed',kind:'information_requested',message:'Please provide a current full-length photo with your face visible.',createdAt:at(),assessmentVersion:1,evidenceKinds:['front_photo']}]:[]}))};}
let state;try{state=JSON.parse(sessionStorage.getItem(KEY));}catch{}if(!state?.cases)state=initial();const save=()=>sessionStorage.setItem(KEY,JSON.stringify(state));
function evidence(c){return ['photo_id','front_photo','scale_photo','prescription'].map((kind,i)=>({id:kind,digest:kind+'-'+c.evidenceRevision,kind,mime:'image/svg+xml',uploaded_at:at()}));}
function updates(c){return [{kind:'weight',source:'My Timber demo',reportedBy:'Fictional member',occurredAt:at().slice(0,10)+'T09:00:00Z',details:{weightKg:99.4}},{kind:'dose',source:'My Timber demo',reportedBy:'Fictional member',medicine:'Example existing treatment',occurredAt:at().slice(0,10)+'T08:00:00Z',details:{doseStrength:'5 mg'}},{kind:'symptoms',source:'My Timber demo',reportedBy:'Fictional member',occurredAt:at().slice(0,10)+'T07:00:00Z',details:{symptomType:'Mild nausea',symptomSeverity:2,symptomImpact:'No impact on usual activities'}}];}
function event(c,kind,message,more={}){const item={id:crypto.randomUUID(),kind,message,createdAt:at(),assessmentVersion:c.assessmentVersion,...more};c.events.push(item);c.version++;save();return item;}
function notify(c,template,eventId){c.notifications||=[];const title=template==='action_needed'?'Action needed: check your treatment request':template==='approved'?'Your treatment request has been approved':'There is an update to your treatment request';for(const channel of ['Email','WhatsApp'])c.notifications.push({id:crypto.randomUUID(),eventId,channel,title,status:'SIMULATED \xB7 prepared and delivered',at:at(),secureLink:'/member/treatment-records?record='+c.id});save();}
function card(c){return {questionContext,record:{id:c.id,order_number:c.order,updated_at:at()},assessment:{version:c.assessmentVersion,answers:{fullName:c.name+' (fictional)',dateOfBirth:'1980-01-01',heightCm:'175',weightKg:'100',previousMedicine:'Mounjaro \u2014 fictional treatment history',previousDose:'5 mg',lastDoseDate:'2026-10-19',nextDoseDate:'2026-10-26',gpPractice:'Example GP Practice (fictional)',medicalHistory:'None of the above',medicines1:'None of the above',weightConditions:'No listed diagnosed conditions \u2014 fictional example',medicines:'No other medicines \u2014 fictional example',allergies:'None reported \u2014 fictional example',pregnancy:'Not applicable',urgentSymptoms:'No'},evidence:evidence(c),declarations:{accuracy:true,reviewSharing:true,demoOnly:true}},workflow:{status:c.status,version:c.version,events:c.events},answerLabels:{fullName:'Name',dateOfBirth:'Date of birth',lastDoseDate:'Last dose',nextDoseDate:'Next dose due',weightConditions:'Diagnosed conditions related to weight'},displayStatus:labels[c.status],prescriptionIssued:false,pharmacyReleased:false};}
function image(kind){return '<svg xmlns="http://www.w3.org/2000/svg" width="440" height="540" viewBox="0 0 440 540"><rect width="440" height="540" fill="#e7e3da"/><text x="220" y="42" text-anchor="middle" font-family="sans-serif" font-size="18" fill="#050505">DEMO \xB7 NO PATIENT PHOTO</text><circle cx="220" cy="120" r="42" fill="#707762"/><path d="M170 180 Q220 160 270 180 L300 330 L260 340 L250 470 L225 470 L220 350 L215 470 L190 470 L180 340 L140 330 Z" fill="#707762"/><text x="220" y="510" text-anchor="middle" font-family="sans-serif" font-size="19" fill="#050505">'+kind.replaceAll('_',' ')+'</text></svg>';}
export async function demoFetch(input,options={}){
 const url=new URL(typeof input==='string'?input:input.url,location.origin),p=url.pathname;
 if(p==='/v1/hq/me')return json({user:{id:900001,role:'clinical',name:'Demo clinician'}});
 if(p!==base&&!p.startsWith(base+'/'))return json({error:'demo_has_no_external_connections'},404);
 const parts=p.slice(base.length).split('/').filter(Boolean);if(!parts.length)return json({operations:false,records:state.cases.map(c=>({id:c.id,memberId:900000+Number(c.order.slice(-1)),orderNumber:c.order,status:c.status,displayStatus:labels[c.status],availableForReview:true}))});
 const c=state.cases.find(c=>c.id===parts[0]);if(!c)return json({error:'fictional_case_not_found'},404);state.selected=c.id;save();
 if(parts[1]==='evidence'){if(!evidence(c).some(e=>e.id===parts[2]))return json({error:'not_found'},404);c.events.push({id:crypto.randomUUID(),kind:'demo_evidence_viewed',message:'Demo image '+(url.searchParams.get('view')||'preview')+': '+parts[2],createdAt:at(),assessmentVersion:c.assessmentVersion});save();return new Response(image(parts[2]),{headers:{'Content-Type':'image/svg+xml'}});}
 if(parts[1]==='context')return json({enabled:true,sharing:{scopes:['weight','doses','symptoms'],revision:1},orderSource:'available',orders:[{order_number:'DEMO-PAST-001',created_at:'2026-09-20',medicine_name:'Example treatment',strength_label:'5 mg',status:'historical_demo',prescriptionStatus:'Fictional history \u2014 no prescription issued'}],updates:updates(c),sources:[],digest:'demo-updates-v1'});
 if(parts[1]==='audit')return json({events:c.events.map(e=>({id:e.id,created_at:e.createdAt,actor_user_id:900001,action:e.kind,details:{actorKind:'fictional_demo'}})).reverse(),next:null});
 if(parts[1]==='action'){
  let b;try{b=JSON.parse(options.body);}catch{return json({error:'invalid_demo_action'},400);}
  let signatureReceipt,handover;if(b.version!==c.version)return json({error:'case_changed_refresh_demo'},409);
  if(b.action==='start_review')c.status='in_review';
  else if(b.action==='review_evidence'){const e=evidence(c).find(e=>e.id===b.evidenceId);if(!e||e.kind==='photo_id')return json({error:'use_independent_identity_check'},422);if(b.outcome!=='approve'&&!b.message?.trim())return json({error:'reason_required'},422);if(b.outcome!=='approve')c.status='needs_information';const changed=event(c,b.outcome==='approve'?'evidence_reviewed':'information_requested',b.message||'Document accepted.',{evidenceId:e.id,evidenceDigest:e.digest,outcome:b.outcome,evidenceKinds:b.outcome==='reject'?[e.kind]:[]});if(b.outcome!=='approve')notify(c,'action_needed',changed.id);return json({demo:true});}
  else if(b.action==='request_information')c.status='needs_information';
  else if(b.action==='decision'){
   const s=b.signature;if(!s?.confirmed||!['draw','typed'].includes(s.mode)||typeof s.mark!=='string'||(s.mode==='typed'?!s.mark.trim()||s.mark.length>100:!/^data:image\\/png;base64,[A-Za-z0-9+/=]+$/.test(s.mark)||s.mark.length<100||s.mark.length>100000))return json({error:'demo_signature_and_confirmation_required'},422);
   const assessment=card(c).assessment;const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({version:assessment.version,answers:assessment.answers,evidence:assessment.evidence.map(e=>({id:e.id,digest:e.digest}))})))),b=>b.toString(16).padStart(2,'0')).join('');
   signatureReceipt={...s,signer:'Demo clinician',registration:'DEMO-ONLY',signedAt:at(),assessmentVersion:c.assessmentVersion,assessmentDigest:digest,affirmation:'I have reviewed this assessment and confirm this decision.'};
   if(b.outcome==='proceed'){
    try{handover=validateCareHandover(b.handover);}catch(e){return json({error:e.message},422);}
    if(!b.identityVerified||!b.independentMeasurementsVerified||!b.verification?.trim())return json({error:'independent_checks_required_even_in_demo'},422);
    const approved=evidence(c).filter(e=>e.kind!=='photo_id').every(e=>c.events.filter(v=>v.evidenceId===e.id&&v.evidenceDigest===e.digest).at(-1)?.outcome==='approve');if(!approved)return json({error:'approve_each_medical_image_first'},422);
    c.status='ready_for_prescription';
   }else c.status=b.outcome==='decline'?'declined':'consultation_required';
  }else if(!['note','review_updates'].includes(b.action))return json({error:'unknown_demo_action'},422);
  if(signatureReceipt){signatureReceipt.decisionDigest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify({assessmentDigest:signatureReceipt.assessmentDigest,outcome:b.outcome,rationale:b.rationale,message:b.message,handover})))),b=>b.toString(16).padStart(2,'0')).join('');}
  const changed=event(c,b.action==='review_updates'?'app_updates_reviewed':b.action==='request_information'?'information_requested':b.action,b.message,{evidenceKinds:b.evidenceKinds||[],outcome:b.outcome,clinical:{note:b.note,rationale:b.rationale,...handover?{handover}:{},...signatureReceipt?{signature:signatureReceipt}:{},...b.action==='review_updates'?{updates:updates(c)}:{}}});if(b.action==='request_information')notify(c,'action_needed',changed.id);if(b.action==='decision')notify(c,b.outcome==='proceed'?'approved':'update',changed.id);return json({demo:true,prescriptionIssued:false,pharmacyReleased:false});
 }
 if(parts.length===1)return json(card(c));return json({error:'demo_route_not_found'},404);
}
function refresh(c){const u=new URL(location.href);if(c)u.searchParams.set('record',c.id);history.replaceState(null,'',u);location.reload();}
function controls(){
 const bar=document.createElement('div');bar.id='demo-banner';bar.style.cssText='position:relative;z-index:5;background:#707762;color:white;padding:14px 24px;font:15px/1.5 system-ui';
 const note=document.createElement('strong');note.textContent='DEMO ONLY \xB7 Fictional members \xB7 Changes saved in this tab only \xB7 No real messages or prescriptions. Do not enter real patient information.';bar.append(note);
 const reset=document.createElement('button');reset.textContent='Reset demo';reset.onclick=()=>{sessionStorage.removeItem(KEY);location.href='/clinical-portal/demo';};
 const member=document.createElement('button');member.textContent='Member view / simulate reply';member.onclick=()=>{
  const c=state.cases.find(c=>c.id===state.selected);if(!c)return alert('Select a fictional order first.');
  const dialog=document.createElement('dialog');dialog.style.cssText='width:min(760px,calc(100% - 28px));max-height:88vh;overflow:auto;padding:28px;background:#e7e3da;border:3px solid #707762;border-radius:12px;color:#050505';
  const h=document.createElement('h2');h.textContent='Fictional member order \xB7 '+c.order;dialog.append(h);
  const memberStatus={awaiting_review:'Submitted \xB7 awaiting clinical review',in_review:'Clinical review in progress',needs_information:'Action needed from you',ready_for_prescription:'Clinically approved \xB7 prescription handover pending',declined:'Treatment request not approved'}[c.status]||c.status;
  const latest=c.events.at(-1),reviewed=[...c.events].reverse().find(e=>['review_started','evidence_reviewed','information_requested','decision','care_step'].includes(e.kind));
  const summary=document.createElement('section');summary.style.cssText='background:#fff;padding:18px;border-left:6px solid #707762;border-radius:8px';
  for(const [label,value] of [['Status',memberStatus],['Last looked at',reviewed?new Date(reviewed.createdAt).toLocaleString('en-GB'):'Awaiting review'],['Latest update',latest?.message||'Assessment received'],['Updated',latest?new Date(latest.createdAt).toLocaleString('en-GB'):'No updates yet'],['What happens next',c.status==='needs_information'?'Read the request, update the answer or document and resubmit.':c.status==='ready_for_prescription'?(c.pathway?.prescription?'Prescription issued to the dispensing pharmacy.':'The prescription service must issue the prescription before pharmacy review.') :c.status==='declined'?'Read the clinician\u2019s explanation. Contact the clinical service if anything is unclear.':'No action unless the clinical team contacts you.']]){const strong=document.createElement('strong');strong.textContent=label;const p=document.createElement('p');p.textContent=value;summary.append(strong,p);}dialog.append(summary);
  const publicEvents=c.events.filter(e=>e.message&&(['information_requested','member_replied','decision','care_step'].includes(e.kind)||(e.kind==='evidence_reviewed'&&e.outcome!=='approve')));const timeline=document.createElement('details');timeline.open=true;const ts=document.createElement('summary');ts.textContent='Recent changes and actions';timeline.append(ts);for(const e of publicEvents.slice(-8).reverse()){const time=document.createElement('small');time.textContent=new Date(e.createdAt).toLocaleString('en-GB');const p=document.createElement('p');p.textContent=e.message;timeline.append(time,p);}if(!publicEvents.length)timeline.append(Object.assign(document.createElement('p'),{textContent:'No recent changes.'}));dialog.append(timeline);
  const notifications=document.createElement('details');const ns=document.createElement('summary');ns.textContent='Notification history \xB7 simulation';notifications.append(ns);for(const n of (c.notifications||[]).slice().reverse()){const p=document.createElement('p');p.textContent=n.channel+' \xB7 '+n.status+' \xB7 '+new Date(n.at).toLocaleString('en-GB')+' \xB7 '+n.title;notifications.append(p);}if(!c.notifications?.length)notifications.append(Object.assign(document.createElement('p'),{textContent:'No simulated notification yet.'}));dialog.append(notifications);
  const plan=c.events.filter(e=>e.kind==='decision'&&e.clinical?.handover).at(-1)?.clinical.handover;if(plan){const info=document.createElement('p');info.textContent='Treatment plan: '+plan.medicine+' \xB7 '+plan.dose+' \xB7 '+plan.directions+' \xB7 Review '+plan.followUpDate+' with '+plan.followUpOwner+'. Prescription: '+(c.pathway?.prescription?'issued to pharmacy in this simulation':'not yet issued')+'. Pharmacy: '+(c.pathway?.pharmacy?'accepted for dispensing in this simulation':'not yet accepted')+'.';dialog.append(info);}
  const reply=document.createElement('button');reply.textContent='Simulate reply + replacement photo';reply.disabled=c.status!=='needs_information';reply.onclick=()=>{c.status='awaiting_review';c.assessmentVersion++;c.evidenceRevision++;event(c,'member_replied','Fictional member uploaded replacement evidence and resubmitted.');refresh(c);};
  const close=document.createElement('button');close.textContent='Close';close.onclick=()=>{dialog.close();dialog.remove();};dialog.append(reply,close);document.body.append(dialog);dialog.showModal();
 };bar.append(document.createElement('br'),member,reset);document.body.prepend(bar);
}
controls();
// These are simulated partner receipts, not real prescriptions, communications or deliveries.
export function appendDemoJourney(host,current){
 const c=state.cases.find(c=>c.id===current.record.id);if(!c)return;
 const plan=c.events.filter(e=>e.kind==='decision'&&e.clinical?.handover).at(-1)?.clinical.handover;
 const panel=document.createElement('details');panel.className='clinical-card';const title=document.createElement('summary');title.textContent='Care journey and partner handover \xB7 simulation';panel.append(title);
 const note=document.createElement('p');note.textContent='Simulated receipts only. Real prescribing, GP messages, pharmacy release, delivery and follow-up require commissioned services.';panel.append(note);
 const contact=document.createElement('button');contact.type='button';contact.textContent='View fictional contact card with audit reason';contact.onclick=()=>{const reason=prompt('Demo: record why clinical contact access is needed. Do not enter real patient details.');if(!reason?.trim())return;c.events.push({id:crypto.randomUUID(),kind:'contact_accessed',createdAt:at(),assessmentVersion:c.assessmentVersion,message:'Fictional contact card accessed',clinical:{reason:reason.trim()}});save();const card=document.createElement('p');card.textContent='Fictional data only: '+c.name+' \xB7 DOB 01/01/1980 \xB7 1 Example Street, Example Town ZZ1 1ZZ \xB7 07700 900123 \xB7 patient@example.invalid \xB7 Example GP Practice. Real contact would be routed through the authorised clinical service.';panel.append(card);contact.disabled=true;};panel.append(contact);
 if(!plan||c.status!=='ready_for_prescription'){const p=document.createElement('p');p.textContent='Complete a signed suitable-to-proceed decision with its clinical handover before simulating the next stages.';panel.append(p);host.append(panel);return;}
 const steps=[['prescription','Simulate prescription service receipt'],['gp','Simulate GP update or documented sharing exception'],['pharmacy','Simulate pharmacy acceptance'],['dispatch','Simulate dispatch receipt'],['followup','Simulate follow-up review completed']];
 c.pathway||={};for(const [key,text]of steps){const p=document.createElement('p');p.textContent=text+': '+(c.pathway[key]?'SIMULATED \xB7 '+c.pathway[key].reference+' \xB7 '+c.pathway[key].at:'Awaiting simulation');panel.append(p);}
 if(c.pathway.prescription){const view=document.createElement('button');view.type='button';view.textContent='View simulated electronic prescription';view.onclick=()=>{const rx=c.pathway.prescription,d=document.createElement('dialog');d.style.cssText='width:min(720px,calc(100% - 28px));max-height:88vh;overflow:auto;padding:28px;background:#fff;border:4px solid #050505;color:#050505';const h=document.createElement('h2');h.textContent='SIMULATION \xB7 Electronic private prescription';const warning=document.createElement('p');warning.textContent='DEMO ONLY \u2014 not a valid prescription and cannot authorise supply.';warning.style.cssText='font-weight:800;color:#b42318';d.append(h,warning);for(const [label,value]of [['Prescription reference',rx.reference],['Issue date and time',new Date(rx.at).toLocaleString('en-GB')],['Patient','Alex Example (fictional) \xB7 DOB 01/01/1980'],['Patient address','1 Example Street, Example Town, ZZ1 1ZZ'],['Medicine',rx.medicine],['Strength and dose',rx.dose],['Directions and route',rx.directions],['Quantity',rx.quantity],['Prescriber','Demo clinician \xB7 DEMO-ONLY'],['Prescriber address','SHIFT fictional clinical service, 1 Demo Square, London, ZZ1 1ZZ'],['Linked clinical decision',rx.decisionId],['Electronic signature','Simulation receipt only \xB7 assessment and decision digest bound'],['Dispensing destination',c.pathway.pharmacy?'Fictional pharmacy \xB7 accepted':'Fictional pharmacy \xB7 awaiting acceptance']]){const strong=document.createElement('strong');strong.textContent=label;const p=document.createElement('p');p.textContent=value;d.append(strong,p);}const close=document.createElement('button');close.textContent='Close prescription';close.onclick=()=>{d.close();d.remove();};d.append(close);document.body.append(d);d.showModal();};panel.append(view);}
 const next=steps.find(([key])=>!c.pathway[key]);if(next){const [key,text]=next;const b=document.createElement('button');b.type='button';b.textContent=text;b.onclick=()=>{const index=steps.findIndex(([k])=>k===key);if(steps.slice(0,index).some(([k])=>!c.pathway[k]))return;const reference='DEMO-'+key.toUpperCase()+'-'+crypto.randomUUID().slice(0,8);c.pathway[key]={reference,at:at(),simulation:true,...key==='prescription'?{medicine:plan.medicine,dose:plan.dose,directions:plan.directions,quantity:plan.quantity,decisionId:c.events.filter(e=>e.kind==='decision').at(-1).id}:key==='gp'?{plan:plan.gpPlan,routeReference:plan.gpReference}:key==='followup'?{reviewOwner:plan.followUpOwner,reviewDate:plan.followUpDate}:{} };const changed=event(c,'care_step','Simulated '+key+' recorded. No external action occurred.',{clinical:{receipt:c.pathway[key]}});if(['prescription','pharmacy','dispatch'].includes(key))notify(c,'update',changed.id);refresh(c);};panel.append(b);}
 const follow=document.createElement('p');follow.textContent='Next review: '+plan.followUpDate+' \xB7 Owner: '+plan.followUpOwner+' \xB7 Monitoring: '+plan.monitoringPlan;panel.append(follow);host.append(panel);
}
` }, "/clinical-assets/demo-signature.mjs": { "type": "text/javascript; charset=utf-8", "body": "// Demo-only visual sign-off. This is not an authenticated electronic prescription.\nexport function demoSignature(form){\n const box=document.createElement('fieldset'),legend=document.createElement('legend');box.style.cssText='min-width:0;margin:16px 0;padding:16px;border:1px solid #707762;border-radius:8px';legend.textContent='Clinician sign-off \xB7 demo';box.append(legend);\n const caption=document.createElement('p');caption.textContent='Fictional signer: Demo clinician \xB7 Registration: DEMO-ONLY. Draw demonstration initials or use the typed alternative.';box.append(caption);\n const mode=document.createElement('select');mode.setAttribute('aria-label','Signature method');for(const [v,t]of [['draw','Draw initials / signature'],['typed','Type initials / name']]){const o=document.createElement('option');o.value=v;o.textContent=t;mode.append(o);}box.append(mode);\n const canvas=document.createElement('canvas');canvas.width=700;canvas.height=220;canvas.setAttribute('aria-label','Draw demo signature');canvas.style.cssText='display:block;width:100%;height:150px;background:#fff;border:2px solid #707762;border-radius:8px;touch-action:none';const ctx=canvas.getContext('2d');ctx.lineWidth=4;ctx.lineCap='round';ctx.strokeStyle='#050505';let drawing=false,hasInk=false;\n const point=e=>{const r=canvas.getBoundingClientRect();return [(e.clientX-r.left)*canvas.width/r.width,(e.clientY-r.top)*canvas.height/r.height];};canvas.onpointerdown=e=>{e.preventDefault();drawing=true;hasInk=true;canvas.setPointerCapture(e.pointerId);const [x,y]=point(e);ctx.beginPath();ctx.moveTo(x,y);ctx.lineTo(x+.5,y+.5);ctx.stroke();};canvas.onpointermove=e=>{if(!drawing)return;e.preventDefault();ctx.lineTo(...point(e));ctx.stroke();};canvas.onpointerup=canvas.onpointercancel=()=>{drawing=false;};\n const clear=document.createElement('button');clear.type='button';clear.textContent='Clear signature';clear.onclick=()=>{ctx.clearRect(0,0,canvas.width,canvas.height);hasInk=false;};\n const label=document.createElement('label');label.textContent='Typed demo initials or name';const typed=document.createElement('input');typed.type='text';typed.maxLength=100;typed.autocomplete='off';label.append(typed);label.hidden=true;\n mode.onchange=()=>{canvas.hidden=mode.value!=='draw';canvas.style.display=canvas.hidden?'none':'block';clear.hidden=canvas.hidden;label.hidden=!canvas.hidden;typed.required=mode.value==='typed';};\n const confirmLabel=document.createElement('label'),confirm=document.createElement('input');confirm.type='checkbox';confirm.required=true;confirmLabel.append(confirm,document.createTextNode('I have reviewed this assessment and confirm this decision.'));\n const error=document.createElement('p');error.setAttribute('role','alert');box.append(canvas,clear,label,confirmLabel,error);form.append(box);\n return {valid(){error.textContent='';if(mode.value==='draw'&&!hasInk){error.textContent='Draw your demo initials or choose the typed alternative.';return false;}if(mode.value==='typed'&&!typed.value.trim()){error.textContent='Enter your demo initials or name.';return false;}return true;},value(){return {mode:mode.value,mark:mode.value==='draw'?canvas.toDataURL('image/png'):typed.value.trim(),confirmed:confirm.checked};}};\n}\nexport function appendDemoSignature(host,s){if(!s)return;const box=document.createElement('article');box.className='clinical-card';const title=document.createElement('strong');title.textContent='Demo sign-off \xB7 '+s.signer+' \xB7 '+s.registration;const p=document.createElement('p');p.textContent=new Date(s.signedAt).toLocaleString('en-GB')+' \xB7 Assessment '+s.assessmentVersion+' \xB7 '+s.affirmation;box.append(title,p);if(s.mode==='draw'){const img=document.createElement('img');img.src=s.mark;img.alt='Recorded demo signature';img.style.cssText='max-width:100%;width:350px;background:#fff';box.append(img);}else{const mark=document.createElement('p');mark.textContent='Signed: '+s.mark;mark.style.fontStyle='italic';box.append(mark);}const digest=document.createElement('small');digest.style.cssText='display:block;overflow-wrap:anywhere';digest.textContent='Demo assessment SHA-256: '+s.assessmentDigest;box.append(digest);host.append(box);}\n" }, "/clinical-assets/demo-client.mjs": { "type": "text/javascript; charset=utf-8", "body": `import {demoFetch as fetch} from '/clinical-assets/demo-adapter.mjs';
import {appendDemoJourney} from '/clinical-assets/demo-adapter.mjs';
import {demoSignature,appendDemoSignature} from '/clinical-assets/demo-signature.mjs';
import {demoCare,appendDemoCare} from '/clinical-assets/demo-care.mjs';
import {mountPrescription} from '/clinical-assets/prescription-clinician.mjs';
import {clinicalCare,appendCare} from '/clinical-assets/care-form.mjs';
// Mounted into the existing HQ shell. HQ session cookies are the only authentication.
const API='https://api.shiftsometimber.co.uk/v1/hq/clinical';
const el=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};
let section,content,notice,current,busy=false,serial=0,active=false,detailPane,orderList,selectedId,knownRole=null,lastIdentity='',identifying=false;const mediaUrls=new Set();let viewer;
const label=v=>String(v||'').replaceAll('_',' ');
function clearMedia(){if(viewer){viewer.close();viewer.remove();viewer=null;}for(const url of mediaUrls)URL.revokeObjectURL(url);mediaUrls.clear();}
function clear(){clearMedia();serial++;current=null;content?.replaceChildren();if(notice)notice.textContent='Sign in to HQ to load clinical cases.';}
async function api(path='',body){const r=await fetch(API+path,{method:body===undefined?'GET':'POST',credentials:'include',cache:'no-store',headers:body===undefined?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)});if(r.status===401){clear();throw Error('Your HQ session ended. Sign in again.');}if(!r.ok){const e=await r.json();throw Error(label(e.error));}return r.json();}
function button(text,fn){const b=el('button',text);b.type='button';b.onclick=async()=>{if(busy)return;busy=true;b.disabled=true;const n=serial;try{await fn();}catch(e){if(n===serial)notice.textContent=e.message;}finally{busy=false;b.disabled=false;}};return b;}
const statusLabels={draft:'Pending',awaiting_review:'Pending',in_review:'To action',needs_information:'Referred back',consultation_required:'To action',ready_for_prescription:'Ready for prescription',prescription_issued:'Signed off',declined:'Rejected'};
async function queue(){
 clearMedia();const n=++serial;current=null;content.replaceChildren();notice.textContent='Loading orders\u2026';const data=await api();const staff=data.operations?(await api('/staff')).staff:[];if(n!==serial||!active)return;
 document.body.classList.toggle('clinician-only',!data.operations);for(const b of document.querySelectorAll('header button'))if(/HQ settings/i.test(b.textContent))b.hidden=!data.operations;for(const other of document.querySelectorAll('main>.view'))if(other!==section)other.inert=!data.operations;
 notice.textContent=data.operations?'Assign verified clinicians to orders.':'Review your assigned orders and keep all communication in the member portal.';
 const workspace=el('div');workspace.className='clinical-workspace';const left=el('aside');left.className='clinical-orders';left.append(el('h2','Clinician portal'));const filters=el('select');filters.setAttribute('aria-label','Filter clinical cases');for(const v of ['All orders','Pending','To action','Referred back','Ready for prescription','Signed off','Rejected']){const o=el('option',v);o.value=v;filters.append(o);}const search=el('input');search.placeholder='Find order number';search.setAttribute('aria-label','Find clinical case');orderList=el('div');left.append(filters,search,button('Refresh orders',queue),orderList);detailPane=el('div');detailPane.className='clinical-detail';detailPane.append(el('h2','Select an order'),el('p','The member\u2019s clinical card and available actions will appear here.'));workspace.append(left,detailPane);content.append(workspace);
 function draw(){orderList.replaceChildren();const shown=data.records.filter(r=>(filters.value==='All orders'||(r.displayStatus||statusLabels[r.status])===filters.value)&&((r.orderNumber||'')+' '+r.id).toLowerCase().includes(search.value.toLowerCase()));if(!shown.length)orderList.append(el('p','No orders in this view.'));for(const r of shown){const row=el('article');row.dataset.clinicalMember=String(r.memberId);row.className='clinical-order-row';const title=r.orderNumber||'Unlinked request',status=r.displayStatus||statusLabels[r.status]||'Pending';const badge=el('span',status);badge.className='clinical-status';badge.dataset.status=status;
 if(!data.operations){const choose=button(title,()=>open(r.id));choose.className='clinical-order';choose.disabled=r.availableForReview===false;if(choose.disabled)choose.title='The member is updating this record. Review resumes after submission.';choose.dataset.order=r.id;choose.setAttribute('aria-label','Open order '+title);choose.append(badge);row.append(choose);}else{row.append(el('strong',title),badge);const choose=el('select');choose.setAttribute('aria-label','Assign clinician for '+r.id);for(const s of staff){const o=el('option','HQ user '+s.user_id+' \xB7 '+s.registration_body+' '+s.registration_number);o.value=s.user_id;choose.append(o);}row.append(choose,button('Assign clinician',async()=>{if(!choose.value)throw Error('No verified clinician is provisioned.');await api('/'+r.id+'/assignment',{staffUserId:Number(choose.value),active:true});notice.textContent='Clinician assigned.';}),button('Revoke selected clinician',async()=>{if(!choose.value)throw Error('Choose a clinician.');await api('/'+r.id+'/assignment',{staffUserId:Number(choose.value),active:false});notice.textContent='Clinician access revoked.';}));}orderList.append(row);}}
 filters.onchange=search.oninput=draw;draw();
}
async function open(id){clearMedia();const n=++serial;current=null;selectedId=id;detailPane.replaceChildren(el('p','Loading order\u2026'));const data=await api('/'+id);if(n!==serial||!active)return;current=data;for(const b of orderList.querySelectorAll('[data-order]')){b.classList.toggle('selected',b.dataset.order===id);b.setAttribute('aria-pressed',String(b.dataset.order===id));}drawCase();}
async function action(body){const n=serial;await api('/'+current.record.id+'/action',{version:current.workflow.version,assessmentVersion:current.assessment.version,...body});if(n===serial&&active){const id=current.record.id;await queue();await open(id);}}
function textField(form,name,title){const w=el('label',title),i=el('textarea');i.name=name;i.required=true;i.maxLength=4000;w.append(i);form.append(w);return i;}
function check(form,name,title){const w=el('label'),i=el('input');i.type='checkbox';i.name=name;w.append(i,el('span',title));form.append(w);return i;}
async function loadEvidence(recordId,e,purpose,captured){
 const response=await fetch(API+'/'+recordId+'/evidence/'+e.id+'?view='+purpose,{credentials:'include',cache:'no-store'});
 if(response.status===401){clear();throw Error('Your session ended. Sign in again.');}if(!response.ok)throw Error('This evidence is not available. Refresh the order.');const blob=await response.blob();if(captured!==serial||!active||current?.record.id!==recordId)return null;const url=URL.createObjectURL(blob);mediaUrls.add(url);return url;
}
async function enlargeEvidence(recordId,e){const captured=serial,url=await loadEvidence(recordId,e,'enlarge',captured);if(!url)return;if(viewer){viewer.close();viewer.remove();}viewer=el('dialog');viewer.className='clinical-image-viewer';viewer.setAttribute('aria-label','Enlarged '+label(e.kind));const bar=el('div');bar.className='clinical-viewer-bar';bar.append(el('h2',label(e.kind)),button('Close photo',()=>{viewer.close();viewer.remove();viewer=null;URL.revokeObjectURL(url);mediaUrls.delete(url);}));viewer.append(bar);if(e.mime.startsWith('image/')){const image=el('img');image.src=url;image.alt='Enlarged '+label(e.kind);image.draggable=false;image.oncontextmenu=event=>event.preventDefault();viewer.append(image);}else{const frame=el('iframe');frame.src=url+'#toolbar=0&navpanes=0';frame.title='Prescription evidence';viewer.append(frame);}viewer.addEventListener('cancel',()=>{URL.revokeObjectURL(url);mediaUrls.delete(url);});document.body.append(viewer);viewer.showModal();}
async function drawContext(record,workflow,host){
 const captured=serial,data=await api('/'+record.id+'/context');if(captured!==serial||current?.record.id!==record.id)return;
 if(!data.enabled){host.append(el('p','Order history and My Timber sharing are not enabled in this environment.'));return;}
 const orders=el('details');orders.className='clinical-card';orders.append(el('summary','SHIFT order and prescription history \xB7 '+data.orders.length));
 if(data.orderSource!=='available')orders.append(el('p','Order history source unavailable. This does not mean there are no previous orders.'));
 else if(!data.orders.length)orders.append(el('p','No SHIFT medicine orders recorded.'));
 else {const table=el('table'),head=el('tr');for(const name of ['Order','Date','Treatment','Order status','Prescription'])head.append(el('th',name));table.append(head);for(const o of data.orders){const tr=el('tr');for(const v of [o.order_number,o.created_at.slice(0,10),o.medicine_name+' '+o.strength_label,label(o.status),o.prescriptionStatus])tr.append(el('td',v));table.append(tr);}const wrap=el('div');wrap.className='clinical-history-table';wrap.append(table);orders.append(wrap);if(data.moreOrders)orders.append(el('p','Showing the latest 200 orders.'));orders.append(el('p','An order or clinical approval is not proof that a prescription was issued.'));}host.append(orders);
 const panel=el('details');panel.className='clinical-card';const last=workflow.events.filter(e=>e.kind==='app_updates_reviewed').at(-1),seen=new Set((last?.clinical?.updates||[]).map(e=>JSON.stringify(e))),newCount=data.updates.filter(e=>!seen.has(JSON.stringify(e))).length;
 panel.append(el('summary','My Timber updates \xB7 '+newCount+' new / changed updates'),el('p','Relevant updates shared by the member \xB7 Last 90 days \xB7 Not continuously monitored.'));
 if(!data.sharing.scopes.length)panel.append(el('p','The member has not enabled optional app sharing for this assessment.'));
 else if(!data.updates.length)panel.append(el('p','No shared updates returned for this period.'));
 if(last)panel.append(el('p','Last reviewed '+new Date(last.createdAt).toLocaleString('en-GB',{timeZone:'Europe/London'})+' \xB7 Assessment '+last.assessmentVersion));
 const entries=el('div');for(const e of data.updates){const item=el('article');item.append(el('strong',e.occurredAt.slice(0,10)+' \xB7 '+label(e.kind)+(seen.has(JSON.stringify(e))?'':' \xB7 NEW')),el('p',e.source+' \xB7 '+e.reportedBy+(e.medicine?' \xB7 '+e.medicine:'')));for(const [k,v]of Object.entries(e.details))item.append(el('p',({weightKg:'Weight (kg)',doseStrength:'Dose',sideEffects:'Reported side effects',symptomType:'Symptom',symptomSeverity:'Severity out of 10',symptomImpact:'Impact',symptomStartedAt:'Symptom started',appetite:'Appetite',energy:'Energy'}[k]||label(k))+': '+v));entries.append(item);}panel.append(entries);
 for(const source of data.sources)if(source.status!=='available'||source.truncated)panel.append(el('p',source.name+': '+(source.truncated?'History truncated \u2014 review the underlying member record.':'Source unavailable; do not assume no updates.')));
 if(data.updates.length)panel.append(button('Mark updates reviewed',()=>action({action:'review_updates',digest:data.digest})));
 host.append(panel);
}
function drawCase(){detailPane.replaceChildren();const {record,assessment,workflow}=current;notice.textContent=current.displayStatus||statusLabels[workflow.status];detailPane.append(el('h2',record.order_number||'Treatment request'),el('p',(current.displayStatus||statusLabels[workflow.status])+' \xB7 Assessment '+assessment.version));if(workflow.status==='ready_for_prescription')detailPane.append(el('p','Clinical review completed. Prescription signing and member agreement are recorded separately.'));
 const summary=el('article');summary.className='clinical-card';summary.append(el('h3','Member clinical card'));const a=assessment.answers;for(const [key,title]of [['fullName','Name'],['dateOfBirth','DOB'],['heightCm','Height (cm)'],['weightKg','Weight (kg)'],['previousMedicine','Current / previous medicine'],['previousDose','Dose'],['gpPractice','GP practice']])if(a[key])summary.append(el('p',title+': '+a[key]));summary.append(el('small','Member details from submitted assessment '+assessment.version+' \xB7 '+new Date(record.updated_at).toLocaleDateString('en-GB')));detailPane.append(summary);appendDemoJourney(detailPane,current);const contextHost=el('div');contextHost.className='clinical-context';detailPane.append(contextHost);drawContext(record,workflow,contextHost).catch(e=>{if(current?.record.id===record.id)contextHost.append(el('p','Clinical history could not be loaded: '+e.message));});
 const details=el('details');details.append(el('summary','Questionnaire, GP details and declarations'));const questionMap=new Map((current.questionContext?.questions||[]).map(q=>[q.id,q]));details.append(el('p',current.questionContext?.status==='submitted_snapshot'?'Question wording retained with this submitted assessment.':current.questionContext?.status==='catalogue_reference'?'Question wording from the matching schema catalogue; no historical snapshot is available for this older record.':'Original question context unavailable. Obtain clarification before relying on ambiguous answers.'));for(const [k,v]of Object.entries(a)){const q=questionMap.get(k);details.append(el('strong',q?.label||current.answerLabels?.[k]||label(k)));if(q?.items?.length){const list=el('ul');for(const item of q.items)list.append(el('li',item));details.append(list);}let answer=v;try{if(Array.isArray(JSON.parse(v)))answer=JSON.parse(v).join(', ');}catch{}details.append(el('p','Answer: '+answer));}const declarations=assessment.declarations;details.append(el('p','Declarations: accuracy '+(declarations.accuracy?'confirmed':'not confirmed')+' \xB7 clinical sharing '+(declarations.reviewSharing?'confirmed':'not confirmed')+' \xB7 version '+(declarations.version||assessment.version)));detailPane.append(details);
 const docs=el('article');docs.className='clinical-card clinical-evidence';docs.append(el('h3','Photos and evidence'),el('p','Select a photo to enlarge it.'));const grid=el('div');grid.className='clinical-photo-grid';docs.append(grid);
 for(const e of assessment.evidence){const tile=el('figure');tile.className='clinical-photo';const title=label(e.kind);const preview=button('Enlarge '+title,()=>enlargeEvidence(record.id,e));preview.className='clinical-photo-button';preview.setAttribute('aria-label','Enlarge '+title);if(e.mime.startsWith('image/')){const image=el('img');image.alt=title+' preview';image.draggable=false;image.oncontextmenu=event=>event.preventDefault();preview.prepend(image);loadEvidence(record.id,e,'preview',serial).then(url=>{if(url)image.src=url;}).catch(error=>{if(current?.record.id===record.id)notice.textContent=error.message;});}else{preview.prepend(el('span','PDF'));}tile.append(preview,el('figcaption',title),el('small','Uploaded '+new Date(e.uploaded_at).toLocaleDateString('en-GB')));
 if(e.kind==='photo_id'){tile.append(el('p','SHIFT AI ID check: awaiting connection'),el('small','No automatic verification has been completed. Independent identity verification is required before sign-off.'));}
 else {const latest=workflow.events.filter(event=>event.evidenceId===e.id&&event.evidenceDigest===e.digest).at(-1);tile.append(el('p','Review: '+(latest?({approve:'Approved',reject:'Rejected \u2014 replacement requested',query:'Query sent'}[latest.outcome]||'Pending'):'Pending')));if(['awaiting_review','in_review','needs_information'].includes(workflow.status)){const controls=el('details');controls.append(el('summary','Review this document'));const form=el('form');const reason=textField(form,'reason','Reason or question for the member');reason.required=false;form.onsubmit=event=>event.preventDefault();for(const [outcome,title]of [['approve','Approve'],['reject','Reject'],['query','Query']])form.append(button(title,()=>{reason.required=outcome!=='approve';if(form.reportValidity())return action({action:'review_evidence',evidenceId:e.id,outcome,message:reason.value});}));controls.append(form);tile.append(controls);}}
 grid.append(tile);}detailPane.append(docs);
 const history=el('details');history.className='clinical-card';history.append(el('summary','History and audit trail'));for(const e of workflow.events){history.append(el('strong',label(e.kind)),el('p',new Date(e.createdAt).toLocaleString('en-GB')+' \xB7 Assessment '+e.assessmentVersion));if(e.message)history.append(el('p',e.message));appendCare(history,e.clinical?.handover);appendDemoSignature(history,e.clinical?.signature);if(e.clinical?.note)history.append(el('p','Internal: '+e.clinical.note));if(e.clinical?.rationale)history.append(el('p','Clinical rationale: '+e.clinical.rationale));}history.append(button('Load audit trail',async()=>{const panel=el('div');history.append(panel);let cursor='';async function more(){const data=await api('/'+record.id+'/audit'+cursor);for(const e of data.events){panel.append(el('p',new Date(e.created_at).toLocaleString('en-GB')+' \xB7 '+label(e.action)+' \xB7 '+(e.details.actorKind||'member')+' #'+e.actor_user_id));}if(data.next){cursor='?'+new URLSearchParams(data.next);panel.append(button('Earlier activity',more));}}await more();}));detailPane.append(history);
 if(workflow.status==='awaiting_review')detailPane.append(button('Start review',()=>action({action:'start_review'})));
 if(['awaiting_review','in_review'].includes(workflow.status)){
 const form=el('form');form.className='clinical-card';form.append(el('h3','Ask for more information'));const message=textField(form,'message','Explain what is needed and why');for(const k of ['photo_id','front_photo','scale_photo','prescription'])check(form,k,'Replacement '+label(k));form.append(button('Send request to member profile',()=>{if(!form.reportValidity())return;return action({action:'request_information',message:message.value,evidenceKinds:['photo_id','front_photo','scale_photo','prescription'].filter(k=>form.elements[k].checked)});}));form.append(el('p','Simulated request only. Use Member view to demonstrate a reply. No email or WhatsApp is sent.'));detailPane.append(form);
 }
 if(workflow.status==='in_review'){
 const form=el('form');form.className='clinical-card';form.append(el('h3','Record clinical decision'));const outcome=el('select');outcome.setAttribute('aria-label','Clinical outcome');outcome.required=true;for(const [v,t]of [['','Choose an action'],['proceed','Approve clinical review'],['decline','Decline treatment'],['consultation','Request consultation']]){const o=el('option',t);o.value=v;outcome.append(o);}form.append(outcome);const message=textField(form,'message','Explanation for the member'),rationale=textField(form,'rationale','Private clinical rationale');const identity=check(form,'identity','Identity independently checked'),measure=check(form,'measure','Measurements independently verified');const verification=textField(form,'verification','Verification method, source and date');verification.required=false;const care=demoCare(form);const signature=demoSignature(form);form.append(button('Sign and record decision',()=>{care.requireForProceed(outcome.value==='proceed');if(!signature.valid()||!form.reportValidity())return;return action({action:'decision',signature:signature.value(),handover:care.value(),outcome:outcome.value,message:message.value,rationale:rationale.value,identityVerified:identity.checked,independentMeasurementsVerified:measure.checked,verification:verification.value});}));detailPane.append(form);
 }
 const prescriptionHost=el('article');prescriptionHost.className='clinical-card';detailPane.append(prescriptionHost);const captured=serial;mountPrescription(prescriptionHost,{node:el,button,request:(path,body)=>api('/prescriptions'+path,body),record,workflow,onChanged:()=>open(record.id),isCurrent:()=>serial===captured&&active}).catch(e=>{if(serial===captured)prescriptionHost.append(el('p',e.message));});
 const notes=el('form');notes.className='clinical-card';notes.append(el('h3','Private clinical note'));const note=textField(notes,'note','Only visible to authorised clinicians');notes.append(button('Save internal note',()=>{if(notes.reportValidity())return action({action:'note',note:note.value});}));detailPane.append(notes);
 for(const form of detailPane.querySelectorAll('form.clinical-card')){form.onsubmit=e=>e.preventDefault();const fold=el('details');fold.className='clinical-action';fold.append(el('summary',form.querySelector('h3')?.textContent||'Action'));form.before(fold);fold.append(form);}
}
async function showPortal(){active=true;document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active',s===section));document.querySelectorAll('nav button[data-view]').forEach(n=>n.classList.toggle('active',n.dataset.view==='clinical'));const title=document.getElementById('title');if(title)title.textContent='Clinician portal';await queue();const requested=new URLSearchParams(location.search).get('record');if(requested&&content.querySelector('button')&&/^[a-f0-9-]{36}$/.test(requested))await open(requested);}
function linkMemberCard(){if(!section||typeof window.openPerson!=='function'||window.openPerson.clinicalLinked)return;const original=window.openPerson;const wrapped=async function(id){await original(id);const host=document.getElementById('personContent');if(host){document.getElementById('clinical-member-link')?.remove();const link=button('View clinical cases for this member',async()=>{document.getElementById('personModal')?.close();await showPortal();for(const row of content.querySelectorAll('[data-clinical-member]'))row.hidden=row.dataset.clinicalMember!==String(id);});link.id='clinical-member-link';host.append(link);}};wrapped.clinicalLinked=true;window.openPerson=wrapped;}
function install(){linkMemberCard();if(section){const b=document.querySelector('nav button[data-view="clinical"]'),nav=document.querySelector('aside nav');if(b?.closest('details'))nav.insertBefore(b,nav.children[1]);return true;}const nav=document.querySelector('aside nav'),main=document.querySelector('main');if(!nav||!main)return false;section=el('section');section.id='clinical';section.className='view';const head=el('div');head.className='toolbar';head.append(el('h2','Clinician portal'));notice=el('p','Sign in to HQ to load clinical cases.');notice.setAttribute('role','status');content=el('div');section.append(notice,content);main.append(section);const b=button('Clinician portal',showPortal);b.dataset.view='clinical';const activate=b.onclick;b.addEventListener('click',e=>{e.stopImmediatePropagation();activate(e);},true);nav.append(b);nav.addEventListener('click',e=>{if(e.target.closest('button[data-view]')?.dataset.view!=='clinical'){active=false;clear();}});document.getElementById('logoutBtn')?.addEventListener('click',()=>{knownRole=null;lastIdentity='';syncWorkspaceLinks(null);clear();});const css=el('link');css.rel='stylesheet';css.href='/clinical-assets/hq.css';document.head.append(css);return true;}
function syncWorkspaceLinks(role){const old=document.getElementById('clinical-workspace-links');if(!['owner','admin'].includes(role)){old?.remove();return;}const nav=document.querySelector('aside nav');if(!nav||old)return;const group=el('div');group.id='clinical-workspace-links';group.setAttribute('aria-label','Professional workspaces');for(const [label,path]of [['People & partners','/clinical-portal/partners'],['Dispensing oversight','/clinical-portal/dispensing'],['Internal test orders','/clinical-portal/commissioning']]){const a=el('a',label);a.href=path;group.append(a);}nav.append(group);}
async function identify(){if(identifying)return;identifying=true;const n=serial;try{const r=await fetch('https://api.shiftsometimber.co.uk/v1/hq/me',{credentials:'include',cache:'no-store'});if(!r.ok){syncWorkspaceLinks(null);return;}const data=await r.json();if(n!==serial)return;knownRole=data.user?.role;syncWorkspaceLinks(knownRole);document.body.classList.toggle('clinician-only',knownRole==='clinical');if(knownRole==='clinical'&&section){active=true;await showPortal();}}catch(e){if(notice)notice.textContent=e.message;}finally{identifying=false;}}
const observer=new MutationObserver(()=>{install();const identity=document.getElementById('hqUserChip')?.textContent||'';if(identity&&identity!==lastIdentity){lastIdentity=identity;identify();}if(knownRole==='clinical'&&section&&!section.classList.contains('active')){active=true;document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v===section));}if(section&&!section.classList.contains('active')&&active){active=false;clear();}});observer.observe(document.body,{childList:true,subtree:true,attributes:true,attributeFilter:['class']});install();identify();window.addEventListener('pagehide',clear);window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});
` } };

// partner-operations/notification-management.mjs
var BASE2 = "/v1/hq/clinical/notifications";
var ORIGIN3 = "https://hq.shiftsometimber.co.uk";
var reply = /* @__PURE__ */ __name((b, status = 200) => Response.json(b, { status, headers: { "Cache-Control": "no-store, private", "Access-Control-Allow-Origin": ORIGIN3, "Access-Control-Allow-Credentials": "true", "Vary": "Origin", "X-Content-Type-Options": "nosniff" } }), "reply");
function channelOutcome(row) {
  if (row.status === "superseded") return "superseded";
  if (row.delivery_status === "available_in_app") return "published_in_app";
  if (row.provider_id && row.delivery_status === "sent") return "provider_accepted";
  if (row.error_code || ["failed", "unknown", "delivery_unknown"].includes(row.delivery_status)) return "failed_or_unknown";
  if (row.draft_status === "draft") return "draft_awaiting_approval";
  if (row.draft_status === "cancelled") return "cancelled";
  if (row.draft_status === "scheduled") return "approved_scheduled";
  return row.channel === "whatsapp" ? "awaiting_template_opt_in_and_provider" : row.status;
}
__name(channelOutcome, "channelOutcome");
async function notificationManagementRoute(request, env, authenticate) {
  const url = new URL(request.url);
  if (url.pathname !== BASE2 && !url.pathname.startsWith(BASE2 + "/")) return null;
  try {
    if (request.headers.has("Origin") && request.headers.get("Origin") !== ORIGIN3) fail2(403, "origin_forbidden");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": ORIGIN3, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Cache-Control": "no-store" } });
    if (!["GET", "POST"].includes(request.method)) fail2(405, "method_not_allowed");
    if (request.method === "POST" && request.headers.get("Origin") !== ORIGIN3) fail2(403, "origin_required");
    if (env.NOTIFICATION_EVENTS_ENABLED !== "true") fail2(503, "notification_events_not_enabled");
    const a = await actorFor(request, env, authenticate);
    if (a.response) return a.response;
    if (a.role !== "owner") fail2(403, "owner_review_required");
    const q3 = /* @__PURE__ */ __name((s, ...args) => env.DB.prepare(s).bind(...args), "q"), all = /* @__PURE__ */ __name(async (s) => (await s.all()).results || [], "all");
    await audit(env, a, "notification_review", url.searchParams.get("id") ? text2(url.searchParams.get("id"), 200) : "events", "notification_review_accessed");
    if (request.method === "POST" && url.pathname === BASE2 + "/prepare") {
      const b = await readJson(request);
      if (Object.keys(b).some((k) => k !== "eventId")) fail2(422, "event_id_only");
      return reply(await prepareEventChannels(env, text2(b.eventId, 200), a, () => authCondition(a, (/* @__PURE__ */ new Date()).toISOString())));
    }
    if (request.method !== "GET" || url.pathname !== BASE2) fail2(404, "not_found");
    const id = url.searchParams.get("id");
    if (id) {
      text2(id, 200);
      const event = await q3("SELECT * FROM clinical_notification_events WHERE id=?", id).first();
      if (!event) fail2(404, "notification_event_not_found");
      const channels = await all(q3("SELECT c.*,d.status draft_status,d.hash,d.payload_json,r.status delivery_status,r.provider_id,r.error_code,r.at,r.read_at FROM clinical_notification_channels c LEFT JOIN hq_comms_drafts d ON d.id=c.draft_id LEFT JOIN hq_comms_recipients r ON r.draft_id=d.id AND r.user_id=? WHERE c.event_id=?", event.member_id, id));
      return reply({ event, channels: channels.map(({ payload_json, ...r }) => ({ ...r, outcome: channelOutcome(r), draft: payload_json ? JSON.parse(payload_json) : null })), whatsappText: event.title + ". " + event.body + " https://shiftsometimber.co.uk" + event.link, sentByThisService: false });
    }
    const events = await all(q3("SELECT e.id,e.order_number,e.kind,e.title,e.created_at,c.channel,c.status,c.draft_id FROM (SELECT * FROM clinical_notification_events ORDER BY created_at DESC,id DESC LIMIT 100) e JOIN clinical_notification_channels c ON c.event_id=e.id ORDER BY e.created_at DESC,e.id DESC,c.channel"));
    const grouped = /* @__PURE__ */ new Map();
    for (const row of events) {
      if (!grouped.has(row.id)) grouped.set(row.id, { id: row.id, orderNumber: row.order_number, kind: row.kind, title: row.title, at: row.created_at, channels: [] });
      grouped.get(row.id).channels.push({ channel: row.channel, status: row.status });
    }
    return reply({ events: [...grouped.values()], reviewOnly: true });
  } catch (e) {
    return reply({ error: e.status ? e.message : "notification_review_unavailable" }, e.status || 503);
  }
}
__name(notificationManagementRoute, "notificationManagementRoute");

// partner-operations/commissioning.mjs
var COMMISSIONING_BASE = "/v1/hq/clinical/commissioning";
var ORIGIN4 = "https://hq.shiftsometimber.co.uk";
var sql = /* @__PURE__ */ __name((env, s, ...a) => env.DB.prepare(s).bind(...a), "sql");
var rows6 = /* @__PURE__ */ __name(async (q3) => (await q3.all()).results || [], "rows");
var stamp = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "stamp");
var response = /* @__PURE__ */ __name((b, status = 200) => Response.json(b, { status, headers: { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff", "Access-Control-Allow-Origin": ORIGIN4, "Access-Control-Allow-Credentials": "true", "Vary": "Origin" } }), "response");
async function json4(request) {
  const reader = request.body?.getReader();
  if (!reader) fail2(400, "invalid_json");
  let n = 0, parts = [];
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    n += value.length;
    if (n > 2048) {
      await reader.cancel();
      fail2(413, "request_too_large");
    }
    parts.push(value);
  }
  const buf = new Uint8Array(n);
  let offset = 0;
  for (const part of parts) {
    buf.set(part, offset);
    offset += part.length;
  }
  try {
    const b = JSON.parse(new TextDecoder().decode(buf));
    if (!b || typeof b !== "object" || Array.isArray(b)) fail2(400, "invalid_json");
    return b;
  } catch (e) {
    if (e.status) throw e;
    fail2(400, "invalid_json");
  }
}
__name(json4, "json");
var guard = /* @__PURE__ */ __name((a) => ({ text: "EXISTS(SELECT 1 FROM hq_users u JOIN hq_sessions s ON s.hq_user_id=u.id WHERE u.id=? AND u.role=? AND u.status='active' AND u.mfa_enabled=1 AND s.token_hash=? AND s.revoked_at IS NULL AND julianday(s.expires_at)>julianday(?))", args: [a.id, a.role, a.hash, stamp()] }), "guard");
async function actor(request, env, authenticate) {
  const access = await authenticate(request, env);
  if (access.response) return access;
  const u = access.user;
  if (!u) fail2(401, "hq_sign_in_required");
  if (!["owner", "admin"].includes(u.role)) fail2(403, "internal_owner_access_required");
  if (u.mfaEnabled !== true) fail2(403, "hq_mfa_required");
  const raw = (request.headers.get("cookie") || "").match(/(?:^|;\s*)sst_hq_session=([^;]+)/)?.[1];
  if (!raw) fail2(401, "hq_session_required");
  let token2;
  try {
    token2 = decodeURIComponent(raw);
  } catch {
    fail2(401, "invalid_session");
  }
  const hash3 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token2))), (b) => b.toString(16).padStart(2, "0")).join("");
  const a = { id: String(u.id), role: u.role, hash: hash3 }, g = guard(a);
  if (!await sql(env, "SELECT 1 ok WHERE " + g.text, ...g.args).first()) fail2(403, "access_revoked");
  return a;
}
__name(actor, "actor");
function newCommissioningOrder(orderNumber, date) {
  if (!/^TEST-[A-F0-9]{12}$/.test(orderNumber)) fail2(422, "synthetic_order_number_required");
  return {
    synthetic: true,
    orderNumber,
    version: 0,
    member: { id: "SYNTHETIC-ALEX", name: "Alex Example", dateOfBirth: "1985-01-01" },
    status: "pending",
    stage: "assessment",
    documents: ["identity", "full_length", "weight", "previous_treatment"].map((kind) => ({ kind, status: kind === "identity" ? "test_placeholder" : "pending", revision: 1 })),
    app: { source: "Synthetic My Timber fixture", weightKg: 93.2, wellbeing: "Test check-in only" },
    stockAvailable: false,
    prescription: null,
    fulfilment: null,
    createdAt: date,
    updatedAt: date,
    actionNeeded: false
  };
}
__name(newCommissioningOrder, "newCommissioningOrder");
var NOTES = { query_photo: "Please replace your full-length photo using the secure order page.", query_info: "Please confirm your current treatment and the date of your last dose in your secure order page.", reject: "The synthetic assessment was not approved. See the explanation in your order.", pharmacy_query: "The dispensing team needs more information. Please check your secure order page.", pharmacy_reject: "The dispensing team could not fulfil this test order. Please check your secure order page." };
function commissioningAction(original, b, date, id) {
  if (original.synthetic !== true || !/^TEST-[A-F0-9]{12}$/.test(original.orderNumber)) fail2(403, "synthetic_records_only");
  if (!Number.isInteger(b.version) || b.version !== original.version) fail2(409, "order_changed");
  if (Object.keys(b).some((k) => !["version", "action", "document"].includes(k))) fail2(422, "synthetic_fields_only");
  const s = structuredClone(original), a = b.action;
  let notify = null;
  const at = /* @__PURE__ */ __name((states) => {
    if (!states.includes(s.status)) fail2(409, "invalid_order_transition");
  }, "at");
  if (a === "review") {
    at(["pending", "to_action"]);
    s.status = "to_action";
    s.stage = "clinical_review";
  } else if (a === "approve_picture" || a === "reject_picture") {
    at(["to_action"]);
    const d = s.documents.find((d2) => d2.kind === b.document && d2.kind !== "identity");
    if (!d) fail2(422, "medical_document_required");
    d.status = a === "approve_picture" ? "approved" : "rejected";
  } else if (a === "query_photo" || a === "query_info") {
    at(["to_action"]);
    s.status = "referred_back";
    s.actionNeeded = true;
    s.request = a;
    s.memberMessage = NOTES[a];
    if (a === "query_photo") s.documents.find((d) => d.kind === "full_length").status = "replacement_requested";
    notify = "information_requested";
  } else if (a === "member_respond") {
    if (s.fulfilment?.status === "query" && s.actionNeeded) {
      s.actionNeeded = false;
      s.memberMessage = "Your test response was received by the dispensing team.";
      notify = "response_received";
    } else {
      at(["referred_back"]);
      if (s.request === "query_photo") {
        const d = s.documents.find((d2) => d2.kind === "full_length");
        d.revision++;
        d.status = "pending";
      }
      s.status = "to_action";
      s.actionNeeded = false;
      s.memberMessage = "Your response was received and is back with the clinical team.";
      s.request = null;
      notify = "response_received";
    }
  } else if (a === "reject") {
    at(["to_action"]);
    s.status = "rejected";
    s.actionNeeded = false;
    s.memberMessage = NOTES.reject;
    notify = "assessment_rejected";
  } else if (a === "sign_off") {
    at(["to_action"]);
    if (s.documents.some((d) => d.kind !== "identity" && d.status !== "approved")) fail2(422, "medical_documents_need_approval");
    s.status = "signed_off";
    s.stage = "prescription_handover";
    s.prescription = { id: "TEST-RX-" + id, synthetic: true, legallyIssued: false, medicine: "TEST MEDICINE \u2014 NOT FOR SUPPLY", approvedAt: date };
    s.fulfilment = { orderNumber: s.orderNumber, partnerId: "SYNTHETIC-PHARMACY", memberId: "SYNTHETIC-ALEX", prescriptionId: s.prescription.id, area: "weight_management", medicine: "TEST MEDICINE \u2014 NOT FOR SUPPLY", status: "received", version: 0 };
    s.memberMessage = "Your test assessment is signed off and has moved to the dispensing queue. No real prescription has been issued.";
    notify = "assessment_approved";
  } else if (a === "stock_on" || a === "stock_off") {
    if (!s.fulfilment || ["dispatched", "rejected"].includes(s.fulfilment.status)) fail2(409, "active_test_fulfilment_required");
    s.stockAvailable = a === "stock_on";
  } else if (["accept", "prepare", "dispatch", "pharmacy_query", "pharmacy_reject"].includes(a)) {
    if (!s.fulfilment) fail2(409, "signed_off_test_order_required");
    const expiry = "2099-01-01T00:00:00.000Z", staff2 = {
      status: "active",
      orgId: "SYNTHETIC-PHARMACY",
      hqUserId: "SYNTHETIC-DISPENSER",
      credentialVersion: 0,
      checks: CHECKS.map((kind) => ({ kind, outcome: "verified", credentialVersion: 0, expiresAt: expiry })),
      grants: [{ credentialVersion: 0, area: "weight_management", actions: ["supply_decision", "prepare", "dispatch", "query"], medicines: [], startsAt: "2020-01-01T00:00:00.000Z", expiresAt: expiry }]
    };
    const action = a === "pharmacy_query" ? "query" : a === "pharmacy_reject" ? "reject" : a;
    const result = fulfilmentAction(s.fulfilment, { version: s.fulfilment.version, action, message: NOTES[a], carrier: "royal_mail", trackingNumber: "TEST000000GB" }, staff2, { id: staff2.hqUserId, mfa: true }, date, id, { prescriptionCurrent: s.prescription?.synthetic === true, stockAvailable: s.stockAvailable });
    s.fulfilment = result.state;
    if (s.fulfilment.tracking) {
      delete s.fulfilment.tracking.url;
      s.fulfilment.tracking.synthetic = true;
    }
    s.stage = "dispensing";
    if (a === "dispatch") {
      s.status = "dispatched";
      s.stage = "tracking";
      s.actionNeeded = false;
      s.memberMessage = "Test dispatch recorded. No parcel was sent.";
      notify = "order_dispatched";
    } else if (a === "pharmacy_query" || a === "pharmacy_reject") {
      s.memberMessage = NOTES[a];
      s.actionNeeded = a === "pharmacy_query";
      if (a === "pharmacy_reject") s.status = "rejected";
      notify = a === "pharmacy_query" ? "dispensing_query" : "dispensing_rejected";
    } else if (a === "accept") {
      s.actionNeeded = false;
      s.memberMessage = "The dispensing team accepted this synthetic handover.";
      notify = "dispensing_accepted";
    } else if (a === "prepare") {
      s.memberMessage = "Test preparation has started. No medicine is being supplied.";
      notify = "dispensing_started";
    }
  } else fail2(422, "unknown_commissioning_action");
  s.version++;
  s.updatedAt = date;
  return { state: s, event: { id, action: a, at: date, details: { status: s.status, stage: s.stage, document: b.document || null, fulfilment: s.fulfilment?.status || null } }, notify };
}
__name(commissioningAction, "commissioningAction");
function commissioningViews(s, events = []) {
  const timeline = events.map((e) => ({ action: e.action, at: e.created_at }));
  return {
    member: { name: s.member.name, orderNumber: s.orderNumber, status: s.status, stage: s.stage, actionNeeded: s.actionNeeded, message: s.memberMessage || "Your assessment is awaiting review.", documents: s.documents, prescription: s.prescription, tracking: s.fulfilment?.tracking || null, recentActivity: timeline },
    clinician: { orderNumber: s.orderNumber, status: s.status, member: s.member, documents: s.documents, myTimber: s.app, prescriptionHistory: s.prescription ? [s.prescription] : [], recentActivity: timeline },
    dispensing: { orderNumber: s.orderNumber, prescription: s.prescription, fulfilment: s.fulfilment, stockAvailable: s.stockAvailable, recentActivity: timeline }
  };
}
__name(commissioningViews, "commissioningViews");
async function auditRead(env, a, orderNumber, action) {
  const g = guard(a), id = crypto.randomUUID(), date = stamp();
  const r = await sql(env, "INSERT INTO partner_commissioning_events SELECT ?,?,-1-COALESCE((SELECT -MIN(version) FROM partner_commissioning_events WHERE order_number=? AND version<0),0),?,?,?,? WHERE " + g.text, id, orderNumber, orderNumber, a.id, action, "{}", date, ...g.args).run();
  if (r.meta?.changes !== 1) fail2(403, "access_revoked");
}
__name(auditRead, "auditRead");
async function view(env, a, orderNumber) {
  const row = await sql(env, "SELECT state_json FROM partner_commissioning_orders WHERE order_number=?", orderNumber).first();
  if (!row) fail2(404, "test_order_not_found");
  await auditRead(env, a, orderNumber, "order_viewed");
  const s = JSON.parse(row.state_json), events = await rows6(sql(env, "SELECT id,actor_id,action,details_json,created_at FROM partner_commissioning_events WHERE order_number=? AND version>=0 ORDER BY version DESC", orderNumber));
  const notifications = await rows6(sql(env, "SELECT channel,template,body,status,created_at FROM partner_commissioning_notifications WHERE order_number=? ORDER BY created_at DESC,id", orderNumber));
  return { order: s, views: commissioningViews(s, events), events, notifications };
}
__name(view, "view");
async function commissioningRoute(request, env, authenticate) {
  const path = new URL(request.url).pathname;
  if (path !== COMMISSIONING_BASE && !path.startsWith(COMMISSIONING_BASE + "/")) return null;
  try {
    const origin3 = request.headers.get("Origin");
    if (origin3 && origin3 !== ORIGIN4) fail2(403, "origin_forbidden");
    if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": ORIGIN4, "Access-Control-Allow-Credentials": "true", "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type", "Cache-Control": "no-store", "Vary": "Origin" } });
    if (!["GET", "POST"].includes(request.method)) fail2(405, "method_not_allowed");
    if (request.method === "POST" && origin3 !== ORIGIN4) fail2(403, "origin_required");
    const a = await actor(request, env, authenticate);
    if (a.response) return a.response;
    const p = path.slice(COMMISSIONING_BASE.length).split("/").filter(Boolean);
    if (!p.length && request.method === "GET") {
      const g = guard(a), orders = await rows6(sql(env, "SELECT order_number,version,state_json,updated_at FROM partner_commissioning_orders WHERE " + g.text + " ORDER BY updated_at DESC LIMIT 100", ...g.args));
      for (const o of orders) await auditRead(env, a, o.order_number, "queue_viewed");
      return response({ internalOnly: true, syntheticOnly: true, messagesWithheld: true, orders: orders.map((o) => ({ orderNumber: o.order_number, version: o.version, status: JSON.parse(o.state_json).status, updatedAt: o.updated_at })) });
    }
    if (!p.length && request.method === "POST") {
      const b = await json4(request);
      if (Object.keys(b).length) fail2(422, "synthetic_fields_only");
      const date = stamp(), number = "TEST-" + crypto.randomUUID().replaceAll("-", "").slice(0, 12).toUpperCase(), s = newCommissioningOrder(number, date), g = guard(a), event = crypto.randomUUID();
      const r = await env.DB.batch([
        sql(env, "INSERT INTO partner_commissioning_orders SELECT ?,0,?,?,? WHERE " + g.text, number, JSON.stringify(s), a.id, date, ...g.args),
        sql(env, "INSERT INTO partner_commissioning_events SELECT ?,?,0,?,?,?,? WHERE changes()=1", event, number, a.id, "order_created", '{"synthetic":true}', date)
      ]);
      if (r[0].meta?.changes !== 1) fail2(403, "access_revoked");
      return response(await view(env, a, number), 201);
    }
    if (!/^TEST-[A-F0-9]{12}$/.test(p[0] || "")) fail2(404, "test_order_not_found");
    if (p.length === 1 && request.method === "GET") return response(await view(env, a, p[0]));
    if (p.length === 2 && p[1] === "action" && request.method === "POST") {
      const b = await json4(request), row = await sql(env, "SELECT state_json FROM partner_commissioning_orders WHERE order_number=?", p[0]).first();
      if (!row) fail2(404, "test_order_not_found");
      const result = commissioningAction(JSON.parse(row.state_json), b, stamp(), crypto.randomUUID()), s = result.state, e = result.event, g = guard(a);
      const statements = [
        sql(env, "UPDATE partner_commissioning_orders SET state_json=?,version=?,updated_at=? WHERE order_number=? AND version=? AND " + g.text, JSON.stringify(s), s.version, s.updatedAt, p[0], b.version, ...g.args),
        sql(env, "INSERT INTO partner_commissioning_events SELECT ?,?,?,?,?,?,? WHERE changes()=1", e.id, s.orderNumber, s.version, a.id, e.action, JSON.stringify(e.details), e.at)
      ];
      if (result.notify) for (const channel of ["email", "whatsapp"]) statements.push(sql(env, "INSERT INTO partner_commissioning_notifications SELECT ?,?,?,?,?,?,'withheld',? WHERE EXISTS(SELECT 1 FROM partner_commissioning_events WHERE id=?)", crypto.randomUUID(), e.id, s.orderNumber, channel, result.notify, "TEST ONLY \xB7 " + s.orderNumber + " \xB7 " + s.memberMessage, e.at, e.id));
      const out = await env.DB.batch(statements);
      if (out[0].meta?.changes !== 1) fail2(409, "order_changed_or_access_revoked");
      return response(await view(env, a, s.orderNumber));
    }
    fail2(404, "not_found");
  } catch (e) {
    return response({ error: e.status ? e.message : "internal_commissioning_unavailable" }, e.status || 503);
  }
}
__name(commissioningRoute, "commissioningRoute");

// partner-operations/assets.mjs
var pages = { "/clinical-portal/partners": { "type": "text/html; charset=utf-8", "body": '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>People & partners \xB7 SHIFT HQ</title><link rel="stylesheet" href="/clinical-assets/partners/style.css"></head><body data-mode="hq" data-demo="false"><header><div><p class="eyebrow">SHIFT <span>SOME</span> TIMBER / HQ</p><h1>People & partners</h1></div><nav aria-label="Workspace"><a href="/clinical-portal/partners">People & partners</a><a href="/clinical-portal">Clinician portal</a><a href="/clinical-portal/dispensing">Dispensing</a><a href="/clinical-portal/my-profile">My profile</a><a href="/clinical-portal/notifications">Member updates</a><a href="/clinical-portal/commissioning">Internal testing</a><a href="/clinical-portal/prescription-finance">Payment adjustments</a></nav></header><main><p id="notice" role="status" aria-live="polite">Sign in with your approved HQ account. MFA is required. Real clinical services remain separately controlled.</p><div class="toolbar"><button id="refresh">Refresh</button><a href="/">HQ sign-in & MFA</a></div><div id="workspace" class="workspace"><aside id="left"><h2>People & partners</h2><div id="selectors"></div></aside><section id="detail" aria-label="Selected record"><h2>Select a record</h2><p>Details, checks and permitted actions appear here.</p></section></div></main><dialog id="viewer"><button id="close-viewer">Close image</button><img alt="Identity evidence preview"></dialog><footer>One order number. One joined-up history. Access follows your approved role.</footer><script type="module" src="/clinical-assets/partners/client.mjs"><\/script></body></html>', "demo": false }, "/clinical-portal/partners/demo": { "type": "text/html; charset=utf-8", "body": '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>People & partners \xB7 SHIFT HQ</title><link rel="stylesheet" href="/clinical-assets/partners/style.css"></head><body data-mode="hq" data-demo="true"><header><div><p class="eyebrow">SHIFT <span>SOME</span> TIMBER / HQ</p><h1>People & partners</h1></div><nav aria-label="Workspace"><a href="/clinical-portal/partners/demo">People & partners</a><a href="/clinical-portal/demo">Clinician portal</a><a href="/clinical-portal/dispensing/demo">Dispensing</a><a href="/clinical-portal/my-profile">My profile</a></nav></header><main><p id="notice" role="status" aria-live="polite">FICTIONAL DEMO \xB7 Changes reset on refresh. No files, invitations, prescriptions or messages leave this demonstration.</p><div class="toolbar"><button id="refresh">Refresh</button><button id="reset">Reset demo</button></div><div id="workspace" class="workspace"><aside id="left"><h2>People & partners</h2><div id="selectors"></div></aside><section id="detail" aria-label="Selected record"><h2>Select a record</h2><p>Details, checks and permitted actions appear here.</p></section></div></main><dialog id="viewer"><button id="close-viewer">Close image</button><img alt="Identity evidence preview"></dialog><footer>One order number. One joined-up history. Access follows your approved role.</footer><script type="module" src="/clinical-assets/partners/demo-client.mjs"><\/script></body></html>', "demo": true }, "/clinical-portal/partners/application": { "type": "text/html; charset=utf-8", "body": '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Partner application \xB7 SHIFT HQ</title><link rel="stylesheet" href="/clinical-assets/partners/style.css"></head><body data-mode="application" data-demo="false"><header><div><p class="eyebrow">SHIFT <span>SOME</span> TIMBER / HQ</p><h1>Partner application</h1></div><nav aria-label="Workspace"><a href="/clinical-portal/partners">People & partners</a><a href="/clinical-portal">Clinician portal</a><a href="/clinical-portal/dispensing">Dispensing</a><a href="/clinical-portal/my-profile">My profile</a></nav></header><main><p id="notice" role="status" aria-live="polite">Sign in with your approved HQ account. MFA is required. Real clinical services remain separately controlled.</p><div class="toolbar"><button id="refresh">Refresh</button><a href="/">HQ sign-in & MFA</a></div><div id="workspace" class="workspace"><aside id="left"><h2>Partner application</h2><div id="selectors"></div></aside><section id="detail" aria-label="Selected record"><h2>Select a record</h2><p>Details, checks and permitted actions appear here.</p></section></div></main><dialog id="viewer"><button id="close-viewer">Close image</button><img alt="Identity evidence preview"></dialog><footer>One order number. One joined-up history. Access follows your approved role.</footer><script type="module" src="/clinical-assets/partners/client.mjs"><\/script></body></html>', "demo": false }, "/clinical-portal/partners/activation": { "type": "text/html; charset=utf-8", "body": '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Create your password \xB7 SHIFT HQ</title><link rel="stylesheet" href="/clinical-assets/partners/style.css"></head><body data-mode="activation" data-demo="false"><header><div><p class="eyebrow">SHIFT <span>SOME</span> TIMBER / HQ</p><h1>Create your password</h1></div><nav aria-label="Workspace"><a href="/clinical-portal/partners">People & partners</a><a href="/clinical-portal">Clinician portal</a><a href="/clinical-portal/dispensing">Dispensing</a><a href="/clinical-portal/my-profile">My profile</a></nav></header><main><p id="notice" role="status" aria-live="polite">Sign in with your approved HQ account. MFA is required. Real clinical services remain separately controlled.</p><div class="toolbar"><button id="refresh">Refresh</button><a href="/">HQ sign-in & MFA</a></div><div id="workspace" class="workspace"><aside id="left"><h2>Create your password</h2><div id="selectors"></div></aside><section id="detail" aria-label="Selected record"><h2>Select a record</h2><p>Details, checks and permitted actions appear here.</p></section></div></main><dialog id="viewer"><button id="close-viewer">Close image</button><img alt="Identity evidence preview"></dialog><footer>One order number. One joined-up history. Access follows your approved role.</footer><script type="module" src="/clinical-assets/partners/client.mjs"><\/script></body></html>', "demo": false }, "/clinical-portal/partners/sign-in": { "type": "text/html; charset=utf-8", "body": '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Professional sign-in \xB7 SHIFT HQ</title><link rel="stylesheet" href="/clinical-assets/partners/style.css"></head><body data-mode="login" data-demo="false"><header><div><p class="eyebrow">SHIFT <span>SOME</span> TIMBER / HQ</p><h1>Professional sign-in</h1></div><nav aria-label="Workspace"><a href="/clinical-portal/partners">People & partners</a><a href="/clinical-portal">Clinician portal</a><a href="/clinical-portal/dispensing">Dispensing</a><a href="/clinical-portal/my-profile">My profile</a></nav></header><main><p id="notice" role="status" aria-live="polite">Sign in with your approved HQ account. MFA is required. Real clinical services remain separately controlled.</p><div class="toolbar"><button id="refresh">Refresh</button><a href="/">HQ sign-in & MFA</a></div><div id="workspace" class="workspace"><aside id="left"><h2>Professional sign-in</h2><div id="selectors"></div></aside><section id="detail" aria-label="Selected record"><h2>Select a record</h2><p>Details, checks and permitted actions appear here.</p></section></div></main><dialog id="viewer"><button id="close-viewer">Close image</button><img alt="Identity evidence preview"></dialog><footer>One order number. One joined-up history. Access follows your approved role.</footer><script type="module" src="/clinical-assets/partners/client.mjs"><\/script></body></html>', "demo": false }, "/clinical-portal/dispensing": { "type": "text/html; charset=utf-8", "body": '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Dispensing portal \xB7 SHIFT HQ</title><link rel="stylesheet" href="/clinical-assets/partners/style.css"></head><body data-mode="dispensing" data-demo="false"><header><div><p class="eyebrow">SHIFT <span>SOME</span> TIMBER / HQ</p><h1>Dispensing portal</h1></div><nav aria-label="Workspace"><a href="/clinical-portal/partners">People & partners</a><a href="/clinical-portal">Clinician portal</a><a href="/clinical-portal/dispensing">Dispensing</a><a href="/clinical-portal/my-profile">My profile</a></nav></header><main><p id="notice" role="status" aria-live="polite">Sign in with your approved HQ account. MFA is required. Real clinical services remain separately controlled.</p><div class="toolbar"><button id="refresh">Refresh</button><a href="/">HQ sign-in & MFA</a></div><div id="workspace" class="workspace"><aside id="left"><h2>Dispensing portal</h2><div id="selectors"></div></aside><section id="detail" aria-label="Selected record"><h2>Select a record</h2><p>Details, checks and permitted actions appear here.</p></section></div></main><dialog id="viewer"><button id="close-viewer">Close image</button><img alt="Identity evidence preview"></dialog><footer>One order number. One joined-up history. Access follows your approved role.</footer><script type="module" src="/clinical-assets/partners/client.mjs"><\/script></body></html>', "demo": false }, "/clinical-portal/dispensing/demo": { "type": "text/html; charset=utf-8", "body": '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Dispensing portal \xB7 SHIFT HQ</title><link rel="stylesheet" href="/clinical-assets/partners/style.css"></head><body data-mode="dispensing" data-demo="true"><header><div><p class="eyebrow">SHIFT <span>SOME</span> TIMBER / HQ</p><h1>Dispensing portal</h1></div><nav aria-label="Workspace"><a href="/clinical-portal/partners/demo">People & partners</a><a href="/clinical-portal/demo">Clinician portal</a><a href="/clinical-portal/dispensing/demo">Dispensing</a><a href="/clinical-portal/my-profile">My profile</a></nav></header><main><p id="notice" role="status" aria-live="polite">FICTIONAL DEMO \xB7 Changes reset on refresh. No files, invitations, prescriptions or messages leave this demonstration.</p><div class="toolbar"><button id="refresh">Refresh</button><button id="reset">Reset demo</button></div><div id="workspace" class="workspace"><aside id="left"><h2>Dispensing portal</h2><div id="selectors"></div></aside><section id="detail" aria-label="Selected record"><h2>Select a record</h2><p>Details, checks and permitted actions appear here.</p></section></div></main><dialog id="viewer"><button id="close-viewer">Close image</button><img alt="Identity evidence preview"></dialog><footer>One order number. One joined-up history. Access follows your approved role.</footer><script type="module" src="/clinical-assets/partners/demo-client.mjs"><\/script></body></html>', "demo": true }, "/clinical-portal/my-profile": { "type": "text/html; charset=utf-8", "body": '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>My professional profile \xB7 SHIFT HQ</title><link rel="stylesheet" href="/clinical-assets/partners/style.css"></head><body data-mode="profile" data-demo="false"><header><div><p class="eyebrow">SHIFT <span>SOME</span> TIMBER / HQ</p><h1>My professional profile</h1></div><nav aria-label="Workspace"><a href="/clinical-portal/partners">People & partners</a><a href="/clinical-portal">Clinician portal</a><a href="/clinical-portal/dispensing">Dispensing</a><a href="/clinical-portal/my-profile">My profile</a></nav></header><main><p id="notice" role="status" aria-live="polite">Sign in with your approved HQ account. MFA is required. Real clinical services remain separately controlled.</p><div class="toolbar"><button id="refresh">Refresh</button><a href="/">HQ sign-in & MFA</a></div><div id="workspace" class="workspace"><aside id="left"><h2>My professional profile</h2><div id="selectors"></div></aside><section id="detail" aria-label="Selected record"><h2>Select a record</h2><p>Details, checks and permitted actions appear here.</p></section></div></main><dialog id="viewer"><button id="close-viewer">Close image</button><img alt="Identity evidence preview"></dialog><footer>One order number. One joined-up history. Access follows your approved role.</footer><script type="module" src="/clinical-assets/partners/client.mjs"><\/script></body></html>', "demo": false }, "/clinical-portal/prescription-finance": { "type": "text/html; charset=utf-8", "body": '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Payment adjustment review \xB7 SHIFT HQ</title><link rel="stylesheet" href="/clinical-assets/partners/style.css"></head><body data-mode="finance" data-demo="false"><header><div><p class="eyebrow">SHIFT <span>SOME</span> TIMBER / HQ</p><h1>Payment adjustment review</h1></div><nav aria-label="Workspace"><a href="/clinical-portal/partners">People & partners</a><a href="/clinical-portal">Clinician portal</a><a href="/clinical-portal/dispensing">Dispensing</a><a href="/clinical-portal/my-profile">My profile</a></nav></header><main><p id="notice" role="status" aria-live="polite">Sign in with your approved HQ account. MFA is required. Real clinical services remain separately controlled.</p><div class="toolbar"><button id="refresh">Refresh</button><a href="/">HQ sign-in & MFA</a></div><div id="workspace" class="workspace"><aside id="left"><h2>Payment adjustment review</h2><div id="selectors"></div></aside><section id="detail" aria-label="Selected record"><h2>Select a record</h2><p>Details, checks and permitted actions appear here.</p></section></div></main><dialog id="viewer"><button id="close-viewer">Close image</button><img alt="Identity evidence preview"></dialog><footer>One order number. One joined-up history. Access follows your approved role.</footer><script type="module" src="/clinical-assets/partners/finance-client.mjs"><\/script></body></html>', "demo": false }, "/clinical-portal/notifications": { "type": "text/html; charset=utf-8", "body": '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Member updates \xB7 SHIFT HQ</title><link rel="stylesheet" href="/clinical-assets/partners/style.css"></head><body data-mode="notifications" data-demo="false"><header><div><p class="eyebrow">SHIFT <span>SOME</span> TIMBER / HQ</p><h1>Member updates</h1></div><nav aria-label="Workspace"><a href="/clinical-portal/partners">People & partners</a><a href="/clinical-portal">Clinician portal</a><a href="/clinical-portal/dispensing">Dispensing</a><a href="/clinical-portal/my-profile">My profile</a><a href="/clinical-portal/notifications">Member updates</a><a href="/clinical-portal/commissioning">Internal testing</a><a href="/clinical-portal/prescription-finance">Payment adjustments</a></nav></header><main><p id="notice" role="status" aria-live="polite">Sign in with your approved HQ account. MFA is required. Real clinical services remain separately controlled.</p><div class="toolbar"><button id="refresh">Refresh</button><a href="/">HQ sign-in & MFA</a></div><div id="workspace" class="workspace"><aside id="left"><h2>Member updates</h2><div id="selectors"></div></aside><section id="detail" aria-label="Selected record"><h2>Select a record</h2><p>Details, checks and permitted actions appear here.</p></section></div></main><dialog id="viewer"><button id="close-viewer">Close image</button><img alt="Identity evidence preview"></dialog><footer>One order number. One joined-up history. Access follows your approved role.</footer><script type="module" src="/clinical-assets/partners/notifications-client.mjs"><\/script></body></html>', "demo": false }, "/clinical-portal/commissioning": { "type": "text/html; charset=utf-8", "body": '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Internal commissioning \xB7 SHIFT HQ</title><link rel="stylesheet" href="/clinical-assets/partners/style.css"></head><body data-mode="commissioning"><header><div><p class="eyebrow">SHIFT <span>SOME</span> TIMBER / HQ</p><h1>Internal commissioning</h1></div><nav aria-label="Workspace"><a href="/clinical-portal/partners">People & partners</a><a href="/clinical-portal">Clinician portal</a><a href="/clinical-portal/dispensing">Dispensing</a><a href="/">HQ sign-in</a></nav></header><main><p id="notice" role="status" aria-live="polite">Private owner workspace \xB7 synthetic records only. Changes are saved on the server. No real prescriptions, parcels or messages.</p><div class="toolbar"><button id="refresh">Refresh</button><button id="create" disabled>Create test order</button></div><div class="workspace"><aside><h2>Test orders</h2><div id="orders"></div><p>One order number across every view.</p></aside><section id="detail" aria-label="Selected test order"><h2>Opening private workspace</h2><p>Existing HQ sign-in and MFA are required.</p></section></div></main><footer>Internal acceptance only. View switching does not confer a clinical or pharmacy role. Identity checks, prescriptions, stock and tracking here are synthetic fixtures.</footer><script type="module" src="/clinical-assets/partners/commissioning-client.mjs"><\/script></body></html>', "demo": false } };
var assets2 = { "/clinical-assets/partners/notifications-client.mjs": { "type": "text/javascript; charset=utf-8", "body": "const API='https://api.shiftsometimber.co.uk/v1/hq/clinical/notifications';\nconst $=id=>document.getElementById(id),el=(t,s)=>{const n=document.createElement(t);if(s!==undefined)n.textContent=s;return n;};\nconst pretty=s=>String(s||'').replaceAll('_',' ');let serial=0,busy=false;\nasync function api(path='',data){const r=await fetch(API+path,{method:data===undefined?'GET':'POST',credentials:'include',cache:'no-store',headers:data?{'Content-Type':'application/json'}:{},body:data?JSON.stringify(data):undefined});if([401,403].includes(r.status)){$('selectors').replaceChildren();$('detail').replaceChildren();}const b=await r.json();if(!r.ok)throw Error(pretty(b.error||'Service unavailable'));return b;}\nfunction button(label,fn){const n=el('button',label);n.type='button';n.onclick=async()=>{if(busy)return;busy=true;n.disabled=true;try{await fn();}catch(e){$('notice').textContent=e.message;}finally{busy=false;if(n.isConnected)n.disabled=false;}};return n;}\nasync function open(id){const v=++serial,d=await api('?id='+encodeURIComponent(id));if(v!==serial)return;const host=$('detail');host.replaceChildren(el('h2',d.event.title),el('p',(d.event.order_number||'Assessment record')+' \xB7 '+new Date(d.event.created_at).toLocaleString('en-GB')),el('p','One source event; three independently tracked channels. The delivery connector awaits the separate central Communications release. No approval or sending occurs on this page.'));\n host.append(button('Prepare email & app drafts for review',async()=>{await api('/prepare',{eventId:id});await open(id);$('notice').textContent='Drafts prepared in the existing Communications system. Not approved, scheduled, sent or published.';}));\n for(const c of d.channels){const card=el('div');card.className='card';card.append(el('h3',pretty(c.channel)),el('p',pretty(c.outcome)));if(c.draft){card.append(el('p','Draft '+c.draft_id+' \xB7 revision hash '+c.hash),el('p','From: '+c.draft.from+' \xB7 Reply to: '+c.draft.replyTo),el('p','To: '+c.draft.recipients.map(r=>r.email).join(', ')),el('p','CC: '+(c.draft.cc?.join(', ')||'None')+' \xB7 BCC: '+(c.draft.bcc?.join(', ')||'None')),el('p','Attachments: '+(c.draft.attachment?.filename||'None')),el('h3',c.draft.subject));const body=el('pre',c.draft.body);body.className='message-preview';card.append(body);}if(c.provider_id)card.append(el('p','Provider reference: '+c.provider_id+' (not proof of inbox delivery)'));if(c.read_at)card.append(el('p','Read in app: '+new Date(c.read_at).toLocaleString('en-GB')));if(c.channel==='whatsapp'){card.append(el('p','Requires a configured provider, approved template, verified number and channel opt-in. No WhatsApp has been sent.'),el('pre',d.whatsappText));}host.append(card);}\n host.append(el('p','App publication and device push are separate. Push depends on the member granting permission and registering a device. Full clinical details remain behind secure My Shift sign-in.'));\n}\nasync function refresh(){const v=++serial,d=await api();if(v!==serial)return;const list=$('selectors');list.replaceChildren();for(const event of d.events){const b=button(event.orderNumber||'Assessment update',()=>open(event.id));b.className='record';b.append(el('span',event.title),el('small',new Date(event.at).toLocaleString('en-GB')));list.append(b);}if(!d.events.length)list.append(el('p','No recorded care events yet.'));$('detail').replaceChildren(el('h2','Member updates'),el('p','Select an event to inspect its email, WhatsApp and app records. Internal notes and audit views do not create member alerts.'));$('notice').textContent='Review-only workspace. The central delivery connector awaits release. Nothing is sent or published here. Exact drafts require Communications review.';}\n$('refresh').onclick=()=>refresh().catch(e=>$('notice').textContent=e.message);$('close-viewer').onclick=()=>$('viewer').close();window.addEventListener('pagehide',()=>{$('selectors').replaceChildren();$('detail').replaceChildren();});refresh().catch(e=>$('notice').textContent=e.message);\n" }, "/clinical-assets/partners/commissioning-client.mjs": { "type": "text/javascript; charset=utf-8", "body": "const BASE='https://api.shiftsometimber.co.uk/v1/hq/clinical/commissioning';\nconst $=id=>document.getElementById(id),el=(tag,text,cls)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};\nlet selected=null,record=null,tab='member',busy=false;\nconst labels={pending:'Pending',to_action:'To action',referred_back:'Referred back',signed_off:'Signed off',rejected:'Rejected',dispatched:'Test dispatched',full_length:'Full-length photo',weight:'Weight photo',previous_treatment:'Previous treatment',identity:'Identity fixture'};\nconst label=v=>labels[v]||v.replaceAll('_',' ');\nfunction button(text,fn){const b=el('button',text);b.type='button';b.disabled=busy;b.addEventListener('click',fn);return b;}\nfunction notice(text){$('notice').textContent=text;}\nasync function api(path='',body){const r=await fetch(BASE+path,{credentials:'include',cache:'no-store',...(body!==undefined?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});let b;try{b=await r.json();}catch{throw Error('The service did not return a valid response. No success has been assumed.');}if(!r.ok){if([401,403].includes(r.status)){record=null;selected=null;$('orders').replaceChildren();$('detail').replaceChildren(el('h2','HQ sign-in & MFA required'),el('p','Complete your own MFA enrolment in HQ, then refresh this workspace. No access controls have been bypassed.'));$('create').disabled=true;}throw Error(label(b.error||'service_unavailable'));}return b;}\nasync function task(fn){if(busy)return;busy=true;$('refresh').disabled=true;$('create').disabled=true;for(const b of document.querySelectorAll('#detail button'))b.disabled=true;try{await fn();notice('Saved on the server \xB7 synthetic test only \xB7 messages withheld.');}catch(e){notice(e.message);}finally{busy=false;$('refresh').disabled=false;for(const b of document.querySelectorAll('#orders button'))b.disabled=false;if(record){$('create').disabled=false;render();}}}\nasync function loadOrders(){const b=await api();$('orders').replaceChildren();$('create').disabled=false;for(const o of b.orders){const n=button(o.orderNumber+' \xB7 '+label(o.status),()=>task(()=>open(o.orderNumber)));n.className='record';n.setAttribute('aria-pressed',String(selected===o.orderNumber));$('orders').append(n);}if(!b.orders.length)$('orders').append(el('p','No test orders yet. Create one to begin.'));return b;}\nasync function open(number){const b=await api('/'+number);selected=number;record=b;await loadOrders();render();}\nasync function action(action,document){await task(async()=>{const b=await api('/'+selected+'/action',{version:record.order.version,action,...document?{document}:{}});record=b;await loadOrders();});}\nfunction list(parent,title,items){const card=el('section',undefined,'card');card.append(el('h3',title));const ul=el('ul');for(const text of items)ul.append(el('li',text));card.append(ul);parent.append(card);}\nfunction render(){if(!record)return;const root=$('detail'),s=record.order;root.replaceChildren();root.append(el('p','INTERNAL TEST \xB7 '+s.orderNumber,'eyebrow'),el('h2','Alex Example \xB7 '+label(s.status)),el('p','Saved revision '+s.version+' \xB7 '+new Date(s.updatedAt).toLocaleString('en-GB')));\n const tabs=el('div',undefined,'actions');tabs.setAttribute('role','group');tabs.setAttribute('aria-label','Test perspective');for(const [key,title]of [['member','My Shift'],['clinician','Clinician'],['dispensing','Dispensing'],['communications','Notifications'],['audit','Audit history']]){const b=button(title,()=>{tab=key;render();});b.setAttribute('aria-pressed',String(tab===key));tabs.append(b);}root.append(tabs);\n if(tab==='member'){\n  if(s.actionNeeded){const a=el('section',undefined,'attention');a.append(el('h3','Action needed'),el('p',record.views.member.message),button('Submit synthetic response',()=>action('member_respond')));root.append(a);}else root.append(el('p',record.views.member.message));\n  list(root,'Recent activity',record.views.member.recentActivity.slice(0,8).map(e=>label(e.action)+' \xB7 '+new Date(e.at).toLocaleString('en-GB')));\n  list(root,'Documents',s.documents.map(d=>label(d.kind)+' \xB7 '+label(d.status)+' \xB7 revision '+d.revision));\n  const app=el('details');app.append(el('summary','My Timber updates'),el('p',s.app.source+' \xB7 weight '+s.app.weightKg+' kg \xB7 '+s.app.wellbeing));root.append(app);\n  list(root,'Prescriptions & tracking',s.prescription?['Synthetic reference: '+s.prescription.id,'Not a legally issued prescription',s.fulfilment?.tracking?'Test tracking: '+s.fulfilment.tracking.number+' \u2014 no parcel sent':'Not dispatched']:['No prescription history for this test order.']);\n }else if(tab==='clinician'){\n  root.append(el('p','Clinical perspective \u2014 owner-led synthetic acceptance, not a prescriber session. No member email, telephone or delivery address is exposed.','muted'));\n  list(root,'Member card',['Alex Example','Date of birth: '+s.member.dateOfBirth,'Current order: '+s.orderNumber]);\n  if(s.status==='pending')root.append(button('Start review',()=>action('review')));\n  for(const d of s.documents){const card=el('section',undefined,'card');card.append(el('h3',label(d.kind)),el('p',label(d.status)+' \xB7 revision '+d.revision),el('p','Synthetic document placeholder. No real image has been uploaded.'));\n   if(d.kind==='identity')card.append(el('p','No AI identity decision is made by this fixture.'));\n   else if(s.status==='to_action'){const actions=el('div',undefined,'actions');actions.append(button('Approve '+label(d.kind),()=>action('approve_picture',d.kind)),button('Reject '+label(d.kind),()=>action('reject_picture',d.kind)));if(d.kind==='full_length')actions.append(button('Request replacement photo',()=>action('query_photo')));card.append(actions);}root.append(card);}\n  if(s.status==='to_action'){const a=el('div',undefined,'actions');a.append(button('Ask for more information',()=>action('query_info')),button('Sign off test assessment',()=>action('sign_off')),button('Reject test assessment',()=>action('reject')));root.append(a);}list(root,'Prescription history',s.prescription?[s.prescription.id+' \xB7 synthetic, not legally issued']:['None for this test order.']);\n }else if(tab==='dispensing'){\n  root.append(el('p','Uses the production dispensing state-transition rules with fixed test-only prescription and stock fixtures. This does not verify a pharmacy integration.','muted'));\n  if(!s.fulfilment)root.append(el('p','Awaiting clinical sign-off.'));\n  else{list(root,'Dispensing card',['Order: '+s.orderNumber,'State: '+label(s.fulfilment.status),'Stock fixture: '+(s.stockAvailable?'available':'no stock')]);const a=el('div',undefined,'actions');\n   if(['received','query'].includes(s.fulfilment.status))a.append(button('Accept test prescription',()=>action('accept')));\n   if(s.fulfilment.status==='accepted')a.append(button('Start test dispensing',()=>action('prepare')));\n   if(s.fulfilment.status==='preparing')a.append(button('Record test dispatch',()=>action('dispatch')));\n   if(['received','query','accepted','preparing'].includes(s.fulfilment.status))a.append(button(s.stockAvailable?'Set test stock unavailable':'Set test stock available',()=>action(s.stockAvailable?'stock_off':'stock_on')),button('Query test supply',()=>action('pharmacy_query')),button('Reject test supply',()=>action('pharmacy_reject')));root.append(a);}\n }else if(tab==='communications'){\n  root.append(el('h3','Trigger previews \u2014 never sent'),el('p','No recipient, email sender or WhatsApp sender is connected to this queue. Exact production wording and recipients still require Matt\u2019s approval.'));\n  for(const n of record.notifications){const card=el('section',undefined,'card');card.append(el('h3',label(n.channel)+' \xB7 '+label(n.template)),el('p',n.body),el('p','Withheld \xB7 '+new Date(n.created_at).toLocaleString('en-GB'),'muted'));root.append(card);}if(!record.notifications.length)root.append(el('p','No notification triggers yet.'));\n }else{root.append(el('p','Each state change is recorded transactionally. Read-access events are retained separately in the same immutable audit table.'));list(root,'Order audit',record.events.map(e=>new Date(e.created_at).toLocaleString('en-GB')+' \xB7 '+label(e.action)+' \xB7 HQ actor '+e.actor_id));}\n}\n$('refresh').addEventListener('click',()=>task(async()=>{await loadOrders();if(selected)await open(selected);}));\n$('create').addEventListener('click',()=>task(async()=>{const b=await api('',{});selected=b.order.orderNumber;record=b;await loadOrders();}));\ntask(async()=>{const b=await loadOrders();if(b.orders.length)await open(b.orders[0].orderNumber);else $('detail').replaceChildren(el('h2','Ready for internal testing'),el('p','Create a fixed synthetic order. No patient information is requested.'));});\n" }, "/clinical-assets/partners/client.mjs": { "type": "text/javascript; charset=utf-8", "body": "const API='https://api.shiftsometimber.co.uk/v1/hq/clinical/partners';\nconst mode=document.body.dataset.mode,demo=document.body.dataset.demo==='true';\nconst $=id=>document.getElementById(id),el=(t,s)=>{const n=document.createElement(t);if(s!==undefined)n.textContent=s;return n;},pretty=s=>String(s||'').replaceAll('_',' ');\nconst detail=$('detail'),left=$('selectors'),notice=$('notice');let selected=null,version=0,serial=0,media=[],busy=false,applicationToken='',internalSetup=false;\nif(['application','activation'].includes(mode)){applicationToken=location.hash.slice(1);history.replaceState(null,'',location.pathname);}\nfunction clear(){serial++;selected=null;detail.replaceChildren();left.replaceChildren();for(const u of media)URL.revokeObjectURL(u);media=[];$('viewer').close();$('viewer').querySelector('img').removeAttribute('src');}\nasync function api(path='',data,headers={}){\n const response=await fetch(API+path,{method:data===undefined?'GET':'POST',credentials:'include',cache:'no-store',headers:{...data!==undefined&&!(data instanceof File)?{'Content-Type':'application/json'}:{},...applicationToken&&mode==='application'?{'X-Application-Token':applicationToken}:{},...headers},body:data===undefined?undefined:data instanceof File?data:JSON.stringify(data)});\n if(response.status===401||response.status===403){clear();}\n if(!response.ok){let b;try{b=await response.json();}catch{}throw Error(pretty(b?.error||'Service unavailable'));}\n return response.json();\n}\nfunction button(label,fn){const n=el('button',label);n.type='button';n.onclick=async()=>{if(busy)return;busy=true;n.disabled=true;try{await fn();}catch(e){notice.textContent=e.message;}finally{busy=false;if(n.isConnected)n.disabled=false;}};return n;}\nfunction field(form,name,label,type='text',value='',options){const l=el('label',label),n=el(options?'select':type==='textarea'?'textarea':'input');n.name=name;n.setAttribute('aria-label',label);if(n.tagName==='INPUT')n.type=type;if(options)for(const v of options){const o=el('option',pretty(v));o.value=v;n.append(o);}n.value=value;n.required=true;l.append(n);form.append(l);return n;}\nfunction fold(title){const d=el('details');d.append(el('summary',title));detail.append(d);return d;}\nfunction info(host,items){const dl=el('dl');for(const [k,v]of items){dl.append(el('dt',k),el('dd',v||'Not provided'));}host.append(dl);}\nfunction form(host,title,fields,submitLabel,submit){const f=el('form');f.append(el('h3',title));for(const x of fields)field(f,...x);f.onsubmit=e=>e.preventDefault();f.append(button(submitLabel,()=>{if(f.reportValidity())return submit(Object.fromEntries(new FormData(f)));}));host.append(f);return f;}\nasync function refresh(){const n=++serial;selected=null;detail.replaceChildren();left.replaceChildren();\n if(mode==='activation'){activation();return;}\n if(mode==='login'){login();return;}\n if(mode==='application'){const s=await api('/application');if(n===serial)drawStaff(s,true);return;}\n if(mode==='profile'){const s=await api('/me');if(n===serial)drawStaff(s,false,true);return;}\n if(mode==='dispensing'){const d=await api('/fulfilment');if(n!==serial)return;if(d.oversight)notice.textContent='Live HQ oversight \xB7 read-only dispensing queue. Clinical prescribing, pharmacy supply and messaging remain separately controlled.';for(const o of d.orders){const b=button(o.orderNumber,()=>openOrder(o.orderNumber));b.className='record';b.append(el('span',o.memberReplyReceived?'Member replied \xB7 '+pretty(o.status):pretty(o.status)));left.append(b);}if(!d.orders.length)left.append(el('p','No assigned orders.'));detail.append(el('h2',d.oversight?'Dispensing oversight':'Your dispensing queue'),el('p','Only confirmed prescription handovers appear here. Clinical approval alone does not create a dispensing order.'));return;}\n const d=await api();if(n!==serial)return;internalSetup=d.capabilities.internalSetupOnly===true;if(internalSetup)notice.textContent='Internal preparation: partner organisations, professional profiles and invitation drafts are saved on the server. Sending invitations, uploads, verification, activation and patient access remain closed.';const filter=el('select');filter.setAttribute('aria-label','Filter people');for(const v of ['all','clinician','dispensing']){const o=el('option',pretty(v));o.value=v;filter.append(o);}left.append(filter);const list=el('div');left.append(list);\n const draw=()=>{list.replaceChildren();for(const s of d.staff.filter(s=>filter.value==='all'||filter.value===s.kind)){const b=button(s.name,()=>openStaff(s.id));b.className='record';b.dataset.id=s.id;const badge=el('span',pretty(s.status));badge.className='badge';b.append(el('small',pretty(s.kind)),badge);b.setAttribute('aria-pressed',String(selected===s.id));list.append(b);}if(!list.children.length)list.append(el('p','No applications in this view.'));};filter.onchange=draw;draw();const clinicians=button('Clinicians & GPs \xB7 '+d.staff.filter(s=>s.kind==='clinician').length,()=>{filter.value='clinician';draw();});clinicians.className='record';left.prepend(clinicians);\n detail.append(el('h2','People & partners'),el('p','One restricted professional profile, with independent verification and role-specific permissions. No patient records are available in this directory.'));\n if(d.capabilities.administrator){const orgs=(await api('/organisations')).organisations;if(n!==serial)return;\n  const setup=el('section');setup.className='card';setup.setAttribute('aria-label','Provider assignments');setup.append(el('h3','Provider setup'));info(setup,[['Prescribing clinician / GP',d.providerAssignments?.prescribingClinicianOrGP?.displayName||'TBC'],['Dispensing pharmacy',d.providerAssignments?.dispensingPharmacy?.displayName||'TBC']]);setup.append(el('p','TBC means unassigned\u2014not an approved provider or an active account. You can prepare the workflow while these appointments are being finalised.'));detail.append(setup);\n  const banner=el('section');banner.className='attention';banner.append(el('h3','Clinicians & GPs'),el('p','Verified prescribers review cases and sign prescriptions within their approved treatment scope. Dispensing permissions are managed separately.'),button('Invite clinician',()=>inviteForm('clinician',orgs)));detail.append(banner);const invites=el('div');invites.className='actions';invites.append(button('Invite partner',()=>inviteForm('partner',orgs)));detail.append(invites);\n  const drafts=fold('Prepared invitations \xB7 not sent');drafts.append(button('View invitation drafts',async()=>{const saved=await api('/invitations');for(const draft of saved.drafts)drafts.append(button(pretty(draft.kind)+' \xB7 '+draft.recipient_name+' \xB7 not sent',()=>showInvitation({draft})));if(!saved.drafts.length)drafts.append(el('p','No prepared invitations yet.'));}));\n  const h=fold('Create partner organisation');form(h,'Organisation details',[['kind','Organisation type','text','clinical',['clinical','pharmacy']],['name','Legal / pharmacy name'],['registration','Organisation or premises registration reference'],['premises','Registered address','textarea'],['superintendent','Superintendent / clinical governance contact'],['contact','Professional contact email or phone']],'Save partner',async b=>{await api('/organisations',b);await refresh();});\n  const partners=fold('Partner organisations & verification');for(const o of orgs){const card=el('div');card.className='card';card.append(el('h3',o.name),el('p',pretty(o.kind)+' \xB7 '+pretty(o.status||'pending')),el('p','Registration: '+o.registration));form(card,'Partner approval',[['action','Action','text','approve',['approve','suspend']],['verificationReference','Verified premises/provider registration, agreement and due-diligence reference','textarea'],['expiresAt','Partner review / expiry','date']],'Record partner decision',async b=>{await api('/organisations/'+o.id,{...b,version:o.version,expiresAt:new Date(b.expiresAt+'T23:59:59.000Z').toISOString()});await refresh();});partners.append(card);}\n  const f=el('form');f.append(el('h3',internalSetup?'Prepare a draft professional record':'Start a staff application'));field(f,'kind','Staff role','text','clinician',['clinician','dispensing']);const select=field(f,'orgId','Partner organisation','text','',orgs.map(o=>o.id));for(const o of select.options)o.textContent=orgs.find(x=>x.id===o.value)?.name||o.value;field(f,'name','Full legal name');field(f,'email','Professional email','email');f.onsubmit=e=>e.preventDefault();f.append(button(internalSetup?'Save draft professional':'Create application',async()=>{if(f.reportValidity()){const s=await api('',Object.fromEntries(new FormData(f)));await refresh();await openStaff(s.id);}}));detail.append(f);\n }\n}\nfunction showInvitation(d){const s=d.draft,card=el('div');card.className='card invitation-preview';card.append(el('h2','Invitation prepared \xB7 not sent'),el('p','To: '+s.recipient_name+' <'+s.recipient_email+'>'),el('p','CC: None \xB7 BCC: None \xB7 Attachments: None'),el('h3',s.subject),el('pre',s.body),el('p','Held until professional onboarding opens. No setup link, account or prescribing permission has been granted. Draft reference: '+s.id));detail.prepend(card);notice.textContent='Invitation draft saved and audited. Not sent. No access granted.';card.scrollIntoView({block:'nearest'});}\nfunction inviteForm(kind,orgs){const available=orgs.filter(o=>kind!=='clinician'||o.kind==='clinical');detail.replaceChildren(el('h2',kind==='clinician'?'Invite clinician / GP':'Invite partner'),el('p','Prepare a named invitation for review. Onboarding remains closed; this does not send an email or activate an account.'));\n if(!available.length){detail.append(el('p','Save a '+(kind==='clinician'?'clinical ':'')+'partner organisation first using Create partner organisation on the overview.'));return;}\n const f=el('form'),org=field(f,'orgId','Partner organisation','text','',available.map(o=>o.id));for(const o of org.options)o.textContent=available.find(x=>x.id===o.value).name;field(f,'name','Full name');field(f,'email','Professional email','email');if(kind==='clinician')field(f,'profession','Professional role','text','GP',['GP','Doctor / independent prescriber','Pharmacist independent prescriber','Nurse independent prescriber','Other qualified independent prescriber']);f.onsubmit=e=>e.preventDefault();f.append(button('Prepare invitation draft',async()=>{if(!f.reportValidity())return;const b=Object.fromEntries(new FormData(f));let payload={kind,orgId:b.orgId,name:b.name,email:b.email};if(kind==='clinician'){let s=await api('',{kind:'clinician',orgId:b.orgId,name:b.name,email:b.email});s=await api('/'+s.id+'/action',{version:s.version,action:'details',details:{profession:b.profession}});payload={kind,orgId:s.orgId,staffId:s.id,profileVersion:s.version};}showInvitation(await api('/invitations',payload));}));detail.append(f);\n}\nasync function openStaff(id){const n=++serial;for(const u of media)URL.revokeObjectURL(u);media=[];selected=id;detail.replaceChildren();const s=await api('/'+id);if(n!==serial)return;drawStaff(s);for(const b of left.querySelectorAll('[data-id]'))b.setAttribute('aria-pressed',String(b.dataset.id===id));}\nasync function action(b){const id=selected,s=await api('/'+(mode==='application'?'application':id)+'/action',{version,...b});if(selected!==id)return;drawStaff(s,mode==='application');notice.textContent='Saved and audited. No message was sent.';}\nfunction drawStaff(s,app=false,readonly=false){selected=s.id;version=s.version;detail.replaceChildren();detail.append(el('h2',s.details.name),el('p',pretty(s.kind)+' \xB7 '+pretty(s.status)+' \xB7 Revision '+s.version));\n const bio=el('div');bio.className='card';info(bio,[['Username',s.username||'Generated after approval'],['Partner',s.orgId],['Professional registration',(s.details.regulator||'')+' '+(s.details.registrationNumber||'')],['Prescribing entitlement',s.details.prescribingEntitlement],['Access',s.status==='active'?'Subject to current credentials, MFA and scope checks':'No patient access']]);detail.append(bio);\n if(internalSetup)detail.append(el('p','Draft internal record only. Do not upload identity documents or treat this as professional approval. Invitation drafts can be prepared, but no sending or patient access is enabled.'));\n if(s.kind==='clinician'&&!app&&!readonly&&['draft','submitted','checks_underway','more_information'].includes(s.status))detail.append(button('Invite clinician',async()=>showInvitation(await api('/invitations',{kind:'clinician',orgId:s.orgId,staffId:s.id,profileVersion:s.version}))));\n if(s.applicationMessage)detail.append(el('p','Application update: '+s.applicationMessage));\n if(!readonly&&['draft','submitted','checks_underway','more_information'].includes(s.status)){\n  const host=fold('Application details');const f=el('form');for(const [k,label,type]of [['name','Full legal name'],['email','Professional email','email'],['professionalContact','Professional phone / contact'],['profession','Profession'],['regulator','Regulator'],['registrationNumber','Registration number'],['prescribingEntitlement','Licence / prescribing annotation or role'],['experience','Relevant experience and treatment competence','textarea'],['indemnityProvider','Indemnity provider'],['policyReference','Indemnity policy reference']])field(f,k,label,type||'text',s.details[k]||'');f.onsubmit=e=>e.preventDefault();f.append(button('Save application details',()=>f.reportValidity()&&action({action:'details',details:Object.fromEntries(new FormData(f))})));host.append(f);\n }\n const docs=fold('Identity, selfie & compliance documents');docs.append(el('p','Restricted verification evidence. No automatic identity decision is made.'));for(const kind of ['photo_id','selfie','indemnity','qualification','agreement']){\n  const latest=s.evidence.filter(e=>e.kind===kind).at(-1),row=el('div');row.className='card';row.append(el('h3',pretty(kind)),el('p',latest?'Uploaded '+new Date(latest.uploadedAt).toLocaleDateString('en-GB')+' \xB7 retention review '+new Date(latest.retentionUntil).toLocaleDateString('en-GB'):'Not uploaded'));\n  if(latest&&!readonly&&!internalSetup)row.append(button('View / enlarge',()=>viewImage(s.id,latest.id)));\n  if(!readonly&&!internalSetup&&['draft','submitted','more_information'].includes(s.status)){const input=el('input');input.type='file';input.accept='image/png,image/jpeg';input.setAttribute('aria-label','Upload '+pretty(kind));row.append(input,button('Upload image',async()=>{if(!input.files[0])throw Error('Choose a PNG or JPEG image.');const uploaded=await api('/'+(app?'application':s.id)+'/evidence',input.files[0],{'Content-Type':input.files[0].type,'X-Evidence-Kind':kind,'X-Profile-Version':String(version)});drawStaff(uploaded,app);notice.textContent='Upload saved securely. Existing verification must be reviewed again.';}));}docs.append(row);\n }\n if(!readonly&&!internalSetup){const controls=el('div');controls.className='actions';if(['draft','more_information'].includes(s.status))controls.append(button('Submit application & declaration',()=>action({action:'submit',declaration:true})));if(!app){controls.append(button('Create application link',async()=>{const d=await api('/'+s.id+'/link',{});showLink(d);}),button('Prepare password setup',async()=>{const d=await api('/'+s.id+'/credentials',{});showLink(d);await openStaff(s.id);}));}detail.append(controls);}\n const checks=fold('Verification checks');for(const c of s.checks)checks.append(el('p',pretty(c.kind)+' \xB7 '+pretty(c.outcome)+' \xB7 checked by '+c.reviewedBy+' \xB7 valid until '+new Date(c.expiresAt).toLocaleDateString('en-GB')));\n if(!app&&!readonly&&!internalSetup){form(checks,'Record an independent check',[['kind','Check','text','identity',['identity','registration','indemnity','agreements','competence']],['outcome','Outcome','text','verified',['verified','rejected']],['source','Evidence source and verification reference','textarea'],['expiresAt','Next review / expiry','date']],'Save verification',b=>action({action:'check',...b,expiresAt:new Date(b.expiresAt+'T23:59:59.000Z').toISOString()}));}\n const scopes=fold('Approved areas & permissions');for(const g of s.grants){const card=el('div');card.className='card';card.append(el('h3',pretty(g.area)),el('p',g.actions.map(pretty).join(' \xB7 ')),el('p','Medicines: '+(g.medicines.join(', ')||'All within this approved scope')),el('p','Restrictions: '+g.restrictions),el('p','Approver '+g.approvedBy+' \xB7 expires '+new Date(g.expiresAt).toLocaleDateString('en-GB')+(g.revokedAt?' \xB7 REVOKED':'')));if(!app&&!readonly&&!g.revokedAt)card.append(button('Revoke permission',()=>action({action:'revoke_grant',grantId:g.id,reason:'Revoked through HQ scope management'})));scopes.append(card);}\n if(!app&&!readonly&&!internalSetup){scopes.append(el('p','Scope approval requires a separately designated qualified clinical/pharmacy reviewer. HQ ownership alone does not grant this authority.'));const f=el('form');field(f,'area','Service area','text','weight_management',['weight_management','testosterone','sexual_health','other']);for(const name of s.kind==='clinician'?['review','query','clinical_decision','issue_prescription']:['view_fulfilment','query','supply_decision','prepare','dispatch','record_delivery','record_exception','cancel_supply']){const l=el('label',pretty(name)),c=el('input');c.type='checkbox';c.name='permission';c.value=name;l.prepend(c);f.append(l);}field(f,'medicines','Allowed medicines, one per line (leave empty only for unrestricted scope)','textarea').required=false;field(f,'restrictions','Clinical restrictions / operating limits','textarea');field(f,'approvalReference','Competence approval reference');field(f,'expiresAt','Permission review / expiry','date');f.onsubmit=e=>e.preventDefault();f.append(button('Record professional scope approval',()=>{if(f.reportValidity()){const b=Object.fromEntries(new FormData(f));return action({action:'grant',...b,actions:[...f.querySelectorAll('[name=permission]:checked')].map(n=>n.value),medicines:b.medicines.split('\\n').map(v=>v.trim()).filter(Boolean),expiresAt:new Date(b.expiresAt+'T23:59:59.000Z').toISOString()});}}));scopes.append(f);}\n if(!app&&!readonly){const h=fold('HQ approval & account controls');if(!internalSetup)h.append(button('Approve application',()=>action({action:'approve'})),button('Activate after password & MFA setup',()=>action({action:'activate'})));form(h,'Request information / reject / suspend / renew',[['action','Action','text','query',(internalSetup?['query','reject','suspend']:['query','reject','suspend','renew'])],['message','Reason / information required','textarea']],'Record action',b=>action({...b,reason:b.message}));const audit=fold('Audit history');audit.append(button('Load audit trail',async()=>{const n=serial,d=await api('/'+s.id+'/audit');if(n!==serial)return;const list=el('ol');list.className='timeline';for(const e of d.events)list.append(el('li',new Date(e.created_at).toLocaleString('en-GB')+' \xB7 '+pretty(e.action)+' \xB7 '+e.actor_id));audit.append(list);}));}\n}\nfunction showLink(d){notice.replaceChildren(el('span','Secure setup link prepared, not sent. Expires '+new Date(d.expiresAt).toLocaleString('en-GB')+': '));const a=el('a',d.link);a.href=d.link;notice.append(a);}\nasync function viewImage(id,evidenceId){\n if(demo){notice.textContent='Fictional evidence placeholder only\u2014no real ID is stored in this demonstration.';return;}\n const r=await fetch(API+'/'+(mode==='application'?'application':id)+'/evidence/'+evidenceId,{credentials:'include',cache:'no-store',headers:applicationToken?{'X-Application-Token':applicationToken}:{}});if(!r.ok){if([401,403].includes(r.status))clear();throw Error('Evidence unavailable or access expired.');}const u=URL.createObjectURL(await r.blob());media.push(u);$('viewer').querySelector('img').src=u;$('viewer').showModal();\n}\nasync function openOrder(order){const n=++serial;selected=order;detail.replaceChildren();const d=await api('/fulfilment/'+encodeURIComponent(order));if(n!==serial)return;const o=d.order;version=o.version;detail.append(el('h2',o.orderNumber),el('p',pretty(o.status)+' \xB7 updated '+new Date(o.updatedAt).toLocaleString('en-GB')));const card=el('div');card.className='card';info(card,[['Prescription',o.prescriptionId],['Medicine',o.medicine],['Strength',o.treatment?.strength],['Prescribed dose',o.treatment?.dose],['Quantity',o.quantity],['Directions',o.directions],['Member',o.patient?.name],['Delivery',o.delivery?.address]]);detail.append(card);if(d.prescription){const rx=el('section');rx.className='card';rx.append(el('h3','Signed prescription'));const p=d.prescription.document;info(rx,[['Prescription date',p.issuedOn],['Prescriber',p.prescriber.name],['Registration',p.prescriber.registrationBody+' '+p.prescriber.registrationNumber],['Practice',p.prescriber.practiceAddress],['Member',p.patient.name],['DOB',p.patient.dateOfBirth],['Address',p.patient.address+' '+p.patient.postcode],['Medicine',p.treatment.medicine+' '+p.treatment.strength],['Dose',p.treatment.dose],['Quantity',p.treatment.quantity],['Route',p.treatment.route],['Directions',p.treatment.directions],['Prescription integrity reference',d.prescription.digest]]);if(!d.prescription.current)rx.append(el('strong','Hold supply: this prescription needs a currentness review.'));detail.append(rx);}if(o.tracking){const a=el('a','Track delivery');if(/^https:\\/\\/(www\\.royalmail\\.com|track\\.dpd\\.co\\.uk)\\//.test(o.tracking.url)){a.href=o.tracking.url;a.rel='noopener noreferrer';a.target='_blank';detail.append(a);}}\n if(!d.oversight&&o.memberReply){const response=el('div');response.className='card';response.append(el('h3','Member response'),el('p',o.memberReply.message),el('p','Received '+new Date(o.memberReply.createdAt).toLocaleString('en-GB')));detail.append(response);}\n if(!d.oversight){const f=el('form');field(f,'message','Reason or question (required for query/rejection)','textarea').required=false;field(f,'carrier','Courier','text','royal_mail',['royal_mail','dpd']);field(f,'trackingNumber','Tracking number').required=false;const controls=el('div');controls.className='actions';for(const [action,label]of [['accept','Accept prescription'],['query','Query'],['reject','Reject supply'],['prepare','Start dispensing'],['dispatch','Confirm dispatch'],['delivered','Record delivery'],['delivery_exception','Record delivery issue'],['returned','Record return'],['cancel','Cancel supply']].filter(([a])=>({accept:['received','query'],query:['received','accepted','preparing'],reject:['received','query','accepted','preparing'],prepare:['accepted'],dispatch:['preparing'],delivered:['dispatched','delivery_exception'],delivery_exception:['dispatched'],returned:['dispatched','delivery_exception','delivered'],cancel:['received','query','accepted','preparing']})[a].includes(o.status)))controls.append(button(label,async()=>{await api('/fulfilment/'+encodeURIComponent(order)+'/action',{version,action,...Object.fromEntries(new FormData(f))});await openOrder(order);notice.textContent='Order update recorded. Notification is a draft\u2014not sent.';}));f.append(controls);f.onsubmit=e=>e.preventDefault();detail.append(f);}\n const h=fold('Order history & audit');const list=el('ol');list.className='timeline';for(const e of d.events)list.append(el('li',new Date(e.created_at).toLocaleString('en-GB')+' \xB7 '+pretty(e.action)+' \xB7 '+e.actor_id));h.append(list);detail.append(el('p','Prescription issue, pharmacy acceptance and dispatch are separate confirmations. No stock means preparation/dispatch are blocked.'));\n}\nfunction activation(){detail.replaceChildren();detail.append(el('h2','Set your own password'),el('p','This link is single-use and expires. HQ never sees your password.'));form(detail,'Password setup',[['password','New password (15\u2013128 characters)','password']],'Create password',async b=>{const d=await api('/activation',{token:applicationToken,password:b.password});applicationToken='';detail.replaceChildren(el('h2','Password created'),el('p','Your username: '+d.username),el('p',d.next));});}\nfunction login(){\n detail.replaceChildren();detail.append(el('h2','Sign in with your allocated username'));\n async function signedIn(d){\n  detail.replaceChildren();\n  if(d.mfaRequired){form(detail,'Authenticator check',[['code','Six-digit authenticator code']],'Verify code',async b=>signedIn(await api('/login/verify',{challenge:d.challenge,code:b.code})));return;}\n  if(!d.user?.mfaEnabled){\n   const r=await fetch('https://api.shiftsometimber.co.uk/v1/hq/mfa/setup',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw Error('HQ MFA setup is unavailable. Contact your administrator.');const setup=await r.json();\n   detail.append(el('h2','Set up your authenticator'),el('p','Add a time-based code account to your authenticator using this setup key. It is shown only during setup.'),el('code',setup.secret));\n   form(detail,'Confirm setup',[['code','Six-digit authenticator code']],'Enable MFA',async b=>{const r=await fetch('https://api.shiftsometimber.co.uk/v1/hq/mfa/enable',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});if(!r.ok)throw Error('The code could not be verified.');detail.replaceChildren(el('h2','MFA enabled'),el('p','HQ must activate your approved permissions before patient access.'));});return;\n  }\n  detail.append(el('h2','Signed in'),el('p','Your approved permissions are checked separately on every request.'));const link=el('a','Open my professional profile');link.href='/clinical-portal/my-profile';detail.append(link);\n }\n form(detail,'Professional account',[['username','System-generated username'],['password','Password','password']],'Sign in',async b=>signedIn(await api('/login',b)));\n}\n$('refresh').onclick=()=>refresh().catch(e=>notice.textContent=e.message);$('reset')?.addEventListener('click',()=>location.reload());$('close-viewer').onclick=()=>{$('viewer').close();$('viewer').querySelector('img').removeAttribute('src');for(const u of media)URL.revokeObjectURL(u);media=[];};\nwindow.addEventListener('pagehide',()=>{applicationToken='';clear();});window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});refresh().catch(e=>notice.textContent=e.message);\n" }, "/clinical-assets/partners/domain.mjs": { "type": "text/javascript; charset=utf-8", "body": "// Shared domain: server-authenticated actors only. UI never supplies authority.\nexport const AREAS=['weight_management','testosterone','sexual_health','other'];\nexport const ACTIONS={clinician:['review','query','clinical_decision','issue_prescription'],dispensing:['view_fulfilment','query','supply_decision','prepare','dispatch','record_delivery','record_exception','cancel_supply']};\nexport const EVIDENCE=['photo_id','selfie','indemnity','qualification','agreement'];\nexport const CHECKS=['identity','registration','indemnity','agreements','competence'];\nexport const fail=(status,code)=>{throw Object.assign(Error(code),{status});};\nexport const text=(v,max=1000)=>{if(typeof v!=='string'||!v.trim()||v.length>max||/[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f\\u007f]/.test(v))fail(422,'valid_text_required');return v.trim();};\nexport const future=(v,now)=>{if(typeof v!=='string'||!/^\\d{4}-\\d\\d-\\d\\dT\\d\\d:\\d\\d:\\d\\d\\.\\d{3}Z$/.test(v)||!Number.isFinite(Date.parse(v))||new Date(v).toISOString()!==v||v<=now)fail(422,'future_review_date_required');return v;};\nconst ops=a=>a?.mfa===true&&['owner','admin'].includes(a.role);\nconst own=(s,a)=>String(s.hqUserId)===String(a.id);\nconst equal=(a,b)=>JSON.stringify(a)===JSON.stringify(b);\nexport function newStaff(b,id,now){\n if(!Object.hasOwn(ACTIONS,b.kind))fail(422,'invalid_staff_kind');\n return{id,kind:b.kind,orgId:text(b.orgId,100),version:0,status:'draft',hqUserId:null,username:null,credentialVersion:0,\n  details:{name:text(b.name,160),email:text(b.email,200).toLowerCase()},evidence:[],checks:[],grants:[],createdAt:now,updatedAt:now};\n}\nexport function credentialsCurrent(s,now){return CHECKS.every(kind=>s.checks.some(c=>c.kind===kind&&c.credentialVersion===s.credentialVersion&&c.outcome==='verified'&&c.expiresAt>now));}\nexport function permission(s,area,action,now,medicine){\n if(s.status!=='active'||!s.hqUserId||!credentialsCurrent(s,now))return false;\n return s.grants.some(g=>g.credentialVersion===s.credentialVersion&&!g.revokedAt&&g.area===area&&g.actions.includes(action)&&g.startsAt<=now&&g.expiresAt>now&&(!g.medicines.length||medicine&&g.medicines.includes(medicine)));\n}\nexport function staffAction(original,b,actor,now,id){\n if(!Number.isInteger(b.version)||b.version!==original.version)fail(409,'profile_changed');\n const s=structuredClone(original),admin=ops(actor),app=actor.application===s.id;\n const requireAdmin=()=>{if(!admin)fail(403,'owner_approval_required');if(own(s,actor))fail(403,'self_approval_forbidden');};\n const metadata={};\n if(b.action==='details'){\n  if(!admin&&!app)fail(403,'application_access_required');\n  if(['approved','credentials_pending','active','suspended','rejected'].includes(s.status))fail(409,'approved_details_require_reapplication');\n  const d=b.details;if(!d||typeof d!=='object')fail(422,'details_required');\n  if(s.hqUserId&&['name','email'].some(k=>d[k]!==undefined&&d[k]!==s.details[k]))fail(409,'provisioned_identity_change_requires_separate_review');\n  const keys=['name','email','professionalContact','profession','regulator','registrationNumber','prescribingEntitlement','experience','indemnityProvider','policyReference','registrationReviewAt'];\n  if(Object.keys(d).some(k=>!keys.includes(k)))fail(422,'unknown_application_field');\n  for(const [k,v]of Object.entries(d))s.details[k]=text(v,k==='experience'?4000:300);\n  if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(s.details.email))fail(422,'valid_email_required');\n  s.details.email=s.details.email.toLowerCase();s.credentialVersion++;s.status='draft';\n }else if(b.action==='evidence'){\n  if(!admin&&!app)fail(403,'application_access_required');if(!['draft','more_information','submitted'].includes(s.status))fail(409,'reapplication_required');\n  if(!EVIDENCE.includes(b.evidence?.kind)||!/^[a-f0-9]{64}$/.test(b.evidence.digest)||!b.evidence.id)fail(422,'verified_upload_required');\n  s.evidence.push(b.evidence);s.credentialVersion++;s.status='draft';metadata.kind=b.evidence.kind;metadata.evidenceId=b.evidence.id;\n }else if(b.action==='hold_evidence'||b.action==='release_evidence_hold'){\n  requireAdmin();const e=s.evidence.find(e=>e.id===b.evidenceId&&!e.purgedAt);if(!e)fail(404,'evidence_not_found');if(e.deletionPendingAt)fail(409,'evidence_deletion_already_pending');\n  metadata.evidenceId=e.id;metadata.reason=text(b.reason,2000);\n  if(b.action==='hold_evidence'){e.legalHold={reason:metadata.reason,actorId:String(actor.id),at:now,reviewAt:future(b.reviewAt,now)};metadata.reviewAt=e.legalHold.reviewAt;}\n  else{if(!e.legalHold)fail(409,'evidence_not_on_hold');delete e.legalHold;}\n }else if(b.action==='submit'){\n  if(!admin&&!app)fail(403,'application_access_required');if(!['draft','more_information'].includes(s.status))fail(409,'application_not_editable');\n  for(const k of ['name','email','professionalContact','profession','regulator','registrationNumber','indemnityProvider','experience'])text(s.details[k],4000);\n  for(const k of EVIDENCE)if(!s.evidence.some(e=>e.kind===k&&e.retentionUntil>now))fail(422,'missing_'+k);\n  if(b.declaration!==true)fail(422,'application_declaration_required');s.status='submitted';s.submittedAt=now;\n }else if(b.action==='check'){\n  requireAdmin();if(!['submitted','checks_underway','more_information'].includes(s.status))fail(409,'submitted_application_required');\n  if(!CHECKS.includes(b.kind)||!['verified','rejected'].includes(b.outcome))fail(422,'invalid_verification_check');\n  const check={id,kind:b.kind,outcome:b.outcome,source:text(b.source,2000),reviewedBy:String(actor.id),checkedAt:now,expiresAt:future(b.expiresAt,now),credentialVersion:s.credentialVersion};\n  s.checks=s.checks.filter(c=>c.kind!==b.kind||c.credentialVersion!==s.credentialVersion);s.checks.push(check);s.status=b.outcome==='verified'?'checks_underway':'more_information';metadata.kind=b.kind;metadata.outcome=b.outcome;\n }else if(b.action==='query'||b.action==='reject'){\n  requireAdmin();if(s.status==='active')fail(409,'suspend_active_profile_first');s.status=b.action==='query'?'more_information':'rejected';s.applicationMessage=text(b.message,3000);\n }else if(b.action==='approve'){\n  requireAdmin();if(s.status!=='checks_underway'||!credentialsCurrent(s,now))fail(422,'current_verifications_required');\n  if(!/^(CLN|DSP)-[A-F0-9]{12}$/.test(b.username)||!b.username.startsWith(s.kind==='clinician'?'CLN-':'DSP-'))fail(422,'generated_username_required');\n  if(s.username&&s.username!==b.username)fail(409,'allocated_username_is_permanent');s.username=b.username;s.status=s.hqUserId?'credentials_pending':'approved';s.approvedBy=String(actor.id);s.approvedAt=now;metadata.username=s.username;\n }else if(b.action==='grant'){\n  if(!actor.mfa||!(s.kind==='clinician'?actor.clinicalGovernor:actor.pharmacyGovernor))fail(403,'qualified_scope_approver_required');\n  if(own(s,actor))fail(403,'self_approval_forbidden');if(!['approved','credentials_pending','active'].includes(s.status)||!credentialsCurrent(s,now))fail(422,'approved_current_profile_required');\n  if(!AREAS.includes(b.area)||!Array.isArray(b.actions)||!b.actions.length||new Set(b.actions).size!==b.actions.length||b.actions.some(x=>!ACTIONS[s.kind].includes(x)))fail(422,'invalid_scope');\n  if(!Array.isArray(b.medicines)||b.medicines.length>30||b.medicines.some(v=>typeof v!=='string'||!v.trim()||v.length>120))fail(422,'invalid_medicine_restrictions');\n  const grant={id,credentialVersion:s.credentialVersion,area:b.area,actions:b.actions,medicines:b.medicines,restrictions:text(b.restrictions,2000),approvalReference:text(b.approvalReference,1000),approvedBy:String(actor.id),startsAt:now,expiresAt:future(b.expiresAt,now)};\n  s.grants.push(grant);metadata.grantId=id;metadata.area=b.area;metadata.actions=b.actions;\n }else if(b.action==='revoke_grant'){\n  requireAdmin();const g=s.grants.find(g=>g.id===b.grantId&&!g.revokedAt);if(!g)fail(404,'grant_not_found');g.revokedAt=now;metadata.grantId=g.id;metadata.reason=text(b.reason);\n }else if(b.action==='activate'){\n  requireAdmin();if(s.status!=='credentials_pending'||!s.passwordSetAt||!b.accountMfaVerified||!s.hqUserId||!credentialsCurrent(s,now))fail(422,'credentials_mfa_and_checks_required');\n  if(!s.grants.some(g=>g.credentialVersion===s.credentialVersion&&!g.revokedAt&&g.expiresAt>now))fail(422,'approved_scope_required');s.status='active';\n }else if(b.action==='renew'){\n  requireAdmin();if(!['active','suspended','approved','credentials_pending'].includes(s.status))fail(409,'approved_profile_required');s.status='draft';s.credentialVersion++;metadata.reason=text(b.reason);\n }else if(b.action==='suspend'){\n  requireAdmin();if(!['active','approved','credentials_pending'].includes(s.status))fail(409,'profile_not_approved');s.status='suspended';metadata.reason=text(b.reason);\n }else fail(422,'unknown_staff_action');\n s.version++;s.updatedAt=now;return{state:s,event:{id,action:'staff_'+b.action,actorId:String(actor.id),at:now,details:metadata}};\n}\nexport const CARRIERS={royal_mail:n=>'https://www.royalmail.com/track-your-item#/tracking-results/'+encodeURIComponent(n),dpd:n=>'https://track.dpd.co.uk/parcels/'+encodeURIComponent(n)};\nexport function fulfilmentAction(original,b,staff,actor,now,id,{prescriptionCurrent=false,stockAvailable=false}={}){\n if(b.version!==original.version||!Number.isInteger(b.version))fail(409,'order_changed');\n if(!actor.mfa||staff.orgId!==original.partnerId||String(staff.hqUserId)!==String(actor.id))fail(404,'order_not_found');\n const required={accept:'supply_decision',reject:'supply_decision',query:'query',prepare:'prepare',dispatch:'dispatch',delivered:'record_delivery',delivery_exception:'record_exception',returned:'record_delivery',cancel:'cancel_supply'}[b.action];\n if(!required||!permission(staff,original.area,required,now,original.medicine))fail(403,'dispensing_permission_required');\n const transitions={accept:['received','query'],reject:['received','query','accepted','preparing'],query:['received','accepted','preparing'],prepare:['accepted'],dispatch:['preparing'],delivered:['dispatched','delivery_exception'],delivery_exception:['dispatched'],returned:['dispatched','delivery_exception','delivered'],cancel:['received','query','accepted','preparing']};\n if(!transitions[b.action].includes(original.status))fail(409,'invalid_fulfilment_transition');\n if(['accept','prepare','dispatch'].includes(b.action)&&(!prescriptionCurrent||!original.prescriptionId))fail(422,'current_issued_prescription_required');\n if(['prepare','dispatch'].includes(b.action)&&!stockAvailable)fail(409,'stock_unavailable');\n const s=structuredClone(original),detail={};s.status={accept:'accepted',reject:'rejected',query:'query',prepare:'preparing',dispatch:'dispatched',delivered:'delivered',delivery_exception:'delivery_exception',returned:'returned',cancel:'cancelled'}[b.action];\n if(['reject','query','delivery_exception','returned','cancel','delivered'].includes(b.action)){s.message=text(b.message,2000);detail.messagePresent=true;}\n if(b.action==='query'){s.queryId=id;s.memberReply=null;}\n if(['delivered','delivery_exception','returned'].includes(b.action))s.deliveryUpdate={kind:b.action,source:'pharmacy_manual_record',recordedAt:now,note:s.message};\n if(b.action==='dispatch'){\n  if(!Object.hasOwn(CARRIERS,b.carrier)||typeof b.trackingNumber!=='string'||!/^[A-Za-z0-9-]{6,50}$/.test(b.trackingNumber))fail(422,'valid_carrier_tracking_required');\n  s.tracking={carrier:b.carrier,number:b.trackingNumber,url:CARRIERS[b.carrier](b.trackingNumber),dispatchedAt:now};detail.carrier=b.carrier;\n }\n s.version++;s.updatedAt=now;return{state:s,event:{id,action:'fulfilment_'+b.action,actorId:String(actor.id),at:now,details:detail}};\n}\nexport function memberTracking(s){return{orderNumber:s.orderNumber,status:s.status,updatedAt:s.updatedAt,tracking:s.tracking||null,actionNeeded:s.status==='query'&&!s.memberReply,prescriptionId:s.prescriptionId,deliveryUpdate:s.deliveryUpdate||null};}\n" }, "/clinical-assets/partners/demo.mjs": { "type": "text/javascript; charset=utf-8", "body": "import {newStaff,staffAction,fulfilmentAction,EVIDENCE,CHECKS} from './domain.mjs';\nconst date='2026-10-24T10:00:00.000Z',expiry='2027-10-24T10:00:00.000Z';\nconst actor={id:1,role:'owner',mfa:true,clinicalGovernor:true,pharmacyGovernor:true};\nconst organisation={id:'DEMO-CLINICAL',kind:'clinical',name:'Fictional Clinical Partner',registration:'DEMO\u2014NOT A REGISTRATION',premises:'Fictional address',superintendent:'Fictional governance lead',contact:'demo@example.invalid'};\nconst pharmacy={...organisation,id:'DEMO-PHARMACY',kind:'pharmacy',name:'Fictional Dispensing Partner'};\nfunction profile(id,kind){const s=newStaff({name:kind==='clinician'?'Alex Example \xB7 fictional clinician':'Sam Example \xB7 fictional pharmacist',email:id+'@example.invalid',kind,orgId:kind==='clinician'?organisation.id:pharmacy.id},id,date);Object.assign(s.details,{professionalContact:'Demo only',profession:kind==='clinician'?'Pharmacist prescriber':'Pharmacist',regulator:'DEMO ONLY',registrationNumber:'NOT-A-REAL-REGISTRATION',prescribingEntitlement:'Fictional scope',experience:'Fictional training evidence',indemnityProvider:'Fictional insurer',policyReference:'DEMO-POLICY'});s.evidence=EVIDENCE.map(kind=>({id:'DEMO-'+kind,kind,mime:'image/png',digest:'a'.repeat(64),uploadedAt:date,retentionUntil:expiry}));s.status='submitted';return s;}\nconst applicant=profile('DEMO-APPLICANT','clinician'),dispenser=profile('DEMO-DISPENSER','dispensing');\ndispenser.status='active';dispenser.username='DSP-AABBCCDDEEFF';dispenser.hqUserId=12;dispenser.checks=CHECKS.map(kind=>({kind,outcome:'verified',credentialVersion:0,expiresAt:expiry,reviewedBy:'DEMO-VERIFIER'}));dispenser.grants=[{credentialVersion:0,id:'DEMO-GRANT',area:'weight_management',actions:['view_fulfilment','query','supply_decision','prepare','dispatch'],medicines:[],restrictions:'Fictional demonstration only',approvedBy:'DEMO-GOVERNOR',startsAt:date,expiresAt:expiry}];\nconst staff=new Map([[applicant.id,applicant],[dispenser.id,dispenser]]),organisations=[organisation,pharmacy],events=[];\nconst invitationDrafts=[];let stock=false;\nlet order={orderNumber:'DEMO-1042',partnerId:pharmacy.id,memberId:999,area:'weight_management',medicine:'Fictional medicine \u2014 not a real prescription',prescriptionId:'DEMO-RX-NOT-VALID',patient:{name:'Alex Example \xB7 fictional member'},delivery:{address:'Fictional delivery address'},status:'received',version:0,updatedAt:date};\nexport function toggleDemoStock(){stock=!stock;return stock;}\nexport async function demoFetch(url,options={}){\n const parts=new URL(url).pathname.split('/partners')[1]?.split('/').filter(Boolean)||[],data=options.body?JSON.parse(options.body):undefined;\n try{\n  let result;\n  if(parts[0]==='invitations'){if(data){const s=staff.get(data.staffId),draft={id:crypto.randomUUID(),kind:data.kind,recipient_name:s?.details.name||data.name,recipient_email:s?.details.email||data.email,subject:'FICTIONAL SHIFT invitation',body:'Fictional invitation preview only. Professional onboarding is not open. No invitation is sent and no access is granted.',status:'held_onboarding_closed'};invitationDrafts.push(draft);result={draft,sent:false,accessGranted:false};}else result={drafts:invitationDrafts,sent:false};}\n  else if(parts[0]==='organisations'){if(data&&parts[1]){result=organisations.find(o=>o.id===parts[1]);Object.assign(result,{status:data.action==='approve'?'approved':'suspended',version:(result.version||0)+1});}else if(data){result={id:crypto.randomUUID(),...data};organisations.push(result);}else result={organisations};}\n  else if(parts[0]==='fulfilment'){\n   if(parts[2]==='action'){const r=fulfilmentAction(order,data,dispenser,{id:12,role:'clinical',mfa:true},new Date().toISOString(),crypto.randomUUID(),{prescriptionCurrent:true,stockAvailable:stock});order=r.state;events.push({actor_id:'DEMO-PHARMACIST',action:r.event.action,created_at:r.event.at});result={order,notificationStatus:'fictional_no_message'};}\n   else result=parts.length===1?{orders:[order],oversight:false}:{order,oversight:false,events:[...events]};\n  }else if(!parts.length){if(data){const s=newStaff(data,crypto.randomUUID(),new Date().toISOString());staff.set(s.id,s);result=s;}else result={staff:[...staff.values()].map(s=>({...s,name:s.details.name})),capabilities:{administrator:true,clinicalGovernor:true,pharmacyGovernor:true}};}\n  else {const id=parts[0]==='me'?'DEMO-DISPENSER':parts[0],s=staff.get(id);if(!s)throw Object.assign(Error('staff_not_found'),{status:404});\n   if(parts[1]==='action'){if(data.action==='approve')data.username='CLN-AABBCCDDEEFF';if(data.action==='activate')data.accountMfaVerified=false;const r=staffAction(s,data,actor,new Date().toISOString(),crypto.randomUUID());staff.set(id,r.state);events.push({actor_id:'DEMO-OWNER',action:r.event.action,created_at:r.event.at});result=r.state;}\n   else if(parts[1]==='link'||parts[1]==='credentials')result={link:'https://hq.shiftsometimber.co.uk/clinical-portal/partners/application#FICTIONAL-NOT-A-REAL-LINK',expiresAt:expiry,sent:false};\n   else if(parts[1]==='audit')result={events};else result=s;\n  }\n  return Response.json(result);\n }catch(e){return Response.json({error:e.message},{status:e.status||422});}\n}\nif(typeof document!=='undefined'&&document.body.dataset.mode==='dispensing'){\n const b=document.createElement('button');b.type='button';b.textContent='Demo stock: unavailable';b.addEventListener('click',()=>{b.textContent='Demo stock: '+(toggleDemoStock()?'available (fictional)':'unavailable');});document.querySelector('.toolbar').append(b);\n}\n" }, "/clinical-assets/partners/style.css": { "type": "text/css; charset=utf-8", "body": ":root{color-scheme:light;--black:#050505;--cream:#e7e3da;--green:#707762}*{box-sizing:border-box}body{margin:0;background:var(--cream);color:var(--black);font:16px/1.5 system-ui,sans-serif}header{background:var(--black);color:var(--cream);padding:26px 32px;border-bottom:5px solid var(--green);display:flex;justify-content:space-between;gap:24px;align-items:center}h1{font-size:28px;letter-spacing:-.03em;margin:4px 0}h2{font-size:22px;margin:0 0 16px}h3{font-size:18px;margin-top:0}.eyebrow{font-size:12px;letter-spacing:.16em;margin:0}.eyebrow span{color:#c3cbb5}nav{display:flex;gap:16px;flex-wrap:wrap}a{color:inherit;text-underline-offset:4px}nav a{font-size:13px}main{padding:24px 32px 40px;max-width:1600px;margin:auto}.toolbar{display:flex;gap:12px;align-items:center;margin:18px 0}.workspace{display:grid;grid-template-columns:290px minmax(0,1fr);gap:24px;align-items:start}aside{background:var(--black);color:var(--cream);padding:24px;border-radius:12px;border-top:5px solid var(--green);position:sticky;top:16px;max-height:85vh;overflow:auto}#detail{min-width:0;background:#fff;border-radius:12px;padding:28px;border-top:5px solid var(--green);box-shadow:0 5px 25px #05050509}button,input,select,textarea{font:inherit}button{min-height:44px;padding:10px 16px;background:var(--black);color:var(--cream);border:1px solid var(--green);border-radius:6px;cursor:pointer}button:disabled{opacity:.5;cursor:not-allowed}.record{width:100%;text-align:left;margin:10px 0;padding:14px;background:#20241b;display:flex;flex-direction:column;gap:6px}.record[aria-pressed=true]{background:var(--green);border-color:var(--cream)}.badge{background:var(--cream);color:var(--black);border-radius:4px;padding:3px 7px;font-size:12px;width:fit-content}.card,details{border:1px solid #cbd0c5;border-radius:8px;padding:20px;margin:18px 0;background:#fff}details[open]{border-left:5px solid var(--green)}summary{cursor:pointer;font-weight:700}label{display:block;margin:12px 0}input:not([type=checkbox]),select,textarea{display:block;width:100%;padding:11px 12px;margin-top:6px;background:#fff;color:var(--black);border:1px solid #8b9480;border-radius:5px;min-width:0}textarea{min-height:92px}input[type=checkbox]{width:20px;height:20px;vertical-align:middle;margin-right:10px}.actions{display:flex;gap:10px;flex-wrap:wrap;margin:16px 0}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.grid>.card{margin:0}.muted{color:#53604a;font-size:14px}.attention{background:var(--green);color:#fff;padding:20px;border-radius:8px}#notice{padding:16px 20px;background:#f7f6f1;border-left:5px solid var(--green);border-radius:6px;overflow-wrap:anywhere}p,dd{overflow-wrap:anywhere}dl{display:grid;grid-template-columns:minmax(120px,180px) minmax(0,1fr);gap:10px}dt{font-weight:650}dd{margin:0}.timeline{padding-left:22px}.timeline li{padding:8px 0}footer{padding:24px 32px;background:var(--black);color:var(--cream);font-size:13px}dialog{border:0;border-radius:12px;background:var(--black);color:var(--cream);max-width:95vw;max-height:94vh;padding:20px}dialog::backdrop{background:#050505d9}dialog img{display:block;max-width:85vw;max-height:75vh;object-fit:contain;margin-top:12px}:focus-visible{outline:3px solid #41502e;outline-offset:4px}header :focus-visible,aside :focus-visible{outline-color:var(--cream)}body[data-mode=application] .workspace,body[data-mode=activation] .workspace{grid-template-columns:1fr;max-width:850px;margin:auto}body[data-mode=application] aside,body[data-mode=activation] aside{display:none}body[data-mode=profile] nav,body[data-mode=dispensing] nav{display:none}@media(max-width:800px){header{padding:20px;display:block}nav{margin-top:16px}main{padding:18px 16px 30px}.workspace{grid-template-columns:1fr;gap:18px}aside{position:static;max-height:none;padding:20px}#detail{padding:22px}.grid{grid-template-columns:1fr}h1{font-size:25px}dl{grid-template-columns:1fr;gap:4px}dd{margin-bottom:10px}}\n\n.message-preview,.invitation-preview pre,.card pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit;padding:16px;background:#f7f6f1;border-radius:6px}.card{overflow-wrap:anywhere}.attention h3{color:var(--cream)}\n" }, "/clinical-assets/partners/finance-client.mjs": { "type": "text/javascript; charset=utf-8", "body": "const node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};\nconst money=p=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(p/100);\nconst notice=document.getElementById('notice'),detail=document.getElementById('detail'),left=document.getElementById('left');\nasync function refresh(){\n detail.replaceChildren();left.replaceChildren(node('h2','Payment adjustments'));\n const r=await fetch('https://api.shiftsometimber.co.uk/v1/hq/clinical/prescriptions/finance',{credentials:'include',cache:'no-store'});\n if(!r.ok){notice.textContent=r.status===401?'Sign in to HQ to review payment adjustments.':r.status===403?'This view requires owner/admin access with MFA.':'Payment adjustment records are unavailable.';return;}\n const data=await r.json();notice.textContent='Review the current payment record before approving any refund or collecting an extra amount.';\n detail.append(node('h2','Prescription payment adjustments'),node('p','These are review tasks. No refund or additional charge has been executed by this workflow.'));\n if(!data.tasks.length){detail.append(node('p','No payment adjustments recorded.'));return;}\n const wrap=node('div');wrap.style.overflowX='auto';const table=node('table'),head=node('tr');for(const title of ['Order','Proposal version','Action','Amount','Status','Created'])head.append(node('th',title));table.append(head);\n for(const task of data.tasks){const row=node('tr');for(const value of [task.order_number,task.request_version,task.kind.replaceAll('_',' '),money(task.amount_pence),task.status.replaceAll('_',' '),new Date(task.created_at).toLocaleString('en-GB')])row.append(node('td',String(value)));table.append(row);}wrap.append(table);detail.append(wrap);\n}\ndocument.getElementById('refresh').addEventListener('click',()=>refresh().catch(()=>notice.textContent='Payment adjustment records are unavailable.'));refresh().catch(()=>notice.textContent='Payment adjustment records are unavailable.');\nwindow.addEventListener('pagehide',()=>{detail.replaceChildren();left.replaceChildren();notice.textContent='';});\n" }, "/clinical-assets/partners/demo-client.mjs": { "type": "text/javascript; charset=utf-8", "body": "import {demoFetch as fetch} from '/clinical-assets/partners/demo.mjs';\nconst API='https://api.shiftsometimber.co.uk/v1/hq/clinical/partners';\nconst mode=document.body.dataset.mode,demo=document.body.dataset.demo==='true';\nconst $=id=>document.getElementById(id),el=(t,s)=>{const n=document.createElement(t);if(s!==undefined)n.textContent=s;return n;},pretty=s=>String(s||'').replaceAll('_',' ');\nconst detail=$('detail'),left=$('selectors'),notice=$('notice');let selected=null,version=0,serial=0,media=[],busy=false,applicationToken='',internalSetup=false;\nif(['application','activation'].includes(mode)){applicationToken=location.hash.slice(1);history.replaceState(null,'',location.pathname);}\nfunction clear(){serial++;selected=null;detail.replaceChildren();left.replaceChildren();for(const u of media)URL.revokeObjectURL(u);media=[];$('viewer').close();$('viewer').querySelector('img').removeAttribute('src');}\nasync function api(path='',data,headers={}){\n const response=await fetch(API+path,{method:data===undefined?'GET':'POST',credentials:'include',cache:'no-store',headers:{...data!==undefined&&!(data instanceof File)?{'Content-Type':'application/json'}:{},...applicationToken&&mode==='application'?{'X-Application-Token':applicationToken}:{},...headers},body:data===undefined?undefined:data instanceof File?data:JSON.stringify(data)});\n if(response.status===401||response.status===403){clear();}\n if(!response.ok){let b;try{b=await response.json();}catch{}throw Error(pretty(b?.error||'Service unavailable'));}\n return response.json();\n}\nfunction button(label,fn){const n=el('button',label);n.type='button';n.onclick=async()=>{if(busy)return;busy=true;n.disabled=true;try{await fn();}catch(e){notice.textContent=e.message;}finally{busy=false;if(n.isConnected)n.disabled=false;}};return n;}\nfunction field(form,name,label,type='text',value='',options){const l=el('label',label),n=el(options?'select':type==='textarea'?'textarea':'input');n.name=name;n.setAttribute('aria-label',label);if(n.tagName==='INPUT')n.type=type;if(options)for(const v of options){const o=el('option',pretty(v));o.value=v;n.append(o);}n.value=value;n.required=true;l.append(n);form.append(l);return n;}\nfunction fold(title){const d=el('details');d.append(el('summary',title));detail.append(d);return d;}\nfunction info(host,items){const dl=el('dl');for(const [k,v]of items){dl.append(el('dt',k),el('dd',v||'Not provided'));}host.append(dl);}\nfunction form(host,title,fields,submitLabel,submit){const f=el('form');f.append(el('h3',title));for(const x of fields)field(f,...x);f.onsubmit=e=>e.preventDefault();f.append(button(submitLabel,()=>{if(f.reportValidity())return submit(Object.fromEntries(new FormData(f)));}));host.append(f);return f;}\nasync function refresh(){const n=++serial;selected=null;detail.replaceChildren();left.replaceChildren();\n if(mode==='activation'){activation();return;}\n if(mode==='login'){login();return;}\n if(mode==='application'){const s=await api('/application');if(n===serial)drawStaff(s,true);return;}\n if(mode==='profile'){const s=await api('/me');if(n===serial)drawStaff(s,false,true);return;}\n if(mode==='dispensing'){const d=await api('/fulfilment');if(n!==serial)return;if(d.oversight)notice.textContent='Live HQ oversight \xB7 read-only dispensing queue. Clinical prescribing, pharmacy supply and messaging remain separately controlled.';for(const o of d.orders){const b=button(o.orderNumber,()=>openOrder(o.orderNumber));b.className='record';b.append(el('span',o.memberReplyReceived?'Member replied \xB7 '+pretty(o.status):pretty(o.status)));left.append(b);}if(!d.orders.length)left.append(el('p','No assigned orders.'));detail.append(el('h2',d.oversight?'Dispensing oversight':'Your dispensing queue'),el('p','Only confirmed prescription handovers appear here. Clinical approval alone does not create a dispensing order.'));return;}\n const d=await api();if(n!==serial)return;internalSetup=d.capabilities.internalSetupOnly===true;if(internalSetup)notice.textContent='Internal preparation: partner organisations, professional profiles and invitation drafts are saved on the server. Sending invitations, uploads, verification, activation and patient access remain closed.';const filter=el('select');filter.setAttribute('aria-label','Filter people');for(const v of ['all','clinician','dispensing']){const o=el('option',pretty(v));o.value=v;filter.append(o);}left.append(filter);const list=el('div');left.append(list);\n const draw=()=>{list.replaceChildren();for(const s of d.staff.filter(s=>filter.value==='all'||filter.value===s.kind)){const b=button(s.name,()=>openStaff(s.id));b.className='record';b.dataset.id=s.id;const badge=el('span',pretty(s.status));badge.className='badge';b.append(el('small',pretty(s.kind)),badge);b.setAttribute('aria-pressed',String(selected===s.id));list.append(b);}if(!list.children.length)list.append(el('p','No applications in this view.'));};filter.onchange=draw;draw();const clinicians=button('Clinicians & GPs \xB7 '+d.staff.filter(s=>s.kind==='clinician').length,()=>{filter.value='clinician';draw();});clinicians.className='record';left.prepend(clinicians);\n detail.append(el('h2','People & partners'),el('p','One restricted professional profile, with independent verification and role-specific permissions. No patient records are available in this directory.'));\n if(d.capabilities.administrator){const orgs=(await api('/organisations')).organisations;if(n!==serial)return;\n  const setup=el('section');setup.className='card';setup.setAttribute('aria-label','Provider assignments');setup.append(el('h3','Provider setup'));info(setup,[['Prescribing clinician / GP',d.providerAssignments?.prescribingClinicianOrGP?.displayName||'TBC'],['Dispensing pharmacy',d.providerAssignments?.dispensingPharmacy?.displayName||'TBC']]);setup.append(el('p','TBC means unassigned\u2014not an approved provider or an active account. You can prepare the workflow while these appointments are being finalised.'));detail.append(setup);\n  const banner=el('section');banner.className='attention';banner.append(el('h3','Clinicians & GPs'),el('p','Verified prescribers review cases and sign prescriptions within their approved treatment scope. Dispensing permissions are managed separately.'),button('Invite clinician',()=>inviteForm('clinician',orgs)));detail.append(banner);const invites=el('div');invites.className='actions';invites.append(button('Invite partner',()=>inviteForm('partner',orgs)));detail.append(invites);\n  const drafts=fold('Prepared invitations \xB7 not sent');drafts.append(button('View invitation drafts',async()=>{const saved=await api('/invitations');for(const draft of saved.drafts)drafts.append(button(pretty(draft.kind)+' \xB7 '+draft.recipient_name+' \xB7 not sent',()=>showInvitation({draft})));if(!saved.drafts.length)drafts.append(el('p','No prepared invitations yet.'));}));\n  const h=fold('Create partner organisation');form(h,'Organisation details',[['kind','Organisation type','text','clinical',['clinical','pharmacy']],['name','Legal / pharmacy name'],['registration','Organisation or premises registration reference'],['premises','Registered address','textarea'],['superintendent','Superintendent / clinical governance contact'],['contact','Professional contact email or phone']],'Save partner',async b=>{await api('/organisations',b);await refresh();});\n  const partners=fold('Partner organisations & verification');for(const o of orgs){const card=el('div');card.className='card';card.append(el('h3',o.name),el('p',pretty(o.kind)+' \xB7 '+pretty(o.status||'pending')),el('p','Registration: '+o.registration));form(card,'Partner approval',[['action','Action','text','approve',['approve','suspend']],['verificationReference','Verified premises/provider registration, agreement and due-diligence reference','textarea'],['expiresAt','Partner review / expiry','date']],'Record partner decision',async b=>{await api('/organisations/'+o.id,{...b,version:o.version,expiresAt:new Date(b.expiresAt+'T23:59:59.000Z').toISOString()});await refresh();});partners.append(card);}\n  const f=el('form');f.append(el('h3',internalSetup?'Prepare a draft professional record':'Start a staff application'));field(f,'kind','Staff role','text','clinician',['clinician','dispensing']);const select=field(f,'orgId','Partner organisation','text','',orgs.map(o=>o.id));for(const o of select.options)o.textContent=orgs.find(x=>x.id===o.value)?.name||o.value;field(f,'name','Full legal name');field(f,'email','Professional email','email');f.onsubmit=e=>e.preventDefault();f.append(button(internalSetup?'Save draft professional':'Create application',async()=>{if(f.reportValidity()){const s=await api('',Object.fromEntries(new FormData(f)));await refresh();await openStaff(s.id);}}));detail.append(f);\n }\n}\nfunction showInvitation(d){const s=d.draft,card=el('div');card.className='card invitation-preview';card.append(el('h2','Invitation prepared \xB7 not sent'),el('p','To: '+s.recipient_name+' <'+s.recipient_email+'>'),el('p','CC: None \xB7 BCC: None \xB7 Attachments: None'),el('h3',s.subject),el('pre',s.body),el('p','Held until professional onboarding opens. No setup link, account or prescribing permission has been granted. Draft reference: '+s.id));detail.prepend(card);notice.textContent='Invitation draft saved and audited. Not sent. No access granted.';card.scrollIntoView({block:'nearest'});}\nfunction inviteForm(kind,orgs){const available=orgs.filter(o=>kind!=='clinician'||o.kind==='clinical');detail.replaceChildren(el('h2',kind==='clinician'?'Invite clinician / GP':'Invite partner'),el('p','Prepare a named invitation for review. Onboarding remains closed; this does not send an email or activate an account.'));\n if(!available.length){detail.append(el('p','Save a '+(kind==='clinician'?'clinical ':'')+'partner organisation first using Create partner organisation on the overview.'));return;}\n const f=el('form'),org=field(f,'orgId','Partner organisation','text','',available.map(o=>o.id));for(const o of org.options)o.textContent=available.find(x=>x.id===o.value).name;field(f,'name','Full name');field(f,'email','Professional email','email');if(kind==='clinician')field(f,'profession','Professional role','text','GP',['GP','Doctor / independent prescriber','Pharmacist independent prescriber','Nurse independent prescriber','Other qualified independent prescriber']);f.onsubmit=e=>e.preventDefault();f.append(button('Prepare invitation draft',async()=>{if(!f.reportValidity())return;const b=Object.fromEntries(new FormData(f));let payload={kind,orgId:b.orgId,name:b.name,email:b.email};if(kind==='clinician'){let s=await api('',{kind:'clinician',orgId:b.orgId,name:b.name,email:b.email});s=await api('/'+s.id+'/action',{version:s.version,action:'details',details:{profession:b.profession}});payload={kind,orgId:s.orgId,staffId:s.id,profileVersion:s.version};}showInvitation(await api('/invitations',payload));}));detail.append(f);\n}\nasync function openStaff(id){const n=++serial;for(const u of media)URL.revokeObjectURL(u);media=[];selected=id;detail.replaceChildren();const s=await api('/'+id);if(n!==serial)return;drawStaff(s);for(const b of left.querySelectorAll('[data-id]'))b.setAttribute('aria-pressed',String(b.dataset.id===id));}\nasync function action(b){const id=selected,s=await api('/'+(mode==='application'?'application':id)+'/action',{version,...b});if(selected!==id)return;drawStaff(s,mode==='application');notice.textContent='Saved and audited. No message was sent.';}\nfunction drawStaff(s,app=false,readonly=false){selected=s.id;version=s.version;detail.replaceChildren();detail.append(el('h2',s.details.name),el('p',pretty(s.kind)+' \xB7 '+pretty(s.status)+' \xB7 Revision '+s.version));\n const bio=el('div');bio.className='card';info(bio,[['Username',s.username||'Generated after approval'],['Partner',s.orgId],['Professional registration',(s.details.regulator||'')+' '+(s.details.registrationNumber||'')],['Prescribing entitlement',s.details.prescribingEntitlement],['Access',s.status==='active'?'Subject to current credentials, MFA and scope checks':'No patient access']]);detail.append(bio);\n if(internalSetup)detail.append(el('p','Draft internal record only. Do not upload identity documents or treat this as professional approval. Invitation drafts can be prepared, but no sending or patient access is enabled.'));\n if(s.kind==='clinician'&&!app&&!readonly&&['draft','submitted','checks_underway','more_information'].includes(s.status))detail.append(button('Invite clinician',async()=>showInvitation(await api('/invitations',{kind:'clinician',orgId:s.orgId,staffId:s.id,profileVersion:s.version}))));\n if(s.applicationMessage)detail.append(el('p','Application update: '+s.applicationMessage));\n if(!readonly&&['draft','submitted','checks_underway','more_information'].includes(s.status)){\n  const host=fold('Application details');const f=el('form');for(const [k,label,type]of [['name','Full legal name'],['email','Professional email','email'],['professionalContact','Professional phone / contact'],['profession','Profession'],['regulator','Regulator'],['registrationNumber','Registration number'],['prescribingEntitlement','Licence / prescribing annotation or role'],['experience','Relevant experience and treatment competence','textarea'],['indemnityProvider','Indemnity provider'],['policyReference','Indemnity policy reference']])field(f,k,label,type||'text',s.details[k]||'');f.onsubmit=e=>e.preventDefault();f.append(button('Save application details',()=>f.reportValidity()&&action({action:'details',details:Object.fromEntries(new FormData(f))})));host.append(f);\n }\n const docs=fold('Identity, selfie & compliance documents');docs.append(el('p','Restricted verification evidence. No automatic identity decision is made.'));for(const kind of ['photo_id','selfie','indemnity','qualification','agreement']){\n  const latest=s.evidence.filter(e=>e.kind===kind).at(-1),row=el('div');row.className='card';row.append(el('h3',pretty(kind)),el('p',latest?'Uploaded '+new Date(latest.uploadedAt).toLocaleDateString('en-GB')+' \xB7 retention review '+new Date(latest.retentionUntil).toLocaleDateString('en-GB'):'Not uploaded'));\n  if(latest&&!readonly&&!internalSetup)row.append(button('View / enlarge',()=>viewImage(s.id,latest.id)));\n  if(!readonly&&!internalSetup&&['draft','submitted','more_information'].includes(s.status)){const input=el('input');input.type='file';input.accept='image/png,image/jpeg';input.setAttribute('aria-label','Upload '+pretty(kind));row.append(input,button('Upload image',async()=>{if(!input.files[0])throw Error('Choose a PNG or JPEG image.');const uploaded=await api('/'+(app?'application':s.id)+'/evidence',input.files[0],{'Content-Type':input.files[0].type,'X-Evidence-Kind':kind,'X-Profile-Version':String(version)});drawStaff(uploaded,app);notice.textContent='Upload saved securely. Existing verification must be reviewed again.';}));}docs.append(row);\n }\n if(!readonly&&!internalSetup){const controls=el('div');controls.className='actions';if(['draft','more_information'].includes(s.status))controls.append(button('Submit application & declaration',()=>action({action:'submit',declaration:true})));if(!app){controls.append(button('Create application link',async()=>{const d=await api('/'+s.id+'/link',{});showLink(d);}),button('Prepare password setup',async()=>{const d=await api('/'+s.id+'/credentials',{});showLink(d);await openStaff(s.id);}));}detail.append(controls);}\n const checks=fold('Verification checks');for(const c of s.checks)checks.append(el('p',pretty(c.kind)+' \xB7 '+pretty(c.outcome)+' \xB7 checked by '+c.reviewedBy+' \xB7 valid until '+new Date(c.expiresAt).toLocaleDateString('en-GB')));\n if(!app&&!readonly&&!internalSetup){form(checks,'Record an independent check',[['kind','Check','text','identity',['identity','registration','indemnity','agreements','competence']],['outcome','Outcome','text','verified',['verified','rejected']],['source','Evidence source and verification reference','textarea'],['expiresAt','Next review / expiry','date']],'Save verification',b=>action({action:'check',...b,expiresAt:new Date(b.expiresAt+'T23:59:59.000Z').toISOString()}));}\n const scopes=fold('Approved areas & permissions');for(const g of s.grants){const card=el('div');card.className='card';card.append(el('h3',pretty(g.area)),el('p',g.actions.map(pretty).join(' \xB7 ')),el('p','Medicines: '+(g.medicines.join(', ')||'All within this approved scope')),el('p','Restrictions: '+g.restrictions),el('p','Approver '+g.approvedBy+' \xB7 expires '+new Date(g.expiresAt).toLocaleDateString('en-GB')+(g.revokedAt?' \xB7 REVOKED':'')));if(!app&&!readonly&&!g.revokedAt)card.append(button('Revoke permission',()=>action({action:'revoke_grant',grantId:g.id,reason:'Revoked through HQ scope management'})));scopes.append(card);}\n if(!app&&!readonly&&!internalSetup){scopes.append(el('p','Scope approval requires a separately designated qualified clinical/pharmacy reviewer. HQ ownership alone does not grant this authority.'));const f=el('form');field(f,'area','Service area','text','weight_management',['weight_management','testosterone','sexual_health','other']);for(const name of s.kind==='clinician'?['review','query','clinical_decision','issue_prescription']:['view_fulfilment','query','supply_decision','prepare','dispatch','record_delivery','record_exception','cancel_supply']){const l=el('label',pretty(name)),c=el('input');c.type='checkbox';c.name='permission';c.value=name;l.prepend(c);f.append(l);}field(f,'medicines','Allowed medicines, one per line (leave empty only for unrestricted scope)','textarea').required=false;field(f,'restrictions','Clinical restrictions / operating limits','textarea');field(f,'approvalReference','Competence approval reference');field(f,'expiresAt','Permission review / expiry','date');f.onsubmit=e=>e.preventDefault();f.append(button('Record professional scope approval',()=>{if(f.reportValidity()){const b=Object.fromEntries(new FormData(f));return action({action:'grant',...b,actions:[...f.querySelectorAll('[name=permission]:checked')].map(n=>n.value),medicines:b.medicines.split('\\n').map(v=>v.trim()).filter(Boolean),expiresAt:new Date(b.expiresAt+'T23:59:59.000Z').toISOString()});}}));scopes.append(f);}\n if(!app&&!readonly){const h=fold('HQ approval & account controls');if(!internalSetup)h.append(button('Approve application',()=>action({action:'approve'})),button('Activate after password & MFA setup',()=>action({action:'activate'})));form(h,'Request information / reject / suspend / renew',[['action','Action','text','query',(internalSetup?['query','reject','suspend']:['query','reject','suspend','renew'])],['message','Reason / information required','textarea']],'Record action',b=>action({...b,reason:b.message}));const audit=fold('Audit history');audit.append(button('Load audit trail',async()=>{const n=serial,d=await api('/'+s.id+'/audit');if(n!==serial)return;const list=el('ol');list.className='timeline';for(const e of d.events)list.append(el('li',new Date(e.created_at).toLocaleString('en-GB')+' \xB7 '+pretty(e.action)+' \xB7 '+e.actor_id));audit.append(list);}));}\n}\nfunction showLink(d){notice.replaceChildren(el('span','Secure setup link prepared, not sent. Expires '+new Date(d.expiresAt).toLocaleString('en-GB')+': '));const a=el('a',d.link);a.href=d.link;notice.append(a);}\nasync function viewImage(id,evidenceId){\n if(demo){notice.textContent='Fictional evidence placeholder only\u2014no real ID is stored in this demonstration.';return;}\n const r=await fetch(API+'/'+(mode==='application'?'application':id)+'/evidence/'+evidenceId,{credentials:'include',cache:'no-store',headers:applicationToken?{'X-Application-Token':applicationToken}:{}});if(!r.ok){if([401,403].includes(r.status))clear();throw Error('Evidence unavailable or access expired.');}const u=URL.createObjectURL(await r.blob());media.push(u);$('viewer').querySelector('img').src=u;$('viewer').showModal();\n}\nasync function openOrder(order){const n=++serial;selected=order;detail.replaceChildren();const d=await api('/fulfilment/'+encodeURIComponent(order));if(n!==serial)return;const o=d.order;version=o.version;detail.append(el('h2',o.orderNumber),el('p',pretty(o.status)+' \xB7 updated '+new Date(o.updatedAt).toLocaleString('en-GB')));const card=el('div');card.className='card';info(card,[['Prescription',o.prescriptionId],['Medicine',o.medicine],['Strength',o.treatment?.strength],['Prescribed dose',o.treatment?.dose],['Quantity',o.quantity],['Directions',o.directions],['Member',o.patient?.name],['Delivery',o.delivery?.address]]);detail.append(card);if(d.prescription){const rx=el('section');rx.className='card';rx.append(el('h3','Signed prescription'));const p=d.prescription.document;info(rx,[['Prescription date',p.issuedOn],['Prescriber',p.prescriber.name],['Registration',p.prescriber.registrationBody+' '+p.prescriber.registrationNumber],['Practice',p.prescriber.practiceAddress],['Member',p.patient.name],['DOB',p.patient.dateOfBirth],['Address',p.patient.address+' '+p.patient.postcode],['Medicine',p.treatment.medicine+' '+p.treatment.strength],['Dose',p.treatment.dose],['Quantity',p.treatment.quantity],['Route',p.treatment.route],['Directions',p.treatment.directions],['Prescription integrity reference',d.prescription.digest]]);if(!d.prescription.current)rx.append(el('strong','Hold supply: this prescription needs a currentness review.'));detail.append(rx);}if(o.tracking){const a=el('a','Track delivery');if(/^https:\\/\\/(www\\.royalmail\\.com|track\\.dpd\\.co\\.uk)\\//.test(o.tracking.url)){a.href=o.tracking.url;a.rel='noopener noreferrer';a.target='_blank';detail.append(a);}}\n if(!d.oversight&&o.memberReply){const response=el('div');response.className='card';response.append(el('h3','Member response'),el('p',o.memberReply.message),el('p','Received '+new Date(o.memberReply.createdAt).toLocaleString('en-GB')));detail.append(response);}\n if(!d.oversight){const f=el('form');field(f,'message','Reason or question (required for query/rejection)','textarea').required=false;field(f,'carrier','Courier','text','royal_mail',['royal_mail','dpd']);field(f,'trackingNumber','Tracking number').required=false;const controls=el('div');controls.className='actions';for(const [action,label]of [['accept','Accept prescription'],['query','Query'],['reject','Reject supply'],['prepare','Start dispensing'],['dispatch','Confirm dispatch'],['delivered','Record delivery'],['delivery_exception','Record delivery issue'],['returned','Record return'],['cancel','Cancel supply']].filter(([a])=>({accept:['received','query'],query:['received','accepted','preparing'],reject:['received','query','accepted','preparing'],prepare:['accepted'],dispatch:['preparing'],delivered:['dispatched','delivery_exception'],delivery_exception:['dispatched'],returned:['dispatched','delivery_exception','delivered'],cancel:['received','query','accepted','preparing']})[a].includes(o.status)))controls.append(button(label,async()=>{await api('/fulfilment/'+encodeURIComponent(order)+'/action',{version,action,...Object.fromEntries(new FormData(f))});await openOrder(order);notice.textContent='Order update recorded. Notification is a draft\u2014not sent.';}));f.append(controls);f.onsubmit=e=>e.preventDefault();detail.append(f);}\n const h=fold('Order history & audit');const list=el('ol');list.className='timeline';for(const e of d.events)list.append(el('li',new Date(e.created_at).toLocaleString('en-GB')+' \xB7 '+pretty(e.action)+' \xB7 '+e.actor_id));h.append(list);detail.append(el('p','Prescription issue, pharmacy acceptance and dispatch are separate confirmations. No stock means preparation/dispatch are blocked.'));\n}\nfunction activation(){detail.replaceChildren();detail.append(el('h2','Set your own password'),el('p','This link is single-use and expires. HQ never sees your password.'));form(detail,'Password setup',[['password','New password (15\u2013128 characters)','password']],'Create password',async b=>{const d=await api('/activation',{token:applicationToken,password:b.password});applicationToken='';detail.replaceChildren(el('h2','Password created'),el('p','Your username: '+d.username),el('p',d.next));});}\nfunction login(){\n detail.replaceChildren();detail.append(el('h2','Sign in with your allocated username'));\n async function signedIn(d){\n  detail.replaceChildren();\n  if(d.mfaRequired){form(detail,'Authenticator check',[['code','Six-digit authenticator code']],'Verify code',async b=>signedIn(await api('/login/verify',{challenge:d.challenge,code:b.code})));return;}\n  if(!d.user?.mfaEnabled){\n   const r=await fetch('https://api.shiftsometimber.co.uk/v1/hq/mfa/setup',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:'{}'});if(!r.ok)throw Error('HQ MFA setup is unavailable. Contact your administrator.');const setup=await r.json();\n   detail.append(el('h2','Set up your authenticator'),el('p','Add a time-based code account to your authenticator using this setup key. It is shown only during setup.'),el('code',setup.secret));\n   form(detail,'Confirm setup',[['code','Six-digit authenticator code']],'Enable MFA',async b=>{const r=await fetch('https://api.shiftsometimber.co.uk/v1/hq/mfa/enable',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify(b)});if(!r.ok)throw Error('The code could not be verified.');detail.replaceChildren(el('h2','MFA enabled'),el('p','HQ must activate your approved permissions before patient access.'));});return;\n  }\n  detail.append(el('h2','Signed in'),el('p','Your approved permissions are checked separately on every request.'));const link=el('a','Open my professional profile');link.href='/clinical-portal/my-profile';detail.append(link);\n }\n form(detail,'Professional account',[['username','System-generated username'],['password','Password','password']],'Sign in',async b=>signedIn(await api('/login',b)));\n}\n$('refresh').onclick=()=>refresh().catch(e=>notice.textContent=e.message);$('reset')?.addEventListener('click',()=>location.reload());$('close-viewer').onclick=()=>{$('viewer').close();$('viewer').querySelector('img').removeAttribute('src');for(const u of media)URL.revokeObjectURL(u);media=[];};\nwindow.addEventListener('pagehide',()=>{applicationToken='';clear();});window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});refresh().catch(e=>notice.textContent=e.message);\n" } };

// portal-release-worker.mjs
var origin2 = "https://hq.shiftsometimber.co.uk";
var headers = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
async function existingHqIdentity(request, env, fetchImpl = env.HQ_AUTH?.fetch.bind(env.HQ_AUTH)) {
  if (!fetchImpl) throw Error("HQ authentication binding unavailable");
  const forwarded = new Headers();
  for (const name of ["cookie", "authorization"]) if (request.headers.has(name)) forwarded.set(name, request.headers.get(name));
  forwarded.set("Origin", origin2);
  const response2 = await fetchImpl(new Request("https://api.shiftsometimber.co.uk/v1/hq/me", { headers: forwarded, redirect: "manual" }));
  if (!response2.ok) return { response: new Response(JSON.stringify({ error: response2.status === 401 ? "hq_sign_in_required" : "hq_authentication_unavailable" }), { status: response2.status === 401 ? 401 : 503, headers: { ...headers, "Content-Type": "application/json", "Access-Control-Allow-Origin": origin2, "Access-Control-Allow-Credentials": "true", "Vary": "Origin" } }) };
  return response2.json();
}
__name(existingHqIdentity, "existingHqIdentity");
var portal_release_worker_default = { async fetch(request, env) {
  const url = new URL(request.url);
  if (url.hostname === "api.shiftsometimber.co.uk" && (url.pathname === "/v1/hq/clinical" || url.pathname.startsWith("/v1/hq/clinical/"))) {
    const prescribing = await prescriptionHqRoute(request, { ...env, PRESCRIPTION_WORKFLOW_ENABLED: "true", CLINICAL_CASEWORK_ENABLED: "false", CLINICAL_REVIEW_READY: "false", PRESCRIPTION_SIGNING_ENABLED: "false" }, existingHqIdentity);
    if (prescribing) return prescribing;
    const internal = await commissioningRoute(request, env, existingHqIdentity);
    if (internal) return internal;
    const notifications = await notificationManagementRoute(request, { ...env, NOTIFICATION_EVENTS_ENABLED: "true" }, existingHqIdentity);
    if (notifications) return notifications;
    const partner = await partnerRoute(request, { ...env, NOTIFICATION_EVENTS_ENABLED: "true", PARTNER_OPERATIONS_ENABLED: "true", PARTNER_INTERNAL_SETUP_ONLY: "true", PARTNER_NOTIFICATION_REVIEW_ENABLED: "true", PRESCRIPTION_WORKFLOW_ENABLED: "true", PARTNER_LOGIN_ENABLED: "false", PARTNER_FULFILMENT_ENABLED: "false" }, existingHqIdentity, internalDispensingAdapters({ ...env, PRESCRIPTION_SIGNING_ENABLED: "false" }));
    if (partner) return partner;
    const closed = { ...env, CLINICAL_CASEWORK_ENABLED: "false", CLINICAL_REVIEW_READY: "false", CLINICAL_CONTEXT_ENABLED: "false" };
    return hqClinicalRoute(request, closed, existingHqIdentity);
  }
  if (url.hostname !== new URL(origin2).hostname) return new Response("Not found", { status: 404, headers });
  if (!["GET", "HEAD"].includes(request.method)) return new Response("Method not allowed", { status: 405, headers });
  const isDemo = url.pathname === "/clinical-portal/demo";
  const demoShell = shell.replace("Clinical casework is awaiting commissioning.", "Interactive clinician demo \xB7 fictional information only.").replace("/clinical-assets/client.mjs", "/clinical-assets/demo-client.mjs").replace("The portal is deployed. Real-patient review, prescribing, AI identity verification and automatic notifications remain switched off.", "This is a fictional demonstration. No real orders, messages or prescriptions are created.").replace("Use your existing HQ sign-in. Clinical access will require a verified clinician account and assigned cases after commissioning.", "The fictional clinician workspace opens automatically. Use Reset demo to start again.");
  const partnerPage = pages[url.pathname];
  const body2 = partnerPage || assets2[url.pathname] || (isDemo ? { type: "text/html; charset=utf-8", body: demoShell } : url.pathname === "/clinical-portal" || url.pathname === "/clinical-portal/" ? { type: "text/html; charset=utf-8", body: shell } : assets[url.pathname]);
  if (!body2) return new Response("Not found", { status: 404, headers });
  return new Response(request.method === "HEAD" ? null : body2.body, { headers: { ...headers, "Content-Type": body2.type, "Content-Security-Policy": isDemo || partnerPage?.demo ? "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'none'; img-src 'self' blob: data:; frame-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'" : "default-src 'none'; script-src 'self'; style-src 'self'; connect-src https://api.shiftsometimber.co.uk; img-src 'self' blob:; frame-src blob:; base-uri 'none'; form-action 'none'; frame-ancestors 'none'", "Permissions-Policy": "camera=(), microphone=(), geolocation=()", "X-Frame-Options": "DENY" } });
} };
export {
  portal_release_worker_default as default,
  existingHqIdentity
};
//# sourceMappingURL=portal-release-worker.js.map
