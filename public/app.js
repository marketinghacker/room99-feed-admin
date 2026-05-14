// Room99 Feed Command Center — Sprint 2 (read-only with manual regenerate trigger)
// Vanilla JS SPA: hash router, fetch helpers, section renderers.
// Zero deps. Write actions to config.json deferred — pre-flight diff infra first.

const REPO_URL = 'https://github.com/marketinghacker/room99-feed-duplicator';
const CONFIG_URL = REPO_URL + '/blob/main/config.json';
const COMMITS_URL = REPO_URL + '/commits/main/config.json';

// ---------- Router ----------
const SECTIONS = ['today', 'rules', 'hypotheses', 'images', 'performance', 'feed-health', 'history', 'add-variant'];
const RENDERED = new Set();

function activateTab(tab) {
  if (!SECTIONS.includes(tab)) tab = 'today';
  document.querySelectorAll('.section').forEach((el) => el.classList.remove('active'));
  document.querySelectorAll('.tabs a').forEach((el) => el.classList.toggle('active', el.dataset.tab === tab));
  const sec = document.getElementById('section-' + tab);
  if (sec) sec.classList.add('active');
  // Lazy render
  if (!RENDERED.has(tab)) {
    const renderer = RENDERERS[tab];
    if (renderer) renderer();
    RENDERED.add(tab);
  }
}

function onHashChange() {
  const tab = (location.hash || '#today').replace(/^#/, '');
  activateTab(tab);
}

// ---------- Fetch helpers ----------
async function fetchJSON(url) {
  const r = await fetch(url);
  if (!r.ok) {
    let detail = '';
    try {
      const j = await r.json();
      detail = j.error || JSON.stringify(j).substring(0, 120);
    } catch {
      // Non-JSON body (e.g. HTML 404 page from static server) — drop it
    }
    throw new Error(`${r.status} ${r.statusText}${detail ? ' — ' + detail : ''}`);
  }
  return r.json();
}

function fmtDate(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleString('pl-PL', { dateStyle: 'short', timeStyle: 'short' });
}

function fmtRelative(iso) {
  if (!iso) return '—';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return iso;
  const diff = (Date.now() - d.getTime()) / 1000;
  if (diff < 60) return Math.floor(diff) + 's temu';
  if (diff < 3600) return Math.floor(diff / 60) + ' min temu';
  if (diff < 86400) return Math.floor(diff / 3600) + ' h temu';
  return Math.floor(diff / 86400) + ' dni temu';
}

function escapeHTML(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
}

// ---------- State ----------
const state = {
  config: null,
  configSha: null,
  feedStats: null,
  configError: null,
  statsError: null,
};

async function loadCoreData() {
  const [cfgResult, statsResult] = await Promise.allSettled([
    fetchJSON('/api/config'),
    fetchJSON('/api/feed-stats'),
  ]);
  if (cfgResult.status === 'fulfilled') {
    state.config = cfgResult.value.config;
    state.configSha = cfgResult.value.sha;
  } else {
    state.configError = cfgResult.reason.message;
  }
  if (statsResult.status === 'fulfilled') {
    state.feedStats = statsResult.value;
  } else {
    state.statsError = statsResult.reason.message;
  }
}

// ---------- Renderers ----------
const RENDERERS = {
  today: renderToday,
  rules: renderRules,
  hypotheses: () => {}, // static placeholder
  images: renderImages,
  performance: renderPerformance,
  'feed-health': renderFeedHealth,
  history: renderHistoryLink,
  'add-variant': renderAddVariant,
};

// Re-render Today when performance snapshot arrives so recommendations refresh
async function ensurePerformanceSnapshotLoaded() {
  if (state.perfSnapshot || state.perfSnapshotError) return;
  try {
    state.perfSnapshot = await fetchJSON('/api/performance-snapshot');
  } catch (e) {
    state.perfSnapshotError = e.message;
  }
}

// ---------- Word Capitalize (mirror of generate-feed.js) ----------
// Pierwsza litera każdego słowa wielka, reszta mała. Zachowuje "155x270" (x lowercase między cyframi).
// Negative lookbehind: litera musi NIE być poprzedzona przez literę ANI cyfrę.
function wordCapitalize(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/(?<![\p{L}\d])(\p{L})(\p{L}*)/gu, (m, first, rest) => first.toUpperCase() + rest);
}

