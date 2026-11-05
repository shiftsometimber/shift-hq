// Isolated local fixture: no real accounts, emails, prescriptions or suppliers.
import http from 'node:http';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {chromium,webkit} from 'playwright';
import {fixture,RECORD} from '../test/fixture.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import {wrapMemberInboxNavigation} from '../platform/member-entry.mjs';
import member from '../../.partner-qa/member.bundle.mjs';
const report={environment:'localhost; synthetic accounts; compiled member bundle',results:[]};
for(const [engine,type]of [['chromium',chromium],['webkit',webkit]]){
 const f=await fixture();Object.assign(f.env,{SSTRX_PLATFORM_ENABLED:'true',SSTRX_SECURE_MESSAGES_ENABLED:'true',CLINICAL_REVIEW_READY:'false'});await ensurePlatformSchema(f.env.DB);f.sql.prepare('INSERT INTO clinical_case_assignments VALUES(?,3,1,?)').run(RECORD,new Date(Date.now()+86400000).toISOString());
 const nav=wrapMemberInboxNavigation({fetch:async()=>new Response('<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1"></head><body data-mt-native-shell><header class="mt-shop-brand">My Timber</header></body></html>',{headers:{'Content-Type':'text/html'}})});
 const server=http.createServer(async(req,res)=>{try{
  const chunks=[];for await(const c of req)chunks.push(c);
  const request=new Request('https://shiftsometimber.co.uk'+req.url,{method:req.method,headers:{Cookie:'sst_session='+f.memberToken,Origin:'https://shiftsometimber.co.uk','Content-Type':'application/json'},body:req.method==='POST'?Buffer.concat(chunks):undefined});
  const r=req.url.startsWith('/member/dashboard')?await nav.fetch(request,f.env,{}):await member.fetch(request,f.env,{});
  res.writeHead(r.status,Object.fromEntries(r.headers));res.end(Buffer.from(await r.arrayBuffer()));
 }catch(e){res.writeHead(500);res.end(e.message);}});
 await new Promise(r=>server.listen(0,'127.0.0.1',r));const origin='http://127.0.0.1:'+server.address().port;
 let browser;
 try{
  browser=await type.launch();const page=await browser.newPage({viewport:{width:390,height:844}});
  await page.goto(origin+'/member/dashboard');await page.getByRole('link',{name:'Messages',exact:true}).waitFor();await page.getByRole('link',{name:'Messages',exact:true}).click();
  await page.goBack();await page.getByRole('link',{name:'Messages',exact:true}).waitFor();await page.getByRole('link',{name:'Messages',exact:true}).click();
  await page.getByRole('button',{name:'Start a secure conversation'}).click();
  await page.getByLabel('Record for secure conversation').selectOption(RECORD);await page.getByLabel('Care team',{exact:true}).selectOption('clinical');await page.getByLabel('Secure message',{exact:true}).fill('FICTIONAL app member question');await page.getByRole('button',{name:'Send secure message',exact:true}).click();await page.getByText('FICTIONAL app member question',{exact:true}).waitFor();
  const t=f.sql.prepare('SELECT * FROM rx_message_threads').get();assert.equal(t.member_id,42);
  const reply=await f.hq('/platform/messages/'+t.id,3,{clientReference:crypto.randomUUID(),version:1,message:'FICTIONAL Rx response'});assert.equal(reply.status,201);
  await page.goto(origin+'/member/dashboard');await page.getByRole('link',{name:'Messages · 1 unread',exact:true}).waitFor();await page.getByRole('link',{name:'Messages · 1 unread',exact:true}).click();await page.getByRole('button',{name:/Unread ·/}).click();await page.getByText('FICTIONAL Rx response',{exact:true}).waitFor();
  await page.getByLabel('Secure message',{exact:true}).fill('FICTIONAL member reply from app');await page.getByRole('button',{name:'Send secure message',exact:true}).click();await page.getByText('FICTIONAL member reply from app',{exact:true}).waitFor();
  assert.equal((await(await f.hq('/platform/messages/'+t.id,3)).json()).messages.length,3);
  for(const width of [320,390,768,1440]){await page.setViewportSize({width,height:900});assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),engine+' overflow '+width);}
  await page.reload();await page.getByRole('button',{name:/clinical|Fictional clinical/}).first().click();await page.getByText('FICTIONAL member reply from app',{exact:true}).waitFor();
  f.sql.prepare('UPDATE user_sessions SET revoked_at=?').run(new Date().toISOString());await page.reload();await page.getByText('Your messages are private',{exact:true}).waitFor();assert(!(await page.locator('body').innerText()).includes('FICTIONAL Rx response'));
  report.results.push({engine,pass:true,memberToRx:true,RxToMember:true,persistedReply:true,unreadBadge:true,widths:[320,390,768,1440],revokedSessionCleared:true,clinicalReadinessRemainsClosed:f.env.CLINICAL_REVIEW_READY==='false'});
 }finally{await browser?.close();await new Promise(r=>server.close(r));f.close();}
}
await fs.mkdir('.partner-qa/browser',{recursive:true});await fs.writeFile('.partner-qa/browser/member-inbox.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report));
