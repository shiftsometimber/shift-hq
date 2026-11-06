import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {wrapDatabase} from './database.mjs';
import {fixture,ORDER} from './fixture.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import {ensureRefundSchema} from '../platform/refunds.mjs';
import {economicsTerms} from '../platform/domain.mjs';
import {qaStatementTransport,qaStatementEnvironment,qaStatementReference} from '../qa/statement-transport.mjs';
const dbId='00000000-0000-4000-8000-000000000031';
const fromAt='2026-11-01T00:00:00.000Z',toAt='2026-11-02T00:00:00.000Z',sourceTime='2026-11-01T12:00:00.000Z';
const session='cs_test_QA_'+'a'.repeat(32),intent='pi_test_QA_'+'a'.repeat(32);
function mark(DB,sql){
 sql.exec('CREATE TABLE sstrx_qa_environment(environment TEXT,database_id TEXT,synthetic_only INTEGER)');
 sql.prepare('INSERT INTO sstrx_qa_environment VALUES(?,?,1)').run('joined-v31',dbId);
 return {DB,SSTRX_ENVIRONMENT:'synthetic',SSTRX_QA_STACK:'joined-v31',SSTRX_QA_DATABASE_ID:dbId,STRIPE_MODE:'test',SSTRX_QA_REFUNDS_ENABLED:'true',SSTRX_QA_STATEMENTS_ENABLED:'true'};
}
function tables(sql){
 sql.exec("CREATE TABLE IF NOT EXISTS qa_simulated_checkouts(id TEXT PRIMARY KEY,order_number TEXT,member_id INTEGER,session_json TEXT,outcome TEXT,event_created INTEGER,event_id TEXT,event_type TEXT);CREATE TABLE IF NOT EXISTS qa_simulated_refunds(idempotency_key TEXT PRIMARY KEY,refund_id TEXT,response_json TEXT,created_at TEXT)");
}
function addCapture(sql,{id=session,at=sourceTime,outcome='paid',member=1}={}){
 const order='TEST-ORDER-'+id,object={id,object:'checkout.session',currency:'gbp',amount_total:10000,livemode:false,simulation:true,client_reference_id:order,metadata:{order_number:order,order_type:'medicine',user_id:String(member)}};
 sql.prepare('INSERT INTO qa_simulated_checkouts VALUES(?,?,?,?,?,?,?,?)').run(id,order,member,JSON.stringify(object),outcome,Date.parse(at)/1000,'evt_test_QA_'+id,'checkout.session.completed');
}
function addRefund(sql,{id='b'.repeat(32),amount=1000,at=sourceTime}={}){
 const receipt={id:'re_test_QA_'+id,object:'refund',status:'succeeded',amount,currency:'gbp',payment_intent:intent,livemode:false,simulation:true};
 sql.prepare('INSERT INTO qa_simulated_refunds VALUES(?,?,?,?)').run('KEY-'+id,'REFUND-'+id,JSON.stringify(receipt),at);
}
function setup(){
 const sql=new DatabaseSync(':memory:'),{DB}=wrapDatabase(sql);sql.exec("CREATE TABLE users(id INTEGER PRIMARY KEY,email TEXT);INSERT INTO users VALUES(1,'test@example.test');CREATE TABLE rx_finance_entries(amount_pence INTEGER);INSERT INTO rx_finance_entries VALUES(999999)");
 tables(sql);const env=mark(DB,sql),transport=qaStatementTransport(env);
 const request=(reference=qaStatementReference(fromAt,toAt),options={})=>new Request(options.url||'https://processor.invalid/statement/'+encodeURIComponent(reference),{method:options.method||'GET'});
 return {sql,DB,env,transport,request,close:()=>sql.close()};
}
test('Simulated statement independently totals durable provider captures/refunds and retains one immutable receipt',async()=>{
 const f=setup();try{
 addCapture(f.sql);addRefund(f.sql);const request=f.request(),result=await f.transport.fetch(request);assert.equal(result.status,200);const value=await result.json();assert.equal(value.netReceivedPence,9000);assert.equal(value.captureCount,1);assert.equal(value.refundCount,1);assert.equal(value.bankBalanceRepresented,false);assert.equal(value.simulation,true);assert.ok(!JSON.stringify(value).includes(intent));
 f.sql.exec('UPDATE rx_finance_entries SET amount_pence=1');assert.deepEqual(await(await f.transport.fetch(request)).json(),value);
 assert.throws(()=>f.sql.exec("UPDATE qa_simulated_statements SET statement_json='{}'"),/immutable_qa_statement/);assert.throws(()=>f.sql.exec('DELETE FROM qa_simulated_statements'),/immutable_qa_statement/);
 }finally{f.close()}
});
test('Statement binding rejects live, mixed, disabled and unmarked environments before retaining a statement',async()=>{
 const f=setup();try{
 for(const change of [{SSTRX_ENVIRONMENT:'production'},{STRIPE_MODE:'live'},{SSTRX_QA_STATEMENTS_ENABLED:'false'},{SSTRX_QA_REFUNDS_ENABLED:'false'},{SSTRX_QA_DATABASE_ID:'88f40aed-cb23-4372-8c94-8a73f48bc847'},{STRIPE_SECRET_KEY:'sk_test_NOT_AN_ACCOUNT'}])await assert.rejects(qaStatementTransport({...f.env,...change}).fetch(f.request()),/isolated_qa_statement/);
 await assert.rejects(qaStatementEnvironment({...f.env,STATEMENT_TEST_TRANSPORT:{}}),/already_supplied/);
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='qa_simulated_statements'").get().n,0);
 }finally{f.close()}
});
test('Only closed bounded periods and the exact internal read route can request a statement',async()=>{
 const f=setup();try{
 for(const req of [f.request('not-a-statement'),f.request(undefined,{method:'POST'}),f.request(undefined,{url:'https://outside.example/statement/TEST'}),f.request(undefined,{url:'https://processor.invalid/statement/TEST?override=1'}),f.request(qaStatementReference(toAt,fromAt)),f.request(qaStatementReference(fromAt,'2026-12-01T00:00:00.000Z'))])assert.ok((await f.transport.fetch(req)).status>=400);
 assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='qa_simulated_statements'").get().n,0);
 }finally{f.close()}
});
test('Invalid or orphaned provider captures cannot become zero or a valid statement',async()=>{
 for(const change of ["UPDATE users SET email='real@deliverable.example'","DELETE FROM users","UPDATE qa_simulated_checkouts SET event_id='wrong'","UPDATE qa_simulated_checkouts SET session_json='invalid'","UPDATE qa_simulated_checkouts SET session_json=json_set(session_json,'$.livemode',json('true'))","UPDATE qa_simulated_checkouts SET session_json=json_set(session_json,'$.amount_total',1.5)"]){
 const f=setup();try{addCapture(f.sql);f.sql.exec(change);assert.equal((await f.transport.fetch(f.request())).status,409);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM qa_simulated_statements').get().n,0);}finally{f.close()}
 }
});
test('Unresolved provider outcomes prevent a closed statement; boundaries are inclusive/exclusive and refund-only totals can be negative',async()=>{
 const f=setup();try{
 addCapture(f.sql,{outcome:'processing'});assert.equal((await f.transport.fetch(f.request())).status,409);f.sql.exec('DELETE FROM qa_simulated_checkouts');
 addCapture(f.sql,{at:toAt});addRefund(f.sql,{at:fromAt,amount:100});addRefund(f.sql,{id:'c'.repeat(32),at:toAt,amount:500});
 const value=await(await f.transport.fetch(f.request())).json();assert.equal(value.netReceivedPence,-100);assert.equal(value.captureCount,0);assert.equal(value.refundCount,1);
 }finally{f.close()}
});
test('Concurrent statement reads retain a single stable provider snapshot',async()=>{
 const f=setup();try{addCapture(f.sql);const req=f.request(),results=await Promise.all([f.transport.fetch(req),f.transport.fetch(req)]),values=await Promise.all(results.map(r=>r.json()));assert.deepEqual(values[0],values[1]);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM qa_simulated_statements').get().n,1);}finally{f.close()}
});
test('Native period reconciliation accepts a verified negative provider total and records its own matching source once',async()=>{
 const f=await fixture();try{
 Object.assign(f.env,mark(f.DB,f.sql),{SSTRX_PLATFORM_ENABLED:'true',SSTRX_FUNCTIONAL_V3_ENABLED:'true'});
 await ensurePlatformSchema(f.DB);await ensureRefundSchema(f.DB);tables(f.sql);addRefund(f.sql,{amount:100});
 f.sql.prepare('INSERT INTO rx_economics VALUES(?,1,?,?)').run(ORDER,JSON.stringify(economicsTerms({model:'shift_collects',supplierId:'TEST',sellingPence:10000,outputTaxPence:0,taxTreatment:'TEST',approvalReference:'TEST-ECONOMICS',costSourceReference:'TEST-COSTS'})),sourceTime);
 f.sql.prepare('INSERT INTO rx_finance_entries VALUES(?,?,?, ?,?,?,?,?,?)').run(crypto.randomUUID(),ORDER,'TEST-REFUND-ENTRY','refund',100,'GBP','TEST-PROVIDER-REFUND',sourceTime,sourceTime);
 Object.assign(f.env,await qaStatementEnvironment(f.env));const command={sourceReference:qaStatementReference(fromAt,toAt),fromAt,toAt,ownerUserId:1,dueAt:new Date(Date.now()+3600000).toISOString(),orderReference:'ALL'};
 const response=await f.hq('/platform/reconciliation',1,command),value=await response.json();assert.equal(response.status,200,JSON.stringify(value));assert.equal(value.state,'matched');assert.equal(value.variancePence,0);
 const replay=await(await f.hq('/platform/reconciliation',1,command)).json();assert.equal(replay.duplicate,true);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_reconciliation_runs').get().n,1);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_reconciliation_sources').get().n,1);
 }finally{f.close()}
});
