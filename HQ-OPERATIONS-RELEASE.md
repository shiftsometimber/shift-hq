# HQ operational overview — 4 November 2026

Status: implemented and locally verified; not deployed.
Base: shiftsometimber/shift-hq main 93ab175b73b306fa234de03b1bab6774b5388f28.
Scope: existing private HQ interface only.

## Result

- An action-first home with current support, task, internal handover and failed/uncertain outbox records, including source queue links, owners, age, due dates and next actions.
- Source-specific available, restricted, disconnected, failed and loading states. Valid zero remains zero. Invalid/null/non-finite values show Unavailable.
- A workload chart links to each existing queue. Counts explicitly cover loaded records, not an invented business-wide total. The 500-row handover cap and explicit pagination flags are labelled as partial. Outbox coverage explicitly excludes approval drafts and other delivery channels.
- Current London-time report metadata, denominators and source labels. Reports older than 15 minutes are labelled Older snapshot; missing generation time is labelled Freshness unknown. Financial/cohort definitions and export audit behaviour are retained.
- Task, support and order screens retain load failures when a filter changes. Each has an explicit refresh control. Empty lists are shown only after a valid source response.
- Navigation group preferences contain only open/closed group labels. Queue counts are not persisted. Active destinations use aria-current. Mobile layout and reduced-motion loading feedback are included.
- Home, working queues and report responses are bound to the initiating account object and request generation. Superseded/logout responses cannot restore cleared component data. Requests have a 15-second abort timeout on home and working queues.

## Retained boundaries

No Core, reporting-service, login, session, role, clinical, dispensing or account configuration changes. No new data-write or external-send endpoint is called by these enhancements. Existing business actions remain their original handlers. No message, payment, refund, supplier commitment, account change or live data modification was performed during checks. Approval drafts are not claimed to be connected to this home screen.

Protected hq-v111.js blob remains 082a1bf557cf8ec57279db9b155a4a7fc5010b42. Existing Radar, Evidence Desk, GP, partner and catalogue runtimes are unchanged.

## Verification

- 20 focused Node tests passed: 9 operational-state/permission/race tests and the existing 11 Radar source-review/intake/deep-link tests.
- Evidence Desk source gate passed. JavaScript syntax and git diff whitespace checks passed.
- Cloud Chromium browser, wholly fictional local transport with production connections blocked: action queue link, unavailable sources, filter-after-load-failure regression, valid empty/zero values, support-role restrictions, stale report labels, loading state, sign-out clearing and release of late responses checked.
- A 390px iframe (375px document viewport after scrollbars) had document scrollWidth equal to clientWidth. This is responsive Chromium proof, not physical-device or WebKit proof.
- Public HQ shell observed in the browser; it was signed out. The new version has not had authenticated production-data acceptance or hosted full integration-gate execution.
- Regression found during QA: the original task-filter handler retained an old renderer and replaced source errors with an empty list. All three queue filter handlers now use the guarded renderer. Browser recheck retained the failure after changing the task filter.

## Release and rollback

Use the current HQ-only production release process after the exact candidate's release approval and required hosted checks. Preserve current main and any concurrent work. Do not deploy the local fixture directory, preview configuration, tests or review documents as runtime assets. Do not deploy this change through Core.

Runtime changes: index.html, hq-management.js, hq-operations.js, hq-operations.css. The integration gate also gains syntax/unit checks for the new module. Source tests and this note remain review material.

Before activation, retain the current serving HQ deployment/version and original runtime assets. Verify all four changed served assets against the approved commit and inspect the sign-in shell and authenticated home/queue/report paths. Only roll back a deployment still serving this release's owned version; do not overwrite another owner's successor. Rollback restores the prior HQ index/management asset set and needs no database migration.
