/* Fictional, local-only fixture. Production network access is blocked by CSP. */
(() => {
 const scenario=new URLSearchParams(location.search).get('qa')||'owner';
 const role=scenario==='support'?'support':'owner',principal={id:1,name:'Example owner',email:'owner@example.invalid',role,status:'active'},permissions=role==='owner'?['*']:['support_read','crm_read','intelligence_read'];
 const date=new Date(),ago=h=>new Date(date.getTime()-h*3600000).toISOString(),tomorrow=new Date(date.getTime()+86400000).toISOString().slice(0,10);
 const tasks=[{id:701,title:'EXAMPLE — reconcile order reference',status:'open',assigned_to:'Matt',person_name:'Example member',next_action:'Review the retained payment reference.',due_at:ago(48),created_at:ago(72)},{id:702,title:'EXAMPLE — assign cover',status:'open',due_at:tomorrow,created_at:ago(3)},{id:703,title:'EXAMPLE — closed task',status:'done',created_at:ago(6)}];
 const tickets=[{id:801,reference:'EXAMPLE-SUP-801',subject:'Example support request',priority:'urgent',status:'open',owner_name:'Example support colleague',created_at:ago(2),updated_at:ago(1)},{id:802,reference:'EXAMPLE-SUP-802',subject:'Example waiting request',priority:'normal',status:'waiting',created_at:ago(30),updated_at:ago(24)}];
 const handovers=[{id:'h-901',partner_id:'p-1',reference:'EXAMPLE-ORDER-901',service:'pharmacy',status:'blocked',owner_name:'Matt',next_action:'Check the sandbox acknowledgement with the partner.',due_date:ago(24).slice(0,10),created_at:ago(26),updated_at:ago(2),version:1}];
 const messages=[{id:1001,subject:'Example private-link notification',status:'unknown',channel:'email',recipient:'recipient@example.invalid',created_at:ago(6)}];
 let signedOut=sessionStorage.getItem('hq-fixture-signed-out')==='1',releases=[];
 function report(params){const available=(key,label,value,unit='count',scope='Selected report period · fictional fixture')=>({key,label,value,unit,scope,source:'Fictional local fixture',status:'available'});return{ok:true,preview:true,kind:params.kind||'management',period:{start:params.start,end:params.end,timezone:'Europe/London'},generatedAt:scenario==='stale'?ago(2):new Date().toISOString(),metrics:[available('paid_value','Paid order value (GBP)',scenario==='empty'?0:248000,'pence'),available('registrations','New registrations',scenario==='empty'?0:28),{...available('week4','Week-4 return rate',42,'percent','Trailing 90-day Today cohort · fictional fixture'),numerator:21,denominator:50},{...available('helped','Steps rated helpful',76,'percent','Trailing 90-day Today cohort · fictional fixture'),numerator:38,denominator:50},{key:'organic',label:'Organic visits',status:'unavailable',value:null,reason:'Analytics not connected in this fixture.'}],privacy:'FICTIONAL, LOCAL-ONLY FIXTURE. No actual member data.',definitions:'All values are illustrative. Unavailable is not zero.',limitations:['This fixture does not prove production data acceptance.']};}
 function result(body,status=200){return new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json'}});}
 window.fetch=async(input,init={})=>{
  const url=new URL(typeof input==='string'?input:input.url,location.href),path=url.pathname;
  if(url.origin!=='https://api.shiftsometimber.co.uk')throw Error('Fixture blocked unexpected network request.');
  if(path.endsWith('/auth/logout')){signedOut=true;sessionStorage.setItem('hq-fixture-signed-out','1');return result({ok:true});}
  if(init.method&&init.method!=='GET')return result({ok:false,error:'fixture_read_only'},403);
  if(signedOut)return result({ok:false,error:'fixture_signed_out'},401);
  if(path==='/v1/hq/me')return result({user:principal,permissions});
  if(path==='/v1/hq/management/report')return result(report(Object.fromEntries(url.searchParams)));
  const delayed=['/v1/crm/tasks','/v1/hq/support','/v1/hq/outbox','/v1/hq/management/partner-handovers'].includes(path);
  if(scenario==='loading'&&delayed)await new Promise((resolve,reject)=>{releases.push(resolve);init.signal?.addEventListener('abort',()=>reject(new DOMException('Aborted','AbortError')),{once:true});});
  if(scenario==='unavailable'&&path==='/v1/crm/tasks')return result({error:'fixture_source_unavailable'},503);
  if(scenario==='unavailable'&&path==='/v1/hq/support')return result({error:'fixture_source_unavailable'},503);
  if(scenario==='unavailable'&&path==='/v1/hq/management/partner-handovers')return result({error:'fixture_not_connected'},404);
  if(scenario==='unavailable'&&path==='/v1/hq/outbox')return result({error:'fixture_role_denied'},403);
  if(path==='/v1/crm/stats')return result({stats:{total:28,registered:28,cases:0,pharmacyOrders:0}});
  if(path==='/v1/crm/people')return result({people:[]});
  if(path==='/v1/crm/tasks')return result({tasks:scenario==='empty'?[]:tasks});
  if(path==='/v1/hq/support')return result({tickets:scenario==='empty'?[]:tickets});
  if(path==='/v1/hq/management/partner-handovers')return result({items:scenario==='empty'?[]:handovers});
  if(path==='/v1/hq/management/partners')return result({items:[{id:'p-1',name:'Example partner',service:'pharmacy',model:'undecided',status:'discussion',version:1}]});
  if(path==='/v1/hq/outbox')return result({messages:scenario==='empty'?[]:messages,stats:{pending:0,sent:0,failed:0,suppressed:0}});
  if(path==='/v1/hq/intelligence')return result({signals:[],brief:'Fictional local fixture.'});
  if(path==='/v1/hq/orders')return result({mode:'live',orders:[]});
  return result({people:[],tasks:[],orders:[],products:[],content:[],articles:[],signals:[],events:[],audit:[],messages:[],activity:[],users:[],segments:[],campaigns:[],forms:[],workflows:[],documents:[],models:[],proposals:[],checks:[],panes:[],queue:[],items:[],mode:'live'});
 };
 document.addEventListener('DOMContentLoaded',()=>{
  const banner=document.createElement('div');banner.style.cssText='background:#e7e3da;color:#050505;padding:12px 20px;border-bottom:1px solid #707762;font:13px sans-serif;display:flex;gap:12px;align-items:center;flex-wrap:wrap';
  banner.innerHTML='<strong>READ-ONLY PREVIEW · FICTIONAL DATA</strong><label>Scenario <select id="fixture-scenario"><option value="owner">Working queues</option><option value="empty">Empty queues</option><option value="unavailable">Unavailable sources</option><option value="support">Support permissions</option><option value="stale">Older snapshot</option><option value="loading">Held responses</option></select></label><button id="fixture-release">Release held responses</button><button id="fixture-reset">Reset fixture sign-in</button>';
  document.body.prepend(banner);const select=document.getElementById('fixture-scenario');select.value=scenario;select.onchange=()=>{sessionStorage.removeItem('hq-fixture-signed-out');location.search='?qa='+select.value};document.getElementById('fixture-release').onclick=()=>{for(const release of releases.splice(0))release();};document.getElementById('fixture-reset').onclick=()=>{sessionStorage.removeItem('hq-fixture-signed-out');location.reload()};
  const notice=document.getElementById('notice'),observer=new MutationObserver(()=>{if(notice.textContent.includes('live Shift Core'))notice.textContent='Read-only local fixture · fictional data · production access blocked.'});observer.observe(notice,{subtree:true,childList:true});
 });
})();
