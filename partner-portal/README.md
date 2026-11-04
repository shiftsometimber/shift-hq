# SHIFT Partner Portal

Separate partner address: https://partner.shiftsometimber.co.uk

This is a new Cloudflare Worker, `shift-partner-portal`. It does not replace HQ, change My Timber, duplicate the clinical database or create professional accounts. Clinical and dispensing work stays in the deployed `shift-hq-clinical-portal` service. Existing order IDs, optimistic versions, assignments, organisation checks, evidence restrictions, events and audit records remain authoritative. Authentication is delegated privately to the existing Core service.

## Grouped journey

The portal brings together assigned clinical reviews, shared evidence, confirmed prescription handovers, pharmacy preparation and delivery tracking. Each team has a separate view of the same existing records. Clinical approval, a signed prescription, pharmacy acknowledgement and dispatch are distinct stages.

The public `/demo` shows one fictional order across HQ, clinician, pharmacy and member views. `/demo/clinical` and `/demo/dispensing` reuse the deployed interactive demonstrations. These two detailed exercises use their own fictional fixtures; the overview does not claim to be a live integration test. No real patient data should be entered in demonstrations.

## Access boundary

- `PARTNER_ACCESS_ENABLED=false` is the production default. Upstream professional onboarding, clinical review, signing and fulfilment holds remain unchanged.
- This deployment does not commission a provider, issue invitations, grant access, prescribe, dispense, collect payment or send communications.
- No HQ session cookie or bearer token from the browser is accepted. Only an encrypted, audience-bound, expiring, host-only `__Host-shift_partner` cookie can identify a partner session.
- MFA is mandatory. Its upstream challenge and the underlying session token never enter browser JSON or a reusable HQ cookie.
- Current identity, MFA and active professional/organisation binding are rechecked on every private request. The clinical authority rechecks assignments, organisation approval, professional checks, consent, grants and record versions.
- Owner/admin accounts cannot use the partner gateway. Clinical and dispensing endpoints have separate, explicit allowlists. Staff assignment, directory, governance, finance, activation, invitation and notification administration are excluded.
- No private data is cached; POST requires the exact partner Origin. CORS, upstream Set-Cookie headers and redirects are not passed through.
- Signing/key registration on the new origin is excluded pending its own WebAuthn commissioning; it must not be enabled merely by changing the portal flag.

Opening professional access is a separate authorised onboarding/commissioning step. It requires named approved organisations and professionals, existing MFA, current role and case grants, an approved signing configuration where needed, and end-to-end acceptance using authorised test identities. No live professional sign-in or treatment acceptance is claimed by this release.

## Verification

Run `node --test partner-portal/test/*.test.mjs` (Node 22+). The suite exercises session separation, MFA, role restrictions, CSRF, revocation and authority denials, same-record routing, closed commissioning, no-store responses and bounded inputs.

Run `node partner-portal/build.mjs` for the dependency-free Worker bundle at ignored `.partner-qa/worker.bundle.mjs`. The source snapshot used by `preview.mjs` is a local QA fixture captured from the deployed public shells/assets; it contains no business records and is not committed.

The existing root `.assetsignore` excludes this new directory from the HQ static deployment. The protected `hq-v111.js` is untouched. No database migration is required.

## Deployment and rollback

Use `partner-portal/wrangler.jsonc` with the existing account. Service bindings are `CLINICAL → shift-hq-clinical-portal` and `HQ_AUTH → shift-core`. Generate a 32-byte random `PORTAL_SESSION_KEY` as a Worker secret; never write it into source, output, an argument or a file. Attach only `partner.shiftsometimber.co.uk` using a Worker Custom Domain. No existing HQ/API route is changed.

For rollback, restore the previous version of this Worker only, or disable its new custom-domain binding if abandoning the launch. Do not roll back Core, the clinical portal or HQ. Retain the access hold throughout. See `release.json` for the verified deployment receipt when available.
