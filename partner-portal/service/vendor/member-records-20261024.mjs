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
function memberDecision(previous, input, memberId, date) {
  if (!previous || previous.memberId !== memberId) fail(404, "prescription_not_found");
  if (input.version !== previous.version) fail(409, "prescription_changed");
  if (!["awaiting_member", "member_question", "accepted", "clinician_query"].includes(previous.status)) fail(409, "proposal_not_open");
  if (input.action === "accept" && (previous.status !== "awaiting_member" || previous.expiresAt <= date)) fail(409, "proposal_not_open");
  const s = structuredClone(previous);
  s.version++;
  s.updatedAt = date;
  if (input.action === "accept") {
    if (input.agreed !== true) fail(422, "explicit_treatment_and_price_agreement_required");
    s.status = "accepted";
    s.acceptance = { memberId, proposalVersion: previous.version, at: date };
    s.question = null;
  } else if (input.action === "cancel") {
    s.status = "cancelled";
    s.acceptance = null;
    s.cancelledAt = date;
  } else if (input.action === "question") {
    s.status = "member_question";
    s.acceptance = null;
    s.question = { message: text(input.message, 2e3), at: date };
  } else fail(422, "accept_cancel_or_question_required");
  return s;
}
__name(memberDecision, "memberDecision");
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
  const guard = sources[event.source];
  if (!guard) throw Error("unsupported_notification_source");
  const id = event.id, link = "/member/treatment-records?record=" + record.id;
  const out = [q(env, "INSERT OR IGNORE INTO clinical_notification_events SELECT ?,?,?,?,?,?,?,?,? WHERE " + guard[0] + " AND EXISTS(SELECT 1 FROM clinical_member_records WHERE id=? AND user_id=?)", id, record.user_id, record.id, record.order_number || null, event.kind, content.title, content.body, link, event.at, ...guard[1], record.id, record.user_id)];
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
  const fail5 = /* @__PURE__ */ __name((k) => {
    throw Object.assign(Error("handover_required_" + k), { status: 422 });
  }, "fail");
  if (!input || input.version !== CARE_HANDOVER_VERSION) fail5("version");
  const out = { version: CARE_HANDOVER_VERSION };
  for (const [id, , type] of careFields) {
    const v = input[id];
    if (typeof v !== "string" || !v.trim() || v.length > 4e3 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) fail5(id);
    if (Array.isArray(type) && !type.includes(v)) fail5(id);
    if (type === "date" && !validDate(v)) fail5(id);
    out[id] = v.trim();
  }
  for (const [id] of careChecks) {
    if (input[id] !== true) fail5(id);
    out[id] = true;
  }
  if (out.consultedOn > today || out.verifiedOn > today) fail5("future_verification");
  if (out.followUpDate <= out.consultedOn || out.followUpDate <= today) fail5("follow_up_date");
  return out;
}
__name(validateCareHandover, "validateCareHandover");

// partner-operations/domain.mjs
var CHECKS = ["identity", "registration", "indemnity", "agreements", "competence"];
var fail2 = /* @__PURE__ */ __name((status, code) => {
  throw Object.assign(Error(code), { status });
}, "fail");
var text2 = /* @__PURE__ */ __name((v, max = 1e3) => {
  if (typeof v !== "string" || !v.trim() || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(v)) fail2(422, "valid_text_required");
  return v.trim();
}, "text");
function credentialsCurrent(s, now5) {
  return CHECKS.every((kind) => s.checks.some((c) => c.kind === kind && c.credentialVersion === s.credentialVersion && c.outcome === "verified" && c.expiresAt > now5));
}
__name(credentialsCurrent, "credentialsCurrent");
function permission(s, area, action, now5, medicine) {
  if (s.status !== "active" || !s.hqUserId || !credentialsCurrent(s, now5)) return false;
  return s.grants.some((g) => g.credentialVersion === s.credentialVersion && !g.revokedAt && g.area === area && g.actions.includes(action) && g.startsAt <= now5 && g.expiresAt > now5 && (!g.medicines.length || medicine && g.medicines.includes(medicine)));
}
__name(permission, "permission");
function memberTracking(s) {
  return { orderNumber: s.orderNumber, status: s.status, updatedAt: s.updatedAt, tracking: s.tracking || null, actionNeeded: s.status === "query" && !s.memberReply, prescriptionId: s.prescriptionId, deliveryUpdate: s.deliveryUpdate || null };
}
__name(memberTracking, "memberTracking");

// partner-operations/notification-review.mjs
function supersedeAnsweredQueryStatement(env, order, eventId) {
  if (env.PARTNER_NOTIFICATION_REVIEW_ENABLED !== "true") return [];
  return [env.DB.prepare("UPDATE clinical_case_outbox SET status='superseded' WHERE recipient_kind='member' AND recipient_user_id=? AND event_id=? AND status='pending' AND EXISTS(SELECT 1 FROM partner_audit WHERE id=?)").bind(order.memberId, order.queryId, eventId)];
}
__name(supersedeAnsweredQueryStatement, "supersedeAnsweredQueryStatement");

// partner-operations/member-fulfilment.mjs
var q2 = /* @__PURE__ */ __name((env, s, ...a) => env.DB.prepare(s).bind(...a), "q");
var rows = /* @__PURE__ */ __name(async (s) => (await s.all()).results || [], "rows");
var now2 = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "now");
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
async function sessionHash(request, env, memberId) {
  let checked = 0;
  for (const m of (request.headers.get("cookie") || "").matchAll(/(?:^|;\s*)sst_session=([^;]+)/g)) {
    if (++checked > 4) break;
    let token;
    try {
      token = decodeURIComponent(m[1]);
    } catch {
      continue;
    }
    const hash3 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), (b) => b.toString(16).padStart(2, "0")).join("");
    if (await q2(env, "SELECT 1 ok FROM user_sessions WHERE user_id=? AND token_hash=? AND revoked_at IS NULL AND julianday(expires_at)>julianday(?)", memberId, hash3, now2()).first()) return hash3;
  }
  fail2(401, "member_session_required");
}
__name(sessionHash, "sessionHash");
async function replyToFulfilment(request, env, record, actor, b) {
  if (env.PARTNER_MEMBER_REPLIES_ENABLED !== "true") fail2(503, "dispensing_replies_not_open");
  if (!record.order_number || record.user_id !== actor.id) fail2(404, "order_not_found");
  if (!b || !Number.isInteger(b.version) || typeof b.queryId !== "string") fail2(422, "version_and_query_required");
  if (Object.keys(b).some((k) => !["version", "queryId", "message"].includes(k))) fail2(422, "unknown_reply_field");
  const row = await q2(env, "SELECT state_json FROM partner_fulfilment WHERE order_number=? AND member_id=?", record.order_number, actor.id).first();
  if (!row) fail2(404, "order_not_found");
  const s = JSON.parse(row.state_json);
  if (s.version !== b.version || s.status !== "query" || s.queryId !== b.queryId || s.memberReply) fail2(409, "dispensing_query_changed");
  const date = now2(), message = text2(b.message, 2e3), hash3 = await sessionHash(request, env, actor.id), event = crypto.randomUUID(), next = { ...s, version: s.version + 1, updatedAt: date, memberReply: { queryId: s.queryId, message, createdAt: date } };
  const guard = " AND EXISTS(SELECT 1 FROM clinical_member_records WHERE id=? AND user_id=? AND order_number=?) AND EXISTS(SELECT 1 FROM user_sessions s JOIN user_auth a ON a.user_id=s.user_id WHERE s.user_id=? AND s.token_hash=? AND s.revoked_at IS NULL AND julianday(s.expires_at)>julianday(?) AND a.email_verified=1)";
  const result = await env.DB.batch([
    q2(env, "UPDATE partner_fulfilment SET state_json=?,version=?,updated_at=? WHERE order_number=? AND member_id=? AND version=?" + guard, JSON.stringify(next), next.version, date, s.orderNumber, actor.id, s.version, record.id, actor.id, s.orderNumber, actor.id, hash3, date),
    q2(env, "INSERT INTO partner_audit SELECT ?,?,?,(SELECT COALESCE(MAX(version),-1)+1 FROM partner_audit WHERE entity_type='order' AND entity_id=?),?,?,?,? WHERE changes()=1", event, "order", s.orderNumber, s.orderNumber, String(actor.id), "member_fulfilment_reply", JSON.stringify({ source: "member_portal", recordId: record.id, queryId: s.queryId, message, orderVersion: next.version }), date),
    ...supersedeAnsweredQueryStatement(env, s, event),
    ...await orderEventStatements(env, s, { id: event, action: "member_fulfilment_reply", at: date })
  ]);
  if (result[0].meta?.changes !== 1) fail2(409, "order_or_session_changed");
  return { saved: true, notificationStatus: "not_sent", fulfilment: await memberFulfilment(env, record) };
}
__name(replyToFulfilment, "replyToFulfilment");

// partner-operations/api.mjs
var now3 = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "now");
var query2 = /* @__PURE__ */ __name((env, sql, ...args) => env.DB.prepare(sql).bind(...args), "query");
var parse = /* @__PURE__ */ __name((row) => row ? JSON.parse(row.state_json) : null, "parse");
async function currentPartner(env, s, date = now3()) {
  const org = parse(await query2(env, "SELECT state_json FROM partner_organisations WHERE id=?", s.orgId).first());
  if (!org || org.status !== "approved" || org.expiresAt <= date || org.kind !== (s.kind === "clinician" ? "clinical" : "pharmacy")) fail2(403, "approved_current_partner_required");
  return org;
}
__name(currentPartner, "currentPartner");
async function clinicianPermission(env, actor, action = "review", medicine) {
  if (env.PARTNER_OPERATIONS_ENABLED !== "true") return null;
  const s = parse(await query2(env, "SELECT state_json FROM partner_staff WHERE hq_user_id=?", actor.id).first());
  if (!s || s.kind !== "clinician" || actor.role === "clinical" && actor.mfaEnabled !== true || !permission(s, "weight_management", action, now3(), medicine)) fail2(403, "clinical_scope_not_approved");
  const org = await currentPartner(env, s);
  return { staffId: s.id, version: s.version, organisationId: org.id, organisationVersion: org.version };
}
__name(clinicianPermission, "clinicianPermission");

