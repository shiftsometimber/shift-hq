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
 source="import {informationStatements} from '../platform/functional-casework.mjs';\nimport {paidClinicalOrder} from '../platform/signing.mjs';\n"+source;
 const information='  statements.push(...notificationEventStatements(env, record, { id, kind, source: "case", sourceId: id, at: date }));';
 if(source.split(information).length!==2)throw Error('Member information transaction anchor changed');
 source=source.replace(information,'  statements.push(...await informationStatements(env,record,actor,reviewer,b,id,kind,assessment,date));\n'+information);
 const anchor='const paid = ["paid", "succeeded", "completed", "fulfilled"].includes(order.status) && /^cs_live_/.test(order.stripe_checkout_session_id || "");';
 if(source.split(anchor).length!==2)throw Error('Member payment gate changed');source=source.replace(anchor,'const paid = paidClinicalOrder(env,order);');
 source+='\nexport {authenticate,sessionHash,memberPrescription,memberFulfilment,memberView,memberTracking};\n';
 await fs.writeFile(new URL('./member-kernel.mjs',import.meta.url),source);
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])await buildMemberKernel();
