import test from 'node:test';
import assert from 'node:assert/strict';
import gateway from '../../.partner-qa/sstrx.bundle.mjs';
import compiledClinical from '../../.partner-qa/clinical.bundle.mjs';
import compiledMember from '../../.partner-qa/member.bundle.mjs';
import legacy from '../worker.mjs';
import {fixture,RECORD} from './fixture.mjs';
import fs from 'node:fs/promises';
test('the exact HQ asset route serves only the retained browser module and cannot expose an HQ page or API',async()=>{
 const source=await fs.readFile(new URL('../../hq-partner-desk.js',import.meta.url),'utf8'),r=await gateway.fetch(new Request('https://hq.shiftsometimber.co.uk/hq-partner-desk.js'),{});assert.equal(r.status,200);assert.equal(await r.text(),source);assert.match(r.headers.get('Content-Type'),/javascript/);for(const path of ['/index.html','/api/clinical/platform','/hq-partner-desk.js/anything'])assert.equal((await gateway.fetch(new Request('https://hq.shiftsometimber.co.uk'+path),{})).status,404);
});
test('compiled dual-origin gateway preserves existing partner pages and assets byte for byte',async()=>{
 const f=await fixture();try{for(const path of ['/','/robots.txt','/demo','/assets/partner-v1.css','/assets/partner-v1.js']){const request=new Request('https://partner.shiftsometimber.co.uk'+path),before=await legacy.fetch(request,f.portalEnv),after=await gateway.fetch(request,f.portalEnv);assert.equal(after.status,before.status,path);assert.equal(await after.text(),await before.text(),path);assert.equal(after.headers.get('Content-Security-Policy'),before.headers.get('Content-Security-Policy'));}}finally{f.close()}
});
test('compiled entry rejects HQ/brand apex and keeps new-origin private APIs closed until explicitly released',async()=>{
 const f=await fixture();try{for(const host of ['hq.shiftsometimber.co.uk','sstrx.co.uk','evil.example'])assert.equal((await gateway.fetch(new Request('https://'+host+'/'),f.portalEnv)).status,404);const r=await gateway.fetch(new Request('https://sstrx.shiftsometimber.co.uk/api/identity'),f.portalEnv);assert.equal(r.status,503);const page=await gateway.fetch(new Request('https://sstrx.shiftsometimber.co.uk/'),f.portalEnv);assert.match(await page.text(),/Professional access is awaiting release approval/);assert.match(page.headers.get('X-Robots-Tag'),/noindex/);}finally{f.close()}
});
test('compiled clinical/member services preserve native auth, approved assignments and member isolation',async()=>{
 const f=await fixture();try{f.env.SSTRX_PLATFORM_ENABLED='true';const ctx={waitUntil(){}};
 const request=new Request('https://api.shiftsometimber.co.uk/v1/hq/clinical/partner-desk/assign',{method:'POST',headers:{Origin:'https://hq.shiftsometimber.co.uk',Cookie:'sst_hq_session='+f.tokens[1],'Content-Type':'application/json'},body:JSON.stringify({recordId:RECORD,staffUserId:3,active:true})});assert.equal((await compiledClinical.fetch(request,f.env,ctx)).status,200);
 const good=await compiledMember.fetch(new Request('https://api.shiftsometimber.co.uk/v1/member/clinical-records/'+RECORD,{headers:{Origin:'https://shiftsometimber.co.uk',Cookie:'sst_session='+f.memberToken}}),f.env,ctx);assert.equal(good.status,200);assert.equal((await good.json()).record.id,RECORD);
 assert.equal((await compiledMember.fetch(new Request('https://api.shiftsometimber.co.uk/v1/member/clinical-records/'+RECORD),f.env,ctx)).status,401);
 }finally{f.close()}
});
