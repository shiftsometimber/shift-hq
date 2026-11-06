import {ensurePlatformSchema} from './schema.mjs';
import {fail} from './domain.mjs';
import {QA_RX_ORIGIN} from '../qa/access-config.mjs';
const LEGACY='https://partner.shiftsometimber.co.uk';
export function signingOrigin(request,env={}){const origin=request.headers.get('X-Shift-Portal-Origin')||LEGACY;if(![LEGACY,'https://sstrx.shiftsometimber.co.uk'].includes(origin)&&!(env.SSTRX_ENVIRONMENT==='synthetic'&&origin===QA_RX_ORIGIN))fail(403,'signing_origin_not_allowed');return origin;}
export async function rememberSigningOrigin(DB,id,origin){await ensurePlatformSchema(DB);await DB.prepare('INSERT INTO rx_signing_origins VALUES(?,?)').bind(id,origin).run();}
export async function challengeOrigin(DB,id,requested){await ensurePlatformSchema(DB);const value=await DB.prepare('SELECT origin FROM rx_signing_origins WHERE challenge_id=?').bind(id).first();const origin=value?.origin||LEGACY;if(origin!==requested)fail(403,'signing_origin_or_challenge_mismatch');return origin;}
// Test signatures cannot be enabled by setting Stripe test mode on production.
export function paidClinicalOrder(env,order){return ['paid','succeeded','completed','fulfilled'].includes(order.status)&&(/^cs_live_/.test(order.stripe_checkout_session_id||'')||env.SSTRX_ENVIRONMENT==='synthetic'&&env.STRIPE_MODE==='test'&&env.SSTRX_TEST_SIGNING==='true'&&/^cs_test_/.test(order.stripe_checkout_session_id||''));}
