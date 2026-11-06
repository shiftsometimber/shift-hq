// Test-only in-memory copy of the existing schema and exact programme.
// No production database, supplier, email or payment transport is connected.
import fs from 'node:fs/promises';
import {DatabaseSync} from 'node:sqlite';
import {createHash,randomBytes} from 'node:crypto';
import programme from '../../.partner-qa/native-programme.bundle.mjs';
import member from '../../.partner-qa/member.bundle.mjs';
import {wrapDatabase} from '../test/database.mjs';
import {wrapMemberInboxNavigation} from '../platform/member-entry.mjs';
export async function wholeAppFixture(){
 const sql=new DatabaseSync(':memory:',{enableDoubleQuotedStringLiterals:true});sql.exec(await fs.readFile(new URL('../test/fixtures/whole-app-schema.sql',import.meta.url),'utf8'));
 const {DB}=wrapDatabase(sql),members=[900811108,900811109],tokens=members.map(()=>randomBytes(24).toString('hex')),now=new Date().toISOString();
 for(let i=0;i<members.length;i++){
  sql.prepare('INSERT INTO users(id,email,first_name,last_name,created_at) VALUES(?,?,?,?,?)').run(members[i],'whole-app-'+i+'@example.test','Fictional '+(i?'Ben':'James'),'App QA',now);
  sql.prepare('INSERT INTO user_auth(user_id,password_hash,email_verified,email_verified_at) VALUES(?,?,1,?)').run(members[i],'synthetic-session-fixture-no-password-login',now);
  sql.prepare('INSERT INTO user_sessions(user_id,token_hash,expires_at,created_at) VALUES(?,?,?,?)').run(members[i],createHash('sha256').update(tokens[i]).digest('hex'),new Date(Date.now()+86400000).toISOString(),now);
  sql.prepare('INSERT INTO member_state(user_id) VALUES(?)').run(members[i]);
 }
 const unverified=[],ctx={waitUntil(p){p.catch(()=>{});}},env={DB,MY_SHIFT_REDESIGN_ENABLED:'true',V7_OFFERS:{async prepareOffers(){return {offers:[]};},async recipeById(){return null;}},MEMBER_LEGACY:{async fetch(r){const url=new URL(r.url);unverified.push({path:url.pathname,method:r.method});return Response.json({error:'unverified_legacy_transport_in_isolated_fixture'},{status:503});}}};
 env.MY_SHIFT_MEMBER={fetch:r=>member.fetch(r,env,ctx)};const app=wrapMemberInboxNavigation(programme);
 function tracking(index=0,granted=true){sql.prepare("INSERT INTO consents(user_id,consent_type,consent_version,granted,granted_at) VALUES(?,'my_shift_health_tracking','synthetic-test-notice',?,?)").run(members[index],granted?1:0,now);}
 function setup(index=0){const value=JSON.parse(sql.prepare('SELECT preferences FROM member_state WHERE user_id=?').get(members[index]).preferences||'{}');value.myTimberOnboarding={completedAt:now};value.myJourney={setup:{completedAt:now}};sql.prepare('UPDATE member_state SET preferences=? WHERE user_id=?').run(JSON.stringify(value),members[index]);}
 async function call(path,body,options={}){const method=options.method||(body===undefined?'GET':'POST'),index=options.index??0,headers={Origin:options.origin||'https://shiftsometimber.co.uk',...options.guest?{}:{Cookie:'sst_session='+tokens[index]},...body===undefined?{}:{'Content-Type':'application/json'},...options.headers};return app.fetch(new Request('https://shiftsometimber.co.uk'+path,{method,headers,body:body===undefined?undefined:JSON.stringify(body)}),env,ctx);}
 async function json(path,body,options={}){const r=await call(path,body,options);return {status:r.status,headers:r.headers,body:await r.json()};}
 return {sql,DB,env,app,call,json,tracking,setup,members,tokens,unverified,close:()=>sql.close()};
}
