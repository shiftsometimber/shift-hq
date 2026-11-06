# Hosted QA packaging correction — 6 November 2026

The actual Safari run against source 9929ca4 / clinical 3fa3c955 failed. The served commerce JavaScript contained `__name(api, "api")` without the helper in browser scope. The form handler was null and the original three hosted order references were unchanged. The existing deployment command had re-bundled the already-built Worker. The browser/local qualification had only exercised the pre-Wrangler modules.

Private prebuilt configurations now set no_bundle. The exact Wrangler dry-run outputs for Core, clinical and edge are compared byte-for-byte with their built inputs, then those final emitted modules run native and Chromium/WebKit checkout/expiry qualification. Final artifacts passed with zero real transactions or outgoing messages. No production configuration, identity, professional MFA or patient data was changed.

The page guard also admits a signed-Access protected top-level GET/HEAD document return from reviewer sign-in, while cross-site fetches, frames, foreign origins, API reads and all writes remain denied. Dedicated positive and negative checks exercise both page and native catalogue routes.

The pinned original hosted failure is retained. This correction is a successor, not a retrospective pass for 9929ca4. Hosted acceptance is still required after deployment.
