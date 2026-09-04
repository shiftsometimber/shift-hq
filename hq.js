/* Shift HQ 1.11.3 commerce */
(() => {
  const legacy = document.createElement('script');
  legacy.src = 'hq-v111.js?v=11.2';
  legacy.onload = () => {
    const $ = s => document.querySelector(s);
    const $$ = s => [...document.querySelectorAll(s)];
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
    const API = 'https://api.shiftsometimber.co.uk';
    const fmt = d => { if (!d) return '—'; try { return new Date(d).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'}); } catch { return d; } };
    const badge = v => `<span class="badge">${esc(String(v || '—').replaceAll('_',' '))}</span>`;
    const deepLink = new URLSearchParams(location.search);
    const requestedView = deepLink.get('view');
    const requestedEvent = /^\d+$/.test(deepLink.get('event') || '') ? deepLink.get('event') : null;
    let radarEvents=[];
    let openedDeepLink=false;
    const radarDestinations=['medicine_news','dossier','ticker_knowledge','ticker_treatments','knowledge_links','member_watch','member_email','member_push','search','sitemap','social_instagram','social_facebook','social_linkedin','social_x'];

    async function radarCall(path, opts={}) {
      const method=String(opts.method||'GET').toUpperCase();
      const headers={'Accept':'application/json',...(method==='GET'||method==='HEAD'?{}:{'Content-Type':'application/json'}),...(opts.headers||{})};
      const r = await fetch(API + path, { ...opts, credentials:'include', headers });
      let data={}; try { data=await r.json(); } catch {}
      if (!r.ok) throw new Error(data.message || data.error || `Shift Core ${r.status}`);
      return data;
    }

    function ensureKnowledgeStyles(){
      if(document.querySelector('link[data-g3-006]'))return;
      const link=document.createElement('link');link.rel='stylesheet';link.href='hq-knowledge-editorial.css?v=2';link.dataset.g3006='true';document.head.appendChild(link);
    }

    function rationaliseKnowledgeNavigation() {
      const knowledgeButtons = $$('nav button[data-view="knowledge"]');
      const knowledgeSections = $$('section#knowledge');
      if (knowledgeButtons[0] && knowledgeSections[0]) {
        knowledgeButtons[0].dataset.view='knowledgehub';
        knowledgeButtons[0].textContent='▥ Knowledge Hub CMS';
        knowledgeSections[0].id='knowledgehub';
        knowledgeButtons[0].onclick=()=>{
          if (typeof window.view==='function') window.view('knowledgehub');
          loadHubArticles();
        };
      }
      if (knowledgeButtons[1]) knowledgeButtons[1].textContent='⌬ Shift Brain Knowledge';
    }

    function installKnowledgeEditorialPresentation(){
      ensureKnowledgeStyles();
      const section=$('#knowledgehub');if(!section)return;
      const toolbar=section.querySelector('.toolbar');
      if(toolbar){
        const sub=toolbar.querySelector('.sub');if(sub)sub.textContent='Draft, review and publish evidence-led content with a named editorial decision retained against every approved article.';
        const add=toolbar.querySelector('#newArticle');if(add)add.textContent='+ New draft';
        if(!section.querySelector('.knowledge-editorial-intro')){
          toolbar.insertAdjacentHTML('afterend',`<div class="knowledge-editorial-intro"><div><p class="eyebrow">EDITORIAL STANDARD</p><h3>Useful first. Reviewed before it goes live.</h3><p>Every Knowledge Hub article keeps its editorial state, reviewer identity, review time and note. Publishing is deliberately unavailable until that approval is retained.</p></div><div class="knowledge-editorial-proof"><strong>Draft → Review → Publish</strong><span>No anonymous approval. No disappearing review trail. No bypassing the existing CMS.</span></div></div>`);
        }
      }
      const head=section.querySelector('thead tr');if(head)head.innerHTML='<th>Article</th><th>Status</th><th>Topic</th><th>Owner</th><th>Editorial review</th><th>Actions</th><th>Updated</th>';
    }

    function knowledgeActions(a){
      const review=a.review||null,state=review?.decision||'unreviewed';
      if(a.status==='published')return `<div class="editorial-actions">${badge('published')}</div>`;
      if(state==='approved')return `<div class="editorial-actions"><button class="publish" data-knowledge-publish="${a.id}">Publish</button><button class="changes" data-knowledge-review="${a.id}" data-decision="changes_requested">Request changes</button></div>`;
      return `<div class="editorial-actions"><button class="approve" data-knowledge-review="${a.id}" data-decision="approved">Approve</button><button class="changes" data-knowledge-review="${a.id}" data-decision="changes_requested">Request changes</button></div>`;
    }

    function reviewCell(a){
      const r=a.review;if(!r)return '<span class="editorial-empty">Not reviewed yet</span>';
      return `<div class="editorial-review"><strong>${esc(r.decision==='approved'?'Approved':'Changes requested')} · ${esc(r.reviewer_name||'Named reviewer')}</strong><small>${esc(fmt(r.reviewed_at))}${r.notes?' · '+esc(r.notes):''}</small></div>`;
    }

    async function reviewHubArticle(id,decision){
      const note=prompt(decision==='approved'?'Approval note (recommended):':'What needs changing?')||'';
      if(decision==='changes_requested'&&!note.trim())return;
      try{await radarCall(`/v1/hq/articles/${id}/review`,{method:'POST',body:JSON.stringify({decision,notes:note})});await loadHubArticles()}catch(e){alert(e.message)}
    }

    async function publishHubArticle(id){
      if(!confirm('Publish this reviewed Knowledge Hub article now?'))return;
      try{await radarCall(`/v1/hq/articles/${id}/publish`,{method:'POST',body:'{}'});await loadHubArticles()}catch(e){alert(e.message)}
    }

    async function loadHubArticles(){
      installKnowledgeEditorialPresentation();
      const rows=$('#articleRows'); if(!rows) return;
      try {
        const j=await radarCall('/v1/hq/articles'), articles=j.articles||[];
        rows.innerHTML=articles.length?articles.map(a=>`<tr data-editorial-state="${esc(a.review?.decision||'unreviewed')}"><td><b>${esc(a.title)}</b><br><small>/${esc(a.slug)}</small></td><td>${badge(a.status)}</td><td>${esc(a.category||'—')}</td><td>${esc(a.author||'—')}</td><td>${reviewCell(a)}</td><td>${knowledgeActions(a)}</td><td>${esc(fmt(a.updated_at))}</td></tr>`).join(''):'<tr><td colspan="7">No Knowledge Hub articles yet.</td></tr>';
        $$('[data-knowledge-review]').forEach(b=>b.onclick=()=>reviewHubArticle(b.dataset.knowledgeReview,b.dataset.decision));
        $$('[data-knowledge-publish]').forEach(b=>b.onclick=()=>publishHubArticle(b.dataset.knowledgePublish));
      } catch(e) { rows.innerHTML=`<tr><td colspan="7">${esc(e.message)}</td></tr>`; }
    }

    function installRadarView() {
      if ($('#radar')) return;
      const nav=$('aside nav'), intelligence=nav?.querySelector('button[data-view="intelligence"]');
      const button=document.createElement('button');
      button.dataset.view='radar'; button.textContent='✦ Medicines Intelligence';
      if (intelligence?.nextSibling) nav.insertBefore(button,intelligence.nextSibling); else nav?.appendChild(button);
      const section=document.createElement('section'); section.id='radar'; section.className='view';
      section.innerHTML=`
        <div class="toolbar"><div><p class="eyebrow">SHIFT AI · OPERATIONS DESK</p><h2>Medicines Intelligence Desk</h2><p class="sub">Detect → verify → package → human review → publish → freshness, inside the existing HQ operating system.</p><p id="radarScanStatus" role="status"></p></div><div class="actions"><button id="scanRadar">Run source scan</button><button id="refreshRadar">Refresh Radar</button></div></div>
        <div class="cards compact-cards"><article><span>Review queue</span><strong id="radarQueueCount">—</strong><em>needs human action</em></article><article><span>Verified</span><strong id="radarVerifiedCount">—</strong><em>evidence gate passed</em></article><article><span>Medicines</span><strong id="radarMedicineCount">—</strong><em>living registry</em></article><article><span>Forward Radar</span><strong id="radarForwardCount">—</strong><em>future milestones</em></article></div>
        <div class="panel tablewrap"><div class="panelhead"><div><p class="eyebrow">REVIEW DESK</p><h3>Detected developments</h3></div></div><table><thead><tr><th>Development</th><th>Region</th><th>Status</th><th>Verification</th><th>Scores</th><th>Action</th></tr></thead><tbody id="radarRows"><tr><td colspan="6">Open Radar to load the queue.</td></tr></tbody></table></div>
        <div class="cms-grid"><article class="panel"><p class="eyebrow">GLOBAL MEDICINES</p><h3>Living registry</h3><div id="radarMedicines" class="cms-list"><div class="empty">No medicines loaded.</div></div></article><article class="panel"><p class="eyebrow">FORWARD RADAR</p><h3>What is coming next</h3><div id="radarForward" class="cms-list"><div class="empty">No milestones loaded.</div></div></article></div>
        <div class="panel"><p class="eyebrow">PUBLICATION</p><h3>Adapter jobs</h3><p class="sub">Approval prepares auditable work for website, Shift Brain, search/sitemap and related-content adapters. Publishing stays explicit.</p><div id="radarPublicationJobs" class="cms-list"><div class="empty">No publication jobs loaded.</div></div></div>`;
      const users=$('#users'); users?.parentNode?.insertBefore(section,users);
      button.onclick=()=>{ $$('.view').forEach(x=>x.classList.toggle('active',x.id==='radar')); $$('nav button[data-view]').forEach(x=>x.classList.toggle('active',x===button)); const title=$('#title'); if(title) title.textContent='Medicines intelligence, with a human hand on the publish button.'; loadRadar(); };
      $('#refreshRadar').onclick=loadRadar;
      $('#scanRadar').onclick=async()=>{const status=$('#radarScanStatus'),button=$('#scanRadar');button.disabled=true;status.textContent='Fetching authoritative medicine sources…';try{const result=await radarCall('/v1/hq/radar/scan',{method:'POST',body:'{}'});status.textContent=`Scan complete · ${Number(result.detected||result.ingested||0)} developments detected.`;await loadRadar()}catch(e){status.textContent=`Scan FAILED · ${e.message}`}finally{button.disabled=false}};
    }

    async function loadRadar(){
      try {
        const [qj,mj,fj,pj]=await Promise.all([radarCall('/v1/hq/radar/queue'),radarCall('/v1/hq/radar/medicines'),radarCall('/v1/hq/radar/forward'),radarCall('/v1/hq/radar/publication-jobs')]);
        const events=qj.events||[], meds=mj.medicines||[], forward=fj.milestones||[], jobs=pj.jobs||[];radarEvents=events;
        $('#radarQueueCount').textContent=events.length; $('#radarVerifiedCount').textContent=events.filter(x=>x.verification?.verified).length; $('#radarMedicineCount').textContent=meds.length; $('#radarForwardCount').textContent=forward.length;
        $('#radarRows').innerHTML=events.length?events.map(x=>`<tr data-radar-event="${Number(x.id)}"><td><b>${esc(x.headline)}</b><br><small>${esc(x.regulator||x.event_type||'development')}</small></td><td>${esc(x.region||'GLOBAL')}</td><td>${badge(x.status)}</td><td>${x.verification?.verified?'<span class="badge">Verified</span>':'<span class="badge">Needs evidence</span>'}<br><small>${esc(x.verification?.reason||'')}</small></td><td>Urgency ${Number(x.urgency_score||0)}<br>Relevance ${Number(x.relevance_score||0)}</td><td>${radarActions(x)}</td></tr>`).join(''):'<tr><td colspan="6">Nothing waiting for review.</td></tr>';
        $('#radarMedicines').innerHTML=meds.length?meds.slice(0,40).map(x=>`<div class="cms-item"><b>${esc(x.brand||x.generic_name||x.id)}</b><span>${esc(x.generic_name||'')} · Radar ${Number(x.radar_score||0)}</span><span>${esc(x.global_stage||'Unknown stage')} · UK: ${esc(x.uk_regulatory_status||'Unknown')} · NICE: ${esc(x.nice_status||'Unknown')} · NHS: ${esc(x.nhs_status||'Unknown')}</span></div>`).join(''):'<div class="empty">No approved medicines yet.</div>';
        $('#radarForward').innerHTML=forward.length?forward.slice(0,30).map(x=>`<div class="cms-item"><b>${esc(x.title||x.milestone||'Forward milestone')}</b><span>${esc(x.due_at||x.expected_at||'Date TBC')} · ${esc(x.status||'watching')}</span></div>`).join(''):'<div class="empty">No Forward Radar milestones yet.</div>';
        $('#radarPublicationJobs').innerHTML=jobs.length?jobs.slice(0,30).map(x=>`<div class="cms-item"><b>Event #${x.event_id} · ${esc(x.status)}</b><span>${esc(fmt(x.created_at))}${x.error_text?' · '+esc(x.error_text):''}</span>${x.status==='queued'?`<div class="row-actions"><button data-radar-publish="${x.event_id}">Publish to configured adapters</button></div>`:''}</div>`).join(''):'<div class="empty">No publication jobs yet.</div>';
        $$('[data-radar-open]').forEach(b=>b.onclick=()=>openRadarEvent(b.dataset.radarOpen));
        $$('[data-radar-publish]').forEach(b=>b.onclick=()=>radarReview(b.dataset.radarPublish,'publish'));
        if(requestedEvent){
          const target=document.querySelector(`[data-radar-event="${requestedEvent}"]`);
          if(target){if(!openedDeepLink){openedDeepLink=true;openRadarEvent(requestedEvent);}}
          else if($('#radarScanStatus')) $('#radarScanStatus').textContent=`Event #${requestedEvent} is not in the current review queue.`;
        }
      } catch(e) { const rows=$('#radarRows'); if(rows) rows.innerHTML=`<tr><td colspan="6">${esc(e.message)}</td></tr>`; }
    }

    function installMedicineControls(){
      const nav=$('aside nav'),productsButton=nav?.querySelector('button[data-view="products"]');
      let button=nav?.querySelector('button[data-view="medicines"]');
      if(!button){
        button=document.createElement('button');
        button.dataset.view='medicines';
        button.textContent='⚕ Medicines';
        if(productsButton?.nextSibling)nav.insertBefore(button,productsButton.nextSibling);else nav?.appendChild(button);
      }
      let section=$('#medicines');
      if(!section){
        section=document.createElement('section');
        section.id='medicines';
        section.className='view';
        section.innerHTML=`
          <div class="toolbar"><div><p class="eyebrow">MEDICINE COMMERCE</p><h2>Medicines, strengths, stock & margins</h2><p class="sub">The working catalogue: product availability, strength-level cost and selling price, real stock and gross margin.</p></div><div class="toolbar-actions"><a class="button" href="${API}/hq/catalogue-controls" target="_blank" rel="noopener">Images & full catalogue</a><button id="refreshMedicines">Refresh</button></div></div>
          <div class="callout medicine-boundary">A medicine is buyable only when the medicine and its strength are both available and remaining stock is above zero.</div>
          <p id="medicineControlStatus" role="status">Open Medicines to load the live catalogue.</p>
          <div id="medicineControlList"></div>`;
        const products=$('#products');products?.parentNode?.insertBefore(section,products.nextSibling);
      }
      button.onclick=()=>{
        $('.view').forEach(x=>x.classList.toggle('active',x.id==='medicines'));
        $('nav button[data-view]').forEach(x=>x.classList.toggle('active',x===button));
        const title=$('#title');if(title)title.textContent='Medicines, prices, stock and margin — in one place.';
        loadMedicineControls();
      };
      $('#refreshMedicines').onclick=loadMedicineControls;
      const link=document.querySelector('a[href="https://api.shiftsometimber.co.uk/hq/catalogue-controls"]');
      if(link){link.textContent='Images & full catalogue';link.onclick=null;}
    }

    async function openMedicineControls(){
      let dialog=$('#medicineControls');
      if(!dialog){
        dialog=document.createElement('dialog');
        dialog.id='medicineControls';
        dialog.className='wide-dialog';
        document.body.appendChild(dialog);
      }
      dialog.innerHTML='<div style="padding:24px"><button type="button" data-close-medicine style="float:right" aria-label="Close">×</button><p class="eyebrow">MEDICINE COMMERCE</p><h2>Medicines, prices and real stock</h2><p class="sub">A treatment is buyable only when its product and strength are available and remaining stock is above zero.</p><p id="medicineControlStatus">Loading live catalogue…</p><div id="medicineControlList"></div></div>';
      dialog.querySelector('[data-close-medicine]').onclick=()=>dialog.close();
      dialog.showModal();
      await loadMedicineControls();
    }

    async function loadMedicineControls(){
      const status=$('#medicineControlStatus'),list=$('#medicineControlList');
      try{
        const data=await radarCall('/v1/hq/medicines');
        const medicines=(data.medicines||[]).filter(m=>m.status!=='archived');
        status.textContent=`${medicines.length} medicines loaded from Shift Core.`;
        list.innerHTML=medicines.map(m=>`<article class="panel" data-medicine="${Number(m.id)}"><form data-medicine-form="${Number(m.id)}"><div class="toolbar"><div><h3>${esc(m.name)}</h3><p class="sub">${esc(m.activeIngredient||m.active_ingredient||'')}</p></div><label>Product status<select name="status"><option value="out_of_stock" ${m.status==='out_of_stock'?'selected':''}>Out of stock</option><option value="available" ${m.status==='available'?'selected':''}>Available</option></select></label><button type="submit">Save product</button></div></form><div class="cms-list">${(m.variants||[]).filter(v=>v.status!=='archived').map(v=>`<form class="cms-item" data-variant-form="${Number(v.id)}"><b>${esc(v.strengthLabel)}</b><div class="form-grid"><label>Cost (£)<input name="cost" type="number" min="0.01" step="0.01" value="${(Number(v.costPence)/100).toFixed(2)}" required></label><label>Selling (£)<input name="selling" type="number" min="0.01" step="0.01" value="${(Number(v.sellingPricePence)/100).toFixed(2)}" required></label><label>Remaining stock<input name="stock" type="number" min="0" step="1" value="${Number(v.stockOnHand||0)}" required></label><label>Availability<select name="status"><option value="out_of_stock" ${v.status==='out_of_stock'?'selected':''}>Out of stock</option><option value="available" ${v.status==='available'?'selected':''}>Available</option></select></label><button type="submit">Save strength</button></div><span>Gross profit ${money(v.marginPence)} · margin ${Number(v.marginPercent||0).toFixed(2)}% · ${Number(v.reserved||0)} reserved</span><small role="status"></small></form>`).join('')}</div></article>`).join('');
        $$('[data-medicine-form]').forEach(form=>form.onsubmit=async event=>{event.preventDefault();const select=form.elements.status,button=form.querySelector('button');button.disabled=true;try{await radarCall(`/v1/hq/medicines/${form.dataset.medicineForm}`,{method:'PATCH',body:JSON.stringify({status:select.value})});await loadMedicineControls()}catch(e){status.textContent=e.message}finally{button.disabled=false}});
        $$('[data-variant-form]').forEach(form=>form.onsubmit=async event=>{event.preventDefault();const fields=new FormData(form),message=form.querySelector('[role=status]'),button=form.querySelector('button');button.disabled=true;message.textContent='Saving…';try{const result=await radarCall(`/v1/hq/medicine-variants/${form.dataset.variantForm}`,{method:'PATCH',body:JSON.stringify({costPence:Math.round(Number(fields.get('cost'))*100),sellingPricePence:Math.round(Number(fields.get('selling'))*100),stockOnHand:Number(fields.get('stock')),status:fields.get('status')})});message.textContent=`Saved · margin ${Number(result.marginPercent||0).toFixed(2)}%`;await loadMedicineControls()}catch(e){message.textContent=e.message}finally{button.disabled=false}});
      }catch(e){status.textContent=`Medicine catalogue failed: ${e.message}`;list.innerHTML=''}
    }

    function radarActions(x){
      return `<button data-radar-open="${Number(x.id)}">Review update</button>`;
    }

    function radarField(label,name,value,rows=3){return `<label>${esc(label)}<textarea name="${esc(name)}" rows="${rows}">${esc(value||'')}</textarea></label>`}
    function radarPackageFrom(form){
      const contentPackage={};for(const name of ['headline','standfirst','what_changed','why_it_matters_to_uk','safety','article_markdown','ticker_line','dossier_amendment'])contentPackage[name]=form.elements[name]?.value||'';
      for(const name of ['known_facts','unknowns'])try{contentPackage[name]=JSON.parse(form.elements[name]?.value||'[]')}catch{throw new Error(`${name.replaceAll('_',' ')} must be valid JSON.`)}
      const destinations=radarDestinations.filter(name=>form.querySelector(`[name="destination_${name}"]`)?.checked);contentPackage.destinations=destinations;
      return{contentPackage,medicinePatch:{medicine_id:form.elements.medicine_id?.value||''},destinations,note:form.elements.review_note?.value||''};
    }
    async function openRadarEvent(id){
      const event=radarEvents.find(x=>String(x.id)===String(id));if(!event){if($('#radarScanStatus'))$('#radarScanStatus').textContent=`Event #${id} is not in the current review queue.`;return}
      let dialog=$('#radarEventEditor');if(!dialog){dialog=document.createElement('dialog');dialog.id='radarEventEditor';dialog.className='wide-dialog';document.body.appendChild(dialog)}
      const c=event.content_package||{},m=event.medicine_patch||{},sources=event.source_evidence||[],selected=new Set(c.destinations||[]),canPublish=['approved','publish_failed'].includes(event.status);
      dialog.innerHTML=`<form id="radarEventForm" style="padding:24px"><button type="button" data-close-radar style="float:right" aria-label="Close">×</button><p class="eyebrow">SHIFT AI · EVENT #${Number(event.id)}</p><h2>${esc(event.headline)}</h2><p>${badge(event.status)} ${badge(event.verification?.verified?'Evidence verified':'Evidence needs review')} · Urgency ${Number(event.urgency_score||0)} · Relevance ${Number(event.relevance_score||0)}</p><section class="panel"><h3>Evidence</h3>${sources.length?sources.map(s=>`<p><strong>Level ${Number(s.source_tier||4)} · ${esc(s.authority||event.regulator||'Source')}</strong><br><a href="${esc(s.url||s.source_url||'#')}" target="_blank" rel="noopener">${esc(s.title||s.url||s.source_url||'Open original source')}</a><br><small>Source ${esc(fmt(s.source_date))} · retrieved ${esc(fmt(s.retrieved_at,true))}</small></p>`).join(''):'<p>No evidence record is attached. Do not approve.</p>'}</section><section class="panel"><h3>Editable publication package</h3><label>Medicine / candidate ID<input name="medicine_id" value="${esc(m.medicine_id||'')}"></label>${radarField('Headline','headline',c.headline||event.headline,2)}${radarField('Standfirst','standfirst',c.standfirst)}${radarField('What changed','what_changed',c.what_changed,5)}${radarField('What it means in the UK','why_it_matters_to_uk',c.why_it_matters_to_uk,5)}${radarField('Known facts (JSON)','known_facts',JSON.stringify(c.known_facts||[],null,2),7)}${radarField('Unknowns (JSON)','unknowns',JSON.stringify(c.unknowns||[],null,2),6)}${radarField('Safety wording','safety',c.safety,4)}${radarField('Full article','article_markdown',c.article_markdown,14)}${radarField('Ticker line','ticker_line',c.ticker_line,2)}${radarField('Dossier amendment','dossier_amendment',c.dossier_amendment,5)}<fieldset><legend>Approved destinations</legend>${radarDestinations.map(d=>`<label><input type="checkbox" name="destination_${d}" ${selected.has(d)?'checked':''}> ${esc(d.replaceAll('_',' '))}</label>`).join('')}</fieldset><label>Decision note<textarea name="review_note" rows="3">${esc(event.review_note||'')}</textarea></label></section><p id="radarEventState" role="status"></p><div class="actions"><button type="button" data-radar-save>Save modifications</button><button type="button" data-radar-decide="approve">Approve</button><button type="button" class="ghost" data-radar-decide="hold">Hold</button><button type="button" class="ghost" data-radar-decide="reject">Decline</button>${canPublish?'<button type="button" class="primary" data-radar-publish-now>Publish approved update</button>':''}</div><p class="sub">Approval and publication are separate audited actions. Nothing goes live merely because this editor opened.</p></form>`;
      dialog.querySelector('[data-close-radar]').onclick=()=>dialog.close();
      const form=dialog.querySelector('#radarEventForm'),state=dialog.querySelector('#radarEventState');
      dialog.querySelector('[data-radar-save]').onclick=async()=>{state.textContent='Saving…';try{await radarCall(`/v1/hq/radar/events/${event.id}`,{method:'PATCH',body:JSON.stringify(radarPackageFrom(form))});state.textContent='Modifications saved and audited.';await loadRadar()}catch(e){state.textContent=`Save failed: ${e.message}`}};
      dialog.querySelectorAll('[data-radar-decide]').forEach(button=>button.onclick=async()=>{const action=button.dataset.radarDecide,payload=action==='approve'?radarPackageFrom(form):{note:form.elements.review_note.value};state.textContent=`${action==='approve'?'Approving':action==='hold'?'Holding':'Declining'}…`;try{await radarCall(`/v1/hq/radar/events/${event.id}/${action}`,{method:'POST',body:JSON.stringify(payload)});state.textContent=`${action==='approve'?'Approved for publication':'Decision saved'} and audited.`;await loadRadar();setTimeout(()=>openRadarEvent(event.id),0)}catch(e){state.textContent=`Decision failed: ${e.message}`}});
      dialog.querySelector('[data-radar-publish-now]')?.addEventListener('click',async()=>{state.textContent='Publishing approved destinations…';try{await radarCall(`/v1/hq/radar/events/${event.id}/publish`,{method:'POST',body:'{}'});state.textContent='Published and audited.';await loadRadar()}catch(e){state.textContent=`Publish failed: ${e.message}`}});
      if(!dialog.open)dialog.showModal();
    }

    async function radarReview(id,action){
      let note=''; if(['approve','hold','reject'].includes(action)) note=prompt(action==='approve'?'Optional approval note:':action==='hold'?'Reason for hold:':'Reason for rejection:')||'';
      try { await radarCall(`/v1/hq/radar/events/${id}/${action}`,{method:'POST',body:JSON.stringify({note})}); await loadRadar(); } catch(e) { alert(e.message); }
    }

    function installEvidenceDeskView(){
      if($('#evidencedesk'))return;
      const css=document.createElement('link');css.rel='stylesheet';css.href='hq-evidence-desk.css?v=1';css.dataset.evidenceDesk='true';document.head.appendChild(css);
      const nav=$('aside nav'),knowledge=nav?.querySelector('button[data-view="knowledgehub"]')||nav?.querySelector('button[data-view="knowledge"]');
      const button=document.createElement('button');button.dataset.view='evidencedesk';button.textContent='⌁ Evidence Desk';
      if(knowledge?.nextSibling)nav.insertBefore(button,knowledge.nextSibling);else nav?.appendChild(button);
      const section=document.createElement('section');section.id='evidencedesk';section.className='view';
      section.innerHTML=`
        <div class="toolbar evidence-toolbar"><div><p class="eyebrow">SHIFT EVIDENCE INBOX · READ ONLY</p><h2>Keep the website true when the evidence moves.</h2><p class="sub">Source → structured fact → Shift claim → exact page → recorded package. This screen reports the machine truth; it cannot grant a review or publish.</p></div><div class="toolbar-actions"><button id="evidenceRefresh">Refresh</button></div></div>
        <div class="evidence-environment"><strong>Environment: non-production / staging</strong><span>Nothing shown here is live medical-safety copy.</span></div>
        <div id="evidenceControl" class="evidence-control">Loading control state…</div>
        <div class="evidence-operation-grid" aria-label="Evidence Desk operational state">
          <article><span>Source monitoring</span><strong id="evidenceMonitoringState">Loading</strong><em id="evidenceMonitoringDetail">Awaiting control response</em></article>
          <article><span>Automatic drafting</span><strong id="evidenceDraftingState">Loading</strong><em id="evidenceDraftingDetail">Awaiting control response</em></article>
          <article><span>Website destination</span><strong id="evidenceWebsiteState">Loading</strong><em>Approval-driven only</em></article>
          <article><span>Newsletter destination</span><strong id="evidenceNewsletterState">Loading</strong><em>Separate destination approval</em></article>
          <article><span>Social destinations</span><strong id="evidenceSocialState">Loading</strong><em>Separate destination approval</em></article>
          <article><span>Production authority</span><strong id="evidenceAuthorityState">Loading</strong><em>Never implied by staging</em></article>
        </div>
        <div class="cards compact-cards evidence-cards"><article><span>Allowlisted sources</span><strong id="evidenceSourceCount">—</strong><em id="evidenceSourceActive">— active</em></article><article><span>Mapped claims</span><strong id="evidenceClaimCount">—</strong><em>claim-to-page spine</em></article><article><span>Open changes</span><strong id="evidenceEventCount">—</strong><em>need mapping or a decision</em></article><article><span>Decision packages</span><strong id="evidencePackageCount">—</strong><em id="evidenceNoPublish">— no-publish decisions</em></article></div>
        <div class="panel evidence-principle"><div><p class="eyebrow">OPERATING STANDARD</p><h3>One worthwhile action. Publishing nothing is allowed.</h3><p>“Editorial accepted” appears only after a retained editorial acceptance. Specialist review and publication authority are independent gates; neither is inferred from a draft, a model or a staging preview.</p></div><div class="evidence-lock-stack"><span>Specialist review: package-specific</span><span>Publication: disabled unless every gate passes</span><span>Newsletter: separate approval</span><span>Social: separate approval</span></div></div>
        <div class="panel tablewrap"><div class="panelhead"><div><p class="eyebrow">EVIDENCE INBOX</p><h3>Persisted packages awaiting governed review</h3></div></div><table><thead><tr><th>Package</th><th>Lane</th><th>Mapping &amp; copy</th><th>Editorial</th><th>Specialist review</th><th>Publication</th></tr></thead><tbody id="evidencePackageRows"><tr><td colspan="6">Open Evidence Inbox to load packages.</td></tr></tbody></table></div>
        <div class="panel tablewrap"><div class="panelhead"><div><p class="eyebrow">CHANGE RECORD</p><h3>Material source changes and claim impact</h3></div></div><table><thead><tr><th>Source change</th><th>Materiality</th><th>Affected claims/pages</th><th>Lane</th><th>State</th><th>Action</th></tr></thead><tbody id="evidenceEventRows"><tr><td colspan="6">No changes loaded.</td></tr></tbody></table></div>
        <div class="cms-grid"><article class="panel"><p class="eyebrow">SOURCE REGISTRY</p><h3>Approved source families</h3><div id="evidenceSources" class="cms-list"><div class="empty">No sources loaded.</div></div></article><article class="panel"><p class="eyebrow">CLAIM MAP</p><h3>Claims with exact page dependencies</h3><div id="evidenceClaims" class="cms-list"><div class="empty">No mapped claims yet.</div></div></article></div>`;
      const users=$('#users');users?.parentNode?.insertBefore(section,users);
      button.onclick=()=>{$$('.view').forEach(x=>x.classList.toggle('active',x.id==='evidencedesk'));$$('nav button[data-view]').forEach(x=>x.classList.toggle('active',x===button));const title=$('#title');if(title)title.textContent='The governed record when evidence moves.';loadEvidenceDesk()};
      $('#evidenceRefresh').onclick=loadEvidenceDesk;
    }

    function evidenceOperational(overview){
      const base=overview.control||{},operation=overview.operational||overview.operationalControl||{},locks=overview.locks||{};
      const known=(key,fallback)=>Object.prototype.hasOwnProperty.call(operation,key)?Number(operation[key])===1:fallback;
      return{
        monitoring:known('monitoring_enabled',Number(base.ingestion_enabled)===1),
        drafting:known('drafting_enabled',locks.model===false),
        website:known('website_enabled',locks.websitePublish===false),
        newsletter:known('newsletter_enabled',locks.newsletter===false),
        social:known('social_enabled',locks.social===false),
        authority:known('production_authority_enabled',false),
        shutdown:operation.shutdown_reason||base.stop_reason||'',
        cadence:overview.monitoringCadence||operation.cadence||'Scheduled adapter checks'
      };
    }
    function setEvidenceState(id,on,onText='Enabled',offText='Disabled'){const node=$('#'+id);if(!node)return;node.textContent=on?onText:offText;node.classList.toggle('is-on',!!on);node.classList.toggle('is-off',!on)}
    function evidenceEditorial(pkg){
      const accepted=Number(pkg.editorial_accepted)===1||['editorial_accepted','approved_web_pending_publish'].includes(pkg.status)||['approve_web_only','approved'].includes(pkg.editorial_decision);
      if(accepted)return '<span class="evidence-clear">Editorial accepted</span>';
      if(pkg.status==='changes_required')return '<span class="evidence-gate">Editorial: changes required</span>';
      if(pkg.editorial_reviewed_at)return '<span class="evidence-gate">Editorial reviewed — acceptance not recorded</span>';
      return '<span class="evidence-gate">Editorial: not obtained</span>';
    }
    function evidenceSpecialists(pkg){
      const clinicalRequired=Number(pkg.qualified_review_required)===1,commsRequired=Number(pkg.communications_review_required)===1;
      const clinical=!!pkg.qualified_reviewed_at,comms=!!pkg.communications_reviewed_at,labels=[];
      if((clinicalRequired||commsRequired)&&!clinical&&!comms)labels.push('<span class="evidence-gate">Specialist review: not obtained</span><br>');
      if(clinicalRequired)labels.push(`<span class="${clinical?'evidence-clear':'evidence-gate'}">Clinical: ${clinical?'obtained':'not obtained'}</span>`);
      if(commsRequired)labels.push(`<span class="${comms?'evidence-clear':'evidence-gate'}">Medicines comms: ${comms?'obtained':'not obtained'}</span>`);
      return labels.length?labels.join(''):'<span class="evidence-clear">Specialist review: not required</span>';
    }
    function evidenceMapping(pkg){
      const changes=Array.isArray(pkg.proposedChanges)?pkg.proposedChanges:[],revision=[...changes].reverse().find(x=>x&&(x.pagePath||x.page_path||x.proposedText||x.after))||{};
      const page=revision.pagePath||revision.page_path||pkg.page_path||'',hash=revision.copyHash||revision.copySha256||revision.copy_sha256||pkg.copy_hash||pkg.copy_sha256||'';
      return `${page?`<b>${esc(page)}</b>`:'<span class="evidence-gate">Exact page not recorded</span>'}${hash?`<br><small>Copy SHA-256 ${esc(hash)}</small>`:'<br><span class="evidence-gate">Exact copy required</span>'}`;
    }
    function evidencePublication(pkg,operation){
      const specialistBlocked=(Number(pkg.qualified_review_required)&&!pkg.qualified_reviewed_at)||(Number(pkg.communications_review_required)&&!pkg.communications_reviewed_at);
      const enabled=operation.website&&operation.authority&&!specialistBlocked&&Number(pkg.web_eligible)===1;
      return enabled?'<span class="evidence-clear">Publication eligible</span><br><small>Still requires package preflight</small>':'<span class="evidence-gate">Publication: disabled</span><br><small>Preflight fails closed</small>';
    }
    async function loadEvidenceDesk(){
      try{
        const [overview,sources,claims,events,packages]=await Promise.all(['/overview','/sources','/claims','/events','/packages'].map(path=>radarCall('/v1/hq/evidence-desk'+path)));
        const control=overview.control||{},counts=overview.counts||{},operation=evidenceOperational(overview);
        $('#evidenceSourceCount').textContent=Number(counts.sources?.total||0);$('#evidenceSourceActive').textContent=`${Number(counts.sources?.active||0)} active`;
        $('#evidenceClaimCount').textContent=Number(counts.claims?.active||0);$('#evidenceEventCount').textContent=Number(counts.events?.open||0);$('#evidencePackageCount').textContent=Number(counts.packages?.total||0);$('#evidenceNoPublish').textContent=`${Number(counts.packages?.no_publication||0)} no-publish decisions`;
        $('#evidenceControl').innerHTML=`<strong>${operation.monitoring?'Controlled monitoring enabled':'Evidence Desk sealed'}</strong><span>${operation.monitoring?'Structured source checks are active':'Source checks are off'} · ${operation.drafting?'evidence-bound drafting enabled':'automatic drafting disabled'} · publication remains approval-driven</span>${operation.shutdown?`<small>Stopped: ${esc(operation.shutdown)}</small>`:''}`;
        setEvidenceState('evidenceMonitoringState',operation.monitoring,'Enabled','Disabled');setEvidenceState('evidenceDraftingState',operation.drafting,'Enabled','Disabled');setEvidenceState('evidenceWebsiteState',operation.website,'Enabled','Disabled');setEvidenceState('evidenceNewsletterState',operation.newsletter,'Enabled','Disabled');setEvidenceState('evidenceSocialState',operation.social,'Enabled','Disabled');setEvidenceState('evidenceAuthorityState',operation.authority,'Granted','Not granted');
        $('#evidenceMonitoringDetail').textContent=operation.monitoring?operation.cadence:'Shutdown prevents fetch';$('#evidenceDraftingDetail').textContent=operation.drafting?'Exact copy remains SHA-locked':'No model drafting will run';
        $('#evidenceSources').innerHTML=(sources.sources||[]).map(source=>`<div class="cms-item"><b>${esc(source.name)}</b><span>${esc(source.family.toUpperCase())} · ${esc(source.extraction_method.replaceAll('_',' '))} · ${esc(source.status)}</span><span>${esc(source.authority_name)} · ${esc(source.canonical_url)}</span></div>`).join('')||'<div class="empty">Load the founding source registry. Sources remain draft until their adapter is proved.</div>';
        $('#evidenceClaims').innerHTML=(claims.claims||[]).map(claim=>`<div class="cms-item"><b>${esc(claim.claim_text)}</b><span>${esc(claim.risk_lane)} · ${esc(claim.communication_class.replaceAll('_',' '))}</span><span>${Number(claim.dependency_count)} source dependencies · ${Number(claim.page_count)} page placements</span></div>`).join('')||'<div class="empty">No claim-to-page dependencies have been commissioned yet.</div>';
        const list=packages.packages||[];$('#evidencePackageRows').innerHTML=list.length?list.map(pkg=>`<tr><td><b>#${Number(pkg.id)} · ${esc(pkg.title)}</b><br><small>${esc(pkg.summary)}</small><br>${badge(pkg.status)}</td><td><span class="evidence-lane ${esc(pkg.risk_lane)}">${esc(pkg.risk_lane)}</span><br><small>${esc(String(pkg.communication_class||'').replaceAll('_',' '))}</small></td><td>${evidenceMapping(pkg)}</td><td>${evidenceEditorial(pkg)}</td><td>${evidenceSpecialists(pkg)}</td><td>${evidencePublication(pkg,operation)}<br><span class="evidence-read-only">Read only</span></td></tr>`).join(''):'<tr><td colspan="6">Nothing is waiting in the Inbox. Silence is a valid result.</td></tr>';
        const eventList=events.events||[];$('#evidenceEventRows').innerHTML=eventList.length?eventList.map(event=>`<tr><td><b>${esc(event.headline)}</b><br><small>${esc(fmt(event.created_at))}</small></td><td>${esc(event.materiality.replaceAll('_',' '))}</td><td>${(event.impactedClaims||[]).length?`${event.impactedClaims.length} claim(s)<br><small>${(event.impactedClaims||[]).flatMap(x=>x.pages||[]).length} exact page placement(s)</small>`:'<span class="evidence-gate">Mapping required</span>'}</td><td><span class="evidence-lane ${esc(event.risk_lane)}">${esc(event.risk_lane)}</span></td><td>${badge(event.status)}</td><td>${event.package_id?`Package #${event.package_id}`:'No package'}</td></tr>`).join(''):'<tr><td colspan="6">No material source changes recorded.</td></tr>';
      }catch(e){const rows=$('#evidencePackageRows');if(rows)rows.innerHTML=`<tr><td colspan="6">${esc(e.message)}</td></tr>`}
    }

    function installWebsiteUpdater(){
      const host=$('#contentList'),create=$('#newContent');
      if(!host||!create)return;
      const render=async()=>{
        host.innerHTML='<div class="empty">Loading controlled public fields…</div>';
        try{
          const data=await radarCall('/v1/hq/site-content');
          const rows=data.content||[];
          host.innerHTML=rows.length?rows.map(x=>`<article class="cms-item" data-site-content="${Number(x.id)}"><b>${esc(x.label)}</b><span>${esc(x.page_path)} · ${badge(x.status)} · version ${Number(x.version||1)}</span><textarea aria-label="${esc(x.label)} text">${esc(x.draft_text||'')}</textarea><div class="actions"><button data-site-preview="${Number(x.id)}">Preview</button><button data-site-publish="${Number(x.id)}">Publish</button><button data-site-rollback="${Number(x.id)}">Rollback</button></div><p role="status"></p></article>`).join(''):'<div class="empty">No controlled public fields yet.</div>';
          $$('[data-site-preview],[data-site-publish],[data-site-rollback]').forEach(button=>button.onclick=async()=>{
            const id=button.dataset.sitePreview||button.dataset.sitePublish||button.dataset.siteRollback,card=button.closest('[data-site-content]'),text=card.querySelector('textarea').value,status=card.querySelector('[role=status]'),action=button.dataset.sitePreview?'preview':button.dataset.sitePublish?'publish':'rollback';
            button.disabled=true;status.textContent=action==='preview'?'Preparing preview…':action==='publish'?'Publishing…':'Rolling back…';
            try{const result=await radarCall(`/v1/hq/site-content/${id}`,{method:'PATCH',body:JSON.stringify({action,text})});if(action==='preview'){const p=result.preview||{};status.textContent=`Preview only · ${p.pagePath||''} · current: ${p.currentText||'underlying page wording'} · proposed: ${p.draftText||text}`;}else{status.textContent=`Committed · ${result.status} · version ${Number(result.version||0)}`;await render();}}catch(e){status.textContent=`FAILED · ${e.message}`;}finally{button.disabled=false;}
          });
        }catch(e){host.innerHTML=`<div class="empty">Website updater failed: ${esc(e.message)}</div>`;}
      };
      create.hidden=true;
      const heading=$('#website .toolbar .sub');if(heading)heading.textContent='Preview, publish and roll back controlled public fields against the live delivery state.';
      const button=$('#website .toolbar button');if(button){button.hidden=false;button.textContent='Refresh live state';button.onclick=render;}
      document.querySelector('nav button[data-view="website"]')?.addEventListener('click',()=>setTimeout(render,0));
    }

    rationaliseKnowledgeNavigation();
    installKnowledgeEditorialPresentation();
    installMedicineControls();
    installWebsiteUpdater();
    installRadarView();
    installEvidenceDeskView();
    if(requestedView==='radar'){
      const openDeepLink=()=>document.querySelector('nav button[data-view="radar"]')?.click();
      if(S.me) openDeepLink(); else {
        const loginObserver=new MutationObserver(()=>{if(S.me){loginObserver.disconnect();openDeepLink();}});
        loginObserver.observe(document.body,{subtree:true,childList:true,attributes:true});
      }
    }
  };
  legacy.onerror = () => console.error('Shift HQ V1.11 runtime failed to load');
  document.head.appendChild(legacy);
})();