async function renderToday() {
  await ensureCoreLoaded();

  // KPI strip
  const kpiEl = document.getElementById('kpi-strip');
  const rules = state.config?.duplicateRules || [];
  const activeRules = rules.filter((r) => r.active);
  const outputRows = state.feedStats?.output?.total_rows ?? '—';
  const lastCron = state.feedStats?.last_cron_run;
  const lastChange = state.feedStats?.last_config_change;

  const cronPill = lastCron
    ? lastCron.conclusion === 'success'
      ? '<span class="pill pill-success">success</span>'
      : `<span class="pill pill-${lastCron.conclusion === 'failure' ? 'error' : 'warning'}">${lastCron.conclusion || lastCron.status}</span>`
    : '<span class="pill pill-muted">—</span>';

  kpiEl.innerHTML = `
    <div class="kpi-tile">
      <div class="kpi-label">Active rules</div>
      <div class="kpi-value">${activeRules.length}<span class="text-muted" style="font-size:14px;font-weight:500;"> / ${rules.length}</span></div>
      <div class="kpi-sub">${rules.length - activeRules.length} inactive</div>
    </div>
    <div class="kpi-tile">
      <div class="kpi-label">Duplicates in feed</div>
      <div class="kpi-value">${outputRows.toLocaleString ? outputRows.toLocaleString('pl-PL') : outputRows}</div>
      <div class="kpi-sub">output/google-pl-with-test-titles.tsv</div>
    </div>
    <div class="kpi-tile">
      <div class="kpi-label">Last feed regeneration</div>
      <div class="kpi-value" style="font-size:18px;">${lastCron ? fmtRelative(lastCron.completed_at) : '—'}</div>
      <div class="kpi-sub">${cronPill} ${lastCron ? '· #' + lastCron.run_number : ''}</div>
    </div>
    <div class="kpi-tile">
      <div class="kpi-label">Last config change</div>
      <div class="kpi-value" style="font-size:18px;">${lastChange ? fmtRelative(lastChange.timestamp) : '—'}</div>
      <div class="kpi-sub mono">${lastChange ? escapeHTML(lastChange.short_sha) + ' · ' + escapeHTML(lastChange.author) : '—'}</div>
    </div>
  `;

  // Decisions feed — fire snapshot fetch in background then re-render this card
  await ensurePerformanceSnapshotLoaded();
  const decisionsEl = document.getElementById('decisions-feed');
  const decisions = buildDecisions(rules, activeRules, lastCron, state.perfSnapshot);
  decisionsEl.innerHTML = decisions
    .map(
      (d) => `
    <div class="decision-card">
      <div class="decision-icon ${d.severity}">${d.icon || '●'}</div>
      <div class="decision-body">
        <div class="decision-title">${d.title}</div>
        <div class="decision-meta">${d.meta}</div>
      </div>
    </div>
  `
    )
    .join('');

  // Feed activity (right column)
  const activityEl = document.getElementById('feed-activity');
  activityEl.innerHTML = `
    <div class="mb-2">
      <div class="kpi-label">Last cron tick</div>
      <div class="mb-1">
        ${lastCron ? `
          <div class="flex-between mb-1">
            <span>${cronPill}</span>
            <span class="text-muted mono" style="font-size:11px;">#${lastCron.run_number}</span>
          </div>
          <div class="text-dim" style="font-size:12px;">${fmtDate(lastCron.completed_at)}</div>
          <div class="text-muted" style="font-size:11px;">trigger: ${escapeHTML(lastCron.trigger || '')}</div>
          <a href="${escapeHTML(lastCron.html_url)}" target="_blank" rel="noopener" class="mono" style="font-size:11px;">view run on GitHub →</a>
        ` : '<div class="text-muted">No data</div>'}
      </div>
    </div>
    <div class="mb-2" style="border-top:1px solid var(--border);padding-top:14px;">
      <div class="kpi-label">Last config change</div>
      ${lastChange ? `
        <div class="text-dim mb-1" style="font-size:13px;">${escapeHTML(lastChange.message)}</div>
        <div class="text-muted" style="font-size:11px;">
          <span class="mono">${escapeHTML(lastChange.short_sha)}</span> · ${escapeHTML(lastChange.author)} · ${fmtDate(lastChange.timestamp)}
        </div>
        <a href="${escapeHTML(lastChange.html_url)}" target="_blank" rel="noopener" class="mono" style="font-size:11px;">view commit →</a>
      ` : '<div class="text-muted">No data</div>'}
    </div>
  `;
}

// Build heuristic Today recommendations from config + snapshot
function buildDecisions(rules, activeRules, lastCron, snapshot) {
  const out = [];

  // 1. Critical: duplicate diagnosis if available
  if (snapshot?.duplicate_diagnosis?.status === 'critical') {
    out.push({
      severity: 'warning',
      icon: '🚨',
      title: snapshot.duplicate_diagnosis.headline,
      meta: `<strong>Powód #1:</strong> ${escapeHTML(snapshot.duplicate_diagnosis.likely_root_causes?.[0]?.title || '—')} · <a href="#performance">zobacz pełną diagnozę →</a>`,
    });
  }

  // 2. Underperforming campaigns
  if (snapshot?.underperforming_campaigns?.length) {
    const c = snapshot.underperforming_campaigns[0];
    out.push({
      severity: 'warning',
      icon: '↓',
      title: `Kampania "${escapeHTML(c.name)}" ma ROAS ${c.roas} — strata budgetu`,
      meta: escapeHTML(c.alert),
    });
  }

  // 3. Winner pattern
  if (snapshot?.winner_campaigns?.length) {
    const w = snapshot.winner_campaigns[0];
    out.push({
      severity: 'info',
      icon: '🏆',
      title: `Top performer: ${escapeHTML(w.name)} (ROAS ${w.roas}x)`,
      meta: escapeHTML(w.note),
    });
  }

  // 4. Failed cron
  if (lastCron && lastCron.conclusion !== 'success') {
    out.push({
      severity: 'warning',
      icon: '!',
      title: 'Ostatni cron tick nie zakończył się sukcesem',
      meta: `Status: ${escapeHTML(lastCron.conclusion || lastCron.status)} · <a href="${escapeHTML(lastCron.html_url)}" target="_blank" rel="noopener">view run →</a>`,
    });
  }

  // 5. Status summary
  out.push({
    severity: 'info',
    icon: '●',
    title: `${activeRules.length}/${rules.length} reguł aktywnych — generują duplikaty test variants`,
    meta: 'Zarządzaj w <a href="#rules">Rules tab</a> · klik wiersza otwiera side-panel z editem',
  });

  // 6. CTA
  out.push({
    severity: 'info',
    icon: '▸',
    title: 'Dodaj nowy wariant tytułu',
    meta: 'Legacy form (issue-based) — <a href="#add-variant">otwórz formularz →</a>',
  });

  return out;
}

