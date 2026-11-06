import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,ORDER} from './fixture.mjs';
import {ensureFinanceOperations} from '../platform/finance-operations.mjs';
const json=async(response,status=200)=>{const data=await response.json();assert.equal(response.status,status,JSON.stringify(data));return data;};
async function setup(){
 const f=await fixture();Object.assign(f.env,{SSTRX_PLATFORM_ENABLED:'true',SSTRX_FUNCTIONAL_V3_ENABLED:'true',SSTRX_ENVIRONMENT:'synthetic'});
 await ensureFinanceOperations(f.DB);const created=new Date().toISOString(),dueAt=new Date(Date.now()+3600000).toISOString();
 f.sql.prepare("INSERT INTO rx_finance_exceptions(id,order_number,kind,state,owner_user_id,due_at,detail_json,created_at) VALUES('TEST-VARIANCE',?,'reconciliation_variance','open',1,?,?,?)").run(ORDER,dueAt,JSON.stringify({variancePence:-300,sourceReference:'TEST-STATEMENT'}),created);
 f.sql.prepare("INSERT INTO rx_reconciliation_runs VALUES('TEST-ORIGINAL','2026-11-01T00:00:00Z','2026-11-02T00:00:00Z','TEST-STATEMENT',-300,'variance',?)").run(created);
 const call=(suffix='',body,actor=1)=>f.hq('/platform/finance-exceptions'+suffix,actor,body);
 const command=(extra={})=>({version:1,clientReference:crypto.randomUUID(),sourceReference:'TEST-FINANCE-APPROVAL',reason:'Synthetic finance ownership',ownerUserId:2,...extra});
 return {...f,call,command,dueAt};
}
test('Finance exception cover preserves primary owner and original deadline, and assignment/cover are audited once',async()=>{
 const f=await setup();try{
  const body=f.command(),first=await json(await f.call('/TEST-VARIANCE/cover',body));
  assert.equal(first.exception.ownerUserId,1);assert.equal(first.exception.coverOwnerUserId,2);
  assert.equal(first.exception.dueAt,f.dueAt);assert.equal(first.exception.originalDueAt,f.dueAt);
  const replay=await json(await f.call('/TEST-VARIANCE/cover',body));assert.equal(replay.duplicate,true);
  const detail=await json(await f.call('/TEST-VARIANCE'));assert.equal(detail.history.length,1);
  assert.equal(detail.history[0].event.before.ownerUserId,1);assert.equal(detail.history[0].event.after.coverOwnerUserId,2);
  await json(await f.call('/TEST-VARIANCE/cover',{...body,reason:'Changed content'}),409);
  assert.throws(()=>f.sql.prepare('DELETE FROM rx_finance_exception_history').run(),/immutable_finance_exception_history/);
  assert.throws(()=>f.sql.prepare('UPDATE rx_finance_exception_commands SET result_json=\'{}\'').run(),/immutable_finance_exception_command/);
 }finally{f.close();}
});
test('Reassignment cannot silently postpone a financial commitment; a reviewed deadline retains the original',async()=>{
 const f=await setup();try{
  const dueAt=new Date(Date.now()+7200000).toISOString(),body=f.command({dueAt});
  await json(await f.call('/TEST-VARIANCE/assign',body),422);
  const changed=await json(await f.call('/TEST-VARIANCE/assign',{...body,deadlineApprovalReference:'TEST-EXPLICIT-REVISED-COMMITMENT'}));
  assert.equal(changed.exception.ownerUserId,2);assert.equal(changed.exception.dueAt,dueAt);assert.equal(changed.exception.originalDueAt,f.dueAt);
  await json(await f.call('/TEST-VARIANCE/assign',f.command()),409);
 }finally{f.close();}
});
test('Variance resolution needs a retained zero-variance statement for the same period; notes cannot manufacture money',async()=>{
 const f=await setup();try{
  const body=f.command({resolutionKind:'matched_statement',reconciliationRunId:'MISSING'});
  await json(await f.call('/TEST-VARIANCE/resolve',body),409);
  f.sql.prepare("INSERT INTO rx_reconciliation_runs VALUES('TEST-WRONG-PERIOD','2026-10-01T00:00:00Z','2026-10-02T00:00:00Z','TEST-OTHER',0,'matched',?)").run(new Date().toISOString());
  await json(await f.call('/TEST-VARIANCE/resolve',{...body,reconciliationRunId:'TEST-WRONG-PERIOD'}),409);
  f.sql.prepare("INSERT INTO rx_reconciliation_runs VALUES('TEST-MATCHED','2026-11-01T00:00:00Z','2026-11-02T00:00:00Z','TEST-CORRECTED',0,'matched',?)").run(new Date().toISOString());
  const good={...body,reconciliationRunId:'TEST-MATCHED'},resolved=await json(await f.call('/TEST-VARIANCE/resolve',good));
  assert.equal(resolved.exception.state,'closed');assert.equal(resolved.resolutionEvidence.sourceReference,'TEST-CORRECTED');assert.equal(resolved.moneyMoved,false);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_finance_entries').get().n,0);
  assert.equal((await json(await f.call())).exceptions.length,0);
  assert.equal((await json(await f.call('/TEST-VARIANCE/resolve',good))).duplicate,true);
 }finally{f.close();}
});
test('Support, clinicians and ungranted operations cannot see or resolve finance exceptions; revoked finance grants stop writes',async()=>{
 const f=await setup();try{
  await json(await f.call('',undefined,3),403);await json(await f.call('/TEST-VARIANCE',undefined,4),403);
  f.sql.prepare("UPDATE hq_users SET role='support' WHERE id=2").run();await json(await f.call('',undefined,2),403);
  f.sql.prepare("UPDATE hq_users SET role='operations' WHERE id=2").run();await json(await f.call('',undefined,2),403);
  f.sql.prepare("INSERT INTO rx_finance_authorities VALUES(2,1000,?,'TEST-DELEGATION',1)").run(new Date(Date.now()+3600000).toISOString());
  assert.equal((await json(await f.call('',undefined,2))).exceptions.length,1);
  f.sql.prepare("DELETE FROM rx_finance_authorities WHERE hq_user_id=2").run();
  await json(await f.call('/TEST-VARIANCE/assign',f.command(),2),403);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_finance_exception_history').get().n,0);
 }finally{f.close();}
});
test('Mid-command session revocation cannot leave a changed owner, audit entry or replay receipt',async()=>{
 const f=await setup();try{
  const original=f.DB.batch.bind(f.DB);
  f.DB.batch=async statements=>{f.sql.prepare('UPDATE hq_sessions SET revoked_at=? WHERE hq_user_id=1').run(new Date().toISOString());return original(statements);};
  await json(await f.call('/TEST-VARIANCE/assign',f.command()),409);
  assert.equal(f.sql.prepare("SELECT owner_user_id n FROM rx_finance_exceptions WHERE id='TEST-VARIANCE'").get().n,1);
  for(const table of ['rx_finance_exception_history','rx_finance_exception_commands'])assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n,0);
 }finally{f.close();}
});
test('Unknown exception kinds cannot be closed with an unsupported manual override',async()=>{
 const f=await setup();try{
  f.sql.prepare("UPDATE rx_finance_exceptions SET kind='unverified_supplier_invoice' WHERE id='TEST-VARIANCE'").run();
  await json(await f.call('/TEST-VARIANCE/resolve',f.command({resolutionKind:'manual_override'})),409);
  assert.equal(f.sql.prepare("SELECT state FROM rx_finance_exceptions WHERE id='TEST-VARIANCE'").get().state,'open');
 }finally{f.close();}
});
test('Recipient revocation during assignment and concurrent command retries cannot create orphaned or duplicate work',async()=>{
 const f=await setup();try{
  const original=f.DB.batch.bind(f.DB);f.DB.batch=async statements=>{f.sql.prepare("UPDATE hq_users SET status='disabled' WHERE id=2").run();return original(statements);};
  await json(await f.call('/TEST-VARIANCE/assign',f.command()),409);
  assert.equal(f.sql.prepare("SELECT owner_user_id n FROM rx_finance_exceptions WHERE id='TEST-VARIANCE'").get().n,1);
  f.DB.batch=original;f.sql.prepare("UPDATE hq_users SET status='active' WHERE id=2").run();
  const body=f.command(),results=await Promise.all([f.call('/TEST-VARIANCE/assign',body),f.call('/TEST-VARIANCE/assign',body)]);
  for(const response of results)await json(response);
  for(const table of ['rx_finance_exception_history','rx_finance_exception_commands'])assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM '+table).get().n,1);
 }finally{f.close();}
});
