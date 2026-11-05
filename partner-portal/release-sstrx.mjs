// Run on the already authorised release device. No credential is accepted in argv
// or printed. Versions are uploaded first, then promoted only by an explicit action.
import fs from 'node:fs/promises';
import {execFileSync} from 'node:child_process';
import {homedir} from 'node:os';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
const [action='inspect',directory,authorisation]=process.argv.slice(2);
if(!directory)throw Error('An existing private snapshot directory is required.');
if(!['inspect','upload','promote','domain','verify','rollback'].includes(action))throw Error('Unknown release action.');
if(['promote','domain','rollback'].includes(action)&&authorisation!=='--authorised-portal-release')throw Error('Explicit portal release authorisation is required.');
const root=resolve(directory),repo=resolve(new URL('..',import.meta.url).pathname),read=async p=>JSON.parse(await fs.readFile(join(root,p),'utf8'));
const account=(await read('account.json')).id,zone=(await read('zone.json')).id;
const config=await fs.readFile(join(homedir(),'Library/Preferences/.wrangler/config/default.toml'),'utf8'),token=config.match(/^oauth_token\s*=\s*"([^"\n]+)"/m)?.[1];if(!token)throw Error('Refresh the existing Wrangler session first.');
const sha=execFileSync('git',['rev-parse','HEAD'],{cwd:repo,encoding:'utf8'}).trim();
const hash=b=>createHash('sha256').update(b).digest('hex');
async function api(path,method='GET',body){
 const headers={Authorization:'Bearer '+token};if(body&&!(body instanceof FormData))headers['Content-Type']='application/json';
 const r=await fetch('https://api.cloudflare.com/client/v4'+path,{method,headers,body:body instanceof FormData?body:body?JSON.stringify(body):undefined,signal:AbortSignal.timeout(45000)});
 const d=await r.json();if(!r.ok||d.success!==true)throw Error('Cloudflare '+method+' failed: '+r.status+' '+JSON.stringify(d.errors));return d.result;
}
const path=w=>'/accounts/'+account+'/workers/scripts/'+w;
const targets=[['shift-hq-clinical-portal','clinical',{SSTRX_PLATFORM_ENABLED:'true',SSTRX_PORTAL_ENABLED:'true',SSTRX_ENVIRONMENT:'production',SSTRX_TEST_SIGNING:'false',SSTRX_DIAGNOSTICS_ENABLED:'false',SSTRX_PAID_RECORD_LINK_ENABLED:'false'}],['shift-clinical-records','member',{SSTRX_PLATFORM_ENABLED:'true',SSTRX_PAID_RECORD_LINK_ENABLED:'true',SSTRX_ENVIRONMENT:'production'}],['shift-partner-portal','sstrx',{SSTRX_PORTAL_ENABLED:'true'}]];
const baseline={},settings={};for(const [w]of targets){baseline[w]=(await read(w+'-deployments.json')).result.deployments[0];settings[w]=(await read(w+'-settings.json')).result;}
async function assertServing(expected){for(const [w]of targets){const live=(await api(path(w)+'/deployments')).deployments[0];if(live.id!==expected[w].id)throw Error('Concurrent deployment detected: '+w);}}
if(action==='inspect'){
 await assertServing(baseline);const latest={};for(const[w]of targets){const v=await api(path(w)+'/versions');latest[w]=v.items?.[0]?.id||v[0]?.id||null;}
 console.log(JSON.stringify({sourceCommit:sha,preservedDeployments:Object.fromEntries(Object.entries(baseline).map(([w,d])=>[w,{deployment:d.id,versions:d.versions}])),latestUploadedVersions:latest}));
}
if(action==='upload'){
 if(execFileSync('git',['status','--porcelain'],{cwd:repo,encoding:'utf8'}).trim())throw Error('Release checkout must be clean.');await assertServing(baseline);
 const prior=await fs.readFile(join(root,'uploaded.json'),'utf8').then(JSON.parse).catch(()=>null);if(prior)throw Error('Upload receipt already exists; reconcile it instead of repeating.');
 const uploaded={sourceCommit:sha,workers:{}};
 // Check all preconditions before creating any versions.
 for(const[w]of targets){const v=await api(path(w)+'/versions'),latest=v.items?.[0]?.id||v[0]?.id;if(latest&&latest!==baseline[w].versions[0].version_id)throw Error('An unpublished version must be reconciled first: '+w);}
 for(const[w,bundle,flags]of targets){
  const source=await fs.readFile(join(repo,'.partner-qa',bundle+'.bundle.mjs'));const s=settings[w],map=new Map(s.bindings.filter(b=>!['secret_text','secret_key'].includes(b.type)).map(b=>[b.name,b]));
  for(const[name,text]of Object.entries({...flags,RELEASE_SOURCE_COMMIT:sha}))map.set(name,{name,type:'plain_text',text});
  const metadata={main_module:'worker.mjs',bindings:[...map.values()],keep_bindings:['secret_text','secret_key'],compatibility_date:s.compatibility_date,compatibility_flags:s.compatibility_flags||[],annotations:{'workers/commit_sha':sha,'workers/message':'SST Rx authorised portal release '+sha.slice(0,12)}};
  for(const key of ['usage_model','limits','placement','observability','logpush','tail_consumers'])if(s[key]!=null)metadata[key]=s[key];
  const form=new FormData();form.set('metadata',new Blob([JSON.stringify(metadata)],{type:'application/json'}));form.set('worker.mjs',new Blob([source],{type:'application/javascript+module'}),'worker.mjs');
  const result=await api(path(w)+'/versions','POST',form);uploaded.workers[w]={version:result.id,bundleSha256:hash(source),sourceBytes:source.length};await fs.writeFile(join(root,'uploaded.json'),JSON.stringify(uploaded,null,2));console.log(JSON.stringify({uploaded:w,...uploaded.workers[w]}));
 }
 await assertServing(baseline);console.log(JSON.stringify({uploadedOnly:true,productionUnchanged:true,sourceCommit:sha}));
}
if(action==='promote'){
 const uploaded=await read('uploaded.json');if(uploaded.sourceCommit!==sha||Object.keys(uploaded.workers).length!==targets.length)throw Error('Exact complete upload receipt required.');await assertServing(baseline);
 const promoted={sourceCommit:sha,workers:{}};for(const[w]of targets){const result=await api(path(w)+'/deployments','POST',{strategy:'percentage',versions:[{version_id:uploaded.workers[w].version,percentage:100}],annotations:{'workers/message':'Matt authorised SST Rx portal release '+sha.slice(0,12)}});promoted.workers[w]={id:result.id,versions:result.versions};await fs.writeFile(join(root,'promoted.json'),JSON.stringify(promoted,null,2));console.log(JSON.stringify({deployed:w,...promoted.workers[w]}));}
}
if(action==='domain'){
 const promoted=await read('promoted.json');if(promoted.sourceCommit!==sha)throw Error('Exact promoted source required.');await assertServing(promoted.workers);
 const domains=await api('/accounts/'+account+'/workers/domains'),existing=domains.find(d=>d.hostname==='sstrx.shiftsometimber.co.uk');if(existing&&existing.service!=='shift-partner-portal')throw Error('Existing hostname ownership must be reconciled.');
 const receipt={sourceCommit:sha,domain:existing||await api('/accounts/'+account+'/workers/domains','PUT',{hostname:'sstrx.shiftsometimber.co.uk',service:'shift-partner-portal',environment:'production',zone_id:zone,enabled:true,previews_enabled:false}),domainCreated:!existing};
 const routes=await api('/zones/'+zone+'/workers/routes'),route=routes.find(r=>r.pattern==='hq.shiftsometimber.co.uk/hq-partner-desk.js');if(route&&route.script!=='shift-partner-portal')throw Error('Existing HQ asset route ownership must be reconciled.');
 receipt.hqAssetRoute=route||await api('/zones/'+zone+'/workers/routes','POST',{pattern:'hq.shiftsometimber.co.uk/hq-partner-desk.js',script:'shift-partner-portal'});receipt.hqAssetRouteCreated=!route;
 await fs.writeFile(join(root,'domain.json'),JSON.stringify(receipt,null,2));console.log(JSON.stringify(receipt));
}
if(action==='verify'){
 const uploaded=await read('uploaded.json'),promoted=await read('promoted.json');await assertServing(promoted.workers);const evidence={sourceCommit:sha,workers:{}};
 for(const[w]of targets){const s=await api(path(w)+'/settings'),before=settings[w];for(const binding of before.bindings){if(binding.name==='RELEASE_SOURCE_COMMIT')continue;const current=s.bindings.find(b=>b.name===binding.name);if(!current||JSON.stringify(current)!==JSON.stringify(binding))throw Error('An existing binding changed: '+w+' '+binding.name);}if(s.bindings.find(b=>b.name==='RELEASE_SOURCE_COMMIT')?.text!==sha)throw Error('Source provenance mismatch: '+w);
  const r=await fetch('https://api.cloudflare.com/client/v4'+path(w)+'/content',{headers:{Authorization:'Bearer '+token}});if(!r.ok)throw Error('Source verification unavailable: '+w);let source;if(r.headers.get('Content-Type')?.includes('multipart')){const form=await r.formData(),part=form.get('worker.mjs');if(!part)throw Error('Main module was not returned: '+w);source=Buffer.from(await part.arrayBuffer());}else source=Buffer.from(await r.arrayBuffer());if(hash(source)!==uploaded.workers[w].bundleSha256)throw Error('Serving source digest mismatch: '+w);evidence.workers[w]={...promoted.workers[w],sourceSha256:hash(source),preservedBindings:true};
 }
 const hq=await api('/accounts/'+account+'/workers/scripts/shift-hq/deployments'),old=(await read('shift-hq-deployments.json')).result.deployments[0];if(hq.deployments[0].id!==old.id)throw Error('HQ serving version changed unexpectedly');evidence.hqDeploymentPreserved=old.id;await fs.writeFile(join(root,'verification.json'),JSON.stringify(evidence,null,2));console.log(JSON.stringify(evidence));
}
if(action==='rollback'){
 const promoted=await read('promoted.json');await assertServing(promoted.workers);const domain=await fs.readFile(join(root,'domain.json'),'utf8').then(JSON.parse).catch(()=>null);
 if(domain?.hqAssetRouteCreated)await api('/zones/'+zone+'/workers/routes/'+domain.hqAssetRoute.id,'DELETE');if(domain?.domainCreated)await api('/accounts/'+account+'/workers/domains/'+domain.domain.id,'DELETE');
 for(const[w]of [...targets].reverse()){const d=await api(path(w)+'/deployments','POST',{strategy:'percentage',versions:baseline[w].versions,annotations:{'workers/message':'Owned SST Rx rollback; retain D1/R2 and original data'}});console.log(JSON.stringify({rolledBack:w,deployment:d.id,versions:d.versions}));}
}