async function renderRules() {
  await ensureCoreLoaded();
  // Re-fetch latest config on each render so toggles/edits stay fresh
  await reloadConfig();

  const linkEl = document.getElementById('rules-source-link');
  linkEl.href = CONFIG_URL;

  if (state.configError) {
    document.getElementById('rules-count').textContent = 'Błąd ładowania';
    document.getElementById('rules-table-wrap').innerHTML =
      `<div class="alert error show">Nie udało się pobrać reguł: ${escapeHTML(state.configError)}</div>`;
    return;
  }

  const rules = state.config?.duplicateRules || [];
  const active = rules.filter((r) => r.active).length;
  document.getElementById('rules-count').textContent =
    `${rules.length} reguł · ${active} aktywnych · ${rules.length - active} nieaktywnych · klik wiersz aby edytować`;

  if (rules.length === 0) {
    document.getElementById('rules-table-wrap').innerHTML =
      '<div class="placeholder"><div class="placeholder-title">Brak reguł</div></div>';
    return;
  }

  const rows = rules
    .map(
      (r) => `
    <tr class="rules-row" data-rule-id="${escapeHTML(r.id)}">
      <td class="mono"><strong>${escapeHTML(r.dupSuffix || '—')}</strong></td>
      <td><span class="pill pill-muted">${escapeHTML(r.matchInTitle || '—')}</span></td>
      <td>
        <div class="text-dim mono" style="font-size:11px;">${escapeHTML(r.searchInTitle || '')}</div>
        <div style="font-weight:500;">${escapeHTML(r.replaceWith || '')}</div>
      </td>
      <td>
        <span class="pill match-count-badge pill-info" data-mc-rule="${escapeHTML(r.id)}" title="Loading…">…</span>
      </td>
      <td>
        <button class="pill status-toggle ${r.active ? 'pill-success' : 'pill-muted'}" data-toggle-rule="${escapeHTML(r.id)}" data-current="${r.active ? 'true' : 'false'}" title="Klik aby ${r.active ? 'wyłączyć' : 'włączyć'}">
          ${r.active ? 'active' : 'inactive'}
        </button>
      </td>
      <td class="text-muted" style="font-size:12px;">${escapeHTML(r.notes || '')}</td>
      <td>
        <button class="pill pill-info edit-rule-btn" data-edit-rule="${escapeHTML(r.id)}" style="border:none;cursor:pointer;">Edit →</button>
      </td>
    </tr>
  `
    )
    .join('');

  document.getElementById('rules-table-wrap').innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Suffix</th>
          <th>Group</th>
          <th>Search → Replace</th>
          <th>Match #</th>
          <th>Status</th>
          <th>Notes</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  // Wire click handlers
  document.querySelectorAll('.edit-rule-btn').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openSidePanelEditor(btn.dataset.editRule);
    });
  });
  document.querySelectorAll('.rules-row').forEach((row) => {
    row.addEventListener('click', () => openSidePanelEditor(row.dataset.ruleId));
  });
  document.querySelectorAll('.status-toggle').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const ruleId = btn.dataset.toggleRule;
      const currentActive = btn.dataset.current === 'true';
      btn.disabled = true;
      btn.textContent = '…';
      try {
        const r = await fetch('/api/rules/' + encodeURIComponent(ruleId), {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'toggle' }),
        });
        const j = await r.json();
        if (r.ok) {
          showToast(`✓ ${ruleId} → ${currentActive ? 'inactive' : 'active'} — feed regeneruje się w ≤1h`, 'success');
          await reloadConfig();
          renderRules();
        } else {
          showToast('Błąd: ' + (j.error || 'unknown'), 'error');
          btn.disabled = false;
          btn.textContent = currentActive ? 'active' : 'inactive';
        }
      } catch (err) {
        showToast('Błąd sieci: ' + err.message, 'error');
        btn.disabled = false;
      }
    });
  });

  // Fire match-count fetches in parallel (lightweight — server caches FO feed)
  rules.forEach((r) => {
    fetch('/api/rule-impact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchInTitle: r.matchInTitle }),
    })
      .then((res) => res.json())
      .then((data) => {
        const el = document.querySelector(`[data-mc-rule="${CSS.escape(r.id)}"]`);
        if (el && data.matched_count !== undefined) {
          el.textContent = data.matched_count.toString();
          el.title = `${data.matched_count} produktów matchuje "${r.matchInTitle}" w aktywnym feedzie`;
          if (data.matched_count === 0) el.className = 'pill match-count-badge pill-warning';
        }
      })
      .catch(() => {
        const el = document.querySelector(`[data-mc-rule="${CSS.escape(r.id)}"]`);
        if (el) {
          el.textContent = '—';
          el.className = 'pill match-count-badge pill-muted';
        }
      });
  });
}

async function reloadConfig() {
  try {
    const data = await fetchJSON('/api/config');
    state.config = data.config;
    state.configSha = data.sha;
    state.configError = null;
  } catch (e) {
    state.configError = e.message;
  }
}

// ---------- TOAST ----------
function showToast(message, type) {
  let container = document.getElementById('toast-container');
  if (!container) {
    container = document.createElement('div');
    container.id = 'toast-container';
    container.style.cssText = 'position:fixed;bottom:20px;right:20px;z-index:300;display:flex;flex-direction:column;gap:8px;';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'alert show ' + (type || 'success');
  toast.style.cssText = 'min-width:280px;max-width:420px;box-shadow:0 4px 12px rgba(0,0,0,0.5);';
  toast.innerHTML = message;
  container.appendChild(toast);
  setTimeout(() => { toast.style.opacity = '0'; toast.style.transition = 'opacity 0.3s'; }, 4500);
  setTimeout(() => toast.remove(), 5000);
}

// ---------- SIDE-PANEL EDITOR ----------
const sp = {
  current: null,
  debounceTimer: null,
};

function openSidePanelEditor(ruleId) {
  const rules = state.config?.duplicateRules || [];
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) {
    showToast('Reguła nie znaleziona', 'error');
    return;
  }
  sp.current = JSON.parse(JSON.stringify(rule)); // working copy
  sp.original = JSON.parse(JSON.stringify(rule));

  document.getElementById('sp-rule-id').textContent = rule.id;
  document.getElementById('sp-rule-status').innerHTML =
    `<span class="mono">${escapeHTML(rule.dupSuffix || '')}</span> · ${rule.active
      ? '<span class="pill pill-success">active</span>'
      : '<span class="pill pill-muted">inactive</span>'} · created ${escapeHTML((rule.created_at || '').substring(0, 10) || '—')}${rule.updated_at ? ' · last edit ' + escapeHTML(rule.updated_at.substring(0, 10)) : ''}`;

  ['matchInTitle', 'searchInTitle', 'replaceWith', 'dupSuffix', 'notes'].forEach((field) => {
    document.getElementById('sp-' + field).value = rule[field] || '';
  });

  document.getElementById('side-panel').classList.add('show');
  document.getElementById('side-panel-backdrop').classList.add('show');
  document.getElementById('side-panel').setAttribute('aria-hidden', 'false');

  bindSidePanelHandlers();
  runImpactCheck();
}

function closeSidePanel() {
  document.getElementById('side-panel').classList.remove('show');
  document.getElementById('side-panel-backdrop').classList.remove('show');
  document.getElementById('side-panel').setAttribute('aria-hidden', 'true');
  sp.current = null;
  sp.original = null;
}

