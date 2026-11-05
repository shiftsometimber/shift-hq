// Actual dashboard route owner, with every existing module and binding retained.
import fs from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const [action,directory,authority]=process.argv.slice(2),root=resolve(directory||'.'),repo=resolve(new URL('..',import.meta.url).pathname);
if(!['upload','promote','verify','rollback'].includes(action))throw Error('Unknown release action');
if(['promote','rollback'].includes(action)&&authority!=='--authorised-member-release')throw Error('Explicit member release authority required');
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim(),read=async n=>JSON.parse(await fs.readFile(join(root,n),'utf8')),save=async(n,d)=>fs.writeFile(join(root,n),JSON.stringify(d,null,2)),hash=b=>createHash('sha256').update(b).digest('hex');
const token=(await fs.readFile(join(homedir(),'Library/Preferences/.wrangler/config/default.toml'),'utf8')).match(/^oauth_token\s*=\s*"([^"\n]+)"/m)?.[1];if(!token)throw Error('Existing release credential required');
const base='/accounts/9e5386dcf455be34c582d93f8bfc79e6/workers/scripts/shift-programme-member-20261023';
async function api(path,method='GET',body){const r=await fetch('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:'Bearer '+token,...body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});const d=await r.json();if(!r.ok||!d.success)throw Error(method+' failed '+r.status+' '+JSON.stringify(d.errors));return d.result;}
const before=(await read('deployments.json')).result.deployments[0],settings=(await read('settings.json')).result;
async function assertServing(id){if((await api(base+'/deployments')).deployments[0].id!==id)throw Error('Concurrent dashboard release detected');}
if(action==='upload'){
 if(execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim())throw Error('Clean source required');await assertServing(before.id);
 if(await fs.stat(join(root,'uploaded.json')).then(()=>true).catch(()=>false))throw Error('Upload already exists; reconcile instead of repeating');
 const headers=await read('headers.json'),prior=Object.entries(headers).find(([k])=>k.toLowerCase()==='cf-entrypoint')?.[1],manifest=await read('modules.json');if(!prior||!manifest.some(m=>m.name===prior))throw Error('Original entrypoint unavailable');
 const modules=[];for(const m of manifest)modules.push({...m,bytes:await fs.readFile(join(root,'modules',m.name))});
 const main='sst-member-message-entry.mjs';if(modules.some(m=>m.name===main))throw Error('Navigation extension already present');
 modules.push({name:main,type:'application/javascript+module',bytes:Buffer.from(`import original from './${prior}';export * from './${prior}';import {wrapMemberInboxNavigation} from './sst-member-message-navigation.mjs';export default wrapMemberInboxNavigation(original);`)});
 modules.push({name:'sst-member-message-navigation.mjs',type:'application/javascript+module',bytes:await fs.readFile(join(repo,'partner-portal/platform/member-entry.mjs'))});
 const bindings=settings.bindings.filter(b=>!['secret_text','secret_key'].includes(b.type)&&b.name!=='SSTRX_NAVIGATION_RELEASE');bindings.push({name:'SSTRX_NAVIGATION_RELEASE',type:'plain_text',text:sha});
 const metadata={main_module:main,bindings,keep_bindings:['secret_text','secret_key'],compatibility_date:settings.compatibility_date,compatibility_flags:settings.compatibility_flags||[],annotations:{'workers/message':'Authorised member inbox shortcut '+sha.slice(0,12),'workers/commit_sha':sha}};
 for(const key of ['usage_model','limits','placement','observability','logpush','tail_consumers'])if(settings[key]!=null)metadata[key]=settings[key];
 const form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));for(const m of modules)form.set(m.name,new Blob([m.bytes],{type:m.type}),m.name);
 const u=await api(base+'/versions','POST',form);await save('uploaded.json',{sourceCommit:sha,version:u.id,modules:modules.map(m=>({name:m.name,sha256:hash(m.bytes)}))});console.log(JSON.stringify({uploaded:u.id,retainedModules:manifest.length}));await assertServing(before.id);
}
if(action==='promote'){const u=await read('uploaded.json');if(u.sourceCommit!==sha)throw Error('Exact source required');await assertServing(before.id);const d=await api(base+'/deployments','POST',{strategy:'percentage',versions:[{version_id:u.version,percentage:100}],annotations:{'workers/message':'Matt authorised shared My Timber inbox navigation '+sha.slice(0,12)}});await save('promoted.json',d);console.log(JSON.stringify({deployed:d.id,version:u.version}));}
if(action==='verify'){
 const p=await read('promoted.json'),u=await read('uploaded.json');await assertServing(p.id);const s=await api(base+'/settings');for(const b of settings.bindings)if(JSON.stringify(s.bindings.find(x=>x.name===b.name))!==JSON.stringify(b))throw Error('Existing dashboard binding changed: '+b.name);
 const r=await fetch('https://api.cloudflare.com/client/v4'+base+'/content/v2',{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('Serving source unavailable');const form=await r.formData();for(const m of u.modules){const part=form.get(m.name);if(!part||hash(Buffer.from(await part.arrayBuffer()))!==m.sha256)throw Error('Module digest mismatch: '+m.name);}if([...form.keys()].length!==u.modules.length)throw Error('Unexpected module set');
 const verified={sourceCommit:sha,deployment:p.id,version:u.version,allModuleDigestsMatch:true,originalBindingsPreserved:true};await save('verified.json',verified);console.log(JSON.stringify(verified));
}
if(action==='rollback'){const p=await read('promoted.json');await assertServing(p.id);const d=await api(base+'/deployments','POST',{strategy:'percentage',versions:before.versions,annotations:{'workers/message':'Owned navigation rollback; no data changed'}});console.log(JSON.stringify({rolledBack:d.id}));}
