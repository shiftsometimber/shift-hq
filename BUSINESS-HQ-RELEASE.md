# Business HQ release — 24 October 2026

The approved compact SHIFT dashboard puts admin actions first and adds permanent Clinical, Dispensing, Notifications and Reports navigation. Settings stays at the bottom. Existing destinations remain under All HQ tools.

The browser requires the authenticated `/v1/hq/management/report/business` reporting endpoint. Missing or restricted sources remain unavailable; no sample figures ship. Members mean currently verified retained accounts. Sales combine paid live GBP shop and medicine orders. Repeat orders are second and later lifetime purchases by the same linked member across both channels. Operational queues remain current snapshots, independent of sales dates. Care deadlines are not assumed. Imported Google metrics display their own source dates.

Notifications links to the existing communications composer, exact review/approval workflow, delivery history and event review page. This release sends no messages.

PDF, Excel XLSX, CSV and Word DOCX exports use a newly refreshed audited snapshot, displayed before downloading. Files include selected dates, source definitions, unavailable states and limitations. Spreadsheet values cannot become formulas. Detailed existing KPI reports remain accessible.

## Build

Run `node build-business-hq.mjs` before Wrangler. The build contains only 16 explicitly named public browser assets, never receipts, source fixtures, credentials or local tooling. No routes or schedules change.

## Verification

Backend: `node --test hq-business-snapshot.test.mjs hq-launch-operations.test.mjs hq-report-population.test.mjs hq-analytics-snapshots.test.mjs` in the companion shift-core branch.

Browser: install Playwright, provide `business-source-acceptance.json` from the authenticated report endpoint, then run `node business-browser-check.cjs`. Optional `HQ_PLAYWRIGHT_MODULE` and `HQ_CHROME_EXECUTABLE` select an existing installation. The check intercepts the API and never sends emails or changes business records. It covers ten destinations, four real downloads, logout and 1440/1024/390/320px widths.

Deployment must retain the exact current worker versions for rollback, preserve routes/bindings/schedules, and respect the existing shared production release guard. Stage verification is separate from production completion.