let _sidePanelBound = false;
function bindSidePanelHandlers() {
  if (_sidePanelBound) return;
  _sidePanelBound = true;

  document.getElementById('sp-close').addEventListener('click', closeSidePanel);
  document.getElementById('side-panel-backdrop').addEventListener('click', closeSidePanel);
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && document.getElementById('side-panel').classList.contains('show')) closeSidePanel();
  });

  // Field change → update working copy + debounce impact check + update preview
  ['matchInTitle', 'searchInTitle', 'replaceWith', 'dupSuffix', 'notes'].forEach((field) => {
    document.getElementById('sp-' + field).addEventListener('input', (e) => {
      if (!sp.current) return;
      sp.current[field] = e.target.value;
      updateReplacePreview();
      updateDiff();
      if (['matchInTitle', 'searchInTitle', 'replaceWith', 'dupSuffix'].includes(field)) {
        clearTimeout(sp.debounceTimer);
        sp.debounceTimer = setTimeout(runImpactCheck, 350);
      }
    });
  });

  document.getElementById('sp-save').addEventListener('click', saveSidePanelChanges);
  document.getElementById('sp-toggle').addEventListener('click', toggleSidePanelRule);
  document.getElementById('sp-delete').addEventListener('click', deleteSidePanelRule);
}

function updateReplacePreview() {
  const raw = (sp.current.replaceWith || '').trim();
  const el = document.getElementById('sp-replace-preview');
  if (!raw) { el.textContent = '—'; el.style.color = 'var(--muted)'; return; }
  const normalized = wordCapitalize(raw);
  el.textContent = normalized;
  el.style.color = raw === normalized ? 'var(--success)' : 'var(--warning)';
}

function updateDiff() {
  const orig = sp.original;
  const cur = sp.current;
  const fields = ['matchInTitle', 'searchInTitle', 'replaceWith', 'dupSuffix', 'notes'];
  const diff = {};
  for (const f of fields) {
    if ((orig[f] || '') !== (cur[f] || '')) {
      diff[f] = { before: orig[f] || '', after: cur[f] || '' };
    }
  }
  document.getElementById('sp-diff').textContent =
    Object.keys(diff).length === 0 ? 'No changes yet' : JSON.stringify(diff, null, 2);
}

async function runImpactCheck() {
  if (!sp.current) return;
  const otherRules = (state.config?.duplicateRules || []).filter((r) => r.id !== sp.current.id);
  let data;
  try {
    data = await fetch('/api/rule-impact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        matchInTitle: sp.current.matchInTitle,
        searchInTitle: sp.current.searchInTitle,
        replaceWith: sp.current.replaceWith,
        dupSuffix: sp.current.dupSuffix,
        ruleId: sp.current.id,
        otherRules,
      }),
    }).then((r) => r.json());
  } catch (e) {
    document.getElementById('sp-impact-banner').innerHTML =
      `<div class="alert error show">Błąd impact check: ${escapeHTML(e.message)}</div>`;
    return;
  }

  if (data.error) {
    document.getElementById('sp-impact-banner').innerHTML =
      `<div class="alert error show">${escapeHTML(data.error)}</div>`;
    return;
  }

  // Banner
  const errorsCount = (data.validators || []).filter((v) => v.level === 'error').length;
  const bannerLevel = errorsCount > 0 ? 'error' : (data.matched_count === 0 ? 'warning' : 'success');
  document.getElementById('sp-impact-banner').innerHTML = `
    <div class="alert show ${bannerLevel}">
      <strong>${data.matched_count}</strong> z ${data.total_products} produktów dotkniętych regułą.
      ${errorsCount > 0 ? ` <strong>${errorsCount} blokujący błąd${errorsCount > 1 ? 'y' : ''}</strong> w walidatorach poniżej.` : ''}
    </div>
  `;

  // Validators
  const vl = document.getElementById('sp-validators');
  if (!data.validators || data.validators.length === 0) {
    vl.innerHTML = '<div class="text-muted" style="font-size:12px;">Wszystko OK — żadnych ostrzeżeń</div>';
  } else {
    vl.innerHTML = data.validators
      .map(
        (v) => `
      <div class="validator-item ${escapeHTML(v.level)}">
        <span class="vmark">${v.level === 'error' ? '✕' : v.level === 'warning' ? '⚠' : 'ⓘ'}</span>
        <span>${escapeHTML(v.message)}</span>
      </div>
    `
      )
      .join('');
  }

  // Samples
  const sc = document.getElementById('sp-sample-count');
  sc.textContent = `pokazuję ${data.samples?.length || 0} z ${data.matched_count}`;
  const sa = document.getElementById('sp-samples');
  if (!data.samples || data.samples.length === 0) {
    sa.innerHTML = '<div class="text-muted" style="font-size:12px;">Brak matched products</div>';
  } else {
    sa.innerHTML = data.samples
      .map(
        (s) => `
      <div class="sample-preview">
        <div class="sample-id">id ${escapeHTML(s.id)}</div>
        <div class="sample-before">${escapeHTML(s.before)}</div>
        <div class="sample-after">→ ${escapeHTML(s.after)}</div>
      </div>
    `
      )
      .join('');
  }

  // Disable save if any error
  document.getElementById('sp-save').disabled = errorsCount > 0;
  document.getElementById('sp-save').title = errorsCount > 0 ? 'Resolve errors first' : '';
}

async function saveSidePanelChanges() {
  if (!sp.current) return;
  const id = sp.original.id;
  const changes = {};
  for (const f of ['matchInTitle', 'searchInTitle', 'replaceWith', 'dupSuffix', 'notes']) {
    if ((sp.original[f] || '') !== (sp.current[f] || '')) {
      changes[f] = sp.current[f];
    }
  }
  if (Object.keys(changes).length === 0) {
    showToast('Brak zmian do zapisania', 'warning');
    return;
  }
  const btn = document.getElementById('sp-save');
  btn.disabled = true;
  btn.textContent = 'Zapisuję…';
  try {
    const r = await fetch('/api/rules/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'edit', changes }),
    });
    const j = await r.json();
    if (r.ok) {
      showToast(`✓ Reguła ${id} zapisana — feed regeneruje się w ≤1h. <a class="mono" href="${escapeHTML(j.commit_url || '#')}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;">view commit →</a>`, 'success');
      closeSidePanel();
      await reloadConfig();
      renderRules();
    } else {
      showToast('Błąd: ' + (j.error || 'unknown'), 'error');
      btn.disabled = false;
      btn.textContent = 'Zapisz';
    }
  } catch (e) {
    showToast('Błąd sieci: ' + e.message, 'error');
    btn.disabled = false;
    btn.textContent = 'Zapisz';
  }
}

