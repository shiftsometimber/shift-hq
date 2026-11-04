CREATE TABLE hq_users (id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'readonly',status TEXT NOT NULL DEFAULT 'active',mfa_secret TEXT,mfa_enabled INTEGER NOT NULL DEFAULT 0,last_login_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE hq_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT,hq_user_id INTEGER NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,revoked_at TEXT,last_used_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(hq_user_id) REFERENCES hq_users(id));
CREATE TABLE medicine_products (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,active_ingredient TEXT NOT NULL,form TEXT NOT NULL CHECK(form IN ('injection','tablet','capsule')),status TEXT NOT NULL DEFAULT 'out_of_stock' CHECK(status IN ('draft','out_of_stock','available','archived')),description TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0,created_by INTEGER,updated_by INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, partner TEXT, sellable INTEGER NOT NULL DEFAULT 0, availability_state TEXT NOT NULL DEFAULT 'unavailable');
CREATE TABLE medicine_variants (id INTEGER PRIMARY KEY AUTOINCREMENT,medicine_id INTEGER NOT NULL,strength_label TEXT NOT NULL,cost_pence INTEGER NOT NULL DEFAULT 0,selling_price_pence INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'out_of_stock' CHECK(status IN ('out_of_stock','available','archived')),sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, target_margin_bps INTEGER NOT NULL DEFAULT 6000, partner TEXT, sellable INTEGER NOT NULL DEFAULT 0, availability_state TEXT NOT NULL DEFAULT 'unavailable',UNIQUE(medicine_id,strength_label),FOREIGN KEY(medicine_id) REFERENCES medicine_products(id));
CREATE TABLE medicine_orders (id INTEGER PRIMARY KEY AUTOINCREMENT,order_number TEXT NOT NULL UNIQUE,user_id INTEGER NOT NULL,email TEXT NOT NULL,medicine_id INTEGER NOT NULL,variant_id INTEGER NOT NULL,medicine_name TEXT NOT NULL,strength_label TEXT NOT NULL,unit_price_pence INTEGER NOT NULL,discount_code TEXT,discount_pence INTEGER NOT NULL DEFAULT 0,total_pence INTEGER NOT NULL,currency TEXT NOT NULL DEFAULT 'GBP',status TEXT NOT NULL DEFAULT 'pending',stripe_checkout_session_id TEXT UNIQUE,stripe_payment_intent_id TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, stripe_error_json TEXT, clinical_status TEXT NOT NULL DEFAULT 'not_started', clinical_reason_code TEXT, clinical_updated_at TEXT, journey_setup_required INTEGER NOT NULL DEFAULT 0, journey_setup_completed_at TEXT, reorder_of_order_id INTEGER, reorder_eligible_at TEXT, clinical_intake_submitted_at TEXT, clinical_intake_reference TEXT);
CREATE TABLE clinical_member_records (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL, order_number TEXT,
 revision INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'draft',
 schema_version TEXT NOT NULL, review_sharing INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE clinical_member_versions (
 record_id TEXT NOT NULL, version INTEGER NOT NULL, schema_version TEXT NOT NULL,
 answers_json TEXT NOT NULL, evidence_json TEXT NOT NULL, declarations_json TEXT NOT NULL, digest TEXT NOT NULL,
 submitted INTEGER NOT NULL, created_at TEXT NOT NULL,
 PRIMARY KEY(record_id,version), FOREIGN KEY(record_id) REFERENCES clinical_member_records(id)
);
CREATE TABLE clinical_member_evidence (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, digest TEXT NOT NULL,
 uploaded_at TEXT NOT NULL, FOREIGN KEY(record_id) REFERENCES clinical_member_records(id)
);
CREATE TABLE clinical_reviewer_assignments (
 record_id TEXT NOT NULL, reviewer_user_id INTEGER NOT NULL,
 active INTEGER NOT NULL DEFAULT 1, expires_at TEXT NOT NULL,
 PRIMARY KEY(record_id,reviewer_user_id)
);
CREATE TABLE clinical_member_audit (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL, actor_user_id INTEGER NOT NULL,
 action TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE partner_staff (
 id TEXT PRIMARY KEY, hq_user_id INTEGER UNIQUE, username TEXT UNIQUE COLLATE NOCASE,
 kind TEXT NOT NULL CHECK(kind IN ('clinician','dispensing')), org_id TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 0, state_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE partner_organisations (
 id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0, state_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE partner_access_tokens (
 token_hash TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES partner_staff(id),
 kind TEXT NOT NULL CHECK(kind IN ('application','activation')), expires_at TEXT NOT NULL,
 used_at TEXT, issued_by INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE partner_fulfilment (
 order_number TEXT PRIMARY KEY, partner_id TEXT NOT NULL, member_id INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 0, state_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE partner_audit (
 id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, version INTEGER NOT NULL,
 actor_id TEXT NOT NULL, action TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(entity_type,entity_id,version)
);
CREATE TABLE partner_notification_outbox (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL UNIQUE REFERENCES partner_audit(id), order_number TEXT NOT NULL,
 member_id INTEGER NOT NULL, template TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL
);
CREATE TABLE partner_commissioning_orders (
 order_number TEXT PRIMARY KEY CHECK(order_number LIKE 'TEST-%'),
 version INTEGER NOT NULL, state_json TEXT NOT NULL CHECK(json_extract(state_json,'$.synthetic')=1),
 created_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE partner_commissioning_events (
 id TEXT PRIMARY KEY, order_number TEXT NOT NULL REFERENCES partner_commissioning_orders(order_number),
 version INTEGER NOT NULL, actor_id TEXT NOT NULL, action TEXT NOT NULL, details_json TEXT NOT NULL,
 created_at TEXT NOT NULL, UNIQUE(order_number,version)
);
CREATE TABLE partner_commissioning_notifications (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL REFERENCES partner_commissioning_events(id),
 order_number TEXT NOT NULL, channel TEXT NOT NULL CHECK(channel IN ('email','whatsapp')),
 template TEXT NOT NULL, body TEXT NOT NULL, status TEXT NOT NULL CHECK(status='withheld'),
 created_at TEXT NOT NULL, UNIQUE(event_id,channel)
);
CREATE TABLE partner_auth_limits (
 scope_hash TEXT NOT NULL, window_start INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 attempt_count INTEGER NOT NULL, PRIMARY KEY(scope_hash,window_start)
);
CREATE TABLE partner_invitation_drafts (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('partner','clinician')),
 org_id TEXT NOT NULL, staff_id TEXT, profile_version INTEGER,
 recipient_name TEXT NOT NULL, recipient_email TEXT NOT NULL,
 subject TEXT NOT NULL, body TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'held_onboarding_closed',
 created_by INTEGER NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(kind,org_id,staff_id,profile_version,recipient_email)
);
CREATE TABLE clinical_case_outbox (
 id TEXT PRIMARY KEY,event_id TEXT NOT NULL,recipient_user_id INTEGER NOT NULL,
 recipient_kind TEXT NOT NULL,template TEXT NOT NULL,link TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,
 UNIQUE(event_id,recipient_user_id,recipient_kind)
);
CREATE TABLE clinical_notification_events (
 id TEXT PRIMARY KEY, member_id INTEGER NOT NULL, record_id TEXT NOT NULL,
 order_number TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
 link TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(id,member_id)
);
CREATE TABLE clinical_notification_channels (
 event_id TEXT NOT NULL REFERENCES clinical_notification_events(id),
 channel TEXT NOT NULL CHECK(channel IN ('email','whatsapp','app')),
 status TEXT NOT NULL DEFAULT 'awaiting_approval', draft_id TEXT,
 provider_reference TEXT, updated_at TEXT NOT NULL,
 PRIMARY KEY(event_id,channel)
);
CREATE TABLE clinical_case_state (
 record_id TEXT PRIMARY KEY REFERENCES clinical_member_records(id),
 version INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL DEFAULT 'awaiting_review',
 assessment_version INTEGER NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE clinical_hq_staff (
 user_id INTEGER PRIMARY KEY, role TEXT NOT NULL CHECK(role IN ('clinician','operations')),
 active INTEGER NOT NULL DEFAULT 0, verified_by TEXT NOT NULL,
 registration_body TEXT, registration_number TEXT, expires_at TEXT NOT NULL
);
CREATE TABLE clinical_case_events (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL, version INTEGER NOT NULL,
 assessment_version INTEGER NOT NULL, actor_user_id INTEGER NOT NULL, actor_kind TEXT NOT NULL,
 kind TEXT NOT NULL, public_json TEXT NOT NULL, private_json TEXT NOT NULL,
 created_at TEXT NOT NULL, UNIQUE(record_id,version)
);
CREATE TABLE clinical_case_assignments (
 record_id TEXT NOT NULL REFERENCES clinical_member_records(id), hq_user_id INTEGER NOT NULL,
 active INTEGER NOT NULL DEFAULT 1, expires_at TEXT NOT NULL, PRIMARY KEY(record_id,hq_user_id)
);
CREATE TABLE clinical_prescription_requests (
 record_id TEXT PRIMARY KEY, order_number TEXT NOT NULL UNIQUE, member_id INTEGER NOT NULL,
 version INTEGER NOT NULL, state_json TEXT NOT NULL CHECK(json_valid(state_json)), updated_at TEXT NOT NULL
);
CREATE TABLE clinical_prescription_events (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL, version INTEGER NOT NULL, kind TEXT NOT NULL,
 actor_kind TEXT NOT NULL, actor_id INTEGER NOT NULL, public_json TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(record_id,version)
);
CREATE TABLE clinical_prescription_signatures (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL, version INTEGER NOT NULL, digest TEXT NOT NULL,
 document_json TEXT NOT NULL, key_id TEXT NOT NULL, proof_json TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(record_id,version)
);
CREATE TABLE clinical_prescription_versions (
 record_id TEXT NOT NULL, version INTEGER NOT NULL, state_json TEXT NOT NULL,
 created_at TEXT NOT NULL, PRIMARY KEY(record_id,version)
);
CREATE TABLE clinical_prescriber_signing_keys (
 id TEXT PRIMARY KEY, hq_user_id INTEGER NOT NULL, credential_id TEXT NOT NULL UNIQUE,
 public_key_json TEXT NOT NULL, status TEXT NOT NULL CHECK(status IN ('pending','approved','revoked')),
 version INTEGER NOT NULL DEFAULT 0, sign_count INTEGER NOT NULL DEFAULT 0,
 profile_version INTEGER NOT NULL, organisation_version INTEGER NOT NULL,
 reviewed_by INTEGER, verification_reference TEXT, expires_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE clinical_prescription_challenges (
 id TEXT PRIMARY KEY, record_id TEXT, hq_user_id INTEGER NOT NULL, session_hash TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('register','sign')), request_version INTEGER,
 document_digest TEXT, challenge TEXT NOT NULL UNIQUE, key_id TEXT,
 expires_at TEXT NOT NULL, used_at TEXT, created_at TEXT NOT NULL
);
CREATE TABLE clinical_prescription_finance_tasks (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL, request_version INTEGER NOT NULL, order_number TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('refund_review','payment_required','cancellation_review')),
 amount_pence INTEGER NOT NULL CHECK(amount_pence>=0), currency TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'awaiting_review', source_json TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(record_id,request_version,kind)
);
