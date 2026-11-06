import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {currentBasketRead} from './whole-app-commerce.mjs';
import {wholeAppFixture} from './whole-app-fixture.mjs';
const root=process.env.WHOLE_APP_CORE_ROOT;
if(!root)throw Error('WHOLE_APP_CORE_ROOT is required');
const basket=await currentBasketRead(root),f=await wholeAppFixture(),checks=[];
const oldFetch=globalThis.fetch;let externalRequests=0;
globalThis.fetch=async()=>{externalRequests++;throw Error('External network disabled in whole-app commerce acceptance');};
const request=(index=0,suffix='',method='GET',origin='https://shiftsometimber.co.uk',host='https://api.shiftsometimber.co.uk')=>new Request(host+'/v1/commerce/active-checkout'+suffix,{method,headers:{Origin:origin,...index===null?{}:{Cookie:'sst_session='+f.tokens[index]}}});
async function result(req,status=200){const r=await basket.fetch(req,f.env);assert.equal(r.status,status);return r.json();}
try{
 const empty=await result(request());assert.equal(empty.ok,true);assert.deepEqual(empty.attempts,[]);assert.match(empty.accountReference,/^[a-f0-9]{64}$/);checks.push('Native empty basket and account reference');
 const date=new Date().toISOString();
 for(const [i,state]of [[0,'unknown'],[1,'rejected']])f.sql.prepare('INSERT INTO checkout_attempts(id,user_id,channel,fingerprint,state,order_number,created_at,updated_at)VALUES(?,?,?,?,?,?,?,?)').run('TEST-BASKET-'+i,f.members[i],'medicine','fictional-fingerprint-'+i,state,'TEST-BASKET-ORDER-'+i,date,date);
 const a=await result(request(0)),b=await result(request(1));assert.equal(a.attempts.length,1);assert.equal(b.attempts.length,1);assert.equal(a.attempts[0].state,'unknown');assert.equal(b.attempts[0].state,'rejected');assert.notEqual(a.accountReference,b.accountReference);assert.equal(a.attempts[0].canResume,false);checks.push('Two native members retain isolated attempts and uncertain status');
 await result(request(null),401);checks.push('Missing native member session denied');
 for(const req of [request(0,'','POST'),request(0,'?resume=1'),request(0,'','GET','https://attacker.example'),request(0,'','GET','https://shiftsometimber.co.uk','https://other.example'),request(0,'','GET','https://shiftsometimber.co.uk','http://api.shiftsometimber.co.uk')])await result(req,403);checks.push('Writes, processor resume, foreign Origin and aliases denied');
 f.sql.prepare('UPDATE user_sessions SET revoked_at=? WHERE user_id=?').run(date,f.members[0]);await result(request(0),401);checks.push('Revoked native session denied');
 assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM checkout_attempts').get().n,2);assert.equal(externalRequests,0);checks.push('No new attempt or external processor/network request');
 const files=['whole-app-commerce.mjs','whole-app-browser.mjs','check-whole-app-commerce.mjs'],receipt={at:new Date().toISOString(),sourceCommit:execFileSync('git',['rev-parse','HEAD'],{encoding:'utf8'}).trim(),sourceFiles:Object.fromEntries(await Promise.all(files.map(async n=>[n,createHash('sha256').update(await fs.readFile(new URL(n,import.meta.url))).digest('hex')]))),core:basket.source,result:'PASS_LOCAL_NATIVE_COMMERCE_READ',checks,externalRequests,hostedAcceptance:false,realTransactions:0};
 const dir=process.env.WHOLE_APP_COMMERCE_EVIDENCE||'.partner-qa/whole-app-commerce';await fs.mkdir(dir,{recursive:true});await fs.writeFile(path.join(dir,'receipt.json'),JSON.stringify(receipt,null,2)+'\n');console.log(JSON.stringify(receipt));
}finally{globalThis.fetch=oldFetch;f.close();}
