/* SHIFT HQ operations: read-only queues, explicit source states and session-bound rendering. */
(function (host) {
  'use strict';
  const SOURCE_DEFINITIONS = [
    { key: 'support', label: 'Support', view: 'support', path: '/v1/hq/support', field: 'tickets', permission: 'support_read' },
    { key: 'tasks', label: 'Tasks', view: 'tasks', path: '/v1/crm/tasks', field: 'tasks', permission: 'crm_read' },
    { key: 'handovers', label: 'Handovers', view: 'partnerhandovers', path: '/v1/hq/management/partner-handovers', field: 'items', roles: ['owner', 'admin', 'operations', 'support'], limit: 500 },
    { key: 'partnerquestions', label: 'Partner questions', view: 'partnerdesk', path: '/v1/hq/clinical/partner-desk/questions', field: 'threads', roles: ['owner', 'admin', 'operations'], limit: 100 },
    { key: 'messages', label: 'Messages', view: 'outbox', path: '/v1/hq/outbox', field: 'messages', permission: 'communications_read', coverage: 'Outbox only. Approval drafts and other delivery channels are not included.' }
  ];
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const londonDay = value => new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/London', year: 'numeric', month: '2-digit', day: '2-digit' }).format(value);
  function timestamp(value) {
    if (!value) return null;
    const input = String(value);
    // SQLite's unzoned timestamps are UTC, not the operator's local timezone.
    const normal = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}(?:\.\d+)?$/.test(input) ? input.replace(' ', 'T') + 'Z' : input;
    const result = Date.parse(normal);
    return Number.isFinite(result) ? result : null;
  }
  function overdue(value, now = new Date()) {
    if (!value) return false;
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value < londonDay(now);
    const time = timestamp(value);
    return time !== null && time < now.getTime();
  }
  function metricValue(metric) {
    if (metric?.status !== 'available' || typeof metric.value !== 'number' || !Number.isFinite(metric.value)) return 'Unavailable';
    if (metric.unit === 'pence') return new Intl.NumberFormat('en-GB', { style: 'currency', currency: 'GBP' }).format(metric.value / 100);
    if (metric.unit === 'percent') return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(metric.value) + '%';
    return new Intl.NumberFormat('en-GB', { maximumFractionDigits: 2 }).format(metric.value);
  }
  function errorState(error) {
    if (error?.status === 401) return { status: 'signedout', label: 'Sign in again', detail: 'Your session has ended. Sign in to reload this source.' };
    if (error?.status === 403) return { status: 'restricted', label: 'Access restricted', detail: 'Your role cannot read this source.' };
    if (error?.status === 404 || error?.status === 501) return { status: 'disconnected', label: 'Not connected', detail: 'This source is not connected to the home screen.' };
    if (error?.name === 'AbortError') return { status: 'error', label: 'Request timed out', detail: 'This source did not respond in time. Try refreshing.' };
    return { status: 'error', label: 'Could not load', detail: 'This source could not be refreshed. Its queue is not confirmed clear.' };
  }
  function canRead(source, principal, permissions = []) {
    if (!principal) return false;
    return source.roles ? source.roles.includes(principal.role) : permissions.includes('*') || permissions.includes(source.permission);
  }
  function sourceResult(source, data) {
    if (data?.ok === false || !Array.isArray(data?.[source.field])) throw new Error('Invalid queue response');
    if (data[source.field].some(row => !row || typeof row !== 'object' || Array.isArray(row) || row.id == null || typeof row.status !== 'string')) throw new Error('Incomplete queue records');
    return { ...source, status: 'available', rows: data[source.field], partial: Boolean(data.hasMore || data.has_more || data.nextCursor || data.next_cursor || (source.limit && data[source.field].length >= source.limit)), fetchedAt: new Date().toISOString() };
  }
  function attentionItems(source, now = new Date()) {
    if (source.status !== 'available') return [];
    return source.rows.flatMap(row => {
      const state = String(row.status || '').toLowerCase();
      const due = row.due_at || row.due_date;
      const late = overdue(due, now);
      let label, next, priority = 2;
      if (source.key === 'tasks') {
        if (['done', 'completed', 'cancelled', 'closed', 'resolved'].includes(state)) return [];
        if (!late && (row.assigned_to || row.owner_name)) return [];
        label = late ? 'Overdue task' : 'Unassigned task';
        next = row.next_action || (late ? 'Review the task and confirm its next step.' : 'Assign an owner and confirm the next step.');
        priority = late ? 1 : 2;
      } else if (source.key === 'support') {
        if (['closed', 'resolved', 'cancelled'].includes(state)) return [];
        const urgent = ['urgent', 'high'].includes(String(row.priority).toLowerCase());
        label = urgent ? 'Priority support request' : state === 'waiting' ? 'Support awaiting a reply' : 'Open support request';
        next = state === 'waiting' ? 'Review what is outstanding before following up.' : 'Open the ticket and review the next reply.';
        priority = urgent ? 0 : 2;
      } else if (source.key === 'handovers') {
        if (['closed', 'archived', 'cancelled'].includes(state) || (!late && !['blocked', 'review'].includes(state))) return [];
        label = state === 'blocked' ? 'Blocked handover' : late ? 'Overdue handover' : 'Handover awaiting review';
        next = row.next_action || 'Review the handover and set its next internal action.';
        priority = state === 'blocked' ? 0 : late ? 1 : 2;
      } else if (source.key === 'partnerquestions') {
        if (state !== 'awaiting_hq') return [];
        label = row.priority === 'urgent' ? 'Urgent partner question' : 'Partner awaiting HQ';
        next = 'Read the order conversation and reply in Partner desk. Clinical decisions stay in the clinical workspace.';
        priority = row.priority === 'urgent' ? 0 : 2;
      } else if (source.key === 'messages') {
        if (!['failed', 'unknown', 'uncertain'].includes(state)) return [];
        label = state === 'failed' ? 'Failed message' : 'Uncertain message outcome';
        next = 'Review the delivery record before considering another attempt.';
        priority = state === 'failed' ? 1 : 0;
      } else return [];
      const assigned = row.owner_name || row.assigned_name || row.assigned_to;
      return [{ source: source.key, view: source.view, id: String(row.id ?? ''), reference: row.reference || row.order_number || (row.id != null ? '#' + row.id : 'Reference unavailable'), label, next, owner: assigned ? String(assigned) : 'Unassigned', due, createdAt: row.created_at, updatedAt: row.updated_at, priority, late, status: state }];
    }).sort((a, b) => a.priority - b.priority || (timestamp(a.due || a.createdAt) ?? Infinity) - (timestamp(b.due || b.createdAt) ?? Infinity));
  }
  function createRequestGate() {
    let revision = 0;
    return { start: principal => ({ revision: ++revision, principal }), cancel: () => { revision++; }, current: (ticket, principal) => ticket.revision === revision && ticket.principal === principal };
  }
  function formatTime(value) {
    const time = timestamp(value);
    return time === null ? 'Time unavailable' : new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium', timeStyle: 'short' }).format(time);
  }
  function formatDue(value) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value))) return new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/London', dateStyle: 'medium' }).format(new Date(value + 'T12:00:00Z'));
    return formatTime(value);
  }
  function ageLabel(item, now = new Date()) {
    const created = timestamp(item.createdAt);
    if (created === null) return item.updatedAt ? 'Updated ' + formatTime(item.updatedAt) : 'Age unavailable';
    const minutes = Math.max(0, Math.floor((now.getTime() - created) / 60000));
    return minutes < 60 ? 'Open ' + minutes + 'm' : minutes < 1440 ? 'Open ' + Math.floor(minutes / 60) + 'h' : 'Open ' + Math.floor(minutes / 1440) + 'd';
  }
  function installQueueScreens({ getPrincipal, getPermissions, read, definitions }) {
    const states = new Map(), gates = new Map(), controllers = new Map();
    function showState(config) {
      const target = document.getElementById(config.target), state = states.get(config.key);
      if (!target || !state || state.status === 'available') return;
      target.setAttribute('aria-busy', String(state.status === 'loading'));
      const content = '<div class="hq-state" role="status"><strong>' + esc(state.label) + '</strong><p>' + esc(state.detail) + '</p>' + (state.status === 'loading' ? '<div class="hq-skeleton" aria-hidden="true"></div>' : '') + '</div>';
      target.innerHTML = config.columns ? '<tr><td colspan="' + config.columns + '">' + content + '</td></tr>' : content;
      for (const id of config.metrics || []) { const node = document.getElementById(id); if (node) node.textContent = '—'; }
      if (config.mini) document.getElementById(config.mini).textContent = state.status === 'loading' ? 'Loading tasks…' : state.label;
    }
    async function load(key) {
      const config = definitions.find(d => d.key === key), principal = getPrincipal(), gate = gates.get(key);
      controllers.get(key)?.abort(); const controller = new AbortController(); controllers.set(key, controller);
      const ticket = gate.start(principal);
      if (!principal || !canRead(config, principal, getPermissions())) {
        states.set(key, principal ? errorState({ status: 403 }) : errorState({ status: 401 })); config.erase(); showState(config); return;
      }
      states.set(key, { status: 'loading', label: 'Loading ' + config.label.toLowerCase() + '…', detail: 'Checking this source. Existing filters will be applied to the result.' });
      showState(config);
      const timer = setTimeout(() => controller.abort(), 15000);
      try {
        const data = await read(config.path, { signal: controller.signal });
        if (!gate.current(ticket, getPrincipal())) return;
        const result = sourceResult(config, data);
        states.set(key, { status: 'available' });
        document.getElementById(config.target).removeAttribute('aria-busy'); config.apply(result.rows, data);
      } catch (error) {
        if (!gate.current(ticket, getPrincipal())) return;
        states.set(key, errorState(error)); config.erase(); showState(config);
      } finally { clearTimeout(timer); }
    }
    function clear() {
      for (const config of definitions) {
        gates.get(config.key).cancel(); controllers.get(config.key)?.abort();
        states.set(config.key, errorState({ status: 401 })); config.erase(); showState(config);
      }
    }
    for (const config of definitions) {
      gates.set(config.key, createRequestGate());
      states.set(config.key, { status: 'idle', label: 'Open or refresh this queue to load records.', detail: 'Unavailable data will not be shown as an empty list.' });
      const toolbar = document.querySelector('#' + config.view + ' .toolbar');
      const button = document.createElement('button'); button.type = 'button'; button.className = 'secondary';
      button.textContent = 'Refresh ' + config.label.toLowerCase(); button.onclick = () => load(config.key);
      (toolbar?.querySelector('.toolbar-actions') || toolbar)?.append(button);
    }
    window.addEventListener('pagehide', clear);
    return { load, clear, render(key, original) { const config = definitions.find(d => d.key === key); if (states.get(key)?.status === 'available') original(); else showState(config); } };
  }
  function install({ getPrincipal, getPermissions, read, reportOptions, navigate }) {
    const get = id => document.getElementById(id);
    if (!get('management-attention')) return null;
    const gate = createRequestGate();
    let pending = null, controller = null, activePrincipal = null, sources = [], report = null, lastRefresh = null, reportFailure = null;
    const queue = get('management-attention'), nav = document.querySelector('aside nav');
    const heading = document.querySelector('.hq-management-heading');
    heading.querySelector('h2').textContent = 'Your daily business brief.';
    const actions = document.createElement('div');
    actions.className = 'hq-home-actions';
    actions.innerHTML = '<button id="hq-home-refresh" class="secondary" type="button">Refresh overview</button>';
    const reports = get('home-reports');
    reports.before(actions); actions.append(reports);
    queue.setAttribute('aria-live', 'polite'); queue.setAttribute('aria-atomic', 'false');
    queue.before(Object.assign(document.createElement('p'), { className: 'hq-queue-note', textContent: 'Open a source queue to review the record. Nothing here sends a message or changes a status.' }));
    const filters = document.createElement('div');
    filters.className = 'hq-attention-controls';
    filters.innerHTML = '<label for="hq-attention-filter">Show</label><select id="hq-attention-filter"><option value="all">All sources</option>' + SOURCE_DEFINITIONS.map(s => '<option value="' + s.key + '">' + s.label + '</option>').join('') + '</select><span id="hq-attention-count" role="status"></span>';
    queue.before(filters);
    get('management-operations').parentElement.querySelector('h2').textContent = 'Current workload';
    const sourcePanel = document.createElement('details');
    sourcePanel.className = 'hq-source-status'; sourcePanel.open = true;
    sourcePanel.innerHTML = '<summary>Data sources & freshness</summary><div id="hq-home-sources"></div>';
    get('management-operations').after(sourcePanel);
    const columns = document.querySelector('.hq-management-columns');
    heading.after(get('management-headlines'));
    const ownerContext = document.createElement('section');
    ownerContext.className = 'hq-owner-context panel'; ownerContext.hidden = true;
    ownerContext.innerHTML = '<h2>Cash, margin & commitments</h2><p>Paid order value is a sales measure. A cash balance and profit need their own reconciled sources.</p><div class="hq-owner-gaps"><article><h3>Cash available</h3><strong>Not connected</strong><p>Bank balances, pending payouts, refunds due and upcoming bills are not included in this overview.</p></article><article><h3>Actual contribution</h3><strong>Not connected</strong><p>Prescribing, pharmacy, stock, delivery, payment and acquisition costs are needed before a margin or break-even figure can be confirmed.</p></article><article><h3>Growth quality</h3><strong>Partly available</strong><p>Registration and return cohorts are shown with their definitions. Acquisition cost, repeat purchase, cancellations and payback need linked commercial data.</p></article></div><p class="hq-muted">Review support and handovers above for the owner, age and next action. Open Partner desk for order-linked questions, clinical assignments and pharmacy progress.</p><button type="button" data-owner-report>Open management reports</button> <button type="button" data-owner-partners>Open Partner desk</button>';
    columns.after(ownerContext);
    ownerContext.querySelector('[data-owner-report]').onclick = () => get('home-reports').click();
    ownerContext.querySelector('[data-owner-partners]').onclick = () => navigate('partnerdesk');
    const footnote = document.querySelector('#dashboard > .hq-muted');
    if (footnote) footnote.textContent = 'Work queues are current snapshots. Financial figures use the selected report dates; Today cohort rates carry their own window.';

    function removeCounts() { nav.querySelectorAll('[data-hq-queue-count]').forEach(node => node.remove()); }
    function clear(message = 'Sign in to load your overview.') {
      gate.cancel(); controller?.abort(); controller = null; pending = null; activePrincipal = null;
      sources = []; report = null; lastRefresh = null; reportFailure = null;
      ownerContext.hidden = true;
      get('management-headlines').replaceChildren(); get('management-operations').replaceChildren();
      get('hq-home-sources').replaceChildren(); get('hq-attention-count').textContent = '';
      queue.removeAttribute('aria-busy'); queue.innerHTML = '<div class="hq-state"><strong>' + esc(message) + '</strong><p>Your overview loads after a successful HQ sign-in.</p></div>';
      get('management-asof').textContent = message; get('hq-home-refresh').disabled = !getPrincipal();
      get('hq-attention-filter').value = 'all'; removeCounts();
    }
    function skeleton() {
      queue.setAttribute('aria-busy', 'true');
      queue.innerHTML = '<div class="hq-state"><span role="status">Loading your work queues…</span><div class="hq-skeleton" aria-hidden="true"></div><div class="hq-skeleton" aria-hidden="true"></div><div class="hq-skeleton" aria-hidden="true"></div></div>';
      get('management-operations').innerHTML = '<p class="hq-muted">Checking source availability…</p>';
      get('hq-home-sources').replaceChildren(); get('management-headlines').replaceChildren();
      get('hq-attention-count').textContent = ''; removeCounts();
      get('management-asof').textContent = 'Refreshing overview · Europe/London';
    }
    function render() {
      ownerContext.hidden = !['owner', 'admin'].includes(getPrincipal()?.role);
      const metrics = new Map((report?.metrics || []).map(m => [m.key, m]));
      const filter = get('hq-attention-filter').value;
      const loaded = sources.filter(s => s.status === 'available');
      const items = loaded.flatMap(s => attentionItems(s)).sort((a, b) => a.priority - b.priority || (timestamp(a.createdAt) ?? Infinity) - (timestamp(b.createdAt) ?? Infinity));
      const visible = items.filter(item => filter === 'all' || filter === item.source);
      const selectedSource = sources.find(s => s.key === filter);
      queue.removeAttribute('aria-busy');
      get('hq-attention-count').textContent = visible.length ? visible.length + ' item' + (visible.length === 1 ? '' : 's') + ' in loaded records' : '';
      if (visible.length) {
        queue.innerHTML = visible.slice(0, 12).map(item => '<article class="hq-action-item" data-source="' + item.source + '"><div class="hq-action-top"><span class="hq-action-kind' + (item.priority === 0 ? ' hq-action-priority' : '') + '">' + esc(item.label) + '</span><span>' + esc(ageLabel(item)) + '</span></div><strong>' + esc(item.reference) + '</strong><p>' + esc(item.next) + '</p><div class="hq-action-bottom"><span>Owner: ' + esc(item.owner) + (item.due ? ' · Due ' + esc(formatDue(item.due)) : '') + '</span><button type="button" data-hq-source-open="' + item.source + '">Open ' + esc(SOURCE_DEFINITIONS.find(s => s.key === item.source).label.toLowerCase()) + ' queue</button></div></article>').join('') + (visible.length > 12 ? '<p class="hq-muted">Showing 12 of ' + visible.length + ' loaded items. Open a source queue for the full list.</p>' : '');
      } else if (selectedSource && selectedSource.status !== 'available') {
        queue.innerHTML = '<div class="hq-state"><strong>' + esc(selectedSource.label) + ': ' + esc(selectedSource.stateLabel) + '</strong><p>' + esc(selectedSource.detail) + '</p>' + (selectedSource.status === 'error' ? '<button type="button" data-hq-retry>Try again</button>' : '') + '</div>';
      } else {
        queue.innerHTML = '<div class="hq-state"><strong>' + (filter === 'all' ? loaded.length ? 'No items needing review in the loaded records.' : 'No work queues could be confirmed.' : 'No items needing review in this source.') + '</strong><p>' + (filter === 'all' ? 'Check the source states alongside this panel. Missing or restricted sources are not confirmed clear.' : 'Choose All sources to see the other queues.') + '</p>' + (filter !== 'all' ? '<button type="button" data-hq-reset-filter>Show all sources</button>' : '') + '</div>';
      }
      const unknown = sources.filter(s => !['available', 'restricted'].includes(s.status));
      if (unknown.length && visible.length) queue.insertAdjacentHTML('beforeend', '<p class="hq-partial-warning">Some sources could not be confirmed: ' + esc(unknown.map(s => s.label).join(', ')) + '. Review their data states.</p>');
      const maxCount = Math.max(1, ...loaded.map(s => attentionItems(s).length));
      get('management-operations').innerHTML = sources.map(s => {
        const count = s.status === 'available' ? attentionItems(s).length : null;
        return '<button class="hq-workload-row" type="button" data-hq-source-open="' + s.key + '"' + (s.status === 'restricted' ? ' disabled' : '') + '><span>' + s.label + '<small>' + (count === null ? esc(s.stateLabel) : 'Items needing review · loaded records') + '</small></span><strong>' + (count === null ? '—' : count) + '</strong>' + (count === null ? '' : '<span class="hq-workload-bar" aria-hidden="true"><i style="width:' + (100 * count / maxCount) + '%"></i></span>') + '</button>';
      }).join('');
      get('hq-home-sources').innerHTML = sources.map(s => '<div class="hq-source-row"><span><strong>' + s.label + '</strong><small>' + (s.status === 'available' ? esc(s.partial ? 'Latest loaded records · more may exist. Open the queue.' : s.rows.length + ' loaded record' + (s.rows.length === 1 ? '' : 's') + '. Counts cover these records.') : esc(s.detail)) + '</small>' + (s.coverage ? '<small>' + esc(s.coverage) + '</small>' : '') + (s.fetchedAt ? '<small>Loaded ' + esc(formatTime(s.fetchedAt)) + '</small>' : '') + '</span><b class="hq-data-state hq-data-' + s.status + '">' + (s.status === 'available' ? 'Loaded' : esc(s.stateLabel)) + '</b></div>').join('') + '<p class="hq-muted">Last refresh attempt completed: ' + esc(formatTime(lastRefresh)) + ' · Europe/London. Each source retains its own state.</p>';
      const labels = { paid_value: 'Paid order value', registrations: 'New registrations', week4: 'Week-4 return rate', helped: 'Steps rated helpful' };
      get('management-headlines').innerHTML = Object.keys(labels).map(key => {
        const m = metrics.get(key), value = metricValue(m);
        const stale = report && (timestamp(report.generatedAt) === null || Date.now() - timestamp(report.generatedAt) > 15 * 60000);
        return '<article><span>' + esc(m?.label || labels[key]) + '</span><strong>' + esc(value) + '</strong><small>' + esc(m?.reason || m?.scope || reportFailure?.detail || 'Source unavailable.') + '</small>' + (m?.denominator != null ? '<small>Sample: ' + esc(m.numerator) + ' / ' + esc(m.denominator) + '</small>' : '') + (m?.source ? '<small>Source: ' + esc(m.source) + '</small>' : '') + (stale ? '<b class="hq-data-state hq-data-error">' + (timestamp(report.generatedAt) === null ? 'Freshness unknown' : 'Older snapshot') + '</b>' : '') + '</article>';
      }).join('');
      get('management-asof').textContent = report ? (report.period.start + ' to ' + report.period.end + ' · report generated ' + formatTime(report.generatedAt) + ' · Europe/London') : 'Report ' + (reportFailure?.stateLabel || 'unavailable') + ' · queues checked separately';
      removeCounts();
      for (const s of loaded) {
        const count = attentionItems(s).length, button = nav.querySelector('button[data-view="' + s.view + '"]');
        if (!button || !count) continue;
        const badge = document.createElement('span'); badge.dataset.hqQueueCount = s.key; badge.className = 'hq-nav-count';
        badge.textContent = count; badge.setAttribute('aria-label', count + ' items needing review in loaded records'); button.append(badge);
      }
    }
    async function refresh(force = false) {
      const principal = getPrincipal();
      if (!principal) { clear(); return; }
      if (pending && activePrincipal === principal && !force) return pending;
      controller?.abort(); controller = new AbortController(); const signal = controller.signal;
      const ticket = gate.start(principal); activePrincipal = principal;
      skeleton(); get('hq-home-refresh').disabled = true;
      const timer = setTimeout(() => controller?.signal === signal && controller.abort(), 15000);
      const request = (async () => {
        const reportPromise = read('/v1/hq/management/report?' + new URLSearchParams(reportOptions()), { signal });
        const queuePromises = SOURCE_DEFINITIONS.map(async source => {
          if (!canRead(source, principal, getPermissions())) return { ...source, status: 'restricted', stateLabel: 'Access restricted', detail: 'Your role cannot read this source.' };
          try { return sourceResult(source, await read(source.path, { signal })); }
          catch (error) { const state = errorState(error); return { ...source, ...state, stateLabel: state.label, label: source.label }; }
        });
        const [reportResponse, ...queueResponses] = await Promise.allSettled([reportPromise, ...queuePromises]);
        if (!gate.current(ticket, getPrincipal())) return;
        const nextSources = queueResponses.map((r, i) => r.status === 'fulfilled' ? r.value : { ...SOURCE_DEFINITIONS[i], ...errorState(r.reason), stateLabel: 'Could not load', label: SOURCE_DEFINITIONS[i].label });
        if (nextSources.some(s => s.status === 'signedout') || (reportResponse.status === 'rejected' && reportResponse.reason?.status === 401)) { clear('Your session has ended. Sign in again.'); return; }
        sources = nextSources; report = null; reportFailure = null;
        if (reportResponse.status === 'fulfilled' && reportResponse.value?.ok !== false && Array.isArray(reportResponse.value?.metrics) && reportResponse.value?.period) report = reportResponse.value;
        else { const state = errorState(reportResponse.reason); reportFailure = { ...state, stateLabel: state.label }; }
        lastRefresh = new Date().toISOString(); render();
      })().finally(() => {
        clearTimeout(timer);
        if (gate.current(ticket, getPrincipal())) { pending = null; get('hq-home-refresh').disabled = false; }
      });
      pending = request; return request;
    }
    get('hq-home-refresh').onclick = () => refresh(true);
    get('hq-attention-filter').onchange = () => { if (!pending && getPrincipal() === activePrincipal) render(); };
    get('dashboard').addEventListener('click', event => {
      const target = event.target.closest('[data-hq-source-open], [data-hq-retry], [data-hq-reset-filter]');
      if (!target) return;
      if (target.hasAttribute('data-hq-retry')) { refresh(true); return; }
      if (target.hasAttribute('data-hq-reset-filter')) { get('hq-attention-filter').value = 'all'; render(); return; }
      if (!getPrincipal() || getPrincipal() !== activePrincipal) { clear(); return; }
      const source = SOURCE_DEFINITIONS.find(s => s.key === target.dataset.hqSourceOpen);
      if (source) navigate(source.view);
    });
    const preferenceKey = 'shift.hq.navigation.v1';
    let preferences = {};
    try { const saved = JSON.parse(localStorage.getItem(preferenceKey) || '{}'); if (saved && typeof saved === 'object' && !Array.isArray(saved)) preferences = saved; } catch { /* Storage may be disabled. */ }
    nav.querySelectorAll('.hq-nav-group').forEach(group => {
      const name = group.querySelector('summary')?.textContent;
      if (Object.hasOwn(preferences, name)) group.open = preferences[name] === true;
      group.addEventListener('toggle', () => { preferences[name] = group.open; try { localStorage.setItem(preferenceKey, JSON.stringify(preferences)); } catch { /* Navigation still works without storage. */ } });
    });
    function syncNavigation() {
      nav.querySelectorAll('button[data-view]').forEach(button => {
        if (button.classList.contains('active')) { button.setAttribute('aria-current', 'page'); const parent = button.closest('details'); if (parent) parent.open = true; }
        else button.removeAttribute('aria-current');
      });
    }
    nav.addEventListener('click', () => queueMicrotask(syncNavigation)); syncNavigation();
    window.addEventListener('pagehide', () => clear());
    clear();
    return { refresh, clear };
  }
  const api = { SOURCE_DEFINITIONS, timestamp, overdue, metricValue, errorState, canRead, sourceResult, attentionItems, createRequestGate, install, installQueueScreens };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else host.HQOperations = api;
})(typeof window !== 'undefined' ? window : globalThis);
