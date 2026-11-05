import fs from 'node:fs/promises';
import {createHash} from 'node:crypto';
export async function buildKernel(){
 const file=new URL('./vendor/clinical-portal-20261024.mjs',import.meta.url),original=await fs.readFile(file,'utf8');
 if(createHash('sha256').update(original).digest('hex')!=='b7bd886a5357222af1717f053959d608094dd32f07c072440166bf4998f5d3c5')throw Error('Clinical baseline changed; reconcile before building.');
 let source="import {hasOpenSupplyHold,requireNoSupplyHold} from '../platform/supply-holds.mjs';\nimport {signingOrigin,rememberSigningOrigin,challengeOrigin,paidClinicalOrder} from '../platform/signing.mjs';\nimport {deliveryFromAssessment,requireDelivery} from './fulfilment-delivery.mjs';\n"+original;
 const once=(before,after)=>{if(source.split(before).length!==2)throw Error('Clinical adaptation anchor changed: '+before.slice(0,80));source=source.replace(before,after);};
 once('async function internalPrescriptionCurrent(env, order) {','async function internalPrescriptionCurrent(env, order) {\n  if(await hasOpenSupplyHold(env,order.orderNumber))return false;');
 once('const b = await readJson(request), current =','const b = await readJson(request); if(["accept","prepare","dispatch"].includes(b.action))await requireNoSupplyHold(env,f.orderNumber); const current =');
 once('var RP_ID = "hq.shiftsometimber.co.uk";','var RP_ID = "partner.shiftsometimber.co.uk";');
 once('var RP_ORIGIN = "https://hq.shiftsometimber.co.uk";','var RP_ORIGIN = "https://partner.shiftsometimber.co.uk";');
 // Match the real catalogue CHECK constraints; no out-of-stock/archived item is admitted.
 once('!["active", "published"].includes(variant.status)','!["available", "active", "published"].includes(variant.status)');
 once("v.status IN ('active','published')","v.status IN ('available','active','published')");
 once("v.status='active' AND v.sellable=1","v.status IN ('available','active') AND v.sellable=1");
 once('quantity: text(input.quantity, 300)','quantity: text(input.quantity, 200)');
 once('directions: text(input.directions, 2e3)','directions: text(input.directions, 1e3)');
 once('return { link: ORIGIN + "/clinical-portal/partners/" + kind + "#" + raw, expiresAt, sent: false };','return { link: "https://partner.shiftsometimber.co.uk/" + (kind === "activation" ? "activate" : "apply") + "#" + raw, expiresAt, sent: false };');
 once('const answers = JSON.parse(assessment.answers_json);','const answers = JSON.parse(assessment.answers_json); validateSSTPatient(answers);');
 once('if (b.outcome === "proceed") {','if (b.outcome === "proceed") { validateSSTPatient(JSON.parse(assessment.answers_json));');
 once('packs: s.treatment.packs, patient: s.patient, directions: s.treatment.directions','packs: s.treatment.packs, patient: s.patient, delivery: deliveryFromAssessment(JSON.parse(current.context.assessment.answers_json)), directions: s.treatment.directions');
 once('if (b.action === "dispatch") {','if (b.action === "dispatch") { requireDelivery(s.delivery);');
 const deliveryDisplay="['Delivery',o.delivery?.address]";
 if(source.split(deliveryDisplay).length!==3)throw Error('Clinical delivery display anchors changed');
 source=source.replaceAll(deliveryDisplay,"['Delivery',[o.delivery?.address,o.delivery?.postcode].filter(Boolean).join(' ')]");
 source+=`\nfunction validateSSTPatient(answers){const value=answers.dateOfBirth,date=new Date(value+'T00:00:00Z'),today=new Date();if(typeof value!=='string'||!/^\\d{4}-\\d{2}-\\d{2}$/.test(value)||!Number.isFinite(date.getTime())||date.toISOString().slice(0,10)!==value)fail(422,'valid_date_of_birth_required');let age=today.getUTCFullYear()-date.getUTCFullYear();if(today.getUTCMonth()<date.getUTCMonth()||today.getUTCMonth()===date.getUTCMonth()&&today.getUTCDate()<date.getUTCDate())age--;if(age<18||age>120)fail(422,'adult_service_required');if(answers.insulinUse===true||String(answers.insulinUse||'').toLowerCase()==='yes')fail(422,'insulin_service_excluded');}\n`;
 once('function clientData(input, type, challenge) {','function clientData(input, type, challenge, origin = RP_ORIGIN) {');
 once('d.origin !== RP_ORIGIN','d.origin !== origin');once('d.topOrigin !== RP_ORIGIN','d.topOrigin !== origin');
 once('async function authenticator(bytes, registration) {','async function authenticator(bytes, registration, rpId = RP_ID) {');
 once('new TextEncoder().encode(RP_ID)','new TextEncoder().encode(rpId)');
 once('const client = clientData(proof.clientDataJSON, "webauthn.get", challenge), auth = unb64(proof.authenticatorData, 6e3), { flags, counter } = await authenticator(auth, false);',`let origin = RP_ORIGIN;
  if(historical){try{origin=JSON.parse(new TextDecoder().decode(unb64(proof.clientDataJSON,6e3))).origin;}catch{fail(422,"invalid_signing_client_data");}if(!["https://partner.shiftsometimber.co.uk","https://hq.shiftsometimber.co.uk"].includes(origin))fail(403,"signing_origin_or_challenge_mismatch");}
  const client = clientData(proof.clientDataJSON, "webauthn.get", challenge,origin), auth = unb64(proof.authenticatorData, 6e3), { flags, counter } = await authenticator(auth, false,new URL(origin).hostname);`);
 // Bind newly created WebAuthn challenges to their actual browser origin.
 once('async function newChallenge(env, context, kind, key = null, document = null) {','async function newChallenge(env, context, kind, key = null, document = null, portalOrigin = RP_ORIGIN) {\n  if(kind===\'sign\')await requireNoSupplyHold(env,context.record.order_number);');
 once('return { id, challenge, expiresAt: expires, rpId: RP_ID,','await rememberSigningOrigin(env.DB,id,portalOrigin);\n  return { id, challenge, expiresAt: expires, rpId: new URL(portalOrigin).hostname,');
 once('await newChallenge(env, context, "register")','await newChallenge(env, context, "register",null,null,signingOrigin(request))');
 once('await newChallenge(env, context, "sign", key, doc)','await newChallenge(env, context, "sign", key, doc,signingOrigin(request))');
 once('async function verifyRegistration(proof, challenge) {','async function verifyRegistration(proof, challenge, portalOrigin = RP_ORIGIN) {');
 once('clientData(proof.clientDataJSON, "webauthn.create", challenge);','clientData(proof.clientDataJSON, "webauthn.create", challenge,portalOrigin);');
 once('await authenticator(bytes, true)','await authenticator(bytes, true,new URL(portalOrigin).hostname)');
 once('await verifyRegistration(b.proof, c.challenge)','await verifyRegistration(b.proof, c.challenge,await challengeOrigin(env.DB,c.id,signingOrigin(request)))');
 once('{ historical = false } = {}) {','{ historical = false, portalOrigin = RP_ORIGIN } = {}) {');
 once('let origin = RP_ORIGIN;','let origin = portalOrigin;');
 once('await verifyAssertion(b.proof, c.challenge, key, actor2.id)','await verifyAssertion(b.proof, c.challenge, key, actor2.id,{portalOrigin:await challengeOrigin(env.DB,c.id,signingOrigin(request))})');
 once('if(!["https://partner.shiftsometimber.co.uk","https://hq.shiftsometimber.co.uk"].includes(origin))','if(!["https://partner.shiftsometimber.co.uk","https://hq.shiftsometimber.co.uk","https://sstrx.shiftsometimber.co.uk"].includes(origin))');
 once('const paid = ["paid", "succeeded", "completed", "fulfilled"].includes(order.status) && /^cs_live_/.test(order.stripe_checkout_session_id || "");','const paid = paidClinicalOrder(env,order);');
 source+='\nexport {internalPrescriptionDocument,internalPrescriptionCurrent,prescriptionHqRoute, partnerRoute, hqClinicalRoute, commissioningRoute, notificationManagementRoute, internalDispensingAdapters, credentialsCurrent, currentPartner, permission, authCondition, caseView, caseAction, memberPrescription, memberFulfilment, memberView, memberTracking, verifyRegistration, verifyAssertion, careFields, careChecks, CARE_HANDOVER_VERSION};\n';
 await fs.writeFile(new URL('./clinical-kernel.mjs',import.meta.url),source);
 return {baseline:'f65e4594-fd83-49d4-b20d-f43fcee88e1c',sha256:createHash('sha256').update(source).digest('hex')};
}
if(process.argv[1]&&new URL(import.meta.url).pathname===process.argv[1])console.log(JSON.stringify(await buildKernel()));
