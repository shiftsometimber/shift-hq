// v3.1 extends canonical catalogue IDs. These tables hold supplier authority
// and immutable approval receipts, never a second product or clinical record.
export const CATALOGUE_POLICY='hq-catalogue-v3.1-2026-11-06';
export const catalogueGovernanceDDL=[
 `CREATE TABLE IF NOT EXISTS catalogue_supply_routes(item_kind TEXT NOT NULL CHECK(item_kind IN ('product','medicine_variant')),item_id INTEGER NOT NULL,partner_id TEXT NOT NULL,role TEXT NOT NULL CHECK(role IN ('primary','backup')),readiness TEXT NOT NULL CHECK(readiness IN ('pending','ready','paused')),stock_on_hand INTEGER NOT NULL CHECK(stock_on_hand>=0),reserved INTEGER NOT NULL DEFAULT 0 CHECK(reserved>=0),authority INTEGER NOT NULL CHECK(authority IN (0,1)),availability TEXT NOT NULL,authority_until TEXT NOT NULL,evidence_ref TEXT NOT NULL,version INTEGER NOT NULL DEFAULT 1,updated_by INTEGER NOT NULL,updated_at TEXT NOT NULL,CHECK(stock_on_hand>=reserved),PRIMARY KEY(item_kind,item_id,partner_id))`,
 `CREATE UNIQUE INDEX IF NOT EXISTS catalogue_one_primary ON catalogue_supply_routes(item_kind,item_id) WHERE role='primary'`,
 `CREATE TABLE IF NOT EXISTS catalogue_prescriber_approvals(id TEXT PRIMARY KEY,variant_id INTEGER NOT NULL,product_version INTEGER NOT NULL,variant_version INTEGER NOT NULL,actor_id INTEGER NOT NULL,org_id TEXT NOT NULL,profile_version INTEGER NOT NULL,organisation_version INTEGER NOT NULL,approved_at TEXT NOT NULL,valid_until TEXT NOT NULL,evidence_ref TEXT NOT NULL,policy_version TEXT NOT NULL,UNIQUE(variant_id,product_version,variant_version))`,
 `CREATE TABLE IF NOT EXISTS catalogue_route_reservations(order_number TEXT PRIMARY KEY,variant_id INTEGER NOT NULL,partner_id TEXT NOT NULL,state TEXT NOT NULL CHECK(state IN ('held','paid','expired')),created_at TEXT NOT NULL,updated_at TEXT NOT NULL)`
];
export async function ensureCatalogueGovernanceSchema(DB){
 await DB.batch(catalogueGovernanceDDL.map(sql=>DB.prepare(sql)));
 for(const table of ['products','medicine_products','medicine_variants']){
  const columns=(await DB.prepare('PRAGMA table_info('+table+')').all()).results||[];
  if(columns.length&&!columns.some(x=>x.name==='catalogue_version'))await DB.prepare('ALTER TABLE '+table+' ADD COLUMN catalogue_version INTEGER NOT NULL DEFAULT 1').run();
  if(columns.length&&!columns.some(x=>x.name==='catalogue_change_key'))await DB.prepare('ALTER TABLE '+table+' ADD COLUMN catalogue_change_key TEXT').run();
 }
}
export function hasCatalogueWriteGrant(user,configuration,now=new Date()){
 if(['owner','admin'].includes(user?.role))return true;
 let grants=configuration;if(typeof grants==='string'){try{grants=JSON.parse(grants)}catch{return false}}
 return Array.isArray(grants)&&grants.some(g=>g.user_id===user?.id&&g.permission==='catalogue_write'&&typeof g.approval_ref==='string'&&g.approval_ref.length>0&&Number.isFinite(Date.parse(g.expires_at))&&Date.parse(g.expires_at)>+now);
}
const integer=v=>Number.isSafeInteger(v)&&v>=0;
const future=(value,now)=>typeof value==='string'&&/(?:Z|[+-]\d\d:\d\d)$/.test(value)&&Number.isFinite(Date.parse(value))&&Date.parse(value)>+now;
const reference=value=>typeof value==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value);
export function validateSupplierRoutes(input,now=new Date()){
 if(!Array.isArray(input)||input.length<1||input.length>10)throw Error('supplier_routes_required');
 const fields=['partner_id','role','readiness','stock_on_hand','authority','availability','authority_until','evidence_ref'];
 const seen=new Set();let primaries=0;
 const routes=input.map(r=>{
  if(!r||Object.keys(r).some(k=>!fields.includes(k))||!reference(r.partner_id)||seen.has(r.partner_id)||!['primary','backup'].includes(r.role)||!['pending','ready','paused'].includes(r.readiness)||!integer(r.stock_on_hand)||r.stock_on_hand>10000000||typeof r.authority!=='boolean'||!['available','out_of_stock','hold','unavailable'].includes(r.availability)||!future(r.authority_until,now)||!reference(r.evidence_ref))throw Error('invalid_supplier_route');
  seen.add(r.partner_id);if(r.role==='primary')primaries++;
  return {...Object.fromEntries(fields.map(k=>[k,r[k]])),authority_until:new Date(r.authority_until).toISOString()};
 });
 if(primaries!==1)throw Error('one_primary_supplier_required');return routes;
}
export function catalogueAuthority({product={},variant={},inventory={},routes=[],approval=null,now=new Date()}={}){
 const blockers=[];
 if(product.status!=='available'||variant.status!=='available')blockers.push('catalogue_not_available');
 if(Number(product.sellable)!==1||Number(variant.sellable)!==1)blockers.push('sellable_not_authorised');
 if(product.availability_state!=='available'||variant.availability_state!=='available')blockers.push('availability_not_available');
 const stock=integer(inventory.stock_on_hand)&&integer(inventory.reserved)?Math.max(0,inventory.stock_on_hand-inventory.reserved):0;
 if(!stock)blockers.push('stock_unavailable');
 const candidates=routes.filter(r=>r.partner_ready===true&&r.readiness==='ready'&&Number(r.authority)===1&&r.availability==='available'&&future(r.authority_until,now)&&reference(r.evidence_ref)&&integer(r.stock_on_hand)&&integer(r.reserved)&&r.stock_on_hand-r.reserved>0).sort((a,b)=>Number(b.role==='primary')-Number(a.role==='primary')||a.partner_id.localeCompare(b.partner_id));
 if(!candidates.length)blockers.push('no_ready_authorised_supplier_stock');
 const approved=!!approval&&approval.auth_current===true&&approval.policy_version===CATALOGUE_POLICY&&approval.product_version===product.catalogue_version&&approval.variant_version===variant.catalogue_version&&reference(approval.evidence_ref)&&Number.isFinite(Date.parse(approval.approved_at))&&Date.parse(approval.approved_at)<=+now&&future(approval.valid_until,now);
 if(!approved)blockers.push('current_prescriber_signoff_required');
 return {canBuy:blockers.length===0,blockers,stockAvailable:candidates.length?Math.min(stock,candidates[0].stock_on_hand-candidates[0].reserved):0,selectedPartner:candidates[0]?.partner_id||null,selectedRole:candidates[0]?.role||null,prescriberRequired:true,signoff:approved?{status:'approved',who:approval.actor_id,when:approval.approved_at,product_version:approval.product_version,variant_version:approval.variant_version,evidence_ref:approval.evidence_ref,rx_path:'/workspace/catalogue#'+variant.id}:{status:'required',product_version:product.catalogue_version??null,variant_version:variant.catalogue_version??null},policy_version:CATALOGUE_POLICY};
}
export async function readCatalogueAuthority(DB,variantId,now=new Date()){
 try{
  const r=await DB.prepare(`SELECT v.id,v.medicine_id,v.status,v.sellable,v.availability_state,v.catalogue_version,m.status product_status,m.sellable product_sellable,m.availability_state product_availability,m.catalogue_version product_version,COALESCE(i.stock_on_hand,0) stock_on_hand,COALESCE(i.reserved,0) reserved FROM medicine_variants v JOIN medicine_products m ON m.id=v.medicine_id LEFT JOIN medicine_inventory i ON i.variant_id=v.id WHERE v.id=?`).bind(variantId).first();
  if(!r)return {canBuy:false,blockers:['catalogue_item_not_found'],signoff:{status:'required'}};
  const routes=(await DB.prepare(`SELECT x.*,o.version org_version,o.state_json organisation FROM catalogue_supply_routes x LEFT JOIN partner_organisations o ON o.id=x.partner_id WHERE x.item_kind='medicine_variant' AND x.item_id=?`).bind(variantId).all()).results||[];
  for(const route of routes){let org;try{org=JSON.parse(route.organisation)}catch{}route.partner_ready=org?.kind==='pharmacy'&&org.status==='approved'&&future(org.expiresAt,now);delete route.organisation;delete route.org_version;}
  const approval=await DB.prepare(`SELECT a.*,h.status actor_status,h.role actor_role,h.mfa_enabled,p.version current_profile_version,p.state_json professional,o.version current_org_version,o.state_json organisation FROM catalogue_prescriber_approvals a JOIN hq_users h ON h.id=a.actor_id JOIN partner_staff p ON p.hq_user_id=a.actor_id JOIN partner_organisations o ON o.id=a.org_id WHERE a.variant_id=? AND a.product_version=? AND a.variant_version=?`).bind(variantId,r.product_version,r.catalogue_version).first();
  if(approval){let staff,org;try{staff=JSON.parse(approval.professional);org=JSON.parse(approval.organisation)}catch{}approval.auth_current=approval.actor_status==='active'&&approval.actor_role==='clinical'&&approval.mfa_enabled===1&&approval.current_profile_version===approval.profile_version&&approval.current_org_version===approval.organisation_version&&staff?.kind==='clinician'&&staff.status==='active'&&org?.kind==='clinical'&&org.status==='approved'&&future(org.expiresAt,now);}
  const truth=catalogueAuthority({product:{status:r.product_status,sellable:r.product_sellable,availability_state:r.product_availability,catalogue_version:r.product_version},variant:r,inventory:r,routes,approval,now});
  return {...truth,variantId:r.id,medicineId:r.medicine_id,suppliers:routes.map(x=>Object.fromEntries(['partner_id','role','readiness','stock_on_hand','reserved','authority','availability','authority_until','evidence_ref','version','partner_ready'].map(k=>[k,x[k]]))),source:'Existing medicine_products, medicine_variants and medicine_inventory with catalogue authority metadata'};
 }catch{return {canBuy:false,blockers:['catalogue_authority_source_unavailable'],signoff:{status:'required'},suppliers:[]};}
}
// This guard is re-evaluated within the ORIGINAL checkout transaction. A
// catalogue change, revoked professional, expired authority or stock race
// cannot pass on a stale JavaScript read alone.
export function catalogueReservationGuard(truth,now=new Date()){
 if(!truth?.canBuy||!truth.selectedPartner)return {sql:'0=1',args:[]};
 return {sql:`EXISTS(SELECT 1 FROM catalogue_supply_routes r JOIN medicine_variants v ON v.id=r.item_id JOIN medicine_products m ON m.id=v.medicine_id JOIN catalogue_prescriber_approvals a ON a.variant_id=v.id AND a.product_version=m.catalogue_version AND a.variant_version=v.catalogue_version JOIN hq_users h ON h.id=a.actor_id JOIN partner_staff ps ON ps.hq_user_id=a.actor_id JOIN partner_organisations co ON co.id=a.org_id JOIN partner_organisations po ON po.id=r.partner_id WHERE r.item_kind='medicine_variant' AND r.item_id=? AND r.partner_id=? AND r.readiness='ready' AND r.authority=1 AND r.availability='available' AND r.stock_on_hand-r.reserved>0 AND r.authority_until>? AND v.status='available' AND m.status='available' AND v.sellable=1 AND m.sellable=1 AND v.availability_state='available' AND m.availability_state='available' AND a.policy_version=? AND a.valid_until>? AND h.status='active' AND h.role='clinical' AND h.mfa_enabled=1 AND ps.version=a.profile_version AND co.version=a.organisation_version AND json_extract(ps.state_json,'$.kind')='clinician' AND json_extract(ps.state_json,'$.status')='active' AND json_extract(co.state_json,'$.kind')='clinical' AND json_extract(co.state_json,'$.status')='approved' AND json_extract(co.state_json,'$.expiresAt')>? AND json_extract(po.state_json,'$.kind')='pharmacy' AND json_extract(po.state_json,'$.status')='approved' AND json_extract(po.state_json,'$.expiresAt')>?)`,args:[truth.variantId,truth.selectedPartner,now.toISOString(),CATALOGUE_POLICY,now.toISOString(),now.toISOString(),now.toISOString()]};
}
export function catalogueReservationStatements(DB,truth,orderNumber,guard,date){
 return [DB.prepare(`INSERT INTO catalogue_route_reservations(order_number,variant_id,partner_id,state,created_at,updated_at) SELECT ?,?,?,'held',?,? WHERE ${guard}`).bind(orderNumber,truth.variantId,truth.selectedPartner,date,date),DB.prepare(`UPDATE catalogue_supply_routes SET reserved=reserved+1,updated_at=? WHERE item_kind='medicine_variant' AND item_id=? AND partner_id=? AND ${guard}`).bind(date,truth.variantId,truth.selectedPartner)];
}
export function settleCatalogueReservationStatements(DB,orderNumber,state,condition,conditionArgs,date){
 if(!['paid','expired'].includes(state))throw Error('invalid_reservation_outcome');
 return [DB.prepare(`UPDATE catalogue_supply_routes SET reserved=reserved-1,stock_on_hand=CASE WHEN ?='paid' THEN stock_on_hand-1 ELSE stock_on_hand END,updated_at=? WHERE item_kind='medicine_variant' AND EXISTS(SELECT 1 FROM catalogue_route_reservations x WHERE x.order_number=? AND x.variant_id=item_id AND x.partner_id=catalogue_supply_routes.partner_id AND x.state='held') AND ${condition}`).bind(state,date,orderNumber,...conditionArgs),DB.prepare(`UPDATE catalogue_route_reservations SET state=?,updated_at=? WHERE order_number=? AND state='held' AND ${condition}`).bind(state,date,orderNumber,...conditionArgs)];
}
export async function catalogueReservationState(DB,orderNumber){
 const table=await DB.prepare("SELECT 1 found FROM sqlite_master WHERE type='table' AND name='catalogue_route_reservations'").first();
 if(!table)return null;
 return (await DB.prepare('SELECT state FROM catalogue_route_reservations WHERE order_number=?').bind(orderNumber).first())?.state||null;
}

export async function catalogueReservationExists(DB,orderNumber){return (await catalogueReservationState(DB,orderNumber))!==null;}
