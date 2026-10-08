# Partner operations preview — 8 October 2026

Review: https://hq-partner-preview.projectshift.pages.dev/?demo=1

Internal partner register and handover tracking. Example preview data is session-local and resets on refresh; there are no live API requests, invitations or member disclosures. Partner sign-in is not enabled.

Future access foundation separates partner memberships from HQ staff, fixes each handover to its partner, and permits only approved, unexpired tasks for active memberships and partners. Partner projections exclude commercial notes and internal actions.

Validation: isolated SQLite API acceptance checks, cross-partner disclosure/expiry/disabled-access checks, atomic audit rollback, real-source browser create/edit/auth-clear checks, hosted example-data desktop/mobile checks and Worker dry build.

Production remains unchanged. Promotion requires review of additive hq-partner-schema.sql tables, deployment through the isolated HQ management Worker, and explicit HQ_PARTNERS_ENABLED=true after schema availability. Compose with existing HQ release checks; do not promote the broad public core runtime.
