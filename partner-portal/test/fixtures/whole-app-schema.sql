-- Test-only schema snapshot. No member data. Never apply as a production migration.
CREATE TABLE _cf_KV (
        key TEXT PRIMARY KEY,
        value BLOB
      ) WITHOUT ROWID;
CREATE TABLE ai_action_requests (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,action_type TEXT NOT NULL,title TEXT NOT NULL,reason TEXT,payload_json TEXT,risk_level TEXT NOT NULL DEFAULT 'medium',status TEXT NOT NULL DEFAULT 'pending',requested_by TEXT,reviewed_by TEXT,review_note TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,reviewed_at TEXT);
CREATE TABLE ai_eval_runs (id INTEGER PRIMARY KEY AUTOINCREMENT,eval_id INTEGER NOT NULL,status TEXT NOT NULL,model TEXT,answer TEXT,score_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE ai_evaluations (id INTEGER PRIMARY KEY AUTOINCREMENT,scenario TEXT NOT NULL UNIQUE,mode TEXT NOT NULL,expected_behavior TEXT,review_notes TEXT,status TEXT NOT NULL DEFAULT 'active',created_by_hq_user_id INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE ai_index_run_items (id INTEGER PRIMARY KEY AUTOINCREMENT,run_id INTEGER NOT NULL,url TEXT NOT NULL,status TEXT NOT NULL,document_id INTEGER,checksum TEXT,error TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE ai_index_runs (id INTEGER PRIMARY KEY AUTOINCREMENT,status TEXT NOT NULL,pages_indexed INTEGER NOT NULL DEFAULT 0,chunks_created INTEGER NOT NULL DEFAULT 0,changed_count INTEGER NOT NULL DEFAULT 0,error_count INTEGER NOT NULL DEFAULT 0,started_at TEXT NOT NULL,completed_at TEXT);
CREATE TABLE ai_index_targets (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,base_url TEXT NOT NULL UNIQUE,source_type TEXT NOT NULL,category TEXT NOT NULL,trust_tier INTEGER NOT NULL DEFAULT 3,status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE ai_knowledge_chunks (id INTEGER PRIMARY KEY AUTOINCREMENT,document_id INTEGER NOT NULL,chunk_index INTEGER NOT NULL,content TEXT NOT NULL,search_text TEXT NOT NULL,embedding_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(document_id) REFERENCES ai_knowledge_documents(id));
CREATE TABLE ai_knowledge_documents (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,source_uri TEXT NOT NULL,category TEXT NOT NULL,trust_tier INTEGER NOT NULL DEFAULT 3,status TEXT NOT NULL DEFAULT 'approved',checksum TEXT NOT NULL UNIQUE,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE ai_knowledge_sources (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,source_uri TEXT NOT NULL UNIQUE,category TEXT NOT NULL,trust_tier INTEGER NOT NULL DEFAULT 3,status TEXT NOT NULL DEFAULT 'approved',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE ai_memory (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,memory_type TEXT NOT NULL,memory_key TEXT NOT NULL,memory_value TEXT NOT NULL,sensitivity TEXT NOT NULL DEFAULT 'standard',consent_basis TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,memory_type,memory_key));
CREATE TABLE ai_memory_consent (user_id INTEGER PRIMARY KEY,memory_mode TEXT NOT NULL DEFAULT 'off',shoulder_memory INTEGER NOT NULL DEFAULT 0,health_memory INTEGER NOT NULL DEFAULT 0,consent_version TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE ai_source_versions (id INTEGER PRIMARY KEY AUTOINCREMENT,document_id INTEGER NOT NULL,version_no INTEGER NOT NULL,checksum TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'current',effective_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(document_id,version_no));
CREATE TABLE assessment_answers (   id INTEGER PRIMARY KEY AUTOINCREMENT,   assessment_id INTEGER NOT NULL,   question_id INTEGER NOT NULL,   answer_value TEXT,   answer_text TEXT,   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,   FOREIGN KEY (assessment_id) REFERENCES assessments(id),   FOREIGN KEY (question_id) REFERENCES questions(id) );
CREATE TABLE assessments (     id INTEGER PRIMARY KEY AUTOINCREMENT,     user_id INTEGER NOT NULL,     status TEXT NOT NULL DEFAULT 'started',     answers TEXT,     outcome TEXT,     clinician_notes TEXT,     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,     FOREIGN KEY (user_id) REFERENCES users(id) );
CREATE TABLE audit_log (   id INTEGER PRIMARY KEY AUTOINCREMENT,   user_id INTEGER,   action TEXT NOT NULL,   entity_type TEXT,   entity_id TEXT,   metadata TEXT,   ip_address TEXT,   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,   FOREIGN KEY (user_id) REFERENCES users(id) );
CREATE TABLE auth_delivery_event_links(delivery_event_id INTEGER PRIMARY KEY,event_reference TEXT NOT NULL,template_version TEXT NOT NULL,recipient_role TEXT NOT NULL,recorded_at TEXT NOT NULL,FOREIGN KEY(delivery_event_id) REFERENCES auth_delivery_events(id) ON DELETE CASCADE);
CREATE TABLE auth_delivery_events(id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,email_hash TEXT NOT NULL,event_type TEXT NOT NULL,status TEXT NOT NULL,provider_id TEXT,error_code TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE auth_tokens (   id INTEGER PRIMARY KEY AUTOINCREMENT,   user_id INTEGER NOT NULL,   token_hash TEXT NOT NULL UNIQUE,   token_type TEXT NOT NULL,   expires_at TEXT NOT NULL,   used_at TEXT,   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,   FOREIGN KEY (user_id) REFERENCES users(id) );
CREATE TABLE babylove_arrival_email(source_id TEXT PRIMARY KEY,status TEXT NOT NULL,recipient TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,sent_at TEXT,provider_message_id TEXT,last_error TEXT);
CREATE TABLE babylove_editorial_backups(slug TEXT PRIMARY KEY,article_json TEXT NOT NULL,receipt_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE babylove_receipts(source_id TEXT PRIMARY KEY,slug TEXT NOT NULL UNIQUE,payload_hash TEXT NOT NULL,payload_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE campaign_recipients (id INTEGER PRIMARY KEY AUTOINCREMENT,campaign_id INTEGER NOT NULL,user_id INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'queued',provider_message_id TEXT,error TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,sent_at TEXT,UNIQUE(campaign_id,user_id));
CREATE TABLE campaigns (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,channel TEXT NOT NULL,segment_id INTEGER,subject TEXT,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',scheduled_at TEXT,sent_at TEXT,created_by_hq_user_id INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE case_notes (   id INTEGER PRIMARY KEY AUTOINCREMENT,   case_id INTEGER NOT NULL,   note_type TEXT NOT NULL DEFAULT 'general',   note TEXT NOT NULL,   created_by TEXT,   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,   FOREIGN KEY (case_id) REFERENCES cases(id) );
CREATE TABLE case_tasks (   id INTEGER PRIMARY KEY AUTOINCREMENT,   case_id INTEGER NOT NULL,   title TEXT NOT NULL,   description TEXT,   status TEXT NOT NULL DEFAULT 'open',   due_at TEXT,   completed_at TEXT,   assigned_to TEXT,   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,   updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,   FOREIGN KEY (case_id) REFERENCES cases(id) );
CREATE TABLE cases (     id INTEGER PRIMARY KEY AUTOINCREMENT,     user_id INTEGER NOT NULL,     assessment_id INTEGER,     reference TEXT UNIQUE,     status TEXT NOT NULL DEFAULT 'submitted',     service_type TEXT,     pharmacy_status TEXT,     payment_status TEXT DEFAULT 'not_required',     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,     FOREIGN KEY (user_id) REFERENCES users(id),     FOREIGN KEY (assessment_id) REFERENCES assessments(id) );
CREATE TABLE catalogue_skus ( id INTEGER PRIMARY KEY AUTOINCREMENT,source_table TEXT NOT NULL,source_id TEXT NOT NULL, sku TEXT UNIQUE,legacy_sku TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(source_table,source_id) );
CREATE TABLE check_ins (   id INTEGER PRIMARY KEY AUTOINCREMENT,   user_id INTEGER NOT NULL,   case_id INTEGER,   weight REAL,   waist REAL,   wellbeing_score INTEGER,   side_effects TEXT,   notes TEXT,   submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,   FOREIGN KEY (user_id) REFERENCES users(id),   FOREIGN KEY (case_id) REFERENCES cases(id) );
CREATE TABLE checkout_attempts ( id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,channel TEXT NOT NULL,fingerprint TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'preparing',active INTEGER NOT NULL DEFAULT 1, order_number TEXT NOT NULL UNIQUE,form_body TEXT,claim_token TEXT, session_id TEXT,checkout_url TEXT,last_error TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL );
CREATE TABLE clinical_case_assignments (
 record_id TEXT NOT NULL REFERENCES clinical_member_records(id), hq_user_id INTEGER NOT NULL,
 active INTEGER NOT NULL DEFAULT 1, expires_at TEXT NOT NULL, PRIMARY KEY(record_id,hq_user_id)
);
CREATE TABLE clinical_case_events (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL, version INTEGER NOT NULL,
 assessment_version INTEGER NOT NULL, actor_user_id INTEGER NOT NULL, actor_kind TEXT NOT NULL,
 kind TEXT NOT NULL, public_json TEXT NOT NULL, private_json TEXT NOT NULL,
 created_at TEXT NOT NULL, UNIQUE(record_id,version)
);
CREATE TABLE clinical_case_outbox (
 id TEXT PRIMARY KEY,event_id TEXT NOT NULL,recipient_user_id INTEGER NOT NULL,
 recipient_kind TEXT NOT NULL,template TEXT NOT NULL,link TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'pending',created_at TEXT NOT NULL,
 UNIQUE(event_id,recipient_user_id,recipient_kind)
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
CREATE TABLE clinical_member_audit (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL, actor_user_id INTEGER NOT NULL,
 action TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE clinical_member_evidence (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL, object_key TEXT NOT NULL UNIQUE,
 kind TEXT NOT NULL, mime TEXT NOT NULL, size INTEGER NOT NULL, digest TEXT NOT NULL,
 uploaded_at TEXT NOT NULL, FOREIGN KEY(record_id) REFERENCES clinical_member_records(id)
);
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
CREATE TABLE clinical_notification_channels (
 event_id TEXT NOT NULL REFERENCES clinical_notification_events(id),
 channel TEXT NOT NULL CHECK(channel IN ('email','whatsapp','app')),
 status TEXT NOT NULL DEFAULT 'awaiting_approval', draft_id TEXT,
 provider_reference TEXT, updated_at TEXT NOT NULL,
 PRIMARY KEY(event_id,channel)
);
CREATE TABLE clinical_notification_events (
 id TEXT PRIMARY KEY, member_id INTEGER NOT NULL, record_id TEXT NOT NULL,
 order_number TEXT, kind TEXT NOT NULL, title TEXT NOT NULL, body TEXT NOT NULL,
 link TEXT NOT NULL, created_at TEXT NOT NULL, UNIQUE(id,member_id)
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
CREATE TABLE clinical_prescription_events (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL, version INTEGER NOT NULL, kind TEXT NOT NULL,
 actor_kind TEXT NOT NULL, actor_id INTEGER NOT NULL, public_json TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(record_id,version)
);
CREATE TABLE clinical_prescription_finance_tasks (
 id TEXT PRIMARY KEY, record_id TEXT NOT NULL, request_version INTEGER NOT NULL, order_number TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('refund_review','payment_required','cancellation_review')),
 amount_pence INTEGER NOT NULL CHECK(amount_pence>=0), currency TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'awaiting_review', source_json TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(record_id,request_version,kind)
);
CREATE TABLE clinical_prescription_requests (
 record_id TEXT PRIMARY KEY, order_number TEXT NOT NULL UNIQUE, member_id INTEGER NOT NULL,
 version INTEGER NOT NULL, state_json TEXT NOT NULL CHECK(json_valid(state_json)), updated_at TEXT NOT NULL
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
CREATE TABLE clinical_reviewer_assignments (
 record_id TEXT NOT NULL, reviewer_user_id INTEGER NOT NULL,
 active INTEGER NOT NULL DEFAULT 1, expires_at TEXT NOT NULL,
 PRIMARY KEY(record_id,reviewer_user_id)
);
CREATE TABLE cms_content (id INTEGER PRIMARY KEY AUTOINCREMENT,content_key TEXT NOT NULL UNIQUE,label TEXT NOT NULL,content_value TEXT NOT NULL,page TEXT,status TEXT NOT NULL DEFAULT 'draft',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE commerce_discount_codes (id INTEGER PRIMARY KEY AUTOINCREMENT,code TEXT NOT NULL UNIQUE COLLATE NOCASE,label TEXT NOT NULL,discount_type TEXT NOT NULL CHECK(discount_type IN ('percent','fixed')),discount_value INTEGER NOT NULL,active INTEGER NOT NULL DEFAULT 0,starts_at TEXT,ends_at TEXT,usage_limit INTEGER,usage_count INTEGER NOT NULL DEFAULT 0,minimum_subtotal_pence INTEGER NOT NULL DEFAULT 0,eligible_products_json TEXT NOT NULL DEFAULT '[]',created_by INTEGER,updated_by INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE commerce_inventory (
      product_id INTEGER NOT NULL,
      size TEXT NOT NULL,
      stock_on_hand INTEGER,
      reserved INTEGER NOT NULL DEFAULT 0,
      active INTEGER NOT NULL DEFAULT 1,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY(product_id,size),
      FOREIGN KEY(product_id) REFERENCES products(id)
    );
CREATE TABLE commerce_order_details (
      order_id INTEGER PRIMARY KEY,
      size TEXT NOT NULL,
      delivery_pence INTEGER NOT NULL DEFAULT 0,
      stripe_checkout_session_id TEXT UNIQUE,
      stripe_payment_intent_id TEXT,
      stripe_payment_status TEXT NOT NULL DEFAULT 'pending',
      shipping_name TEXT,
      shipping_address_json TEXT,
      last_stripe_event_type TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(order_id) REFERENCES orders(id)
    );
CREATE TABLE commerce_order_items (id INTEGER PRIMARY KEY AUTOINCREMENT,order_id INTEGER NOT NULL,product_id INTEGER NOT NULL,sku TEXT NOT NULL,product_name TEXT NOT NULL,colour TEXT NOT NULL,size TEXT NOT NULL,quantity INTEGER NOT NULL,unit_price_pence INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(order_id) REFERENCES orders(id),FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE commerce_product_details (product_id INTEGER PRIMARY KEY,category TEXT NOT NULL,image_key TEXT NOT NULL,featured_colour TEXT NOT NULL,colours_json TEXT NOT NULL,sizes_json TEXT NOT NULL,one_size INTEGER NOT NULL DEFAULT 0,sort_order INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE commerce_product_images (product_id INTEGER PRIMARY KEY,mime_type TEXT NOT NULL,image_base64 TEXT NOT NULL,alt_text TEXT NOT NULL,updated_by INTEGER,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE commerce_receipt_delivery ( order_id INTEGER NOT NULL, recipient_role TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'pending', provider_id TEXT, last_error TEXT, updated_at TEXT NOT NULL, PRIMARY KEY(order_id,recipient_role) );
CREATE TABLE commerce_refunds (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      order_id INTEGER NOT NULL,
      stripe_refund_id TEXT NOT NULL UNIQUE,
      amount_pence INTEGER NOT NULL,
      reason TEXT,
      environment TEXT NOT NULL,
      created_by TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(order_id) REFERENCES orders(id)
    );
CREATE TABLE commerce_service_delivery(event_key TEXT PRIMARY KEY,order_id INTEGER NOT NULL,event_type TEXT NOT NULL,recipient_hash TEXT NOT NULL,template_version TEXT NOT NULL,payload_hash TEXT NOT NULL,status TEXT NOT NULL,provider_id TEXT,error_code TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE consents (   id INTEGER PRIMARY KEY AUTOINCREMENT,   user_id INTEGER NOT NULL,   consent_type TEXT NOT NULL,   consent_version TEXT,   granted INTEGER NOT NULL DEFAULT 0,   granted_at TEXT,   withdrawn_at TEXT,   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,   FOREIGN KEY (user_id) REFERENCES users(id) );
CREATE TABLE contact_activity (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,email TEXT,person_name TEXT,event_key TEXT NOT NULL,detail TEXT,source TEXT,metadata_json TEXT,occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE contact_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT,ip_hash TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE content_opportunities (id INTEGER PRIMARY KEY AUTOINCREMENT,opportunity_key TEXT NOT NULL UNIQUE,title TEXT NOT NULL,reason TEXT,priority INTEGER NOT NULL DEFAULT 50,status TEXT NOT NULL DEFAULT 'open',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE continuity_interest (id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT NOT NULL UNIQUE COLLATE NOCASE,first_name TEXT,intent TEXT NOT NULL DEFAULT 'unspecified',source TEXT NOT NULL DEFAULT 'unknown',consent_version TEXT NOT NULL,consented_at TEXT NOT NULL,active INTEGER NOT NULL DEFAULT 1,withdrawn_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE continuity_interest_attempts (id INTEGER PRIMARY KEY AUTOINCREMENT,ip_hash TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE conversation_messages (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,channel TEXT NOT NULL,direction TEXT NOT NULL,address TEXT,subject TEXT,body TEXT NOT NULL,thread_key TEXT,source_id TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE crm_notes (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,note_type TEXT NOT NULL DEFAULT 'general',note TEXT NOT NULL,created_by TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY (user_id) REFERENCES users(id));
CREATE TABLE daily_checkin_actions (
 id TEXT PRIMARY KEY,
 checkin_id INTEGER NOT NULL UNIQUE REFERENCES check_ins(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 action_json TEXT NOT NULL CHECK(json_valid(action_json)),
 created_at TEXT NOT NULL,
 feedback TEXT CHECK(feedback IN ('helped','not-fit','not-tried','skip')),
 revision INTEGER NOT NULL DEFAULT 0,
 reviewed_at TEXT
);
CREATE TABLE data_requests (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,request_type TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'received',received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,completed_at TEXT,FOREIGN KEY (user_id) REFERENCES users(id));
CREATE TABLE fit_notification_config (id INTEGER PRIMARY KEY CHECK(id=1),public_key TEXT NOT NULL,private_key TEXT NOT NULL,subject TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE fit_push_subscriptions (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,endpoint TEXT NOT NULL UNIQUE,p256dh TEXT NOT NULL,auth TEXT NOT NULL,permission_granted_at TEXT NOT NULL,revoked_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE fit_reminder_deliveries (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,local_date TEXT NOT NULL,channel TEXT NOT NULL,status TEXT NOT NULL,decision_mode TEXT,target_hour INTEGER,suppression_reason TEXT,sent_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,local_date,channel));
CREATE TABLE fit_reminder_preferences (user_id INTEGER PRIMARY KEY,enabled INTEGER NOT NULL DEFAULT 0,preferred_hour INTEGER NOT NULL DEFAULT 7,timezone TEXT NOT NULL DEFAULT 'Europe/London',learn_timing INTEGER NOT NULL DEFAULT 1,consented_at TEXT,withdrawn_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, evening_enabled INTEGER NOT NULL DEFAULT 0, evening_hour INTEGER NOT NULL DEFAULT 18, weekly_enabled INTEGER NOT NULL DEFAULT 0);
CREATE TABLE gp_directory_active (
 singleton INTEGER PRIMARY KEY CHECK(singleton=1), version TEXT NOT NULL REFERENCES gp_directory_versions(version)
);
CREATE TABLE gp_directory_postcodes (
 version TEXT NOT NULL REFERENCES gp_directory_versions(version), postcode TEXT NOT NULL,
 east INTEGER NOT NULL, north INTEGER NOT NULL, PRIMARY KEY(version,postcode)
);
CREATE TABLE gp_directory_practices (
 version TEXT NOT NULL REFERENCES gp_directory_versions(version), code TEXT NOT NULL,
 nation TEXT NOT NULL CHECK(nation IN ('England','Wales','Scotland','Northern Ireland')),
 name TEXT NOT NULL, search_text TEXT NOT NULL, address_json TEXT NOT NULL,
 postcode TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL,
 east INTEGER, north INTEGER, parent_code TEXT, entry_kind TEXT NOT NULL DEFAULT 'practice', PRIMARY KEY(version,code)
);
CREATE TABLE gp_directory_versions (
 version TEXT PRIMARY KEY, imported_at TEXT NOT NULL, counts_json TEXT NOT NULL,
 sources_json TEXT NOT NULL, complete INTEGER NOT NULL CHECK(complete IN (0,1))
);
CREATE TABLE health_passport_records (
 id TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 record_type TEXT NOT NULL CHECK(record_type IN ('start_here','treatment')),
 request_key TEXT NOT NULL,
 payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
 revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
 created_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 UNIQUE(user_id, record_type, request_key)
);
CREATE TABLE hq_ai_conversation (id INTEGER PRIMARY KEY AUTOINCREMENT,user_key TEXT NOT NULL,role TEXT NOT NULL,content TEXT NOT NULL,created_at TEXT DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE hq_analytics_snapshots(id TEXT PRIMARY KEY,provider TEXT NOT NULL,property_id TEXT NOT NULL,window_start TEXT NOT NULL,window_end TEXT NOT NULL,time_zone TEXT NOT NULL,captured_at TEXT NOT NULL,evidence_sha256 TEXT NOT NULL,payload_json TEXT NOT NULL);
CREATE TABLE hq_audit (id INTEGER PRIMARY KEY AUTOINCREMENT,hq_user_id INTEGER,action TEXT NOT NULL,entity_type TEXT,entity_id TEXT,metadata TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(hq_user_id) REFERENCES hq_users(id));
CREATE TABLE hq_comms_audit(id INTEGER PRIMARY KEY AUTOINCREMENT,draft_id TEXT,actor_id INTEGER,action TEXT NOT NULL,at TEXT NOT NULL);
CREATE TABLE hq_comms_delivery_proofs(proof_key TEXT PRIMARY KEY,state TEXT NOT NULL,provider_id TEXT,error_code TEXT,at TEXT NOT NULL,payload_hash TEXT NOT NULL,scope TEXT NOT NULL);
CREATE TABLE hq_comms_devices(endpoint TEXT PRIMARY KEY,user_id INTEGER NOT NULL,session_id TEXT NOT NULL,p256dh TEXT NOT NULL,auth TEXT NOT NULL,consented_at TEXT NOT NULL,expires_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE hq_comms_drafts(id TEXT PRIMARY KEY,hash TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'draft',scheduled_at TEXT NOT NULL,created_by INTEGER NOT NULL,approved_by INTEGER,created_at TEXT NOT NULL,approved_at TEXT,cancelled_at TEXT);
CREATE TABLE hq_comms_push_receipts(draft_id TEXT NOT NULL,endpoint TEXT NOT NULL,status TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(draft_id,endpoint));
CREATE TABLE hq_comms_recipients(draft_id TEXT NOT NULL,email TEXT NOT NULL,user_id INTEGER,status TEXT NOT NULL DEFAULT 'pending',provider_id TEXT,error_code TEXT,at TEXT,read_at TEXT,PRIMARY KEY(draft_id,email),FOREIGN KEY(draft_id) REFERENCES hq_comms_drafts(id));
CREATE TABLE hq_copilot_log (id INTEGER PRIMARY KEY AUTOINCREMENT,hq_user_id INTEGER,question TEXT NOT NULL,answer TEXT NOT NULL,model TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE hq_job_runs (id INTEGER PRIMARY KEY AUTOINCREMENT,job_id INTEGER NOT NULL,status TEXT NOT NULL,result_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE hq_member_events (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,event_type TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'site',summary TEXT,payload_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE hq_member_notes (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,note TEXT NOT NULL,created_by TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE hq_mfa_challenges (id INTEGER PRIMARY KEY AUTOINCREMENT,hq_user_id INTEGER NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(hq_user_id) REFERENCES hq_users(id));
CREATE TABLE hq_notification_audit(id TEXT PRIMARY KEY,event_key TEXT NOT NULL,action TEXT NOT NULL,reason TEXT,at TEXT NOT NULL);
CREATE TABLE hq_notification_config(id INTEGER PRIMARY KEY CHECK(id=1),started_at TEXT NOT NULL);
CREATE TABLE hq_notification_intents(event_key TEXT PRIMARY KEY,source TEXT NOT NULL,source_id TEXT NOT NULL,occurred_at TEXT NOT NULL,recipient_kind TEXT NOT NULL,recipient_user_id INTEGER,template TEXT NOT NULL,link TEXT NOT NULL,state TEXT NOT NULL DEFAULT 'awaiting_review',draft_id TEXT,reason TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE hq_notification_receipt_observations(id TEXT PRIMARY KEY,proof_key TEXT NOT NULL,provider_id TEXT NOT NULL,evidence_kind TEXT NOT NULL CHECK(evidence_kind='inbox_observed'),observed_at TEXT NOT NULL,mailbox_received_at TEXT NOT NULL,source_ref TEXT NOT NULL,scope TEXT NOT NULL);
CREATE TABLE hq_notification_run_origins(run_id TEXT PRIMARY KEY,trigger_kind TEXT NOT NULL CHECK(trigger_kind IN ('manual','scheduled')),scheduled_at TEXT);
CREATE TABLE hq_notification_runs(id TEXT PRIMARY KEY,started_at TEXT NOT NULL,completed_at TEXT,status TEXT NOT NULL,candidates INTEGER NOT NULL DEFAULT 0,created INTEGER NOT NULL DEFAULT 0,error_code TEXT);
CREATE TABLE hq_operational_exception_audit(id TEXT PRIMARY KEY,event_key TEXT NOT NULL,actor_id INTEGER,action TEXT NOT NULL,note TEXT,at TEXT NOT NULL);
CREATE TABLE hq_operational_exceptions(event_key TEXT PRIMARY KEY,source TEXT NOT NULL,source_id TEXT NOT NULL,source_occurred_at TEXT,owner_name TEXT NOT NULL,next_action TEXT NOT NULL,opened_at TEXT NOT NULL,due_at TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','acknowledged','resolved')),acknowledged_by INTEGER,acknowledged_at TEXT,resolved_by INTEGER,resolved_at TEXT,resolution_note TEXT);
CREATE TABLE hq_operational_monitor_runs(id TEXT PRIMARY KEY,observed_at TEXT NOT NULL,coverage_json TEXT NOT NULL);
CREATE TABLE hq_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,channel TEXT NOT NULL DEFAULT 'email',destination TEXT,subject TEXT,body_html TEXT,body_text TEXT,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,scheduled_at TEXT,sent_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE hq_partner_handovers (
 id TEXT PRIMARY KEY,partner_id TEXT NOT NULL REFERENCES hq_partners(id),reference TEXT NOT NULL,service TEXT NOT NULL,
 status TEXT NOT NULL CHECK(status IN ('draft','review','blocked','closed')),owner_name TEXT NOT NULL DEFAULT '',next_action TEXT NOT NULL DEFAULT '',due_date TEXT,
 disclosure_status TEXT NOT NULL DEFAULT 'not_shared' CHECK(disclosure_status IN ('not_shared','approved','withdrawn')),
 sharing_reference TEXT,sharing_expires_at TEXT,partner_task TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE hq_partner_memberships (
 id TEXT PRIMARY KEY,partner_id TEXT NOT NULL REFERENCES hq_partners(id),principal_id TEXT NOT NULL,
 role TEXT NOT NULL CHECK(role IN ('partner_admin','partner_operator','partner_readonly')),status TEXT NOT NULL CHECK(status IN ('pending','active','disabled')),
 created_at TEXT NOT NULL,UNIQUE(partner_id,principal_id)
);
CREATE TABLE hq_partners (
 id TEXT PRIMARY KEY,name TEXT NOT NULL,service TEXT NOT NULL CHECK(service IN ('pharmacy','trt','diagnostics','devices','nutrition','apparel','other')),
 model TEXT NOT NULL CHECK(model IN ('referral','shift_sale','undecided')),status TEXT NOT NULL CHECK(status IN ('exploring','discussion','agreed','active','paused','archived')),
 contact_name TEXT NOT NULL DEFAULT '',contact_email TEXT NOT NULL DEFAULT '',owner_name TEXT NOT NULL DEFAULT '',next_action TEXT NOT NULL DEFAULT '',due_date TEXT,
 shift_responsibility TEXT NOT NULL DEFAULT '',partner_responsibility TEXT NOT NULL DEFAULT '',integration_status TEXT NOT NULL DEFAULT 'not_started' CHECK(integration_status IN ('not_started','mapping','testing','ready','active')),commercial_notes TEXT NOT NULL DEFAULT '',version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL
);
CREATE TABLE hq_scheduled_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,job_key TEXT NOT NULL UNIQUE,cron_hint TEXT,enabled INTEGER NOT NULL DEFAULT 1,last_run_at TEXT,next_run_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE hq_service_job_registry(job_key TEXT PRIMARY KEY,activated_at TEXT NOT NULL,cadence_minutes INTEGER NOT NULL,owner_name TEXT NOT NULL);
CREATE TABLE hq_service_job_runs(id TEXT PRIMARY KEY,job_key TEXT NOT NULL,scheduled_at TEXT,started_at TEXT NOT NULL,completed_at TEXT,status TEXT NOT NULL CHECK(status IN ('running','completed','failed')),counters_json TEXT,outcome TEXT,error_code TEXT);
CREATE TABLE hq_sessions (id INTEGER PRIMARY KEY AUTOINCREMENT,hq_user_id INTEGER NOT NULL,token_hash TEXT NOT NULL UNIQUE,expires_at TEXT NOT NULL,revoked_at TEXT,last_used_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(hq_user_id) REFERENCES hq_users(id));
CREATE TABLE hq_tasks (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,title TEXT NOT NULL,description TEXT,status TEXT NOT NULL DEFAULT 'open',due_at TEXT,completed_at TEXT,assigned_to TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY (user_id) REFERENCES users(id));
CREATE TABLE hq_users (id INTEGER PRIMARY KEY AUTOINCREMENT,email TEXT NOT NULL UNIQUE,name TEXT NOT NULL,password_hash TEXT NOT NULL,role TEXT NOT NULL DEFAULT 'readonly',status TEXT NOT NULL DEFAULT 'active',mfa_secret TEXT,mfa_enabled INTEGER NOT NULL DEFAULT 0,last_login_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE hydration_log (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,drink_type TEXT NOT NULL,volume_ml INTEGER NOT NULL,contribution_ml INTEGER NOT NULL,caffeine_mg REAL,calories REAL,alcohol_units REAL,logged_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE integration_webhooks (   id INTEGER PRIMARY KEY AUTOINCREMENT,    provider_id INTEGER,   pharmacy_order_id INTEGER,    event_type TEXT,   external_event_id TEXT,    payload TEXT NOT NULL,   signature_valid INTEGER,   processed INTEGER NOT NULL DEFAULT 0,    processing_error TEXT,    received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,   processed_at TEXT,    FOREIGN KEY (provider_id) REFERENCES pharmacy_providers(id),   FOREIGN KEY (pharmacy_order_id) REFERENCES pharmacy_orders(id) );
CREATE TABLE intelligence_questions (id INTEGER PRIMARY KEY AUTOINCREMENT,normalized_key TEXT NOT NULL UNIQUE,example_question TEXT NOT NULL,category TEXT,status TEXT NOT NULL DEFAULT 'discovered',occurrence_count INTEGER NOT NULL DEFAULT 1,first_seen_at TEXT,last_seen_at TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE knowledge_article_reviews (
    article_id INTEGER PRIMARY KEY,
    decision TEXT NOT NULL,
    reviewer_id INTEGER,
    reviewer_name TEXT NOT NULL,
    reviewer_email TEXT,
    notes TEXT,
    reviewed_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );
CREATE TABLE knowledge_articles (id INTEGER PRIMARY KEY AUTOINCREMENT,title TEXT NOT NULL,slug TEXT NOT NULL UNIQUE,category TEXT,author TEXT,status TEXT NOT NULL DEFAULT 'draft',summary TEXT,body TEXT,seo_title TEXT,publish_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE knowledge_blog_controls(name TEXT PRIMARY KEY,value TEXT NOT NULL,reason TEXT,updated_at TEXT);
CREATE TABLE knowledge_blog_keys(id TEXT PRIMARY KEY,label TEXT NOT NULL,token_hash TEXT NOT NULL UNIQUE,active INTEGER NOT NULL,created_at TEXT NOT NULL,revoked_at TEXT);
CREATE TABLE knowledge_blog_media(id TEXT PRIMARY KEY,key_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,content_hash TEXT NOT NULL,object_key TEXT NOT NULL UNIQUE,extension TEXT NOT NULL,mime_type TEXT NOT NULL,size_bytes INTEGER NOT NULL,state TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(key_id,idempotency_key));
CREATE TABLE knowledge_blog_pages(slug TEXT PRIMARY KEY,article_id INTEGER NOT NULL,submission_id TEXT NOT NULL,row_hash TEXT NOT NULL,metadata_json TEXT NOT NULL,published_at TEXT NOT NULL);
CREATE TABLE knowledge_blog_review_days(day_key TEXT PRIMARY KEY,submission_id TEXT NOT NULL,claimed_at TEXT NOT NULL);
CREATE TABLE knowledge_blog_submissions(id TEXT PRIMARY KEY,key_id TEXT NOT NULL,idempotency_key TEXT NOT NULL,payload_hash TEXT NOT NULL,payload_json TEXT NOT NULL,slug TEXT,state TEXT NOT NULL,reasons_json TEXT NOT NULL,base_json TEXT,base_hash TEXT NOT NULL,due_at TEXT,review_json TEXT,approved_hash TEXT,approved_base_hash TEXT,approved_by TEXT,approved_at TEXT,claim TEXT,receipt_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(key_id,idempotency_key));
CREATE TABLE knowledge_blog_versions(id TEXT PRIMARY KEY NOT NULL,slug TEXT NOT NULL,submission_id TEXT NOT NULL,before_json TEXT,before_metadata_json TEXT,after_json TEXT NOT NULL,after_metadata_json TEXT NOT NULL,approved_by TEXT,created_at TEXT NOT NULL);
CREATE TABLE knowledge_daily_content_runs(day_key TEXT PRIMARY KEY, token TEXT NOT NULL, status TEXT NOT NULL, target_url TEXT, article_id INTEGER, evidence_json TEXT, draft_sha256 TEXT, reason TEXT, created_at TEXT NOT NULL, completed_at TEXT);
CREATE TABLE knowledge_editorial_briefs (intent_key TEXT PRIMARY KEY, question TEXT NOT NULL, audience TEXT NOT NULL, cluster TEXT NOT NULL, target_url TEXT NOT NULL, brief_json TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0, demand_basis TEXT NOT NULL DEFAULT 'editorial_hypothesis', state TEXT NOT NULL DEFAULT 'planned', created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE knowledge_editorial_events (event_key TEXT PRIMARY KEY, event_type TEXT NOT NULL, release_day TEXT, details_json TEXT NOT NULL, created_at TEXT NOT NULL);
CREATE TABLE knowledge_editorial_jobs (job_key TEXT PRIMARY KEY, token TEXT NOT NULL, state TEXT NOT NULL, model_calls INTEGER NOT NULL DEFAULT 0, usage_json TEXT, draft_json TEXT, review_json TEXT, support_json TEXT, evidence_json TEXT, started_at TEXT NOT NULL, finished_at TEXT, reason TEXT);
CREATE TABLE knowledge_editorial_page_meta (source_uri TEXT PRIMARY KEY, canonical TEXT NOT NULL, audience TEXT, subject TEXT, source_links_json TEXT NOT NULL, review_dates_json TEXT NOT NULL, publication_date TEXT, content_sha256 TEXT NOT NULL, checked_at TEXT NOT NULL, state TEXT NOT NULL, reason TEXT);
CREATE TABLE knowledge_editorial_releases (release_day TEXT NOT NULL, intent_key TEXT NOT NULL, article_id INTEGER, slug TEXT NOT NULL, state TEXT NOT NULL, token TEXT PRIMARY KEY, policy TEXT NOT NULL, due_at TEXT NOT NULL, final_sha256 TEXT, payload_json TEXT NOT NULL, evidence_json TEXT, review_json TEXT, previous_json TEXT, attempts INTEGER NOT NULL DEFAULT 0, generated_at TEXT, published_at TEXT, verified_at TEXT, verification_json TEXT, notification_state TEXT NOT NULL DEFAULT 'pending', notification_receipt TEXT, reason TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL);
CREATE TABLE knowledge_proposals (id INTEGER PRIMARY KEY AUTOINCREMENT,source_question_id INTEGER,question TEXT NOT NULL,category TEXT,context_summary TEXT,proposed_answer TEXT,status TEXT NOT NULL DEFAULT 'draft',review_note TEXT,reviewed_by TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,reviewed_at TEXT);
CREATE TABLE knowledge_publication_email(slug TEXT PRIMARY KEY,status TEXT NOT NULL,recipient TEXT NOT NULL,created_at TEXT NOT NULL,sent_at TEXT,provider_message_id TEXT,last_error TEXT);
CREATE TABLE knowledge_publication_live_proof(slug TEXT PRIMARY KEY,body_sha256 TEXT NOT NULL,url TEXT NOT NULL,verified_at TEXT NOT NULL,workflow_sha TEXT NOT NULL);
CREATE TABLE lead_forms (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,slug TEXT NOT NULL UNIQUE,fields_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_by_hq_user_id INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE lead_submissions (id INTEGER PRIMARY KEY AUTOINCREMENT,form_id INTEGER NOT NULL,user_id INTEGER,email TEXT,payload_json TEXT NOT NULL,source TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE marketing_segments (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,rule_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_by_hq_user_id INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE medicine_clinical_intakes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  variant_id INTEGER NOT NULL,
  public_reference TEXT NOT NULL UNIQUE,
  partner_reference TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'submitted',
  gp_contact_consent INTEGER NOT NULL CHECK (gp_contact_consent = 1),
  consent_version TEXT NOT NULL,
  evidence_manifest_json TEXT NOT NULL,
  verification_issued_at TEXT,
  submitted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, provider_patient_reference TEXT, evidence_receipts_json TEXT NOT NULL DEFAULT '{}');
CREATE TABLE medicine_intake_attempts (public_reference TEXT PRIMARY KEY,user_id INTEGER NOT NULL,variant_id INTEGER NOT NULL,submission_hash TEXT NOT NULL,payload_hash TEXT NOT NULL,state TEXT NOT NULL,partner_reference TEXT,consent_version TEXT NOT NULL,evidence_receipts_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(user_id,variant_id,submission_hash),FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE medicine_inventory (variant_id INTEGER PRIMARY KEY,stock_on_hand INTEGER NOT NULL DEFAULT 0,reserved INTEGER NOT NULL DEFAULT 0,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(variant_id) REFERENCES medicine_variants(id));
CREATE TABLE medicine_orders (id INTEGER PRIMARY KEY AUTOINCREMENT,order_number TEXT NOT NULL UNIQUE,user_id INTEGER NOT NULL,email TEXT NOT NULL,medicine_id INTEGER NOT NULL,variant_id INTEGER NOT NULL,medicine_name TEXT NOT NULL,strength_label TEXT NOT NULL,unit_price_pence INTEGER NOT NULL,discount_code TEXT,discount_pence INTEGER NOT NULL DEFAULT 0,total_pence INTEGER NOT NULL,currency TEXT NOT NULL DEFAULT 'GBP',status TEXT NOT NULL DEFAULT 'pending',stripe_checkout_session_id TEXT UNIQUE,stripe_payment_intent_id TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, stripe_error_json TEXT, clinical_status TEXT NOT NULL DEFAULT 'not_started', clinical_reason_code TEXT, clinical_updated_at TEXT, journey_setup_required INTEGER NOT NULL DEFAULT 0, journey_setup_completed_at TEXT, reorder_of_order_id INTEGER, reorder_eligible_at TEXT, clinical_intake_submitted_at TEXT, clinical_intake_reference TEXT, prescription_workflow_version INTEGER NOT NULL DEFAULT 0, prescription_reference TEXT, signed_record_reference TEXT, prescriber_reference TEXT, prescription_json TEXT, prescription_signed_at TEXT, prescription_sent_at TEXT, pharmacy_received_at TEXT, pharmacy_receipt_reference TEXT, prescription_event_reference TEXT, prescription_event_at TEXT);
CREATE TABLE medicine_prepay_verifications (token_hash TEXT PRIMARY KEY,user_id INTEGER NOT NULL,variant_id INTEGER NOT NULL,partner_reference TEXT NOT NULL,expires_at TEXT NOT NULL,used_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE medicine_prescription_events (
    event_reference TEXT PRIMARY KEY, order_id INTEGER NOT NULL,
    payload_hash TEXT NOT NULL, from_status TEXT NOT NULL, to_status TEXT NOT NULL,
    prescription_reference TEXT NOT NULL, occurred_at TEXT NOT NULL, received_at TEXT NOT NULL,
    FOREIGN KEY(order_id) REFERENCES medicine_orders(id)
  );
CREATE TABLE medicine_product_images (medicine_id INTEGER PRIMARY KEY,mime_type TEXT NOT NULL,image_base64 TEXT NOT NULL,alt_text TEXT NOT NULL,updated_by INTEGER,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(medicine_id) REFERENCES medicine_products(id));
CREATE TABLE medicine_products (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,active_ingredient TEXT NOT NULL,form TEXT NOT NULL CHECK(form IN ('injection','tablet','capsule')),status TEXT NOT NULL DEFAULT 'out_of_stock' CHECK(status IN ('draft','out_of_stock','available','archived')),description TEXT NOT NULL DEFAULT '',sort_order INTEGER NOT NULL DEFAULT 0,created_by INTEGER,updated_by INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, partner TEXT, sellable INTEGER NOT NULL DEFAULT 0, availability_state TEXT NOT NULL DEFAULT 'unavailable');
CREATE TABLE medicine_stripe_events (stripe_event_id TEXT PRIMARY KEY,event_type TEXT NOT NULL,received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,processed_at TEXT,processing_error TEXT);
CREATE TABLE medicine_variant_price_history (id INTEGER PRIMARY KEY AUTOINCREMENT,variant_id INTEGER NOT NULL,cost_pence INTEGER NOT NULL,target_margin_bps INTEGER NOT NULL,selling_price_pence INTEGER NOT NULL,changed_by INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(variant_id) REFERENCES medicine_variants(id));
CREATE TABLE medicine_variants (id INTEGER PRIMARY KEY AUTOINCREMENT,medicine_id INTEGER NOT NULL,strength_label TEXT NOT NULL,cost_pence INTEGER NOT NULL DEFAULT 0,selling_price_pence INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'out_of_stock' CHECK(status IN ('out_of_stock','available','archived')),sort_order INTEGER NOT NULL DEFAULT 0,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, target_margin_bps INTEGER NOT NULL DEFAULT 6000, partner TEXT, sellable INTEGER NOT NULL DEFAULT 0, availability_state TEXT NOT NULL DEFAULT 'unavailable',UNIQUE(medicine_id,strength_label),FOREIGN KEY(medicine_id) REFERENCES medicine_products(id));
CREATE TABLE medicines_watch_checks (
  source_id TEXT PRIMARY KEY,
  source_url TEXT NOT NULL,
  check_url TEXT NOT NULL,
  last_attempt_at TEXT,
  last_success_at TEXT,
  last_failure_at TEXT,
  attempt_status TEXT NOT NULL DEFAULT 'never',
  next_check_at TEXT,
  last_http_status INTEGER,
  last_error TEXT,
  last_fingerprint TEXT,
  last_withdrawn INTEGER NOT NULL DEFAULT 0 CHECK (last_withdrawn IN (0, 1))
);
CREATE TABLE member_account_details (
  user_id INTEGER PRIMARY KEY,
  revision INTEGER NOT NULL DEFAULT 0,
  body_json TEXT NOT NULL DEFAULT '{}',
  last_operation TEXT,
  write_nonce TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE
);
CREATE TABLE member_food_catalogue (
 id TEXT PRIMARY KEY, name TEXT NOT NULL, source TEXT NOT NULL,
 body_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE member_food_entries(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,recorded_on TEXT NOT NULL,body_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE member_food_provider_quota (
 provider TEXT PRIMARY KEY, minute TEXT NOT NULL, requests INTEGER NOT NULL
);
CREATE TABLE member_medical_disclosures (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 revision INTEGER NOT NULL, body_json TEXT NOT NULL, confirmed_at TEXT NOT NULL,
 PRIMARY KEY(user_id,revision)
);
CREATE TABLE member_pen_day_notes (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,local_date TEXT NOT NULL,status TEXT NOT NULL,feel TEXT,note TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,local_date));
CREATE TABLE member_programmes (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,programme_name TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',started_at TEXT,ended_at TEXT,notes TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE member_signup_alerts (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','accepted','uncertain','suppressed')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  provider_id TEXT,
  last_error TEXT
);
CREATE TABLE member_state (user_id INTEGER PRIMARY KEY,my_why TEXT NOT NULL DEFAULT '{}',roadmap TEXT NOT NULL DEFAULT '{}',treatment_finder TEXT NOT NULL DEFAULT '{}',decision_readiness TEXT NOT NULL DEFAULT '{}',preferences TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY (user_id) REFERENCES users(id));
CREATE TABLE member_status (   id INTEGER PRIMARY KEY AUTOINCREMENT,   user_id INTEGER NOT NULL UNIQUE,   lifecycle_stage TEXT NOT NULL DEFAULT 'lead',   membership_status TEXT NOT NULL DEFAULT 'none',   source TEXT,   last_activity_at TEXT,   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,   updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,   FOREIGN KEY (user_id) REFERENCES users(id) );
CREATE TABLE member_targets (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,target_type TEXT NOT NULL DEFAULT 'weight',target_value REAL,target_unit TEXT,notes TEXT,status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE member_treatment_events (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 treatment_id TEXT NOT NULL REFERENCES member_treatment_records(id) ON DELETE CASCADE,
 kind TEXT NOT NULL, body_json TEXT NOT NULL, source TEXT NOT NULL DEFAULT 'member',
 occurred_at TEXT NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE member_treatment_push_deliveries (endpoint TEXT NOT NULL REFERENCES member_treatment_push_devices(endpoint) ON DELETE CASCADE,treatment_id TEXT NOT NULL REFERENCES member_treatment_records(id) ON DELETE CASCADE,scheduled_at TEXT NOT NULL,status TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(endpoint,treatment_id,scheduled_at));
CREATE TABLE member_treatment_push_devices (endpoint TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,session_id TEXT NOT NULL,p256dh TEXT NOT NULL,auth TEXT NOT NULL,enabled_at TEXT NOT NULL);
CREATE TABLE member_treatment_records (
 id TEXT PRIMARY KEY, user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 medicine TEXT NOT NULL, prescription_details TEXT NOT NULL, status TEXT NOT NULL,
 supply INTEGER NOT NULL, next_at TEXT, reminder_enabled INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 1, created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE message_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,channel TEXT NOT NULL,recipient TEXT NOT NULL,subject TEXT,body TEXT NOT NULL,template_id INTEGER,status TEXT NOT NULL DEFAULT 'queued',provider TEXT,provider_message_id TEXT,error TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,sent_at TEXT);
CREATE TABLE message_templates (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,channel TEXT NOT NULL,subject TEXT,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'active',created_by_hq_user_id INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE mt_v7_crew_invites (
 digest TEXT PRIMARY KEY, crew_id TEXT NOT NULL REFERENCES mt_v7_crews(id) ON DELETE CASCADE,
 creator_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, expires_at TEXT NOT NULL
);
CREATE TABLE mt_v7_crew_members (
 crew_id TEXT NOT NULL REFERENCES mt_v7_crews(id) ON DELETE CASCADE,
 user_id INTEGER NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
 alias TEXT NOT NULL, joined_at TEXT NOT NULL, PRIMARY KEY(crew_id,user_id)
);
CREATE TABLE mt_v7_crews (
 id TEXT PRIMARY KEY, created_by INTEGER REFERENCES users(id) ON DELETE SET NULL, created_at TEXT NOT NULL
);
CREATE TABLE mt_v7_effort (
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE, week TEXT NOT NULL,
 logs INTEGER NOT NULL CHECK(logs BETWEEN 0 AND 7), updated_at TEXT NOT NULL, PRIMARY KEY(user_id,week)
);
CREATE TABLE my_journey_weekly_checkins (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,week_ending TEXT NOT NULL,route TEXT NOT NULL,weight_kg REAL,waist_cm REAL,overall_feeling TEXT NOT NULL,mood TEXT,energy TEXT,confidence TEXT,sleep TEXT,appetite TEXT,physical_comfort TEXT,gut_symptoms TEXT,treatment_on_schedule INTEGER,treatment_context_json TEXT NOT NULL DEFAULT '{}',food_context_json TEXT NOT NULL DEFAULT '{}',movement_context_json TEXT NOT NULL DEFAULT '{}',hydration_context_json TEXT NOT NULL DEFAULT '{}',clothes_fit TEXT NOT NULL,clothes_detail_json TEXT NOT NULL DEFAULT '{}',life_back_json TEXT NOT NULL DEFAULT '{}',disruptions_json TEXT NOT NULL DEFAULT '[]',note TEXT,confirmed_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,week_ending));
CREATE TABLE my_timber_performance_alerts (hour TEXT NOT NULL,screen TEXT NOT NULL,visit TEXT NOT NULL,reason TEXT NOT NULL,median_ms INTEGER,samples INTEGER NOT NULL,PRIMARY KEY(hour,screen,visit,reason));
CREATE TABLE my_timber_performance_buckets (hour TEXT NOT NULL,screen TEXT NOT NULL,visit TEXT NOT NULL,metric TEXT NOT NULL,bucket_ms INTEGER NOT NULL,n INTEGER NOT NULL DEFAULT 0,PRIMARY KEY(hour,screen,visit,metric,bucket_ms));
CREATE TABLE my_timber_push_deliveries (
 endpoint TEXT NOT NULL,local_date TEXT NOT NULL,status TEXT NOT NULL,at TEXT NOT NULL,
 PRIMARY KEY(endpoint,local_date),FOREIGN KEY(endpoint) REFERENCES my_timber_push_devices(endpoint) ON DELETE CASCADE);
CREATE TABLE my_timber_push_devices (
 endpoint TEXT PRIMARY KEY,user_id INTEGER NOT NULL,session_id TEXT NOT NULL,
 p256dh TEXT NOT NULL,auth TEXT NOT NULL,hour INTEGER NOT NULL DEFAULT 19,
 enabled INTEGER NOT NULL DEFAULT 0,consented_at TEXT NOT NULL,updated_at TEXT NOT NULL,
 last_test_at TEXT,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE my_timber_support_deliveries(endpoint TEXT NOT NULL,reminder_id TEXT NOT NULL,status TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(endpoint,reminder_id),FOREIGN KEY(endpoint) REFERENCES my_timber_support_devices(endpoint) ON DELETE CASCADE);
CREATE TABLE my_timber_support_delivery_history(user_id INTEGER NOT NULL,reminder_id TEXT NOT NULL,endpoint_hash TEXT NOT NULL,status TEXT NOT NULL,at TEXT NOT NULL,PRIMARY KEY(reminder_id,endpoint_hash),FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE my_timber_support_devices(endpoint TEXT PRIMARY KEY,user_id INTEGER NOT NULL,session_id TEXT NOT NULL,p256dh TEXT NOT NULL,auth TEXT NOT NULL,consented_at TEXT NOT NULL, background_until TEXT,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE my_timber_support_steps(user_id INTEGER PRIMARY KEY,revision INTEGER NOT NULL DEFAULT 0,state_json TEXT,operation_id TEXT,operation_hash TEXT,updated_at TEXT NOT NULL,FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE);
CREATE TABLE order_reference_registry ( order_number TEXT PRIMARY KEY, channel TEXT NOT NULL CHECK(channel IN ('apparel','medicine','pharmacy','membership','service','other')), source_table TEXT, source_id INTEGER, user_id INTEGER, status TEXT NOT NULL DEFAULT 'reserved', created_at TEXT NOT NULL, updated_at TEXT NOT NULL );
CREATE TABLE orders (id INTEGER PRIMARY KEY AUTOINCREMENT,order_number TEXT NOT NULL UNIQUE,user_id INTEGER,customer_email TEXT,customer_name TEXT,product_id INTEGER,quantity INTEGER NOT NULL DEFAULT 1,subtotal_pence INTEGER NOT NULL DEFAULT 0,total_pence INTEGER NOT NULL DEFAULT 0,currency TEXT NOT NULL DEFAULT 'GBP',status TEXT NOT NULL DEFAULT 'new',payment_status TEXT NOT NULL DEFAULT 'pending',notes TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(product_id) REFERENCES products(id));
CREATE TABLE partner_access_tokens (
 token_hash TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES partner_staff(id),
 kind TEXT NOT NULL CHECK(kind IN ('application','activation')), expires_at TEXT NOT NULL,
 used_at TEXT, issued_by INTEGER NOT NULL, created_at TEXT NOT NULL
);
CREATE TABLE partner_audit (
 id TEXT PRIMARY KEY, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL, version INTEGER NOT NULL,
 actor_id TEXT NOT NULL, action TEXT NOT NULL, details_json TEXT NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(entity_type,entity_id,version)
);
CREATE TABLE partner_auth_limits (
 scope_hash TEXT NOT NULL, window_start INTEGER NOT NULL, expires_at INTEGER NOT NULL,
 attempt_count INTEGER NOT NULL, PRIMARY KEY(scope_hash,window_start)
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
CREATE TABLE partner_commissioning_orders (
 order_number TEXT PRIMARY KEY CHECK(order_number LIKE 'TEST-%'),
 version INTEGER NOT NULL, state_json TEXT NOT NULL CHECK(json_extract(state_json,'$.synthetic')=1),
 created_by TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE partner_fulfilment (
 order_number TEXT PRIMARY KEY, partner_id TEXT NOT NULL, member_id INTEGER NOT NULL,
 version INTEGER NOT NULL DEFAULT 0, state_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE partner_hq_messages(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES partner_hq_threads(id),version INTEGER NOT NULL,actor_id INTEGER NOT NULL,actor_kind TEXT NOT NULL,body TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(thread_id,version));
CREATE TABLE partner_hq_threads(id TEXT PRIMARY KEY,order_number TEXT NOT NULL,org_id TEXT NOT NULL,staff_id TEXT NOT NULL,subject TEXT NOT NULL,priority TEXT NOT NULL DEFAULT 'normal',status TEXT NOT NULL DEFAULT 'awaiting_hq',version INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE partner_invitation_drafts (
 id TEXT PRIMARY KEY, kind TEXT NOT NULL CHECK(kind IN ('partner','clinician')),
 org_id TEXT NOT NULL, staff_id TEXT, profile_version INTEGER,
 recipient_name TEXT NOT NULL, recipient_email TEXT NOT NULL,
 subject TEXT NOT NULL, body TEXT NOT NULL,
 status TEXT NOT NULL DEFAULT 'held_onboarding_closed',
 created_by INTEGER NOT NULL, created_at TEXT NOT NULL,
 UNIQUE(kind,org_id,staff_id,profile_version,recipient_email)
);
CREATE TABLE partner_notification_outbox (
 id TEXT PRIMARY KEY, event_id TEXT NOT NULL UNIQUE REFERENCES partner_audit(id), order_number TEXT NOT NULL,
 member_id INTEGER NOT NULL, template TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'draft', created_at TEXT NOT NULL
);
CREATE TABLE partner_organisations (
 id TEXT PRIMARY KEY, version INTEGER NOT NULL DEFAULT 0, state_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE partner_staff (
 id TEXT PRIMARY KEY, hq_user_id INTEGER UNIQUE, username TEXT UNIQUE COLLATE NOCASE,
 kind TEXT NOT NULL CHECK(kind IN ('clinician','dispensing')), org_id TEXT NOT NULL,
 version INTEGER NOT NULL DEFAULT 0, state_json TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE TABLE partner_workflow_sync(id INTEGER PRIMARY KEY AUTOINCREMENT,source_key TEXT NOT NULL UNIQUE,record_id TEXT NOT NULL,order_number TEXT NOT NULL,member_id INTEGER NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',attempts INTEGER NOT NULL DEFAULT 0,last_error TEXT,created_at TEXT NOT NULL,completed_at TEXT);
CREATE TABLE pharmacy_events (   id INTEGER PRIMARY KEY AUTOINCREMENT,    pharmacy_order_id INTEGER NOT NULL,    event_type TEXT NOT NULL,   event_status TEXT,   event_message TEXT,   raw_payload TEXT,    occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,    FOREIGN KEY (pharmacy_order_id) REFERENCES pharmacy_orders(id) );
CREATE TABLE pharmacy_orders (   id INTEGER PRIMARY KEY AUTOINCREMENT,    case_id INTEGER NOT NULL,   user_id INTEGER NOT NULL,    provider TEXT,   external_order_id TEXT,   external_patient_id TEXT,    medication_name TEXT,   medication_strength TEXT,   quantity TEXT,    prescription_status TEXT NOT NULL DEFAULT 'pending',   pharmacy_status TEXT NOT NULL DEFAULT 'not_sent',    submitted_at TEXT,   accepted_at TEXT,   dispensed_at TEXT,   dispatched_at TEXT,   delivered_at TEXT,    tracking_number TEXT,   tracking_url TEXT,    provider_response TEXT,    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,   updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,    FOREIGN KEY (case_id) REFERENCES cases(id),   FOREIGN KEY (user_id) REFERENCES users(id) );
CREATE TABLE pharmacy_providers (   id INTEGER PRIMARY KEY AUTOINCREMENT,    provider_key TEXT NOT NULL UNIQUE,   provider_name TEXT NOT NULL,    api_base_url TEXT,   webhook_url TEXT,    active INTEGER NOT NULL DEFAULT 0,   sandbox_mode INTEGER NOT NULL DEFAULT 1,    supports_prescribing INTEGER NOT NULL DEFAULT 0,   supports_dispensing INTEGER NOT NULL DEFAULT 1,   supports_tracking INTEGER NOT NULL DEFAULT 1,    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,   updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE product_events (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,event_name TEXT NOT NULL,surface TEXT NOT NULL,session_id TEXT,source TEXT NOT NULL DEFAULT 'server',properties_json TEXT NOT NULL DEFAULT '{}',occurred_at TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE product_feedback (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,product TEXT NOT NULL,entity_id TEXT NOT NULL,sentiment TEXT NOT NULL CHECK(sentiment IN ('yay','nay')),reason TEXT,context_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, scope TEXT NOT NULL DEFAULT 'durable', expires_at TEXT, favourite INTEGER NOT NULL DEFAULT 0,UNIQUE(user_id,product,entity_id));
CREATE TABLE products (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,sku TEXT NOT NULL UNIQUE,product_type TEXT NOT NULL DEFAULT 'physical',price_pence INTEGER NOT NULL DEFAULT 0,status TEXT NOT NULL DEFAULT 'draft',description TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE progress_entries (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,recorded_on TEXT NOT NULL,weight_kg REAL,waist_cm REAL,systolic INTEGER,diastolic INTEGER,resting_hr INTEGER,steps INTEGER,protein_g REAL,sleep_hours REAL,mood_score INTEGER,notes TEXT,source TEXT NOT NULL DEFAULT 'member',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY (user_id) REFERENCES users(id));
CREATE TABLE questions (   id INTEGER PRIMARY KEY AUTOINCREMENT,   question_key TEXT NOT NULL UNIQUE,   question_text TEXT NOT NULL,   question_type TEXT NOT NULL DEFAULT 'single_choice',   options TEXT,   category TEXT,   sort_order INTEGER NOT NULL DEFAULT 0,   active INTEGER NOT NULL DEFAULT 1,   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE radar_audit (id INTEGER PRIMARY KEY AUTOINCREMENT,event_id INTEGER,action TEXT NOT NULL,actor TEXT NOT NULL,detail_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE radar_duplicate_cleanup (
  duplicate_event_id INTEGER PRIMARY KEY,
  canonical_event_id INTEGER NOT NULL,
  cleaned_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE radar_events (id INTEGER PRIMARY KEY AUTOINCREMENT,event_key TEXT NOT NULL UNIQUE,status TEXT NOT NULL DEFAULT 'detected',headline TEXT NOT NULL,region TEXT,regulator TEXT,event_type TEXT,relevance_score INTEGER DEFAULT 50,urgency_score INTEGER DEFAULT 50,confidence_score INTEGER DEFAULT 50,clinical INTEGER DEFAULT 1,requires_review INTEGER DEFAULT 1,source_evidence_json TEXT NOT NULL DEFAULT '[]',verification_json TEXT NOT NULL DEFAULT '{}',medicine_patch_json TEXT NOT NULL DEFAULT '{}',content_package_json TEXT NOT NULL DEFAULT '{}',review_note TEXT,reviewed_by TEXT,reviewed_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE radar_forward_milestones (id INTEGER PRIMARY KEY AUTOINCREMENT,subject TEXT NOT NULL,event TEXT NOT NULL,milestone_date TEXT NOT NULL,region TEXT DEFAULT 'GLOBAL',authority TEXT,source_url TEXT,relevance INTEGER DEFAULT 85,prepare_days_json TEXT NOT NULL DEFAULT '[30,14,7,2,1,0]',status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE radar_freshness_claims (id INTEGER PRIMARY KEY AUTOINCREMENT,claim_key TEXT NOT NULL UNIQUE,event_id INTEGER,claim_text TEXT NOT NULL,source_url TEXT,status TEXT NOT NULL DEFAULT 'active',next_check_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE radar_live_email(event_id INTEGER PRIMARY KEY,recipient TEXT NOT NULL,content_json TEXT NOT NULL,evidence_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'queued',attempts INTEGER NOT NULL DEFAULT 0,next_attempt_at TEXT NOT NULL,claim_token TEXT,claimed_at TEXT,sent_at TEXT,provider_message_id TEXT,last_error TEXT,created_at TEXT NOT NULL);
CREATE TABLE radar_medicines (id TEXT PRIMARY KEY,brand TEXT,generic_name TEXT,developer TEXT,mechanism_json TEXT NOT NULL DEFAULT '[]',formulation TEXT,global_stage TEXT,uk_regulatory_status TEXT,uk_commercial_status TEXT,nice_status TEXT,nhs_status TEXT,latest_update_text TEXT,radar_score INTEGER DEFAULT 50,regions_json TEXT NOT NULL DEFAULT '[]',last_verified_at TEXT,provenance_json TEXT NOT NULL DEFAULT '{}',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE radar_publication_history (id INTEGER PRIMARY KEY AUTOINCREMENT,event_id INTEGER NOT NULL,job_id INTEGER,version INTEGER NOT NULL DEFAULT 1,action TEXT NOT NULL,destinations_json TEXT NOT NULL DEFAULT '[]',snapshot_json TEXT NOT NULL DEFAULT '{}',actor TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE radar_publication_jobs (id INTEGER PRIMARY KEY AUTOINCREMENT,event_id INTEGER NOT NULL,site_payload_json TEXT NOT NULL DEFAULT '{}',brain_payload_json TEXT NOT NULL DEFAULT '{}',search_payload_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'queued',error_text TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,started_at TEXT,completed_at TEXT);
CREATE TABLE radar_scan_runs(id INTEGER PRIMARY KEY AUTOINCREMENT,source_id TEXT NOT NULL,authority TEXT NOT NULL,source_url TEXT NOT NULL,status TEXT NOT NULL,item_count INTEGER NOT NULL DEFAULT 0,new_event_count INTEGER NOT NULL DEFAULT 0,duration_ms INTEGER NOT NULL DEFAULT 0,detail_json TEXT NOT NULL DEFAULT '{}',completed_at TEXT NOT NULL);
CREATE TABLE radar_settings (setting_key TEXT PRIMARY KEY,value_json TEXT NOT NULL,updated_by INTEGER,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE radar_social_approvals (event_id INTEGER PRIMARY KEY,payload_hash TEXT NOT NULL,payload_json TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'approved',approved_by TEXT NOT NULL,approved_at TEXT NOT NULL,result_json TEXT NOT NULL DEFAULT '[]',published_at TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE radar_source_snapshots(source_id TEXT PRIMARY KEY,source_url TEXT NOT NULL,fetched_at TEXT NOT NULL,items_json TEXT NOT NULL,items_sha256 TEXT NOT NULL,document_sha256 TEXT NOT NULL,workflow_sha TEXT NOT NULL);
CREATE TABLE radar_sources(id TEXT PRIMARY KEY,authority TEXT NOT NULL,region TEXT NOT NULL DEFAULT 'GLOBAL',url TEXT NOT NULL,adapter TEXT NOT NULL CHECK(adapter IN ('feed','html','pubmed','clinicaltrials','europepmc')),event_type TEXT NOT NULL,tier INTEGER NOT NULL CHECK(tier BETWEEN 1 AND 4),confidence INTEGER NOT NULL DEFAULT 50,active INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE rx_access_request_limits(id TEXT PRIMARY KEY,attempts INTEGER NOT NULL,expires_at INTEGER NOT NULL);
CREATE TABLE rx_access_requests(id TEXT PRIMARY KEY,duplicate_key TEXT NOT NULL,payload_digest TEXT NOT NULL,details_json TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,reviewed_by INTEGER,review_note TEXT,onboarding_staff_id TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE rx_action_claims(record_id TEXT NOT NULL REFERENCES clinical_member_records(id),source_key TEXT NOT NULL,owner_user_id INTEGER NOT NULL,version INTEGER NOT NULL,acknowledged_at TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(record_id,source_key));
CREATE TABLE rx_diagnostic_alerts(order_id TEXT PRIMARY KEY REFERENCES rx_diagnostic_orders(id),priority TEXT NOT NULL,due_at TEXT NOT NULL,source_reference TEXT NOT NULL,acknowledged_by INTEGER,ack_reference TEXT,ack_at TEXT,version INTEGER NOT NULL);
CREATE TABLE rx_diagnostic_events(id TEXT PRIMARY KEY,order_id TEXT NOT NULL REFERENCES rx_diagnostic_orders(id),event_reference TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,source_reference TEXT NOT NULL,occurred_at TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE rx_diagnostic_orders(id TEXT PRIMARY KEY,record_id TEXT NOT NULL REFERENCES clinical_member_records(id),org_id TEXT NOT NULL,member_id INTEGER NOT NULL,requested_by INTEGER NOT NULL,contract_id TEXT NOT NULL,client_reference TEXT NOT NULL UNIQUE,status TEXT NOT NULL,version INTEGER NOT NULL,request_json TEXT NOT NULL,result_key TEXT,result_digest TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE rx_economics(order_number TEXT PRIMARY KEY,version INTEGER NOT NULL,terms_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE rx_finance_entries(id TEXT PRIMARY KEY,order_number TEXT NOT NULL REFERENCES rx_economics(order_number),event_reference TEXT NOT NULL UNIQUE,kind TEXT NOT NULL,amount_pence INTEGER NOT NULL,currency TEXT NOT NULL,source_reference TEXT NOT NULL,occurred_at TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE rx_followups(id TEXT PRIMARY KEY,record_id TEXT NOT NULL REFERENCES clinical_member_records(id),org_id TEXT NOT NULL,assigned_user_id INTEGER NOT NULL,kind TEXT NOT NULL,due_at TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE rx_future_routing(org_id TEXT NOT NULL,service TEXT NOT NULL,version INTEGER NOT NULL,contract_id TEXT NOT NULL REFERENCES rx_supplier_contracts(id),authorisation_reference TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(org_id,service));
CREATE TABLE rx_integration_events(id TEXT PRIMARY KEY,contract_id TEXT NOT NULL,event_reference TEXT NOT NULL,order_number TEXT NOT NULL REFERENCES rx_order_routes(order_number),kind TEXT NOT NULL,occurred_at TEXT NOT NULL,received_at TEXT NOT NULL,payload_digest TEXT NOT NULL,verified_source TEXT NOT NULL,event_json TEXT NOT NULL,state TEXT NOT NULL,UNIQUE(contract_id,event_reference));
CREATE TABLE rx_integration_jobs(id TEXT PRIMARY KEY,contract_id TEXT NOT NULL,order_number TEXT NOT NULL REFERENCES rx_order_routes(order_number),operation TEXT NOT NULL,idempotency_key TEXT NOT NULL UNIQUE,payload_digest TEXT NOT NULL,state TEXT NOT NULL,attempts INTEGER NOT NULL DEFAULT 0,remote_reference TEXT,last_code TEXT,next_attempt_at TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE rx_message_alerts(id TEXT PRIMARY KEY,recipient_kind TEXT NOT NULL,recipient_id TEXT,source TEXT NOT NULL,source_id TEXT NOT NULL,source_version INTEGER NOT NULL,status TEXT NOT NULL,draft_id TEXT,created_at TEXT NOT NULL);
CREATE TABLE rx_message_reads(thread_id TEXT NOT NULL REFERENCES rx_message_threads(id),actor_kind TEXT NOT NULL,actor_id INTEGER NOT NULL,version INTEGER NOT NULL,read_at TEXT NOT NULL,PRIMARY KEY(thread_id,actor_kind,actor_id));
CREATE TABLE rx_message_threads(id TEXT PRIMARY KEY,record_id TEXT NOT NULL REFERENCES clinical_member_records(id),order_number TEXT NOT NULL,member_id INTEGER NOT NULL,org_id TEXT NOT NULL REFERENCES partner_organisations(id),channel TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,UNIQUE(record_id,org_id,channel));
CREATE TABLE rx_messages(id TEXT PRIMARY KEY,thread_id TEXT NOT NULL REFERENCES rx_message_threads(id),version INTEGER NOT NULL,actor_kind TEXT NOT NULL,actor_id INTEGER NOT NULL,author_label TEXT NOT NULL,body TEXT NOT NULL,payload_digest TEXT NOT NULL,created_at TEXT NOT NULL,UNIQUE(thread_id,version));
CREATE TABLE rx_order_record_links(order_number TEXT PRIMARY KEY,record_id TEXT NOT NULL UNIQUE REFERENCES clinical_member_records(id),member_id INTEGER NOT NULL,source TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE rx_order_routes(order_number TEXT PRIMARY KEY,member_id INTEGER NOT NULL,clinical_org_id TEXT NOT NULL,pharmacy_org_id TEXT NOT NULL,contract_id TEXT NOT NULL REFERENCES rx_supplier_contracts(id),contract_version INTEGER NOT NULL,service TEXT NOT NULL,prescription_id TEXT NOT NULL,product_mapping_json TEXT NOT NULL,authorisation_reference TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE rx_org_memberships(hq_user_id INTEGER NOT NULL,org_id TEXT NOT NULL REFERENCES partner_organisations(id),role TEXT NOT NULL,status TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(hq_user_id,org_id));
CREATE TABLE rx_platform_audit(id TEXT PRIMARY KEY,actor_id TEXT NOT NULL,org_id TEXT,entity_type TEXT NOT NULL,entity_id TEXT NOT NULL,action TEXT NOT NULL,detail_json TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE rx_product_mappings(contract_id TEXT NOT NULL REFERENCES rx_supplier_contracts(id),variant_id INTEGER NOT NULL,supplier_product_id TEXT NOT NULL,formulation TEXT NOT NULL,strength TEXT NOT NULL,pack_quantity TEXT NOT NULL,version INTEGER NOT NULL,PRIMARY KEY(contract_id,variant_id));
CREATE TABLE rx_repeat_requests(id TEXT PRIMARY KEY,previous_order_number TEXT NOT NULL,member_id INTEGER NOT NULL,client_reference TEXT NOT NULL UNIQUE,status TEXT NOT NULL,created_at TEXT NOT NULL);
CREATE TABLE rx_service_config(org_id TEXT NOT NULL,service TEXT NOT NULL,version INTEGER NOT NULL,config_json TEXT NOT NULL,updated_at TEXT NOT NULL,PRIMARY KEY(org_id,service));
CREATE TABLE rx_signing_origins(challenge_id TEXT PRIMARY KEY,origin TEXT NOT NULL);
CREATE TABLE rx_supplier_contracts(id TEXT PRIMARY KEY,org_id TEXT NOT NULL,adapter_id TEXT NOT NULL,version INTEGER NOT NULL,state TEXT NOT NULL,config_json TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE rx_supply_holds(id TEXT PRIMARY KEY,order_number TEXT NOT NULL,kind TEXT NOT NULL,org_id TEXT,opened_by INTEGER NOT NULL,state TEXT NOT NULL,version INTEGER NOT NULL,source_reference TEXT NOT NULL,review_reference TEXT,created_at TEXT NOT NULL,updated_at TEXT NOT NULL);
CREATE TABLE segment_members (segment_id INTEGER NOT NULL,user_id INTEGER NOT NULL,added_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(segment_id,user_id));
CREATE TABLE shift_ai_academy_runs (id INTEGER PRIMARY KEY AUTOINCREMENT,pass_rate REAL NOT NULL DEFAULT 0,passed INTEGER NOT NULL DEFAULT 0,total INTEGER NOT NULL DEFAULT 0,detail_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE shift_ai_conversations (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,direction TEXT NOT NULL,mode TEXT NOT NULL DEFAULT 'coach',body TEXT NOT NULL,model TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE shift_ai_member_memory (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,memory_key TEXT NOT NULL,memory_value TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,memory_key));
CREATE TABLE shift_ai_memory_v2 (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,memory_key TEXT NOT NULL,category TEXT NOT NULL,memory_value TEXT NOT NULL,confidence REAL NOT NULL DEFAULT 0.75,source TEXT NOT NULL DEFAULT 'conversation',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,memory_key));
CREATE TABLE shift_ai_pilot_access (user_id INTEGER PRIMARY KEY,status TEXT NOT NULL CHECK(status IN ('invited','active','revoked')),cohort INTEGER NOT NULL CHECK(cohort IN (1,2)),consent_version TEXT,consented_at TEXT,consent_evidence_ref TEXT,starts_at TEXT NOT NULL,ends_at TEXT NOT NULL,activated_by TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE shift_ai_pilot_control (id INTEGER PRIMARY KEY CHECK(id=1),enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),phase INTEGER NOT NULL DEFAULT 1 CHECK(phase IN (1,2)),max_members INTEGER NOT NULL DEFAULT 5 CHECK(max_members BETWEEN 1 AND 10),consent_version TEXT NOT NULL DEFAULT 'shift-ai-r4-pilot-consent-v1',starts_at TEXT,ends_at TEXT,stopped_at TEXT,stop_reason TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE shift_ai_privacy_settings (user_id INTEGER PRIMARY KEY, auto_memory INTEGER NOT NULL DEFAULT 1, proactive_insights INTEGER NOT NULL DEFAULT 1, proactive_cooldown_hours INTEGER NOT NULL DEFAULT 48, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE shift_ai_proactive_delivery (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,insight_id INTEGER NOT NULL,delivered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE shift_ai_proactive_insights (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,kind TEXT NOT NULL,title TEXT NOT NULL,body TEXT NOT NULL,confidence REAL NOT NULL DEFAULT 0.75,status TEXT NOT NULL DEFAULT 'open',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE shift_ai_proactive_outbox (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,insight_id INTEGER,title TEXT NOT NULL,body TEXT NOT NULL,channel TEXT NOT NULL DEFAULT 'in_app',status TEXT NOT NULL DEFAULT 'queued',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,delivered_at TEXT);
CREATE TABLE shift_ai_today_audit (id INTEGER PRIMARY KEY AUTOINCREMENT,proposal_id TEXT,user_id INTEGER NOT NULL,event_name TEXT NOT NULL,outcome TEXT NOT NULL,local_date TEXT NOT NULL,request_json TEXT NOT NULL DEFAULT '{}',result_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE shift_ai_today_proposals (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL,local_date TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'pending',classification TEXT NOT NULL,route TEXT,source TEXT NOT NULL,request_json TEXT NOT NULL,context_json TEXT NOT NULL,proposal_json TEXT NOT NULL,catalogue_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,expires_at TEXT NOT NULL,confirmed_at TEXT);
CREATE TABLE shift_dictionary (id INTEGER PRIMARY KEY AUTOINCREMENT,phrase TEXT NOT NULL UNIQUE,maps_to TEXT NOT NULL,category TEXT,status TEXT NOT NULL DEFAULT 'discovered',occurrence_count INTEGER NOT NULL DEFAULT 1,first_seen_at TEXT,last_seen_at TEXT,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE shift_knowledge_edges (   id INTEGER PRIMARY KEY AUTOINCREMENT,   from_id TEXT NOT NULL,   edge_type TEXT NOT NULL,   to_id TEXT NOT NULL,   weight REAL NOT NULL DEFAULT 1,   data_json TEXT NOT NULL DEFAULT '{}',   UNIQUE(from_id, edge_type, to_id) );
CREATE TABLE shift_knowledge_nodes (   id TEXT PRIMARY KEY,   node_type TEXT NOT NULL,   domain TEXT NOT NULL,   label TEXT NOT NULL,   data_json TEXT NOT NULL DEFAULT '{}',   status TEXT NOT NULL DEFAULT 'active',   updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE shift_knowledge_sources (   id INTEGER PRIMARY KEY AUTOINCREMENT,   node_id TEXT NOT NULL,   source_type TEXT NOT NULL,   source_ref TEXT NOT NULL,   authority INTEGER DEFAULT 50,   verified_at TEXT,   expires_at TEXT,   provenance_json TEXT NOT NULL DEFAULT '{}' );
CREATE TABLE shift_me_v1 (id TEXT PRIMARY KEY,user_id INTEGER NOT NULL UNIQUE,mime_type TEXT NOT NULL,image_base64 TEXT NOT NULL,appearance_json TEXT NOT NULL DEFAULT '{}',model TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,deleted_at TEXT);
CREATE TABLE shift_meal_preferences (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,meal_id TEXT NOT NULL,preference TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,meal_id));
CREATE TABLE shift_personal_state (   user_id INTEGER PRIMARY KEY,   profile_json TEXT NOT NULL DEFAULT '{}',   inventory_json TEXT NOT NULL DEFAULT '[]',   updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE shift_plan_actions (   id INTEGER PRIMARY KEY AUTOINCREMENT,   user_id INTEGER NOT NULL,   plan_id INTEGER,   local_date TEXT,   domain TEXT NOT NULL,   action_key TEXT NOT NULL,   planned_json TEXT NOT NULL DEFAULT '{}',   actual_json TEXT,   status TEXT NOT NULL DEFAULT 'planned',   completed_at TEXT );
CREATE TABLE shift_plans (   id INTEGER PRIMARY KEY AUTOINCREMENT,   user_id INTEGER NOT NULL,   plan_type TEXT NOT NULL,   starts_on TEXT NOT NULL,   ends_on TEXT,   version INTEGER NOT NULL DEFAULT 1,   status TEXT NOT NULL DEFAULT 'active',   plan_json TEXT NOT NULL,   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE shift_progress_photos (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,mime_type TEXT NOT NULL,image_data BLOB NOT NULL,weight_kg REAL,waist_cm REAL,captured_at TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'upload',is_original INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT);
CREATE TABLE shift_progress_photos_v2 (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,mime_type TEXT NOT NULL,image_base64 TEXT NOT NULL,weight_kg REAL,waist_cm REAL,captured_at TEXT NOT NULL,source TEXT NOT NULL DEFAULT 'upload',is_original INTEGER NOT NULL DEFAULT 1,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT, note TEXT NOT NULL DEFAULT '', operation_id TEXT);
CREATE TABLE shift_recommendation_log (   id INTEGER PRIMARY KEY AUTOINCREMENT,   user_id INTEGER NOT NULL,   intent TEXT NOT NULL,   context_json TEXT NOT NULL,   recommendation_json TEXT NOT NULL,   explanation_json TEXT NOT NULL,   safety_json TEXT NOT NULL DEFAULT '{}',   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE shift_today_checkins (user_id INTEGER NOT NULL,local_date TEXT NOT NULL,mood TEXT NOT NULL,guts TEXT NOT NULL,energy TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(user_id,local_date));
CREATE TABLE shift_today_choices (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,local_date TEXT NOT NULL,domain TEXT NOT NULL,choice_key TEXT NOT NULL,choice_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,UNIQUE(user_id,local_date,domain));
CREATE TABLE shift_treatment_context (user_id INTEGER PRIMARY KEY,medicine TEXT NOT NULL,route TEXT NOT NULL,dose TEXT NOT NULL,week_number INTEGER,next_dose_on TEXT,next_delivery_on TEXT,status TEXT NOT NULL DEFAULT 'active',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE shoulder_lab_log (id INTEGER PRIMARY KEY AUTOINCREMENT,hq_user_id INTEGER,input TEXT NOT NULL,mode TEXT,risk_level TEXT,answer TEXT NOT NULL,model TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE site_content_overrides (id INTEGER PRIMARY KEY AUTOINCREMENT,page_path TEXT NOT NULL,content_key TEXT NOT NULL UNIQUE,css_selector TEXT NOT NULL,label TEXT NOT NULL,draft_text TEXT NOT NULL,published_text TEXT,status TEXT NOT NULL DEFAULT 'draft' CHECK(status IN ('draft','published','paused')),version INTEGER NOT NULL DEFAULT 1,created_by INTEGER,updated_by INTEGER,published_by INTEGER,published_at TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE site_content_versions (id INTEGER PRIMARY KEY AUTOINCREMENT,content_override_id INTEGER NOT NULL,version INTEGER NOT NULL,text_value TEXT NOT NULL,action TEXT NOT NULL,actor_id INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,FOREIGN KEY(content_override_id) REFERENCES site_content_overrides(id));
CREATE TABLE stripe_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      stripe_event_id TEXT NOT NULL UNIQUE,
      event_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      received_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      processed_at TEXT,
      processing_error TEXT
    );
CREATE TABLE structured_content (id TEXT PRIMARY KEY,content_type TEXT NOT NULL,title TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,status TEXT NOT NULL DEFAULT 'draft',data_json TEXT NOT NULL,review_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE supplement_checkout_events ( event_id TEXT PRIMARY KEY,processed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE supplement_checkout_migrations (id TEXT PRIMARY KEY,applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE supplement_checkout_offers ( id TEXT PRIMARY KEY,name TEXT NOT NULL,pack_label TEXT NOT NULL,supplier_sku TEXT NOT NULL, price_pence INTEGER NOT NULL,delivery_group TEXT NOT NULL,delivery_label TEXT NOT NULL, delivery_pence INTEGER NOT NULL,delivery_scope TEXT NOT NULL DEFAULT 'unconfirmed', stock_quantity INTEGER NOT NULL DEFAULT 0,reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0), labels_verified INTEGER NOT NULL DEFAULT 0,fulfilment_verified INTEGER NOT NULL DEFAULT 0, active INTEGER NOT NULL DEFAULT 0,valid_until TEXT NOT NULL,revision INTEGER NOT NULL DEFAULT 1 );
CREATE TABLE supplement_checkout_orders ( id INTEGER PRIMARY KEY AUTOINCREMENT,order_number TEXT NOT NULL UNIQUE,user_id INTEGER NOT NULL,channel TEXT NOT NULL,quote_json TEXT NOT NULL, total_pence INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'pending',stripe_session_id TEXT, shipping_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE supplement_fulfilment_queue ( id INTEGER PRIMARY KEY AUTOINCREMENT,order_number TEXT NOT NULL UNIQUE,user_id INTEGER NOT NULL,quote_json TEXT NOT NULL,shipping_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'awaiting_supplier',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE supplement_product_history (
 product_id TEXT NOT NULL,
 revision INTEGER NOT NULL,
 changed_by TEXT NOT NULL,
 record_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(product_id,revision)
);
CREATE TABLE supplement_products (
 id TEXT PRIMARY KEY,
 name TEXT NOT NULL,
 brand TEXT NOT NULL,
 category TEXT NOT NULL,
 format TEXT NOT NULL,
 description TEXT NOT NULL DEFAULT '',
 shift_says TEXT NOT NULL DEFAULT '',
 illustrated_pack TEXT,
 illustrated_flavour TEXT,
 source_url TEXT NOT NULL,
 image_source TEXT,
 supplier_pack TEXT,
 supplier_sku TEXT,
 ean TEXT,
 trade_price_pence INTEGER,
 retail_price_pence INTEGER,
 delivery_cost_pence INTEGER,
 vat_rate REAL,
 stock_quantity INTEGER,
 internal_notes TEXT,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status='draft'),
 visibility TEXT NOT NULL DEFAULT 'hidden' CHECK(visibility IN ('hidden','proposed')),
 sale_enabled INTEGER NOT NULL DEFAULT 0 CHECK(sale_enabled=0),
 sort_order INTEGER NOT NULL DEFAULT 0,
 revision INTEGER NOT NULL DEFAULT 1,
 updated_by TEXT NOT NULL DEFAULT 'approved-olivit-release-20261027',
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
, checkout_recommendation INTEGER NOT NULL DEFAULT 0 CHECK(checkout_recommendation IN (0,1)), checkout_priority INTEGER NOT NULL DEFAULT 100 CHECK(checkout_priority BETWEEN 0 AND 10000));
CREATE TABLE support_tickets (id INTEGER PRIMARY KEY AUTOINCREMENT,reference TEXT NOT NULL UNIQUE,user_id INTEGER,subject TEXT NOT NULL,priority TEXT NOT NULL DEFAULT 'normal',status TEXT NOT NULL DEFAULT 'open',body TEXT,assigned_hq_user_id INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,closed_at TEXT,FOREIGN KEY(user_id) REFERENCES users(id),FOREIGN KEY(assigned_hq_user_id) REFERENCES hq_users(id));
CREATE TABLE synthetic_personas (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL UNIQUE,occupation TEXT,profile TEXT NOT NULL,communication_style TEXT,status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE synthetic_runs (id INTEGER PRIMARY KEY AUTOINCREMENT,persona_id INTEGER NOT NULL,scenario_id INTEGER NOT NULL,status TEXT NOT NULL,score INTEGER NOT NULL,answer TEXT,model TEXT,score_json TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE synthetic_scenarios (id INTEGER PRIMARY KEY AUTOINCREMENT,scenario_key TEXT NOT NULL UNIQUE,prompt TEXT NOT NULL,mode TEXT NOT NULL,expected_behavior TEXT,status TEXT NOT NULL DEFAULT 'active',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE tap_room_appeals (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,restriction_id INTEGER,reason TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,reviewed_at TEXT,reviewed_by TEXT,decision TEXT);
CREATE TABLE tap_room_blocks (blocker_user_id INTEGER NOT NULL,blocked_user_id INTEGER NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(blocker_user_id,blocked_user_id));
CREATE TABLE tap_room_erasure_requests (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,status TEXT NOT NULL DEFAULT 'received',requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,due_at TEXT NOT NULL,completed_at TEXT);
CREATE TABLE tap_room_events (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER,event_name TEXT NOT NULL,room_slug TEXT,post_id INTEGER,metadata_json TEXT NOT NULL DEFAULT '{}',occurred_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE tap_room_hosts (user_id INTEGER PRIMARY KEY,invited_by TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'invited',invited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,accepted_at TEXT);
CREATE TABLE tap_room_moderation_audit (id INTEGER PRIMARY KEY AUTOINCREMENT,actor TEXT NOT NULL,action TEXT NOT NULL,reason TEXT NOT NULL,content_id INTEGER,affected_user_id INTEGER,metadata_json TEXT NOT NULL DEFAULT '{}',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE tap_room_posts (id INTEGER PRIMARY KEY AUTOINCREMENT,room_slug TEXT NOT NULL,user_id INTEGER,parent_id INTEGER,body TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'visible',is_founder_prompt INTEGER NOT NULL DEFAULT 0,risk_flags_json TEXT NOT NULL DEFAULT '[]',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,deleted_at TEXT,deleted_by INTEGER);
CREATE TABLE tap_room_profiles (user_id INTEGER PRIMARY KEY,display_name TEXT NOT NULL,bio TEXT,joined_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,treatment_rules_ack_at TEXT,privacy_prompt_seen_at TEXT,status TEXT NOT NULL DEFAULT 'active',updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
CREATE TABLE tap_room_reports (id INTEGER PRIMARY KEY AUTOINCREMENT,reporter_user_id INTEGER NOT NULL,post_id INTEGER NOT NULL,category TEXT NOT NULL,detail TEXT,priority TEXT NOT NULL,status TEXT NOT NULL DEFAULT 'open',created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,reviewed_at TEXT,reviewed_by TEXT,outcome TEXT);
CREATE TABLE tap_room_restrictions (id INTEGER PRIMARY KEY AUTOINCREMENT,user_id INTEGER NOT NULL,restriction_type TEXT NOT NULL,starts_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,ends_at TEXT,reason TEXT NOT NULL,created_by TEXT NOT NULL,revoked_at TEXT);
CREATE TABLE testing_extra_history (product_id TEXT NOT NULL REFERENCES testing_range_extras(id),revision INTEGER NOT NULL,changed_by TEXT NOT NULL,record_json TEXT NOT NULL,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,PRIMARY KEY(product_id,revision));
CREATE TABLE testing_fulfilment_batches (
 seq INTEGER PRIMARY KEY AUTOINCREMENT,
 id TEXT NOT NULL UNIQUE,
 request_key TEXT NOT NULL UNIQUE,
 request_hash TEXT NOT NULL,
 mode TEXT NOT NULL CHECK(mode IN ('live','test')),
 status TEXT NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','submitted','acknowledged','cancelled')),
 revision INTEGER NOT NULL DEFAULT 1,
 config_revision INTEGER NOT NULL,
 config_json TEXT NOT NULL,
 snapshot_json TEXT NOT NULL,
 csv_text TEXT NOT NULL,
 csv_sha256 TEXT NOT NULL,
 row_count INTEGER NOT NULL,
 order_count INTEGER NOT NULL,
 created_by TEXT NOT NULL,
 created_at TEXT NOT NULL,
 submitted_by TEXT,
 submitted_at TEXT,
 submission_reference TEXT,
 acknowledged_by TEXT,
 acknowledged_at TEXT,
 acknowledgement_reference TEXT,
 cancelled_by TEXT,
 cancelled_at TEXT,
 cancellation_reason TEXT
);
CREATE TABLE testing_fulfilment_config (
 id INTEGER PRIMARY KEY CHECK(id=1),
 revision INTEGER NOT NULL DEFAULT 1,
 template_name TEXT NOT NULL DEFAULT 'Awaiting partner template',
 columns_json TEXT NOT NULL,
 delimiter TEXT NOT NULL DEFAULT ',',
 utf8_bom INTEGER NOT NULL DEFAULT 0 CHECK(utf8_bom IN (0,1)),
 template_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(template_confirmed IN (0,1)),
 delivery_method TEXT NOT NULL DEFAULT 'unconfirmed' CHECK(delivery_method IN ('unconfirmed','email','upload')),
 destination TEXT,
 delivery_confirmed INTEGER NOT NULL DEFAULT 0 CHECK(delivery_confirmed IN (0,1)),
 updated_by TEXT,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE testing_fulfilment_events (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 batch_id TEXT,
 event TEXT NOT NULL,
 actor TEXT NOT NULL,
 detail_json TEXT NOT NULL DEFAULT '{}',
 created_at TEXT NOT NULL
);
CREATE TABLE testing_fulfilment_items (
 batch_id TEXT NOT NULL REFERENCES testing_fulfilment_batches(id),
 source_line_id INTEGER NOT NULL,
 source_order_id INTEGER NOT NULL,
 order_reference TEXT NOT NULL,
 active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
 PRIMARY KEY(batch_id,source_line_id)
);
CREATE TABLE testing_fulfilment_mail (
 batch_id TEXT PRIMARY KEY REFERENCES testing_fulfilment_batches(id),
 revision INTEGER NOT NULL DEFAULT 1,
 status TEXT NOT NULL CHECK(status IN ('queued','scheduled','sending','sent','blocked','failed','uncertain','cancelled')),
 request_key TEXT NOT NULL UNIQUE,
 request_hash TEXT NOT NULL,
 review_hash TEXT NOT NULL,
 envelope_json TEXT NOT NULL,
 send_at TEXT NOT NULL,
 scheduled_local TEXT,
 time_zone TEXT NOT NULL DEFAULT 'Europe/London',
 approved_by TEXT NOT NULL,
 approved_at TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 attempt_count INTEGER NOT NULL DEFAULT 0,
 lease_id TEXT,
 sending_started_at TEXT,
 provider_id TEXT,
 accepted_at TEXT,
 failure_code TEXT,
 failure_message TEXT
);
CREATE TABLE testing_fulfilment_tracking (
 batch_id TEXT NOT NULL REFERENCES testing_fulfilment_batches(id),
 source_order_id INTEGER NOT NULL,
 status TEXT NOT NULL DEFAULT 'awaiting_confirmation' CHECK(status IN ('awaiting_confirmation','accepted','dispatched','exception')),
 revision INTEGER NOT NULL DEFAULT 1,
 carrier TEXT,
 tracking_reference TEXT,
 partner_reference TEXT,
 note TEXT,
 updated_by TEXT NOT NULL,
 updated_at TEXT NOT NULL,
 PRIMARY KEY(batch_id,source_order_id)
);
CREATE TABLE testing_product_history (
 product_id TEXT NOT NULL REFERENCES testing_products(id),
 revision INTEGER NOT NULL,
 changed_by TEXT NOT NULL,
 record_json TEXT NOT NULL,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 PRIMARY KEY(product_id,revision)
);
CREATE TABLE testing_products (
 id TEXT PRIMARY KEY,
 sku TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 partner TEXT NOT NULL DEFAULT 'Newfoundland',
 test_type TEXT NOT NULL CHECK(test_type IN ('home','lab')),
 supplier_state TEXT NOT NULL CHECK(supplier_state IN ('available','coming_soon')),
 markers_json TEXT NOT NULL,
 description TEXT NOT NULL,
 sample TEXT NOT NULL,
 result_time TEXT NOT NULL,
 results_access TEXT NOT NULL,
 limitations TEXT NOT NULL,
 source_url TEXT NOT NULL,
 source_checked TEXT NOT NULL,
 supplier_retail_reference_pence INTEGER,
 supplier_sku TEXT,
 trade_price_pence INTEGER,
 retail_price_pence INTEGER,
 delivery_cost_pence INTEGER,
 vat_rate REAL,
 internal_notes TEXT,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status='draft'),
 sale_enabled INTEGER NOT NULL DEFAULT 0 CHECK(sale_enabled=0),
 revision INTEGER NOT NULL DEFAULT 1,
 sort_order INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_by TEXT
);
CREATE TABLE testing_range_extras (
 id TEXT PRIMARY KEY,
 sku TEXT NOT NULL UNIQUE,
 name TEXT NOT NULL,
 partner TEXT NOT NULL DEFAULT 'Newfoundland',
 test_type TEXT NOT NULL CHECK(test_type IN ('supplement','bundle')),
 supplier_state TEXT NOT NULL CHECK(supplier_state IN ('available','coming_soon')),
 markers_json TEXT NOT NULL,
 description TEXT NOT NULL,
 sample TEXT NOT NULL,
 result_time TEXT NOT NULL,
 results_access TEXT NOT NULL,
 limitations TEXT NOT NULL,
 source_url TEXT NOT NULL,
 source_checked TEXT NOT NULL,
 supplier_retail_reference_pence INTEGER,
 supplier_sku TEXT,
 trade_price_pence INTEGER,
 retail_price_pence INTEGER,
 delivery_cost_pence INTEGER,
 vat_rate REAL,
 internal_notes TEXT,
 status TEXT NOT NULL DEFAULT 'draft' CHECK(status='draft'),
 sale_enabled INTEGER NOT NULL DEFAULT 0 CHECK(sale_enabled=0),
 revision INTEGER NOT NULL DEFAULT 1,
 sort_order INTEGER NOT NULL DEFAULT 0,
 created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
 updated_by TEXT
);
CREATE TABLE timber_shed_v6test_access_audit (
 id TEXT PRIMARY KEY,
 restriction_id TEXT NOT NULL REFERENCES timber_shed_v6test_forum_restrictions(id) ON DELETE CASCADE,
 actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 action TEXT NOT NULL CHECK(action IN ('suspended','banned','lifted','appealed','upheld','reinstated','expired')),
 created_at TEXT NOT NULL
);
CREATE TABLE timber_shed_v6test_adult_access (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 evidence_method TEXT NOT NULL CHECK(evidence_method IN ('verified-adult-account','photo-id-match')),
 evidence_reference TEXT NOT NULL CHECK(length(evidence_reference) BETWEEN 8 AND 80),
 verified_by INTEGER NOT NULL REFERENCES users(id),
 verified_at TEXT NOT NULL,
 expires_at TEXT NOT NULL,
 revoked_at TEXT,
 CHECK(expires_at>verified_at)
);
CREATE TABLE timber_shed_v6test_auto_publications (
 post_id TEXT PRIMARY KEY REFERENCES timber_shed_v6test_forum_posts(id) ON DELETE CASCADE,
 decision_policy TEXT NOT NULL,
 governance_version TEXT NOT NULL,
 created_at TEXT NOT NULL
);
CREATE TABLE timber_shed_v6test_bouncer_screenings (
  post_id TEXT PRIMARY KEY REFERENCES timber_shed_v6test_forum_posts(id) ON DELETE CASCADE,
  policy_version TEXT NOT NULL,
  model_name TEXT,
  severity TEXT NOT NULL CHECK(severity IN ('routine','review','high','critical')),
  priority INTEGER NOT NULL CHECK(priority BETWEEN 0 AND 3),
  categories_json TEXT NOT NULL DEFAULT '[]',
  screened_at TEXT NOT NULL
);
CREATE TABLE timber_shed_v6test_forum_appeal_audit (
 id TEXT PRIMARY KEY,
 appeal_id TEXT NOT NULL REFERENCES timber_shed_v6test_forum_appeals(id) ON DELETE CASCADE,
 actor_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
 action TEXT NOT NULL CHECK(action IN ('submitted','upheld','reconsider','returned','withdrawn','expired')),
 created_at TEXT NOT NULL
);
CREATE TABLE timber_shed_v6test_forum_appeals (
 id TEXT PRIMARY KEY,
 post_id TEXT NOT NULL REFERENCES timber_shed_v6test_forum_posts(id) ON DELETE CASCADE,
 reason TEXT NOT NULL CHECK(reason IN ('missed-context','incorrect-rule','other')),
 status TEXT NOT NULL CHECK(status IN ('open','upheld','reconsider','withdrawn')),
 decision_status TEXT NOT NULL CHECK(decision_status IN ('rejected','removed')),
 decision_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 decision_at TEXT NOT NULL,
 created_at TEXT NOT NULL,
 resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 resolved_at TEXT,
 UNIQUE(post_id,decision_at)
);
CREATE TABLE timber_shed_v6test_forum_audit (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES timber_shed_v6test_forum_posts(id) ON DELETE CASCADE,
  moderator_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
  action TEXT NOT NULL CHECK(action IN ('approve','reject','remove','dismiss','withdraw')),
  created_at TEXT NOT NULL
);
CREATE TABLE timber_shed_v6test_forum_blocks (
 id TEXT PRIMARY KEY,
 blocker_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 blocked_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 created_at TEXT NOT NULL,
 CHECK(blocker_id<>blocked_id),
 UNIQUE(blocker_id,blocked_id)
);
CREATE TABLE timber_shed_v6test_forum_moderators (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  active INTEGER NOT NULL DEFAULT 0 CHECK(active IN (0,1)),
  created_at TEXT NOT NULL
);
CREATE TABLE timber_shed_v6test_forum_notifications (
 id TEXT PRIMARY KEY,
 recipient_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 post_id TEXT NOT NULL REFERENCES timber_shed_v6test_forum_posts(id) ON DELETE CASCADE,
 thread_id TEXT NOT NULL REFERENCES timber_shed_v6test_forum_posts(id) ON DELETE CASCADE,
 room_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('approved','rejected','removed','reply')),
 created_at TEXT NOT NULL,
 read_at TEXT,
 UNIQUE(recipient_id,post_id,kind)
);
CREATE TABLE timber_shed_v6test_forum_posts (
  id TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  room_id TEXT NOT NULL CHECK(room_id IN ('main-shed','shifting-timber','grub-fit','good-to-talk','small-wins','after-treatment')),
  parent_id TEXT REFERENCES timber_shed_v6test_forum_posts(id) ON DELETE CASCADE,
  title TEXT,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected','removed','withdrawn')),
  created_at TEXT NOT NULL,
  reviewed_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
  reviewed_at TEXT
);
CREATE TABLE timber_shed_v6test_forum_profiles (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL UNIQUE COLLATE NOCASE,
  created_at TEXT NOT NULL
);
CREATE TABLE timber_shed_v6test_forum_reports (
  id TEXT PRIMARY KEY,
  post_id TEXT NOT NULL REFERENCES timber_shed_v6test_forum_posts(id) ON DELETE CASCADE,
  reporter_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  reason TEXT NOT NULL CHECK(reason IN ('privacy','unsafe-health-advice','harassment','self-harm-risk','spam','other')),
  status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
  created_at TEXT NOT NULL
);
CREATE TABLE timber_shed_v6test_forum_restrictions (
 id TEXT PRIMARY KEY,
 user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
 source_post_id TEXT REFERENCES timber_shed_v6test_forum_posts(id) ON DELETE SET NULL,
 kind TEXT NOT NULL CHECK(kind IN ('suspended','banned')),
 reason TEXT NOT NULL CHECK(reason IN ('medication-trading','harassment','privacy','unsafe-content','spam','other')),
 created_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 created_at TEXT NOT NULL,
 expires_at TEXT,
 lifted_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 lifted_at TEXT,
 CHECK((kind='banned' AND expires_at IS NULL) OR (kind='suspended' AND expires_at IS NOT NULL))
);
CREATE TABLE timber_shed_v6test_maintenance (id INTEGER PRIMARY KEY CHECK(id=1),completed_at TEXT NOT NULL);
CREATE TABLE timber_shed_v6test_participation (
 user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
 rules_version TEXT NOT NULL,
 privacy_version TEXT NOT NULL,
 disclosure_consent_at TEXT,
 accepted_at TEXT NOT NULL
);
CREATE TABLE timber_shed_v6test_private_progress (
  user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  enabled INTEGER NOT NULL DEFAULT 0 CHECK(enabled IN (0,1)),
  revision INTEGER NOT NULL DEFAULT 0,
  activities_json TEXT NOT NULL DEFAULT '{}',
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE timber_shed_v6test_restriction_appeals (
 id TEXT PRIMARY KEY,
 restriction_id TEXT NOT NULL UNIQUE REFERENCES timber_shed_v6test_forum_restrictions(id) ON DELETE CASCADE,
 reason TEXT NOT NULL CHECK(reason IN ('missed-context','incorrect-rule','other')),
 status TEXT NOT NULL CHECK(status IN ('open','upheld','reinstated')),
 created_at TEXT NOT NULL,
 resolved_by INTEGER REFERENCES users(id) ON DELETE SET NULL,
 resolved_at TEXT
);
CREATE TABLE timber_shed_v6test_support_drafts(id TEXT PRIMARY KEY,user_id INTEGER NOT NULL REFERENCES users(id),title TEXT NOT NULL,body TEXT NOT NULL,room_id TEXT NOT NULL,source_id TEXT,offer_id TEXT,category TEXT,action_key TEXT,recipe_id TEXT,situation TEXT NOT NULL,created_at TEXT NOT NULL,expires_at TEXT NOT NULL,published_at TEXT);
CREATE TABLE timber_shed_v6test_support_marks(post_id TEXT NOT NULL REFERENCES timber_shed_v6test_forum_posts(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id),feedback_id TEXT NOT NULL,consented_at TEXT NOT NULL,PRIMARY KEY(post_id,user_id));
CREATE TABLE timber_shed_v6test_support_peers(user_id INTEGER PRIMARY KEY REFERENCES users(id),topic TEXT NOT NULL,opted_in_at TEXT NOT NULL);
CREATE TABLE timber_shed_v6test_support_tips(post_id TEXT PRIMARY KEY REFERENCES timber_shed_v6test_forum_posts(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id),source_id TEXT,offer_id TEXT,category TEXT,action_key TEXT,recipe_id TEXT,situation TEXT NOT NULL,reviewed_by INTEGER,reviewed_at TEXT);
CREATE TABLE timber_shed_v6test_support_trials(post_id TEXT NOT NULL REFERENCES timber_shed_v6test_forum_posts(id) ON DELETE CASCADE,user_id INTEGER NOT NULL REFERENCES users(id),feedback_id TEXT NOT NULL,outcome TEXT NOT NULL,reason TEXT,recorded_at TEXT NOT NULL,PRIMARY KEY(post_id,user_id));
CREATE TABLE user_auth (   id INTEGER PRIMARY KEY AUTOINCREMENT,   user_id INTEGER NOT NULL UNIQUE,   password_hash TEXT NOT NULL,   email_verified INTEGER NOT NULL DEFAULT 0,   email_verified_at TEXT,   failed_login_attempts INTEGER NOT NULL DEFAULT 0,   locked_until TEXT,   last_login_at TEXT,   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,   updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,   FOREIGN KEY (user_id) REFERENCES users(id) );
CREATE TABLE user_sessions (   id INTEGER PRIMARY KEY AUTOINCREMENT,   user_id INTEGER NOT NULL,   token_hash TEXT NOT NULL UNIQUE,   expires_at TEXT NOT NULL,   revoked_at TEXT,   last_used_at TEXT,   created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,   FOREIGN KEY (user_id) REFERENCES users(id) );
CREATE TABLE users (     id INTEGER PRIMARY KEY AUTOINCREMENT,     email TEXT NOT NULL UNIQUE,     first_name TEXT,     last_name TEXT,     phone TEXT,     date_of_birth TEXT,     postcode TEXT,     created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,     updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP );
CREATE TABLE workflow_runs (id INTEGER PRIMARY KEY AUTOINCREMENT,workflow_id INTEGER NOT NULL,user_id INTEGER,status TEXT NOT NULL,context_json TEXT,error TEXT,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,completed_at TEXT);
CREATE TABLE workflows (id INTEGER PRIMARY KEY AUTOINCREMENT,name TEXT NOT NULL,trigger_key TEXT NOT NULL,action_key TEXT NOT NULL,action_config_json TEXT NOT NULL DEFAULT '{}',status TEXT NOT NULL DEFAULT 'paused',created_by_hq_user_id INTEGER,created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP);
