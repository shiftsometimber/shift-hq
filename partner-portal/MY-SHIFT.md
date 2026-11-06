# My Shift member experience

Member experience for the 5 November 2026 four-door work order. The source flag
is off by default. Matt explicitly authorised deployment ("Deploy") after the
review candidate and evidence were presented. Release receipts establish the
actual deployed state; approval alone is not deployment.

## One account and operating record

The website and both existing app wrappers use the canonical SHIFT member
origin. The SST Rx member entrance hands off to that existing My Timber sign-in.
It does not mint an Rx member cookie, share an HQ session, or create an account
by matching an email address. Professional sessions remain MFA-protected,
host-only and audience-bound to their portal origin.

The existing programme Worker retains its HTML, native loader, session guard,
navigation and original backend bindings. Its small member-entry wrapper can
request the candidate page from the existing `shift-clinical-records` service.
The current native account-root repair is retained. The old nine-panel
experience remains the fallback while the candidate flag is off.

| View or action | Existing authority |
| --- | --- |
| Member identity and member-since | `users`, `user_auth`, `user_sessions` |
| Profile, delivery address and GP | Existing member-details HTML, client and `/v1/member/details` services |
| Password reset | Existing Core password-settings handler, API adapter and Turnstile-protected Core authentication route |
| Optional tracking consent | Existing `/v1/consents`; clinical sharing stays in the treatment record |
| Data copy | Existing `/v1/privacy/export`; no replacement privacy service |
| Paid order and repeat identity | `medicine_orders` |
| Clinical review and assessment | `clinical_member_records`, `clinical_case_state`, `clinical_case_events` |
| Prescription | Existing prescription state, events and signature records |
| Dispensing, dispatch and delivery | `partner_fulfilment` and `partner_audit` |
| Historical supplier and uncertain submission | `rx_order_routes`, `rx_integration_jobs` |
| Member/care-team conversations | Existing `rx_message_threads`, `rx_messages`, `rx_message_reads` |
| Member/SHIFT support | Existing `support_tickets`; versioned thread body, optional owned order reference |
| Support audit | Existing `rx_platform_audit`; content-free metadata |

No My Shift-only profile, patient, prescription, payment, order or message table
is added. Snapshot reads are bounded and use a constant number of database
queries at one and one hundred orders. A partial result is labelled and never
reported as an exact count. Connection failures are not counted as empty queues.

## Member presentation

`my-shift-ui.mjs` supplies Orders, Care, Messages and Account with a real Latest
strip. Care indices link to the retained treatment record screens. Profile and
password views retain their existing controls. No new medicine promotion,
clinical conclusion, payment route, stored-card facility or supplier call is
introduced. Payment methods are truthfully described as managed at checkout.

The order timeline distinguishes preparation from completed dispensing.
Prescription signing requires an actual signature record. Dispatch and delivery
require their own pharmacy events. Expected delivery never completes Delivered.
A confirmed status without an immutable timestamp is displayed without a date.
The original supplier identity is retained on historical orders.

Pharmacy users gain an explicit dispensing confirmation and an explicitly
untracked dispatch option with a required reason. These use the existing
pharmacy action, permission, stock, prescription, address, version, audit and
incident-hold gates. The older tracked dispatch contract continues to work.
An external supplier that does not confirm dispensing does not receive an
invented completed dispensing step.

The single Messages screen distinguishes SHIFT support from private care-team
conversations. Each reply has a labelled recipient. The one-working-day promise
applies to SHIFT support. HQ support cannot read clinical message content.
Read acknowledgements do not manufacture a new message timestamp. A member's
own outgoing care message is not counted as unread incoming mail.

Reads and writes honour the native `X-My-Timber-Expected-Account` boundary.
Changed accounts clear the private view. Current-session logout revokes the
existing native token and retains another device's session. No parent-domain
cookie or new login system is introduced.

## Source and verification

