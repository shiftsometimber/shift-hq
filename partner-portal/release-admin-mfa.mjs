// Scoped Rx MFA release on the authorised release device. No credentials in argv or output.
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {join,resolve} from 'node:path';
import {createHash} from 'node:crypto';
const [action,directory,authorisation]=process.argv.slice(2);
if(!['snapshot','upload','promote','verify','rollback'].includes(action)||!directory)throw Error('Specify action and private receipt directory.');
if(['promote','rollback'].includes(action)&&authorisation!=='--authorised-portal-release')throw Error('Portal release authorisation is required.');
const root=resolve(directory),repo=resolve(new URL('..',import.meta.url).pathname),worker='shift-partner-portal';
const account='9e5386dcf455be34c582d93f8bfc79e6';
const config=await fs.readFile(join(homedir(),'Library/Preferences/.wrangler/config/default.toml'),'utf8');
const token=config.match(/^oauth_token\s*=\s*"([^"\n]+)"/m)?.[1];if(!token)throw Error('Refresh the existing authorised session.');
const base='https://api.cloudflare.com/client/v4/accounts/'+account+'/workers/scripts/';
const hash=b=>createHash('sha256').update(b).digest('hex');
const read=async name=>JSON.parse(await fs.readFile(join(root,name+'.json'),'utf8'));
const write=async(name,value)=>fs.writeFile(join(root,name+'.json'),JSON.stringify(value,null,2),{mode:0o600});
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
async function api(path,method='GET',body){
 const r=await fetch(base+path,{method,headers:{Authorization:'Bearer '+token,...body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
 const d=await r.json();if(!r.ok||d.success!==true)throw Error('Cloudflare '+method+' '+path+' failed: '+r.status+' '+JSON.stringify(d.errors));return d.result;
}
async function source(){
 const r=await fetch(base+worker+'/content/v2',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('Serving source unavailable');
 if(!r.headers.get('Content-Type')?.includes('multipart'))return Buffer.from(await r.arrayBuffer());
 const form=await r.formData(),files=[...form.entries()].filter(([,v])=>typeof v!=='string');if(files.length!==1||files[0][0]!=='worker.mjs')throw Error('Unexpected serving module layout');
 return Buffer.from(await files[0][1].arrayBuffer());
}
async function current(w){return (await api(w+'/deployments')).deployments[0];}
async function assertServing(expected){for(const [w,d]of Object.entries(expected))if((await current(w)).id!==d.id)throw Error('Concurrent deployment detected: '+w);}
if(action==='snapshot'){
 await fs.mkdir(root,{recursive:true,mode:0o700});if(await fs.stat(join(root,'baseline.json')).then(()=>true).catch(()=>false))throw Error('Snapshot already exists; reconcile it.');
 const workers={};for(const w of [worker,'shift-hq','shift-core','shift-hq-clinical-portal','shift-clinical-records'])workers[w]=await current(w);
 const settings=await api(worker+'/settings'),versions=await api(worker+'/versions'),latest=versions.items?.[0]?.id;
 if(latest&&latest!==workers[worker].versions[0].version_id)throw Error('An unpublished gateway version must be reconciled before release.');
 const old=await source();await assertServing(workers);
 await fs.writeFile(join(root,'before.bundle.mjs'),old,{mode:0o600});await write('settings',settings);
 await write('baseline',{workers,sourceSha256:hash(old),sourceCommit:settings.bindings.find(b=>b.name==='RELEASE_SOURCE_COMMIT')?.text,latest});
 console.log(JSON.stringify({snapshot:true,sourceSha256:hash(old),sourceCommit:settings.bindings.find(b=>b.name==='RELEASE_SOURCE_COMMIT')?.text,workers:Object.fromEntries(Object.entries(workers).map(([w,d])=>[w,d.id]))}));
}
if(action==='upload'){
 if(execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim())throw Error('Release checkout must be clean.');
 if(await fs.stat(join(root,'uploaded.json')).then(()=>true).catch(()=>false))throw Error('An upload receipt already exists; reconcile it.');
 const before=await read('baseline');await assertServing(before.workers);
 if(hash(await source())!==before.sourceSha256)throw Error('Gateway serving source changed.');
 const versions=await api(worker+'/versions');if(versions.items?.[0]?.id!==before.latest)throw Error('Concurrent unpublished version detected.');
 const bytes=await fs.readFile(join(repo,'.partner-qa/sstrx.bundle.mjs')),settings=await read('settings');
 const bindings=settings.bindings.filter(b=>!['secret_text','secret_key'].includes(b.type)).map(b=>b.name==='RELEASE_SOURCE_COMMIT'?{...b,text:sha}:b);
 const metadata={main_module:'worker.mjs',bindings,keep_bindings:['secret_text','secret_key'],compatibility_date:settings.compatibility_date,compatibility_flags:settings.compatibility_flags||[],annotations:{'workers/commit_sha':sha,'workers/message':'Rx admin authenticator enrolment '+sha.slice(0,12)}};
 for(const k of ['usage_model','limits','placement','observability','logpush','tail_consumers'])if(settings[k]!=null)metadata[k]=settings[k];
 const form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));form.set('worker.mjs',new Blob([bytes],{type:'application/javascript+module'}),'worker.mjs');
 const v=await api(worker+'/versions','POST',form);const receipt={sourceCommit:sha,version:v.id,sourceSha256:hash(bytes),bytes:bytes.length};await write('uploaded',receipt);await assertServing(before.workers);console.log(JSON.stringify({uploadedOnly:true,...receipt}));
}
if(action==='promote'){
 const before=await read('baseline'),uploaded=await read('uploaded');if(uploaded.sourceCommit!==sha)throw Error('Source commit does not match upload.');
 if(await fs.stat(join(root,'promoted.json')).then(()=>true).catch(()=>false))throw Error('Release already promoted; verify instead.');
 await assertServing(before.workers);const versions=await api(worker+'/versions');if(versions.items?.[0]?.id!==uploaded.version)throw Error('Concurrent unpublished version detected.');
 const d=await api(worker+'/deployments','POST',{strategy:'percentage',versions:[{version_id:uploaded.version,percentage:100}],annotations:{'workers/message':'Matt authorised Rx MFA enrolment fix '+sha.slice(0,12)}});
 await write('promoted',{sourceCommit:sha,worker,deployment:d});console.log(JSON.stringify({deployed:worker,id:d.id,versions:d.versions,sourceCommit:sha}));
}
if(action==='verify'){
 const before=await read('baseline'),uploaded=await read('uploaded'),promoted=await read('promoted');
 await assertServing({...before.workers,[worker]:promoted.deployment});const settings=await api(worker+'/settings'),old=await read('settings');
 for(const b of old.bindings){const now=settings.bindings.find(x=>x.name===b.name);if(b.name==='RELEASE_SOURCE_COMMIT'){if(now?.text!==uploaded.sourceCommit)throw Error('Source provenance mismatch.');}else if(JSON.stringify(now)!==JSON.stringify(b))throw Error('Binding changed: '+b.name);}
 if(settings.bindings.length!==old.bindings.length)throw Error('Unexpected bindings added.');
 const digest=hash(await source());if(digest!==uploaded.sourceSha256)throw Error('Serving source digest mismatch.');
 const receipt={verified:true,sourceCommit:uploaded.sourceCommit,deployment:promoted.deployment.id,sourceSha256:digest,bindingsPreserved:true,otherWorkersPreserved:true};await write('verification',receipt);console.log(JSON.stringify(receipt));
}
if(action==='rollback'){
 const before=await read('baseline'),promoted=await read('promoted');await assertServing({...before.workers,[worker]:promoted.deployment});
 const d=await api(worker+'/deployments','POST',{strategy:'percentage',versions:before.workers[worker].versions,annotations:{'workers/message':'Owned Rx MFA release rollback; keep accounts and data'}});
 await write('rollback',d);console.log(JSON.stringify({rolledBack:true,deployment:d.id,versions:d.versions}));
}
