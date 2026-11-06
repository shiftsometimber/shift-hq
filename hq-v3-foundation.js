/* v3 extends the existing HQ: no alternate identity, order store or transport. */
(function (host) {
  'use strict';
  const JOBS = [
    ['Overview', ['dashboard']],
    ['Operations', ['rxoperations', 'tasks', 'support', 'partners', 'partnerdesk', 'partnerhandovers', 'partnerworkflows', 'automation', 'liveevents', 'activity', 'launch']],
    ['Money', ['managementreports', 'orders', 'products', 'medicines']],
    ['Members', ['people', 'pipeline', 'conversations', 'consentmemory', 'gpdirectory']],
    ['Comms', ['communications', 'outbox', 'campaigns', 'segments', 'forms', 'workflows']],
    ['Growth', ['intelligence', 'indexing', 'semantic', 'sourceversions']],
    ['Publishing', ['website', 'knowledgehub', 'radar', 'evidencedesk', 'knowledgeapproval']],
    ['Control', ['users', 'audit', 'copilot', 'academy', 'shoulder', 'knowledge', 'synthetic', 'memory', 'models', 'intelloop', 'dictionary', 'aiactions', 'selfhost', 'setupwizard', 'hqv3readiness']]
  ];
  const esc = x => String(x ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  function validateMessages(data) {
    if (data?.ok === false || !Array.isArray(data?.messages)) throw Error('The Outbox source did not return a valid queue.');
    if (data.messages.some(x => !x || x.id == null || typeof x.status !== 'string')) throw Error('The Outbox source returned incomplete records.');
    return data.messages;
  }
  function counter(stats, key) {
    const value = stats?.[key];
    return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? String(value) : 'Unavailable';
  }
  async function boundedRead(read, path, { timeoutMs = 12000, signal } = {}) {
    const controller = new AbortController();
    const abort = () => controller.abort();
    if (signal?.aborted) controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    let timer;
    // Race as well as abort: a broken adapter must not retain the loader forever.
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(() => { controller.abort(); const error = Error('This source did not respond within 12 seconds.'); error.name = 'AbortError'; reject(error); }, timeoutMs);
    });
    try { return await Promise.race([Promise.resolve().then(() => read(path, { signal: controller.signal })), timeout]); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  function organiseNavigation(nav) {
    const buttons = [...nav.querySelectorAll('button[data-view]')];
    const used = new Set();
    const fragment = document.createDocumentFragment();
    for (const [label, ids] of JOBS) {
      const group = document.createElement('details'); group.className = 'hq-nav-group';
      const summary = document.createElement('summary'); summary.textContent = label; group.append(summary);
      for (const button of buttons) if (ids.includes(button.dataset.view)) { group.append(button); used.add(button); }
      if (group.children.length > 1) fragment.append(group);
    }
    // Newly discovered routes retain their original elements and handlers.
    const remaining = buttons.filter(button => !used.has(button));
    const control = [...fragment.children].at(-1);
    for (const button of remaining) control.append(button);
    const mobile = nav.querySelector('.hq-mobile-menu');
    nav.replaceChildren(...(mobile ? [mobile] : []), fragment);
    const selected = nav.querySelector('button.active'); if (selected?.parentElement.tagName === 'DETAILS') selected.parentElement.open = true;
    return { before: buttons.length, after: nav.querySelectorAll('button[data-view]').length, preserved: buttons.every(button => nav.contains(button)) };
  }
  function install({ getPrincipal, read, navigate }) {
    const get = id => document.getElementById(id), nav = document.querySelector('aside nav');
    let revision = 0, activeController, clearRx = () => {};
    const target = get('queueOutboxRows');
    if (!target) return;
    const status = document.createElement('p'); status.id = 'outbox-load-status'; status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite');
    get('outbox').querySelector('.toolbar').after(status);
    const retry = document.createElement('button'); retry.type = 'button'; retry.id = 'outbox-load-retry'; retry.textContent = 'Refresh Outbox';
    get('outbox').querySelector('.toolbar').append(retry);
    const sentCard = get('outSent').closest('article');
    sentCard.querySelector('span').textContent = 'Transport accepted';
    sentCard.querySelector('em').textContent = 'Device delivery unverified';
    function clear(message = 'Sign in to load the Outbox.') {
      revision++; activeController?.abort(); target.removeAttribute('aria-busy');
      retry.disabled = false;
      clearRx();
      target.innerHTML = '<tr><td colspan="5">' + esc(message) + '</td></tr>'; status.textContent = message;
      for (const id of ['outPending', 'outSent', 'outFailed', 'outSuppressed']) get(id).textContent = 'Unavailable';
    }
    async function loadOutbox() {
      activeController?.abort(); activeController = new AbortController();
      const request = ++revision, principal = getPrincipal();
      if (!principal) { clear(); return; }
      target.setAttribute('aria-busy', 'true'); retry.disabled = true;
      target.innerHTML = '<tr><td colspan="5">Loading the Outbox…</td></tr>'; status.textContent = 'Checking the queue. Delivery outcomes are separate from provider acceptance.';
      for (const id of ['outPending', 'outSent', 'outFailed', 'outSuppressed']) get(id).textContent = 'Unavailable';
      try {
        const data = await boundedRead(read, '/v1/hq/outbox', { signal: activeController.signal });
        if (request !== revision || principal !== getPrincipal()) return;
        const messages = validateMessages(data);
        target.innerHTML = messages.length ? messages.map(x => '<tr><td>' + esc(x.destination || x.recipient || 'Unavailable') + '</td><td>' + esc(x.channel) + '</td><td>' + esc(x.subject || '—') + '</td><td>' + esc(x.status.replaceAll('_', ' ')) + '</td><td>' + esc(x.created_at || 'Unavailable') + '</td></tr>').join('') : '<tr><td colspan="5">Outbox empty. Source confirmed.</td></tr>';
        for (const [id, key] of [['outPending','pending'], ['outSent','sent'], ['outFailed','failed'], ['outSuppressed','suppressed']]) get(id).textContent = counter(data.stats, key);
        status.textContent = 'Queue refreshed · Europe/London ' + new Date().toLocaleString('en-GB', { timeZone: 'Europe/London' }) + '. Provider accepted does not mean device delivered.';
      } catch (error) {
        if (request !== revision || principal !== getPrincipal()) return;
        const state = host.HQOperations.errorState(error);
        target.innerHTML = '<tr><td colspan="5">' + esc(state.label) + ' — ' + esc(state.detail) + '</td></tr>';
        status.textContent = state.detail;
      } finally { if (request === revision && principal === getPrincipal()) { target.removeAttribute('aria-busy'); retry.disabled = false; } }
    }
    retry.onclick = loadOutbox;
    const readiness = document.createElement('section'); readiness.id = 'hqv3readiness'; readiness.className = 'view';
    readiness.innerHTML = '<div class="toolbar"><div><p class="eyebrow">SHIFT HQ v3</p><h2>Pre-switch-on readiness</h2><p>124 named acceptance checks. Evidence against the exact build is required for every applicable check.</p></div></div><div class="hq-v3-gates"><article><h3>Build and integration evidence</h3><p>NOT RUN — source fixes and local checks do not establish three-view, supplier, device or restore acceptance.</p></article><article><h3>Supplier and Partner MFA</h3><p>BLOCKED — authorised partner access and genuine supplier receipts remain required.</p></article><article><h3>Connected business sources</h3><p>Unavailable until accounting, bank, costs and analytics have authoritative connections.</p></article><article><h3>Matt + clinical authorisation</h3><p>Required after checks pass. This screen cannot switch on the service or waive a failed check.</p></article></div><p>TEST work only. Care decisions, charges, refunds, publication and sending retain their separate authority.</p>';
    document.querySelector('main').append(readiness);
    const button = document.createElement('button'); button.dataset.view = readiness.id; button.textContent = 'Readiness'; button.onclick = () => { document.querySelectorAll('.view').forEach(x => x.classList.toggle('active', x === readiness)); document.querySelectorAll('nav button[data-view]').forEach(x => x.classList.toggle('active', x === button)); get('title').textContent = 'Pre-switch-on readiness'; };
    nav.append(button);
    const rx = document.createElement('section'); rx.id = 'rxoperations'; rx.className = 'view';
    rx.innerHTML = '<div class="toolbar"><div><p class="eyebrow">Rx · My Shift · HQ</p><h2>Rx operations</h2><p>TEST partition · current shared case/order references · last confirmed milestones</p></div><button type="button" id="hq-rx-refresh">Refresh Rx operations</button></div><p id="hq-rx-status" role="status">Sign in with the required MFA to load TEST operations.</p><div id="hq-rx-records"></div>';
    document.querySelector('main').append(rx);
    const rxButton = document.createElement('button'); rxButton.dataset.view = 'rxoperations'; rxButton.textContent = 'Rx operations'; nav.append(rxButton);
    let rxRevision=0,rxController,lastRead=null;
    clearRx=()=>{rxRevision++;rxController?.abort();lastRead=null;get('hq-rx-records').replaceChildren();get('hq-rx-status').textContent='Sign in with the required MFA to load TEST operations.';get('hq-rx-refresh').disabled=false;};
    async function loadRx(){
      const principal=getPrincipal();if(!principal){clearRx();return;}
      rxController?.abort();rxController=new AbortController();const ticket=++rxRevision;lastRead=null;
      const status=get('hq-rx-status'),root=get('hq-rx-records');root.replaceChildren();status.textContent='Loading the existing shared TEST records…';get('hq-rx-refresh').disabled=true;
      try{
        const data=await boundedRead(read,'/v1/hq/clinical/partner-desk/operations?partition=TEST',{signal:rxController.signal});
        if(ticket!==rxRevision||principal!==getPrincipal())return;
        if(data?.ok!==true||data.partition!=='TEST'||!Array.isArray(data.records))throw Error('The Rx operations source returned an invalid TEST projection.');
        status.textContent='Read '+new Date(data.observed_at).toLocaleString('en-GB',{timeZone:'Europe/London'})+' · Europe/London · '+(data.coverage?.has_more?'Partial records; older work may remain.':'Returned TEST records. Event propagation performance remains unverified.');lastRead=Date.now();
        root.innerHTML=data.records.length?data.records.map(record=>'<article class="panel hq-v3-rx-row"><h3>'+esc(record.order_ref)+'</h3><p>Case '+esc(record.case_ref)+'</p><p>Shared stage: '+esc(record.last_confirmed_shared_stage||'Unavailable')+' · Pharmacy: '+esc(record.pharmacy_stage||'Unconfirmed')+'</p><p>Owner: '+esc(record.action?.owner?.name||'Owner required')+' · Next: '+esc(record.action?.label||'Next action unavailable')+'</p><p>'+esc(record.action?.dueAt?'Due '+new Date(record.action.dueAt).toLocaleString('en-GB',{timeZone:'Europe/London'}):'Deadline not configured')+(record.action?.overdue?' · OVERDUE':'')+'</p><p>Projection: '+esc(record.sync_status)+'</p><ul>'+record.milestones.map(item=>'<li>'+esc(item.key)+': '+esc(item.confirmed?item.at:'Pending / unconfirmed')+'</li>').join('')+'</ul><a href="https://sstrx.shiftsometimber.co.uk/workspace/clinical#'+encodeURIComponent(record.case_ref)+'" target="_blank" rel="noopener">Open in SST Rx</a></article>').join(''):'<p>No linked TEST records were returned by the authorised source.</p>';
      }catch(error){if(ticket!==rxRevision||principal!==getPrincipal())return;root.replaceChildren();status.textContent='Unavailable — '+(error.data?.error==='mfa_required'?'Partner Desk MFA is required.':error.data?.error==='isolated_test_environment_required'?'The isolated TEST source is not enabled.':host.HQOperations.errorState(error).detail);}
      finally{if(ticket===rxRevision&&principal===getPrincipal())get('hq-rx-refresh').disabled=false;}
    }
    rxButton.onclick=()=>{document.querySelectorAll('.view').forEach(x=>x.classList.toggle('active',x===rx));nav.querySelectorAll('button[data-view]').forEach(x=>x.classList.toggle('active',x===rxButton));get('title').textContent='Rx operations';loadRx();};
    get('hq-rx-refresh').onclick=loadRx;
    setInterval(()=>{if(lastRead&&Date.now()-lastRead>60000&&rx.classList.contains('active'))get('hq-rx-status').textContent='Snapshot may be stale — refresh to check the latest confirmed state.';},1000);
    const navigation = organiseNavigation(nav);
    nav.addEventListener('click',event=>{
      if(!event.target.closest('button[data-view]')||!host.matchMedia('(max-width:760px)').matches)return;
      nav.classList.remove('hq-mobile-open');
      const menu=nav.querySelector('.hq-mobile-menu');menu?.setAttribute('aria-expanded','false');
      const title=get('title');title.tabIndex=-1;title.focus({preventScroll:true});title.scrollIntoView({block:'start'});
    });
    window.addEventListener('pagehide', () => clear());
    return { loadOutbox, clear, navigation };
  }
  const api = { JOBS, boundedRead, validateMessages, counter, organiseNavigation, install };
  host.HQV3 = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof window === 'object' ? window : globalThis);
