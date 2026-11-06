# Hosted QA packaging correction — 6 November 2026

The actual Safari run against source 9929ca4 / clinical 3fa3c955 failed. The served commerce JavaScript contained `__name(api, "api")` without the helper in browser scope. The form handler was null and the original three hosted order references were unchanged. The existing deployment command had re-bundled the already-built Worker. The browser/local qualification had only exercised the pre-Wrangler modules.

Private prebuilt configurations now set no_bundle. The exact Wrangler dry-run outputs for Core, clinical and edge are compared byte-for-byte with their built inputs, then those final emitted modules run native and Chromium/WebKit checkout/expiry qualification. Final artifacts passed with zero real transactions or outgoing messages. No production configuration, identity, professional MFA or patient data was changed.

The page guard also admits a signed-Access protected top-level GET/HEAD document return from reviewer sign-in, while cross-site fetches, frames, foreign origins, API reads and all writes remain denied. Dedicated positive and negative checks exercise both page and native catalogue routes.

The pinned original hosted failure is retained. This correction is a successor, not a retrospective pass for 9929ca4. Hosted acceptance is still required after deployment.


## Hosted successor: native save, finance and provider double

A fresh hosted synthetic order SST-20261106-9C47D781 reached paid and the owned member care record. The first assessment write persisted but returned 409 because the strict row-count check observed trigger side effects. Native clinical/member services now obtain SQLite changes() immediately after each mutation inside the same transaction; stale guards still require exactly one original row. The regression includes trigger-backed writes, zero-row stale writes and transaction rollback. This is a fix awaiting hosted recheck, not a hosted acceptance pass.

The provider double has durable idempotent submissions and authenticated, versioned receipts. Owner TEST setup, current signed route capture, uncertain reconciliation and pharmacy-native projection reuse retained identities and handlers. The TEST-only UI is unavailable outside the marked synthetic database. Owner control does not confer dispensing authority. Receipt order is buffered; transport acknowledgement does not mean pharmacy acceptance. No real provider is commissioned.

Finance reconciliation replay/concurrency now retains one run and owned variance. Core retains immutable, verified medicine capture-event receipts and refuses mismatched amount/currency/session/mode/owner/time. These fictional module/native checks do not prove a real processor or real supplier integration. HQ money source mapping and complete hosted/device acceptance remain outstanding.