// clinical-context.mjs
var CONTEXT_NOTICE = "clinical-app-sharing-v1";
var CONTEXT_SCOPES = ["weight", "doses", "symptoms"];
var fail3 = /* @__PURE__ */ __name((status, code) => {
  throw Object.assign(Error(code), { status });
}, "fail");
var rows2 = /* @__PURE__ */ __name(async (q3) => (await q3.all()).results, "rows");
var hash = /* @__PURE__ */ __name(async (value) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(JSON.stringify(value)))), (b) => b.toString(16).padStart(2, "0")).join(""), "hash");
async function contextSharing(env, record) {
  if (env.CLINICAL_CONTEXT_ENABLED !== "true") return { enabled: false, revision: 0, scopes: [], noticeVersion: CONTEXT_NOTICE };
  const row = await env.DB.prepare("SELECT * FROM clinical_context_sharing WHERE record_id=? ORDER BY revision DESC LIMIT 1").bind(record.id).first();
  return { enabled: true, revision: row?.revision || 0, scopes: row ? JSON.parse(row.scopes_json) : [], noticeVersion: CONTEXT_NOTICE, changedAt: row?.created_at || null };
}
__name(contextSharing, "contextSharing");
async function saveContextSharing(env, record, actor, b) {
  if (env.CLINICAL_CONTEXT_ENABLED !== "true") fail3(503, "clinical_context_not_open");
  if (actor.id !== record.user_id) fail3(404, "record_not_found");
  if (!b || Object.keys(b).some((k) => !["revision", "scopes", "noticeVersion"].includes(k)) || !Number.isInteger(b.revision) || b.noticeVersion !== CONTEXT_NOTICE || !Array.isArray(b.scopes) || b.scopes.some((s) => !CONTEXT_SCOPES.includes(s)) || new Set(b.scopes).size !== b.scopes.length) fail3(422, "invalid_sharing_choice");
  const at = (/* @__PURE__ */ new Date()).toISOString(), revision = b.revision + 1, scopes = CONTEXT_SCOPES.filter((s) => b.scopes.includes(s));
  const result = await env.DB.batch([
    env.DB.prepare("INSERT INTO clinical_context_sharing SELECT ?,?,?,?,?,? WHERE COALESCE((SELECT MAX(revision) FROM clinical_context_sharing WHERE record_id=?),0)=?").bind(record.id, revision, actor.id, JSON.stringify(scopes), CONTEXT_NOTICE, at, record.id, b.revision),
    env.DB.prepare("INSERT INTO clinical_member_audit SELECT ?,?,?,?, ?,? WHERE EXISTS(SELECT 1 FROM clinical_context_sharing WHERE record_id=? AND revision=? AND created_at=?)").bind(crypto.randomUUID(), record.id, actor.id, "app_sharing_changed", JSON.stringify({ actorKind: "member", revision, scopes, noticeVersion: CONTEXT_NOTICE }), at, record.id, revision, at)
  ]);
  if (Number(result[0].meta?.changes) !== 1) fail3(409, "sharing_changed");
  return contextSharing(env, record);
}
__name(saveContextSharing, "saveContextSharing");
async function columns(env, table) {
  return new Set((await rows2(env.DB.prepare("PRAGMA table_info(" + table + ")"))).map((c) => c.name));
}
__name(columns, "columns");
var has = /* @__PURE__ */ __name((set, names) => names.every((n) => set.has(n)), "has");
async function clinicalContext(env, record) {
  const sharing = await contextSharing(env, record);
  if (!sharing.enabled) return { enabled: false, sharing, orders: [], updates: [], sources: [], digest: null };
  const now5 = /* @__PURE__ */ new Date(), since = new Date(now5.getTime() - 90 * 864e5).toISOString(), until = now5.toISOString(), updates = [], sources = [];
  const orderColumns = await columns(env, "medicine_orders");
  let orders = [], orderSource = "unavailable";
  if (has(orderColumns, ["order_number", "user_id", "medicine_name", "strength_label", "status", "created_at"])) {
    orders = await rows2(env.DB.prepare("SELECT order_number,medicine_name,strength_label,status,created_at" + (orderColumns.has("clinical_status") ? ",clinical_status" : "") + " FROM medicine_orders WHERE user_id=? ORDER BY created_at DESC,order_number DESC LIMIT 201").bind(record.user_id));
    orderSource = "available";
  }
  const moreOrders = orders.length > 200;
  orders = orders.slice(0, 200).map((o) => ({ ...o, prescriptionStatus: "Issuance not verified in this system" }));
  const scopes = new Set(sharing.scopes), progress = await columns(env, "progress_entries");
  if (scopes.has("weight")) {
    if (has(progress, ["id", "user_id", "recorded_on", "weight_kg", "created_at"])) {
      const weights = await rows2(env.DB.prepare("SELECT id,recorded_on,weight_kg,created_at" + (progress.has("source") ? ",source" : "") + " FROM progress_entries WHERE user_id=? AND weight_kg IS NOT NULL AND recorded_on>=? AND recorded_on<=? ORDER BY recorded_on DESC,id DESC LIMIT 1001").bind(record.user_id, since.slice(0, 10), until.slice(0, 10)));
      sources.push({ name: "progress_entries", status: "available", truncated: weights.length > 1e3 });
      for (const r of weights.slice(0, 1e3)) updates.push({ id: "progress:" + r.id, kind: "weight", occurredAt: r.recorded_on, recordedAt: r.created_at, source: "My Timber weight log", reportedBy: r.source ? "recorded source " + r.source : "member", details: { weightKg: r.weight_kg } });
    } else sources.push({ name: "progress_entries", status: "unavailable" });
  }
  if (scopes.size) {
    const events = await columns(env, "member_treatment_events"), treatments = await columns(env, "member_treatment_records");
    if (has(events, ["id", "user_id", "treatment_id", "kind", "body_json", "source", "occurred_at", "created_at"]) && has(treatments, ["id", "user_id", "medicine"])) {
      const entries = await rows2(env.DB.prepare("SELECT e.id,e.kind,e.body_json,e.source,e.occurred_at,e.created_at,t.medicine FROM member_treatment_events e JOIN member_treatment_records t ON t.id=e.treatment_id AND t.user_id=e.user_id WHERE e.user_id=? AND e.kind IN ('dose_taken','checkin') AND e.occurred_at>=? AND e.occurred_at<=? ORDER BY e.occurred_at DESC,e.id DESC LIMIT 1001").bind(record.user_id, since, until));
      sources.push({ name: "member_treatment_events", status: "available", truncated: entries.length > 1e3 });
      for (const r of entries.slice(0, 1e3)) {
        const body2 = JSON.parse(r.body_json), base = { id: "treatment:" + r.id, occurredAt: r.occurred_at, recordedAt: r.created_at, source: "My Timber treatment log", reportedBy: r.source === "member" ? "member" : "recorded source " + r.source, medicine: r.medicine };
        if (r.kind === "dose_taken" && scopes.has("doses")) updates.push({ ...base, kind: "dose", details: { doseStrength: body2.doseStrength || "Not recorded" } });
        const c = body2.checkin;
        if (r.kind === "checkin" && c) {
          const details = {};
          if (scopes.has("weight") && c.weight != null) details.weightKg = c.weight;
          if (scopes.has("symptoms")) {
            for (const k of ["sideEffects", "symptomType", "symptomSeverity", "symptomImpact", "symptomStartedAt", "appetite", "energy"]) if (c[k] !== void 0) details[k] = c[k];
          }
          if (Object.keys(details).length) updates.push({ ...base, kind: "treatment_checkin", details });
        }
      }
    } else sources.push({ name: "member_treatment_events", status: "unavailable" });
  }
  updates.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt) || a.id.localeCompare(b.id));
  const latestSharing = await contextSharing(env, record);
  if (latestSharing.revision !== sharing.revision) fail3(409, "sharing_changed");
  const digest2 = await hash({ sharingRevision: sharing.revision, orders, updates, sources, orderSource });
  return { enabled: true, sharing, orders, orderSource, moreOrders, updates, sources, windowDays: 90, since: since.slice(0, 10), digest: digest2, continuousMonitoring: false };
}
__name(clinicalContext, "clinicalContext");

// casework.mjs
var kinds = /* @__PURE__ */ new Set(["photo_id", "front_photo", "scale_photo", "prescription"]);
var fail4 = /* @__PURE__ */ __name((status, code) => {
  throw Object.assign(Error(code), { status });
}, "fail");
var rows3 = /* @__PURE__ */ __name(async (q3) => (await q3.all()).results, "rows");
var now4 = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "now");
var clean = /* @__PURE__ */ __name((v, max = 4e3) => {
  if (typeof v !== "string" || !v.trim() || v.length > max || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(v)) fail4(422, "message_required");
  return v.trim();
}, "clean");
async function clinicalStaff(env, actor, role) {
  const staff = await env.DB.prepare("SELECT * FROM clinical_hq_staff WHERE user_id=? AND active=1 AND expires_at>?").bind(actor.id, now4()).first();
  if (!staff || staff.role !== role || !staff.verified_by || role === "clinician" && (!staff.registration_number || !staff.registration_body)) fail4(403, "clinical_role_required");
  if (role === "clinician") await clinicianPermission(env, actor);
  return staff;
}
__name(clinicalStaff, "clinicalStaff");
async function caseView(env, record, reviewer = false) {
  const state = await env.DB.prepare("SELECT * FROM clinical_case_state WHERE record_id=?").bind(record.id).first();
  const events = await rows3(env.DB.prepare("SELECT * FROM clinical_case_events WHERE record_id=? ORDER BY version").bind(record.id));
  const latest = await env.DB.prepare("SELECT version,submitted FROM clinical_member_versions WHERE record_id=? ORDER BY version DESC LIMIT 1").bind(record.id).first();
  const answered = new Set(events.filter((e) => e.kind === "member_reply").map((e) => JSON.parse(e.public_json).requestId));
  const pending = events.some((e) => e.kind === "information_requested" && !answered.has(e.id));
  const stale = !!state && state.assessment_version !== latest?.version;
  const prescription = await memberPrescription(env, record);
  return { version: state?.version || 0, status: prescription?.status === "issued" ? "prescription_issued" : !record.review_sharing ? "draft" : pending ? "needs_information" : stale ? "awaiting_review" : state?.status || record.status, assessmentVersion: latest?.version || 0, decisionOutdated: stale, events: events.filter((e) => reviewer || e.kind !== "internal_note").map((e) => ({ id: e.id, version: e.version, assessmentVersion: e.assessment_version, kind: e.kind, createdAt: e.created_at, ...JSON.parse(e.public_json), ...reviewer ? { clinical: JSON.parse(e.private_json), actorUserId: e.actor_user_id, actorKind: e.actor_kind } : {} })), prescription, prescriptionIssued: prescription?.status === "issued", pharmacyReleased: prescription?.status === "issued", fulfilment: await memberFulfilment(env, record) };
}
__name(caseView, "caseView");
async function caseAction(env, record, actor, reviewer, b) {
  if (!b || !Number.isInteger(b.version) || !Number.isInteger(b.assessmentVersion)) fail4(422, "version_required");
  if (reviewer) {
    const staff = await clinicalStaff(env, actor, "clinician");
    if (actor.role !== "clinical") fail4(403, "clinical_role_required");
  }
  const assessment = await env.DB.prepare("SELECT * FROM clinical_member_versions WHERE record_id=? ORDER BY version DESC LIMIT 1").bind(record.id).first();
  if (!assessment || !assessment.submitted || !record.review_sharing || b.assessmentVersion !== assessment.version) fail4(409, "submitted_assessment_required");
  await env.DB.prepare("INSERT OR IGNORE INTO clinical_case_state VALUES(?,0,?,?,?)").bind(record.id, "awaiting_review", assessment.version, now4()).run();
  const state = await env.DB.prepare("SELECT * FROM clinical_case_state WHERE record_id=?").bind(record.id).first();
  if (state.version !== b.version) fail4(409, "case_changed");
  const effective = state.assessment_version === assessment.version ? state.status : "awaiting_review";
  const history = await rows3(env.DB.prepare("SELECT * FROM clinical_case_events WHERE record_id=? ORDER BY version").bind(record.id));
  const answered = new Set(history.filter((e) => e.kind === "member_reply").map((e) => JSON.parse(e.public_json).requestId));
  const outstanding = history.filter((e) => e.kind === "information_requested" && !answered.has(e.id));
  const permissionProof = reviewer ? await clinicianPermission(env, actor, b.action === "decision" ? "clinical_decision" : b.action === "request_information" || b.action === "review_evidence" && b.outcome !== "approve" ? "query" : "review", b.handover?.medicine) : null;
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
  const id = crypto.randomUUID(), date = now4(), version = state.version + 1;
  const staffGuard = reviewer ? " AND EXISTS(SELECT 1 FROM clinical_case_assignments WHERE record_id=? AND hq_user_id=? AND active=1 AND expires_at>?) AND EXISTS(SELECT 1 FROM clinical_hq_staff WHERE user_id=? AND active=1 AND role='clinician' AND verified_by IS NOT NULL AND verified_by<>'' AND registration_number IS NOT NULL AND registration_number<>'' AND registration_body IS NOT NULL AND registration_body<>'' AND expires_at>?)" : "";
  const staffArgs = reviewer ? [record.id, actor.id, date, actor.id, date] : [];
  const scopeGuard = permissionProof ? " AND EXISTS(SELECT 1 FROM partner_staff WHERE id=? AND version=?) AND EXISTS(SELECT 1 FROM partner_organisations WHERE id=? AND version=?)" : "";
  const scopeArgs = permissionProof ? [permissionProof.staffId, permissionProof.version, permissionProof.organisationId, permissionProof.organisationVersion] : [];
  const statements = [env.DB.prepare("INSERT INTO clinical_case_events(id,record_id,version,assessment_version,actor_user_id,actor_kind,kind,public_json,private_json,created_at) SELECT ?,?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM clinical_case_state WHERE record_id=? AND version=?) AND EXISTS(SELECT 1 FROM clinical_member_records WHERE id=? AND revision=? AND review_sharing=1)" + sharingGuard + staffGuard + scopeGuard).bind(id, record.id, version, assessment.version, actor.id, reviewer ? "hq" : "member", kind, JSON.stringify(publicData), JSON.stringify(privateData), date, record.id, state.version, record.id, record.revision, ...sharingArgs, ...staffArgs, ...scopeArgs)];
  statements.push(env.DB.prepare("UPDATE clinical_case_state SET version=?,status=?,assessment_version=?,updated_at=? WHERE record_id=? AND version=? AND EXISTS(SELECT 1 FROM clinical_case_events WHERE id=?)").bind(version, status, assessment.version, date, record.id, state.version, id));
  if (recipient !== void 0) statements.push(env.DB.prepare("INSERT INTO clinical_case_outbox SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM clinical_case_events WHERE id=?)").bind(crypto.randomUUID(), id, recipient, reviewer ? "member" : "hq", reviewer ? kind === "information_requested" ? "member_action_needed" : "member_case_update" : "reviewer_case_update", (reviewer ? "/member/treatment-records?record=" : "/?view=clinical&record=") + record.id, "pending", date, id));
  statements.push(...notificationEventStatements(env, record, { id, kind, source: "case", sourceId: id, at: date }));
  const result = await env.DB.batch(statements);
  if (Number(result[0].meta?.changes) !== 1) fail4(409, "case_changed");
  return caseView(env, record, reviewer);
}
__name(caseAction, "caseAction");
async function caseworkRoute(request, env, actor, record, reviewer, parts, readBody) {
  if (env.CLINICAL_CASEWORK_ENABLED !== "true") return null;
  if (parts[1] !== "workflow") return null;
  if (parts[2] === "sharing" && parts.length === 3 && !reviewer) {
    if (request.method === "GET") return contextSharing(env, record);
    if (request.method === "POST") return saveContextSharing(env, record, actor, await readBody(request));
  }
  if (parts[2] === "context" && parts.length === 3 && !reviewer && request.method === "GET") return clinicalContext(env, record);
  if (request.method === "GET" && !parts[2]) return caseView(env, record, reviewer);
  if (request.method === "POST" && parts[2] === "action" && parts.length === 3) return caseAction(env, record, actor, reviewer, await readBody(request));
  fail4(404, "not_found");
}
__name(caseworkRoute, "caseworkRoute");