async function toggleSidePanelRule() {
  if (!sp.original) return;
  const id = sp.original.id;
  try {
    const r = await fetch('/api/rules/' + encodeURIComponent(id), {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'toggle' }),
    });
    const j = await r.json();
    if (r.ok) {
      showToast(`✓ ${id} toggled — feed regeneruje się w ≤1h`, 'success');
      closeSidePanel();
      await reloadConfig();
      renderRules();
    } else {
      showToast('Błąd: ' + (j.error || 'unknown'), 'error');
    }
  } catch (e) {
    showToast('Błąd sieci: ' + e.message, 'error');
  }
}

async function deleteSidePanelRule() {
  if (!sp.original) return;
  const id = sp.original.id;
  if (!confirm(`Usunąć regułę "${id}"? Tego nie można cofnąć inline — tylko git revert.`)) return;
  try {
    const r = await fetch('/api/rules/' + encodeURIComponent(id), {
      method: 'DELETE',
    });
    const j = await r.json();
    if (r.ok) {
      showToast(`✓ Reguła ${id} usunięta — feed regeneruje się w ≤1h. <a class="mono" href="${escapeHTML(j.commit_url || '#')}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;">view commit →</a>`, 'success');
      closeSidePanel();
      await reloadConfig();
      renderRules();
    } else {
      showToast('Błąd: ' + (j.error || 'unknown'), 'error');
    }
  } catch (e) {
    showToast('Błąd sieci: ' + e.message, 'error');
  }
}

async function renderFeedHealth() {
  await ensureCoreLoaded();

  // Wire regenerate button (idempotent — bind once)
  const regenBtn = document.getElementById('regenerate-btn');
  const regenStatus = document.getElementById('regenerate-status');
  if (regenBtn && regenBtn.dataset.bound !== '1') {
    regenBtn.dataset.bound = '1';
    regenBtn.addEventListener('click', async () => {
      regenBtn.disabled = true;
      regenBtn.textContent = '⟳ Trigger…';
      regenStatus.className = 'alert';
      try {
        const r = await fetch('/api/regenerate-feed', { method: 'POST' });
        const j = await r.json();
        if (r.ok) {
          regenStatus.className = 'alert show success';
          regenStatus.innerHTML = `✓ ${escapeHTML(j.message)} <button class="pill pill-info" id="regen-refresh" style="margin-left:8px;border:none;cursor:pointer;">Refresh status now →</button>`;
          document.getElementById('regen-refresh')?.addEventListener('click', async () => {
            state.feedStats = null;
            state.statsError = null;
            _coreLoaded = null;
            await ensureCoreLoaded();
            renderFeedHealth();
          });
        } else {
          regenStatus.className = 'alert show error';
          regenStatus.textContent = 'Błąd: ' + (j.error || 'unknown');
        }
      } catch (e) {
        regenStatus.className = 'alert show error';
        regenStatus.textContent = 'Błąd sieci: ' + e.message;
      } finally {
        regenBtn.disabled = false;
        regenBtn.textContent = '⟳ Regenerate now';
      }
    });
  }

  const body = document.getElementById('feed-health-body');
  const fetchedEl = document.getElementById('feed-health-fetched-at');

  if (state.statsError) {
    body.innerHTML = `<div class="alert error show">Błąd: ${escapeHTML(state.statsError)}</div>`;
    return;
  }

  fetchedEl.textContent = state.feedStats?.fetched_at
    ? 'Fetched ' + fmtRelative(state.feedStats.fetched_at)
    : '';

  const o = state.feedStats?.output;
  const c = state.feedStats?.last_config_change;
  const r = state.feedStats?.last_cron_run;

  body.innerHTML = `
    <table class="data-table">
      <tr>
        <th style="width:200px;">Output TSV rows</th>
        <td><strong>${o ? o.total_rows.toLocaleString('pl-PL') : '—'}</strong> · ${o ? Math.round(o.size_bytes / 1024) + ' KB' : '—'}</td>
      </tr>
      <tr>
        <th>Last cron run</th>
        <td>
          ${r ? `
            ${r.conclusion === 'success' ? '<span class="pill pill-success">success</span>' : `<span class="pill pill-${r.conclusion === 'failure' ? 'error' : 'warning'}">${escapeHTML(r.conclusion || r.status)}</span>`}
            · #${r.run_number} · ${fmtRelative(r.completed_at)} (${fmtDate(r.completed_at)})
            · trigger: <span class="mono">${escapeHTML(r.trigger || '')}</span>
            · <a href="${escapeHTML(r.html_url)}" target="_blank" rel="noopener" class="mono">view →</a>
          ` : '—'}
        </td>
      </tr>
      <tr>
        <th>Last config commit</th>
        <td>
          ${c ? `
            <div class="text-dim">${escapeHTML(c.message)}</div>
            <div class="text-muted" style="font-size:12px;">
              <span class="mono">${escapeHTML(c.short_sha)}</span> · ${escapeHTML(c.author)} · ${fmtDate(c.timestamp)} · <a href="${escapeHTML(c.html_url)}" target="_blank" rel="noopener" class="mono">view →</a>
            </div>
          ` : '—'}
        </td>
      </tr>
      <tr>
        <th>Feed pipeline</th>
        <td>
          FeedOptimise (source) → GitHub Actions (cron 1h) → GitHub Pages (TSV) → GMC fetch
        </td>
      </tr>
      <tr>
        <th>GMC re-fetch</th>
        <td class="text-muted">Configured in Google Merchant Center · cron 6–24h depending on settings</td>
      </tr>
    </table>
  `;
}

function renderHistoryLink() {
  const a = document.getElementById('history-temp-link');
  if (a) a.href = COMMITS_URL;
}

