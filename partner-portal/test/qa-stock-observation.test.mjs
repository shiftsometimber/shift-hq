import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,ORDER} from './fixture.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import {allowedPath} from '../policy.mjs';
const json=async(r,status=200)=>{const d=await r.json();assert.equal(r.status,status,JSON.stringify(d));return d;};
async function setup(){
 const f=await fixture();
 Object.assign(f.env,{SSTRX_PLATFORM_ENABLED:'true',SSTRX_FUNCTIONAL_V3_ENABLED:'true',SSTRX_ENVIRONMENT:'synthetic',SSTRX_CANONICAL_RECEIPTS_ENABLED:'true',SSTRX_QA_FULFILMENT_ENABLED:'true',SSTRX_QA_STACK:'joined-v31',SSTRX_QA_DATABASE_ID:'3a891880-ea14-4a57-a02e-7f6f3de7f785'});
 await ensurePlatformSchema(f.DB);
 f.sql.exec('ALTER TABLE medicine_variants ADD COLUMN catalogue_version INTEGER NOT NULL DEFAULT 1');
 f.sql.exec('CREATE TABLE sstrx_qa_environment(environment TEXT PRIMARY KEY,database_id TEXT,synthetic_only INTEGER)');
 f.sql.prepare('INSERT INTO sstrx_qa_environment VALUES(?,?,1)').run('joined-v31',f.env.SSTRX_QA_DATABASE_ID);
 const old=new Date(Date.now()-3600000).toISOString();
 f.sql.prepare("INSERT INTO medicine_variants(id,medicine_id,strength_label,selling_price_pence,status,updated_at,sellable,availability_state) VALUES(9911,1,'TEST stock',100,'available',?,1,'available')").run(old);
 f.sql.prepare('INSERT INTO medicine_inventory VALUES(9911,14,2,?)').run(old);
 f.sql.prepare("UPDATE medicine_orders SET variant_id=9911,medicine_name='TEST-Stock-NOT-FOR-SUPPLY' WHERE order_number=?").run(ORDER);
 f.sql.prepare('INSERT INTO rx_supplier_contracts VALUES(?,?,?,?,?,?,?)').run('TEST-stock-contract','clinical-org','synthetic',1,'approved',JSON.stringify({pharmacyOrgId:'pharmacy-org',services:['weight_management']}),old);
 f.sql.prepare('INSERT INTO rx_order_routes VALUES(?,?,?,?,?,?,?,?,?,?,?)').run(ORDER,42,'clinical-org','pharmacy-org','TEST-stock-contract',1,'weight_management','TEST-prescription','{}','TEST-route',old);
 const body={orderReference:ORDER,clientReference:crypto.randomUUID(),stockOnHand:14,expectedStockOnHand:14,expectedReserved:2,expectedUpdatedAt:old,sourceReference:'TEST-EXPLICIT-FICTIONAL-STOCK',acknowledgeSyntheticObservation:true};
 const call=(b=body,id=4)=>f.hq('/platform/integrations/stock',id,b);
 return {...f,old,body,call,inventory:()=>f.sql.prepare('SELECT * FROM medicine_inventory WHERE variant_id=9911').get()};
}
test('Assigned native pharmacy records an explicit fictional stock receipt, preserves reservations and catalogue version, and replays without refreshing stock',async()=>{
 const f=await setup();try{
  const v=f.sql.prepare('SELECT catalogue_version FROM medicine_variants WHERE id=9911').get().catalogue_version;
  const before=await json(await f.hq('/platform/integrations/status?orderReference='+ORDER,4));assert.equal(before.qaStock.fresh,false);
  const first=await json(await f.call());assert.equal(first.stockObservation.recorded,true);assert.equal(first.stockObservation.realStockVerified,false);assert.equal(first.projection.pending,0);
  assert.equal(f.inventory().reserved,2);assert.equal(f.inventory().stock_on_hand,14);assert.equal(f.inventory().updated_at,first.stockObservation.observedAt);
  assert.equal(f.sql.prepare('SELECT catalogue_version FROM medicine_variants WHERE id=9911').get().catalogue_version,v);
  f.sql.prepare('UPDATE medicine_inventory SET updated_at=? WHERE variant_id=9911').run(f.old);
  const replay=await json(await f.call());assert.equal(replay.stockObservation.duplicate,true);assert.equal(f.inventory().updated_at,f.old);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM qa_stub_stock_observations').get().n,1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM partner_audit WHERE action='fictional_stock_observed'").get().n,1);
  assert.throws(()=>f.sql.exec('DELETE FROM qa_stub_stock_observations'),/immutable_fictional_stock/);
 }finally{f.close();}
});
test('Owner, wrong pharmacy and a non-MFA professional cannot renew the native TEST stock timestamp',async()=>{
 const f=await setup();try{
  await json(await f.call(f.body,1),403);await json(await f.call(f.body,5),404);
  f.sql.prepare('UPDATE hq_users SET mfa_enabled=0 WHERE id=4').run();await json(await f.call(),403);
  assert.equal(f.inventory().updated_at,f.old);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='qa_stub_stock_observations'").get().n,0);
 }finally{f.close();}
});
test('Production mode and a wrong database marker fail before any stock schema or value write',async()=>{
 for(const change of ['production','wrong-marker']){
  const f=await setup();try{
   if(change==='production')f.env.SSTRX_ENVIRONMENT='production';else f.sql.prepare("UPDATE sstrx_qa_environment SET database_id='88f40aed-cb23-4372-8c94-8a73f48bc847'").run();
   await json(await f.call(),change==='production'?503:403);
   assert.equal(f.inventory().updated_at,f.old);
   assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE name='qa_stub_stock_observations'").get().n,0);
  }finally{f.close();}
 }
});
test('Stale revisions, stock below reservations and missing explicit fictional acknowledgement are denied',async()=>{
 const f=await setup();try{
  await json(await f.call({...f.body,expectedStockOnHand:13}),409);
  await json(await f.call({...f.body,stockOnHand:1}),409);
  await json(await f.call({...f.body,acknowledgeSyntheticObservation:false}),422);
  assert.equal(f.inventory().updated_at,f.old);assert.equal(f.inventory().stock_on_hand,14);
 }finally{f.close();}
});
test('Mid-command native session revocation cannot change inventory or leave an observation/audit receipt',async()=>{
 const f=await setup();try{
  const batch=f.DB.batch.bind(f.DB);f.DB.batch=async statements=>{f.sql.prepare('UPDATE hq_sessions SET revoked_at=? WHERE hq_user_id=4').run(new Date().toISOString());return batch(statements);};
  await json(await f.call(),409);
  assert.equal(f.inventory().updated_at,f.old);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM qa_stub_stock_observations').get().n,0);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM partner_audit WHERE action='fictional_stock_observed'").get().n,0);
 }finally{f.close();}
});
test('Changed replay content and concurrent duplicate observations cannot overwrite stock or duplicate audit',async()=>{
 const f=await setup();try{
  const both=await Promise.all([f.call(),f.call()]);for(const r of both)await json(r);
  await json(await f.call({...f.body,stockOnHand:15}),409);
  assert.equal(f.inventory().stock_on_hand,14);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM qa_stub_stock_observations').get().n,1);
  assert.equal(f.sql.prepare("SELECT COUNT(*) n FROM partner_audit WHERE action='fictional_stock_observed'").get().n,1);
 }finally{f.close();}
});
test('The gateway admits stock observations only as an assigned dispensing POST',()=>{
 const path='/api/clinical/platform/integrations/stock';assert.equal(allowedPath(path,'POST','dispensing'),true);
 for(const kind of ['clinician','oversight','clinical_admin','pharmacy_admin'])assert.equal(allowedPath(path,'POST',kind),false);
 assert.equal(allowedPath(path,'GET','dispensing'),false);
});
