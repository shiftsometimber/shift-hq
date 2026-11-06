# Private QA refund transport

The existing clinical QA service may bind `qaRefundTransport` only with the isolated database marker, test environment and explicit `SSTRX_QA_REFUNDS_ENABLED=true`. It is never installed in a production entry point and refuses any processor secret.

The transport handles only POST `https://api.stripe.com/v1/refunds`. It requires the native approved refund, native refund-source snapshot, original fictional medicine order (variant 9911), reserved example.test/example.invalid member and order destinations, and a matching native TEST capture receipt. Additional payments remain denied until separately qualified.

One immutable simulated processor receipt is retained per original idempotency key. The existing refund handler still owns authentication, approval, amount limits, unknown-outcome recovery, member projection and finance reconciliation. A missing or conflicting capture cannot become a success. No network or real refund is performed.

`qa-finance-transport.test.mjs` covers denied bindings/requests, immutable and concurrent replay, capture mismatch, changed request rejection and the native request → approval → lost response → same-key recovery → one member refund/ledger entry. `check-private-stack.mjs` additionally qualifies the actual emitted QA modules and generated variables against a fresh native checkout receipt. Hosted acceptance and real processor commissioning remain separate.
