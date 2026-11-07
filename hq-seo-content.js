(() => {
  'use strict';

  const API = '/v1/hq/management/seo-content';
  const LIMIT = 30;
  const tabs = {
    opportunities: { label: 'Opportunities', query: { kind: 'opportunity' } },
    review: { label: 'Review', query: { view: 'review' } },
    release: { label: 'Release & Verification', query: { view: 'release' } },
    inventory: { label: 'Sitemap inventory', query: { kind: 'inventory' } },
  };
  const statuses = {
    draft: 'Draft', recommended: 'Recommended', previewed: 'Previewed',
    approved: 'Approved', deployed: 'Deployment recorded', live: 'Confirmed live',
    blocked: 'Externally blocked', unverified: 'Unverified',
  };
  const areas = {
    core: 'Homepage & core journeys', knowledge: 'Knowledge & newsroom', evidence: 'Medicines & Evidence',
    medicines: 'Medicines & Evidence', timber: 'My Timber', library: 'Recipes & exercises',
    treatments: 'Treatments', commercial: 'Supporting commercial',
  };
  const proposalFields = [
    ['previewTitle', 'Proposed heading'], ['before', 'Before copy'], ['after', 'After copy'],
    ['placement', 'Exact placement'], ['ctaLabel', 'CTA label'], ['destination', 'CTA destination'],
    ['desktopImage', 'Desktop image URL'], ['mobileImage', 'Mobile image URL'],
    ['previewLink', 'Staging or preview URL'], ['checks', 'Proposal verification notes'], ['rollback', 'Rollback plan'],
  ];
  const checks = {
    draft: 'Draft ready', review: 'Exact change reviewed', preview: 'Preview matches the change',
    mobile: 'Mobile presentation', desktop: 'Desktop presentation', canonical: 'Canonical URL',
    sitemap: 'Sitemap coverage', indexability: 'Indexability', duplicates: 'Duplicate cards',
    claims: 'Imported claims checked', rollback: 'Rollback plan checked',
  };
  const optionalChecks = new Set(['canonical', 'sitemap', 'indexability', 'duplicates']);
  const stages = {
    preview: { title: 'Record review preview', fields: [['url', 'Preview URL', 'url'], ['note', 'Preview note']] },
    approve: { title: 'Record owner approval', fields: [['reference', 'Approval reference', 'text', true]] },
    record_deployment: { title: 'Record deployment', fields: [['url', 'Deployed page URL', 'url', true], ['reference', 'Build or deployment reference', 'text', true]] },
    verify: { title: 'Confirm live', fields: [['url', 'Observed page URL', 'url', true], ['note', 'What was verified', 'text', true]] },
  };
  const escape = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
  const label = (map, key) => Object.hasOwn(map, key) ? map[key] : key;
  const url = value => {
    try {
      const raw = String(value ?? '');
      if (!/^https:\/\//i.test(raw) && !/^\/(?![/\\])[^\\\s]*$/.test(raw)) return '';
      const parsed = new URL(raw, 'https://shiftsometimber.co.uk');
      return parsed.protocol === 'https:' && !parsed.username && !parsed.password ? parsed.href : '';
    } catch { return ''; }
  };
  const imageUrl = value => /^data:image\/(?:webp|png|jpeg);base64,[A-Za-z0-9+/]+={0,2}$/.test(value || '') ? value : url(value);
  const api = (path = '', method, body) => method
    ? call(API + path, { method, body: JSON.stringify(body) })
    : call(API + path);
  const date = value => {
    const parsed = new Date(value);
    return value && !Number.isNaN(parsed.getTime()) ? parsed.toLocaleString('en-GB', { timeZone: 'Europe/London' }) : '';
  };
  const link = (value, name) => url(value)
    ? `<a href="${escape(url(value))}" target="_blank" rel="noopener noreferrer">${escape(name || value)}</a>`
    : escape(name || value);
  const textBlock = (name, value) => value
    ? `<section class="seo-hq-copy"><h4>${escape(name)}</h4><p>${escape(value)}</p></section>`
    : '';
  const statusBadge = status => `<span class="badge">${escape(label(statuses, status) || '—')}</span>`;
  const ownerOnly = 'SEO & Content is available to the signed-in HQ owner.';
  const isOwner = () => S.me?.role === 'owner';
  const selectOptions = (options, value) => Object.entries(options).map(([key, title]) =>
    `<option value="${escape(key)}" ${key === value ? 'selected' : ''}>${escape(title)}</option>`
  ).join('');
  const field = (name, title, value = '', { type = 'text', required = false, rows = 0 } = {}) => `<label>${escape(title)}
    ${rows ? `<textarea name="${name}" rows="${rows}" ${required ? 'required' : ''}>${escape(value)}</textarea>`
      : `<input name="${name}" type="${type}" value="${escape(value)}" ${required ? 'required' : ''}${type === 'number' ? ' min="0" max="100" step="any"' : ''}>`}
  </label>`;

  window.installSeoContentHQ = function installSeoContentHQ() {
    if (document.getElementById('seocontent')) return;
    const nav = document.querySelector('aside nav');
    const navButton = document.createElement('button');
    navButton.type = 'button';
    navButton.dataset.view = 'seocontent';
    navButton.textContent = 'SEO & Content';
    const website = nav.querySelector('[data-view="website"]');
    if (website) website.after(navButton);
    else nav.append(navButton);

    const root = document.createElement('section');
    root.id = 'seocontent';
    root.className = 'view seo-hq';
    root.innerHTML = `
      <div class="seo-hq-hero">
        <div><p class="eyebrow">Website &amp; growth</p><h2>SEO &amp; Content</h2>
          <p>Track site opportunities, review exact changes and record release evidence.</p></div>
        <div class="seo-hq-controls">
          <button type="button" class="secondary" data-seo-new hidden>New opportunity</button>
          <button type="button" class="secondary" data-seo-import hidden>Import records</button>
        </div>
      </div>
      <div class="seo-hq-tabs" role="group" aria-label="SEO and content views">
        ${Object.entries(tabs).map(([key, tab]) => `<button type="button" data-seo-tab="${key}" aria-pressed="${key === 'opportunities'}">${tab.label}</button>`).join('')}
      </div>
      <form class="seo-hq-filters panel" data-seo-filter>
        <label>Search records<input type="search" name="q" maxlength="200"></label>
        <label>Status<select name="status"><option value="">All statuses</option>${selectOptions(statuses)}</select></label>
        <button class="secondary" type="submit">Search</button>
      </form>
      <p data-seo-summary role="status">Sign in to load SEO and content records.</p>
      <div class="panel tablewrap">
        <table><thead><tr><th>Record</th><th>Area</th><th>Status</th><th>Priority</th><th>Next action</th></tr></thead>
        <tbody data-seo-rows></tbody></table>
      </div>
      <div class="seo-hq-pager" aria-label="Record pages">
        <button type="button" class="secondary" data-seo-page="-1" disabled>Previous</button>
        <button type="button" class="secondary" data-seo-page="1" disabled>Next</button>
      </div>`;
    document.querySelector('main').append(root);

    const dialog = document.createElement('dialog');
    dialog.className = 'wide-dialog seo-hq-dialog';
    dialog.setAttribute('aria-label', 'SEO and content record');
    document.body.append(dialog);
    const get = selector => root.querySelector(selector);
    const dialogGet = selector => dialog.querySelector(selector);
    const filter = get('[data-seo-filter]');
    const summary = get('[data-seo-summary]');
    const rows = get('[data-seo-rows]');
    let activeTab = 'opportunities';
    let offset = 0;
    let listSerial = 0;
    let detailSerial = 0;
    let writeSerial = 0;
    let detailRecord;
    let permissions = {};

    function clear(message = 'Sign in to load SEO and content records.') {
      listSerial++;
      detailSerial++;
      writeSerial++;
      detailRecord = undefined;
      permissions = {};
      rows.replaceChildren();
      summary.textContent = message;
      get('[data-seo-new]').hidden = true;
      get('[data-seo-import]').hidden = true;
      root.querySelectorAll('[data-seo-page]').forEach(button => { button.disabled = true; });
      if (dialog.open) dialog.close();
      dialog.replaceChildren();
    }

    async function loadList() {
      if (!S.me) { clear(); return; }
      if (!isOwner()) { clear(ownerOnly); return; }
      const principal = S.me;
      const serial = ++listSerial;
      const params = new URLSearchParams({
        ...tabs[activeTab].query,
        q: filter.elements.q.value.trim(),
        status: filter.elements.status.value,
        limit: LIMIT,
        offset,
      });
      rows.replaceChildren();
      summary.textContent = 'Loading records…';
      root.querySelectorAll('[data-seo-page]').forEach(button => { button.disabled = true; });
      try {
        const result = await api('?' + params);
        if (serial !== listSerial || S.me !== principal) return;
        if (!Array.isArray(result.records) || !Number.isInteger(result.total)) throw Error('The workspace did not return a valid record list.');
        permissions = result.permissions || {};
        get('[data-seo-new]').hidden = !permissions.edit;
        get('[data-seo-import]').hidden = !permissions.import;
        if (!result.records.length && result.total > 0 && offset > 0) {
          offset = Math.floor((result.total - 1) / LIMIT) * LIMIT;
          return loadList();
        }
        rows.innerHTML = result.records.map(record => `<tr>
          <td><button type="button" class="seo-hq-row-link" data-seo-open="${escape(record.id)}">${escape(record.title)}</button>
            <small>${escape(record.url || record.id)}</small></td>
          <td>${escape(label(areas, record.area) || '—')}</td><td>${statusBadge(record.status)}</td>
          <td>${escape(record.priority ?? '—')}</td><td>${escape(record.next || '—')}</td></tr>`).join('');
        summary.textContent = result.total
          ? `${(offset + 1).toLocaleString('en-GB')}–${(offset + result.records.length).toLocaleString('en-GB')} of ${result.total.toLocaleString('en-GB')} records`
          : 'No records match this view.';
        get('[data-seo-page="-1"]').disabled = offset === 0;
        get('[data-seo-page="1"]').disabled = offset + LIMIT >= result.total;
      } catch (error) {
        if (serial !== listSerial || S.me !== principal) return;
        if (error.status === 401 || error.status === 403) clear();
        summary.textContent = error.message;
      }
    }

    function showDialog(heading, content) {
      dialog.innerHTML = `<div class="seo-hq-dialog-body"><div class="modalbar">
        <h2>${escape(heading)}</h2><button type="button" class="iconbtn" data-seo-close aria-label="Close">×</button>
      </div>${content}<p data-seo-dialog-state role="status"></p></div>`;
      if (!dialog.open) dialog.showModal();
    }

    async function openRecord(id) {
      if (!isOwner()) return;
      const principal = S.me;
      const serial = ++detailSerial;
      detailRecord = undefined;
      showDialog('SEO & Content', '<p>Loading record…</p>');
      try {
        const { record, permissions: allowed } = await api('/' + encodeURIComponent(id));
        if (serial !== detailSerial || S.me !== principal || !dialog.open) return;
        if (!record || record.id !== id) throw Error('The workspace did not return the requested record.');
        renderRecord(record, allowed || {});
      } catch (error) {
        if (serial !== detailSerial || S.me !== principal || !dialog.open) return;
        if (error.status === 401 || error.status === 403) clear(error.message);
        else dialogGet('[data-seo-dialog-state]').textContent = error.message;
      }
    }

    function editForm(record) {
      const proposal = record.proposal || {};
      const initialStatus = ['draft', 'recommended', 'blocked', 'unverified'].includes(record.status) ? record.status : '';
      const editableStates = Object.fromEntries(['draft', 'recommended', 'blocked', 'unverified'].map(key => [key, statuses[key]]));
      const imageNote = 'Use an HTTPS image URL. Imported private images are retained when the field is empty.';
      return `<form data-seo-editor>
        ${field('title', 'Title', record.title, { required: true })}
        <div class="seo-hq-form-grid">
          ${field('url', 'Page URL', record.url)}
          <label>Area<select name="area">${selectOptions({ ...areas, ...(record.area && !Object.hasOwn(areas, record.area) ? { [record.area]: record.area } : {}) }, record.area)}</select></label>
          <label>Record status<select name="status"><option value="">Keep current status</option>${selectOptions(editableStates, initialStatus)}</select></label>
          ${field('priority', 'Priority score (0–100)', record.priority, { type: 'number' })}
        </div>
        ${field('next', 'Next action', record.next, { rows: 2 })}
        ${field('notes', 'Internal notes', record.notes, { rows: 2 })}
        <div class="seo-hq-form-grid">
          ${proposalFields.map(([key, title]) => field(key, title, key.endsWith('Image') && proposal[key]?.startsWith('data:') ? '' : proposal[key], { rows: ['before', 'after', 'placement', 'checks', 'rollback'].includes(key) ? 3 : 0 })).join('')}
        </div>
        <p class="sub">${imageNote}</p>
        <details class="seo-hq-detail"><summary>Attach evidence</summary>
          <div class="seo-hq-form-grid">
            ${field('evidenceLabel', 'Evidence label')}${field('evidenceUrl', 'Evidence URL', '', { type: 'url' })}
            ${field('evidenceNote', 'Evidence note', '', { rows: 2 })}${field('evidenceDate', 'Evidence date', '', { type: 'date' })}
          </div>
        </details>
        ${record.id ? `<details class="seo-hq-detail"><summary>Release checklist</summary>
          <div class="seo-hq-form-grid">${Object.entries(checks).map(([key, title]) => `<label>${title}
            <select name="check-${key}">${selectOptions({ '': 'Open', pass: 'Passed', ...(optionalChecks.has(key) ? { na: 'Not applicable' } : {}) }, record.checks?.[key] || '')}</select>
          </label>`).join('')}</div>
          ${field('qa', 'QA notes', record.qa, { rows: 3 })}
        </details>` : ''}
        <button type="submit" class="primary">${record.id ? 'Save record' : 'Create opportunity'}</button>
      </form>`;
    }

    function proof(record) {
      const entries = [['Preview', record.preview], ['Owner approval', record.approval], ['Deployment', record.deployment], ['Live verification', record.verification]];
      return `<dl class="seo-hq-receipts">${entries.map(([name, receipt]) => {
        const ref = receipt?.url || receipt?.live || receipt?.ref;
        const parts = [escape(receipt?.reference || receipt?.note), ref ? link(ref, 'Open evidence ↗') : '', escape(date(receipt?.at)), receipt?.revision ? 'Revision ' + escape(receipt.revision) : ''];
        return `<div><dt>${name}</dt><dd>${receipt ? parts.filter(Boolean).join(' · ') || 'Recorded' : 'Awaiting record'}</dd></div>`;
      }).join('')}</dl>`;
    }

    function evidence(record) {
      const imported = record.sourceData?.current || {};
      const importedSources = Array.isArray(imported.evidence) ? imported.evidence
        : imported.evidence || imported.evidenceNote ? [{ url: imported.evidence, note: imported.evidenceNote }]
        : Array.isArray(record.sourceData?.evidence) ? record.sourceData.evidence : [];
      const sources = [...importedSources, ...(Array.isArray(record.evidence) ? record.evidence : [])];
      if (!sources.length) return '';
      return `<section class="seo-hq-copy"><h4>Evidence</h4><ul>${sources.map(source => `<li>${typeof source === 'string'
        ? link(source)
        : [link(source?.url, source?.label), escape(source?.note), escape(date(source?.date))].filter(Boolean).join(' · ')}</li>`).join('')}</ul></section>`;
    }

    function observedVerification(record) {
      const observations = record.sourceData?.publicVerification;
      if (!observations) return '';
      const entries = (Array.isArray(observations) ? observations : [observations]).filter(Boolean);
      return `<section class="seo-hq-copy"><h4>Imported public verification</h4>${entries.map(entry => `
        <p>${[entry.url ? link(entry.url, 'Observed page ↗') : '', escape(entry.scope || entry.note), escape(date(entry.observedAt || entry.at))].filter(Boolean).join(' · ')}</p>
        ${entry.text ? `<p>${escape(entry.text)}</p>` : ''}`).join('')}</section>`;
    }

    function renderRecord(record, allowed) {
      detailRecord = record;
      const proposal = record.proposal || {};
      const images = [['Desktop', proposal.desktopImage], ['Mobile', proposal.mobileImage]]
        .map(([name, value]) => [name, imageUrl(value)]).filter(([, value]) => value);
      const revision = escape(record.revision);
      const history = Array.isArray(record.history) ? record.history : [];
      const canEdit = allowed.edit && record.kind !== 'inventory';
      let action = '';
      const nativeStage = record.nativeWorkflow?.stage;
      if (canEdit && record.status !== 'blocked') {
        if (nativeStage === 'previewed' && allowed.approve) action = 'approve';
        if (nativeStage === 'approved') action = 'record_deployment';
        if (nativeStage === 'deployed') action = 'verify';
        if (!nativeStage && record.status !== 'live' && proposal.after && proposal.placement && record.url) action = 'preview';
      }
      showDialog(record.title, `
        <p class="seo-hq-record-meta">${statusBadge(record.status)} <span>Revision ${revision} · ${escape(label(areas, record.area) || record.kind)}</span></p>
        <p class="seo-hq-record-url">${link(record.url, record.url)} <small>${escape(record.id)}</small></p>
        ${textBlock('Next action', record.next)}
        ${textBlock('Internal notes', record.notes)}
        ${proposal.previewTitle ? textBlock('Proposed heading', proposal.previewTitle) : ''}
        <div class="seo-hq-copy-grid">${textBlock('Before', proposal.before)}${textBlock('Proposed wording', proposal.after)}</div>
        ${textBlock('Exact placement', proposal.placement)}
        ${proposal.destination || proposal.ctaLabel ? `<p>CTA ${link(proposal.destination, proposal.ctaLabel || proposal.destination)}</p>` : ''}
        ${proposal.previewLink ? `<p>${link(proposal.previewLink, 'Open staging preview ↗')}</p>` : ''}
        ${images.length ? `<div class="seo-hq-images" aria-label="Review images">${images.map(([name, value]) => `<figure>
          <img src="${escape(value)}" loading="lazy" referrerpolicy="no-referrer" alt="${name} review image for ${escape(record.title)}">
          <figcaption>${name} review image</figcaption></figure>`).join('')}</div>` : ''}
        ${evidence(record)}
        ${observedVerification(record)}
        ${textBlock('Proposal verification notes', proposal.checks)}
        ${textBlock('QA notes', record.qa)}
        ${textBlock('Rollback plan', proposal.rollback)}
        ${record.kind === 'release' ? `<p class="sub">Release checklist · ${Object.keys(record.checks || {}).length} of ${Object.keys(checks).length} recorded</p>` : ''}
        ${record.kind !== 'inventory' ? proof(record) : ''}
        ${record.sourceData || history.length ? `<details class="seo-hq-detail"><summary>Source and version history</summary>
          ${history.length ? `<h4>History</h4><pre>${escape(readableJson(history))}</pre>` : ''}
          ${record.sourceData ? `<h4>Source record</h4><pre>${escape(readableJson(record.sourceData))}</pre>` : ''}</details>` : ''}
        ${canEdit ? `<details class="seo-hq-detail"><summary>Edit this record</summary>${editForm(record)}</details>` : ''}
        ${action ? actionForm(action, revision) : ''}
      `);
    }

    function readableJson(value) {
      return JSON.stringify(value, (_key, entry) => typeof entry === 'string' && entry.startsWith('data:image/') ? '[Image attached]' : entry, 2);
    }

    function actionForm(action, revision) {
      const stage = stages[action];
      return `<form class="seo-hq-detail seo-hq-action" data-seo-action="${action}">
        <h3>${stage.title}</h3>
        <p class="sub">This records evidence against revision ${revision} in HQ.</p>
        ${stage.fields.map(([name, title, type, required]) => field(name, title, '', { type, required })).join('')}
        ${action === 'approve' ? '<label class="seo-hq-check"><input type="checkbox" required> I approve the exact revision shown above.</label>' : ''}
        <button type="submit" class="primary">${stage.title}</button>
      </form>`;
    }

    function startDraft() {
      if (!isOwner() || !permissions.edit) return;
      detailRecord = undefined;
      showDialog('New opportunity', editForm({ area: 'core', status: 'draft' }));
    }

    function formValues(form) {
      return Object.fromEntries(new FormData(form));
    }

    async function changeRecord(form, method, body, id) {
      const principal = S.me;
      if (!isOwner() || !dialog.open || dialog.querySelector('[aria-busy="true"]')) return;
      const serial = ++writeSerial;
      const state = dialogGet('[data-seo-dialog-state]');
      form.setAttribute('aria-busy', 'true');
      form.querySelector('button[type="submit"]').disabled = true;
      state.textContent = 'Saving…';
      try {
        const result = await api(id ? '/' + encodeURIComponent(id) : '', method, body);
        if (serial !== writeSerial || S.me !== principal || !dialog.open) return;
        if (!result.record) throw Error('The workspace did not confirm the save.');
        renderRecord(result.record, result.permissions || {});
        dialogGet('[data-seo-dialog-state]').textContent = 'Saved to HQ.';
        await loadList();
      } catch (error) {
        if (serial !== writeSerial || S.me !== principal || !dialog.open) return;
        if (error.status === 401 || error.data?.error === 'hq_forbidden') {
          clear(error.message);
          return;
        }
        state.textContent = error.data?.error === 'revision_conflict' ? 'This record changed in another session. Reopen it to review the current revision.' : error.message;
      } finally {
        form.removeAttribute('aria-busy');
        form.querySelector('button[type="submit"]').disabled = false;
      }
    }

    function submitEditor(form) {
      const previous = detailRecord;
      const values = formValues(form);
      const changes = {};
      for (const key of ['title', 'url', 'area', 'status', 'priority', 'next', 'notes']) {
        if (key === 'status' && !values.status) continue;
        const value = key === 'priority' ? (values.priority === '' ? null : Number(values.priority)) : values[key].trim();
        if (value !== (previous?.[key] ?? (key === 'priority' ? null : ''))) changes[key] = value;
      }
      const proposal = {};
      for (const [key] of proposalFields) {
        const oldValue = previous?.proposal?.[key] || '';
        const value = values[key];
        if (key.endsWith('Image') && !value && oldValue.startsWith('data:')) continue;
        if (value !== oldValue) proposal[key] = value;
      }
      if (Object.keys(proposal).length) changes.proposal = proposal;
      const addedEvidence = Object.fromEntries(['label', 'url', 'note', 'date'].map(key => [key, values['evidence' + key[0].toUpperCase() + key.slice(1)].trim()]));
      if (Object.values(addedEvidence).some(Boolean)) changes.evidence = [...(previous?.evidence || []), addedEvidence];
      if (previous) {
        const checked = Object.fromEntries(Object.keys(checks).map(key => [key, values['check-' + key]]).filter(([, value]) => value));
        if (Object.keys(checks).some(key => (checked[key] || '') !== (previous.checks?.[key] || ''))) changes.checks = checked;
        if (values.qa !== (previous.qa || '')) changes.qa = values.qa;
      }
      if (previous && !Object.keys(changes).length) {
        dialogGet('[data-seo-dialog-state]').textContent = 'No changes to save.';
        return;
      }
      return previous
        ? changeRecord(form, 'PATCH', { revision: previous.revision, changes }, previous.id)
        : changeRecord(form, 'POST', { kind: 'opportunity', ...changes });
    }

    function startImport() {
      if (!isOwner() || !permissions.import) return;
      detailRecord = undefined;
      showDialog('Import SEO and content records', `<form data-seo-import-form>
        <p>Choose a prepared HQ migration JSON file. Review the record counts before importing.</p>
        <label>Migration file<input name="file" type="file" accept=".json,application/json" required></label>
        <p data-seo-import-preview role="status"></p>
        <button type="submit" class="primary" disabled>Import records</button>
      </form>`);
      const form = dialogGet('[data-seo-import-form]');
      let batches;
      let fileSerial = 0;
      const preview = form.querySelector('[data-seo-import-preview]');
      const submit = form.querySelector('button[type="submit"]');
      form.elements.file.addEventListener('change', async () => {
        const serial = ++fileSerial;
        batches = undefined;
        submit.disabled = true;
        const file = form.elements.file.files[0];
        if (!file) { preview.textContent = ''; return; }
        preview.textContent = 'Checking file…';
        try {
          if (file.size > 20 * 1024 * 1024) throw Error('Choose a JSON file under 20 MB.');
          const input = JSON.parse(await file.text());
          const plan = planImport(input?.records);
          if (serial !== fileSerial || !form.isConnected) return;
          batches = plan.batches;
          preview.textContent = Object.entries(plan.counts).map(([kind, count]) => `${count.toLocaleString('en-GB')} ${kind}`).join(' · ') + ' · existing records are checked for conflicts';
          submit.disabled = false;
        } catch (error) {
          if (serial === fileSerial && form.isConnected) preview.textContent = error.message;
        }
      });
      form.addEventListener('submit', async event => {
        event.preventDefault();
        if (!batches || !isOwner() || submit.disabled) return;
        const serial = ++writeSerial;
        const principal = S.me;
        submit.disabled = true;
        form.elements.file.disabled = true;
        const counts = { inserted: 0, unchanged: 0, conflicts: 0 };
        const conflictIds = [];
        const state = dialogGet('[data-seo-dialog-state]');
        try {
          for (let index = 0; index < batches.length; index++) {
            if (serial !== writeSerial || S.me !== principal || !dialog.open) return;
            state.textContent = `Importing batch ${index + 1} of ${batches.length}…`;
            const result = await api('/import', 'POST', { records: batches[index] });
            if (serial !== writeSerial || S.me !== principal || !dialog.open) return;
            for (const key of Object.keys(counts)) {
              if (!Number.isInteger(result[key]) || result[key] < 0) throw Error('The workspace did not confirm the batch.');
              counts[key] += result[key];
            }
            if (Array.isArray(result.conflictIds)) conflictIds.push(...result.conflictIds.slice(0, Math.max(0, 10 - conflictIds.length)));
          }
          state.textContent = `Imported ${counts.inserted}. Unchanged ${counts.unchanged}. Conflicts ${counts.conflicts}.` + (conflictIds.length ? ' Review record IDs ' + conflictIds.join(', ') + '.' : '');
          batches = undefined;
          form.reset();
          await loadList();
        } catch (error) {
          if (serial !== writeSerial || S.me !== principal || !dialog.open) return;
          if (error.status === 401 || error.status === 403) clear(error.message);
          else state.textContent = `${error.message} Saved batches are retained. Retry this file to resume.`;
        } finally {
          if (serial === writeSerial && dialog.open) {
            form.elements.file.disabled = false;
            submit.disabled = !batches;
          }
        }
      });
    }

    function planImport(records) {
      if (!Array.isArray(records) || !records.length || records.length > 15000) throw Error('The file must contain 1 to 15,000 records.');
      const counts = { opportunity: 0, inventory: 0, release: 0 };
      const seen = new Set();
      const batches = [];
      const encoder = new TextEncoder();
      const sizeLimit = 900 * 1024;
      let batch = [];
      let size = 16;
      for (const record of records) {
        if (!record || typeof record.id !== 'string' || !/^[a-zA-Z0-9][a-zA-Z0-9._-]{0,127}$/.test(record.id) || !Object.hasOwn(counts, record.kind) || typeof record.title !== 'string' || !record.title.trim()) {
          throw Error('Each record needs a valid ID, kind and title.');
        }
        if (seen.has(record.id)) throw Error('The file contains a duplicate record ID: ' + record.id);
        seen.add(record.id);
        counts[record.kind]++;
        const bytes = encoder.encode(JSON.stringify(record)).byteLength + 1;
        if (bytes > 384 * 1024) throw Error('A record is too large to import: ' + record.id);
        if (batch.length === 15 || size + bytes > sizeLimit) {
          batches.push(batch);
          batch = [];
          size = 16;
        }
        batch.push(record);
        size += bytes;
      }
      if (batch.length) batches.push(batch);
      return { batches, counts };
    }

    root.addEventListener('click', event => {
      const button = event.target.closest('button');
      if (!button) return;
      if (button.hasAttribute('data-seo-new')) startDraft();
      if (button.hasAttribute('data-seo-import')) startImport();
      if (button.dataset.seoOpen) openRecord(button.dataset.seoOpen);
      if (button.dataset.seoTab) {
        activeTab = button.dataset.seoTab;
        offset = 0;
        root.querySelectorAll('[data-seo-tab]').forEach(tab => tab.setAttribute('aria-pressed', String(tab === button)));
        loadList();
      }
      if (button.dataset.seoPage) {
        offset = Math.max(0, offset + LIMIT * Number(button.dataset.seoPage));
        loadList();
      }
    });
    filter.addEventListener('submit', event => {
      event.preventDefault();
      offset = 0;
      loadList();
    });
    dialog.addEventListener('click', event => {
      if (event.target.closest('[data-seo-close]')) dialog.close();
    });
    dialog.addEventListener('close', () => {
      detailSerial++;
      writeSerial++;
      detailRecord = undefined;
      dialog.replaceChildren();
    });
    dialog.addEventListener('input', event => {
      const editor = event.target.closest('[data-seo-editor]');
      if (editor) editor.dataset.dirty = 'true';
    });
    dialog.addEventListener('submit', event => {
      const form = event.target;
      if (form.hasAttribute('data-seo-editor')) {
        event.preventDefault();
        submitEditor(form);
      }
      const action = form.dataset.seoAction;
      if (!action || !detailRecord) return;
      event.preventDefault();
      if (dialogGet('[data-seo-editor][data-dirty]')) {
        dialogGet('[data-seo-dialog-state]').textContent = 'Save the edited wording before recording a decision.';
        return;
      }
      changeRecord(form, 'PATCH', { revision: detailRecord.revision, action, data: formValues(form) }, detailRecord.id);
    });

    navButton.onclick = () => {
      view('seocontent');
      document.getElementById('title').textContent = 'SEO & Content';
      loadList();
    };
    document.getElementById('logoutBtn').addEventListener('click', () => clear(), { capture: true });
    window.addEventListener('pagehide', () => clear());
    window.addEventListener('pageshow', event => { if (event.persisted && root.classList.contains('active')) loadList(); });

    const deepLink = new URLSearchParams(location.search);
    const requested = deepLink.get('view') === 'seocontent';
    let requestedId = requested ? deepLink.get('record') : null;
    function loadRequestedRecord() {
      if (!isOwner() || !requestedId) return;
      const id = requestedId;
      requestedId = null;
      openRecord(id);
    }
    const loginState = document.getElementById('hqUserChip');
    new MutationObserver(() => {
      navButton.hidden = Boolean(S.me && !isOwner());
      if (!S.me) clear();
      else if (!isOwner()) clear(ownerOnly);
      else if (root.classList.contains('active')) {
        loadList();
        loadRequestedRecord();
      }
    }).observe(loginState, { childList: true, subtree: true });
    navButton.hidden = Boolean(S.me && !isOwner());
    if (requested) {
      navButton.click();
      loadRequestedRecord();
    }
  };
})();
