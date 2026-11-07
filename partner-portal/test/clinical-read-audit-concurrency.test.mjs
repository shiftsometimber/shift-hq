import test from 'node:test';
import assert from 'node:assert/strict';
import {functionalFixture} from './helpers/functional-fixture.mjs';
import {RECORD} from './fixture.mjs';
import {digest} from '../platform/domain.mjs';
import {exactAffectedRows} from '../service/d1-affected-rows.mjs';

const tailSQL='SELECT entry_hash FROM rx_functional_audit ORDER BY rowid DESC LIMIT 1';
const appendSQL='INSERT INTO rx_functional_audit SELECT ';
function preparedHook(f,{first,run}={}){
 const original=f.env.DB,executing=exactAffectedRows(original);
 const wrap=(stmt,sql,args=[])=>new Proxy(stmt,{get(target,key){
  if(key==='bind')return(...values)=>wrap(target.bind(...values),sql,values);
  if(key==='first')return(...values)=>first?first(sql,args,()=>target.first(...values)):target.first(...values);
  if(key==='run')return(...values)=>run?run(sql,args,()=>target.run(...values)):target.run(...values);
  const value=target[key];return typeof value==='function'?value.bind(target):value;
 }});
 // The service routes mutation .run() through exactAffectedRows' native batch,
 // whose SQLite fixture calls runSync(). Intercept the executing facade above
 // that batch so both real execution and injected failures keep its result shape.
 f.env.DB=new Proxy(executing,{get(target,key){
  if(key==='prepare')return sql=>wrap(target.prepare(sql),sql);
  const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;
 }});
 return()=>{f.env.DB=original;};
}
const auditRows=f=>f.sql.prepare('SELECT * FROM rx_functional_audit ORDER BY rowid').all();
async function chainIsIntact(rows){
 let prior='genesis';
 for(const row of rows){
  assert.equal(row.previous_hash,prior);
  assert.equal(row.entry_hash,await digest(prior+'|'+row.detail_json));
  prior=row.entry_hash;
 }
}
const read=async f=>{
 const response=await f.call(''),body=await response.json();
 return {status:response.status,body};
};

test('Concurrent assigned case reads append one intact chained audit each instead of failing a valid read when the global tail advances',{timeout:10000},async()=>{
 const f=await functionalFixture();let restore;
 try{
  const before=auditRows(f),ids=[];
  let observed=0,release;
  const gate=new Promise(resolve=>{release=resolve;});
  restore=preparedHook(f,{
   async first(sql,args,execute){
    const value=await execute();
    if(sql===tailSQL&&++observed<=2){if(observed===2)release();await gate;}
    return value;
   },
   run(sql,args,execute){if(sql.startsWith(appendSQL))ids.push(args[0]);return execute();}
  });
  const responses=await Promise.all([read(f),read(f)]);
  assert.deepEqual(responses.map(r=>r.status),[200,200]);
  for(const r of responses)assert.equal(r.body.record.id,RECORD);
  const rows=auditRows(f);
  assert.equal(rows.length,before.length+2);
  assert.equal(new Set(rows.slice(before.length).map(r=>r.id)).size,2);
  assert.equal(new Set(ids).size,2);
  assert.ok(ids.length>=3,'The controlled shared-tail collision must exercise a retry');
  for(const row of rows.slice(before.length)){
   const detail=JSON.parse(row.detail_json);
   assert.equal(row.action,'clinical_record_viewed');
   assert.equal(detail.record,RECORD);
   assert.equal(detail.purpose,'assigned_clinical_review');
   assert.equal(detail.at,row.created_at);
  }
  await chainIsIntact(rows);
 }finally{restore?.();f.close();}
});

