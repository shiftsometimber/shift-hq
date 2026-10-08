window.installPartnerWorkflowsHQ=()=>{
 const routes=[
 ['pharmacy','Pharmacy & weight management',[
 ['Choose route','Member','Medicine or provider enquiry','Referral or SHIFT sale: confirm before launch'],
 ['Assessment','Clinical partner','Required assessment completed','Clinical eligibility and prescribing decisions belong to the partner'],
 ['Decision & payment','Partner / SHIFT — confirm','Decision and payment outcome recorded','Confirm payment timing and unsuccessful-assessment refund ownership'],
 ['Dispense & dispatch','Clinical partner','Order accepted and dispatch reference available','Confirm stock checks, delivery times and exception contact'],
 ['Delivery & follow-up','Partner / SHIFT — confirm','Delivery outcome and support route recorded','Confirm repeat-order route, reported side-effect routing and failed delivery process']]],
 ['trt','TRT & testosterone',[
 ['Enquiry','Member / SHIFT','Member chooses partner assessment','Confirm referral model and what SHIFT explains'],
 ['Partner assessment','Clinical partner','Partner accepts referral','Partner determines suitable assessment and testing'],
 ['Testing & decision','Clinical partner','Partner reviews results and decides next steps','SHIFT does not interpret results or prescribe'],
 ['Treatment or alternative','Clinical partner','Partner communicates decision','Confirm member communications, billing and unsuitable-referral route'],
 ['Ongoing review','Clinical partner','Follow-up responsibility identified','Confirm continuity and support handover']]],
 ['diagnostics','Blood tests & diagnostics',[
 ['Choose test route','Member / partner','Appropriate route selected','Confirm who advises on test suitability'],
 ['Booking or kit','Partner','Booking or kit reference recorded','Confirm payment, delivery and collection ownership'],
 ['Sample & processing','Member / partner','Sample received by laboratory','Confirm missing, late or unsuitable sample route'],
 ['Results & interpretation','Clinical partner','Results explained through agreed route','Confirm clinical escalation responsibility; no results in HQ handover notes'],
 ['Next action','Partner / member','Follow-up route communicated','Confirm follow-up and support ownership']]],
 ['devices','Devices & wearables',[
 ['Choose device','Member','Product selected','Confirm referral versus SHIFT sale'],
 ['Order acceptance','Seller / partner','Order reference accepted','Confirm payment, stock and cancellation ownership'],
 ['Dispatch & delivery','Partner','Tracking and delivery outcome available','Confirm lost parcel and damaged item process'],
 ['Setup & optional connection','Member / SHIFT — confirm','Setup completed or help requested','Data connection requires separate member choice and consent'],
 ['Support & returns','Seller / partner — confirm','Support case or return resolved','Confirm warranty and refund responsibility']]],
 ['mealprep','Meal preparation',[
 ['Choose meals','Member','Meals and delivery preference selected','Confirm product information and dietary/allergen responsibility'],
 ['Order handover','SHIFT / partner — confirm','Partner accepts order','Confirm sale model, order cut-off and address checks'],
 ['Prepare & dispatch','Partner','Dispatch reference available','Confirm packaging, substitutions and cold-chain responsibility'],
 ['Delivery','Partner / courier','Delivery outcome recorded','Confirm missed delivery, damaged packaging and food-quality route'],
 ['Support / repeat order','Seller — confirm','Issue resolved or repeat route offered','Confirm refunds and recurring-order controls']]],
 ['supplements','Nutrition & supplements',[
 ['Choose product','Member','Product selected','Confirm approved product information and seller ownership'],
 ['Order acceptance','Seller / partner','Order accepted','Confirm payment and stock checks'],
 ['Pick & dispatch','Partner','Dispatch reference available','Confirm batch traceability and fulfilment responsibility'],
 ['Delivery','Partner / courier','Delivery outcome recorded','Confirm damaged or missing item process'],
 ['Product support & returns','Seller / partner — confirm','Issue routed and closed','Confirm product concern escalation, returns and refunds']]],
 ['apparel','Apparel',[
 ['Choose product & size','Member','Product and size selected','Confirm sizing, branding and seller ownership'],
 ['Order acceptance','Seller / partner','Order accepted','Confirm payment and cancellation cut-off'],
 ['Production & dispatch','Partner','Production complete and tracking available','Confirm print quality and lead time'],
 ['Delivery','Partner / courier','Delivery outcome recorded','Confirm lost or damaged parcel route'],
 ['Returns & support','Seller / partner — confirm','Issue resolved','Confirm sizing returns, faults and refund responsibility']]],
 ['other','Other partner services',[
 ['Define service','SHIFT / partner','Scope written down','Confirm what is included and who provides it'],
 ['Accept request','Partner','Request accepted','Confirm required information and permission to share'],
 ['Deliver service','Partner','Completion evidence available','Confirm turnaround and exception route'],
 ['Close & support','SHIFT / partner — confirm','Outcome and next action recorded','Confirm billing, complaints and ongoing ownership']]]
 ];
 const esc=v=>String(v).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
 const section=document.createElement('section');section.id='partnerworkflows';section.className='view';
 section.innerHTML='<div class="hq-management-heading"><div><h2>Partner process maps</h2><p>One operating route for each range.</p></div></div><p class="partner-boundary">Draft operating maps · Ownership, timings and commercial arrangements require agreement. These maps do not send information or automate tasks.</p><div class="partner-filters"><label>Range<select id="partner-workflow-range">'+routes.map(([id,name])=>'<option value="'+id+'">'+esc(name)+'</option>').join('')+'</select></label></div><div id="partner-workflow-map"></div>';
 document.querySelector('main').append(section);
 const group=[...document.querySelectorAll('aside nav details')].find(d=>d.querySelector('summary')?.textContent==='Partners & fulfilment');
 const button=document.createElement('button');button.dataset.view='partnerworkflows';button.textContent='Process maps';group.append(button);
 function show(range){const route=routes.find(r=>r[0]===range)||routes[0];document.getElementById('partner-workflow-range').value=route[0];document.getElementById('partner-workflow-map').innerHTML='<h3>'+esc(route[1])+'</h3><div class="workflow-stages">'+route[2].map(([name,owner,done,confirm],i)=>'<article class="panel workflow-stage"><span class="partner-chip">Stage '+(i+1)+'</span><h3>'+esc(name)+'</h3><p><strong>Owner:</strong> '+esc(owner)+'</p><p><strong>Ready to move on:</strong> '+esc(done)+'</p><p class="hq-muted"><strong>To confirm:</strong> '+esc(confirm)+'</p></article>').join('')+'</div><div class="panel"><h3>Exception route</h3><p>If a stage cannot complete, record the blocker, responsible owner, next action and due date in Handovers. Close only when the outcome is recorded.</p><h3>Future partner visibility</h3><p>These planning maps contain no member data. A future partner account will receive only its own approved tasks; internal notes stay in HQ.</p><h3>Management reporting to add</h3><p>Time in stage · Waiting for SHIFT · Waiting for partner · Overdue · Blocked · Completed. Stage-based tracking and reporting are not enabled in this preview.</p></div>';}
 function open(range){group.open=true;document.querySelectorAll('.view').forEach(s=>s.classList.toggle('active',s===section));document.querySelectorAll('aside nav button[data-view]').forEach(b=>b.classList.toggle('active',b===button));document.getElementById('title').textContent='Partner process maps';show(range);}
 button.onclick=()=>open(document.getElementById('partner-workflow-range').value);document.getElementById('partner-workflow-range').onchange=e=>show(e.target.value);
 const register=document.getElementById('partners-list');const observer=new MutationObserver(()=>{register.querySelectorAll('tbody tr').forEach(row=>{if(row.querySelector('[data-workflow]'))return;const range=row.children[1]?.firstChild?.textContent?.trim();const b=document.createElement('button');b.dataset.workflow=range;b.textContent='Process map';b.onclick=()=>open(range==='nutrition'?'mealprep':range);row.lastElementChild.append(b);});});observer.observe(register,{childList:true,subtree:true});
 show('pharmacy');
};