// prescriptions/store.mjs
var query = /* @__PURE__ */ __name((env, sql, ...args) => env.DB.prepare(sql).bind(...args), "query");
var now = /* @__PURE__ */ __name(() => (/* @__PURE__ */ new Date()).toISOString(), "now");
async function requestState(env, record) {
  if (env.PRESCRIPTION_WORKFLOW_ENABLED !== "true") return null;
  const row = await query(env, "SELECT state_json FROM clinical_prescription_requests WHERE record_id=? AND member_id=? AND order_number=?", record.id, record.user_id, record.order_number).first();
  return row ? JSON.parse(row.state_json) : null;
}
__name(requestState, "requestState");
async function memberPrescription(env, record) {
  const s = await requestState(env, record);
  if (!s) return null;
  const view = memberView(s);
  const clinical = await query(env, "SELECT version FROM clinical_case_state WHERE record_id=?", record.id).first();
  if (s.recordRevision !== record.revision || !record.review_sharing || clinical?.version !== s.caseVersion) {
    view.status = "needs_review";
    view.canRespond = false;
  }
  return view;
}
__name(memberPrescription, "memberPrescription");
async function quoteFor(env, context, variantId, packs) {
  const { order } = context;
  if (!Number.isSafeInteger(variantId) || !Number.isSafeInteger(packs) || packs < 1 || packs > 12) fail(422, "prescription_variant_and_packs_required");
  const variant = await query(env, "SELECT * FROM medicine_variants WHERE id=? AND medicine_id=?", variantId, order.medicine_id).first();
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
function sourceGuard(env, context) {
  const { record, assessment, state, order, variant, professional, organisation } = context;
  let sql = "EXISTS(SELECT 1 FROM clinical_member_records r JOIN clinical_member_versions a ON a.record_id=r.id JOIN clinical_case_state c ON c.record_id=r.id WHERE r.id=? AND r.user_id=? AND r.order_number=? AND r.revision=? AND r.review_sharing=1 AND a.version=? AND a.digest=? AND a.submitted=1 AND a.version=(SELECT MAX(version) FROM clinical_member_versions WHERE record_id=r.id) AND c.version=? AND c.assessment_version=a.version AND c.status='ready_for_prescription')";
  const args = [record.id, record.user_id, record.order_number, record.revision, assessment.version, assessment.digest, state.version];
  sql += " AND EXISTS(SELECT 1 FROM medicine_orders WHERE order_number=? AND user_id=? AND variant_id=? AND total_pence=? AND currency=? AND status=? AND updated_at=? AND discount_pence=? AND COALESCE(discount_code,'')=?)";
  args.push(order.order_number, order.user_id, order.variant_id, order.total_pence, order.currency, order.status, order.updated_at, order.discount_pence, order.discount_code || "");
  if (variant) {
    sql += " AND EXISTS(SELECT 1 FROM medicine_variants WHERE id=? AND medicine_id=? AND status=? AND selling_price_pence=? AND updated_at=?)";
    args.push(variant.id, variant.medicine_id, variant.status, variant.selling_price_pence, variant.updated_at);
  }
  if (professional) {
    const date = now();
    sql += " AND EXISTS(SELECT 1 FROM partner_staff WHERE id=? AND version=? AND state_json=?) AND EXISTS(SELECT 1 FROM partner_organisations WHERE id=? AND version=? AND state_json=? AND json_extract(state_json,'$.expiresAt')>?)";
    args.push(professional.id, professional.version, JSON.stringify(professional), organisation.id, organisation.version, JSON.stringify(organisation), date);
    sql += " AND EXISTS(SELECT 1 FROM partner_staff p,json_each(p.state_json,'$.grants') g WHERE p.id=? AND json_extract(g.value,'$.credentialVersion')=json_extract(p.state_json,'$.credentialVersion') AND json_extract(g.value,'$.area')='weight_management' AND json_extract(g.value,'$.revokedAt') IS NULL AND json_extract(g.value,'$.startsAt')<=? AND json_extract(g.value,'$.expiresAt')>? AND EXISTS(SELECT 1 FROM json_each(g.value,'$.actions') a WHERE a.value='issue_prescription') AND (json_array_length(g.value,'$.medicines')=0 OR EXISTS(SELECT 1 FROM json_each(g.value,'$.medicines') m WHERE m.value=?)))";
    args.push(professional.id, date, date, order.medicine_name);
  }
  sql += " AND NOT EXISTS(SELECT 1 FROM partner_fulfilment WHERE order_number=?)";
  args.push(record.order_number);
  return { sql, args };
}
__name(sourceGuard, "sourceGuard");
async function memberContext(request, env, actor, record, s, withdraw = false) {
  if (!s || s.memberId !== actor.id || record.user_id !== actor.id) fail(404, "prescription_not_found");
  if (!withdraw && (!record.review_sharing || s.recordRevision !== record.revision)) fail(409, "prescription_review_changed");
  const assessment = await query(env, "SELECT * FROM clinical_member_versions WHERE record_id=? ORDER BY version DESC LIMIT 1", record.id).first();
  const state = await query(env, "SELECT * FROM clinical_case_state WHERE record_id=?", record.id).first();
  const order = await query(env, "SELECT * FROM medicine_orders WHERE order_number=? AND user_id=?", record.order_number, actor.id).first();
  if (!order || !withdraw && (!assessment || assessment.version !== s.assessmentVersion || assessment.digest !== s.assessmentDigest || !state || state.version !== s.caseVersion)) fail(409, "prescription_review_changed");
  const context = { record, assessment, state, order };
  if (!withdraw) {
    const priced = await quoteFor(env, context, s.treatment.variantId, s.treatment.packs);
    if (await digest(priced.quote) !== await digest(s.quote)) fail(409, "prescription_price_changed");
    context.variant = priced.variant;
  }
  let tokenHash = null, checked = 0;
  for (const m of (request.headers.get("cookie") || "").matchAll(/(?:^|;\s*)sst_session=([^;]+)/g)) {
    if (++checked > 4) break;
    let raw;
    try {
      raw = decodeURIComponent(m[1]);
    } catch {
      continue;
    }
    const hash3 = await digest(raw);
    if (await query(env, "SELECT 1 ok FROM user_sessions WHERE user_id=? AND token_hash=? AND revoked_at IS NULL AND julianday(expires_at)>julianday(?)", actor.id, hash3, now()).first()) {
      tokenHash = hash3;
      break;
    }
  }
  if (!tokenHash) fail(401, "current_member_session_required");
  const g = withdraw ? { sql: "EXISTS(SELECT 1 FROM clinical_member_records WHERE id=? AND user_id=? AND order_number=?) AND NOT EXISTS(SELECT 1 FROM partner_fulfilment WHERE order_number=?)", args: [record.id, actor.id, record.order_number, record.order_number] } : sourceGuard(env, context);
  return { ...context, guard: { sql: g.sql + " AND EXISTS(SELECT 1 FROM user_sessions s JOIN users u ON u.id=s.user_id JOIN user_auth a ON a.user_id=u.id WHERE s.user_id=? AND s.token_hash=? AND s.revoked_at IS NULL AND julianday(s.expires_at)>julianday(?) AND a.email_verified=1)", args: [...g.args, actor.id, tokenHash, now()] } };
}
__name(memberContext, "memberContext");
async function commit(env, previous, s, event, guard, extra = []) {
  const current = previous ? "EXISTS(SELECT 1 FROM clinical_prescription_requests WHERE record_id=? AND version=?)" : "NOT EXISTS(SELECT 1 FROM clinical_prescription_requests WHERE record_id=?)";
  const currentArgs = previous ? [s.recordId, previous.version] : [s.recordId];
  const statements = [
    query(env, "INSERT INTO clinical_prescription_events SELECT ?,?,?,?,?,?,?,? WHERE " + current + " AND " + guard.sql, event.id, s.recordId, s.version, event.kind, event.actorKind, event.actorId, JSON.stringify(event.public || {}), event.at, ...currentArgs, ...guard.args),
    query(env, "INSERT INTO clinical_prescription_versions SELECT ?,?,?,? WHERE EXISTS(SELECT 1 FROM clinical_prescription_events WHERE id=?)", s.recordId, s.version, JSON.stringify(s), s.updatedAt, event.id),
    query(env, "INSERT INTO clinical_prescription_requests SELECT ?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM clinical_prescription_events WHERE id=?) ON CONFLICT(record_id) DO UPDATE SET version=excluded.version,state_json=excluded.state_json,updated_at=excluded.updated_at", s.recordId, s.orderNumber, s.memberId, s.version, JSON.stringify(s), s.updatedAt, event.id),
    ...extra
  ];
  if (event.kind !== "prescription_issued") statements.push(query(env, "UPDATE clinical_prescription_finance_tasks SET status='superseded' WHERE record_id=? AND request_version<? AND status='awaiting_review' AND EXISTS(SELECT 1 FROM clinical_prescription_events WHERE id=?)", s.recordId, s.version, event.id));
  if (s.comparison.adjustment !== "none" && event.kind === "prescription_accepted") statements.push(financeStatement(env, s, event, s.comparison.adjustment, s.comparison.amountPence));
  if (["prescription_cancelled", "prescription_declined"].includes(event.kind)) statements.push(financeStatement(env, s, event, "cancellation_review", s.quote.originalTotalPence));
  const out = await env.DB.batch(statements);
  if (out[0].meta?.changes !== 1) fail(409, "prescription_or_access_changed");
  return s;
}
__name(commit, "commit");
function financeStatement(env, s, event, kind, amount) {
  return query(env, "INSERT OR IGNORE INTO clinical_prescription_finance_tasks SELECT ?,?,?,?,?,?,?,'awaiting_review',?,? WHERE EXISTS(SELECT 1 FROM clinical_prescription_events WHERE id=?)", "rx-finance:" + s.recordId + ":" + s.version + ":" + kind, s.recordId, s.version, s.orderNumber, kind, amount, "GBP", JSON.stringify({ originalTotalPence: s.quote.originalTotalPence, revisedTotalPence: s.quote.totalPence, originalOrderStatus: s.quote.orderStatus, providerRefundVerified: false, reason: "Review and reconcile against payment provider before acting. No refund or charge executed." }), event.at, event.id);
}
__name(financeStatement, "financeStatement");

// prescriptions/api.mjs
function alerts(env, s, event, recipient = "member") {
  const exists = "EXISTS(SELECT 1 FROM clinical_prescription_events WHERE id=?)", out = [];
  if (recipient === "member") {
    out.push(query(env, "INSERT OR IGNORE INTO clinical_case_outbox SELECT ?,?,?,'member',?,?,'pending',? WHERE " + exists, "prescription:" + event.id, event.id, s.memberId, ["prescription_proposed", "prescription_query"].includes(event.kind) ? "member_action_needed" : "member_case_update", "/member/treatment-records?record=" + s.recordId, event.at, event.id));
    out.push(...notificationEventStatements(env, { id: s.recordId, user_id: s.memberId, order_number: s.orderNumber }, { id: "prescription:" + event.id, kind: event.kind, source: "prescription", sourceId: event.id, at: event.at }));
  } else out.push(query(env, "INSERT OR IGNORE INTO clinical_case_outbox SELECT ?,?,?,'hq','reviewer_case_update',?,'pending',? WHERE " + exists, "prescription:" + event.id, event.id, s.prescriber.id, "/?view=clinical&record=" + s.recordId, event.at, event.id));
  out.push(query(env, "UPDATE clinical_notification_channels SET status='superseded',updated_at=? WHERE status IN ('awaiting_approval','prepared') AND event_id IN (SELECT n.id FROM clinical_notification_events n JOIN clinical_prescription_events e ON n.id='prescription:'||e.id WHERE e.record_id=? AND e.id<>? AND e.kind IN ('prescription_proposed','prescription_query')) AND " + exists, event.at, s.recordId, event.id, event.id));
  out.push(query(env, "UPDATE clinical_case_outbox SET status='superseded' WHERE status='pending' AND event_id IN (SELECT id FROM clinical_prescription_events WHERE record_id=? AND id<>? AND kind IN ('prescription_proposed','prescription_query')) AND " + exists, s.recordId, event.id, event.id));
  return out;
}
__name(alerts, "alerts");
async function prescriptionMemberRoute(request, env, record, actor, parts, readBody) {
  if (parts[1] !== "prescription") return null;
  if (env.PRESCRIPTION_WORKFLOW_ENABLED !== "true") fail(503, "prescription_workflow_not_commissioned");
  const previous = await requestState(env, record);
  if (parts.length === 2 && request.method === "GET") return { prescription: await memberPrescription(env, record) };
  if (parts.length === 3 && parts[2] === "decision" && request.method === "POST") {
    const b = await readBody(request), context = await memberContext(request, env, actor, record, previous, b.action === "cancel" || b.action === "question"), date = now(), s = memberDecision(previous, b, actor.id, date), event = { id: crypto.randomUUID(), kind: { accept: "prescription_accepted", cancel: "prescription_cancelled", question: "prescription_question" }[b.action], actorKind: "member", actorId: actor.id, at: date, public: b.action === "question" ? { message: s.question.message } : {} };
    await commit(env, previous, s, event, context.guard, alerts(env, s, event, "hq"));
    return { prescription: memberView(s), messagesSent: false, refundExecuted: false };
  }
  fail(404, "not_found");
}
__name(prescriptionMemberRoute, "prescriptionMemberRoute");

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
var active = /* @__PURE__ */ __name((q3, a) => (!q3.paths || q3.paths.includes(a.requestPath)) && (!q3.when || q3.when[1].includes(a[q3.when[0]])), "active");
function validateAnswers(input, complete = false) {
  if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).some((k) => !fields.some((q3) => q3.id === k))) throw Error("unknown_answers");
  const out = {};
  for (const q3 of fields) {
    if (!active(q3, input)) continue;
    const raw = input[q3.id];
    if (raw === void 0 || raw === "") {
      if (complete && !q3.optional) throw Error("required_" + q3.id);
      continue;
    }
    if (typeof raw !== "string" || raw.length > 2e4 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(raw)) throw Error("invalid_" + q3.id);
    const value = raw.trim();
    if (!value && !q3.optional && complete) throw Error("required_" + q3.id);
    if (q3.type === "multi") {
      let values;
      try {
        values = JSON.parse(value);
      } catch {
        throw Error("invalid_" + q3.id);
      }
      if (!Array.isArray(values) || !values.length || new Set(values).size !== values.length || values.some((v) => !q3.options.includes(v)) || values.includes("None of the above") && values.length > 1) throw Error("invalid_" + q3.id);
    } else if (q3.options && !q3.options.includes(value)) throw Error("invalid_" + q3.id);
    if (q3.type === "number" && (!/^\d+(\.\d+)?$/.test(value) || Number(value) <= 0)) throw Error("invalid_" + q3.id);
    if (q3.type === "date" && (!/^\d{4}-\d\d-\d\d$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0, 10) !== value || value < "1900-01-01" || !q3.allowFuture && value > (/* @__PURE__ */ new Date()).toISOString().slice(0, 10))) throw Error("invalid_" + q3.id);
    out[q3.id] = value;
  }
  if (out.dateOfBirth) {
    const today = (/* @__PURE__ */ new Date()).toISOString().slice(0, 10), dob = out.dateOfBirth, age = Number(today.slice(0, 4)) - Number(dob.slice(0, 4)) - (today.slice(5) < dob.slice(5) ? 1 : 0);
    if (age < 18 || age > 75) throw Error("draft_age_scope");
  }
  if (complete) {
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(out.email)) throw Error("invalid_email");
    if (out.forMyself !== "Yes" || out.inUK !== "Yes" || out.insulinUse !== "No" || out.urgentSymptoms !== "No") throw Error("clinical_review_required");
    if (Number(out.heightCm) < 120 || Number(out.heightCm) > 230 || Number(out.weightKg) < 35 || Number(out.weightKg) > 320) throw Error("invalid_measurements");
  }
  return out;
}
__name(validateAnswers, "validateAnswers");

