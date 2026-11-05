import fs from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {pathToFileURL} from 'node:url';
import {brotliDecompressSync} from 'node:zlib';
import {patchProgramme,refreshNativeBrotli} from './platform/account-boundary-fix.mjs';
const [action,directory,authority]=process.argv.slice(2),root=resolve(directory||'.'),repo=resolve(new URL('..',import.meta.url).pathname);
if(!['upload','promote','verify','rollback'].includes(action))throw Error('Unknown release action');
if(['promote','rollback'].includes(action)&&authority!=='--authorised-member-release')throw Error('Explicit member release authority required');
const read=async n=>JSON.parse(await fs.readFile(join(root,n),'utf8')),save=async(n,d)=>fs.writeFile(join(root,n),JSON.stringify(d,null,2)),hash=b=>createHash('sha256').update(b).digest('hex'),sha=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const token=(await fs.readFile(join(homedir(),'Library/Preferences/.wrangler/config/default.toml'),'utf8')).match(/^oauth_token\s*=\s*"([^"\n]+)"/m)?.[1];if(!token)throw Error('Existing release credential required');
const base='/accounts/9e5386dcf455be34c582d93f8bfc79e6/workers/scripts/shift-programme-member-20261023';
async function api(path,method='GET',body){const r=await fetch('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:'Bearer '+token,...body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});const d=await r.json();if(!r.ok||!d.success)throw Error(method+' failed '+r.status+' '+JSON.stringify(d.errors));return d.result;}
const before=(await read('deployments.json')).result.deployments[0],settings=(await read('settings.json')).result;
async function assertServing(id){if((await api(base+'/deployments')).deployments[0].id!==id)throw Error('Concurrent dashboard release detected');}
if(action==='upload'){
 if(execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim())throw Error('Clean source required');await assertServing(before.id);
 if(await fs.stat(join(root,'uploaded.json')).then(()=>true).catch(()=>false))throw Error('Owned upload already exists; reconcile before repeating');
 const h=await read('headers.json'),main=Object.entries(h).find(([k])=>k.toLowerCase()==='cf-entrypoint')?.[1],manifest=await read('modules.json'),original='v7-release-20261103/programme.mjs';
 if(!main||!manifest.some(m=>m.name===main)||!manifest.some(m=>m.name===original))throw Error('Original programme source must be reconciled');
 const modules=[];let patch;
 for(const m of manifest){const old=await fs.readFile(join(root,'modules',m.name));let bytes=old;if(m.name===original){
  patch=patchProgramme(old.toString('utf8'));const candidate=join(root,'candidate-programme.mjs');await fs.writeFile(candidate,patch.source);execFileSync(process.execPath,['--check',candidate]);
  const module=await import(pathToFileURL(candidate).href+'?plain='+hash(patch.source)),url='https://shiftsometimber.co.uk/assets/member-experience/v7-native.mjs?v='+patch.version;
  const plain=await module.default.fetch(new Request(url,{headers:{'Accept-Encoding':'identity'}}),{},{});if(!plain.ok)throw Error('Plain candidate asset unavailable');const client=await plain.text();
  patch.source=refreshNativeBrotli(patch.source,client);await fs.writeFile(candidate,patch.source);execFileSync(process.execPath,['--check',candidate]);
  const encoded=await import(pathToFileURL(candidate).href+'?brotli='+hash(patch.source)),compressed=await encoded.default.fetch(new Request(url,{headers:{'Accept-Encoding':'br'}}),{},{});
  if(!compressed.ok||compressed.headers.get('Content-Encoding')!=='br'||brotliDecompressSync(Buffer.from(await compressed.arrayBuffer())).toString('utf8')!==client)throw Error('Compressed and plain candidate clients differ');
  bytes=Buffer.from(patch.source);
 }modules.push({...m,bytes,beforeSha256:hash(old)});}
 const bindings=settings.bindings.filter(b=>!['secret_text','secret_key'].includes(b.type)&&b.name!=='MEMBER_ACCOUNT_BOUNDARY_RELEASE');bindings.push({name:'MEMBER_ACCOUNT_BOUNDARY_RELEASE',type:'plain_text',text:sha});
 const metadata={main_module:main,bindings,keep_bindings:['secret_text','secret_key'],compatibility_date:settings.compatibility_date,compatibility_flags:settings.compatibility_flags||[],annotations:{'workers/message':'Repair native account root and controls '+sha.slice(0,12),'workers/commit_sha':sha}};
 for(const key of ['usage_model','limits','placement','observability','logpush','tail_consumers'])if(settings[key]!=null)metadata[key]=settings[key];
 const form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));for(const m of modules)form.set(m.name,new Blob([m.bytes],{type:m.type}),m.name);
 const u=await api(base+'/versions','POST',form);await save('uploaded.json',{sourceCommit:sha,version:u.id,main,clientVersion:patch.version,priorClientVersion:patch.previousVersion,versionReferences:patch.versionReferences,modules:modules.map(m=>({name:m.name,beforeSha256:m.beforeSha256,sha256:hash(m.bytes)}))});console.log(JSON.stringify({uploaded:u.id,clientVersion:patch.version,originalModulesRetained:modules.length}));await assertServing(before.id);
}
if(action==='promote'){const u=await read('uploaded.json');if(u.sourceCommit!==sha)throw Error('Exact source required');await assertServing(before.id);const d=await api(base+'/deployments','POST',{strategy:'percentage',versions:[{version_id:u.version,percentage:100}],annotations:{'workers/message':'Matt authorised working mobile account navigation '+sha.slice(0,12)}});await save('promoted.json',d);console.log(JSON.stringify({deployed:d.id,version:u.version}));}
if(action==='verify'){
 const p=await read('promoted.json'),u=await read('uploaded.json');await assertServing(p.id);const s=await api(base+'/settings');for(const b of settings.bindings)if(JSON.stringify(s.bindings.find(x=>x.name===b.name))!==JSON.stringify(b))throw Error('Existing dashboard binding changed: '+b.name);
 const r=await fetch('https://api.cloudflare.com/client/v4'+base+'/content/v2',{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('Serving source unavailable');const form=await r.formData();for(const m of u.modules){const part=form.get(m.name);if(!part||hash(Buffer.from(await part.arrayBuffer()))!==m.sha256)throw Error('Module mismatch: '+m.name);}if([...form.keys()].length!==u.modules.length)throw Error('Unexpected module set');
 const verified={sourceCommit:sha,deployment:p.id,version:u.version,clientVersion:u.clientVersion,allModuleDigestsMatch:true,originalBindingsPreserved:true,unchangedModules:u.modules.filter(m=>m.sha256===m.beforeSha256).map(m=>m.name)};await save('verified.json',verified);console.log(JSON.stringify(verified));
}
if(action==='rollback'){const p=await read('promoted.json');await assertServing(p.id);const d=await api(base+'/deployments','POST',{strategy:'percentage',versions:before.versions,annotations:{'workers/message':'Owned account boundary rollback; retain data and sessions'}});console.log(JSON.stringify({rolledBack:d.id}));}
