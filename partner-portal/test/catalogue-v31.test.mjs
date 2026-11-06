import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture} from './fixture.mjs';
import {ensurePlatformSchema} from '../platform/schema.mjs';
import {ensureCatalogueGovernanceSchema,readCatalogueAuthority} from '../service/vendor/core-catalogue-governance-v31.mjs';
async function setup(){
 const f=await fixture();await ensurePlatformSchema(f.DB);
 f.sql.exec("CREATE TABLE IF NOT EXISTS medicine_products(id INTEGER PRIMARY KEY,name TEXT,status TEXT,sellable INTEGER);UPDATE medicine_products SET name='TEST-MED-A',status='available',sellable=1 WHERE id=1;");
 const columns=f.sql.prepare('PRAGMA table_info(medicine_variants)').all().map(x=>x.name);
 for(const [key,type] of [['medicine_id','INTEGER DEFAULT 1'],['availability_state',"TEXT DEFAULT 'available'"],['selling_price_pence','INTEGER DEFAULT 1000']])if(!columns.includes(key))f.sql.exec('ALTER TABLE medicine_variants ADD COLUMN '+key+' '+type);
 f.sql.exec("UPDATE medicine_variants SET medicine_id=1,status='available',sellable=1,availability_state='available' WHERE id=11");
 await ensureCatalogueGovernanceSchema(f.DB);
 const p=JSON.parse(f.sql.prepare('SELECT state_json FROM partner_staff WHERE hq_user_id=3').get().state_json);
 p.grants.forEach(g=>{if(g.area==='weight_management')g.medicines=[]});
 f.sql.prepare('UPDATE partner_staff SET state_json=? WHERE hq_user_id=3').run(JSON.stringify(p));
 f.env.SSTRX_PLATFORM_ENABLED='true';f.env.HQ_CATALOGUE_V31_TEST_MODE='true';f.env.SSTRX_ENVIRONMENT='synthetic';
 return f;
}
test('HQ owner and pharmacy cannot forge prescriber catalogue sign-off; clinical scope and a dedicated TEST grant are required',async()=>{
 const f=await setup();try{
 const body={productVersion:1,variantVersion:1,acknowledge:true};
 for(const id of [1,4]){const r=await f.hq('/platform/catalogue/11',id,body);assert.equal(r.status,403);}
 let r=await f.hq('/platform/catalogue/11',3,body);assert.equal(r.status,403);assert.equal((await r.json()).error,'scoped_catalogue_signoff_grant_required');
 f.env.CATALOGUE_SIGNOFF_TEST_GRANTS=JSON.stringify([{user_id:3,org_id:JSON.parse(f.sql.prepare('SELECT state_json FROM partner_staff WHERE hq_user_id=3').get().state_json).orgId,variant_id:11,permission:'catalogue_signoff',approval_ref:'TEST-CATALOGUE-AUTHORITY',expires_at:new Date(Date.now()+86400000).toISOString()}]);
 r=await f.hq('/platform/catalogue/11',3);assert.equal(r.status,200);const view=await r.json();assert.equal(view.item.name,'TEST-MED-A');assert.equal(view.item.catalogue_version,1);
 r=await f.hq('/platform/catalogue/11',3,{...body,who:1});assert.equal(r.status,409);
 r=await f.hq('/platform/catalogue/11',3,body);assert.equal(r.status,200);const approved=await r.json();assert.equal(approved.recorded,true);assert.equal(approved.approval.who,3);assert.equal(approved.patientPrescriptionCreated,false);
 r=await f.hq('/platform/catalogue/11',3,body);assert.equal(r.status,200);assert.equal((await r.json()).replayed,true);assert.equal(f.sql.prepare('SELECT COUNT(*) n FROM catalogue_prescriber_approvals').get().n,1);
 f.sql.exec('UPDATE medicine_variants SET catalogue_version=catalogue_version+1 WHERE id=11');r=await f.hq('/platform/catalogue/11',3,body);assert.equal(r.status,409);assert.equal((await readCatalogueAuthority(f.DB,11)).signoff.status,'required');
 delete f.env.HQ_CATALOGUE_V31_TEST_MODE;r=await f.hq('/platform/catalogue/11',3,body);assert.equal(r.status,503);
 }finally{f.close()}
});
