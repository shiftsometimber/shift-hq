import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,ORDER,RECORD} from './fixture.mjs';
import {createSstrxPortal} from '../sstrx-worker.mjs';
import {ensureFinanceOperations} from '../platform/finance-operations.mjs';
import {seal,SESSION_COOKIE} from '../session.mjs';
import {allowedPath} from '../policy.mjs';
const origin='https://sstrx.shiftsometimber.co.uk';
const key='ab'.repeat(32);
const exception='refund:10000000-0000-4000-8000-000000000099';
const lifecycle='10000000-0000-4000-8000-000000000098';
const json=async(r,status=200)=>{const body=await r.json();assert.equal(r.status,status,JSON.stringify(body));return body;};
async function setup(){
 const f=await fixture();
 Object.assign(f.env,{SSTRX_PLATFORM_ENABLED:'true',SSTRX_FUNCTIONAL_V3_ENABLED:'true',SSTRX_ENVIRONMENT:'synthetic'});
 Object.assign(f.portalEnv,{SSTRX_PORTAL_ENABLED:'true',SSTRX_FUNCTIONAL_V3_ENABLED:'true'});
 await ensureFinanceOperations(f.DB);
 const due=new Date(Date.now()+3600000).toISOString();
 f.sql.prepare("INSERT INTO rx_finance_exceptions(id,order_number,kind,state,owner_user_id,due_at,detail_json,created_at) VALUES(?,?,'refund_watch','watching',1,?,'{}',?)").run(exception,ORDER,due,new Date().toISOString());
 const portal=createSstrxPortal(origin);
 const cookies={};
 for(const id of [1,2,3])cookies[id]=SESSION_COOKIE+'='+await seal({token:f.tokens[id]},key,'session',3600,Date.now(),origin);
 const call=(path='',body,id=1)=>portal.fetch(new Request(origin+'/api/clinical/platform/finance-exceptions'+path,{method:body===undefined?'GET':'POST',headers:{Origin:origin,Cookie:cookies[id],'Content-Type':'application/json'},body:body===undefined?undefined:JSON.stringify(body)}),f.portalEnv);
 const command=extra=>({version:1,clientReference:crypto.randomUUID(),sourceReference:'FICTIONAL-FINANCE-GATEWAY',reason:'TEST cover through the actual native gateway',ownerUserId:2,...extra});
 return {...f,call,command,cookies,portal,due};
}
test('Actual native Finance gateway loads exceptions, saves cover once, and reads its persisted history',async()=>{
 const f=await setup();
 try{
  const list=await json(await f.call());
  assert.equal(list.exceptions.length,1);
  const body=f.command({});
  const saved=await json(await f.call('/'+exception+'/cover',body));
  assert.equal(saved.exception.ownerUserId,1);
  assert.equal(saved.exception.coverOwnerUserId,2);
  assert.equal(saved.exception.originalDueAt,f.due);
  const replay=await json(await f.call('/'+exception+'/cover',body));
  assert.equal(replay.duplicate,true);
  const fresh=await json(await f.call('/'+exception));
  assert.equal(fresh.history.length,1);
  assert.equal(fresh.exception.coverOwnerUserId,2);
  assert.equal(fresh.moneyMoved,false);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_finance_entries').get().n,0);
 }finally{f.close();}
});
test('Finance gateway retains backend denial for support, clinical and revoked sessions',async()=>{
 const f=await setup();
 try{
  f.sql.prepare("UPDATE hq_users SET role='support' WHERE id=2").run();
  await json(await f.call('',undefined,2),403);
  await json(await f.call('/'+exception+'/assign',f.command({}),2),403);
  await json(await f.call('',undefined,3),403);
  f.sql.prepare('UPDATE hq_sessions SET revoked_at=? WHERE hq_user_id=1').run(new Date().toISOString());
  await json(await f.call('/'+exception+'/cover',f.command({})),401);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_finance_exception_history').get().n,0);
  assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM rx_finance_exception_commands').get().n,0);
 }finally{f.close();}
});
test('Only the existing oversight Finance actions are admitted by the portal boundary',()=>{
 const read='/api/clinical/platform/finance-exceptions';
 for(const path of [read,read+'/'+exception])assert.equal(allowedPath(path,'GET','oversight'),true,path);
 for(const action of ['assign','cover','resolve'])assert.equal(allowedPath(read+'/'+exception+'/'+action,'POST','oversight'),true,action);
 for(const action of ['price-plan','price-refund','financial-resolution'])assert.equal(allowedPath('/api/clinical/platform/lifecycle/'+RECORD+'/'+lifecycle+'/'+action,'POST','oversight'),true,action);
 for(const kind of ['clinician','dispensing','support','clinical_admin','pharmacy_admin']){
  assert.equal(allowedPath(read,'GET',kind),false,kind);
  assert.equal(allowedPath(read+'/'+exception+'/resolve','POST',kind),false,kind);
 }
 for(const action of ['delete','submit','approve','anything'])assert.equal(allowedPath(read+'/'+exception+'/'+action,'POST','oversight'),false,action);
 assert.equal(allowedPath(read,'DELETE','oversight'),false);
 assert.equal(allowedPath('/api/clinical/platform/cases/'+RECORD+'/verification','POST','oversight'),false);
});
