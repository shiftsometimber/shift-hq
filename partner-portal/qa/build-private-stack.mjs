// Build only. Does not provision, deploy, seed or use a production binding.
import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
import {QA_ACCESS} from './access-config.mjs';
const core=process.env.SSTRX_QA_CORE_ROOT;if(!core||!path.isAbsolute(core))throw Error('Explicit current Core source required');
const root=fileURLToPath(new URL('../../',import.meta.url)),output=path.join(root,'.partner-qa/hosted');await fs.mkdir(output,{recursive:true});
const assets=path.join(output,'assets');await fs.mkdir(path.join(assets,'hq'),{recursive:true});await fs.mkdir(path.join(assets,'member'),{recursive:true});
const hash=b=>createHash('sha256').update(b).digest('hex'),manifest={scope:'Private fictional TEST build; not deployment',builtAt:new Date().toISOString(),hosts:QA_ACCESS.hosts,files:{},bundles:{}};
const copy=async(source,destination,transform=x=>x)=>{const raw=await fs.readFile(source),bytes=Buffer.from(transform(raw.toString()));await fs.mkdir(path.dirname(destination),{recursive:true});await fs.writeFile(destination,bytes);manifest.files[path.relative(output,destination)]={sourceSha256:hash(raw),outputSha256:hash(bytes)};};
const allow=(await fs.readFile(path.join(root,'.assetsignore'),'utf8')).split('\n').filter(x=>x.startsWith('!')).map(x=>x.slice(1).trim());
for(const name of allow)await copy(path.join(root,name),path.join(assets,'hq',name),s=>s.replaceAll('https://api.shiftsometimber.co.uk','https://hq-qa.sstrx.co.uk').replaceAll('https://sstrx.shiftsometimber.co.uk','https://rx-qa.sstrx.co.uk').replaceAll('Shift HQ is securely signed in to live Shift Core.','Shift HQ is signed in to the isolated fictional TEST system.').replaceAll('Live HQ records','Fictional TEST HQ records'));
const loginSource=await fs.readFile(path.join(core,'frontend/member/my-timber-preview.html'),'utf8'),auth=loginSource.match(/<section class="preview-auth" id="previewAuth">[\s\S]*?<\/section>/)?.[0],scripts=[...loginSource.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/g)].map(m=>m[1]),authScript=scripts.find(x=>x.includes("const auth=document.getElementById('previewAuth')"));
if(!auth||!authScript||authScript.split("params.get('next')||''").length!==2)throw Error('Retained login template changed');
const styles=[...loginSource.matchAll(/<style\b[^>]*>[\s\S]*?<\/style>/g)].map(m=>m[0]).join('\n');
const login='<!doctype html><html lang="en-GB"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>My Timber · TEST sign in</title>'+styles+'</head><body><main class="preview-wrap">'+auth+'<section id="previewMember" hidden></section></main><script>window.SST_API_BASE=location.origin;</script><script src="/turnstile-auth-v1.js"></script><script src="/api-adapter-v33d.js"></script><script>'+authScript.replace("params.get('next')||''","params.get('next')||'/member/my-shift'")+'</script></body></html>';
await fs.writeFile(path.join(assets,'member/login.html'),login);manifest.files['assets/member/login.html']={sourceSha256:hash(loginSource),outputSha256:hash(login),source:'Existing native Core member login markup/client; TEST destination and approved private shell only'};
for(const file of ['api-adapter-v33d.js','turnstile-auth-v1.js'])await copy(path.join(core,'frontend/member',file),path.join(assets,'member',file));
for(const file of ['test-purchase.html','test-checkout.html','qa-purchase.js'])await copy(fileURLToPath(new URL('./'+file,import.meta.url)),path.join(assets,'member',file));
const generated=(await fs.readFile(new URL('./stack-core.template.mjs',import.meta.url),'utf8')).replaceAll('__CORE_ROOT__',core).replaceAll('__QA_ROOT__',fileURLToPath(new URL('./',import.meta.url)).replace(/\/$/,''));await fs.writeFile(path.join(output,'core-entry.mjs'),generated);
for(const [name,entry]of [['core',path.join(output,'core-entry.mjs')],['clinical',new URL('./stack-clinical-entry.mjs',import.meta.url).pathname],['edge',new URL('./stack-edge.mjs',import.meta.url).pathname]]){
 const bundle=path.join(output,name+'.bundle.mjs');const result=await build({entryPoints:[entry],bundle:true,format:'esm',platform:'browser',target:'es2022',outfile:bundle,metafile:true,...(name==='core'?{inject:[fileURLToPath(new URL('./simulated-fetch.mjs',import.meta.url))]}:{})});const bytes=await fs.readFile(bundle);manifest.bundles[name]={sha256:hash(bytes),bytes:bytes.length,inputs:{}};
 for(const input of Object.keys(result.metafile.inputs)){const absolute=path.resolve(input);manifest.bundles[name].inputs[input]=hash(await fs.readFile(absolute));}
}
await fs.writeFile(path.join(output,'build-manifest.json'),JSON.stringify(manifest,null,2));console.log(JSON.stringify({built:output,bundles:Object.fromEntries(Object.entries(manifest.bundles).map(([n,v])=>[n,{sha256:v.sha256,bytes:v.bytes}])),staticFiles:Object.keys(manifest.files).length,deployExecuted:false}));
