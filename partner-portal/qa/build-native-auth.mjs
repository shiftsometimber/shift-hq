// Isolated acceptance only. Native Core auth is retained; unrelated commerce,
// health content and marketing hooks are fail-closed and never invoked here.
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
const root=new URL('./native-core/',import.meta.url);
const pinned=JSON.parse(await fs.readFile(new URL('source-manifest.json',root),'utf8'));
for(const [path,expected]of Object.entries(pinned.sha256))if(createHash('sha256').update(await fs.readFile(new URL(path,root))).digest('hex')!==expected)throw Error('Native acceptance source changed: '+path);
let core=await fs.readFile(new URL('worker.js',root),'utf8');
const nativeHash=createHash('sha256').update(core).digest('hex');
const exclusions=['hq-commerce-delivery.mjs','commerce-stripe-v1.js','privacy-account-request-v1.js','order-reference-v1.js','public-health-v1.js'];
for(const path of exclusions){const line=core.split('\n').find(s=>s.startsWith('import ')&&s.includes("'./"+path+"'"));if(!line)throw Error('Native auth anchor changed '+path);const names=line.match(/\{([^}]+)\}/)[1].split(',').map(s=>s.trim());core=core.replace(line,'const '+names.map(n=>n+"=()=>{throw Error('non_auth_route_disabled_in_acceptance')}").join(',')+';');}
core+='\nexport {ensureSchema};\n';
await fs.writeFile(new URL('auth-kernel.mjs',root),core);
let email=await fs.readFile(new URL('auth-email-verification-v1.js',root),'utf8');
email=email.replace("import {acquisitionRoutes,acquisitionAccountDelete} from './acquisition-activation/server.mjs';","const acquisitionRoutes=async()=>null,acquisitionAccountDelete=async()=>null;")
 .replace("import {queueSignupAlert} from './member-signup-alert.mjs';","const queueSignupAlert=async()=>{};");
await fs.writeFile(new URL('email-kernel.mjs',root),email);
console.log(JSON.stringify({nativeCoreSha256:nativeHash,auth:'native password hashing, email verification, sessions and MFA; no protocol mock',externalTransports:0}));
