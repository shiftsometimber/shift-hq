// Local QA only: use the captured deployed frontend, never a real member record.
import fs from 'node:fs/promises';
import worker from './worker.mjs';
const snapshot=JSON.parse(await fs.readFile(new URL('../.partner-qa/upstream-frontends.json',import.meta.url)));
const directory=new URL('../.partner-qa/preview/',import.meta.url);
const env={PARTNER_ACCESS_ENABLED:'false',CLINICAL:{async fetch(request){const path=new URL(request.url).pathname;const entry=snapshot.assets[path]||snapshot.pages[path]||(path==='/clinical-portal'?{body:snapshot.shell,type:'text/html'}:null);return entry?new Response(entry.body,{headers:{'Content-Type':entry.type}}):new Response('Not found',{status:404});}}};
for(const path of ['/','/demo','/demo/clinical','/demo/dispensing','/assets/partner-v1.css','/assets/partner-v1.js',...Object.keys(snapshot.assets).filter(x=>!/(commissioning|notifications|finance)-client/.test(x))]){
 const response=await worker.fetch(new Request('https://partner.shiftsometimber.co.uk'+path),env);if(!response.ok)throw Error(path+': '+response.status);
 const target=new URL('.'+path+(path.endsWith('/')?'index.html':path.includes('.')?'':'/index.html'),directory);
 await fs.mkdir(new URL('.',target),{recursive:true});await fs.writeFile(target,await response.text());
}
await fs.mkdir(new URL('../.openai/',import.meta.url),{recursive:true});
await fs.writeFile(new URL('../.openai/hosting.json',import.meta.url),JSON.stringify({static:{directory:'.partner-qa/preview'}}));
console.log('Fictional partner preview ready.');
