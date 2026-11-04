import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function buildMemberKernel(){
 let source=await fs.readFile(new URL('./vendor/member-records-20261024.mjs',import.meta.url),'utf8');
 if(createHash('sha256').update(source).digest('hex')!=='8063d484b353ee59d2eaeb8606fe3d601009edfb2bca643dd25a15df652955d4')throw Error('Member clinical baseline changed');
 // The member acceptance guard must read the same catalogue states as the prescriber.
 source=source.replaceAll('!["active", "published"].includes(variant.status)','!["available", "active", "published"].includes(variant.status)').replaceAll("v.status IN ('active','published')","v.status IN ('available','active','published')");
 await fs.writeFile(new URL('./member-kernel.mjs',import.meta.url),source);
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])await buildMemberKernel();
