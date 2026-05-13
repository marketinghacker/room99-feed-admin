// Room99 Feed Command Center — Sprint 1 (read-only)
// Vanilla JS SPA: hash router, fetch helpers, section renderers.
// Zero deps. No write actions yet — Sprint 2 adds CRUD on rules.

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
  images: () => {},
  performance: () => {},
  'feed-health': renderFeedHealth,
  history: renderHistoryLink,
  'add-variant': renderAddVariant,
};

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

  // Decisions feed (Sprint 1: static signposts, Sprint 2 will populate from hypothesis engine)
  const decisionsEl = document.getElementById('decisions-feed');
  decisionsEl.innerHTML = `
    <div class="decision-card">
      <div class="decision-icon info">●</div>
      <div class="decision-body">
        <div class="decision-title">${activeRules.length} aktywnych reguł generuje duplikaty</div>
        <div class="decision-meta">Sprint 2 zaproponuje kolejne hipotezy z GSC + Google Ads</div>
      </div>
    </div>
    ${lastCron && lastCron.conclusion !== 'success' ? `
      <div class="decision-card">
        <div class="decision-icon warning">!</div>
        <div class="decision-body">
          <div class="decision-title">Ostatni cron tick nie zakończył się sukcesem</div>
          <div class="decision-meta">Status: ${escapeHTML(lastCron.conclusion || lastCron.status)} · <a href="${escapeHTML(lastCron.html_url)}" target="_blank" rel="noopener">view run →</a></div>
        </div>
      </div>
    ` : ''}
    <div class="decision-card">
      <div class="decision-icon info">▸</div>
      <div class="decision-body">
        <div class="decision-title">Dodaj nowy wariant tytułu</div>
        <div class="decision-meta">Legacy flow — <a href="#add-variant">otwórz formularz →</a></div>
      </div>
    </div>
  `;

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

async function renderRules() {
  await ensureCoreLoaded();

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
    `${rules.length} reguł · ${active} aktywnych · ${rules.length - active} nieaktywnych`;

  if (rules.length === 0) {
    document.getElementById('rules-table-wrap').innerHTML =
      '<div class="placeholder"><div class="placeholder-title">Brak reguł</div></div>';
    return;
  }

  const rows = rules
    .map(
      (r) => `
    <tr>
      <td class="mono"><strong>${escapeHTML(r.dupSuffix || '—')}</strong></td>
      <td><span class="pill pill-muted">${escapeHTML(r.matchInTitle || '—')}</span></td>
      <td>
        <div class="text-dim mono" style="font-size:11px;">${escapeHTML(r.searchInTitle || '')}</div>
        <div style="font-weight:500;">${escapeHTML(r.replaceWith || '')}</div>
      </td>
      <td>${r.active ? '<span class="pill pill-success">active</span>' : '<span class="pill pill-muted">inactive</span>'}</td>
      <td class="text-muted" style="font-size:12px;">${escapeHTML(r.notes || '')}</td>
      <td>
        <button class="pill pill-muted" disabled title="Sprint 2 — Coming next" style="border:none;cursor:not-allowed;">Edit</button>
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
          <th>Status</th>
          <th>Notes</th>
          <th>Actions</th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;
}

async function renderFeedHealth() {
  await ensureCoreLoaded();

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
