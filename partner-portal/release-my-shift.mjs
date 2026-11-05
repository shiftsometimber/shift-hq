// Owned release of the existing services. Does not commission providers or send.
import fs from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {buildMemberNavigation} from './build-member-navigation.mjs';
const [action,directory,authority]=process.argv.slice(2),root=resolve(directory||'.'),repo=resolve(new URL('..',import.meta.url).pathname);
if(!['snapshot','upload','stage','routes','verify','promote','rollback'].includes(action))throw Error('Unknown release action');
if(action!=='snapshot'&&authority!=='--authorised-my-shift-release')throw Error('Exact member release authorisation required');
const targets=[['shift-clinical-records','member'],['shift-hq-clinical-portal','clinical'],['shift-partner-portal','sstrx'],['shift-programme-member-20261023','navigation']];
const account='9e5386dcf455be34c582d93f8bfc79e6',zone='66ec3268950adcfc837b7b8b2f8356ed';
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const token=(await fs.readFile(join(homedir(),'Library/Preferences/.wrangler/config/default.toml'),'utf8')).match(/^oauth_token\s*=\s*"([^"\n]+)"/m)?.[1];if(!token)throw Error('Existing Cloudflare session required');
const hash=b=>createHash('sha256').update(b).digest('hex'),read=async n=>JSON.parse(await fs.readFile(join(root,n),'utf8'));
async function save(n,v){await fs.writeFile(join(root,n),JSON.stringify(v,null,2),{mode:0o600});}
const exists=async n=>fs.stat(join(root,n)).then(()=>true).catch(()=>false),path=w=>'/accounts/'+account+'/workers/scripts/'+w;
const canonical=v=>JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])):v);
async function api(p,method='GET',body){const r=await fetch('https://api.cloudflare.com/client/v4'+p,{method,headers:{Authorization:'Bearer '+token,...body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});const d=await r.json();if(!r.ok||!d.success)throw Error(method+' '+p+' '+r.status+' '+JSON.stringify(d.errors));return d.result;}
await fs.mkdir(root,{recursive:true,mode:0o700});
const baseline={},settings={};for(const[w]of targets){baseline[w]=(await read(w+'-deployments.json')).result.deployments[0];settings[w]=(await read(w+'-settings.json')).result;}
async function assertServing(overrides={}){for(const[w]of targets){const actual=(await api(path(w)+'/deployments')).deployments[0];if(actual.id!==(overrides[w]?.id||baseline[w].id))throw Error('Concurrent release detected: '+w);}}
async function assertLatest(expected){for(const[w]of targets){const d=await api(path(w)+'/versions'),id=d.items?.[0]?.id;if(id!==expected[w])throw Error('Unreconciled uploaded version: '+w+' '+id);}}
const baselineVersion=Object.fromEntries(targets.map(([w])=>{if(baseline[w].versions.length!==1||baseline[w].versions[0].percentage!==100)throw Error('Reconcile an active split first');return[w,baseline[w].versions[0].version_id];}));
if(action==='snapshot'){
 await assertServing();await assertLatest(baselineVersion);
 for(const[w]of targets){
  const dir=join(root,w);await fs.mkdir(join(dir,'modules'),{recursive:true,mode:0o700});
  const v=await api(path(w)+'/versions/'+baselineVersion[w]);await save(w+'-version.json',v);
  const r=await fetch('https://api.cloudflare.com/client/v4'+path(w)+'/content/v2',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('Cannot retain existing modules: '+w);
  const entry=r.headers.get('cf-entrypoint');if(!entry)throw Error('Missing entrypoint: '+w);const form=await r.formData(),modules=[];
  for(const[name,part]of form){if(typeof part==='string'||name.includes('..')||name.startsWith('/'))throw Error('Unexpected source module');const b=Buffer.from(await part.arrayBuffer());await fs.mkdir(join(dir,'modules',name,'..'),{recursive:true});await fs.writeFile(join(dir,'modules',name),b,{mode:0o600});modules.push({name,type:part.type,sha256:hash(b)});}
  await save(w+'-modules.json',{entry,modules,version:baselineVersion[w],downloadHeaders:{etag:r.headers.get('etag')}});
 }
 await assertServing();await assertLatest(baselineVersion);console.log(JSON.stringify({snapshot:true,sourceCommit:sha,versions:baselineVersion}));
}
if(action==='upload'){
 if(execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim())throw Error('Clean exact source required');await assertServing();
 const receipt=await exists('my-shift-uploaded.json')?await read('my-shift-uploaded.json'):{sourceCommit:sha,workers:{}};if(receipt.sourceCommit!==sha)throw Error('Existing release receipt belongs to different source');
 await assertLatest(Object.fromEntries(targets.map(([w])=>[w,receipt.workers[w]?.version||baselineVersion[w]])));
 for(const[w,bundle]of targets){if(receipt.workers[w])continue;const prior=await read(w+'-modules.json');let main=prior.entry,modules=[];
  if(bundle==='navigation'){
   const nav='sst-member-message-navigation.mjs';if(!prior.modules.some(m=>m.name===nav))throw Error('Existing member navigation module missing');
   for(const m of prior.modules){const bytes=m.name===nav?await buildMemberNavigation():await fs.readFile(join(root,w,'modules',m.name));if(m.name!==nav&&hash(bytes)!==m.sha256)throw Error('Retained module changed');modules.push({...m,bytes});}
  }else{if(prior.modules.length!==1||main!=='worker.mjs')throw Error('Reconcile non-standard module layout: '+w);modules=[{name:'worker.mjs',type:'application/javascript+module',bytes:await fs.readFile(join(repo,'.partner-qa',bundle+'.bundle.mjs'))}];}
  const s=settings[w],map=new Map(s.bindings.filter(b=>!['secret_text','secret_key'].includes(b.type)).map(b=>[b.name,b]));
  for(const[name,text]of Object.entries({MY_SHIFT_REDESIGN_ENABLED:'true',MY_SHIFT_RELEASE:sha}))map.set(name,{name,type:'plain_text',text});
  if(bundle==='navigation')map.set('MY_SHIFT_MEMBER',{name:'MY_SHIFT_MEMBER',type:'service',service:'shift-clinical-records',environment:'production'});
  const metadata={main_module:main,bindings:[...map.values()],keep_bindings:['secret_text','secret_key'],compatibility_date:s.compatibility_date,compatibility_flags:s.compatibility_flags||[],annotations:{'workers/commit_sha':sha,'workers/message':'Matt authorised My Shift member experience '+sha.slice(0,12)}};
  for(const key of ['usage_model','limits','placement','observability','logpush','tail_consumers'])if(s[key]!=null)metadata[key]=s[key];
  const form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));for(const m of modules)form.set(m.name,new Blob([m.bytes],{type:m.type}),m.name);
  const v=await api(path(w)+'/versions','POST',form);receipt.workers[w]={version:v.id,main,modules:modules.map(m=>({name:m.name,sha256:hash(m.bytes)}))};await save('my-shift-uploaded.json',receipt);console.log(JSON.stringify({uploaded:w,version:v.id,modules:modules.length}));
 }
 await assertServing();
}
if(action==='stage'){
 const u=await read('my-shift-uploaded.json');if(u.sourceCommit!==sha||Object.keys(u.workers).length!==targets.length)throw Error('Exact complete upload required');
 const stage=await exists('my-shift-staged.json')?await read('my-shift-staged.json'):{sourceCommit:sha,workers:{}};if(stage.sourceCommit!==sha)throw Error('Stage source changed');await assertServing(stage.workers);
 for(const[w]of targets){if(stage.workers[w])continue;await assertServing(stage.workers);const d=await api(path(w)+'/deployments','POST',{strategy:'percentage',versions:[...baseline[w].versions,{version_id:u.workers[w].version,percentage:0}],annotations:{'workers/message':'My Shift hosted acceptance; existing release 100%, candidate 0% '+sha.slice(0,12)}});stage.workers[w]={id:d.id,versions:d.versions};await save('my-shift-staged.json',stage);console.log(JSON.stringify({staged:w,deployment:d.id,candidateTraffic:0}));}
 await save('my-shift-overrides.json',{header:Object.entries(u.workers).map(([w,v])=>w+'="'+v.version+'"').join(', ')});
}
if(action==='routes'){
 const s=await read('my-shift-staged.json');await assertServing(s.workers);const receipts=await exists('my-shift-routes.json')?await read('my-shift-routes.json'):[];
 for(const[pattern,script]of [['shiftsometimber.co.uk/member/my-shift*','shift-programme-member-20261023'],['shiftsometimber.co.uk/v1/member/my-shift*','shift-clinical-records']]){
  const routes=await api('/zones/'+zone+'/workers/routes'),r=routes.find(r=>r.pattern===pattern);if(r&&r.script!==script)throw Error('Route belongs to another release: '+pattern);
  if(receipts.some(x=>x.pattern===pattern)){if(!r||r.id!==receipts.find(x=>x.pattern===pattern).id)throw Error('Owned route changed');continue;}
  const result=r||await api('/zones/'+zone+'/workers/routes','POST',{pattern,script});receipts.push({...result,created:!r});await save('my-shift-routes.json',receipts);
 }
 console.log(JSON.stringify({routes:receipts}));
}
if(action==='verify'){
 const u=await read('my-shift-uploaded.json'),current=await exists('my-shift-promoted.json')?await read('my-shift-promoted.json'):await read('my-shift-staged.json');if(u.sourceCommit!==sha)throw Error('Source changed');await assertServing(current.workers);await assertLatest(Object.fromEntries(Object.entries(u.workers).map(([w,v])=>[w,v.version])));
 const result={sourceCommit:sha,workers:{}};
 for(const[w]of targets){const v=await api(path(w)+'/versions/'+u.workers[w].version),bindings=v.resources.bindings;for(const b of settings[w].bindings){if(['MY_SHIFT_REDESIGN_ENABLED','MY_SHIFT_RELEASE','MY_SHIFT_MEMBER'].includes(b.name))continue;const n=bindings.find(n=>n.name===b.name);if(canonical(n)!==canonical(b))throw Error('Original binding changed: '+w+' '+b.name);}
  const r=await fetch('https://api.cloudflare.com/client/v4'+path(w)+'/content/v2',{headers:{Authorization:'Bearer '+token},signal:AbortSignal.timeout(45000)});if(!r.ok)throw Error('Module verification unavailable');const form=await r.formData();for(const m of u.workers[w].modules){const p=form.get(m.name);if(!p||hash(Buffer.from(await p.arrayBuffer()))!==m.sha256)throw Error('Exact module mismatch: '+w+' '+m.name);}if([...form.keys()].length!==u.workers[w].modules.length)throw Error('Unexpected modules');result.workers[w]={deployment:current.workers[w].id,version:u.workers[w].version,originalBindingsPreserved:true,allModuleHashesMatch:true};
 }
 await save('my-shift-verified.json',result);console.log(JSON.stringify(result));
}
if(action==='promote'){
 const u=await read('my-shift-uploaded.json'),s=await read('my-shift-staged.json'),gate=await read('hosted-acceptance.json');if(u.sourceCommit!==sha||!gate.pass||gate.sourceCommit!==sha)throw Error('Exact hosted acceptance required');
 const p=await exists('my-shift-promoted.json')?await read('my-shift-promoted.json'):{sourceCommit:sha,workers:{}};if(p.sourceCommit!==sha)throw Error('Promotion source changed');await assertServing({...s.workers,...p.workers});
 for(const[w]of targets){if(p.workers[w])continue;await assertServing({...s.workers,...p.workers});const d=await api(path(w)+'/deployments','POST',{strategy:'percentage',versions:[{version_id:u.workers[w].version,percentage:100}],annotations:{'workers/message':'Matt authorised verified My Shift member experience '+sha.slice(0,12)}});p.workers[w]={id:d.id,versions:d.versions};await save('my-shift-promoted.json',p);console.log(JSON.stringify({deployed:w,deployment:d.id,version:u.workers[w].version}));}
}
if(action==='rollback'){
 const s=await read('my-shift-staged.json'),p=await exists('my-shift-promoted.json')?await read('my-shift-promoted.json'):{workers:{}};await assertServing({...s.workers,...p.workers});
 for(const r of await exists('my-shift-routes.json')?await read('my-shift-routes.json'):[])if(r.created){const live=(await api('/zones/'+zone+'/workers/routes')).find(x=>x.id===r.id);if(!live||live.script!==r.script||live.pattern!==r.pattern)throw Error('Owned route changed before rollback');await api('/zones/'+zone+'/workers/routes/'+r.id,'DELETE');}
 for(const[w]of [...targets].reverse()){const d=await api(path(w)+'/deployments','POST',{strategy:'percentage',versions:baseline[w].versions,annotations:{'workers/message':'Owned My Shift rollback; retain native identity, records and all data'}});console.log(JSON.stringify({rolledBack:w,deployment:d.id}));}
}
