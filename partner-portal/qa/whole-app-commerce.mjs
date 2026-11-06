// Only the native basket READ is admitted into the isolated whole-app audit.
// It uses the existing fictional SQLite sessions; no processor/network binding.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
export async function currentBasketRead(root){
 if(!path.isAbsolute(root))throw Error('Absolute current Core checkout required');
 if(execFileSync('git',['status','--porcelain','--untracked-files=no'],{cwd:root,encoding:'utf8'}).trim())throw Error('Current Core source must be clean');
 const file=path.join(root,'medicine-commerce-v1.js'),{medicineCommerceRoutes}=await import(pathToFileURL(file));
 const source={commit:execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim(),route:'medicine-commerce-v1.js',routeSha256:createHash('sha256').update(await fs.readFile(file)).digest('hex'),scope:'Actual native basket read on synthetic local SQLite; not hosted/processor acceptance'};
 const accepts=(input,method)=>{const u=new URL(input);return u.origin==='https://api.shiftsometimber.co.uk'&&u.pathname==='/v1/commerce/active-checkout'&&!u.search&&method==='GET';};
 return {source,accepts,async fetch(request,env){
  if(!accepts(request.url,request.method)||!['https://shiftsometimber.co.uk','https://api.shiftsometimber.co.uk'].includes(request.headers.get('Origin')))return Response.json({error:'isolated_basket_route_denied'},{status:403});
  return medicineCommerceRoutes(request,env,{waitUntil(p){p.catch(()=>{});}});
 }};
}
