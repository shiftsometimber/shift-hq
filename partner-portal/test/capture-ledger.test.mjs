import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,ORDER} from './fixture.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import {economicsTerms} from '../platform/domain.mjs';
import {originalCaptureWork} from '../platform/capture-ledger.mjs';
import {allowedPath} from '../policy.mjs';
const session='cs_test_QA_'+'d'.repeat(32),intent='pi_test_QA_'+'d'.repeat(32),occurred='2026-11-01T12:00:00.000Z',received='2026-11-01T12:00:01.000Z';
const terms=()=>({model:'shift_collects',supplierId:'TEST-SUPPLIER',sellingPence:10000,outputTaxPence:0,taxTreatment:'TEST ONLY',approvalReference:'TEST-COST-APPROVAL',costSourceReference:'TEST-COSTS'});
async function setup(){
 const f=await fixture();Object.assign(f.env,{SSTRX_PLATFORM_ENABLED:'true',SSTRX_FUNCTIONAL_V3_ENABLED:'true',SSTRX_ENVIRONMENT:'synthetic',STRIPE_MODE:'test'});await ensurePlatformSchema(f.DB);
 f.sql.prepare("INSERT INTO medicine_variants(id,medicine_id,strength_label,selling_price_pence,status,updated_at,sellable,availability_state) VALUES(9911,1,'TEST',10000,'available',?,1,'available')").run(received);
 f.sql.prepare("UPDATE medicine_orders SET variant_id=9911,medicine_name='TEST-NOT-FOR-SUPPLY',email='fictional@example.test',stripe_checkout_session_id=?,stripe_payment_intent_id=?,total_pence=10000 WHERE order_number=?").run(session,intent,ORDER);
 f.sql.prepare("UPDATE users SET email='fictional@example.test' WHERE id=42").run();
 f.sql.exec('CREATE TABLE medicine_payment_receipts(event_id TEXT PRIMARY KEY,order_number TEXT,session_id TEXT,payment_intent TEXT,mode TEXT,amount_pence INTEGER,currency TEXT,occurred_at TEXT,received_at TEXT,payload_digest TEXT)');
 function capture(id='evt_original',time=received){f.sql.prepare('INSERT INTO medicine_payment_receipts VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,ORDER,session,intent,'test',10000,'GBP',occurred,time,'f'.repeat(64));}
 capture();
 const raw=(action,body={},actor=1)=>f.hq('/platform/commercial/'+ORDER+'/'+action,actor,body);
 const call=async(action,body={},status=200,actor=1)=>{const r=await raw(action,body,actor),value=await r.json();assert.equal(r.status,status,JSON.stringify(value));return value;};
 const seedTerms=()=>f.sql.prepare('INSERT INTO rx_economics VALUES(?,1,?,?)').run(ORDER,JSON.stringify(economicsTerms(terms())),received);
 const ledger=()=>f.sql.prepare('SELECT * FROM rx_finance_entries ORDER BY id').all();
 return {...f,capture,raw,call,seedTerms,ledger};
}
test('Approved terms and the verified original capture share one native transaction; repeated callbacks and recovery never book twice',async()=>{
 const f=await setup(),oldFetch=globalThis.fetch;let outgoing=0;try{
 globalThis.fetch=async()=>{outgoing++;throw Error('External transaction forbidden')};f.capture('evt_duplicate','2026-11-01T12:00:02.000Z');
 const result=await f.call('terms',terms(),201);assert.equal(result.captureLedger.state,'recorded');let entries=f.ledger();assert.equal(entries.length,1);assert.equal(entries[0].amount_pence,10000);assert.equal(entries[0].occurred_at,occurred);assert.equal(entries[0].source_reference,'medicine-receipt:evt_original');
 const first={...entries[0]};await f.call('terms',terms(),409);const replay=await f.call('capture');assert.equal(replay.duplicate,true);assert.deepEqual({...f.ledger()[0]},first);assert.equal(outgoing,0);
 const view=await f.hq('/platform/commercial/'+ORDER,1);assert.equal(view.status,200);assert.equal((await view.json()).entries.length,1);
 }finally{globalThis.fetch=oldFetch;f.close()}
});
test('Historical terms recover a missing original ledger entry using only the existing immutable receipt',async()=>{
 const f=await setup();try{
 f.seedTerms();const before=await originalCaptureWork(f.env);assert.equal(before.records.length,1);assert.equal(before.records[0].state,'ready');
 const recovered=await f.call('capture');assert.equal(recovered.state,'recorded');assert.equal(recovered.moneyMoved,false);assert.equal(f.ledger().length,1);assert.equal((await originalCaptureWork(f.env)).records.length,0);assert.equal((await f.call('capture')).duplicate,true);
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_platform_audit WHERE action='original_capture_recorded'").get().n,1);
 }finally{f.close()}
});
test('Only the owner can import server-verified amounts; fake client receipts, missing costs and reserved manual references are rejected',async()=>{
 const f=await setup();try{
 await f.call('capture',{},409);assert.equal(f.ledger().length,0);f.seedTerms();
 for(const actor of [3,4])await f.call('capture',{},403,actor);await f.call('capture',{},401,6);
 await f.call('capture',{amountPence:999999},422);
 await f.call('entry',{kind:'member_payment',amountPence:10000,eventReference:'medicine-capture:forged',sourceReference:'TEST-FORGED',occurredAt:occurred},403);
 assert.equal(f.ledger().length,0);
 }finally{f.close()}
});
test('Missing, contradictory, corrupt and future capture receipts cannot book funds or write terms',async()=>{
 for(const change of ["UPDATE medicine_payment_receipts SET amount_pence=1","UPDATE medicine_payment_receipts SET currency='USD'","UPDATE medicine_payment_receipts SET mode='live'","UPDATE medicine_payment_receipts SET session_id='other'","UPDATE medicine_payment_receipts SET payload_digest='bad'","UPDATE medicine_payment_receipts SET occurred_at='invalid'","UPDATE medicine_payment_receipts SET received_at='2099-01-01T00:00:00.000Z'"]){
 const f=await setup();try{f.sql.exec(change);await f.call('terms',terms(),409);assert.equal(f.ledger().length,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_economics').get().n,0);}finally{f.close()}
 }
 const f=await setup();try{f.sql.exec('DELETE FROM medicine_payment_receipts');const saved=await f.call('terms',terms(),201);assert.equal(saved.captureLedger.state,'unavailable');await f.call('capture',{},409);assert.equal(f.ledger().length,0);f.capture();await f.call('capture');assert.equal(f.ledger().length,1);}finally{f.close()}
});
test('An existing legacy original payment requires review and cannot be double-booked; additional payments stay independent',async()=>{
 const f=await setup();try{
 f.seedTerms();f.sql.prepare('INSERT INTO rx_finance_entries VALUES(?,?,?, ?,?,?,?,?,?)').run('legacy',ORDER,'TEST-LEGACY','member_payment',10000,'GBP','TEST-OLD-SOURCE',occurred,received);await f.call('capture',{},409);assert.equal(f.ledger().length,1);
 f.sql.exec('DELETE FROM rx_finance_entries');f.sql.prepare('INSERT INTO rx_finance_entries VALUES(?,?,?, ?,?,?,?,?,?)').run('top-up',ORDER,'price-payment:TEST-extra','member_payment',500,'GBP','TEST-EXTRA-RECEIPT',occurred,received);await f.call('capture');assert.equal(f.ledger().length,2);assert.equal(f.ledger().reduce((n,e)=>n+e.amount_pence,0),10500);
 }finally{f.close()}
});
test('Audit or ledger failure rolls back the entire new terms and capture write',async()=>{
 for(const kind of ['audit','ledger']){
 const f=await setup();try{
 if(kind==='audit')f.sql.exec("CREATE TRIGGER fail_capture_audit BEFORE INSERT ON rx_platform_audit WHEN NEW.action='terms_recorded' BEGIN SELECT RAISE(ABORT,'audit_unavailable'); END;");
 else f.sql.exec("CREATE TRIGGER fail_capture_ledger BEFORE INSERT ON rx_finance_entries BEGIN SELECT RAISE(ABORT,'ledger_unavailable'); END;");
 await f.call('terms',terms(),503);assert.equal(f.ledger().length,0);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_economics').get().n,0);assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM rx_platform_audit WHERE action='terms_recorded'").get().n,0);
 }finally{f.close()}
 }
});
test('Receipt, session or terms races cannot leave a capture entry behind',async()=>{
 for(const race of ['source','session','terms']){
 const f=await setup();try{
 if(race==='terms')f.seedTerms();const original=f.DB.batch.bind(f.DB);let first=true;
 f.DB.batch=async commands=>{if(first){first=false;if(race==='source')f.sql.exec('UPDATE medicine_payment_receipts SET amount_pence=NULL');if(race==='session')f.sql.prepare('UPDATE hq_sessions SET revoked_at=? WHERE hq_user_id=1').run(new Date().toISOString());if(race==='terms')f.sql.exec('UPDATE rx_economics SET version=version+1');}return original(commands);};
 await f.call(race==='terms'?'capture':'terms',race==='terms'?{}:terms(),409);assert.equal(f.ledger().length,0);if(race!=='terms')assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_economics').get().n,0);
 }finally{f.close()}
 }
});
test('Real-member partitions and unapproved production mode cannot import an original capture',async()=>{
 for(const change of ['email','variant','production']){
 const f=await setup();try{f.seedTerms();if(change==='email')f.sql.prepare("UPDATE users SET email='real@deliverable.example' WHERE id=42").run();if(change==='variant')f.sql.prepare('UPDATE medicine_orders SET variant_id=11').run();if(change==='production')Object.assign(f.env,{SSTRX_ENVIRONMENT:'production',STRIPE_MODE:'live'});await f.call('capture',{},409);assert.equal(f.ledger().length,0);}finally{f.close()}
 }
});
test('Gateway admits only the exact oversight capture-link POST',()=>{
 const path='/api/clinical/platform/commercial/SST-20261106-TEST/capture';assert.equal(allowedPath(path,'POST','oversight'),true);for(const role of ['clinician','dispensing','clinical_admin','pharmacy_admin','support'])assert.equal(allowedPath(path,'POST',role),false);for(const method of ['GET','PUT','DELETE'])assert.equal(allowedPath(path,method,'oversight'),false);assert.equal(allowedPath(path+'/extra','POST','oversight'),false);
});
