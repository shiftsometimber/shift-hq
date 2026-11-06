const {test}=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {readFileSync}=require('node:fs');
const {boundedRead}=require('./hq-v3-foundation.js');

// Local component harness only. This does not qualify browser/device evidence.
function setup(read){
 const views=[],buttons=[],nodes=()=>({textContent:'',innerHTML:'',replaceChildren(){this.innerHTML='';this.textContent='';},querySelectorAll(){return[];}});
 const nav={append(x){buttons.push(x)},querySelectorAll(){return buttons}};
 const document={querySelector(q){return q==='aside nav'?nav:{append(x){views.push(x)}}},querySelectorAll(){return views},getElementById(){return nodes()},createElement(tag){const e={...nodes(),dataset:{},classList:{toggle(){}}};if(tag==='section'){
  const form={elements:Object.fromEntries(Object.entries({period:'TODAY',start:'2026-11-06',end:'2026-11-06',compare:true}).map(([key,value])=>[key,{value,checked:value===true}]))};
  e.parts={form,status:nodes(),result:nodes(),label:nodes()};e.querySelector=q=>({'form':form,'[data-source-status]':e.parts.status,'[data-source-result]':e.parts.result,'[data-source-partition]':e.parts.label})[q];
 }return e;}};
 const host={HQV3:{boundedRead},HQOperations:{errorState:e=>({detail:e.message})},addEventListener(){}};
 vm.runInNewContext(readFileSync(__dirname+'/hq-v31-business.js','utf8'),{window:host,document,URLSearchParams,AbortController,Intl,Date,Map,Set});
 let principal={id:17};const control=host.HQV31Business.install({getPrincipal:()=>principal,read,navigate(){}});
 return {control,host,view:id=>views.find(x=>x.id===id),button:id=>buttons.find(x=>x.dataset.view===id),logout(){principal=null;control.clear()}};
}
const data=(partition='LIVE',extra={})=>({ok:true,audience:'ops_meta',partition,definition_version:'fictional',period:{preset:'TODAY',since:'2026-11-06',until:'2026-11-07'},orders:[],recognition_basis:'Fictional fixture',...extra});

test('Business views use the verified source partition, pin subsequent reads and reject a changed partition',async()=>{
 const calls=[];let partition='LIVE';const f=setup(async path=>{calls.push(new URL(path,'https://fictional.example'));return data(partition)});
 await f.button('purchaseintel').onclick();const view=f.view('purchaseintel');assert.match(view.parts.status.textContent,/^LIVE/);assert.equal(view.parts.label.textContent,'SHIFT HQ v3.1 · LIVE');assert.equal(calls[0].searchParams.has('partition'),false);
 await f.button('purchaseintel').onclick();assert.equal(calls[1].searchParams.get('partition'),'LIVE');
 partition='TEST';await f.button('purchaseintel').onclick();assert.match(view.parts.status.textContent,/Unavailable.*changed data partition/);assert.equal(view.parts.result.innerHTML,'');
});
test('Money comparison cannot combine different partitions and an unqualified source cannot render data',async()=>{
 const f=setup(async path=>data(path.includes('/contract')?'TEST':'LIVE',{comparison:{since:'previous',until:'end'}}));await f.button('moneytruth').onclick();const view=f.view('moneytruth');assert.equal(view.parts.result.innerHTML,'');assert.match(view.parts.status.textContent,/Unavailable.*partition/);
 for(const invalid of [{ok:true,partition:'LIVE'},{ok:true,partition:'LIVE',audience:'clinical'},{ok:true,partition:'UNKNOWN',audience:'ops_meta'}])assert.throws(()=>f.host.HQV31Business.readPartition(invalid),/partition/);
});
test('TEST labels reflect TEST source and signing out discards pending data and its scope',async()=>{
 let resolve,ready;const started=new Promise(r=>{ready=r});const f=setup(()=>new Promise(r=>{resolve=r;ready()}));const pending=f.button('purchaseintel').onclick();await started;f.logout();resolve(data('LIVE',{orders:[{order_ref:'DO-NOT-RENDER'}]}));await pending;const view=f.view('purchaseintel');assert.equal(view.parts.result.innerHTML,'');assert.equal(view.parts.status.textContent,'Sign in to load this source.');assert.equal(view.parts.label.textContent,'SHIFT HQ v3.1');
 const testFixture=setup(async()=>data('TEST'));await testFixture.button('purchaseintel').onclick();assert.match(testFixture.view('purchaseintel').parts.status.textContent,/^TEST/);
});
