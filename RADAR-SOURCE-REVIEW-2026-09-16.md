# Radar source-change review repair — 16 September 2026

Baseline: `shiftsometimber/shift-hq` main `720f104454739f06639feb17c373ded96da2dd74`. Public `index.html` and `hq.js` bytes matched this revision before editing.

This additive UI change consumes the `source_change` queue field provided by the companion Shift Core source-review repair in PR #688. It does not publish, approve, scan, or change any article on page load.

- Queue and editor show a fresh-review warning, recorded observation time in UK time, original source link, and escaped observation details. Observation is separate from the retained article package.
- Pending source changes block Save, Approve, and Publish, including queued publication and batch selection. A successful retrieval does not become approval.
- Existing reviewer roles (owner, admin, operations, editor) can explicitly confirm **Start source correction**. The confirmation states that a currently published article leaves public publication when correction starts; the prior version remains audited.
- The UI posts only the decision note to the existing `correct` action. It adopts no observation itself. The server response and a fresh queue read determine the next screen.
- Fresh preparation uses the existing `process` action as a separate explicit click. Approval/publication remain separate owner/admin actions. Failed correction retains the displayed article and warning.
- Protected `hq-v111.js`, login/bootstrap, commerce controls, and existing Evidence Desk boundary remain unchanged. Styles are scoped to the Radar warning and editor; font inheritance is retained.

Validation: six local production-helper behavior tests pass, syntax and Evidence Desk source gate pass, and protected legacy runtime hash remains `c25ea60d13b6b82f48518898478645f9547ad94d`.

The integration workflow also runs six isolated Chromium fixture cases using only intercepted, fictional API responses. No live account or queue is used. Local Chromium execution is pending because the browser binary download timed out; the hosted fixture run must pass before release.

No medical review, publication approval, private account access, or production deployment is represented by these UI tests.
