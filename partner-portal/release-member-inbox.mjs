// Extends the existing member and navigation Workers; preserves every prior module.
import fs from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const [action,directory,authority]=process.argv.slice(2),root=resolve(directory||'.'),repo=resolve(new URL('..',import.meta.url).pathname);
if(!['upload','promote','verify','rollback'].includes(action))throw Error('Use upload, promote, verify or rollback with an existing snapshot directory.');
if(['promote','rollback'].includes(action)&&authority!=='--authorised-member-release')throw Error('Explicit member release authority required.');
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const token=(await fs.readFile(join(homedir(),'Library/Preferences/.wrangler/config/default.toml'),'utf8')).match(/^oauth_token\s*=\s*"([^"\n]+)"/m)?.[1];if(!token)throw Error('Existing release credential required.');
const account='9e5386dcf455be34c582d93f8bfc79e6',zone='66ec3268950adcfc837b7b8b2f8356ed',member='shift-clinical-records',navigation='shift-hq-member-comms-20261023',targets=[member,navigation];
const read=async p=>JSON.parse(await fs.readFile(join(root,p),'utf8')),save=async(p,v)=>fs.writeFile(join(root,p),JSON.stringify(v,null,2)),hash=b=>createHash('sha256').update(b).digest('hex');
async function api(path,method='GET',body){const r=await fetch('https://api.cloudflare.com/client/v4'+path,{method,headers:{Authorization:'Bearer '+token,...body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});const d=await r.json();if(!r.ok||d.success!==true)throw Error(method+' '+path+' '+r.status+' '+JSON.stringify(d.errors));return d.result;}
const path=w=>'/accounts/'+account+'/workers/scripts/'+w;
const before={},settings={};for(const w of targets){before[w]=(await read(w+'/deployments.json')).result.deployments[0];settings[w]=(await read(w+'/settings.json')).result;}
async function assertServing(expected){for(const w of targets){const d=(await api(path(w)+'/deployments')).deployments[0];if(d.id!==(expected[w]?.id||before[w].id))throw Error('Concurrent release: '+w);}}
if(action==='upload'){
 if(execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim())throw Error('Source must be clean.');
 await assertServing(before);if(await fs.stat(join(root,'uploaded.json')).then(()=>true).catch(()=>false))throw Error('Upload exists; reconcile rather than repeat.');
 const result={sourceCommit:sha,workers:{}};
 for(const w of targets){
  let main,modules=[];
  if(w===member){main='worker.mjs';modules=[{name:main,type:'application/javascript+module',bytes:await fs.readFile(join(repo,'.partner-qa/member.bundle.mjs'))}];}
  else{
   const h=await read(w+'/content-headers.json'),priorMain=Object.entries(h).find(([k])=>k.toLowerCase()==='cf-entrypoint')?.[1];
   const manifest=await read(w+'/modules.json');if(!priorMain||!manifest.some(m=>m.name===priorMain))throw Error('Original entrypoint missing.');
   for(const m of manifest)modules.push({...m,bytes:await fs.readFile(join(root,w,'modules',m.name))});
   main='member-messages-entry.mjs';if(modules.some(m=>m.name===main))throw Error('Inbox wrapper already exists.');
   modules.push({name:main,type:'application/javascript+module',bytes:Buffer.from(`import original from './${priorMain}';export * from './${priorMain}';import {wrapMemberInboxNavigation} from './member-messages-navigation.mjs';export default wrapMemberInboxNavigation(original);`)});
   modules.push({name:'member-messages-navigation.mjs',type:'application/javascript+module',bytes:await fs.readFile(join(repo,'partner-portal/platform/member-entry.mjs'))});
  }
  const s=settings[w],bindings=s.bindings.filter(b=>!['secret_text','secret_key'].includes(b.type)&&b.name!=='SSTRX_MEMBER_INBOX_RELEASE');bindings.push({name:'SSTRX_MEMBER_INBOX_RELEASE',type:'plain_text',text:sha});
  const metadata={main_module:main,bindings,keep_bindings:['secret_text','secret_key'],compatibility_date:s.compatibility_date,compatibility_flags:s.compatibility_flags||[],annotations:{'workers/message':'Authorised shared member inbox '+sha.slice(0,12),'workers/commit_sha':sha}};
  for(const key of ['usage_model','limits','placement','observability','logpush','tail_consumers'])if(s[key]!=null)metadata[key]=s[key];
  const form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));for(const m of modules)form.set(m.name,new Blob([m.bytes],{type:m.type}),m.name);
  const uploaded=await api(path(w)+'/versions','POST',form);result.workers[w]={version:uploaded.id,main,modules:modules.map(m=>({name:m.name,sha256:hash(m.bytes)}))};await save('uploaded.json',result);console.log(JSON.stringify({uploaded:w,version:uploaded.id,modules:modules.length}));
 }
 await assertServing(before);
}
if(action==='promote'){
 const u=await read('uploaded.json');if(u.sourceCommit!==sha||Object.keys(u.workers).length!==2)throw Error('Exact complete upload required.');await assertServing(before);
 const currentRoutes=await api('/zones/'+zone+'/workers/routes'),routePatterns=['shiftsometimber.co.uk/member/messages*','shiftsometimber.co.uk/v1/member/secure-messages*'];
 for(const pattern of routePatterns){const r=currentRoutes.find(r=>r.pattern===pattern);if(r&&r.script!==member)throw Error('Existing route owner: '+pattern);}
 const receipt={sourceCommit:sha,workers:{},routes:[]};await save('promoted.json',receipt);
 for(const w of targets){await assertServing(receipt.workers);const d=await api(path(w)+'/deployments','POST',{strategy:'percentage',versions:[{version_id:u.workers[w].version,percentage:100}],annotations:{'workers/message':'Matt authorised shared member inbox '+sha.slice(0,12)}});receipt.workers[w]={id:d.id,versions:d.versions};await save('promoted.json',receipt);console.log(JSON.stringify({deployed:w,id:d.id}));
  if(w===member)for(const pattern of routePatterns){const existing=currentRoutes.find(r=>r.pattern===pattern),r=existing||await api('/zones/'+zone+'/workers/routes','POST',{pattern,script:member});receipt.routes.push({...r,created:!existing});await save('promoted.json',receipt);}
 }
}
if(action==='verify'){
 const u=await read('uploaded.json'),p=await read('promoted.json');await assertServing(p.workers);const verified={sourceCommit:sha,workers:{},routes:p.routes};
 for(const w of targets){const s=await api(path(w)+'/settings');for(const b of settings[w].bindings){const n=s.bindings.find(x=>x.name===b.name);if(JSON.stringify(n)!==JSON.stringify(b))throw Error('Existing binding changed: '+w+' '+b.name);}
  const r=await fetch('https://api.cloudflare.com/client/v4'+path(w)+'/content/v2',{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('Serving modules unavailable');const form=await r.formData();
  for(const m of u.workers[w].modules){const part=form.get(m.name);if(!part||hash(Buffer.from(await part.arrayBuffer()))!==m.sha256)throw Error('Serving module mismatch: '+m.name);}
  if([...form.keys()].length!==u.workers[w].modules.length)throw Error('Unexpected serving module set');verified.workers[w]={...p.workers[w],allModuleDigestsMatch:true,existingBindingsUnchanged:true};
 }
 await save('verified.json',verified);console.log(JSON.stringify(verified));
}
if(action==='rollback'){
 const p=await read('promoted.json');await assertServing(p.workers);
 for(const r of p.routes)if(r.created)await api('/zones/'+zone+'/workers/routes/'+r.id,'DELETE');
 for(const w of [...targets].reverse())if(p.workers[w])await api(path(w)+'/deployments','POST',{strategy:'percentage',versions:before[w].versions,annotations:{'workers/message':'Owned member inbox rollback; preserve all data and prior modules'}});
 console.log(JSON.stringify({rolledBack:true,sourceCommit:sha}));
}
