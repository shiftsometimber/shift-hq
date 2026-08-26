import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';

const runtime=readFileSync(new URL('./hq.js',import.meta.url),'utf8');
const styles=readFileSync(new URL('./hq-evidence-desk.css',import.meta.url),'utf8');

for(const wording of [
  'SHIFT EVIDENCE INBOX · READ ONLY','Keep the website true when the evidence moves.','This screen reports the machine truth; it cannot grant a review or publish.',
  'Environment: non-production / staging','Editorial accepted','Specialist review: not obtained','Publication: disabled',
  'Source monitoring','Automatic drafting','Website destination','Newsletter destination','Social destinations','Production authority'
])assert.ok(runtime.includes(wording),`missing governed UI wording: ${wording}`);

assert.ok(runtime.includes("'/v1/hq/evidence-desk'+path"));
assert.doesNotMatch(runtime,/\/v1\/hq\/evidence-desk\/packages\/\$\{id\}\/decision/);
assert.doesNotMatch(runtime,/evidenceSeed|draftEvidencePackage|evidenceDecision|data-evidence-decision|data-evidence-package/);
assert.doesNotMatch(runtime,/Approve web only|No publication justified|Send to reviewer|Record comms decision/);
assert.doesNotMatch(runtime,/Approve article and distribute everywhere/i);
assert.doesNotMatch(runtime,/data-evidence-decision="publish"/);
assert.match(styles,/#050505/);assert.match(styles,/#E7E3DA/);assert.match(styles,/#707762/);

console.log('Evidence Desk HQ source gate PASS: Inbox is read-only and reports the honest non-production monitoring, drafting, review and destination state.');
