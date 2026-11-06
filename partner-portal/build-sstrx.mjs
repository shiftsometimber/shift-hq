import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {build} from 'esbuild';
const logo=await fs.readFile(new URL('./assets/sstrx-logo.png',import.meta.url));
await fs.writeFile(new URL('./assets/logo-data.mjs',import.meta.url),'// Generated from the exact supplied logo.\nexport const SST_LOGO_BASE64='+JSON.stringify(logo.toString('base64'))+';\n');
console.log(JSON.stringify({logoSha256:createHash('sha256').update(logo).digest('hex'),source:'IMG_0134.png',bytes:logo.length}));
const desk=await fs.readFile(new URL('../hq-partner-desk.js',import.meta.url),'utf8');
await fs.writeFile(new URL('./assets/hq-desk-data.mjs',import.meta.url),'// Generated from the existing HQ browser module only.\nexport const HQ_PARTNER_DESK_SOURCE='+JSON.stringify(desk)+';\n');
for(const [source,name]of [['gateway-entry.mjs','sstrx'],['service/clinical-service.mjs','clinical'],['service/member-service.mjs','member'],['qa/rx-private-entry.mjs','rx-private']])await build({entryPoints:[new URL(source,import.meta.url).pathname],bundle:true,format:'esm',target:'es2022',outfile:new URL('../.partner-qa/'+name+'.bundle.mjs',import.meta.url).pathname});