// clinician-presentation.mjs
var withheld = /* @__PURE__ */ new Set(["email", "phone", "address", "postcode", "deliveryAddress", "deliveryPostcode", "gpAddress", "gpPostcode", "gpName"]);
var allowed = new Set(fields.map((f) => f.id).filter((id) => !withheld.has(id)));
function questionnaireSnapshot() {
  return { schemaVersion: schema.version, questions: fields.map(({ id, label, items, options }) => ({ id, label, ...items ? { items } : {}, ...options ? { options } : {} })) };
}
__name(questionnaireSnapshot, "questionnaireSnapshot");

// member-records.mjs
var PREFIX = "/v1/member/clinical-records";
var REVIEW = "/v1/clinical-review/records";
var origins = /* @__PURE__ */ new Set(["https://shiftsometimber.co.uk", "https://www.shiftsometimber.co.uk"]);
var kinds2 = /* @__PURE__ */ new Set(["photo_id", "front_photo", "scale_photo", "prescription"]);
var idPattern = /^[a-f0-9-]{36}$/;
var headers = { "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer", "X-Robots-Tag": "noindex, nofollow", "Content-Security-Policy": "default-src 'none'; frame-ancestors 'none'" };
var json = /* @__PURE__ */ __name((data, status = 200) => new Response(JSON.stringify(data), { status, headers: { ...headers, "Content-Type": "application/json" } }), "json");
var problem = /* @__PURE__ */ __name((status, code) => {
  throw Object.assign(Error(code), { status });
}, "problem");
var hash2 = /* @__PURE__ */ __name(async (bytes) => Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (b) => b.toString(16).padStart(2, "0")).join(""), "hash");
var bytesOf = /* @__PURE__ */ __name(async (request, limit) => {
  let total = 0, chunks = [];
  if (Number(request.headers.get("content-length")) > limit) problem(413, "request_too_large");
  for await (const chunk of request.body || []) {
    total += chunk.length;
    if (total > limit) problem(413, "request_too_large");
    chunks.push(chunk);
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const c of chunks) {
    bytes.set(c, offset);
    offset += c.length;
  }
  return bytes;
}, "bytesOf");
async function body(request) {
  try {
    return JSON.parse(new TextDecoder().decode(await bytesOf(request, 2e5)));
  } catch (e) {
    if (e.status) throw e;
    problem(400, "invalid_json");
  }
}
__name(body, "body");
var rows5 = /* @__PURE__ */ __name(async (stmt) => (await stmt.all()).results, "rows");
async function audit(env, record, actor, action, details = {}) {
  await env.DB.prepare("INSERT INTO clinical_member_audit VALUES(?,?,?,?,?,?)").bind(crypto.randomUUID(), record.id, actor.id, action, JSON.stringify(details), (/* @__PURE__ */ new Date()).toISOString()).run();
}
__name(audit, "audit");
async function evidence(env, id) {
  return rows5(env.DB.prepare("SELECT id,kind,mime,size,digest,uploaded_at FROM clinical_member_evidence WHERE record_id=? ORDER BY uploaded_at,id").bind(id));
}
__name(evidence, "evidence");
async function payload(env, record) {
  const prescription = await memberPrescription(env, record);
  const v = await env.DB.prepare("SELECT * FROM clinical_member_versions WHERE record_id=? ORDER BY version DESC LIMIT 1").bind(record.id).first();
  return { record, assessment: v ? { version: v.version, schemaVersion: v.schema_version, answers: JSON.parse(v.answers_json), evidence: JSON.parse(v.evidence_json), declarations: JSON.parse(v.declarations_json), digest: v.digest, submitted: !!v.submitted } : null, evidence: await evidence(env, record.id), prescription, fulfilment: await memberFulfilment(env, record), prescriptionIssued: !!prescription?.prescriptionId };
}
__name(payload, "payload");
async function memberClinicalRoutes(request, env, authenticate2) {
  const path = new URL(request.url).pathname;
  const reviewer = path === REVIEW || path.startsWith(REVIEW + "/");
  if (!reviewer && path !== PREFIX && !path.startsWith(PREFIX + "/")) return null;
  const origin = request.headers.get("Origin");
  const reply = /* @__PURE__ */ __name((response) => {
    if (origins.has(origin)) {
      response.headers.set("Access-Control-Allow-Origin", origin);
      response.headers.set("Access-Control-Allow-Credentials", "true");
      response.headers.set("Vary", "Origin");
    }
    return response;
  }, "reply");
  try {
    if (origin && !origins.has(origin)) problem(403, "origin_not_allowed");
    if (request.method === "OPTIONS") return reply(new Response(null, { status: 204, headers: { ...headers, "Access-Control-Allow-Methods": "GET, POST, OPTIONS", "Access-Control-Allow-Headers": "Content-Type, X-Record-Revision, X-Evidence-Kind" } }));
    if (!["GET", "POST"].includes(request.method)) problem(405, "method_not_allowed");
    if (request.method === "POST" && !origins.has(origin)) problem(403, "origin_required");
    const actor = await authenticate2(request, env);
    if (!actor) problem(401, "sign_in_required");
    if (Number(actor.email_verified) !== 1) problem(403, "verified_account_required");
    if (env.CLINICAL_REVIEW_READY !== "true" && (reviewer || !env.CLINICAL_TEST_MEMBER_EMAIL || String(actor.email).toLowerCase() !== env.CLINICAL_TEST_MEMBER_EMAIL.toLowerCase())) problem(403, "clinical_service_not_open");
    if (env.CLINICAL_MEMBER_RECORDS_ENABLED !== "true" || !env.CLINICAL_PRIVATE_FILES || !env.DB) problem(503, "private_clinical_storage_not_enabled");
    const base = reviewer ? REVIEW : PREFIX, parts = path.slice(base.length).split("/").filter(Boolean), id = parts[0];
    if (!id) {
      if (reviewer) problem(404, "not_found");
      if (request.method === "GET") return reply(json({ records: await rows5(env.DB.prepare("SELECT * FROM clinical_member_records WHERE user_id=? ORDER BY created_at DESC").bind(actor.id)), schemaVersion: schema.version }));
      const b = await body(request);
      if (b.orderNumber !== void 0 && (typeof b.orderNumber !== "string" || b.orderNumber.length > 100)) problem(400, "invalid_order_reference");
      if (b.orderNumber) {
        const order = await env.DB.prepare("SELECT order_number FROM medicine_orders WHERE order_number=? AND user_id=?").bind(String(b.orderNumber), actor.id).first();
        if (!order) problem(404, "order_not_found");
        const prior = await env.DB.prepare("SELECT id,revision,schema_version FROM clinical_member_records WHERE user_id=? AND order_number=?").bind(actor.id, b.orderNumber).first();
        if (prior) return reply(json({ id: prior.id, revision: prior.revision, schemaVersion: prior.schema_version }));
      }
      const now5 = (/* @__PURE__ */ new Date()).toISOString(), recordId = crypto.randomUUID();
      await env.DB.prepare("INSERT INTO clinical_member_records(id,user_id,order_number,schema_version,created_at,updated_at) VALUES(?,?,?,?,?,?)").bind(recordId, actor.id, b.orderNumber || null, schema.version, now5, now5).run();
      const record2 = { id: recordId, user_id: actor.id };
      await audit(env, record2, actor, "record_created");
      return reply(json({ id: recordId, revision: 0, schemaVersion: schema.version }, 201));
    }
    if (!idPattern.test(id)) problem(404, "record_not_found");
    const record = await env.DB.prepare("SELECT * FROM clinical_member_records WHERE id=?").bind(id).first();
    if (!record) problem(404, "record_not_found");
    if (reviewer) {
      const assignment = await env.DB.prepare("SELECT * FROM clinical_reviewer_assignments WHERE record_id=? AND reviewer_user_id=? AND active=1 AND expires_at>?").bind(id, actor.id, (/* @__PURE__ */ new Date()).toISOString()).first();
      if (!assignment || !record.review_sharing) problem(404, "record_not_found");
      if (request.method !== "GET") problem(405, "read_only_review");
    } else if (record.user_id !== actor.id) problem(404, "record_not_found");
    if (!reviewer && parts[1] === "prescription") {
      const result = await prescriptionMemberRoute(request, env, record, actor, parts, body);
      if (result) return reply(json(result));
    }
    if (!reviewer && parts[1] === "fulfilment") {
      if (parts.length === 2 && request.method === "GET") {
        await audit(env, record, actor, "member_fulfilment_viewed");
        return reply(json({ fulfilment: await memberFulfilment(env, record) }));
      }
      if (parts.length === 3 && parts[2] === "reply" && request.method === "POST") return reply(json(await replyToFulfilment(request, env, record, actor, await body(request))));
      problem(404, "not_found");
    }
    if (!reviewer && env.CLINICAL_CASEWORK_ENABLED === "true") {
      const result = await caseworkRoute(request, env, actor, record, false, parts, body);
      if (result) return reply(json(result));
    }
    if (request.method === "GET" && !parts[1]) {
      await audit(env, record, actor, reviewer ? "reviewer_record_viewed" : "member_record_viewed");
      return reply(json(await payload(env, record)));
    }
    if (parts[1] === "evidence" && parts[2] && request.method === "GET") {
      if (!idPattern.test(parts[2])) problem(404, "evidence_not_found");
      const e = await env.DB.prepare("SELECT * FROM clinical_member_evidence WHERE id=? AND record_id=?").bind(parts[2], id).first();
      if (!e) problem(404, "evidence_not_found");
      if (reviewer) {
        const v = await env.DB.prepare("SELECT evidence_json FROM clinical_member_versions WHERE record_id=? ORDER BY version DESC LIMIT 1").bind(id).first();
        if (!v || !JSON.parse(v.evidence_json).some((x) => x.id === e.id)) problem(404, "evidence_not_in_version");
      }
      const object = await env.CLINICAL_PRIVATE_FILES.get(e.object_key);
      if (!object) problem(503, "evidence_temporarily_unavailable");
      await audit(env, record, actor, "evidence_viewed", { evidenceId: e.id });
      return reply(new Response(object.body, { headers: { ...headers, "Content-Type": e.mime, "Content-Disposition": 'attachment; filename="clinical-evidence.' + (e.mime === "application/pdf" ? "pdf" : e.mime === "image/png" ? "png" : "jpg") + '"' } }));
    }
    if (request.method !== "POST") problem(404, "not_found");
    if (parts[1] === "evidence" && !parts[2]) {
      const revision = request.headers.has("X-Record-Revision") ? Number(request.headers.get("X-Record-Revision")) : NaN, kind = request.headers.get("X-Evidence-Kind"), mime = request.headers.get("Content-Type");
      if (!Number.isInteger(revision) || revision !== record.revision) problem(409, "record_changed");
      if (!kinds2.has(kind)) problem(400, "invalid_evidence_kind");
      const existing = await evidence(env, id);
      if (existing.length >= 20) problem(409, "evidence_limit");
      const bytes = await bytesOf(request, 8 * 1024 * 1024), text3 = new TextDecoder();
      const png = bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((v, i) => bytes[i] === v) && text3.decode(bytes.slice(12, 16)) === "IHDR", jpg = bytes.length >= 24 && bytes[0] === 255 && bytes[1] === 216 && bytes[2] === 255 && bytes.at(-2) === 255 && bytes.at(-1) === 217, pdf = kind === "prescription" && text3.decode(bytes.slice(0, 5)) === "%PDF-" && text3.decode(bytes.slice(-1024)).includes("%%EOF");
      if (!(png && mime === "image/png" || jpg && mime === "image/jpeg" || pdf && mime === "application/pdf")) problem(400, "invalid_file_content");
      const eid = crypto.randomUUID(), key = "clinical/" + id + "/" + eid, digest2 = await hash2(bytes), now5 = (/* @__PURE__ */ new Date()).toISOString();
      await env.CLINICAL_PRIVATE_FILES.put(key, bytes, { httpMetadata: { contentType: mime } });
      try {
        const result = await env.DB.batch([env.DB.prepare("INSERT INTO clinical_member_evidence SELECT ?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM clinical_member_records WHERE id=? AND revision=?)").bind(eid, id, key, kind, mime, bytes.length, digest2, now5, id, revision), env.DB.prepare("UPDATE clinical_member_records SET revision=revision+1,status='draft',review_sharing=0,updated_at=? WHERE id=? AND revision=?").bind(now5, id, revision), ...notificationEventStatements(env, record, { id: "evidence:" + eid, kind: "evidence_uploaded", source: "evidence", sourceId: eid, at: now5 })]);
        if (Number(result[0].meta?.changes) !== 1) problem(409, "record_changed");
      } catch (e) {
        await env.CLINICAL_PRIVATE_FILES.delete(key).catch(() => {
        });
        throw e;
      }
      await audit(env, record, actor, "evidence_uploaded", { evidenceId: eid, digest: digest2 });
      return reply(json({ id: eid, revision: revision + 1 }, 201));
    }
    if (parts[1] === "assessment") {
      const b = await body(request);
      if (b.schemaVersion !== schema.version) problem(409, "schema_changed");
      if (!Number.isInteger(b.revision) || b.revision !== record.revision) problem(409, "record_changed");
      const submitted = b.submit === true;
      let answers;
      try {
        answers = validateAnswers({ ...b.answers, ...submitted || b.answers?.email !== void 0 ? { email: actor.email } : {} }, submitted);
      } catch (e) {
        problem(422, e.message);
      }
      const files = await evidence(env, id);
      if (submitted) {
        if (b.accuracy !== true || b.reviewSharing !== true) problem(422, "confirmation_required");
        const required = ["photo_id", "front_photo", "scale_photo", ...answers.requestPath !== "Starting treatment" ? ["prescription"] : []];
        if (required.some((k) => !files.some((e) => e.kind === k))) problem(422, "required_evidence_missing");
      }
      const version = record.revision + 1, now5 = (/* @__PURE__ */ new Date()).toISOString(), declarations = { accuracy: submitted, reviewSharing: submitted, version: schema.version, recordedAt: now5, questionnaire: questionnaireSnapshot() }, digest2 = await hash2(new TextEncoder().encode(JSON.stringify({ schemaVersion: schema.version, answers, evidence: files, submitted, declarations })));
      const writes = [env.DB.prepare("INSERT INTO clinical_member_versions SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM clinical_member_records WHERE id=? AND revision=?)").bind(id, version, schema.version, JSON.stringify(answers), JSON.stringify(files), JSON.stringify(declarations), digest2, submitted ? 1 : 0, now5, id, b.revision), env.DB.prepare("UPDATE clinical_member_records SET revision=?,status=?,review_sharing=?,updated_at=? WHERE id=? AND revision=?").bind(version, submitted ? "awaiting_review" : "draft", submitted ? 1 : 0, now5, id, b.revision)];
      if (submitted && env.CLINICAL_CASEWORK_ENABLED === "true") writes.push(env.DB.prepare("INSERT OR IGNORE INTO clinical_case_outbox SELECT 'submission:'||?||':'||?||':'||a.hq_user_id,?,a.hq_user_id,'hq','reviewer_case_update',?,'pending',? FROM clinical_case_assignments a JOIN clinical_hq_staff s ON s.user_id=a.hq_user_id WHERE a.record_id=? AND a.active=1 AND a.expires_at>? AND s.active=1 AND s.role='clinician' AND s.expires_at>? AND EXISTS(SELECT 1 FROM clinical_member_versions WHERE record_id=? AND version=?)").bind(id, version, "assessment:" + id + ":" + version, "/?view=clinical&record=" + id, now5, id, now5, now5, id, version));
      if (submitted) writes.push(...notificationEventStatements(env, record, { id: "assessment:" + id + ":" + version, kind: "assessment_submitted", source: "assessment", sourceId: version, at: now5 }));
      const result = await env.DB.batch(writes);
      if (Number(result[0].meta?.changes) !== 1) problem(409, "record_changed");
      await audit(env, record, actor, submitted ? "assessment_submitted" : "draft_saved", { version, digest: digest2 });
      return reply(json({ revision: version, status: submitted ? "awaiting_review" : "draft", prescriptionIssued: false }));
    }
    problem(404, "not_found");
  } catch (e) {
    return reply(json({ error: e.status ? e.message : "clinical_record_unavailable" }, e.status || 503));
  }
}
__name(memberClinicalRoutes, "memberClinicalRoutes");

