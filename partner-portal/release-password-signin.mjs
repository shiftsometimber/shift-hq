// Scoped, reversible password-sign-in release. Uses only the existing authorised device session.
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
import {PASSWORD_SIGNIN_LAST_DAY} from './password-signin.mjs';
const [action,directory,authorisation]=process.argv.slice(2);
if(!['snapshot','upload','promote','verify','rollback'].includes(action)||!directory)throw Error('Specify action and private receipt directory.');
if(['promote','rollback'].includes(action)&&authorisation!=='--authorised-portal-release')throw Error('Portal release authorisation is required.');
const root=resolve(directory),repo=resolve(new URL('..',import.meta.url).pathname);
const targets=[['shift-hq-clinical-portal','clinical'],['shift-partner-portal','sstrx']];
const flags={SSTRX_PASSWORD_SIGNIN_ENABLED:'true',SSTRX_PASSWORD_SIGNIN_UNTIL:PASSWORD_SIGNIN_LAST_DAY};
const config=await fs.readFile(join(homedir(),'Library/Preferences/.wrangler/config/default.toml'),'utf8'),token=config.match(/^oauth_token\s*=\s*"([^"\n]+)"/m)?.[1];
if(!token)throw Error('Refresh the existing authorised session.');
const base='https://api.cloudflare.com/client/v4/accounts/9e5386dcf455be34c582d93f8bfc79e6/workers/scripts/';
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=async name=>JSON.parse(await fs.readFile(join(root,name+'.json'),'utf8'));
const write=async(name,value)=>fs.writeFile(join(root,name+'.json'),JSON.stringify(value,null,2),{mode:0o600});
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
async function api(path,method='GET',body){
 const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,...body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
 const d=await r.json();if(!r.ok||d.success!==true)throw Error('Cloudflare '+method+' '+path+' failed: '+r.status+' '+JSON.stringify(d.errors));return d.result;
}
async function source(w){
 const r=await fetch(base+w+'/content/v2',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('Serving source unavailable: '+w);
 if(!r.headers.get('Content-Type')?.includes('multipart'))return Buffer.from(await r.arrayBuffer());
 const files=[...(await r.formData()).entries()].filter(([,v])=>typeof v!=='string');
 if(files.length!==1||files[0][0]!=='worker.mjs')throw Error('Unexpected module layout: '+w);return Buffer.from(await files[0][1].arrayBuffer());
}
async function current(w){return (await api(w+'/deployments')).deployments[0];}
async function assertServing(expected){for(const [w,d]of Object.entries(expected))if((await current(w)).id!==d.id)throw Error('Concurrent deployment detected: '+w);}
if(action==='snapshot'){
 await fs.mkdir(root,{recursive:true,mode:0o700});if(await fs.stat(join(root,'baseline.json')).then(()=>true).catch(()=>false))throw Error('Snapshot exists; reconcile it.');
 const workers={};for(const w of ['shift-partner-portal','shift-hq-clinical-portal','shift-hq','shift-core','shift-clinical-records'])workers[w]=await current(w);
 const bundles={};
 for(const [w]of targets){
  const settings=await api(w+'/settings'),versions=await api(w+'/versions'),latest=versions.items?.[0]?.id;
  if(latest&&latest!==workers[w].versions[0].version_id)throw Error('Unpublished version must be reconciled: '+w);
  const bytes=await source(w);await fs.writeFile(join(root,w+'-before.bundle.mjs'),bytes,{mode:0o600});await write(w+'-settings',settings);
  bundles[w]={sourceSha256:hash(bytes),latest};
 }
 await assertServing(workers);await write('baseline',{workers,bundles});console.log(JSON.stringify({snapshot:true,workers:Object.fromEntries(Object.entries(workers).map(([w,d])=>[w,d.id])),bundles}));
}
if(action==='upload'){
 if(execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim())throw Error('Release checkout must be clean.');
 if(await fs.stat(join(root,'uploaded.json')).then(()=>true).catch(()=>false))throw Error('Upload receipt exists; reconcile it.');
 const before=await read('baseline');await assertServing(before.workers);
 for(const [w]of targets){if(hash(await source(w))!==before.bundles[w].sourceSha256)throw Error('Serving source changed: '+w);const v=await api(w+'/versions');if(v.items?.[0]?.id!==before.bundles[w].latest)throw Error('Concurrent unpublished version: '+w);}
 const receipt={sourceCommit:sha,flags,workers:{}};
 for(const [w,bundle]of targets){
  const settings=await read(w+'-settings'),map=new Map(settings.bindings.filter(b=>!['secret_text','secret_key'].includes(b.type)).map(b=>[b.name,b]));
  for(const [name,text]of Object.entries({...flags,RELEASE_SOURCE_COMMIT:sha}))map.set(name,{name,type:'plain_text',text});
  const metadata={main_module:'worker.mjs',bindings:[...map.values()],keep_bindings:['secret_text','secret_key'],compatibility_date:settings.compatibility_date,compatibility_flags:settings.compatibility_flags||[],annotations:{'workers/commit_sha':sha,'workers/message':'Temporary owner and test password sign-in '+sha.slice(0,12)}};
  for(const k of ['usage_model','limits','placement','observability','logpush','tail_consumers'])if(settings[k]!=null)metadata[k]=settings[k];
  const bytes=await fs.readFile(join(repo,'.partner-qa/'+bundle+'.bundle.mjs')),form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));form.set('worker.mjs',new Blob([bytes],{type:'application/javascript+module'}),'worker.mjs');
  const v=await api(w+'/versions','POST',form);receipt.workers[w]={version:v.id,sourceSha256:hash(bytes),bytes:bytes.length};await write('uploaded',receipt);console.log(JSON.stringify({uploadedOnly:true,worker:w,...receipt.workers[w]}));
 }
 await assertServing(before.workers);
}
if(action==='promote'){
 const before=await read('baseline'),uploaded=await read('uploaded');if(uploaded.sourceCommit!==sha||Object.keys(uploaded.workers).length!==targets.length)throw Error('Complete exact upload required.');
 if(await fs.stat(join(root,'promoted.json')).then(()=>true).catch(()=>false))throw Error('Promotion receipt exists; reconcile it.');
 const promoted={sourceCommit:sha,workers:{}};
 for(const [w]of targets){await assertServing({...before.workers,...promoted.workers});const v=await api(w+'/versions');if(v.items?.[0]?.id!==uploaded.workers[w].version)throw Error('Concurrent unpublished version: '+w);
  const d=await api(w+'/deployments','POST',{strategy:'percentage',versions:[{version_id:uploaded.workers[w].version,percentage:100}],annotations:{'workers/message':'Matt authorised temporary owner and test password sign-in '+sha.slice(0,12)}});
  promoted.workers[w]=d;await write('promoted',promoted);console.log(JSON.stringify({deployed:w,id:d.id,sourceCommit:sha}));
 }
}
if(action==='verify'){
 const before=await read('baseline'),uploaded=await read('uploaded'),promoted=await read('promoted');await assertServing({...before.workers,...promoted.workers});
 for(const [w]of targets){
  const old=await read(w+'-settings'),settings=await api(w+'/settings'),allowed={...flags,RELEASE_SOURCE_COMMIT:sha};
  for(const b of old.bindings){const now=settings.bindings.find(x=>x.name===b.name);if(Object.hasOwn(allowed,b.name)){if(now?.text!==allowed[b.name])throw Error('Changed flag mismatch: '+w+' '+b.name);}else if(JSON.stringify(now)!==JSON.stringify(b))throw Error('Binding changed: '+w+' '+b.name);}
  for(const [name,text]of Object.entries(allowed))if(settings.bindings.find(b=>b.name===name)?.text!==text)throw Error('Flag mismatch: '+w+' '+name);
  if(settings.bindings.some(b=>!old.bindings.some(x=>x.name===b.name)&&!Object.hasOwn(allowed,b.name)))throw Error('Unexpected binding: '+w);
  if(hash(await source(w))!==uploaded.workers[w].sourceSha256)throw Error('Serving source mismatch: '+w);
 }
 const receipt={verified:true,sourceCommit:sha,flags,deployments:Object.fromEntries(Object.entries(promoted.workers).map(([w,d])=>[w,d.id])),otherBindingsAndWorkersPreserved:true};await write('verification',receipt);console.log(JSON.stringify(receipt));
}
if(action==='rollback'){
 const before=await read('baseline'),promoted=await read('promoted');await assertServing({...before.workers,...promoted.workers});
 const restored={};
 for(const [w]of [...targets].reverse()){const d=await api(w+'/deployments','POST',{strategy:'percentage',versions:before.workers[w].versions,annotations:{'workers/message':'Owned password-sign-in release rollback; retain accounts and data'}});restored[w]=d;console.log(JSON.stringify({rolledBack:w,deployment:d.id}));}
 await write('rollback',restored);
}