// ---------- PERFORMANCE ----------
async function renderPerformance() {
  await ensurePerformanceSnapshotLoaded();

  const subtitle = document.getElementById('perf-subtitle');
  const banner = document.getElementById('perf-diagnosis-banner');
  const summary = document.getElementById('perf-summary');
  const table = document.getElementById('perf-campaigns-table');
  const actions = document.getElementById('perf-actions');
  const actionsCard = document.getElementById('perf-actions-card');
  const sub = document.getElementById('perf-campaigns-sub');

  if (state.perfSnapshotError) {
    subtitle.textContent = 'Błąd ładowania';
    banner.innerHTML = `<div class="alert error show">Snapshot fetch error: ${escapeHTML(state.perfSnapshotError)}</div>`;
    table.innerHTML = '';
    return;
  }
  const s = state.perfSnapshot;
  if (!s) return;

  subtitle.innerHTML = `Live Google Ads data, ${escapeHTML((s.captured_at || '').substring(0, 16).replace('T', ' '))} UTC · account ${escapeHTML(s.account?.google_ads_customer_id || '')}`;

  // Critical diagnosis banner
  if (s.duplicate_diagnosis && s.duplicate_diagnosis.status === 'critical') {
    banner.innerHTML = `
      <div class="alert error show" style="font-size:14px;line-height:1.5;">
        <strong>🚨 ${escapeHTML(s.duplicate_diagnosis.headline)}</strong>
        <div style="margin-top:6px;font-size:13px;">Evidence:</div>
        <ul style="margin:4px 0 8px 22px;font-size:12px;">
          ${(s.duplicate_diagnosis.evidence || []).map((e) => `<li>${escapeHTML(e)}</li>`).join('')}
        </ul>
        <div style="margin-top:8px;font-size:13px;"><strong>Najbardziej prawdopodobne przyczyny:</strong></div>
        <ol style="margin:4px 0 0 22px;font-size:12px;">
          ${(s.duplicate_diagnosis.likely_root_causes || []).map((c) => `
            <li style="margin-bottom:6px;">
              <span class="pill pill-${c.probability === 'high' ? 'error' : 'warning'}" style="font-size:10px;">${escapeHTML(c.probability)}</span>
              <strong>${escapeHTML(c.title)}</strong><br>
              <span style="opacity:0.85;">${escapeHTML(c.detail)}</span>
            </li>
          `).join('')}
        </ol>
      </div>
    `;
  } else {
    banner.innerHTML = '';
  }

  // Summary KPI strip
  const sum = s.summary_30d || {};
  summary.innerHTML = `
    <div class="kpi-tile">
      <div class="kpi-label">Blended ROAS (30d)</div>
      <div class="kpi-value">${(sum.blended_roas || 0).toFixed(2)}<span class="text-muted" style="font-size:14px;font-weight:500;">x</span></div>
      <div class="kpi-sub">${(sum.total_conv_value_pln || 0).toLocaleString('pl-PL', { maximumFractionDigits: 0 })} PLN przychód / ${(sum.total_cost_pln || 0).toLocaleString('pl-PL', { maximumFractionDigits: 0 })} PLN spend</div>
    </div>
    <div class="kpi-tile">
      <div class="kpi-label">Conversions (30d)</div>
      <div class="kpi-value">${(sum.total_clicks || 0).toLocaleString('pl-PL')}</div>
      <div class="kpi-sub">clicks · CTR ${((sum.blended_ctr || 0) * 100).toFixed(2)}% · CPC ${(sum.blended_cpc_pln || 0).toFixed(2)} PLN</div>
    </div>
    <div class="kpi-tile">
      <div class="kpi-label">Impressions (30d)</div>
      <div class="kpi-value">${((sum.total_impressions || 0) / 1000).toFixed(0)}k</div>
      <div class="kpi-sub">total reach across all campaigns</div>
    </div>
    <div class="kpi-tile">
      <div class="kpi-label">Variants in test (t1..t7)</div>
      <div class="kpi-value" style="color:var(--error);">0<span class="text-muted" style="font-size:14px;font-weight:500;"> impr</span></div>
      <div class="kpi-sub error" style="color:var(--error);">A/B test nie zbiera danych — patrz diagnosis powyżej</div>
    </div>
  `;

  // Top campaigns table
  const campaigns = s.top_campaigns_30d || [];
  sub.textContent = `${campaigns.length} kampanii sortowane po spend · suma ${(sum.total_cost_pln || 0).toLocaleString('pl-PL', { maximumFractionDigits: 0 })} PLN`;
  table.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Campaign</th>
          <th>Channel</th>
          <th style="text-align:right;">Impr</th>
          <th style="text-align:right;">Clicks</th>
          <th style="text-align:right;">CTR</th>
          <th style="text-align:right;">CPC PLN</th>
          <th style="text-align:right;">Cost PLN</th>
          <th style="text-align:right;">Conv</th>
          <th style="text-align:right;">Conv value PLN</th>
          <th style="text-align:right;">ROAS</th>
        </tr>
      </thead>
      <tbody>
        ${campaigns.map((c) => {
          const roasClass = c.roas >= 8 ? 'pill-success' : c.roas >= 3 ? 'pill-info' : c.roas >= 1 ? 'pill-warning' : 'pill-error';
          return `
          <tr>
            <td><strong>${escapeHTML(c.name)}</strong><br><span class="mono text-muted" style="font-size:11px;">${escapeHTML(c.id)}</span></td>
            <td><span class="pill pill-muted">${escapeHTML(c.channel)}</span></td>
            <td style="text-align:right;" class="mono">${c.impressions.toLocaleString('pl-PL')}</td>
            <td style="text-align:right;" class="mono">${c.clicks.toLocaleString('pl-PL')}</td>
            <td style="text-align:right;" class="mono">${(c.ctr * 100).toFixed(2)}%</td>
            <td style="text-align:right;" class="mono">${c.cpc_pln.toFixed(2)}</td>
            <td style="text-align:right;" class="mono">${c.cost_pln.toLocaleString('pl-PL', { maximumFractionDigits: 0 })}</td>
            <td style="text-align:right;" class="mono">${Math.round(c.conv).toLocaleString('pl-PL')}</td>
            <td style="text-align:right;" class="mono">${c.conv_value_pln.toLocaleString('pl-PL', { maximumFractionDigits: 0 })}</td>
            <td style="text-align:right;"><span class="pill ${roasClass}">${c.roas.toFixed(2)}x</span></td>
          </tr>
        `}).join('')}
      </tbody>
    </table>
  `;

  // Recommended actions
  const recs = s.duplicate_diagnosis?.recommended_actions || [];
  if (recs.length > 0) {
    actionsCard.style.display = 'block';
    actions.innerHTML = `
      <ol style="margin:0 0 0 18px;font-size:13px;line-height:1.6;">
        ${recs.map((a) => `<li style="margin-bottom:6px;">${escapeHTML(a)}</li>`).join('')}
      </ol>
    `;
  }
}

// ---------- IMAGES ----------
const imagesState = {
  page: 1,
  perPage: 24,
  q: '',
  total: 0,
  selectedProductId: null,
};

async function renderImages() {
  const search = document.getElementById('images-search');
  const btn = document.getElementById('images-search-btn');

  function trigger() {
    imagesState.q = search.value.trim();
    imagesState.page = 1;
    fetchAndRenderProductList();
  }
  btn.addEventListener('click', trigger);
  search.addEventListener('keydown', (e) => { if (e.key === 'Enter') trigger(); });

  document.getElementById('detail-close').addEventListener('click', () => {
    document.getElementById('images-detail').style.display = 'none';
    imagesState.selectedProductId = null;
  });

  fetchAndRenderProductList();
}

async function fetchAndRenderProductList() {
  const grid = document.getElementById('images-grid');
  const countEl = document.getElementById('images-count');
  const pagEl = document.getElementById('images-pagination');

  grid.innerHTML = '<div class="loading">Ładuję produkty z feedu (~1-3s pierwszy raz, potem cache 5 min)…</div>';

  const params = new URLSearchParams({
    page: imagesState.page,
    perPage: imagesState.perPage,
  });
  if (imagesState.q) params.set('q', imagesState.q);

  let data;
  try {
    data = await fetchJSON('/api/products?' + params);
  } catch (e) {
    countEl.textContent = 'Błąd ładowania';
    grid.innerHTML = `<div class="alert error show">Nie udało się pobrać produktów: ${escapeHTML(e.message)}</div>`;
    pagEl.innerHTML = '';
    return;
  }

  imagesState.total = data.pagination.total;
  countEl.textContent = `${data.pagination.total.toLocaleString('pl-PL')} produktów${
    imagesState.q ? ` (filtr: "${imagesState.q}")` : ''
  } · strona ${data.pagination.page}/${data.pagination.totalPages}`;

  if (data.products.length === 0) {
    grid.innerHTML = '<div class="placeholder"><div class="placeholder-title">Brak wyników</div></div>';
    pagEl.innerHTML = '';
    return;
  }

  grid.innerHTML = `
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(220px,1fr));gap:12px;">
      ${data.products
        .map(
          (p) => `
        <div class="product-tile" data-id="${escapeHTML(p.id)}" style="background:var(--bg);border:1px solid var(--border);border-radius:10px;overflow:hidden;cursor:pointer;transition:border-color 0.12s;">
          <div style="aspect-ratio:1;background:#000;display:flex;align-items:center;justify-content:center;overflow:hidden;">
            <img loading="lazy" src="${escapeHTML(p.image_link)}" alt="" style="width:100%;height:100%;object-fit:cover;" onerror="this.style.display='none';this.parentElement.innerHTML='<span style=color:var(--muted);font-size:11px;>brak zdjęcia</span>'" />
          </div>
          <div style="padding:10px;">
            <div style="font-size:12px;font-weight:600;line-height:1.3;max-height:32px;overflow:hidden;text-overflow:ellipsis;display:-webkit-box;-webkit-line-clamp:2;-webkit-box-orient:vertical;">${escapeHTML(p.title)}</div>
            <div class="mono" style="font-size:11px;color:var(--muted);margin-top:4px;">id ${escapeHTML(p.id)}</div>
            <div style="margin-top:4px;">
              <span class="pill pill-info">${p.total_images} ${p.total_images === 1 ? 'image' : 'images'}</span>
              ${p.availability && p.availability.toLowerCase() !== 'in stock' ? '<span class="pill pill-muted">out of stock</span>' : ''}
            </div>
          </div>
        </div>
      `
        )
        .join('')}
    </div>
  `;
  // Hover style + click handlers
  grid.querySelectorAll('.product-tile').forEach((tile) => {
    tile.addEventListener('mouseenter', () => (tile.style.borderColor = 'var(--border-strong)'));
    tile.addEventListener('mouseleave', () => (tile.style.borderColor = 'var(--border)'));
    tile.addEventListener('click', () => openProductDetail(tile.dataset.id));
  });

  // Pagination
  const tp = data.pagination.totalPages;
  const p = data.pagination.page;
  pagEl.innerHTML = `
    <div class="text-muted" style="font-size:12px;">
      Łącznie ${data.pagination.total.toLocaleString('pl-PL')} produktów · pokazuję ${data.products.length}
    </div>
    <div class="flex-gap-1">
      <button class="btn" id="pag-prev" ${p <= 1 ? 'disabled' : ''} style="padding:6px 12px;background:var(--card-hover);color:var(--text);">← Prev</button>
      <span class="mono text-dim" style="padding:6px 8px;font-size:12px;">${p} / ${tp}</span>
      <button class="btn" id="pag-next" ${p >= tp ? 'disabled' : ''} style="padding:6px 12px;background:var(--card-hover);color:var(--text);">Next →</button>
    </div>
  `;
  document.getElementById('pag-prev').addEventListener('click', () => {
    if (imagesState.page > 1) { imagesState.page--; fetchAndRenderProductList(); }
  });
  document.getElementById('pag-next').addEventListener('click', () => {
    if (imagesState.page < tp) { imagesState.page++; fetchAndRenderProductList(); }
  });
}

async function openProductDetail(productId) {
  imagesState.selectedProductId = productId;
  const detail = document.getElementById('images-detail');
  detail.style.display = 'block';
  document.getElementById('detail-title').textContent = 'Ładuję…';
  document.getElementById('detail-meta').textContent = 'id ' + productId;
  document.getElementById('detail-gallery').innerHTML = '<div class="loading">Ładuję galerię…</div>';
  document.getElementById('detail-preview').innerHTML = '';

  // Scroll into view
  detail.scrollIntoView({ behavior: 'smooth', block: 'start' });

  let data;
  try {
    data = await fetchJSON('/api/products?id=' + encodeURIComponent(productId));
  } catch (e) {
    document.getElementById('detail-gallery').innerHTML =
      `<div class="alert error show">Błąd: ${escapeHTML(e.message)}</div>`;
    return;
  }

  const p = data.products[0];
  if (!p) {
    document.getElementById('detail-gallery').innerHTML =
      '<div class="alert error show">Produkt nie znaleziony</div>';
    return;
  }

  document.getElementById('detail-title').textContent = p.title;
  document.getElementById('detail-meta').innerHTML =
    `id <strong>${escapeHTML(p.id)}</strong> · ${escapeHTML(p.product_type || '—')} · ${escapeHTML(p.availability || '—')} · ${escapeHTML(p.price || '')}`;

  const allImages = [p.image_link, ...p.additional_image_link].filter(Boolean);
  const gallery = document.getElementById('detail-gallery');

  gallery.innerHTML = `
    <div class="mb-2 text-dim">${allImages.length} obrazków w feedzie — kliknij dowolny aby zobaczyć "co by się stało jako głównego image".</div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(180px,1fr));gap:10px;">
      ${allImages
        .map(
          (url, idx) => `
        <div class="gal-tile" data-url="${escapeHTML(url)}" data-idx="${idx}" style="position:relative;cursor:pointer;border:2px solid ${idx === 0 ? 'var(--primary)' : 'var(--border)'};border-radius:8px;overflow:hidden;background:#000;aspect-ratio:1;">
          <img loading="lazy" src="${escapeHTML(url)}" alt="" style="width:100%;height:100%;object-fit:cover;" />
          ${idx === 0 ? '<span class="pill pill-info" style="position:absolute;top:6px;left:6px;">MAIN</span>' : `<span class="pill pill-muted" style="position:absolute;top:6px;left:6px;">#${idx + 1}</span>`}
        </div>
      `
        )
        .join('')}
    </div>
  `;

  gallery.querySelectorAll('.gal-tile').forEach((tile) => {
    tile.addEventListener('click', () => previewImageSwap(p, parseInt(tile.dataset.idx, 10)));
  });
}

function previewImageSwap(product, newMainIdx) {
  const allImages = [product.image_link, ...product.additional_image_link].filter(Boolean);
  const newMain = allImages[newMainIdx];
  const previewEl = document.getElementById('detail-preview');

  if (newMainIdx === 0) {
    previewEl.innerHTML = `
      <div class="alert warning show">
        To już jest aktualne główne zdjęcie. Wybierz inne aby zobaczyć preview swap-as-main.
      </div>
    `;
    return;
  }

  previewEl.innerHTML = `
    <div class="card" style="background:var(--bg);">
      <div class="card-header">
        <div class="card-title">Preview: swap-as-main</div>
        <span class="pill pill-warning">no write yet — preview only</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 40px 1fr;gap:20px;align-items:center;">
        <div>
          <div class="text-muted mb-1" style="font-size:11px;">PRZED (obecne MAIN)</div>
          <div style="aspect-ratio:1;background:#000;border-radius:8px;overflow:hidden;">
            <img src="${escapeHTML(product.image_link)}" alt="" style="width:100%;height:100%;object-fit:contain;" />
          </div>
        </div>
        <div style="text-align:center;font-size:32px;color:var(--primary);">→</div>
        <div>
          <div class="text-muted mb-1" style="font-size:11px;">PO (proponowane MAIN, #${newMainIdx + 1})</div>
          <div style="aspect-ratio:1;background:#000;border-radius:8px;overflow:hidden;border:2px solid var(--primary);">
            <img src="${escapeHTML(newMain)}" alt="" style="width:100%;height:100%;object-fit:contain;" />
          </div>
        </div>
      </div>
      <div class="mb-2" style="margin-top:16px;padding:12px;background:var(--card-hover);border-radius:8px;font-size:12px;">
        <div class="mb-1"><strong>Wygenerowałoby się to imageRule:</strong></div>
        <pre class="mono" style="font-size:11px;color:var(--text-dim);white-space:pre-wrap;">${escapeHTML(JSON.stringify({
          id: `img-${product.id}-${newMainIdx}`,
          offerId: product.id,
          promote_to_main_index: newMainIdx,
          dupSuffix: 'img_' + 'abc'[Math.min(newMainIdx - 1, 2)],
          customLabel1: 'img_' + 'abc'[Math.min(newMainIdx - 1, 2)],
          active: true,
        }, null, 2))}</pre>
      </div>
      <button class="btn btn-block" disabled title="Write actions deferred do następnej sesji — bezpieczeństwo ponad wszystko">
        Apply (disabled — coming next session with pre-flight diff)
      </button>
    </div>
  `;
}

function renderAddVariant() {
  const form = document.getElementById('variant-form');
  const btn = document.getElementById('submit-btn');
  const alertEl = document.getElementById('alert');
  if (!form || form.dataset.bound === '1') return;
  form.dataset.bound = '1';

  function showAlert(msg, type) {
    alertEl.innerHTML = msg;
    alertEl.className = 'alert show ' + type;
  }

  // Live Title Case preview for replaceWith
  const replaceInput = document.getElementById('replaceWith');
  const replacePreview = document.getElementById('replace-preview');
  function updatePreview() {
    const raw = replaceInput.value.trim();
    if (!raw) {
      replacePreview.textContent = '—';
      replacePreview.style.color = 'var(--muted)';
      return;
    }
    const normalized = wordCapitalize(raw);
    replacePreview.textContent = normalized;
    replacePreview.style.color = raw === normalized ? 'var(--success)' : 'var(--warning)';
  }
  replaceInput.addEventListener('input', updatePreview);
  updatePreview();

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    btn.disabled = true;
    btn.textContent = 'Dodaję…';
    alertEl.className = 'alert';

    const data = {
      matchInTitle: form.matchInTitle.value.trim(),
      searchInTitle: form.searchInTitle.value.trim(),
      replaceWith: form.replaceWith.value.trim(),
      dupSuffix: form.dupSuffix.value.trim(),
      notes: form.notes.value.trim(),
    };

    try {
      const r = await fetch('/api/add-variant', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      const j = await r.json();
      if (r.ok) {
        showAlert(`✓ Issue #${j.issueNumber} utworzony. Feed regeneruje się w ciągu 1h. <a href="${escapeHTML(j.url || '#')}" target="_blank" rel="noopener" class="mono">view →</a>`, 'success');
        form.reset();
      } else {
        showAlert('Błąd: ' + escapeHTML(j.error || 'nieznany'), 'error');
      }
    } catch (err) {
      showAlert('Błąd sieci: ' + escapeHTML(err.message), 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Dodaj wariant';
    }
  });
}

// ---------- Init ----------
let _coreLoaded = null;
function ensureCoreLoaded() {
  if (!_coreLoaded) _coreLoaded = loadCoreData();
  return _coreLoaded;
}

window.addEventListener('hashchange', onHashChange);
document.addEventListener('DOMContentLoaded', () => {
  // Start core data fetch in background ASAP
  ensureCoreLoaded();
  onHashChange();
});
