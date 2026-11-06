import {createHash} from 'node:crypto';
import {brotliCompressSync,brotliDecompressSync,constants} from 'node:zlib';
import vm from 'node:vm';

export function createCacheRecovery(cache,getStorage=()=>globalThis.localStorage,online=()=>navigator.onLine,onlineMs=750,offlineMs=2500){
 const key='my-timber-private-cache-recovery-v1';let blocked=false;
 const mark=()=>{blocked=true;try{getStorage().setItem(key,'1');}catch{}};
 const clear=()=>{try{getStorage().setItem(key,'0');blocked=false;}catch{blocked=true;}};
 const guarded=()=>{try{return blocked||getStorage().getItem(key)!=='0';}catch{return true;}};
 async function run(fn,fallback){let clock;try{return await Promise.race([Promise.resolve().then(fn),new Promise(resolve=>{clock=setTimeout(()=>{mark();resolve(fallback);},online()?onlineMs:offlineMs);})]);}catch{mark();return fallback;}finally{clearTimeout(clock);}}
 const api={async restore(){if(guarded())return null;return run(()=>cache.restore(),null);},async purge(){mark();const ok=await run(()=>cache.purge(),false);if(ok===true)clear();return ok;},async save(...args){if(guarded()&&await api.purge()!==true)return false;return run(()=>cache.save(...args),false);}};
 return api;
}
const hash=s=>createHash('sha256').update(s).digest('hex');
export const NATIVE_CACHE_INPUT_SHA='a77a897d939f76b74cbb5c9e20ad5b2dc833c070aa081c033786cf420cef5b8e';
function spliceCacheOperations(client){
 const marker='n=makePrivateCache(),a=JSON.parse(t.textContent)';
 if(client.split(marker).length!==2)throw Error('Native cache factory boundary changed');
 const a=client.indexOf('async function r(){try{let u=await i();await new Promise('),b=client.indexOf('async function c(',a);
 if(a<0||b<a)throw Error('Native purge boundary changed');
 const purge=client.slice(a,b),suffix='})}catch{}}';
 if(!purge.endsWith(suffix))throw Error('Native purge completion must be reconciled');
 const qualified=purge.slice(0,-suffix.length)+'});return true}catch{return false}}';
 return client.replace(purge,qualified).replace(marker,'n=('+createCacheRecovery.toString()+')(makePrivateCache()),a=JSON.parse(t.textContent)');
}
export function repairNativeCacheClient(client){if(hash(client)!==NATIVE_CACHE_INPUT_SHA)throw Error('Native cache source must be reconciled');return spliceCacheOperations(client);}
export function buildNativeCacheClient(client){
 const repaired=repairNativeCacheClient(client),version=hash(repaired+'private-cache-recovery-v1').slice(0,20),source=repaired.replaceAll('26868396173096934c6e',version);
 return {source,version,inputNativeSha:hash(client),outputNativeSha:hash(source)};
}
export function patchProgrammeCacheRecovery(source){
 const oldVersion='26868396173096934c6e',uses=source.split(oldVersion).length-1;
 if(uses!==24)throw Error('Native cache release references changed');
 const compressed=[...source.matchAll(/\bbr="([A-Za-z0-9+/=]+)"/g)];
 if(compressed.length!==1)throw Error('Native Brotli boundary changed');
 const client=brotliDecompressSync(Buffer.from(compressed[0][1],'base64')).toString();
 const built=buildNativeCacheClient(client),repaired=repairNativeCacheClient(client),version=built.version,nextClient=built.source;
 const plainOf=code=>{
  const end=/export\{[A-Za-z0-9_$]+ as default\};?\s*$/.exec(code);
  if(!end)throw Error('Standalone programme export changed');
  const context={URL,URLSearchParams,TextEncoder,TextDecoder,Request,Response,Headers,crypto:globalThis.crypto,atob,btoa};
  return vm.runInNewContext(code.slice(0,end.index)+';dn',context,{timeout:1000});
 };
 if(plainOf(source)!==client)throw Error('Plain/Brotli native clients differ');
 let next=spliceCacheOperations(source).replaceAll(oldVersion,version);
 if(plainOf(next)!==nextClient)throw Error('Qualified native build differs from the tested client');
 const encoded=brotliCompressSync(Buffer.from(nextClient),{params:{[constants.BROTLI_PARAM_QUALITY]:11}}).toString('base64');
 const oldBr=compressed[0][0];if(!next.includes(oldBr))throw Error('Retained compressed source changed');
 next=next.replace(oldBr,'br="'+encoded+'"');
 new vm.Script(nextClient);
 return {source:next,version,previousVersion:oldVersion,versionReferences:uses,inputNativeSha:hash(client),outputNativeSha:hash(nextClient),sourceSha:hash(next)};
}
