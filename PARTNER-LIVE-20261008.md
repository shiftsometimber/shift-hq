# Partner workspace live release — 8 October 2026

Approved in chat: Proceed now.
HQ version: 145b03ba-04b5-4bdf-bf79-2313793338f3
Isolated HQ management API version: 19fa19fc-1968-4e21-b9d5-abe1f1113250
Previous HQ version: 86be3a15-b5ed-42de-8e6c-6112c0dcdfa3
Previous HQ management API: 5db8e64b-f674-41f3-9ca6-c7d33b3ad110

Three additive tables created, verified empty. Internal partner feature enabled. No external memberships, invitation endpoints or partner-login routes enabled. Process maps remain draft planning maps, not automated stage tracking.

Verified exact published asset bytes, anonymous API 401 boundaries and write preflight/CORS. Isolated real API/UI tests passed for register/handovers, audit rollback, cross-partner isolation, expired/disabled membership and auth clearing. Example-data process maps passed desktop/mobile tests. No live owner session: authenticated production saves were not exercised.

Deployment intentionally targets shift-hq and isolated shift-hq-management only; public core is unchanged. Backend code must not be promoted through broad core deployment.