// member-records-assets.mjs
var assets = { "/assets/clinical-records/prescription.mjs": { "body": "const money=pence=>new Intl.NumberFormat('en-GB',{style:'currency',currency:'GBP'}).format(pence/100);\nconst labels={clinician_query:'Your clinician needs more information',awaiting_member:'Review your proposed treatment',member_question:'Your message is with the clinician',accepted:'Treatment agreed \u2014 awaiting prescription sign-off',issued:'Your prescription has been signed',cancelled:'Treatment request cancelled',declined:'Treatment request declined',expired:'This proposal needs a fresh review',needs_review:'Your updated information needs a fresh review'};\nexport function prescriptionPanel(data,{node,button,onDecision}){\n if(!data)return null;\n const box=node('section');box.className='fulfilment-card prescription-card';box.setAttribute('aria-label','Your proposed prescription');\n box.append(node('p','MY TIMBER / '+data.orderNumber),node('h2',labels[data.status]||'Your proposed treatment'));\n if(data.prescriberName)box.append(node('p','Prescriber: '+data.prescriberName));\n const comparison=node('div');comparison.className='prescription-comparison';\n const original=node('article'),revised=node('article');original.append(node('h3','Original request'),node('strong',data.originalTreatment.medicine),node('p',data.originalTreatment.strength),node('p',money(data.comparison.originalTotalPence)));\n revised.append(node('h3','Proposed treatment'),node('strong',data.treatment.medicine),node('p',data.treatment.strength),node('p','Dose: '+data.treatment.dose),node('p','Quantity: '+data.treatment.quantity),node('p','Route: '+data.treatment.route),node('p','Directions: '+data.treatment.directions),node('strong','Revised total: '+money(data.comparison.revisedTotalPence)));\n comparison.append(original,revised);box.append(comparison,node('h3','Why your clinician proposed this'),node('p',data.reason));\n if(data.comparison.adjustment==='refund_review')box.append(node('p','Price difference: '+money(data.comparison.amountPence)+' less than your original order. A refund adjustment needs admin review.'));\n if(data.comparison.adjustment==='payment_required')box.append(node('p','Extra amount: '+money(data.comparison.amountPence)+'. Additional payment requires a separate payment step before dispensing.'));\n if(data.comparison.adjustment==='none')box.append(node('p','Your order total is unchanged.'));\n if(data.question)box.append(node('h3','Your latest question'),node('p',data.question.message));\n if(data.clinicianQuestion)box.append(node('h3','Question from your clinician'),node('p',data.clinicianQuestion.message));\n if(data.canRespond){\n  const label=node('label'),agree=node('input');agree.type='checkbox';agree.setAttribute('aria-label','I agree to the proposed treatment and revised price');label.append(agree,node('span','I agree to the proposed treatment and revised price.'));box.append(label);\n  box.append(button('Accept',async()=>{if(!agree.checked)throw Error('Confirm that you agree to the treatment and revised price.');await onDecision({version:data.version,action:'accept',agreed:true});}));\n }\n if(data.canCancel){const confirmation=node('div');confirmation.hidden=true;confirmation.append(node('p','Cancel this treatment request? This withdraws your agreement and sends any payment adjustment for admin review.'),button('Confirm cancellation',()=>onDecision({version:data.version,action:'cancel'})),button('Keep request',()=>{confirmation.hidden=true;}));box.append(button('Cancel',()=>{confirmation.hidden=false;}),confirmation);}\n if(data.canAsk){const question=node('div');question.hidden=true;const field=node('textarea');field.maxLength=2000;field.setAttribute('aria-label','Your question about the proposed treatment');question.append(node('p','Your message pauses sign-off until your clinician responds.'),field,button('Submit question',async()=>{if(!field.value.trim())throw Error('Enter your question or reply.');await onDecision({version:data.version,action:'question',message:field.value});}));box.append(button(data.status==='clinician_query'?'Reply to clinician':'Ask a question',()=>{question.hidden=false;}),question);}\n if(data.status==='accepted')box.append(node('p','Your agreement is recorded. The clinician must sign the current prescription before it reaches dispensing.'));\n if(data.prescriptionId)box.append(node('p','Prescription reference: '+data.prescriptionId));\n return box;\n}\n", "type": "text/javascript" }, "/assets/clinical-records/fulfilment.mjs": { "body": "const labels={received:'With the dispensing team',accepted:'Accepted for dispensing',preparing:'Being prepared',dispatched:'Dispatched',delivered:'Delivery recorded',delivery_exception:'Delivery needs attention',returned:'Returned to the pharmacy',cancelled:'Supply cancelled',rejected:'Supply declined',query:'More information needed'};\nconst activities={prescription_received:'Prescription handover received',fulfilment_accept:'Dispensing team accepted the handover',fulfilment_prepare:'Preparation started',fulfilment_dispatch:'Dispatch recorded',fulfilment_delivered:'Delivery recorded by the pharmacy',fulfilment_delivery_exception:'Delivery exception recorded',fulfilment_returned:'Return recorded',fulfilment_cancel:'Supply cancelled',fulfilment_reject:'Supply declined',fulfilment_query:'Dispensing team requested information',member_fulfilment_reply:'Your reply was received'};\nconst date=v=>{const d=new Date(v);return Number.isFinite(d.valueOf())?d.toLocaleString('en-GB'):'Date unavailable';};\nexport function fulfilmentPanel(data,{node,button,onReply}){\n if(!data)return null;\n const box=node('section');box.className='fulfilment-card'+(data.actionNeeded?' needs-attention':'');box.setAttribute('aria-label','Your dispensing and delivery');\n box.append(node('p','MY SHIFT / '+data.orderNumber),node('h2',labels[data.status]||'Order update'),node('p','Last updated: '+date(data.updatedAt)));\n if(data.message)box.append(node('p',data.message));\n if(data.actionNeeded)box.append(node('strong','Action needed from you'));\n if(data.canReply){const input=node('textarea');input.maxLength=2000;input.setAttribute('aria-label','Your reply to the dispensing team');box.append(input,button('Submit reply to dispensing team',async()=>{if(!input.value.trim())throw Error('Enter your reply before submitting.');await onReply({version:data.version,queryId:data.queryId,message:input.value});}));}\n if(data.memberReply)box.append(node('h3','Your latest reply'),node('p',data.memberReply.message),node('p','Received '+date(data.memberReply.createdAt)));\n if(data.prescriptionId)box.append(node('p','Prescription reference: '+data.prescriptionId));\n if(data.tracking){const details=node('div');details.append(node('h3','Tracking'),node('p','Reference: '+data.tracking.number));\n  if(typeof data.tracking.url==='string'&&/^https:\\/\\/(www\\.royalmail\\.com|track\\.dpd\\.co\\.uk)\\//.test(data.tracking.url)){const a=node('a','Track with the courier');a.href=data.tracking.url;a.target='_blank';a.rel='noopener noreferrer';details.append(a);}box.append(details);\n }\n if(data.deliveryUpdate)box.append(node('p','Delivery update recorded by the pharmacy on '+date(data.deliveryUpdate.recordedAt)+'. This is not an independently verified courier event.'));\n if(data.events?.length){const history=node('details');history.append(node('summary','Order activity'));const list=node('ol');for(const e of [...data.events].reverse().slice(0,50))list.append(node('li',(activities[e.action]||'Order update')+' \xB7 '+date(e.created_at)));history.append(list);box.append(history);}\n return box;\n}\n", "type": "text/javascript" }, "/member/treatment-records": { "body": '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Your treatment records | My Shift</title><link rel="stylesheet" href="/assets/clinical-records/style.css"></head><body><header><a href="/member/dashboard">SHIFT <span>SOME</span> TIMBER</a><p>MY SHIFT</p></header><main><h1>Your treatment records</h1><p>Your answers and documents, together for clinical review. Treatment always requires a prescriber\u2019s decision.</p><p id="notice" role="status" aria-live="polite"></p><p>Private testing: use fictional health answers and documents only. Treatment is not open.</p><div id="record"></div></main><script type="module" src="/assets/clinical-records/client.mjs"><\/script></body></html>\n', "type": "text/html" }, "/clinical-review/record": { "body": '<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>Your treatment records | My Shift</title><link rel="stylesheet" href="/assets/clinical-records/style.css"></head><body><header><a href="/member/dashboard">SHIFT <span>SOME</span> TIMBER</a><p>MY SHIFT</p></header><main><h1>Your treatment records</h1><p>Your answers and documents, together for clinical review. Treatment always requires a prescriber\u2019s decision.</p><p id="notice" role="status" aria-live="polite"></p><p>Private testing: use fictional health answers and documents only. Treatment is not open.</p><div id="record"></div></main><script type="module" src="/assets/clinical-records/client.mjs"><\/script></body></html>\n', "type": "text/html" }, "/assets/clinical-records/client.mjs": { "body": "import {prescriptionPanel} from '/assets/clinical-records/prescription.mjs';\nimport {schema,active} from '/assets/clinical-records/schema.mjs';\nimport {fulfilmentPanel} from '/assets/clinical-records/fulfilment.mjs';\nconst $=s=>document.querySelector(s),node=(tag,text)=>{const n=document.createElement(tag);if(text!==undefined)n.textContent=text;return n;};\nconst apiRoot='/v1/member/clinical-records',reviewRoot='/v1/clinical-review/records';let current,answers={},step=0,busy=false,epoch=0,stopped=false;\nconst review=location.pathname.startsWith('/clinical-review/'),notice=$('#notice'),root=$('#record');\nasync function api(path,body,headers){const response=await fetch(path,{method:body===undefined?'GET':'POST',credentials:'include',cache:'no-store',headers:headers||body===undefined?headers:{'Content-Type':'application/json'},body:body===undefined?undefined:headers?body:JSON.stringify(body)});if(response.status===401){stopped=true;++epoch;root.replaceChildren();answers={};notice.textContent='Sign in to My Timber to access your treatment records.';throw Error('Session ended. Sign in again.');}if(!response.ok){const error=await response.json();throw Error(({clinical_service_not_open:'Treatment records are in private testing and are not open to this account.',private_clinical_storage_not_enabled:'The private treatment-record connection is not open yet. No information has been sent.',record_changed:'This record changed. Reload before continuing.',required_evidence_missing:'Upload the required documents before submitting.'})[error.error]||error.error.replaceAll('_',' '));}return response.json();}\nfunction button(label,action){const b=node('button',label);b.type='button';b.onclick=async()=>{if(busy||stopped)return;busy=true;const captured=epoch;try{await action();}catch(e){if(captured===epoch)notice.textContent=e.message;}finally{busy=false;}};return b;}\nasync function load(id){const captured=epoch,data=await api((review?reviewRoot:apiRoot)+'/'+id);if(captured!==epoch||stopped)return;current=data;try{current.workflow=await api(apiRoot+'/'+id+'/workflow');}catch(e){if(stopped)return;}if(captured!==epoch||stopped)return;try{current.sharing=await api(apiRoot+'/'+id+'/workflow/sharing');}catch(e){if(stopped)return;}if(captured!==epoch||stopped)return;answers={...data.assessment?.answers};render();}\nconst core=schema.sections[0].questions;\nconst stages=[{title:'Your name and date of birth',questions:core.filter(q=>['fullName','dateOfBirth'].includes(q.id))},{title:'Address and contact details',questions:core.filter(q=>['address','postcode','email','phone','deliveryAddress','deliveryPostcode'].includes(q.id))},{title:'Height and weight',questions:core.filter(q=>['heightCm','weightKg','weightRelatedCondition'].includes(q.id))},{title:'Your treatment',questions:[...schema.sections[1].questions,...core.filter(q=>['insulinUse','previousMedicine','previousDose','lastDoseDate'].includes(q.id)),...schema.sections[2].questions]},...schema.sections.slice(3,-1),{title:'Your GP and sharing',questions:[...core.filter(q=>q.id.startsWith('gp')),...schema.sections.at(-1).questions]},{title:'Your documents',evidence:true},{title:'Review and submit',review:true}];\nfunction field(q){const wrap=node(q.type==='multi'?'fieldset':'label');wrap.className='field';wrap.append(node(q.type==='multi'?'legend':'span',q.label));if(q.items){const list=node('ul');for(const text of q.items)list.append(node('li',text));wrap.append(list);}if(q.type==='multi'){let values=[];try{values=JSON.parse(answers[q.id]||'[]');}catch{}const controls=[];for(const option of q.options){const w=node('label'),i=node('input');i.type='checkbox';i.checked=values.includes(option);w.append(i,node('span',option));wrap.append(w);controls.push([i,option]);i.onchange=()=>{if(i.checked)for(const [other,v]of controls)if(other!==i&&(option==='None of the above'||v==='None of the above'))other.checked=false;answers[q.id]=JSON.stringify(controls.filter(([c])=>c.checked).map(([,v])=>v));};}return wrap;}\n const input=node(q.options?'select':q.type==='textarea'?'textarea':'input');input.name=q.id;input.setAttribute('aria-label',q.label);if(input.tagName==='INPUT'){input.type=q.type==='date'?'date':q.type==='number'?'number':q.id==='email'?'email':'text';if(q.type==='number')input.step='any';}if(q.options){const empty=node('option','Choose an answer');empty.value='';input.append(empty);for(const v of q.options){const o=node('option',v);o.value=v;input.append(o);}}input.value=answers[q.id]||'';input.maxLength=20000;input.required=!q.optional;input.oninput=()=>{answers[q.id]=input.value;visibility();};wrap.dataset.field=q.id;wrap.append(input);return wrap;}\nfunction visibility(){for(const wrap of root.querySelectorAll('[data-field]')){const q=schema.sections.flatMap(s=>s.questions).find(q=>q.id===wrap.dataset.field),on=active(q,answers);wrap.hidden=!on;for(const i of wrap.querySelectorAll('input,select,textarea')){i.disabled=!on;i.required=on&&!q.optional;}}const note=$('#bmi');if(note){const h=Number(answers.heightCm),w=Number(answers.weightKg);note.textContent=h>0&&w>0?'Calculated BMI: '+(w/(h/100)**2).toFixed(1)+' \xB7 Subject to independent clinical checks.':'';}}\nasync function save(submit=false,form){const captured=epoch,result=await api(apiRoot+'/'+current.record.id+'/assessment',{schemaVersion:schema.version,revision:current.record.revision,answers,submit,accuracy:!!form?.elements.accuracy?.checked,reviewSharing:!!form?.elements.reviewSharing?.checked});if(captured!==epoch||stopped)return;current.record.revision=result.revision;current.record.status=result.status;current.assessment={...current.assessment,answers:{...answers},evidence:current.evidence,submitted:submit};if(submit&&current.workflow){const done=new Set(current.workflow.events.filter(e=>e.kind==='member_reply').map(e=>e.requestId));const pending=current.workflow.events.find(e=>e.kind==='information_requested'&&!done.has(e.id));if(pending){try{await api(apiRoot+'/'+current.record.id+'/workflow/action',{action:'reply',version:current.workflow.version,assessmentVersion:result.revision,requestId:pending.id,message:'I have submitted my updated answers and requested documents.'});}catch(e){notice.textContent=e.message;}}}}\nfunction uploads(form){form.append(node('p','Use JPEG or PNG, up to 8 MB. Prescription evidence can also be a PDF. Uploaded documents await independent review.'));const required=['photo_id','front_photo','scale_photo',...answers.requestPath!=='Starting treatment'?['prescription']:[]];const info={photo_id:'Photo ID showing photograph, full name and date of birth: passport, driving licence front, CitizenCard or Post Office PASS card.',front_photo:'Current full-length photo for this consultation. Face unobscured; wear fitted clothing and hold up two fingers towards the camera in a peace sign. No model poses required! If this pose is not possible for you, upload your full-length photo and tell the clinician.',scale_photo:'Stand on the scales with feet visible and a clearly legible reading.',prescription:'Previous prescription, invoice or dispensing label showing your name, medicine, dose and date within the last eight weeks.'};for(const kind of required){const box=node('section');box.append(node('h3',kind.replaceAll('_',' ')),node('p',info[kind]));for(const e of current.evidence.filter(e=>e.kind===kind)){const link=node('a','Download saved document');link.href=apiRoot+'/'+current.record.id+'/evidence/'+e.id;box.append(link);}const input=node('input');input.type='file';input.accept=kind==='prescription'?'image/png,image/jpeg,application/pdf':'image/png,image/jpeg';input.setAttribute('aria-label',kind+' file');box.append(input,button('Upload',async()=>{const f=input.files[0];if(!f)throw Error('Choose a file.');if(f.size>8*1024*1024)throw Error('Use a file no larger than 8 MB.');await save();const captured=epoch;await api(apiRoot+'/'+current.record.id+'/evidence',f,{'Content-Type':f.type,'X-Record-Revision':String(current.record.revision),'X-Evidence-Kind':kind});if(captured===epoch&&!stopped)await load(current.record.id);}));form.append(box);}}\nfunction sharingPanel(){\n if(review||!current.sharing?.enabled)return;const panel=node('details');panel.append(node('summary','My Timber sharing with your clinician'));panel.append(node('p','Choose which My Timber updates your assigned treating clinician can access for this assessment. Sharing is optional and starts off. The view covers the last 90 days and future entries in that period while enabled. It is not monitored continuously. For urgent concerns, seek medical help rather than waiting for an app review.'));\n panel.append(node('p','Private journals, community posts, AI conversations, food notes and unrelated wellbeing entries are not included. Turning sharing off stops future access to this app view. Information already relied on and recorded in your clinical record may need to be retained.'));\n const form=node('form');form.onsubmit=e=>e.preventDefault();for(const [scope,title]of [['weight','Share my weight readings'],['doses','Share my logged doses'],['symptoms','Share my treatment symptoms, appetite and energy']]){const w=node('label'),i=node('input');i.type='checkbox';i.name=scope;i.checked=current.sharing.scopes.includes(scope);w.append(i,node('span',title));form.append(w);}\n form.append(button('Save sharing choices',async()=>{await api(apiRoot+'/'+current.record.id+'/workflow/sharing',{revision:current.sharing.revision,noticeVersion:current.sharing.noticeVersion,scopes:['weight','doses','symptoms'].filter(s=>form.elements[s].checked)});await load(current.record.id);notice.textContent='Your sharing choices have been saved.';}));\n const preview=node('div');form.append(button('See the app updates shared with your clinician',async()=>{const data=await api(apiRoot+'/'+current.record.id+'/workflow/context');preview.replaceChildren();if(!data.updates.length)preview.append(node('p','No app updates are currently shared for this period.'));for(const e of data.updates){preview.append(node('strong',e.occurredAt+' \xB7 '+e.kind.replaceAll('_',' ')),node('p',Object.entries(e.details).map(([k,v])=>k+': '+v).join(' \xB7 ')));}for(const source of data.sources)if(source.status!=='available'||source.truncated)preview.append(node('p',source.name+': '+(source.truncated?'history truncated':'source unavailable')));}));panel.append(form,preview);root.append(panel);\n}\nfunction memberCasePanel(){\n const w=current.workflow;if(review||!w)return;const box=node('section');box.append(node('h2','Your clinical review'),node('p','Status: '+w.status.replaceAll('_',' ')));const replied=new Set(w.events.filter(e=>e.kind==='member_reply').map(e=>e.requestId));for(const event of w.events){if(event.message)box.append(node('strong',event.kind.replaceAll('_',' ')),node('p',event.message));if(event.kind==='information_requested'&&!replied.has(event.id)){box.append(node('p','Action needed: '+(event.evidenceKinds.length?event.evidenceKinds.map(k=>k.replaceAll('_',' ')).join(', '):'Answer the clinician\u2019s question')));const reply=node('textarea');reply.maxLength=4000;reply.setAttribute('aria-label','Your reply to the clinician');box.append(reply,button('Send reply and return to review',async()=>{await api(apiRoot+'/'+current.record.id+'/workflow/action',{action:'reply',version:w.version,assessmentVersion:current.assessment.version,requestId:event.id,message:reply.value});await load(current.record.id);}));box.append(node('p','For a replacement document or changed answer, update this record and submit it again before sending your reply.'));}}if(w.decisionOutdated)box.append(node('p','Your updated information needs a new clinical review.'));root.append(box);\n}\nfunction readView(){if(!review){const proposal=prescriptionPanel(current.prescription,{node,button,onDecision:async b=>{await api(apiRoot+'/'+current.record.id+'/prescription/decision',b);await load(current.record.id);notice.textContent='Your treatment response has been recorded.';}});if(proposal)root.append(proposal);const panel=fulfilmentPanel(current.fulfilment||current.workflow?.fulfilment,{node,button,onReply:async b=>{await api(apiRoot+'/'+current.record.id+'/fulfilment/reply',b);await load(current.record.id);notice.textContent='Your reply was saved against this order. No separate message was sent.';}});if(panel)root.append(panel);}memberCasePanel();root.append(node('h2',review?'Assigned clinical record':'Your saved treatment record'),node('p',current.fulfilment?'Your saved answers and documents for this order.':'Assessment: '+({awaiting_review:'Submitted for review',draft:'Draft'}[current.record.status]||current.record.status.replaceAll('_',' '))));if(current.assessment){for(const section of schema.sections){const shown=section.questions.filter(q=>active(q,current.assessment.answers)&&current.assessment.answers[q.id]);if(!shown.length)continue;root.append(node('h3',section.title));for(const q of shown){root.append(node('strong',q.label),node('p',current.assessment.answers[q.id]));}}for(const e of current.assessment.evidence){const link=node('a',e.kind.replaceAll('_',' ')+' \xB7 Download');link.href=(review?reviewRoot:apiRoot)+'/'+current.record.id+'/evidence/'+e.id;root.append(link,node('br'));}}if(!review)root.append(button('Update this record',()=>{step=0;current.record.status='draft';render();}));}\nfunction render(){if(stopped||!current)return;root.replaceChildren();sharingPanel();if(review||current.prescription||current.record.status==='awaiting_review')return readView();const stage=stages[step];root.append(node('p','Step '+(step+1)+' of '+stages.length),node('h2',stage.title));const form=node('form');root.append(form);if(stage.evidence)uploads(form);else if(stage.review){form.append(node('p','Check your saved answers and documents. Submission sends this version for review, not a prescription.'));for(const [name,text]of [['accuracy','I confirm my answers are complete and accurate.'],['reviewSharing','I agree that the authorised treating clinician can review this record and its documents.']]){const w=node('label'),i=node('input');i.type='checkbox';i.name=name;i.required=true;w.append(i,node('span',text));form.append(w);}form.append(button('Review all saved answers',()=>{root.replaceChildren();readView();}));}else{for(const q of stage.questions)form.append(field(q));if(stage.title==='Height and weight'){const bmi=node('p');bmi.id='bmi';form.append(bmi,node('p','Convert imperial measurements below, or enter cm and kg.'));for(const [name,label]of [['feet','Feet'],['inches','Inches'],['stone','Stone'],['pounds','Pounds']]){const w=node('label',label),i=node('input');i.type='number';i.min='0';i.step='any';i.name=name;w.append(i);form.append(w);}form.append(button('Use imperial measurements',()=>{const v=k=>Number(form.elements[k].value),ft=v('feet'),inch=v('inches'),st=v('stone'),lb=v('pounds');if(!ft||inch<0||inch>=12||!st||lb<0||lb>=14)throw Error('Check the imperial measurements.');answers.heightCm=String(Math.round((ft*12+inch)*2.54*100)/100);answers.weightKg=String(Math.round((st*14+lb)*0.45359237*100)/100);render();}));}visibility();}\n form.append(button('Save and finish later',async()=>{await save();notice.textContent='Saved to your member record.';}));if(step>0)form.append(button('Back',async()=>{await save();step--;render();}));const next=node('button',stage.review?'Submit for review':'Save and continue');next.type='submit';form.append(next);form.onsubmit=async e=>{e.preventDefault();if(busy||stopped)return;busy=true;try{for(const q of stage.questions||[])if(q.type==='multi'&&(!answers[q.id]||answers[q.id]==='[]'))throw Error('Choose the relevant conditions or None of the above.');await save(!!stage.review,form);if(stage.review)await load(current.record.id);else{step++;render();}}catch(e){notice.textContent=e.message;}finally{busy=false;}};}\nasync function initialise(){const captured=epoch,id=new URLSearchParams(location.search).get('record');if(review){if(!id)throw Error('Open an assigned record.');return load(id);}const result=await api(apiRoot);if(stopped||captured!==epoch)return;if(id)return load(id);root.append(node('h2','Your treatment records'));for(const record of result.records)root.append(button((record.order_number||record.created_at.slice(0,10))+' \xB7 '+record.status,()=>load(record.id)));root.append(button('Start a treatment record',async()=>{const captured=epoch,record=await api(apiRoot,new URLSearchParams(location.search).has('order')?{orderNumber:new URLSearchParams(location.search).get('order')}:{});if(stopped||captured!==epoch)return;await load(record.id);const before={...answers};try{const r=await fetch('/v1/member/details',{credentials:'include',cache:'no-store'});if(r.status===401){stopped=true;++epoch;answers={};root.replaceChildren();throw Error('Sign in again.');}if(r.ok){const profile=(await r.json()).details||{};if(captured!==epoch||stopped)return;const map={dateOfBirth:'dateOfBirth',email:'email',phone:'phone',postcode:'postcode',gpName:'gpName',gpPractice:'gpPractice',gpAddress:'gpAddress',gpPostcode:'gpPostcode'};const values={fullName:[profile.firstName,profile.lastName].filter(Boolean).join(' '),address:[profile.address1,profile.address2,profile.town].filter(Boolean).join(', ')};for(const [k,v]of Object.entries(map))values[v]=profile[k];for(const [k,v]of Object.entries(values))if(v&&answers[k]===before[k])answers[k]=v;render();}}catch(e){notice.textContent='Check your contact and GP details manually. '+e.message;}}));}\nwindow.addEventListener('pagehide',()=>{stopped=true;++epoch;answers={};root.replaceChildren();});window.addEventListener('pageshow',e=>{if(e.persisted)location.reload();});initialise().catch(e=>notice.textContent=e.message);\n", "type": "text/javascript" }, "/assets/clinical-records/schema.mjs": { "body": `export const schema = {
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
export const fields=schema.sections.flatMap(s=>s.questions);
export const active=(q,a)=>(!q.paths||q.paths.includes(a.requestPath))&&(!q.when||q.when[1].includes(a[q.when[0]]));
export function validateAnswers(input,complete=false){
 if(!input||typeof input!=='object'||Array.isArray(input)||Object.keys(input).some(k=>!fields.some(q=>q.id===k)))throw Error('unknown_answers');
 const out={};for(const q of fields){if(!active(q,input))continue;const raw=input[q.id];if(raw===undefined||raw===''){if(complete&&!q.optional)throw Error('required_'+q.id);continue;}if(typeof raw!=='string'||raw.length>20000||/[\\u0000-\\u0008\\u000b\\u000c\\u000e-\\u001f]/.test(raw))throw Error('invalid_'+q.id);const value=raw.trim();if(!value&&!q.optional&&complete)throw Error('required_'+q.id);if(q.type==='multi'){let values;try{values=JSON.parse(value);}catch{throw Error('invalid_'+q.id);}if(!Array.isArray(values)||!values.length||new Set(values).size!==values.length||values.some(v=>!q.options.includes(v))||(values.includes('None of the above')&&values.length>1))throw Error('invalid_'+q.id);}else if(q.options&&!q.options.includes(value))throw Error('invalid_'+q.id);if(q.type==='number'&&(!/^\\d+(\\.\\d+)?$/.test(value)||Number(value)<=0))throw Error('invalid_'+q.id);if(q.type==='date'&&(!/^\\d{4}-\\d\\d-\\d\\d$/.test(value)||!Number.isFinite(Date.parse(value))||new Date(value).toISOString().slice(0,10)!==value||value<'1900-01-01'||(!q.allowFuture&&value>new Date().toISOString().slice(0,10))))throw Error('invalid_'+q.id);out[q.id]=value;}
 if(out.dateOfBirth){const today=new Date().toISOString().slice(0,10),dob=out.dateOfBirth,age=Number(today.slice(0,4))-Number(dob.slice(0,4))-(today.slice(5)<dob.slice(5)?1:0);if(age<18||age>75)throw Error('draft_age_scope');}
 if(complete){if(!/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(out.email))throw Error('invalid_email');if(out.forMyself!=='Yes'||out.inUK!=='Yes'||out.insulinUse!=='No'||out.urgentSymptoms!=='No')throw Error('clinical_review_required');if(Number(out.heightCm)<120||Number(out.heightCm)>230||Number(out.weightKg)<35||Number(out.weightKg)>320)throw Error('invalid_measurements');}
 return out;
}
`, "type": "text/javascript" }, "/assets/clinical-records/style.css": { "body": ":root{font-family:Arial,sans-serif;color:#050505;background:#e7e3da}*{box-sizing:border-box}body{margin:0}header{background:#050505;color:#e7e3da;padding:24px;text-align:center}header a{color:inherit;font-size:24px;font-weight:800;text-decoration:none}header span{color:#99a18a}header p{font-size:12px;letter-spacing:.16em;margin-bottom:0}main{max-width:780px;margin:auto;padding:24px}h1{font-size:32px}h2,h3{color:#505744}form,fieldset{border:0;padding:0;margin:0}.field{display:block;margin:22px 0}.field>span,legend{display:block;font-weight:700;margin-bottom:9px}input:not([type=checkbox]),select,textarea{display:block;width:100%;min-height:46px;padding:12px;margin-top:8px;font:inherit;background:#fff;border:1px solid #707762;border-radius:6px}textarea{min-height:100px}label{display:block;margin:12px 0}input[type=checkbox]{width:20px;height:20px;vertical-align:middle;margin-right:10px}button{min-height:44px;border:0;border-radius:6px;padding:12px 18px;background:#050505;color:#e7e3da;font:inherit;margin:8px 10px 8px 0;cursor:pointer}button:focus-visible,input:focus-visible,select:focus-visible,textarea:focus-visible,a:focus-visible{outline:3px solid #707762;outline-offset:3px}li{margin:10px 0;line-height:1.5}a{color:#3c4830}#notice{font-weight:700}section{padding:18px 0;border-bottom:1px solid #a9ae9f}[hidden]{display:none!important}p{line-height:1.5;overflow-wrap:anywhere}\n\n.fulfilment-card{padding:24px;margin:24px 0;background:#fff;border:2px solid #707762;border-radius:12px}.fulfilment-card.needs-attention{background:#707762;color:#fff;animation:care-attention 2.6s ease-in-out infinite}.fulfilment-card.needs-attention h2,.fulfilment-card.needs-attention h3,.fulfilment-card.needs-attention a{color:inherit}.fulfilment-card summary{cursor:pointer;font-weight:700}.fulfilment-card textarea{color:#050505}@keyframes care-attention{50%{box-shadow:0 0 0 5px #70776240}}@media(prefers-reduced-motion:reduce){.fulfilment-card.needs-attention{animation:none}}@media(max-width:500px){.fulfilment-card{padding:20px}}\n\n.prescription-comparison{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px;margin:18px 0}.prescription-comparison article{min-width:0;padding:16px;border:1px solid #707762;border-radius:8px;background:#fff}.prescription-card label{display:flex;gap:10px;align-items:flex-start}.prescription-card input[type=checkbox]{width:20px;height:20px;flex-shrink:0}.prescription-card p{overflow-wrap:anywhere}.prescription-card button{margin:6px 8px 6px 0}@media(max-width:600px){.prescription-comparison{grid-template-columns:1fr}}\n", "type": "text/css" } };
function clinicalRecordAsset(request) {
  const a = assets[new URL(request.url).pathname];
  if (!a || !["GET", "HEAD"].includes(request.method)) return null;
  return new Response(request.method === "HEAD" ? null : a.body, { headers: { "Content-Type": a.type + "; charset=utf-8", "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "X-Content-Type-Options": "nosniff", "Content-Security-Policy": "default-src 'self'; script-src 'self'; style-src 'self'; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'" } });
}
__name(clinicalRecordAsset, "clinicalRecordAsset");

// live-worker.mjs
async function authenticate(request, env) {
  const values = [];
  for (const m of (request.headers.get("cookie") || "").matchAll(/(?:^|;\s*)sst_session=([^;]+)/g)) {
    let token;
    try {
      token = decodeURIComponent(m[1]);
    } catch {
      continue;
    }
    if (!values.includes(token)) values.push(token);
  }
  for (const token of values.slice(0, 4)) {
    const hash3 = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(token))), (b) => b.toString(16).padStart(2, "0")).join("");
    const row = await env.DB.prepare("SELECT u.id,u.email,u.first_name,u.last_name,a.email_verified,s.expires_at,s.revoked_at FROM user_sessions s JOIN users u ON u.id=s.user_id LEFT JOIN user_auth a ON a.user_id=u.id WHERE s.token_hash=?").bind(hash3).first();
    if (row && !row.revoked_at && Date.parse(row.expires_at) > Date.now()) return row;
  }
  return null;
}
__name(authenticate, "authenticate");
var live_worker_default = { async fetch(request, env) {
  const asset = clinicalRecordAsset(request);
  if (asset) return asset;
  const response = await memberClinicalRoutes(request, { ...env, PRESCRIPTION_WORKFLOW_ENABLED: "true" }, authenticate);
  return response || new Response("Not found", { status: 404, headers: { "Cache-Control": "no-store" } });
} };
export {
  live_worker_default as default
};
//# sourceMappingURL=live-worker.js.map
