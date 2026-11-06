// Configuration preparation only. Reuse exact qualified/deployed resources,
// grants and auth bindings; never regenerate or deploy them in this command.
import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {withQaSiteContentState,failClosedQaSiteContentState} from './site-content-state-binding.mjs';
const [input,qualificationPath,deploymentPath,output]=process.argv.slice(2);
if(![input,qualificationPath,deploymentPath,output].every(x=>x&&path.isAbsolute(x)))throw Error('Absolute qualified-config, qualification-receipt, deployment-receipt and output paths required');
if(path.resolve(input)===path.resolve(output))throw Error('Prepared configuration must not overwrite qualified input');
const hash=x=>createHash('sha256').update(x).digest('hex'),qualificationBytes=await fs.readFile(qualificationPath),deploymentBytes=await fs.readFile(deploymentPath),qualification=JSON.parse(qualificationBytes),deployment=JSON.parse(deploymentBytes);
if(qualification.state!=='PASS_LOCAL_FINAL_MODULES'||deployment.state!=='DEPLOYED_PRIVATE_QA_EXACT_VERSIONS_VERIFIED'||qualification.sourceCommit!==deployment.sourceCommit||qualification.coreCommit!==deployment.coreCommit)throw Error('Same exact qualified and deployed source receipts required');
const bytes=Object.fromEntries(await Promise.all(['core','clinical','edge'].map(async name=>[name,await fs.readFile(path.join(input,name+'.json'))]))),before=Object.fromEntries(Object.entries(bytes).map(([name,value])=>[name,JSON.parse(value)]));
for(const name of Object.keys(bytes))if(hash(bytes[name])!==qualification.configHashes?.[name]||hash(bytes[name])!==deployment.configHashes?.[name])throw Error('Qualified and deployed configuration bytes differ: '+name);
const core=withQaSiteContentState(before.core),withoutState=value=>{const copy=structuredClone(value);delete copy.durable_objects;delete copy.migrations;return copy;};
if(!isDeepStrictEqual(withoutState(core),withoutState(before.core)))throw Error('Unrelated Core configuration changed');
const prepared={core:Buffer.from(JSON.stringify(core,null,2)+'\n'),clinical:bytes.clinical,edge:bytes.edge};
await fs.mkdir(output,{recursive:true});
for(const name of Object.keys(prepared))await fs.writeFile(path.join(output,name+'.json'),prepared[name],{flag:'wx'});
const fallbackBytes=Buffer.from(JSON.stringify(failClosedQaSiteContentState(core),null,2)+'\n');await fs.writeFile(path.join(output,'core.fail-closed.json'),fallbackBytes,{flag:'wx'});
const manifest={state:'CONFIG_ONLY_NOT_QUALIFIED',sourceCommit:qualification.sourceCommit,coreCommit:qualification.coreCommit,inputConfigDirectory:input,inputQualificationSha256:hash(qualificationBytes),inputDeploymentSha256:hash(deploymentBytes),inputConfigHashes:Object.fromEntries(Object.entries(bytes).map(([k,v])=>[k,hash(v)])),preparedConfigHashes:Object.fromEntries(Object.entries(prepared).map(([k,v])=>[k,hash(v)])),fallbackConfigHash:hash(fallbackBytes),fallbackAfterMigrationOnly:true,fallbackChanges:['durable_objects.bindings'],fallbackRetainsClassAndMigrationHistory:true,coreChanges:['durable_objects','migrations'],allOtherCoreFieldsPreserved:true,clinicalAndEdgeBytesPreserved:true,namespaceOwner:core.name,className:'SiteContentState',crossWorkerReference:false,bundlesPrepared:false,authMaterialChanged:false,deployed:false};
await fs.writeFile(path.join(output,'site-content-state-config-manifest.json'),JSON.stringify(manifest,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({state:manifest.state,output,namespaceOwner:core.name,coreChanges:manifest.coreChanges,clinicalAndEdgeBytesPreserved:true,authMaterialChanged:false,deployed:false}));
