import {brotliDecompressSync} from 'node:zlib';
import {buildNativeCacheClient,patchProgrammeCacheRecovery} from '../platform/native-cache-recovery.mjs';
import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function buildMemberKernel(){
 let source=await fs.readFile(new URL('./vendor/member-records-20261024.mjs',import.meta.url),'utf8');
 if(createHash('sha256').update(source).digest('hex')!=='8063d484b353ee59d2eaeb8606fe3d601009edfb2bca643dd25a15df652955d4')throw Error('Member clinical baseline changed');
 const origins='new Set(["https://shiftsometimber.co.uk", "https://www.shiftsometimber.co.uk"])';
 if(source.split(origins).length!==2)throw Error('Member origin boundary changed');
 source=source.replace(origins,'new Set(["https://shiftsometimber.co.uk", "https://www.shiftsometimber.co.uk", "https://my-timber.app"])');
 // The member acceptance guard must read the same catalogue states as the prescriber.
 source=source.replaceAll('!["active", "published"].includes(variant.status)','!["available", "active", "published"].includes(variant.status)').replaceAll("v.status IN ('active','published')","v.status IN ('available','active','published')");
 source="import {paidClinicalOrder} from '../platform/signing.mjs';\n"+source;
 const anchor='const paid = ["paid", "succeeded", "completed", "fulfilled"].includes(order.status) && /^cs_live_/.test(order.stripe_checkout_session_id || "");';
 if(source.split(anchor).length!==2)throw Error('Member payment gate changed');source=source.replace(anchor,'const paid = paidClinicalOrder(env,order);');
 source+='\nexport {authenticate,sessionHash,memberPrescription,memberFulfilment,memberView,memberTracking};\n';
 await fs.writeFile(new URL('./member-kernel.mjs',import.meta.url),source);
 const nativeInput=await fs.readFile(new URL('../test/fixtures/native-cache-v268.js',import.meta.url),'utf8'),native=buildNativeCacheClient(nativeInput);
 const nativeDirectory=new URL('../../.partner-qa/',import.meta.url);await fs.mkdir(nativeDirectory,{recursive:true});
 await fs.writeFile(new URL('native-cache.bundle.mjs',nativeDirectory),native.source);
 const snapshotManifest=JSON.parse(await fs.readFile(new URL('../test/fixtures/native-programme-snapshot.json',import.meta.url),'utf8'));
 const programmeSource=brotliDecompressSync(await fs.readFile(new URL('../test/fixtures/native-programme.snapshot.br',import.meta.url))).toString();
 if(createHash('sha256').update(programmeSource).digest('hex')!==snapshotManifest.sourceSha256)throw Error('Qualified native programme snapshot changed');
 const programme=patchProgrammeCacheRecovery(programmeSource),{source:programmeCode,...metadata}=programme;
 if(metadata.outputNativeSha!==native.outputNativeSha)throw Error('Native client and complete programme build differ');
 await fs.writeFile(new URL('native-programme.bundle.mjs',nativeDirectory),programmeCode);
 await fs.writeFile(new URL('native-programme-build.json',nativeDirectory),JSON.stringify(metadata,null,2));


}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])await buildMemberKernel();
