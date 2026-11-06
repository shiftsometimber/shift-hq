// API acceptance only. An explicit current Core checkout replaces the historic
// vendored acceptance source; it never changes a Worker binding or live account.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {createHash} from 'node:crypto';
const configured=process.env.SSTRX_QA_CORE_ROOT;
if(configured&&!path.isAbsolute(configured))throw Error('An absolute Core checkout is required');
const root=configured?await fs.realpath(configured):new URL('./native-core/',import.meta.url).pathname;
const load=name=>import(pathToFileURL(path.join(root,name)));
const auth=await load(configured?'worker.js':'auth-kernel.mjs');
const email=await load(configured?'auth-email-verification-v1.js':'email-kernel.mjs');
const register=await load('member-register-fastpath-v2.js');
const commerce=await load('medicine-commerce-v1.js');
const files=['worker.js','auth-email-verification-v1.js','member-register-fastpath-v2.js','medicine-commerce-v1.js','hq-purchaseability-v1.js'];
if(configured)files.push('hq-catalogue-governance-v31.mjs','hq-v3-api.mjs');
export const coreSource={mode:configured?'explicit_current_checkout':'historic_vendored_acceptance',sha256:Object.fromEntries(await Promise.all(files.map(async name=>[name,createHash('sha256').update(await fs.readFile(path.join(root,name))).digest('hex')])))};
export const core=auth.default,handleEmailVerification=email.handleEmailVerification,fastMemberRegister=register.fastMemberRegister,medicineCommerceRoutes=commerce.medicineCommerceRoutes;
export const bootstrapSQL=await fs.readFile(path.join(root,'preview/bootstrap.sql'),'utf8');
export async function ensureCoreSchema(DB,env){
 if(!configured)return auth.ensureSchema(DB);
 // The retained Worker initialises its own schema before rejecting this fixed
 // nonexistent route. No private export, auth stub or production request.
 const r=await core.fetch(new Request('https://fictional.example/v1/qa-schema-only'),env,{waitUntil(p){p.catch(()=>{})}});
 if(r.status!==404)throw Error('Current Core schema prerequisite failed: '+r.status);
}
export const currentCoreRoot=configured?root:null;
