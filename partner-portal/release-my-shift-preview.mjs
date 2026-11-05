// Bounded fictional-account preview on existing route owners. No new backend,
// database, auth cookie, CAPTCHA setting, public domain or supplier activation.
import fs from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {homedir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
const[action,directory,authority]=process.argv.slice(2),root=resolve(directory||'.'),repo=resolve(root,'../source');
if(!['upload','activate','verify','restore','verify-live','revise'].includes(action)||authority!=='--authorised-fictional-preview')throw Error('Exact fictional preview action required');
const read=async n=>JSON.parse(await fs.readFile(join(root,n),'utf8')),save=async(n,v)=>fs.writeFile(join(root,n),JSON.stringify(v,null,2),{mode:0o600});
const exists=async n=>fs.stat(join(root,n)).then(()=>true).catch(()=>false);
const hash=b=>createHash('sha256').update(b).digest('hex');
const canonical=v=>JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])):v);
const head=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const feature=await read('my-shift-uploaded.json'),stage=await read('my-shift-staged.json');
const target=['shift-clinical-records','shift-programme-member-20261023'];
const token=(await fs.readFile(join(homedir(),'Library/Preferences/.wrangler/config/default.toml'),'utf8')).match(/^oauth_token\s*=\s*"([^"\n]+)"/m)?.[1];if(!token)throw Error('Existing Cloudflare session required');
const path=w=>'/accounts/9e5386dcf455be34c582d93f8bfc79e6/workers/scripts/'+w;
async function raw(p,method='GET',body){return fetch('https://api.cloudflare.com/client/v4'+p,{method,headers:{Authorization:'Bearer '+token,...body&&!(body instanceof FormData)?{'Content-Type':'application/json'}:{}},body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});}
async function api(p,method='GET',body){const r=await raw(p,method,body),d=await r.json();if(!r.ok||!d.success)throw Error(method+' '+p+' '+r.status+' '+JSON.stringify(d.errors));return d.result;}
async function serving(expected=stage.workers){for(const[w,v]of Object.entries(expected)){const d=(await api(path(w)+'/deployments')).deployments[0];if(d.id!==v.id)throw Error('Concurrent release detected: '+w);}}
const receipt=await exists('my-shift-preview-release.json')?await read('my-shift-preview-release.json'):{sourceCommit:head,featureCommit:feature.sourceCommit,workers:{},startedAt:new Date().toISOString()};
if(action==='revise'){
 if(execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim())throw Error('Clean committed revision required');
 const ci=await read('preview-ci.json'),ciHashes=await read('revision-ci-bundle-hashes.json');if(!ci.pass||ci.sourceCommit!==head||ciHashes.sourceCommit!==head)throw Error('Exact successful CI artifact required for feature revision');await serving();
 const file='my-shift-revision-'+head.slice(0,12)+'.json',revision=await exists(file)?await read(file):{sourceCommit:head,previousFeature:feature.sourceCommit,workers:{},staged:{}};
 if(revision.sourceCommit!==head)throw Error('Revision source mismatch');if(revision.complete){console.log(JSON.stringify({revisionAlreadyStaged:true,sourceCommit:head}));process.exit(0);}
 if(!await exists('my-shift-uploaded-'+revision.previousFeature+'.json'))await save('my-shift-uploaded-'+revision.previousFeature+'.json',feature);
 if(!await exists('my-shift-preview-'+receipt.sourceCommit+'.json'))await save('my-shift-preview-'+receipt.sourceCommit+'.json',receipt);
 const workers=[['shift-clinical-records','member'],['shift-hq-clinical-portal','clinical'],['shift-partner-portal','sstrx'],['shift-programme-member-20261023','navigation']];
 for(const[w,bundle]of workers){if(revision.workers[w])continue;await serving();for(const[owner]of workers){const latest=(await api(path(owner)+'/versions')).items?.[0]?.id,expected=revision.workers[owner]?.version||receipt.workers[owner]?.version||feature.workers[owner].version;if(latest!==expected)throw Error('Unreconciled upload: '+owner);}let entry,modules;
  if(bundle==='navigation'){
   const base=await originalModules(w),{buildMemberNavigation}=await import(new URL('file://'+join(repo,'partner-portal/build-member-navigation.mjs')));entry=base.entry;
   if(!base.modules.some(m=>m.name==='sst-member-message-navigation.mjs'))throw Error('Original navigation missing');
   modules=await Promise.all(base.modules.map(async m=>({...m,bytes:m.name==='sst-member-message-navigation.mjs'?await buildMemberNavigation():m.bytes})));
  }else{entry='worker.mjs';const bytes=await fs.readFile(join(repo,'.partner-qa',bundle+'.bundle.mjs'));if(hash(bytes)!==ciHashes.hashes[bundle+'.bundle.mjs'])throw Error('CI bundle digest mismatch: '+bundle);modules=[{name:entry,type:'application/javascript+module',bytes}];}
  const settings=(await read(w+'-settings.json')).result,map=new Map(settings.bindings.filter(b=>!['secret_text','secret_key'].includes(b.type)).map(b=>[b.name,b]));
  for(const[name,text]of Object.entries({MY_SHIFT_REDESIGN_ENABLED:'true',MY_SHIFT_RELEASE:head}))map.set(name,{name,type:'plain_text',text});
  if(bundle==='navigation')map.set('MY_SHIFT_MEMBER',{name:'MY_SHIFT_MEMBER',type:'service',service:'shift-clinical-records',environment:'production'});
  const meta={main_module:entry,bindings:[...map.values()],keep_bindings:['secret_text','secret_key'],compatibility_date:settings.compatibility_date,compatibility_flags:settings.compatibility_flags||[],annotations:{'workers/commit_sha':head,'workers/message':'CI verified My Shift revision '+head.slice(0,12)}};
  for(const k of ['usage_model','limits','placement','observability','logpush','tail_consumers'])if(settings[k]!=null)meta[k]=settings[k];
  const form=new FormData();form.set('metadata',new Blob([JSON.stringify(meta)],{type:'application/json'}));for(const m of modules)form.set(m.name,new Blob([m.bytes],{type:m.type}),m.name);
  const v=await api(path(w)+'/versions','POST',form);revision.workers[w]={version:v.id,main:entry,modules:modules.map(m=>({name:m.name,sha256:hash(m.bytes)}))};await save(file,revision);console.log(JSON.stringify({revised:w,version:v.id,sourceCommit:head,ciHashesVerified:true}));
 }
 const next={sourceCommit:head,workers:revision.workers};
 // Verify the exact uploaded bytes before another owned preview upload can
 // become the latest version. An immutable version ID retains this evidence.
 for(const[w]of workers){const modules=await content(w),expected=next.workers[w].modules;if(modules.length!==expected.length||modules.some(m=>expected.find(n=>n.name===m.name)?.sha256!==hash(m.bytes)))throw Error('Revision upload verification failed: '+w);}
 await save('my-shift-uploaded.json',next);stage.sourceCommit=head;
 for(const[w]of workers){if(revision.staged[w])continue;await serving();const current=(await api(path(w)+'/deployments')).deployments[0],live=current.versions.filter(v=>v.percentage>0);if(live.length!==1||live[0].percentage!==100)throw Error('Reconcile active traffic split');
  const d=await api(path(w)+'/deployments','POST',{strategy:'percentage',versions:[...live,{version_id:next.workers[w].version,percentage:0}],annotations:{'workers/message':'Stage CI verified member revision; preserve current normal traffic'}});stage.workers[w]={id:d.id};revision.staged[w]=d.id;await save('my-shift-staged.json',stage);await save(file,revision);
 }
 await save('my-shift-overrides.json',{header:Object.entries(next.workers).map(([w,v])=>w+'="'+v.version+'"').join(', ')});
 const selected=await read('native-preview-sessions.json');selected.featureCommit=head;await save('native-preview-sessions.json',selected);
 await save('my-shift-preview-release.json',{sourceCommit:head,featureCommit:head,workers:{},startedAt:new Date().toISOString()});
 revision.complete=true;await save(file,revision);console.log(JSON.stringify({revisionStaged:true,sourceCommit:head,candidateNormalTrafficPercent:0,previousEvidenceRetained:true}));
}
async function content(w){const r=await raw(path(w)+'/content/v2');if(!r.ok)throw Error('Cannot read owned modules');const form=await r.formData(),out=[];for(const[name,part]of form){if(name.startsWith('/')||name.includes('..')||typeof part==='string')throw Error('Invalid module');out.push({name,type:part.type,bytes:Buffer.from(await part.arrayBuffer())});}return out;}
async function originalModules(w){const m=await read(w+'-modules.json'),out=[];for(const part of m.modules){const bytes=await fs.readFile(join(root,w,'modules',part.name));if(hash(bytes)!==part.sha256)throw Error('Retained baseline changed');out.push({...part,bytes});}return{entry:m.entry,modules:out};}
if(action==='upload'){
 if(execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim())throw Error('Clean committed preview source required');
 if(receipt.sourceCommit!==head||receipt.featureCommit!==feature.sourceCommit)throw Error('Preview receipt source mismatch');await serving();
 const ci=await read('preview-ci.json');if(!ci.pass||ci.sourceCommit!==head)throw Error('Exact successful preview CI required');
 const selected=await read('native-preview-sessions.json');if(!selected.synthetic||selected.featureCommit!==feature.sourceCommit||!Array.isArray(selected.sessions)||selected.sessions.length<1||selected.sessions.length>6||selected.sessions.some(s=>![900711108,900711109].includes(s.memberId)||!/^[a-f0-9]{64}$/.test(s.tokenHash)||Date.parse(s.expiresAt)<=Date.now()))throw Error('Verified native fictional sessions required');
 receipt.until=selected.until;receipt.cohortSessions=selected.sessions.length;
 const dispatcher=await fs.readFile(join(repo,'partner-portal/my-shift-preview.mjs'));
 const {build}=createRequire(join(repo,'package.json'))('esbuild');
 for(const w of target){if(receipt.workers[w])continue;await serving();const latest=(await api(path(w)+'/versions')).items?.[0]?.id;if(latest!==feature.workers[w].version)throw Error('Unreconciled upload: '+w);
  const base=await originalModules(w),candidate=await content(w),wanted=feature.workers[w];
  if(candidate.length!==wanted.modules.length||candidate.some(m=>wanted.modules.find(n=>n.name===m.name)?.sha256!==hash(m.bytes)))throw Error('Exact CI candidate changed');
  const member=w==='shift-clinical-records';
  const entry=`import baseline from './baseline/${base.entry}';import candidate from './candidate/${wanted.main}';import {createMyShiftPreview} from './my-shift-preview.mjs';${member?"import {authenticate} from './preview-auth.mjs';export default createMyShiftPreview(baseline,candidate,{authenticate});":"export default createMyShiftPreview(baseline,candidate,{async authorize(request,env,selected){try{const h=new Headers(request.headers);h.delete('Cloudflare-Workers-Version-Overrides');h.set('X-My-Timber-Expected-Account',String(selected.memberId));const r=await env.MY_SHIFT_MEMBER.fetch(new Request('https://shiftsometimber.co.uk/v1/member/my-shift/preview-identity',{headers:h,redirect:'manual'}));const d=r.ok?await r.json():null;return d?.eligible===true&&d.memberId===selected.memberId;}catch{return false;}}});"}`;
  const modules=[...base.modules.map(m=>({...m,name:'baseline/'+m.name})),...candidate.map(m=>({...m,name:'candidate/'+m.name})),{name:'my-shift-preview.mjs',type:'application/javascript+module',bytes:dispatcher},{name:'preview-entry.mjs',type:'application/javascript+module',bytes:Buffer.from(entry)}];
  if(member){const auth=await build({stdin:{contents:"export {authenticate} from './partner-portal/service/member-kernel.mjs';",resolveDir:repo},bundle:true,format:'esm',target:'es2022',write:false});modules.push({name:'preview-auth.mjs',type:'application/javascript+module',bytes:auth.outputFiles[0].contents});}
  const s=(await read(w+'-settings.json')).result,map=new Map(s.bindings.filter(b=>!['secret_text','secret_key'].includes(b.type)).map(b=>[b.name,b]));
  for(const[name,text]of Object.entries({MY_SHIFT_PREVIEW_ENABLED:'true',MY_SHIFT_PREVIEW_RELEASE:feature.sourceCommit,MY_SHIFT_PREVIEW_UNTIL:selected.until,MY_SHIFT_PREVIEW_SESSIONS:JSON.stringify(selected.sessions)}))map.set(name,{name,type:'plain_text',text});
  if(!member)map.set('MY_SHIFT_MEMBER',{name:'MY_SHIFT_MEMBER',type:'service',service:'shift-clinical-records',environment:'production'});
  const metadata={main_module:'preview-entry.mjs',bindings:[...map.values()],keep_bindings:['secret_text','secret_key'],compatibility_date:s.compatibility_date,compatibility_flags:s.compatibility_flags||[],annotations:{'workers/commit_sha':head,'workers/message':'Bounded fictional native preview; ordinary accounts retain exact captured baseline'}};
  for(const k of ['usage_model','limits','placement','observability','logpush','tail_consumers'])if(s[k]!=null)metadata[k]=s[k];
  const form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));for(const m of modules)form.set(m.name,new Blob([m.bytes],{type:m.type}),m.name);
  const v=await api(path(w)+'/versions','POST',form);receipt.workers[w]={version:v.id,modules:modules.map(m=>({name:m.name,sha256:hash(m.bytes)}))};await save('my-shift-preview-release.json',receipt);console.log(JSON.stringify({uploaded:w,version:v.id,sourceCommit:head,featureCommit:feature.sourceCommit,baselinePreserved:true,candidateHashesVerified:true}));
 }
}
if(action==='activate'){
 if(receipt.sourceCommit!==head||Object.keys(receipt.workers).length!==2||Date.parse(receipt.until)<=Date.now())throw Error('Exact complete current preview upload required');await serving();
 for(const w of target){if(receipt.workers[w].deployment)continue;await serving();const before=(await api(path(w)+'/deployments')).deployments[0];receipt.workers[w].before=before;await save('my-shift-preview-release.json',receipt);
  const d=await api(path(w)+'/deployments','POST',{strategy:'percentage',versions:[{version_id:receipt.workers[w].version,percentage:100},{version_id:feature.workers[w].version,percentage:0}],annotations:{'workers/message':'Only verified fictional Core sessions receive preview; baseline module serves ordinary accounts'}});
  receipt.workers[w].deployment=d.id;stage.workers[w]={id:d.id};await save('my-shift-preview-release.json',receipt);await save('my-shift-staged.json',stage);console.log(JSON.stringify({previewActive:w,deployment:d.id,normalMembers:'captured baseline module',cohortSessions:receipt.cohortSessions,expiresAt:receipt.until}));
 }
}
if(action==='verify'){
 await serving();const result={sourceCommit:receipt.sourceCommit,featureCommit:feature.sourceCommit,normalMembers:'exact retained baseline',cohortSessions:receipt.cohortSessions,expiresAt:receipt.until,workers:{}};
 for(const w of target){const modules=await content(w),r=receipt.workers[w];if(modules.length!==r.modules.length||modules.some(m=>r.modules.find(n=>n.name===m.name)?.sha256!==hash(m.bytes)))throw Error('Preview module mismatch');const v=await api(path(w)+'/versions/'+r.version),old=(await read(w+'-settings.json')).result;for(const b of old.bindings){const n=v.resources.bindings.find(n=>n.name===b.name);if(canonical(n)!==canonical(b))throw Error('Original binding changed: '+w+' '+b.name);}result.workers[w]={version:r.version,deployment:r.deployment,allModuleHashesMatch:true,originalBindingsPreserved:true};}
 await save('my-shift-preview-verified.json',result);console.log(JSON.stringify(result));
}
if(action==='restore'){
 await serving();for(const w of [...target].reverse()){const r=receipt.workers[w];if(!r.deployment)continue;const d=await api(path(w)+'/deployments','POST',{strategy:'percentage',versions:r.before.versions,annotations:{'workers/message':'Close owned fictional preview; exact pre-preview split retained'}});stage.workers[w]={id:d.id};r.restoredDeployment=d.id;await save('my-shift-staged.json',stage);await save('my-shift-preview-release.json',receipt);console.log(JSON.stringify({restored:w,deployment:d.id}));}
}
if(action==='verify-live'){
 const promoted=await read('my-shift-promoted.json');if(promoted.sourceCommit!==feature.sourceCommit)throw Error('Live source mismatch');await serving(promoted.workers);const out={sourceCommit:feature.sourceCommit,workers:{}};
 for(const[w,p]of Object.entries(promoted.workers)){const d=(await api(path(w)+'/deployments')).deployments[0];if(d.versions.length!==1||d.versions[0].percentage!==100||d.versions[0].version_id!==feature.workers[w].version)throw Error('Live version mismatch');const v=await api(path(w)+'/versions/'+feature.workers[w].version);if(v.id!==feature.workers[w].version)throw Error('Immutable feature version mismatch');const declared=v.annotations?.['workers/commit_sha']||v.metadata?.annotations?.['workers/commit_sha'];if(declared&&declared!==feature.sourceCommit)throw Error('Immutable feature version provenance mismatch');out.workers[w]={deployment:p.id,version:feature.workers[w].version,trafficPercent:100};}
 await save('my-shift-live-control-plane.json',out);console.log(JSON.stringify(out));
}
