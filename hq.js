(() => {
  const legacy = document.createElement('script');
  legacy.src = 'hq-v111.js?v=11';
  legacy.onload = () => {
    const $ = s => document.querySelector(s);
    const $$ = s => [...document.querySelectorAll(s)];
    const esc = v => String(v ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot',"'":'&#39;'}[c]));
    const API = 'https://api.shiftsometimber.co.uk';
    const fmt = d => { if (!d) return '—'; try { return new Date(d).toLocaleString('en-GB',{dateStyle:'medium',timeStyle:'short'}); } catch { return d; } };
    const badge = v => `<span class="badge">${esc(String(v || '—').replaceAll('_',' '))}</span>`;

    async function radarCall(path, opts={}) {
      const r = await fetch(API + path, { ...opts, credentials:'include', headers:{'Accept':'application/json','Content-Type':'application/json',...(opts.headers||{})} });
      let data={}; try { data=await r.json(); } catch {}
      if (!r.ok) throw new Error(data.message || data.error || `Shift Core ${r.status}`);
      return data;
    }

    function ensureKnowledgeStyles(){
      if(document.querySelector('link[data-g3-006]'))return;
      const link=document.createElement('link');link.rel='stylesheet';link.href='hq-knowledge-editorial.css?v=1';link.dataset.g3006='true';document.head.appendChild(link);
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
      button.dataset.view='radar'; button.textContent='◉ Shift Radar';
      if (intelligence?.nextSibling) nav.insertBefore(button,intelligence.nextSibling); else nav?.appendChild(button);
      const section=document.createElement('section'); section.id='radar'; section.className='view';
      section.innerHTML=`
        <div class="toolbar"><div><p class="eyebrow">WORLDWIDE INTELLIGENCE</p><h2>Shift Radar</h2><p class="sub">Detect → verify → package → human review → publish → freshness, inside the existing HQ operating system.</p></div><button id="refreshRadar">Refresh Radar</button></div>
        <div class="cards compact-cards"><article><span>Review queue</span><strong id="radarQueueCount">—</strong><em>needs human action</em></article><article><span>Verified</span><strong id="radarVerifiedCount">—</strong><em>evidence gate passed</em></article><article><span>Medicines</span><strong id="radarMedicineCount">—</strong><em>living registry</em></article><article><span>Forward Radar</span><strong id="radarForwardCount">—</strong><em>future milestones</em></article></div>
        <div class="panel tablewrap"><div class="panelhead"><div><p class="eyebrow">REVIEW DESK</p><h3>Detected developments</h3></div></div><table><thead><tr><th>Development</th><th>Region</th><th>Status</th><th>Verification</th><th>Scores</th><th>Action</th></tr></thead><tbody id="radarRows"><tr><td colspan="6">Open Radar to load the queue.</td></tr></tbody></table></div>
        <div class="cms-grid"><article class="panel"><p class="eyebrow">GLOBAL MEDICINES</p><h3>Living registry</h3><div id="radarMedicines" class="cms-list"><div class="empty">No medicines loaded.</div></div></article><article class="panel"><p class="eyebrow">FORWARD RADAR</p><h3>What is coming next</h3><div id="radarForward" class="cms-list"><div class="empty">No milestones loaded.</div></div></article></div>
        <div class="panel"><p class="eyebrow">PUBLICATION</p><h3>Adapter jobs</h3><p class="sub">Approval prepares auditable work for website, Shift Brain, search/sitemap and related-content adapters. Publishing stays explicit.</p><div id="radarPublicationJobs" class="cms-list"><div class="empty">No publication jobs loaded.</div></div></div>`;
      const users=$('#users'); users?.parentNode?.insertBefore(section,users);
      button.onclick=()=>{ $$('.view').forEach(x=>x.classList.toggle('active',x.id==='radar')); $$('nav button[data-view]').forEach(x=>x.classList.toggle('active',x===button)); const title=$('#title'); if(title) title.textContent='Worldwide intelligence, with a human hand on the publish button.'; loadRadar(); };
      $('#refreshRadar').onclick=loadRadar;
    }

    async function loadRadar(){
      try {
        const [qj,mj,fj,pj]=await Promise.all([radarCall('/v1/hq/radar/queue'),radarCall('/v1/hq/radar/medicines'),radarCall('/v1/hq/radar/forward'),radarCall('/v1/hq/radar/publication-jobs')]);
        const events=qj.events||[], meds=mj.medicines||[], forward=fj.milestones||[], jobs=pj.jobs||[];
        $('#radarQueueCount').textContent=events.length; $('#radarVerifiedCount').textContent=events.filter(x=>x.verification?.verified).length; $('#radarMedicineCount').textContent=meds.length; $('#radarForwardCount').textContent=forward.length;
        $('#radarRows').innerHTML=events.length?events.map(x=>`<tr><td><b>${esc(x.headline)}</b><br><small>${esc(x.regulator||x.event_type||'development')}</small></td><td>${esc(x.region||'GLOBAL')}</td><td>${badge(x.status)}</td><td>${x.verification?.verified?'<span class="badge">Verified</span>':'<span class="badge">Needs evidence</span>'}<br><small>${esc(x.verification?.reason||'')}</small></td><td>Urgency ${Number(x.urgency_score||0)}<br>Relevance ${Number(x.relevance_score||0)}</td><td>${radarActions(x)}</td></tr>`).join(''):'<tr><td colspan="6">Nothing waiting for review.</td></tr>';
        $('#radarMedicines').innerHTML=meds.length?meds.slice(0,40).map(x=>`<div class="cms-item"><b>${esc(x.brand||x.generic_name||x.id)}</b><span>${esc(x.generic_name||'')} · Radar ${Number(x.radar_score||0)}</span><span>${esc(x.global_stage||'Unknown stage')} · UK: ${esc(x.uk_regulatory_status||'Unknown')} · NICE: ${esc(x.nice_status||'Unknown')} · NHS: ${esc(x.nhs_status||'Unknown')}</span></div>`).join(''):'<div class="empty">No approved medicines yet.</div>';
        $('#radarForward').innerHTML=forward.length?forward.slice(0,30).map(x=>`<div class="cms-item"><b>${esc(x.title||x.milestone||'Forward milestone')}</b><span>${esc(x.due_at||x.expected_at||'Date TBC')} · ${esc(x.status||'watching')}</span></div>`).join(''):'<div class="empty">No Forward Radar milestones yet.</div>';
        $('#radarPublicationJobs').innerHTML=jobs.length?jobs.slice(0,30).map(x=>`<div class="cms-item"><b>Event #${x.event_id} · ${esc(x.status)}</b><span>${esc(fmt(x.created_at))}${x.error_text?' · '+esc(x.error_text):''}</span>${x.status==='queued'?`<div class="row-actions"><button data-radar-publish="${x.event_id}">Publish to configured adapters</button></div>`:''}</div>`).join(''):'<div class="empty">No publication jobs yet.</div>';
        $$('[data-radar-action]').forEach(b=>b.onclick=()=>radarReview(b.dataset.radarId,b.dataset.radarAction));
        $$('[data-radar-publish]').forEach(b=>b.onclick=()=>radarReview(b.dataset.radarPublish,'publish'));
      } catch(e) { const rows=$('#radarRows'); if(rows) rows.innerHTML=`<tr><td colspan="6">${esc(e.message)}</td></tr>`; }
    }

    function radarActions(x){
      const b=(label,action,cls='')=>`<button class="${cls}" data-radar-action="${action}" data-radar-id="${x.id}">${label}</button>`;
      if(!x.verification?.verified) return b('Re-check / process','process','ghost')+' '+b('Reject','reject','ghost');
      if(['verified','needs_more_evidence'].includes(x.status)) return b('Prepare package','process')+' '+b('Hold','hold','ghost');
      if(x.status==='ready_for_review') return b('Approve','approve')+' '+b('Hold','hold','ghost')+' '+b('Reject','reject','ghost');
      if(x.status==='publish_failed') return b('Retry publish','publish');
      return badge(x.status);
    }

    async function radarReview(id,action){
      let note=''; if(['approve','hold','reject'].includes(action)) note=prompt(action==='approve'?'Optional approval note:':action==='hold'?'Reason for hold:':'Reason for rejection:')||'';
      try { await radarCall(`/v1/hq/radar/events/${id}/${action}`,{method:'POST',body:JSON.stringify({note})}); await loadRadar(); } catch(e) { alert(e.message); }
    }

    rationaliseKnowledgeNavigation();
    installKnowledgeEditorialPresentation();
    installRadarView();
  };
  legacy.onerror = () => console.error('Shift HQ V1.11 runtime failed to load');
  document.head.appendChild(legacy);
})();
