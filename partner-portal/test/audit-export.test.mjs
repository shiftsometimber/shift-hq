import test from 'node:test';
import assert from 'node:assert/strict';
import {functionalDataset} from '../qa/functional-fixtures.mjs';
import {ensureAuditSchema,sealRecord} from '../platform/audit-export.mjs';
import {RECORD} from './fixture.mjs';
import {digest} from '../platform/domain.mjs';
const j=async(r,status=200)=>{const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d};
async function setup(){const f=await functionalDataset('E');f.env.SSTRX_AUDIT_V3_ENABLED='true';await ensureAuditSchema(f.DB);return {...f,export:(actor=3)=>f.hq('/platform/exports/'+RECORD,actor,{purpose:'FICTIONAL acceptance review'}),verify:(checkpoint,actor=3)=>f.hq('/platform/audit-proof/'+RECORD,actor,{checkpoint})};}
test('RX-AUD1 native clinical views and changes append scoped metadata and independently verifiable seals',async()=>{
 const f=await setup();try{
  await j(await f.call(''));const before=f.sql.prepare('SELECT COUNT(*) n FROM rx_audit_journal').get().n;
  await j(await f.verify());const exported=await j(await f.export());assert.equal(await digest(exported.content),exported.contentDigest);assert.equal(exported.content.scope,'clinical');assert(exported.content.assessments[0].answers.fullName);assert(exported.content.documents.every(d=>d.cryptographicDocumentBindingVerified));assert(f.sql.prepare('SELECT COUNT(*) n FROM rx_audit_journal').get().n>before);
  assert(exported.content.audit.some(e=>e.action==='clinical_record_viewed'&&e.actorId==='3'&&e.organisationId==='clinical-org'));assert(exported.content.audit.some(e=>e.action==='prescription_document_signed'));
  assert((await j(await f.verify(exported.content.checkpoint))).retainedCheckpointMatches);const receipt=f.sql.prepare('SELECT * FROM rx_export_receipts WHERE id=?').get(exported.receiptId);assert.equal(receipt.actor_id,'3');assert.equal(receipt.purpose,'FICTIONAL acceptance review');assert.equal(receipt.content_digest,exported.contentDigest);
 }finally{f.close();}
});
test('RX-AUD2 owner, operations and pharmacy exports are scoped and logged; another pharmacy and revoked clinician cannot export',async()=>{
 const f=await setup();try{
  const owner=await j(await f.export(1)),operations=await j(await f.export(6)),pharmacy=await j(await f.export(4));assert.equal(owner.content.assessments,undefined);assert.equal(owner.content.documents[0].document,undefined);assert(owner.content.finance);assert.equal(operations.content.finance,undefined);assert.equal(operations.content.assessments,undefined);assert(operations.content.audit.every(r=>!r.detail));assert.equal(pharmacy.content.assessments,undefined);assert(pharmacy.content.documents.every(d=>d.document.partnerId==='pharmacy-org'));
  await j(await f.export(5),404);f.sql.prepare('UPDATE clinical_case_assignments SET active=0 WHERE hq_user_id=3').run();await j(await f.export(),404);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_export_receipts').get().n,3);
 }finally{f.close();}
});
test('RX-AUD3 immutable source/history guards reject edits and an independent checkpoint detects privileged journal rewriting',async()=>{
 const f=await setup();try{
  const exported=await j(await f.export());assert.throws(()=>f.sql.prepare("UPDATE clinical_prescription_signatures SET digest='forged'").run(),/immutable/);assert.throws(()=>f.sql.prepare("DELETE FROM clinical_case_events").run(),/immutable/);assert.throws(()=>f.sql.prepare("UPDATE rx_audit_journal SET actor_id='forged'").run(),/immutable/);
  // An explicit database-admin attack in this isolated fixture, not a product bypass.
  f.sql.exec('DROP TRIGGER rx_immutable_rx_audit_journal_update');f.sql.prepare("UPDATE rx_audit_journal SET actor_id='tampered' WHERE sequence=1").run();await j(await f.verify(exported.content.checkpoint),409);
 }finally{f.close();}
});
test('RX-AUD4 raw signed-document corruption fails export verification even if a database administrator removes the edit trigger',async()=>{
 const f=await setup();try{
  await j(await f.export());f.sql.exec('DROP TRIGGER rx_immutable_clinical_prescription_signatures_update');f.sql.prepare("UPDATE clinical_prescription_signatures SET document_json=json_set(document_json,'$.treatment.dose','FORGED')").run();await j(await f.export(),503);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_export_receipts').get().n,1);
 }finally{f.close();}
});
