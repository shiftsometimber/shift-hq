# Connected SHIFT HQ and partner portal

Partner address: https://partner.shiftsometimber.co.uk/
HQ address: https://hq.shiftsometimber.co.uk/

**4 November: software deployed and verified; real partner acceptance remains pending.** The four production components are serving the connected release. All 53 checks passed. No professional accounts have yet been approved in production. The approved provider assessment, professional governance and retention configuration, and real-identity acceptance remain separate requirements. Cash and full cost feeds are not connected. See connected-release.json for exact serving versions, preserved controls, scope and evidence.

**Fresh full-loop acceptance, 4 November, 21:03 UTC: overall FAIL.** The separate public questionnaire creates an external pharmacy intake but does not automatically create the clinician-facing clinical record in the tested native path. A real-format paid `cs_test_` session cannot pass the existing live-only signing gate. Proactive member notification delivery remains unproven. The live public medicine options also show no stock and prevent purchase. Controlled continuation reached delivered with matching member/HQ statuses; it required an explicit second clinical record and an isolated synthetic payment-format workaround. These results supersede any interpretation of the earlier seeded integration test as an unassisted live loop.

The fresh harness creates member and staff accounts through native registration/password/email-verification/MFA APIs. It captures email locally and replaces only external pharmacy/Stripe transport with test sinks. Professional approvals and credentials remain clearly fictional fixtures. `qa/native-core/source-manifest.json` pins the original Core source commit and file hashes; it is not proof that the assembled production Core has that exact source. Run `node partner-portal/qa/build-native-auth.mjs` followed by `node partner-portal/qa/full-loop-scenario.mjs --continue`. Omitting `--continue` stops before the synthetic payment-format workaround. No acceptance account, medical evidence, test signature or order is written to production.

The browser test also found that the pharmacy task omitted delivery details. The focused correction carries the complete alternative delivery address (or home address if none was entered) from the immutable assessment, displays the postcode, and blocks dispatch without complete delivery details. This correction is deployed to clinical Worker version `ecc8585e-ddbb-445e-936b-d9c3d2f4b631` from commit `89e676025bd7b9af55e83a429c7da01ec7fe2c0c`. All 37 partner tests pass locally; the four delivery checks also pass through the controlled SST Mac test runner. Other production bindings and admission controls are preserved.

The connected release adds the **Partner desk** to the existing HQ, plus a separate partner sign-in and role-scoped workspace. Existing HQ modules and the protected hq-v111.js remain intact. My Timber, checkout, payment processing and the Core deployment are not replaced.

## One order, shared progress

The existing clinical, prescription and dispensing handlers remain authoritative in the existing D1 database. A transactional outbox projects their confirmed events into the existing Core prescription ledger and order registry. The member order API reads those same orders. Approval, verified signature, pharmacy receipt, preparation, dispatch and delivery remain distinct steps. A projection failure is visible, durable and retried; further supply changes for that order are blocked until it is reconciled. No second order store is created.

Partner questions and HQ replies use order-linked internal threads. HQ Home includes partner questions in Needs your attention; Partner desk shows questions, unassigned reviews, exceptions and pending synchronisation; assigned verified professionals can use **Talk to SHIFT HQ**. These actions do not send email, SMS or WhatsApp. Each staff request rechecks current identity, MFA, organisation, professional evidence, grants and assignment.

## Access and commissioning

Production sign-in is enabled for approved partner accounts. There is no public registration. Account activation is single-use; the limited authenticator enrolment session cannot read casework. Professional activation, clinical governance and independent signing-key approval remain mandatory. No named organisations or professionals are approved by this software release and no invitations are sent. The existing member assessment test restriction and optional personal-context sharing hold are preserved.

Partner cookies remain opaque, encrypted, expiring, host-only, Secure, HttpOnly and SameSite=Strict. Browser HQ cookies cannot authenticate the partner gateway. POST requires the exact portal Origin. The gateway excludes HQ directory, finance, governance, key approval and staff administration. New signatures require the partner origin; original historical HQ signatures retain verification compatibility. The signature-control reference documents technical controls only, not a provider agreement or legal certification.

## Verification and build

Node 24:

```
node partner-portal/service/build-kernel.mjs
node partner-portal/service/build-member-kernel.mjs
node --test partner-portal/test/*.test.mjs
node --test hq-operations.test.cjs radar-source-review-logic.test.mjs radar-source-intake.test.mjs
node partner-portal/build.mjs
```

The connected suite uses real SQLite and the captured original handlers, original Core order API and real ES256 test signatures. The Core password/MFA protocol uses a fictional test authority: this is isolated integration acceptance, not a live professional or patient acceptance test. All test accounts, messages and records are fictional. No external communications or transactions occur. The managed browser preview is explicitly labelled fictional and its HTTP-only transport adapter is excluded from production uploads.

Frozen native Workers and Core helper sources are hash/commit pinned in service/vendor. Builds make small explicit compatibility changes; generated kernels and bundles are ignored. The root assets whitelist excludes backend and test code from HQ hosting.

## Deployment and recovery

Deploy the clinical and member adapters before the gateway and HQ assets. Preserve the original D1, R2, Core service and gateway secret bindings. The Core Worker is not deployed. The additive outbox and thread tables do not remove or replace existing records. Keep the existing private-member assessment restriction. Retry pending projections every five minutes through the clinical Worker schedule.

Rollback uses the previously recorded version for each changed Worker, with partner sign-in closed first if necessary. Preserve the database and audit/outbox history. The original release.json and closed-service audit are historical evidence; connected-release.json supersedes their NOT_READY software status once the new production versions have been verified. Account-specific professional and provider approvals remain necessary before real clinical use.
