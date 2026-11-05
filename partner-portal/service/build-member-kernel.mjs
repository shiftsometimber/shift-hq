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
 source="import {lifecycleProposalContext,lifecycleSourceGuard} from '../platform/prescription-lifecycle.mjs';\nimport {informationStatements,assessmentCommandProof} from '../platform/functional-casework.mjs';\nimport {paidClinicalOrder} from '../platform/signing.mjs';\n"+source;
 const information='  statements.push(...notificationEventStatements(env, record, { id, kind, source: "case", sourceId: id, at: date }));';
 if(source.split(information).length!==2)throw Error('Member information transaction anchor changed');
 source=source.replace(information,'  statements.push(...await informationStatements(env,record,actor,reviewer,b,id,kind,assessment,date));\n'+information);
 const assessmentAnchor='      const writes = [env.DB.prepare("INSERT INTO clinical_member_versions SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM clinical_member_records WHERE id=? AND revision=?)").bind(id, version, schema.version, JSON.stringify(answers), JSON.stringify(files), JSON.stringify(declarations), digest2, submitted ? 1 : 0, now5, id, b.revision), env.DB.prepare("UPDATE clinical_member_records SET revision=?,status=?,review_sharing=?,updated_at=? WHERE id=? AND revision=?").bind(version, submitted ? "awaiting_review" : "draft", submitted ? 1 : 0, now5, id, b.revision)];';
 if(source.split(assessmentAnchor).length!==2)throw Error('Native assessment transaction anchor changed');
 source=source.replace(assessmentAnchor,`      const command=await assessmentCommandProof(env,request,record,actor,{...b,sstInformationCommand:b.sstInformationCommand?{...b.sstInformationCommand,assessmentCreatedAt:now5}:null});
      const writes = [env.DB.prepare("INSERT INTO clinical_member_versions SELECT ?,?,?,?,?,?,?,?,? WHERE EXISTS(SELECT 1 FROM clinical_member_records WHERE id=? AND revision=?) AND "+command.sql).bind(id,version,schema.version,JSON.stringify(answers),JSON.stringify(files),JSON.stringify(declarations),digest2,submitted?1:0,now5,id,b.revision,...command.args),env.DB.prepare("UPDATE clinical_member_records SET revision=?,status=?,review_sharing=?,updated_at=? WHERE id=? AND revision=? AND EXISTS(SELECT 1 FROM clinical_member_versions WHERE record_id=? AND version=? AND created_at=?)").bind(version,submitted?"awaiting_review":"draft",submitted?1:0,now5,id,b.revision,id,version,now5),...command.statements];`);
 const lifecycleAnchor='  sql += " AND NOT EXISTS(SELECT 1 FROM partner_fulfilment WHERE order_number=?)";\n  args.push(record.order_number);';
 if(source.split(lifecycleAnchor).length!==2)throw Error('Member lifecycle source guard anchor changed');
 source=source.replace(lifecycleAnchor,'  const lifecycle=lifecycleSourceGuard(context);sql+=" AND "+lifecycle.sql;args.push(...lifecycle.args);');
 const contextAnchor='  const context = { record, assessment, state, order };';
 if(source.split(contextAnchor).length!==2)throw Error('Member lifecycle context anchor changed');
 source=source.replace(contextAnchor,'  const context = { record, assessment, state, order,lifecycle:await lifecycleProposalContext(env,record,state),platformEnabled:env.SSTRX_PLATFORM_ENABLED===\'true\' };');
 const anchor='const paid = ["paid", "succeeded", "completed", "fulfilled"].includes(order.status) && /^cs_live_/.test(order.stripe_checkout_session_id || "");';
 if(source.split(anchor).length!==2)throw Error('Member payment gate changed');source=source.replace(anchor,'const paid = paidClinicalOrder(env,order);');
 source+='\nexport {authenticate,sessionHash,memberPrescription,memberFulfilment,memberView,memberTracking};\n';
 await fs.writeFile(new URL('./member-kernel.mjs',import.meta.url),source);
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])await buildMemberKernel();
