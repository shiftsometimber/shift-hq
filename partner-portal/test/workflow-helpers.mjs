import assert from 'node:assert/strict';
import {RECORD} from './fixture.mjs';
import {authenticator} from './authenticator.mjs';
const json=async(response,status=200)=>{const t=await response.text();assert.equal(response.status,status,t);return JSON.parse(t);};
export async function reviewAndPropose(f){
 await json(await f.hq('/partner-desk/assign',1,{recordId:RECORD,staffUserId:3,active:true}));
 const cookie=await f.login('CLNTEST');
 await json(await f.partner('/'+RECORD+'/action',cookie,{version:0,assessmentVersion:1,action:'start_review'}));
 await json(await f.partner('/'+RECORD+'/action',cookie,{version:1,assessmentVersion:1,action:'review_evidence',evidenceId:'front-photo-fixture',outcome:'approve'}));
 await json(await f.partner('/'+RECORD+'/action',cookie,{version:2,assessmentVersion:1,action:'decision',outcome:'proceed',identityVerified:true,independentMeasurementsVerified:true,verification:'Fictional checks, no patient or legal clinical decision',handover:{...f.handover,medicine:'Synthetic medicine'},rationale:'Fictional sandbox decision only',message:'Fictional review complete'}));
 assert.equal(f.order().clinical_status,'approved');
 const proposal=await json(await f.partner('/prescriptions/'+RECORD+'/proposal',cookie,{version:0,partnerId:'pharmacy-org',expiresAt:new Date(Date.now()+86400000).toISOString(),reason:'Fictional proposed treatment',clinicalRationale:'Fictional test only',treatment:{variantId:11,packs:1,quantity:'One fictional pack',dose:'Fictional dose',route:'Oral test formulation',directions:'Fictional directions. Not for clinical use.'}}));
 return {cookie,proposal:proposal.prescription};
}
export async function issue(f,cookie,proposal){
 await json(await f.member('/prescription/decision',{version:proposal.version,action:'accept',agreed:true}));
 const key=await authenticator(),registration=await json(await f.partner('/prescriptions/'+RECORD+'/keys/challenge',cookie,{}));
 assert.equal(registration.rpId,'partner.shiftsometimber.co.uk');
 const created=await json(await f.partner('/prescriptions/'+RECORD+'/keys/register',cookie,{challengeId:registration.id,proof:await key.register(registration.challenge)}));
 await json(await f.hq('/prescriptions/keys/'+created.keyId+'/approve',2,{version:0,expiresAt:new Date(Date.now()+86400000).toISOString(),verificationReference:'Fictional independent key review only'}));
 const challenge=await json(await f.partner('/prescriptions/'+RECORD+'/signing-challenge',cookie,{version:proposal.version+1,keyId:created.keyId}));
 const proof=await key.sign(challenge.challenge);
 const response=await f.partner('/prescriptions/'+RECORD+'/sign',cookie,{version:proposal.version+1,challengeId:challenge.id,document:challenge.document,proof});const signed=await json(response);
 assert.equal(signed.pharmacyTaskCreated,true);return {key,challenge,signed,sync:response.headers.get('X-Shift-Shared-Order-Sync')};
}

