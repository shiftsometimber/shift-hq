import {qaDatabaseAdmitted} from '../qa/database-boundary.mjs';
import {ensurePlatformSchema} from './schema.mjs';
import {fail} from './domain.mjs';
import {QA_RX_ORIGIN} from '../qa/access-config.mjs';
const LEGACY='https://partner.shiftsometimber.co.uk';
export function signingOrigin(request,env={}){const origin=request.headers.get('X-Shift-Portal-Origin')||LEGACY;if(![LEGACY,'https://sstrx.shiftsometimber.co.uk'].includes(origin)&&!(env.SSTRX_ENVIRONMENT==='synthetic'&&origin===QA_RX_ORIGIN))fail(403,'signing_origin_not_allowed');return origin;}
export async function rememberSigningOrigin(DB,id,origin){await ensurePlatformSchema(DB);await DB.prepare('INSERT INTO rx_signing_origins VALUES(?,?)').bind(id,origin).run();}
export async function challengeOrigin(DB,id,requested){await ensurePlatformSchema(DB);const value=await DB.prepare('SELECT origin FROM rx_signing_origins WHERE challenge_id=?').bind(id).first();const origin=value?.origin||LEGACY;if(origin!==requested)fail(403,'signing_origin_or_challenge_mismatch');return origin;}
// Test signatures cannot be enabled by setting Stripe test mode on production.
export function paidClinicalOrder(env,order){return ['paid','succeeded','completed','fulfilled'].includes(order.status)&&(/^cs_live_/.test(order.stripe_checkout_session_id||'')||env.SSTRX_ENVIRONMENT==='synthetic'&&env.STRIPE_MODE==='test'&&env.SSTRX_TEST_SIGNING==='true'&&/^cs_test_/.test(order.stripe_checkout_session_id||''));}

// A historical QA signature is valid only in its marked isolated environment
// and against the server's consumed challenge, signer, key and clinical record.
export async function historicalSigningOrigin(env,storedProof,key,document){
 let origin;try{const raw=storedProof.proof.clientDataJSON.replaceAll('-','+').replaceAll('_','/');origin=JSON.parse(atob(raw.padEnd(Math.ceil(raw.length/4)*4,'='))).origin;}catch{fail(422,'invalid_signing_client_data');}
 if(origin!==QA_RX_ORIGIN)return null;
 if(!await qaDatabaseAdmitted(env))fail(403,'signing_origin_or_challenge_mismatch');
 const binding=await env.DB.prepare("SELECT o.origin FROM rx_signing_origins o JOIN clinical_prescription_challenges c ON c.id=o.challenge_id WHERE c.challenge=? AND c.kind='sign' AND c.key_id=? AND c.record_id=? AND c.hq_user_id=? AND c.used_at IS NOT NULL").bind(storedProof.challenge,key.id,document.recordId,document.prescriber.id).first();
 if(!binding||binding.origin!==origin||key.hq_user_id!==document.prescriber.id)fail(403,'signing_origin_or_challenge_mismatch');return origin;
}
