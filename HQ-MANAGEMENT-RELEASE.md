# HQ management v1 — prepared release

Preview: https://hq-management-preview.projectshift.pages.dev/?demo=1

Status: read-only preview published; production unchanged.

The existing HQ now has grouped navigation, a management home, aggregate reports with CSV and multi-page PDF exports, staff role/status editing, and audit metadata display. Eight missing page sections were restored from the complete pre-truncation source (1c0ecf7 parent); existing runtime handlers retained. Mobile view leakage and catalogue navigation selector errors repaired.

Reporting backend companion branch: preview/hq-management-20261007 in shift-core. A report endpoint and audited export-preparation endpoint are added through the existing HQ router. Date bounds use London calendar days. Paid order value is current paid value for live GBP orders created in the selected period, not accounting revenue; refunds use refund-record dates. Continuity rates explicitly retain their own trailing 90-day cohort. Analytics and attribution remain unavailable until connected.

Staff changes retain before/after role/status in an atomic database batch. Audit failure rolls back access changes. Disabling or changing a role revokes existing sessions; last owner and self-disable protected. MFA enrolment/status retained; mandatory MFA policy is not newly implemented.

Verification: every navigation destination opens one view; desktop/mobile; real modified API against isolated SQLite; roles deny staff administration; disabled-session denial; last-owner protection; audited export success/failure; rollback on audit failure; date/DST boundaries; source/test-order distinction; CSV/PDF downloads; expired-session report clearing. Existing Radar/Evidence Desk and catalogue/commerce checks passed. Core build dry-run passed. Hosted preview verifies zero live API requests and blocks writes.

The shareable preview deliberately uses illustrative data and cannot prove production login or live numbers. No staff accounts, member records, refunds or communications changed.

Promotion: reconcile current deployed baselines and environment, merge only listed HQ/Core files through the existing reviewed main workflow, deploy reporting API before HQ, verify authorised owner login, reports/export audit, staff access changes with a temporary approved test account, and expiry/logout. Preserve live environment settings and all public-site assets; do not apply local example credentials or preview helper in production. Rollback: prior HQ assets and prior core version.
