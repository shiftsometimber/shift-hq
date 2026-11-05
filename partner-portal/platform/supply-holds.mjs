import {ensurePlatformSchema} from './schema.mjs';
import {fail} from './domain.mjs';
export const HOLD_KINDS=['cancellation_requested','damaged_shipment','temperature_concern','recall','supply_clarification'];
export async function hasOpenSupplyHold(env,orderNumber){
 if(env.SSTRX_PLATFORM_ENABLED!=='true')return false;
 await ensurePlatformSchema(env.DB);
 return !!await env.DB.prepare("SELECT 1 held FROM rx_supply_holds WHERE order_number=? AND state='open' LIMIT 1").bind(orderNumber).first();
}
export async function requireNoSupplyHold(env,orderNumber){if(await hasOpenSupplyHold(env,orderNumber))fail(409,'supply_hold_requires_authorised_review');}
// Read-before-write checks alone permit a concurrent incident to race dispatch.
// The original native write also checks the hold inside its own transaction.
export function guardedSupplyStatement(env,DB,s){
 if(env.SSTRX_PLATFORM_ENABLED!=='true')return s.native||s;
 let table;
 if(/^UPDATE partner_fulfilment\b/.test(s.sql)){
  try{if(['accepted','preparing','dispatched'].includes(JSON.parse(s.args[0]).status))table='partner_fulfilment';}catch{}
 }
 if(/^UPDATE clinical_prescription_requests\b/.test(s.sql)&&s.args.some(x=>{try{return JSON.parse(x)?.status==='issued'}catch{return false}}))table='clinical_prescription_requests';
 return table?DB.prepare(s.sql+` AND NOT EXISTS(SELECT 1 FROM rx_supply_holds h WHERE h.order_number=${table}.order_number AND h.state='open')`).bind(...s.args):s.native||s;
}
