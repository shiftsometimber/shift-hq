import test from 'node:test';
import assert from 'node:assert/strict';
import {wholeAppFixture} from '../qa/whole-app-fixture.mjs';
const withFixture=fn=>async()=>{const f=await wholeAppFixture();try{await fn(f);}finally{f.close();}};
test('whole app boot is private, account-bound and honest for a fresh member',withFixture(async f=>{
 const guest=await f.json('/v1/my-timber/boot',undefined,{guest:true});assert.equal(guest.status,401);
 const owned=await f.json('/v1/my-timber/boot');assert.equal(owned.status,200);assert.equal(owned.body.accountId,f.members[0]);assert.equal(owned.body.tracking,false);assert.equal(owned.body.v7.count,0);assert.equal(owned.body.setupComplete,false);assert.match(owned.headers.get('Cache-Control'),/no-store/);assert.equal(f.unverified.length,0);
}));
test('app preferences persist once across boot and duplicate operation delivery',withFixture(async f=>{
 const operationId=crypto.randomUUID(),body={action:'v7-preferences',showWeight:false,revision:0,operationId,expectedAccount:f.members[0]};
 const first=await f.json('/v1/life-back',body);assert.equal(first.status,201);assert.equal(first.body.v7.preferences.showWeight,false);
 const second=await f.json('/v1/life-back',body);assert.equal(second.status,200);assert.equal(second.body.progress.revision,first.body.progress.revision);
 const boot=await f.json('/v1/my-timber/boot');assert.equal(boot.body.v7.preferences.showWeight,false);assert.equal(boot.body.v7.count,0);
}));
test('daily completion requires consent and only awards one saved log',withFixture(async f=>{
 let boot=(await f.json('/v1/my-timber/boot')).body;
 const body={action:'v7-complete',actionId:boot.v7.action.id,revision:0,operationId:crypto.randomUUID(),expectedAccount:f.members[0]};
 const denied=await f.json('/v1/life-back',body);assert.equal(denied.status,409);assert.equal(denied.body.code,'health_consent_required');
 f.tracking();f.setup();boot=(await f.json('/v1/my-timber/boot')).body;body.actionId=boot.v7.action.id;
 const saved=await f.json('/v1/life-back',body);assert.equal(saved.status,201);assert.equal(saved.body.v7.count,1);
 const replay=await f.json('/v1/life-back',body);assert.equal(replay.status,200);assert.equal(replay.body.v7.count,1);
}));
test('foreign origins, changed accounts and revoked sessions cannot save or disclose app state',withFixture(async f=>{
 const body={action:'v7-preferences',showWeight:false,revision:0,operationId:crypto.randomUUID(),expectedAccount:f.members[0]};
 assert.equal((await f.json('/v1/life-back',body,{origin:'https://untrusted.example'})).status,403);
 assert.equal((await f.json('/v1/life-back',body,{index:1})).status,409);
 assert.equal((await f.json('/v1/my-timber/boot',undefined,{index:1,headers:{'X-My-Timber-Expected-Account':String(f.members[0])}})).status,409);
 f.sql.prepare('UPDATE user_sessions SET revoked_at=? WHERE user_id=?').run(new Date().toISOString(),f.members[0]);
 assert.equal((await f.json('/v1/my-timber/boot')).status,401);assert.equal((await f.json('/v1/my-timber/boot',undefined,{index:1})).status,200);
}));
test('all eight shipped games serve runnable assets and keep owned results isolated',withFixture(async f=>{
 const games=[['timber-lob',[1,2,3]],['chop-shop',12],['timber',100],['stack-the-shed',8],['saw-duel',14.5],['timber-smash',25],['over-the-shed',6],['shed-fighter',4]];
 for(const [game,value]of games){const asset=await f.call('/assets/member-experience/v7-arcade-'+game+'.mjs');assert.equal(asset.status,200,game);assert.match(asset.headers.get('Content-Type'),/javascript/);const saved=await f.json('/v1/my-timber/arcade',{action:'best',game,value,expectedAccount:f.members[0]});assert.equal(saved.status,200,game);}
 const other=await f.json('/v1/my-timber/arcade',undefined,{index:1});assert.deepEqual(other.body.arcade.bests,{});
 const progress=await f.json('/v1/my-timber/arcade',{action:'progress',game:'timber-lob',value:100,expectedAccount:f.members[0]});assert.equal(progress.status,200);assert.equal(progress.body.arcade.bests.mt_timberlob_level,100);
 assert.equal((await f.json('/v1/my-timber/arcade',{action:'best',game:'chop-shop',value:-1,expectedAccount:f.members[0]})).status,400);
}));
test('private crews require explicit sharing and do not expose weight or unrelated members',withFixture(async f=>{
 const denied=await f.json('/v1/my-timber/crew',{action:'create',alias:'Fictional James',consented:true,expectedAccount:f.members[0]});assert.equal(denied.status,409);
 f.tracking();f.tracking(1);f.setup();f.setup(1);
 const created=await f.json('/v1/my-timber/crew',{action:'create',alias:'Fictional James',consented:true,expectedAccount:f.members[0]});assert.equal(created.status,200);assert.equal(created.body.league.joined,true);
 const emptyOther=(await f.json('/v1/my-timber/boot',undefined,{index:1})).body;assert.equal(emptyOther.league.joined,false);assert.deepEqual(emptyOther.league.members,[]);
 const invitation=await f.json('/v1/my-timber/crew',{action:'invite',expectedAccount:f.members[0]});assert.equal(invitation.status,200);const code=new URL(invitation.body.inviteUrl).searchParams.get('crew');
 const joined=await f.json('/v1/my-timber/crew',{action:'join',alias:'Fictional Ben',code,consented:true,expectedAccount:f.members[1]},{index:1});assert.equal(joined.status,200);assert.equal(joined.body.league.members.length,2);assert(!JSON.stringify(joined.body.league).includes('weight'));
 assert.equal((await f.json('/v1/my-timber/crew',{action:'leave',expectedAccount:f.members[1]},{index:1})).status,200);assert.equal((await f.json('/v1/my-timber/boot',undefined,{index:1})).body.league.joined,false);
}));
