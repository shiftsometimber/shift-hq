# Joined source reconciliation — 6 November 2026

Joined source `5e361e2c733293cd6159d3cb03a536a2757051fb` and deployed member source `2f938ec35f0fddeac735411697c5b76d1e499bd1` are both retained as merge parents. Core qualification uses `7d63a50b7e67955627ad957e1b549d0294bcf123`. All six member commits are included.

The UI conflict retains navigation diagnostics and private download URL revocation alongside native account-change clearing, real preferences links and the existing deletion route. Legacy inbox flag-off and account-generation guards are retained.

## Verification

- Component checks: 248 passed, zero failed, zero skipped.
- Compiled member browser checks: 44 passed in Chromium and 44 in WebKit; intercepted local transport, zero external requests.
- Native local API workflow: three canonical order/case journeys and five scoped exports.
- Exact private-stack modules: 10 checks passed, including fresh simulated checkout, duplicate callback safety, expired checkout denial and shared member/HQ records. Commerce UI passes Chromium and WebKit locally. WebKit cookie/FormData bridges remain test limitations, not actual hosted Safari evidence.
- Initial private qualification correctly refused expired fictional stock authority. A fresh local fixture was created through the existing native workflow using the new optional absolute `SSTRX_QA_NATIVE_FIXTURE_ROOT`; original hosted fixture credentials were verified unchanged. Defaults remain compatible. No production purchase guard was weakened.

## Release limits

This receipt qualifies source and local compiled tests only. It does not establish the full 132 named release cases, actual hosted Safari dispensing/export, installed phones, connected provider/processor commissioning or production switch-on. No real member, charge, prescription, supplier order, shipment or external communication occurred. No production deployment is made by this commit.

## Reproducible evidence

Existing SST Mac task directory: `/Users/shiftsometimberltd/SST/builds/sstrx-functional-v3-20261105`.

- `joined-member-reconcile-final-tests-20261106.log`
- `joined-member-reconcile-browser/acceptance.json`
- `joined-member-reconcile-native-fixture/report.json`
- `joined-member-reconcile-fresh-private-stack-20261106.log`
- Current source `.partner-qa/hosted/qualification.json` and `build-manifest.json`

All automated checks use the existing workspace-control wrapper with one managed process and cleanup. No new repository clone or dependency installation.

Recorded: 2026-11-06T17:43:14.916687+00:00
