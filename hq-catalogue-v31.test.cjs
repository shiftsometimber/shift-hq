const {test}=require('node:test');
const assert=require('node:assert/strict');
const {catalogueRows,selectRows}=require('./hq-catalogue-v31.js');
const {boundedRead}=require('./hq-v3-foundation.js');
test('Catalogue retains canonical SKU types and commercial strengths without inferring sellability from active status',()=>{
 const rows=catalogueRows([{id:1,name:'TEST-MEM-CONT',sku:'TEST-MEM-CONT',product_type:'membership',status:'active'},{id:2,name:'TEST-SHOP-MILL',sku:'TEST-SHOP-MILL',product_type:'physical',status:'draft'}],[{id:1,name:'TEST-MED-A',catalogue_version:3,hasImage:false,variants:[{id:11,strengthLabel:'5 mg',catalogueVersion:4,status:'available',stockOnHand:2,reserved:0}]}],[{id:1,hasImage:true}]);
 assert.deepEqual(rows.map(x=>x.category),['memberships','shop','medicines']);assert.ok(rows.every(x=>x.sellable===null));assert.equal(rows[1].hasImage,null);assert.equal(rows[2].variantVersion,4);
 assert.deepEqual(selectRows(rows,{search:'5 mg'}).map(x=>x.key),['medicine:11']);assert.equal(selectRows(rows,{category:'shop'})[0].sku,'TEST-SHOP-MILL');assert.equal(selectRows(rows)[0].key,'medicine:11');assert.equal(selectRows(rows)[1].key,'product:2');
});
test('A bounded supplier save retains its method/body and timeout signal rather than silently becoming a read',async()=>{
 let seen;await boundedRead((path,options)=>{seen={path,options};return Promise.resolve({ok:true})},'/test/suppliers',{method:'POST',body:'{"version":4}',headers:{'Content-Type':'application/json'}});
 assert.equal(seen.options.method,'POST');assert.equal(seen.options.body,'{"version":4}');assert.ok(seen.options.signal instanceof AbortSignal);
});

test('Unknown catalogue authority never becomes an awaiting count or a zero sellable total',()=>{
 const {authorityCounts}=require('./hq-catalogue-v31.js');
 assert.deepEqual(authorityCounts([{kind:'medicine',sellable:null}],true),{sellable:null,medicineBlocked:null});
 assert.deepEqual(authorityCounts([{kind:'medicine',sellable:true},{kind:'medicine',sellable:false}],true),{sellable:1,medicineBlocked:1});
 assert.deepEqual(authorityCounts([{kind:'medicine',sellable:true}],false),{sellable:null,medicineBlocked:null});
});