test('A session revocation, role change or record invalidation at the audited read boundary cannot be retried into an audit or case disclosure',async()=>{
 for(const change of ['session','role','sharing','revision']){
  const f=await functionalFixture();let restore;
  try{
   const before=auditRows(f).length;let attempts=0;
   restore=preparedHook(f,{run(sql,args,execute){
    if(sql.startsWith(appendSQL)){
     attempts++;
     if(attempts===1){
      if(change==='session')f.sql.prepare('UPDATE hq_sessions SET revoked_at=? WHERE hq_user_id=3').run(new Date().toISOString());
      if(change==='role')f.sql.prepare("UPDATE hq_users SET role='operations' WHERE id=3").run();
      if(change==='sharing')f.sql.prepare('UPDATE clinical_member_records SET review_sharing=0 WHERE id=?').run(RECORD);
      if(change==='revision')f.sql.prepare('UPDATE clinical_member_records SET revision=revision+1 WHERE id=?').run(RECORD);
     }
    }
    return execute();
   }});
   const result=await read(f);
   assert.equal(result.status,409,change);
   assert.equal(result.body.error,'audit_or_access_changed',change);
   assert.equal(Object.hasOwn(result.body,'record'),false,change);
   assert.equal(Object.hasOwn(result.body,'patient'),false,change);
   assert.equal(Object.hasOwn(result.body,'gates'),false,change);
   assert.equal(attempts,1,change+' must not be retried as tail contention');
   assert.equal(auditRows(f).length,before,change);
  }finally{restore?.();f.close();}
 }
});

test('Continuous global audit contention exhausts its finite retry budget without returning an unaudited case or forking the competing chain',async()=>{
 const f=await functionalFixture();let restore;
 try{
  const before=auditRows(f).length,targetIds=[];let attempts=0;
  const record=f.sql.prepare('SELECT * FROM clinical_member_records WHERE id=?').get(RECORD);
  restore=preparedHook(f,{async run(sql,args,execute){
   if(sql.startsWith(appendSQL)){
    attempts++;targetIds.push(args[0]);
    const previous=f.sql.prepare(tailSQL).get()?.entry_hash||'genesis',date=new Date().toISOString();
    const detail=JSON.stringify({actor:3,org:'clinical-org',record:RECORD,action:'clinical_record_viewed',purpose:'TEST competing read',assessmentVersion:record.revision,at:date});
    const hash=await digest(previous+'|'+detail);
    f.sql.prepare("INSERT INTO rx_functional_audit VALUES(?,?,?,?,?,?,'clinical_record_viewed',?,?)").run('TEST-peer-'+attempts,previous,hash,'3','clinical-org',RECORD,detail,date);
   }
   return execute();
  }});
  const result=await read(f);
  assert.equal(result.status,409);
  assert.equal(result.body.error,'audit_or_access_changed');
  assert.equal(Object.hasOwn(result.body,'record'),false);
  assert.equal(attempts,8);
  assert.equal(new Set(targetIds).size,1,'Retries retain this read identity');
  const rows=auditRows(f);
  assert.equal(rows.length,before+8,'Only the controlled competing reads may have been appended');
  assert.equal(rows.some(r=>r.id===targetIds[0]),false);
  await chainIsIntact(rows);
 }finally{restore?.();f.close();}
});

test('An unchanged audit tail cannot trigger retries and a thrown audit-storage error is never replayed',async()=>{
 for(const failure of ['unchanged-tail','storage-error']){
  const f=await functionalFixture();let restore;
  try{
   const before=auditRows(f).length;let attempts=0;
   restore=preparedHook(f,{run(sql,args,execute){
    if(sql.startsWith(appendSQL)){
     attempts++;
     if(failure==='storage-error')throw Error('TEST audit storage unavailable');
     return {meta:{changes:0}};
    }
    return execute();
   }});
   const result=await read(f);
   if(failure==='unchanged-tail'){
    assert.equal(result.status,409);
    assert.equal(result.body.error,'audit_or_access_changed');
   }else assert.ok(result.status>=500&&result.status<=599,'Storage failure must fail closed');
   assert.equal(Object.hasOwn(result.body,'record'),false);
   assert.equal(Object.hasOwn(result.body,'patient'),false);
   assert.equal(attempts,1);
   assert.equal(auditRows(f).length,before);
  }finally{restore?.();f.close();}
 }
});