The canonical password-settings component is retained unchanged from
`shift-core` commit `cf6df68d5bc233d8e87359a268f40ee6932a53d2`:
SHA-256 `6a5960298b510ed18985e05eb87656e532ffd67f526c087fbdbb9ed7e2471c52`.
The handler is served by the existing member service; its authentication,
security challenge and delivery route remain in Core.

Run the existing build and test workflow. `qa/my-shift-browser.mjs` adds the
named MS-* screenshots and real Chromium/WebKit interaction checks. It uses
fictional identities, SQLite and intercepted requests. Native registration,
password/TOTP, signing, clinical/dispensing journeys and supplier-switch tests
remain in the existing full-loop suite. No real member, pharmacy, prescription,
shipment, payment, email or push notification is created by these tests.

The browser fixture's profile, consent, export and password-request responses
are contract fixtures. They are not proof of live account editing, email/token
delivery or a complete privacy export. The retained native loader is exercised;
this is not a physical installed-app or production Safari acceptance claim.
WebKit request interception omits Cookie headers: its synthetic transport reads
only the URL-scoped cookie jar belonging to that isolated test context. The
evidence records each normalisation. It does not prove hosted SameSite/cookie
attachment. Synthetic redirects are asserted without following an external hop.

## Release boundary

Read-only production inspection on 5 November confirmed these serving versions:

| Existing Worker | Serving version | Deployment |
| --- | --- | --- |
| `shift-programme-member-20261023` | `eb345c49-2ba1-4604-a192-f4f91f83af7a` | `5d61cb85-a3ea-4ca9-ae05-998e3f797685` |
| `shift-clinical-records` | `18cbfc60-c4ff-4b0e-a8cb-786e3b204aa3` | `4594ca5e-6ebc-4953-8262-2256bf3cf02f` |
| `shift-hq-clinical-portal` | `dc9aa616-e0cb-4d4d-9d44-8566ab6e4a27` | `69cc7c77-d3e8-451f-80de-caa76082873b` |
| `shift-partner-portal` | `51625c3a-0398-4a0a-ab9f-5a267ab8948d` | `d80acaec-27ec-4418-9b19-aa5fcf62540d` |

The redesign flag was absent on all four. The existing settings and dashboard
route owners, clinical-record assets route and native database schema were
verified. These are the pre-release identities; use the owned release receipts for the
subsequent staged, promoted or rolled-back state.

The authorised owned release must freshly capture the active versions,
settings and routes and reject concurrent changes before any promotion. Build
the three existing service bundles and the bundled member-entry wrapper.
Retain all other programme modules and bindings. Bind `MY_SHIFT_MEMBER` on the
programme Worker to the existing `shift-clinical-records` service. New canonical
routes are `/member/my-shift*` to the programme Worker and
`/v1/member/my-shift*` to the member service. Existing message, care, settings,
dashboard and asset route owners are retained.

Hosted authentication, cookie scope, revocation, origin restrictions and the
installed app must be checked on authorised synthetic accounts before final
switch-on. A fresh app/web load receives the new shared resources; ordinary
four-door navigation stays within the loaded document. Do not change clinical
commissioning, payment arrangements, mail/push approvals or supplier activation
as part of this UI release.

Rollback restores the exact captured four versions and removes only newly
owned routes/bindings. Preserve all records, support conversations, delivery
events and audit history. `sstrx.co.uk` and the public website/HQ routing remain
outside this change. Supplier signing/legal approval, credentials and genuine
live integration acceptance remain separate gates.

The already deployed f461eac owner/test sign-in repair is retained. Its named,
time-limited exception also permits non-clinical support replies; it does not
change clinical or pharmacy write guards. Member logout clears both the native
parent-domain cookie and the earlier host-only cookie and revokes only the
current native session. `release-my-shift.mjs` preserves existing modules and
bindings, stages at zero percent, requires exact hosted acceptance before
promotion and records owned routes and exact rollback versions.
