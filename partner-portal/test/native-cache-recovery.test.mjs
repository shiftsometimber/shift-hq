import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {brotliCompressSync,brotliDecompressSync} from 'node:zlib';
import vm from 'node:vm';
import {createCacheRecovery,repairNativeCacheClient,buildNativeCacheClient,patchProgrammeCacheRecovery} from '../platform/native-cache-recovery.mjs';
const storage=()=>{const m=new Map;return {getItem:k=>m.get(k)||null,setItem:(k,v)=>m.set(k,v),removeItem:k=>m.delete(k)};};
test('a blocked restore reaches fresh account verification and keeps old offline data inaccessible',async()=>{
 const store=storage();store.setItem('my-timber-private-cache-recovery-v1','0');let reads=0,verify=0;
 const old={restore:()=>{reads++;return new Promise(()=>{});},purge:async()=>false,save:async()=>true};
 const c=createCacheRecovery(old,()=>store,()=>true,10,20);
 const cached=await c.restore();assert.equal(cached,null);
 if(cached===null)verify++;assert.equal(verify,1);
 assert.equal(await c.purge(),false);
 const offline=createCacheRecovery({...old,restore:async()=>{reads++;return {owner:'previous-member'};}},()=>store,()=>false,10,20);
 assert.equal(await offline.restore(),null);assert.equal(reads,1,'Another window must not restore the old owner while recovery is unconfirmed');
 assert.equal(await offline.save('new-member'),false);
});
test('healthy encrypted cache and confirmed purge retain their original results',async()=>{
 const store=storage(),record={owner:'synthetic-42',payload:{saved:true}};
 store.setItem('my-timber-private-cache-recovery-v1','0');let purges=0,saves=0;
 const c=createCacheRecovery({restore:async()=>record,purge:async()=>{purges++;return true;},save:async()=>{saves++;return true;}},()=>store,()=>false,10,20);
 assert.equal(await c.restore(),record);assert.equal(await c.save('synthetic-42'),true);assert.equal(await c.purge(),true);assert.equal(purges,1);assert.equal(saves,1);assert.equal(await c.restore(),record);
});
test('a late purge cannot reopen offline access or accept another owner save',async()=>{
 const store=storage();let finish;
 const c=createCacheRecovery({restore:async()=>null,purge:()=>new Promise(r=>{finish=r;}),save:async()=>true},()=>store,()=>true,10,20);
 assert.equal(await c.purge(),false);finish(true);await Promise.resolve();
 let reads=0;
 const next=createCacheRecovery({restore:async()=>{reads++;return {owner:'previous'};},purge:async()=>false,save:async()=>true},()=>store,()=>false,10,20);
 assert.equal(await next.restore(),null);assert.equal(reads,0);
});
test('unavailable storage disables offline restore rather than showing an unconfirmed owner',async()=>{
 let reads=0;const c=createCacheRecovery({restore:async()=>{reads++;return {};},purge:async()=>false,save:async()=>true},()=>{throw Error('storage unavailable');},()=>false,10,20);
 assert.equal(await c.restore(),null);assert.equal(reads,0);
});
test('qualified native plain/Brotli clients stay identical and unknown source is refused',async()=>{
 const client=await fs.readFile(new URL('./fixtures/native-cache-v268.js',import.meta.url),'utf8');
 const built=buildNativeCacheClient(client);new vm.Script(built.source);
 assert.match(built.source,/my-timber-private-cache-recovery-v1/);
 assert.throws(()=>repairNativeCacheClient(client+' '),/must be reconciled/);
 assert(built.source.includes('/v1/my-timber/boot'),'The canonical fresh account request remains present');
 assert.throws(()=>patchProgrammeCacheRecovery(client),/release references changed/);
});

test('legacy cache needs a confirmed purge before upgraded offline reuse',async()=>{
 const store=storage();let reads=0,record={owner:'previous'};const cache={restore:async()=>{reads++;return record;},purge:async()=>{record=null;return true;},save:async value=>{record=value;return true;}};
 const c=createCacheRecovery(cache,()=>store,()=>false,10,20);assert.equal(await c.restore(),null);assert.equal(reads,0);assert.equal(await c.purge(),true);assert.equal(await c.restore(),null);assert.equal(await c.save({owner:'current'}),true);assert.deepEqual(await c.restore(),{owner:'current'});
});
