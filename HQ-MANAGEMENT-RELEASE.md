# HQ management v1 — live release

Live HQ: https://hq.shiftsometimber.co.uk
Released and verified 8 October 2026.
Frontend source: 6f6cc12791d15d85a2fbca54c9bb500e35eb7017.
Endpoint source: 5e2a6bbe7714fe098eebfa22bc7acbe9e3d2d5c2.
Successful endpoint release: https://github.com/shiftsometimber/shift-core/actions/runs/37744409692

The existing HQ has a compact management home, grouped access to existing features, date-selected CSV and PDF management reports, staff role/status editing and audit metadata. Eight missing sections were restored; mobile view leakage and catalogue selectors were repaired.

Reporting and staff role/status updates use only /v1/hq/management/* through shift-hq-management, sharing the existing database, sessions, roles and audit. Staff changes map internally to the tested atomic handler. Existing login, user-list and MFA routes stay on the existing core. The public-site runtime remains on its captured version: earlier full-core release attempts correctly rolled back after public preservation failures.

Verification: isolated real API and browser tests passed for all destinations, desktop/mobile, date filters, CSV/PDF downloads, staff edit/audit, role denials, export audit failure, access audit rollback, disabled sessions, self-disable/last-owner protection and session expiry. The isolated endpoint release verified authentication and HQ-only CORS live, retained the public runtime version and proved 25 public/login/sitemap responses identical before and after. All nine served HQ browser assets match the approved source. Review/demo artifacts return 404. The live login page passes desktop/mobile checks without script errors.

A signed-in production session was unavailable, so live owner figures and authenticated production exports have not been independently checked. No production staff accounts, member records, orders, refunds or outgoing communications were changed during verification.

Reports label unavailable sources honestly. Analytics/attribution are not connected. Paid-order value is current paid value for live GBP orders created in the selected period, not accounting revenue. Refunds use refund-record dates; continuity rates retain their explicitly labelled trailing 90-day cohort. Mandatory MFA policy is not newly implemented.

Rollback records are retained in the successful endpoint release artifact. Endpoint rollback affects only its owned HQ Worker; public runtime and data stay intact. UI predecessor: 7f566606-9e92-4a20-9c9d-5f100ce9e833. Verified live UI version: 480e2456-0f2f-4d77-8001-a72e89ccdbdc.
