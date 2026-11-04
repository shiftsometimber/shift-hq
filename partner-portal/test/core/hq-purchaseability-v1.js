// HQ purchaseability authority — Act 7 closeout.
// This module is intentionally fail-closed: public purchaseability is true only when
// HQ explicitly marks a variant sellable AND available AND a partner is present.

const AVAILABILITY = new Set(['draft','unavailable','out_of_stock','available','suspended','archived']);

export async function ensurePurchaseabilitySchema(DB){
  for (const sql of [
    `ALTER TABLE medicine_products ADD COLUMN partner TEXT`,
    `ALTER TABLE medicine_products ADD COLUMN sellable INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE medicine_products ADD COLUMN availability_state TEXT NOT NULL DEFAULT 'unavailable'`,
    `ALTER TABLE medicine_variants ADD COLUMN partner TEXT`,
    `ALTER TABLE medicine_variants ADD COLUMN sellable INTEGER NOT NULL DEFAULT 0`,
    `ALTER TABLE medicine_variants ADD COLUMN availability_state TEXT NOT NULL DEFAULT 'unavailable'`
  ]) await DB.prepare(sql).run().catch(()=>{});
}

export function normaliseAvailability(value){
  const v=String(value||'unavailable').trim().toLowerCase();
  return AVAILABILITY.has(v)?v:'unavailable';
}

export function authoritativePurchaseability({product={},variant={},inventory={}}={}){
  const partner=String(variant.partner||product.partner||'').trim();
  const availability=normaliseAvailability(variant.availability_state||product.availability_state);
  const stock=Math.max(0,Number(inventory.stock_on_hand||0)-Number(inventory.reserved||0));
  const sellable=Number(product.sellable||0)===1 && Number(variant.sellable||0)===1;
  const statusGreen=String(product.status||'')==='available' && String(variant.status||'')==='available';
  const canBuy=Boolean(sellable && partner && availability==='available' && statusGreen && stock>0);
  return {partner:partner||null,availabilityState:availability,sellable,stockAvailable:stock,canBuy};
}

export function requireAuthoritativePurchaseability(input){
  const truth=authoritativePurchaseability(input);
  if(!truth.canBuy){
    const error=new Error('Medicine is not currently sellable from HQ truth.');
    error.code='HQ_NOT_SELLABLE';
    error.purchaseability=truth;
    throw error;
  }
  return truth;
}
