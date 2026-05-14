// Room99 Feed Command Center — IA Redesign (4 sections)
// Dziś · Testy · Pomysły · Sklep (perf/health/history subtabs)

const REPO_URL = 'https://github.com/marketinghacker/room99-feed-duplicator';
const CONFIG_URL = REPO_URL + '/blob/main/config.json';
const COMMITS_URL = REPO_URL + '/commits/main/config.json';

// ---------- Router ----------
const SECTIONS = ['today', 'tests', 'ideas', 'shop'];
const SHOP_SUBTABS = ['perf', 'health', 'history'];
const RENDERED = new Set();

// Legacy hash aliases — old links keep working
const HASH_ALIASES = {
  rules: 'tests',
  images: 'tests',
  hypotheses: 'ideas',
  'add-variant': 'tests', // opens add panel separately
  performance: 'shop/perf',
  'feed-health': 'shop/health',
  history: 'shop/history',
};

function parseHash() {
  const raw = (location.hash || '#today').replace(/^#/, '');
  // Apply alias if any
  if (HASH_ALIASES[raw]) {
    return parseHash._fromString(HASH_ALIASES[raw]);
  }
  return parseHash._fromString(raw);
}
parseHash._fromString = function (s) {
  const [tab, sub] = s.split('/');
  return {
    tab: SECTIONS.includes(tab) ? tab : 'today',
    sub: sub || null,
  };
};

function activateTab({ tab, sub }) {
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

  // Shop subtabs
  if (tab === 'shop') {
    const activeSub = SHOP_SUBTABS.includes(sub) ? sub : 'perf';
    document.querySelectorAll('.subtab').forEach((el) => el.classList.toggle('active', el.dataset.subtab === activeSub));
    document.querySelectorAll('.subsection').forEach((el) => (el.style.display = 'none'));
    const subEl = document.getElementById('shop-' + activeSub);
    if (subEl) subEl.style.display = 'block';

    // Lazy render subsection
    if (!RENDERED.has('shop-' + activeSub)) {
      const subRenderer = SHOP_RENDERERS[activeSub];
      if (subRenderer) subRenderer();
      RENDERED.add('shop-' + activeSub);
    }
  }
}

function onHashChange() {
  activateTab(parseHash());
}

// ---------- Fetch helpers ----------
async function fetchJSON(url, options) {
  const r = await fetch(url, options);
  if (!r.ok) {
    let detail = '';
    try {
      const j = await r.json();
      detail = j.error || JSON.stringify(j).substring(0, 120);
    } catch {
      // non-JSON body — drop it
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

// Word Capitalize — mirror of generate-feed.js
function wordCapitalize(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/(?<![\p{L}\d])(\p{L})(\p{L}*)/gu, (m, first, rest) => first.toUpperCase() + rest);
}

// ---------- State ----------
const state = {
  config: null,
  configSha: null,
  feedStats: null,
  configError: null,
  statsError: null,
  perfSnapshot: null,
  perfSnapshotError: null,
  matchCounts: {}, // ruleId -> count, cached
  testsFilter: 'all', // all | title | description | both | image
  expandedTestId: null,
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

async function ensurePerformanceSnapshotLoaded() {
  if (state.perfSnapshot || state.perfSnapshotError) return;
  try {
    state.perfSnapshot = await fetchJSON('/api/performance-snapshot');
  } catch (e) {
    state.perfSnapshotError = e.message;
  }
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

let _coreLoaded = null;
function ensureCoreLoaded() {
  if (!_coreLoaded) _coreLoaded = loadCoreData();
  return _coreLoaded;
}

// ---------- Renderers map ----------
const RENDERERS = {
  today: renderToday,
  tests: renderTests,
  ideas: renderIdeas,
  shop: renderShop,
};
const SHOP_RENDERERS = {
  perf: renderPerformance,
  health: renderFeedHealth,
  history: renderHistory,
};

// ====================================================================
// DZIŚ
// ====================================================================
async function renderToday() {
  await ensureCoreLoaded();

  const kpiEl = document.getElementById('kpi-strip');
  const rules = state.config?.duplicateRules || [];
  const images = state.config?.imageRules || [];
  const allTests = [...rules, ...images];
  const activeTests = allTests.filter((r) => r.active !== false);
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
      <div class="kpi-label">Twoje testy</div>
      <div class="kpi-value">${activeTests.length}<span class="text-muted" style="font-size:14px;font-weight:500;"> z ${allTests.length}</span></div>
      <div class="kpi-sub">${allTests.length - activeTests.length === 0 ? 'wszystkie aktywne' : (allTests.length - activeTests.length) + ' na pauzie'}</div>
    </div>
    <div class="kpi-tile">
      <div class="kpi-label">Wariantów w sklepie</div>
      <div class="kpi-value">${outputRows.toLocaleString ? outputRows.toLocaleString('pl-PL') : outputRows}</div>
      <div class="kpi-sub">kopii produktów z testowymi tytułami/opisami</div>
    </div>
    <div class="kpi-tile">
      <div class="kpi-label">Ostatnie odświeżenie</div>
      <div class="kpi-value" style="font-size:22px;">${lastCron ? fmtRelative(lastCron.completed_at) : '—'}</div>
      <div class="kpi-sub">${cronPill}</div>
    </div>
    <div class="kpi-tile">
      <div class="kpi-label">Ostatnia zmiana</div>
      <div class="kpi-value" style="font-size:22px;">${lastChange ? fmtRelative(lastChange.timestamp) : '—'}</div>
      <div class="kpi-sub">${lastChange ? escapeHTML(lastChange.author) : '—'}</div>
    </div>
  `;

  await ensurePerformanceSnapshotLoaded();
  const decisionsEl = document.getElementById('decisions-feed');
  const decisions = buildDecisions(rules, activeTests, lastCron, state.perfSnapshot);
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

  const activityEl = document.getElementById('feed-activity');
  activityEl.innerHTML = `
    <div class="mb-2">
      <div class="kpi-label">Sklep odświeżony</div>
      <div class="mb-1">
        ${lastCron ? `
          <div class="flex-between mb-1">
            <span>${cronPill}</span>
            <span class="text-muted mono" style="font-size:11px;">#${lastCron.run_number}</span>
          </div>
          <div class="text-dim" style="font-size:13px;">${fmtDate(lastCron.completed_at)}</div>
          <div class="text-muted" style="font-size:12px;font-style:italic;">${lastCron.trigger === 'schedule' ? 'automatycznie' : (lastCron.trigger === 'push' ? 'po Twojej zmianie' : 'ręcznie')}</div>
          <a href="${escapeHTML(lastCron.html_url)}" target="_blank" rel="noopener" style="font-size:12px;">otwórz szczegóły →</a>
        ` : '<div class="text-muted">brak danych</div>'}
      </div>
    </div>
    <div class="mb-2" style="border-top:1px solid var(--border);padding-top:16px;margin-top:16px;">
      <div class="kpi-label">Twoja ostatnia zmiana</div>
      ${lastChange ? `
        <div class="text-dim mb-1" style="font-size:13.5px;line-height:1.5;">${escapeHTML(lastChange.message)}</div>
        <div class="text-muted" style="font-size:12px;">
          ${escapeHTML(lastChange.author)} · ${fmtDate(lastChange.timestamp)}
        </div>
        <a href="${escapeHTML(lastChange.html_url)}" target="_blank" rel="noopener" style="font-size:12px;">zobacz szczegóły →</a>
      ` : '<div class="text-muted">brak zmian</div>'}
    </div>
  `;
}

function buildDecisions(rules, activeTests, lastCron, snapshot) {
  const out = [];

  if (snapshot?.duplicate_diagnosis?.status === 'critical') {
    out.push({
      severity: 'warning',
      icon: '!',
      title: 'Twój test tytułów nie zbiera danych — warto to naprawić',
      meta: `${escapeHTML(snapshot.duplicate_diagnosis.likely_root_causes?.[0]?.title || 'Nieznana przyczyna')} · <a href="#ideas">zobacz całą diagnozę →</a>`,
    });
  }

  if (snapshot?.underperforming_campaigns?.length) {
    const c = snapshot.underperforming_campaigns[0];
    const lostPln = (c.cost_pln - (c.cost_pln * c.roas)).toFixed(0);
    out.push({
      severity: 'warning',
      icon: '↓',
      title: `Kampania „${escapeHTML(c.name)}" traci pieniądze`,
      meta: `Każda zł wydana zwraca tylko ${c.roas} zł — strata około ${Math.abs(lostPln)} zł na miesiąc. <a href="#shop/perf">zobacz szczegóły →</a>`,
    });
  }

  if (snapshot?.winner_campaigns?.length) {
    const w = snapshot.winner_campaigns[0];
    out.push({
      severity: 'success',
      icon: '★',
      title: `Najlepsza kampania: „${escapeHTML(w.name)}"`,
      meta: `Każda 1 zł zwraca ${w.roas} zł. Spróbuj zastosować jej ustawienia w innych kampaniach. <a href="#shop/perf">zobacz →</a>`,
    });
  }

  if (lastCron && lastCron.conclusion !== 'success') {
    out.push({
      severity: 'error',
      icon: '⚠',
      title: 'Sklep nie odświeżył się ostatnim razem',
      meta: `Coś poszło nie tak. <a href="${escapeHTML(lastCron.html_url)}" target="_blank" rel="noopener">zobacz, co się stało →</a>`,
    });
  }

  out.push({
    severity: 'info',
    icon: '●',
    title: `${activeTests.length === 1 ? '1 test biegnie' : activeTests.length + ' testów biegnie'} w Twoim sklepie`,
    meta: `Każdy generuje warianty produktów w Google Shopping. <a href="#tests">otwórz listę →</a>`,
  });

  out.push({
    severity: 'muted',
    icon: '+',
    title: 'Masz pomysł na nowy tytuł albo opis?',
    meta: '<a href="#tests" onclick="event.preventDefault();location.hash=\'#tests\';setTimeout(openAddPanel,150)">otwórz panel dodawania →</a> — nowy wariant wjedzie do sklepu w ciągu godziny',
  });

  return out;
}

// ====================================================================
// TESTY — unified table (title + description + image)
// ====================================================================

function unifyTests(config) {
  const ruleTests = (config?.duplicateRules || []).map((r) => ({
    kind: 'rule',
    id: r.id,
    testType: r.testType || 'title',
    dupSuffix: r.dupSuffix,
    matchInTitle: r.matchInTitle,
    searchInTitle: r.searchInTitle,
    replaceWith: r.replaceWith,
    descriptionOverride: r.descriptionOverride,
    customLabel1: r.customLabel1,
    active: r.active,
    notes: r.notes,
    raw: r,
  }));
  const imgTests = (config?.imageRules || []).map((r) => ({
    kind: 'image',
    id: r.id,
    testType: 'image',
    dupSuffix: r.dupSuffix,
    offerId: r.offerId,
    promote_to_main_index: r.promote_to_main_index,
    custom_image_url: r.custom_image_url,
    customLabel1: r.customLabel1,
    active: r.active !== false,
    notes: r.notes,
    raw: r,
  }));
  return [...ruleTests, ...imgTests];
}

function typeBadgeHTML(testType) {
  const map = {
    title: { cls: 'type-title', label: 'T', title: 'Test tytułu' },
    description: { cls: 'type-description', label: 'D', title: 'Test opisu' },
    both: { cls: 'type-both', label: 'T+D', title: 'Test tytułu i opisu' },
    image: { cls: 'type-image', label: 'I', title: 'Test zdjęcia' },
  };
  const m = map[testType] || map.title;
  return `<span class="type-badge ${m.cls}" title="${m.title}">${m.label}</span>`;
}

function winnerPillHTML(test, snapshot) {
  // Look up perf data from snapshot.rules_campaign_mapping by dupSuffix
  const mapping = (snapshot?.rules_campaign_mapping || []).find((m) => m.dupSuffix === test.dupSuffix);
  if (!mapping) return '<span class="winner-pill winner-pending">— czeka na dane</span>';

  // If mapping shows test isn't collecting data (e.g. needs_ad_group_creation)
  if (mapping.match_status === 'needs_ad_group_creation') {
    return '<span class="winner-pill winner-pending">brak ad-group</span>';
  }
  if (mapping.match_status === 'ready_after_fix') {
    return '<span class="winner-pill winner-pending">czeka na fix</span>';
  }

  // Compare ratio if available — assume mapping has variant_roas vs baseline_roas
  const variant = mapping.variant_roas || mapping.roas;
  const baseline = mapping.baseline_roas || snapshot?.summary_30d?.blended_roas || null;
  if (!variant || !baseline) return '<span class="winner-pill winner-pending">— czeka</span>';

  const ratio = variant / baseline;
  let cls = 'winner-amber';
  let symbol = '~';
  if (ratio >= 1.15) { cls = 'winner-green'; symbol = '↑'; }
  else if (ratio <= 0.85) { cls = 'winner-red'; symbol = '↓'; }
  return `<span class="winner-pill ${cls}"><span class="arrow">${symbol}</span> ${ratio.toFixed(2)}× baseline</span>`;
}

function scopeLabelHTML(test) {
  if (test.kind === 'image') {
    return `<span class="pill pill-muted">offer ${escapeHTML(test.offerId || '—')}</span>`;
  }
  return `<span class="pill pill-muted">${escapeHTML(test.matchInTitle || '—')}</span>`;
}

function transformationCellHTML(test) {
  if (test.kind === 'image') {
    if (test.custom_image_url) return '<div style="font-weight:500;">Custom URL</div><div class="text-dim mono" style="font-size:11px;">' + escapeHTML(test.custom_image_url.slice(0, 50)) + '…</div>';
    return `<div style="font-weight:500;">Zdjęcie #${test.promote_to_main_index} → MAIN</div><div class="text-dim mono" style="font-size:11px;">promote_to_main_index</div>`;
  }
  // title/description/both
  const arrow = test.testType === 'description' ? 'w opisie:' : (test.testType === 'both' ? 'w tytule i opisie:' : '');
  return `
    <div class="text-dim mono" style="font-size:11px;">${arrow ? `<em style="font-style:italic;color:var(--muted);">${arrow}</em> ` : ''}${escapeHTML(test.searchInTitle || '')}</div>
    <div style="font-weight:500;">${escapeHTML(test.replaceWith || '')}</div>
    ${test.descriptionOverride ? '<div class="text-muted" style="font-size:11px;font-style:italic;margin-top:3px;">+ pełny override opisu (' + test.descriptionOverride.length + ' znaków)</div>' : ''}
  `;
}

async function renderTests() {
  await ensureCoreLoaded();
  await reloadConfig();
  await ensurePerformanceSnapshotLoaded();

  // Source link
  const linkEl = document.getElementById('tests-source-link');
  if (linkEl) linkEl.href = CONFIG_URL;

  // Filter chips
  document.querySelectorAll('.filter-chip').forEach((chip) => {
    if (chip.dataset.bound === '1') return;
    chip.dataset.bound = '1';
    chip.addEventListener('click', () => {
      state.testsFilter = chip.dataset.filter;
      document.querySelectorAll('.filter-chip').forEach((c) => c.classList.toggle('active', c === chip));
      renderTestsTable();
    });
  });

  // + Nowy test button
  const addBtn = document.getElementById('add-test-btn');
  if (addBtn && addBtn.dataset.bound !== '1') {
    addBtn.dataset.bound = '1';
    addBtn.addEventListener('click', openAddPanel);
  }

  if (state.configError) {
    document.getElementById('tests-count').textContent = 'Błąd ładowania';
    document.getElementById('tests-table-wrap').innerHTML =
      `<div class="alert error show">Nie udało się pobrać testów: ${escapeHTML(state.configError)}</div>`;
    return;
  }

  renderTestsTable();
}

function renderTestsTable() {
  const tests = unifyTests(state.config);
  const filtered = state.testsFilter === 'all' ? tests : tests.filter((t) => t.testType === state.testsFilter);
  const active = filtered.filter((t) => t.active).length;

  document.getElementById('tests-count').textContent =
    state.testsFilter === 'all'
      ? `${tests.length} testów łącznie · ${tests.filter((t) => t.active).length} aktywnych · klik wiersz aby rozwinąć`
      : `${filtered.length} ${filtered.length === 1 ? 'test' : 'testów'} typu „${state.testsFilter}" · ${active} aktywnych`;

  const tableWrap = document.getElementById('tests-table-wrap');

  if (filtered.length === 0) {
    tableWrap.innerHTML = `
      <div class="placeholder">
        <div class="placeholder-title">Brak testów ${state.testsFilter !== 'all' ? `typu „${state.testsFilter}"` : ''}</div>
        <div class="placeholder-text">Dodaj pierwszy klikając „+ Nowy test" powyżej.</div>
      </div>
    `;
    return;
  }

  const snapshot = state.perfSnapshot;

  const rows = filtered
    .map((t) => {
      const isExpanded = state.expandedTestId === t.id;
      const ariaPressed = t.active ? 'true' : 'false';
      return `
    <tr class="test-row${isExpanded ? ' expanded' : ''}" data-test-id="${escapeHTML(t.id)}" data-test-kind="${t.kind}">
      <td class="mono"><strong>${escapeHTML(t.dupSuffix || '—')}</strong></td>
      <td>${typeBadgeHTML(t.testType)}</td>
      <td>${scopeLabelHTML(t)}</td>
      <td>${transformationCellHTML(t)}</td>
      <td>
        <label class="row-toggle" title="${t.active ? 'Aktywny — kliknij żeby spauzować' : 'Spauzowany — kliknij żeby wznowić'}">
          <input type="checkbox" ${t.active ? 'checked' : ''} aria-pressed="${ariaPressed}" data-toggle-test="${escapeHTML(t.id)}" data-test-kind="${t.kind}" />
          <span class="row-toggle-slider"></span>
        </label>
      </td>
      <td>${winnerPillHTML(t, snapshot)}</td>
      <td style="text-align:right;white-space:nowrap;">
        <button class="eye-btn" data-eye-test="${escapeHTML(t.id)}" title="Podgląd: przed/po (tytuł + opis)">👁</button>
        ${t.kind === 'rule' ? renderPromoteDropdownHTML(t) : ''}
      </td>
    </tr>
    ${isExpanded ? renderExpandedRowHTML(t, snapshot) : ''}
  `;
    })
    .join('');

  tableWrap.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Kod</th>
          <th>Typ</th>
          <th>Grupa</th>
          <th>Co podmienia</th>
          <th style="width:60px;">Stan</th>
          <th>Wynik</th>
          <th></th>
        </tr>
      </thead>
      <tbody>${rows}</tbody>
    </table>
  `;

  wireTestRowHandlers();
  fetchMatchCounts();
}

function renderPromoteDropdownHTML(test) {
  return `
    <div class="promote-dropdown" data-promote-id="${escapeHTML(test.id)}">
      <button class="promote-trigger" data-promote-trigger="${escapeHTML(test.id)}" title="Co zrobić z tym testem">
        <span>Akcje</span><span class="caret">▾</span>
      </button>
      <div class="promote-menu">
        <button class="promote-option" data-promote-action="edit" data-test-id="${escapeHTML(test.id)}">
          Edytuj test
          <span class="opt-desc">Otwórz pełny edytor</span>
        </button>
        <button class="promote-option" data-promote-action="promote" data-test-id="${escapeHTML(test.id)}">
          Promuj do main feed
          <span class="opt-desc">Wynik testu wchodzi do głównego feedu</span>
        </button>
        <button class="promote-option" data-promote-action="archive" data-test-id="${escapeHTML(test.id)}">
          Archiwizuj
          <span class="opt-desc">Skasuj test (bez powrotu)</span>
        </button>
      </div>
    </div>
  `;
}

function renderExpandedRowHTML(test, snapshot) {
  const mapping = (snapshot?.rules_campaign_mapping || []).find((m) => m.dupSuffix === test.dupSuffix);
  return `
    <tr class="test-row-detail">
      <td colspan="7">
        <div class="test-row-detail-inner">
          <div class="test-detail-block">
            <h4>Zakres testu</h4>
            <div style="margin-bottom:14px;">
              ${test.kind === 'image' ? `
                <div>offerId: <strong>${escapeHTML(test.offerId || '—')}</strong></div>
                <div>${test.custom_image_url ? 'Custom URL: <span class="mono" style="font-size:11px;">' + escapeHTML(test.custom_image_url) + '</span>' : `Promuje zdjęcie #${test.promote_to_main_index} do MAIN`}</div>
              ` : `
                <div>Grupa: ${escapeHTML(test.matchInTitle || '—')} (<span data-mc-rule="${escapeHTML(test.id)}" class="match-count-badge mono">…</span> produktów)</div>
                <div>Podmiana: <span class="mono" style="font-size:11.5px;">"${escapeHTML(test.searchInTitle || '')}"</span> → <strong>"${escapeHTML(test.replaceWith || '')}"</strong></div>
                <div>Typ: ${typeBadgeHTML(test.testType)} ${test.testType === 'title' ? '(tylko tytuł)' : test.testType === 'description' ? '(tylko opis — tytuł bez zmian)' : '(tytuł + opis razem)'}</div>
                ${test.descriptionOverride ? `<div style="margin-top:8px;padding:10px 12px;background:var(--bg);border-radius:6px;font-size:12px;"><div class="text-muted" style="font-size:10.5px;letter-spacing:0.06em;text-transform:uppercase;margin-bottom:4px;">Pełny override opisu (${test.descriptionOverride.length}/4950)</div>${escapeHTML(test.descriptionOverride.slice(0, 300))}${test.descriptionOverride.length > 300 ? '…' : ''}</div>` : ''}
              `}
            </div>
            ${test.notes ? `<div style="font-style:italic;color:var(--muted);font-size:12.5px;">„${escapeHTML(test.notes)}"</div>` : ''}
            <div class="test-detail-actions">
              <button class="btn btn-secondary" data-promote-action="edit" data-test-id="${escapeHTML(test.id)}" style="padding:7px 13px;font-size:12.5px;">Edytuj w panelu</button>
              <button class="eye-btn" data-eye-test="${escapeHTML(test.id)}" style="padding:7px 13px;font-size:12.5px;">👁 Podgląd przed/po</button>
            </div>
          </div>
          <div class="test-detail-block">
            <h4>Kampania docelowa</h4>
            ${mapping ? `
              <div style="font-size:13px;line-height:1.55;">
                <div>${escapeHTML(mapping.target_campaign_name || '—')}</div>
                ${mapping.target_ad_group ? `<div class="text-muted" style="font-size:12px;font-style:italic;">grupa: ${escapeHTML(mapping.target_ad_group)}</div>` : ''}
                ${mapping.match_status === 'ready_after_fix' ? '<div style="margin-top:8px;"><span class="pill pill-warning" style="font-size:10.5px;">czeka na fix custom_label_8</span></div>' : ''}
                ${mapping.match_status === 'needs_ad_group_creation' ? '<div style="margin-top:8px;"><span class="pill pill-error" style="font-size:10.5px;">brak ad-group</span></div>' : ''}
                ${mapping.note ? `<div class="text-muted" style="font-size:12px;margin-top:6px;">${escapeHTML(mapping.note)}</div>` : ''}
              </div>
            ` : '<div class="text-muted" style="font-size:12.5px;font-style:italic;">Brak danych mapowania kampanii — może snapshot się nie wczytał</div>'}
          </div>
        </div>
      </td>
    </tr>
  `;
}

function wireTestRowHandlers() {
  // Row click → expand/collapse
  document.querySelectorAll('.test-row').forEach((row) => {
    row.addEventListener('click', (e) => {
      // Don't trigger expand if click was on interactive element
      if (e.target.closest('.row-toggle, .eye-btn, .promote-dropdown, button, a, input')) return;
      const id = row.dataset.testId;
      state.expandedTestId = state.expandedTestId === id ? null : id;
      renderTestsTable();
    });
  });

  // Toggle switches
  document.querySelectorAll('[data-toggle-test]').forEach((input) => {
    input.addEventListener('click', (e) => e.stopPropagation());
    input.addEventListener('change', async (e) => {
      e.stopPropagation();
      const id = input.dataset.toggleTest;
      const kind = input.dataset.testKind;
      const desired = input.checked;
      input.disabled = true;
      try {
        const endpoint = kind === 'image' ? '/api/image-rules/' + encodeURIComponent(id) : '/api/rules/' + encodeURIComponent(id);
        const r = await fetch(endpoint, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ action: 'set_active', active: desired }),
        });
        const j = await r.json();
        if (r.ok || r.status === 202) {
          showSaveSuccess(`${id} ${desired ? 'wznowiony' : 'spauzowany'}`, j);
          await reloadConfig();
          renderTestsTable();
        } else if (r.status === 403 && j.fix) {
          input.checked = !desired;
          showToast(format403Help(j), 'error');
        } else {
          input.checked = !desired;
          showToast('Błąd: ' + escapeHTML(j.error || 'unknown'), 'error');
        }
      } catch (err) {
        input.checked = !desired;
        showToast('Błąd sieci: ' + escapeHTML(err.message), 'error');
      } finally {
        input.disabled = false;
      }
    });
  });

  // Eye preview
  document.querySelectorAll('[data-eye-test]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      openEyePreview(btn.dataset.eyeTest);
    });
  });

  // Promote dropdowns
  document.querySelectorAll('[data-promote-trigger]').forEach((btn) => {
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      const dropdown = btn.closest('.promote-dropdown');
      const wasOpen = dropdown.classList.contains('open');
      document.querySelectorAll('.promote-dropdown.open').forEach((d) => d.classList.remove('open'));
      if (!wasOpen) dropdown.classList.add('open');
    });
  });

  // Promote options
  document.querySelectorAll('[data-promote-action]').forEach((btn) => {
    btn.addEventListener('click', async (e) => {
      e.stopPropagation();
      const action = btn.dataset.promoteAction;
      const testId = btn.dataset.testId;
      document.querySelectorAll('.promote-dropdown.open').forEach((d) => d.classList.remove('open'));

      if (action === 'edit') {
        openSidePanelEditor(testId);
      } else if (action === 'archive') {
        if (!confirm(`Skasować test „${testId}"? Tego nie cofniesz inline — tylko git revert.`)) return;
        const tests = unifyTests(state.config);
        const test = tests.find((t) => t.id === testId);
        try {
          const endpoint = test?.kind === 'image' ? '/api/image-rules/' + encodeURIComponent(testId) : '/api/rules/' + encodeURIComponent(testId);
          const r = await fetch(endpoint, { method: 'DELETE' });
          const j = await r.json();
          if (r.ok || r.status === 202) {
            showSaveSuccess(`Test ${testId} usunięty`, j);
            await reloadConfig();
            renderTestsTable();
          } else if (r.status === 403 && j.fix) {
            showToast(format403Help(j), 'error');
          } else {
            showToast('Błąd: ' + escapeHTML(j.error || 'unknown'), 'error');
          }
        } catch (err) {
          showToast('Błąd sieci: ' + escapeHTML(err.message), 'error');
        }
      } else if (action === 'promote') {
        showToast('Promocja do main feed — wymaga ręcznego scalenia w głównym feedzie Room99 w Feed Optimise. Dopisz wariant do oryginalnego tytułu produktu, a potem skasuj ten test.', 'warning');
      }
    });
  });

  // Close dropdowns on outside click
  document.addEventListener('click', (e) => {
    if (!e.target.closest('.promote-dropdown')) {
      document.querySelectorAll('.promote-dropdown.open').forEach((d) => d.classList.remove('open'));
    }
  });
}

function fetchMatchCounts() {
  const tests = unifyTests(state.config).filter((t) => t.kind === 'rule');
  tests.forEach((t) => {
    if (state.matchCounts[t.id] !== undefined) {
      updateMatchCountUI(t.id, state.matchCounts[t.id]);
      return;
    }
    fetch('/api/rule-impact', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ matchInTitle: t.matchInTitle }),
    })
      .then((res) => res.json())
      .then((data) => {
        if (data.matched_count !== undefined) {
          state.matchCounts[t.id] = data.matched_count;
          updateMatchCountUI(t.id, data.matched_count);
        }
      })
      .catch(() => updateMatchCountUI(t.id, '—'));
  });
}

function updateMatchCountUI(testId, count) {
  const el = document.querySelector(`[data-mc-rule="${CSS.escape(testId)}"]`);
  if (el) {
    el.textContent = count;
    if (count === 0) el.style.color = 'var(--warning)';
  }
}

// ====================================================================
// EYE PREVIEW MODAL
// ====================================================================

async function openEyePreview(testId) {
  const tests = unifyTests(state.config);
  const test = tests.find((t) => t.id === testId);
  if (!test) return;

  // Build or find modal
  let backdrop = document.getElementById('preview-modal-backdrop');
  let modal = document.getElementById('preview-modal');
  if (!backdrop) {
    backdrop = document.createElement('div');
    backdrop.className = 'preview-modal-backdrop';
    backdrop.id = 'preview-modal-backdrop';
    document.body.appendChild(backdrop);
    backdrop.addEventListener('click', closeEyePreview);
  }
  if (!modal) {
    modal = document.createElement('div');
    modal.className = 'preview-modal';
    modal.id = 'preview-modal';
    document.body.appendChild(modal);
  }

  modal.innerHTML = `
    <div class="card-header" style="margin-bottom:8px;">
      <div>
        <div class="card-title">Podgląd: przed / po</div>
        <div class="card-sub">Test ${escapeHTML(test.dupSuffix || test.id)} — pokazuję pierwszy pasujący produkt</div>
      </div>
      <button class="btn btn-secondary" id="preview-close" style="padding:7px 14px;">Zamknij</button>
    </div>
    <div id="preview-body">
      <div class="loading">Ładuję przykładowy produkt z feedu…</div>
    </div>
  `;
  backdrop.classList.add('show');
  modal.classList.add('show');
  document.getElementById('preview-close').addEventListener('click', closeEyePreview);

  // Fetch a sample product matching the test's group
  try {
    let sampleProduct;
    if (test.kind === 'image') {
      const data = await fetchJSON('/api/products?id=' + encodeURIComponent(test.offerId));
      sampleProduct = data.products[0];
    } else {
      // Search by matchInTitle keyword
      const q = encodeURIComponent(test.matchInTitle || '');
      const data = await fetchJSON('/api/products?q=' + q + '&perPage=1');
      sampleProduct = data.products[0];
    }
    if (!sampleProduct) {
      document.getElementById('preview-body').innerHTML =
        '<div class="alert warning show">Nie znalazłem produktu pasującego do tego testu w feedzie.</div>';
      return;
    }
    renderEyePreviewContent(test, sampleProduct);
  } catch (e) {
    document.getElementById('preview-body').innerHTML =
      `<div class="alert error show">Błąd: ${escapeHTML(e.message)}</div>`;
  }
}

function closeEyePreview() {
  document.getElementById('preview-modal-backdrop')?.classList.remove('show');
  document.getElementById('preview-modal')?.classList.remove('show');
}

function renderEyePreviewContent(test, product) {
  const beforeTitle = product.title || '';
  const beforeDesc = product.description || '';

  let afterTitle = beforeTitle;
  let afterDesc = beforeDesc;

  if (test.kind === 'rule') {
    const searchRegex = test.searchInTitle ? new RegExp(test.searchInTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
    if ((test.testType === 'title' || test.testType === 'both') && searchRegex && test.replaceWith) {
      afterTitle = wordCapitalize(beforeTitle.replace(searchRegex, test.replaceWith));
    }
    if ((test.testType === 'description' || test.testType === 'both')) {
      if (test.descriptionOverride && test.descriptionOverride.trim()) {
        afterDesc = test.descriptionOverride.slice(0, 4950);
      } else if (searchRegex && test.replaceWith) {
        afterDesc = beforeDesc.replace(new RegExp(test.searchInTitle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'ig'), test.replaceWith).slice(0, 4950);
      }
    }
  }

  const titleChanged = afterTitle !== beforeTitle;
  const descChanged = afterDesc !== beforeDesc;

  document.getElementById('preview-body').innerHTML = `
    <div class="text-muted" style="font-size:12px;margin-bottom:14px;">
      Produkt: <span class="mono">${escapeHTML(product.id)}</span> · ${escapeHTML(product.product_type || '—')}
    </div>
    <div class="preview-side-by-side">
      <div class="preview-col">
        <div class="preview-col-label">Oryginał (parent)</div>
        <div class="preview-title">${escapeHTML(beforeTitle)}</div>
        <div class="preview-desc">${escapeHTML(beforeDesc) || '<em style="color:var(--muted);">brak opisu</em>'}</div>
      </div>
      <div class="preview-col is-variant">
        <div class="preview-col-label">Wariant (${escapeHTML(test.dupSuffix)})</div>
        <div class="preview-title" style="${titleChanged ? 'color:var(--primary);' : ''}">${escapeHTML(afterTitle)}</div>
        <div class="preview-desc" style="${descChanged ? 'background:var(--primary-soft);padding:8px;border-radius:6px;' : ''}">${escapeHTML(afterDesc) || '<em style="color:var(--muted);">brak opisu</em>'}</div>
      </div>
    </div>
    ${test.kind === 'image' ? `
      <div style="margin-top:18px;padding:12px;background:var(--bg);border-radius:8px;font-size:12px;color:var(--text-dim);">
        ⓘ Test typu „obraz" podmienia tylko <code>image_link</code>. Tytuł i opis pozostają identyczne — zmianę zobaczysz w panelu Zdjęcia lub na liście kafelków.
      </div>
    ` : ''}
  `;
}

// ====================================================================
// SIDE-PANEL (editor) — extended with testType + description
// ====================================================================
const sp = {
  current: null,
  original: null,
  debounceTimer: null,
};

function openSidePanelEditor(ruleId) {
  const rules = state.config?.duplicateRules || [];
  const rule = rules.find((r) => r.id === ruleId);
  if (!rule) {
    // Maybe it's an image rule
    const imageRules = state.config?.imageRules || [];
    const imgRule = imageRules.find((r) => r.id === ruleId);
    if (imgRule) {
      showToast('Edycja reguł obrazka (na razie) tylko w GitHubie. Open in GitHub →', 'warning');
      return;
    }
    showToast('Test nie znaleziony', 'error');
    return;
  }
  sp.current = JSON.parse(JSON.stringify(rule));
  sp.original = JSON.parse(JSON.stringify(rule));

  // Apply default testType for legacy rules
  if (!sp.current.testType) sp.current.testType = 'title';

  document.getElementById('sp-rule-id').textContent = rule.id;
  document.getElementById('sp-rule-status').innerHTML =
    `<span class="mono">${escapeHTML(rule.dupSuffix || '')}</span> · ${rule.active
      ? '<span class="pill pill-success">biegnie</span>'
      : '<span class="pill pill-muted">pauza</span>'} · utworzony ${escapeHTML((rule.created_at || '').substring(0, 10) || '—')}${rule.updated_at ? ' · edytowany ' + escapeHTML(rule.updated_at.substring(0, 10)) : ''}`;

  // Set radio
  document.querySelectorAll('input[name="sp-testType"]').forEach((r) => {
    r.checked = r.value === sp.current.testType;
  });

  // Set field values
  ['matchInTitle', 'searchInTitle', 'replaceWith', 'dupSuffix', 'notes', 'descriptionOverride'].forEach((field) => {
    const el = document.getElementById('sp-' + field);
    if (el) el.value = rule[field] || '';
  });

  updateDescOverrideVisibility();
  updateDescCounter();

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
  document.getElementById('side-panel-backdrop').addEventListener('click', (e) => {
    // Only close if backdrop itself was clicked (not the add panel)
    if (e.target.id === 'side-panel-backdrop') {
      closeSidePanel();
      closeAddPanel();
    }
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      if (document.getElementById('side-panel')?.classList.contains('show')) closeSidePanel();
      if (document.getElementById('add-panel')?.classList.contains('show')) closeAddPanel();
      if (document.getElementById('preview-modal')?.classList.contains('show')) closeEyePreview();
    }
  });

  // testType radios
  document.querySelectorAll('input[name="sp-testType"]').forEach((radio) => {
    radio.addEventListener('change', (e) => {
      if (!sp.current) return;
      sp.current.testType = e.target.value;
      updateDescOverrideVisibility();
      updateDiff();
      runImpactCheck();
    });
  });

  // Field input handlers
  ['matchInTitle', 'searchInTitle', 'replaceWith', 'dupSuffix', 'notes', 'descriptionOverride'].forEach((field) => {
    const el = document.getElementById('sp-' + field);
    if (!el) return;
    el.addEventListener('input', (e) => {
      if (!sp.current) return;
      sp.current[field] = e.target.value;
      if (field === 'replaceWith') updateReplacePreview();
      if (field === 'descriptionOverride') updateDescCounter();
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

function updateDescOverrideVisibility() {
  const field = document.getElementById('sp-desc-override-field');
  if (!field || !sp.current) return;
  field.style.display = (sp.current.testType === 'description' || sp.current.testType === 'both') ? 'block' : 'none';
}

function updateDescCounter() {
  const el = document.getElementById('sp-descriptionOverride');
  const counter = document.getElementById('sp-desc-counter');
  if (!el || !counter) return;
  counter.textContent = `${el.value.length} / 4950`;
  counter.style.color = el.value.length > 4500 ? 'var(--warning)' : 'var(--muted)';
}

function updateReplacePreview() {
  if (!sp.current) return;
  const raw = (sp.current.replaceWith || '').trim();
  const el = document.getElementById('sp-replace-preview');
  if (!raw) { el.textContent = '—'; el.style.color = 'var(--muted)'; return; }
  const normalized = wordCapitalize(raw);
  el.textContent = normalized;
  el.style.color = raw === normalized ? 'var(--success)' : 'var(--warning)';
}

function updateDiff() {
  if (!sp.original || !sp.current) return;
  const fields = ['testType', 'matchInTitle', 'searchInTitle', 'replaceWith', 'descriptionOverride', 'dupSuffix', 'notes'];
  const diff = {};
  for (const f of fields) {
    if ((sp.original[f] || '') !== (sp.current[f] || '')) {
      diff[f] = { before: sp.original[f] || '', after: sp.current[f] || '' };
    }
  }
  const diffEl = document.getElementById('sp-diff');
  if (diffEl) diffEl.textContent = Object.keys(diff).length === 0 ? 'Brak zmian' : JSON.stringify(diff, null, 2);
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

  // Add testType-specific validators
  const validators = [...(data.validators || [])];
  if ((sp.current.testType === 'description' || sp.current.testType === 'both')) {
    if (!sp.current.descriptionOverride && (!sp.current.searchInTitle || !sp.current.replaceWith)) {
      validators.push({
        level: 'error',
        message: 'Test typu „Opis" wymaga albo wypełnionego pola „Co podmienić" + „Czym to podmienić", albo pełnego override opisu.',
      });
    }
  }
  if (sp.current.descriptionOverride && sp.current.descriptionOverride.length > 4950) {
    validators.push({
      level: 'error',
      message: `Override opisu ma ${sp.current.descriptionOverride.length} znaków — limit Google PLA to 5000 (utrzymujemy 4950 dla bezpieczeństwa).`,
    });
  }

  const errorsCount = validators.filter((v) => v.level === 'error').length;
  const bannerLevel = errorsCount > 0 ? 'error' : (data.matched_count === 0 ? 'warning' : 'success');
  document.getElementById('sp-impact-banner').innerHTML = `
    <div class="alert show ${bannerLevel}">
      <strong>${data.matched_count}</strong> z ${data.total_products} produktów dotkniętych regułą.
      ${errorsCount > 0 ? ` <strong>${errorsCount} blokujący błąd${errorsCount > 1 ? 'y' : ''}</strong> w walidatorach poniżej.` : ''}
    </div>
  `;

  const vl = document.getElementById('sp-validators');
  if (!validators || validators.length === 0) {
    vl.innerHTML = '<div class="text-muted" style="font-size:12px;">Wszystko OK — żadnych ostrzeżeń</div>';
  } else {
    vl.innerHTML = validators
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

  // Samples — include description preview when testType requires
  const sc = document.getElementById('sp-sample-count');
  if (sc) sc.textContent = `pokazuję ${data.samples?.length || 0} z ${data.matched_count}`;
  const sa = document.getElementById('sp-samples');
  if (!data.samples || data.samples.length === 0) {
    sa.innerHTML = '<div class="text-muted" style="font-size:12px;">Brak matched products</div>';
  } else {
    sa.innerHTML = data.samples
      .map((s) => {
        const showDesc = sp.current.testType === 'description' || sp.current.testType === 'both';
        return `
      <div class="sample-preview">
        <div class="sample-id">id ${escapeHTML(s.id)}</div>
        ${sp.current.testType !== 'description' ? `
          <div class="sample-before">${escapeHTML(s.before)}</div>
          <div class="sample-after">→ ${escapeHTML(s.after)}</div>
        ` : `<div style="font-size:12.5px;font-weight:500;">${escapeHTML(s.before)}</div>
             <div class="text-muted" style="font-size:11px;font-style:italic;margin-top:4px;">(tytuł bez zmian — test typu Opis)</div>`}
      </div>
    `;
      })
      .join('');
  }

  document.getElementById('sp-save').disabled = errorsCount > 0;
  document.getElementById('sp-save').title = errorsCount > 0 ? 'Usuń błędy żeby zapisać' : '';
}

async function saveSidePanelChanges() {
  if (!sp.current) return;
  const id = sp.original.id;
  const changes = {};
  for (const f of ['testType', 'matchInTitle', 'searchInTitle', 'replaceWith', 'descriptionOverride', 'dupSuffix', 'notes']) {
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
    if (r.ok || r.status === 202) {
      showSaveSuccess(`Reguła ${id} zapisana`, j);
      closeSidePanel();
      await reloadConfig();
      renderTestsTable();
    } else if (r.status === 403 && j.fix) {
      showToast(format403Help(j), 'error');
      btn.disabled = false;
      btn.textContent = 'Zapisz zmiany';
    } else {
      showToast('Błąd: ' + escapeHTML(j.error || 'unknown'), 'error');
      btn.disabled = false;
      btn.textContent = 'Zapisz zmiany';
    }
  } catch (e) {
    showToast('Błąd sieci: ' + escapeHTML(e.message), 'error');
    btn.disabled = false;
    btn.textContent = 'Zapisz zmiany';
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
    if (r.ok || r.status === 202) {
      showSaveSuccess(`${id} toggled`, j);
      closeSidePanel();
      await reloadConfig();
      renderTestsTable();
    } else if (r.status === 403 && j.fix) {
      showToast(format403Help(j), 'error');
    } else {
      showToast('Błąd: ' + escapeHTML(j.error || 'unknown'), 'error');
    }
  } catch (e) {
    showToast('Błąd sieci: ' + escapeHTML(e.message), 'error');
  }
}

async function deleteSidePanelRule() {
  if (!sp.original) return;
  const id = sp.original.id;
  if (!confirm(`Skasować test „${id}"? Tego nie cofniesz inline — tylko git revert.`)) return;
  try {
    const r = await fetch('/api/rules/' + encodeURIComponent(id), { method: 'DELETE' });
    const j = await r.json();
    if (r.ok || r.status === 202) {
      showSaveSuccess(`Test ${id} usunięty`, j);
      closeSidePanel();
      await reloadConfig();
      renderTestsTable();
    } else if (r.status === 403 && j.fix) {
      showToast(format403Help(j), 'error');
    } else {
      showToast('Błąd: ' + escapeHTML(j.error || 'unknown'), 'error');
    }
  } catch (e) {
    showToast('Błąd sieci: ' + escapeHTML(e.message), 'error');
  }
}

// ====================================================================
// ADD PANEL (slides from right, separate from edit)
// ====================================================================
let _addPanelBound = false;

function openAddPanel() {
  // Reset form
  document.getElementById('add-test-form').reset();
  document.querySelectorAll('input[name="add-testType"]').forEach((r) => { r.checked = r.value === 'title'; });
  updateAddDescVisibility();
  updateAddDescCounter();
  document.getElementById('add-replace-preview').textContent = '—';
  document.getElementById('add-alert').className = 'alert';

  document.getElementById('add-panel').classList.add('show');
  document.getElementById('side-panel-backdrop').classList.add('show');
  document.getElementById('add-panel').setAttribute('aria-hidden', 'false');

  bindAddPanelHandlers();
}

function closeAddPanel() {
  document.getElementById('add-panel')?.classList.remove('show');
  document.getElementById('add-panel')?.setAttribute('aria-hidden', 'true');
  // Only close backdrop if side panel also not open
  if (!document.getElementById('side-panel')?.classList.contains('show')) {
    document.getElementById('side-panel-backdrop')?.classList.remove('show');
  }
}

function bindAddPanelHandlers() {
  if (_addPanelBound) return;
  _addPanelBound = true;

  document.getElementById('add-close').addEventListener('click', closeAddPanel);
  document.getElementById('add-cancel').addEventListener('click', closeAddPanel);

  document.querySelectorAll('input[name="add-testType"]').forEach((radio) => {
    radio.addEventListener('change', updateAddDescVisibility);
  });

  const replaceInput = document.getElementById('add-replaceWith');
  const replacePreview = document.getElementById('add-replace-preview');
  replaceInput.addEventListener('input', () => {
    const raw = replaceInput.value.trim();
    if (!raw) {
      replacePreview.textContent = '—';
      replacePreview.style.color = 'var(--muted)';
      return;
    }
    const normalized = wordCapitalize(raw);
    replacePreview.textContent = normalized;
    replacePreview.style.color = raw === normalized ? 'var(--success)' : 'var(--warning)';
  });

  document.getElementById('add-descriptionOverride').addEventListener('input', updateAddDescCounter);

  document.getElementById('add-test-form').addEventListener('submit', submitAddTest);
}

function updateAddDescVisibility() {
  const checked = document.querySelector('input[name="add-testType"]:checked')?.value || 'title';
  const field = document.getElementById('add-desc-override-field');
  if (field) field.style.display = (checked === 'description' || checked === 'both') ? 'block' : 'none';
}

function updateAddDescCounter() {
  const el = document.getElementById('add-descriptionOverride');
  const counter = document.getElementById('add-desc-counter');
  if (!el || !counter) return;
  counter.textContent = `${el.value.length} / 4950`;
  counter.style.color = el.value.length > 4500 ? 'var(--warning)' : 'var(--muted)';
}

async function submitAddTest(e) {
  e.preventDefault();
  const btn = document.getElementById('add-submit');
  const alertEl = document.getElementById('add-alert');
  btn.disabled = true;
  btn.textContent = 'Dodaję…';
  alertEl.className = 'alert';

  const data = {
    testType: document.querySelector('input[name="add-testType"]:checked')?.value || 'title',
    matchInTitle: document.getElementById('add-matchInTitle').value.trim(),
    searchInTitle: document.getElementById('add-searchInTitle').value.trim(),
    replaceWith: document.getElementById('add-replaceWith').value.trim(),
    descriptionOverride: document.getElementById('add-descriptionOverride').value.trim() || null,
    dupSuffix: document.getElementById('add-dupSuffix').value.trim(),
    notes: document.getElementById('add-notes').value.trim(),
  };

  try {
    const r = await fetch('/api/add-variant', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    const j = await r.json();
    if (r.ok) {
      alertEl.innerHTML = `✓ Dodałem Twój nowy test. Wjedzie do sklepu w ciągu godziny. <a href="${escapeHTML(j.url || '#')}" target="_blank" rel="noopener">zobacz szczegóły →</a>`;
      alertEl.className = 'alert show success';
      setTimeout(async () => {
        closeAddPanel();
        await reloadConfig();
        renderTestsTable();
      }, 1800);
    } else {
      alertEl.innerHTML = 'Coś nie wyszło: ' + escapeHTML(j.error || 'nieznany powód') + '. Spróbuj jeszcze raz.';
      alertEl.className = 'alert show error';
    }
  } catch (err) {
    alertEl.innerHTML = 'Sieć nie odpowiada: ' + escapeHTML(err.message);
    alertEl.className = 'alert show error';
  } finally {
    btn.disabled = false;
    btn.textContent = 'Dodaj test';
  }
}

// Make openAddPanel globally available for inline onclick in decisions feed
window.openAddPanel = openAddPanel;

// ====================================================================
// IDEAS (hypotheses + add CTA)
// ====================================================================
async function renderIdeas() {
  await ensureCoreLoaded();
  await ensurePerformanceSnapshotLoaded();

  const content = document.getElementById('ideas-content');
  const subtitle = document.getElementById('ideas-subtitle');

  const rules = state.config?.duplicateRules || [];
  const snapshot = state.perfSnapshot;
  const hypotheses = buildHypotheses(rules, snapshot);

  const counts = {
    critical: hypotheses.filter((h) => h.priority === 'critical').length,
    high: hypotheses.filter((h) => h.priority === 'high').length,
    medium: hypotheses.filter((h) => h.priority === 'medium').length,
    low: hypotheses.filter((h) => h.priority === 'low').length,
  };
  const parts = [];
  if (counts.critical) parts.push(`<span style="color:var(--error);">${counts.critical} pilne</span>`);
  if (counts.high) parts.push(`<span style="color:var(--warning);">${counts.high} ważne</span>`);
  if (counts.medium) parts.push(`${counts.medium} warto rozważyć`);
  if (counts.low) parts.push(`${counts.low} drobnostek`);
  subtitle.innerHTML = parts.length ? parts.join(' · ') : 'Wszystko gra — nic do roboty';

  // Always include CTA card at top
  let html = `
    <div class="card mb-2" style="border-left:3px solid var(--primary);">
      <div class="card-header">
        <div>
          <div class="card-title">Masz pomysł na nowy test?</div>
          <div class="card-sub">Tytuł, opis, albo jedno i drugie — wjedzie do sklepu w ciągu godziny</div>
        </div>
        <button class="btn" onclick="openAddPanel()" style="padding:9px 16px;">+ Nowy test</button>
      </div>
    </div>
  `;

  if (hypotheses.length === 0) {
    html += '<div class="placeholder"><div class="placeholder-title">Brak hipotez — system w stabilnym stanie</div></div>';
  } else {
    html += hypotheses
      .map((h) => {
        const priorityColor = { critical: 'error', high: 'warning', medium: 'info', low: 'muted' }[h.priority] || 'muted';
        return `
      <div class="card mb-2" style="border-left:3px solid var(--${h.priority === 'critical' ? 'error' : h.priority === 'high' ? 'warning' : 'primary'});">
        <div class="card-header">
          <div>
            <div class="card-title">${h.icon || '◆'} ${escapeHTML(h.title)}</div>
            <div class="card-sub">${escapeHTML(h.source)}</div>
          </div>
          <span class="pill pill-${priorityColor}">${escapeHTML(h.priority)}</span>
        </div>
        <div style="font-size:13px;line-height:1.6;color:var(--text-dim);">${h.detail}</div>
        ${h.action ? `<div style="margin-top:12px;padding:10px 12px;background:var(--bg);border-radius:6px;font-size:12px;"><strong>Sugerowana akcja:</strong> ${h.action}</div>` : ''}
        ${h.evidence ? `<details style="margin-top:8px;"><summary style="cursor:pointer;font-size:11px;color:var(--muted);">Evidence ▾</summary><ul style="margin:6px 0 0 18px;font-size:11px;color:var(--text-dim);">${h.evidence.map((e) => `<li>${escapeHTML(e)}</li>`).join('')}</ul></details>` : ''}
      </div>
    `;
      })
      .join('');
  }

  content.innerHTML = html;
}

function buildHypotheses(rules, snapshot) {
  const out = [];

  if (snapshot?.duplicate_diagnosis?.status === 'critical') {
    const d = snapshot.duplicate_diagnosis;
    const fix = d.fix_proposal || {};
    const detail = fix.preserves
      ? `<strong>Dlaczego tak się dzieje:</strong><br>${(d.evidence || []).slice(0,2).map((e) => '• ' + escapeHTML(e)).join('<br>')}<br><br><strong>Jak to naprawić:</strong> ${escapeHTML(fix.name || '')}.<br>${escapeHTML(fix.preserves || '')}<br><br><strong>Czego się spodziewać:</strong> ${escapeHTML(fix.expected_outcome_week1 || '')}`
      : `<strong>Dlaczego tak się dzieje:</strong> ${escapeHTML(d.evidence?.[0] || '—')}`;
    out.push({
      priority: 'critical',
      icon: '!',
      title: d.headline || 'Twój test tytułów nie zbiera danych',
      source: 'Confirmed przez analizę Twoich kampanii (custom_label_8 ad-group filters)',
      detail,
      action: fix.caveat_t6_t7 ? `Powiedz mi „naprawiaj" — przygotowałem już pre-flight diff. <br><br><em>Uwaga: ${escapeHTML(fix.caveat_t6_t7)}</em>` : 'Powiedz mi „naprawiaj" — pre-flight diff gotowy.',
      evidence: d.evidence,
    });
  }

  for (const t of (snapshot?.proposed_new_tests || []).slice(0, 5)) {
    const priority = t.priority_score >= 9 ? 'high' : t.priority_score >= 7 ? 'medium' : 'low';
    out.push({
      priority,
      icon: '+',
      title: `Spróbuj: „${escapeHTML(t.title_proposed)}"`,
      source: `Z danych GSC + Google Ads + GA4 · grupa „${escapeHTML(t.match_group)}" · ${t.products_in_scope} produktów`,
      detail: escapeHTML(t.evidence),
      action: `Spodziewany wpływ: <strong>+${t.expected_revenue_pln_per_month?.toLocaleString('pl-PL')} zł/mc przychodu</strong>${t.campaign_target ? ` · wpadnie do: ${escapeHTML(t.campaign_target)}` : ''}<br><br><button class="btn" onclick="openAddPanel()" style="padding:6px 12px;font-size:12px;margin-top:6px;">+ Dodaj jako test</button>`,
    });
  }

  for (const c of snapshot?.underperforming_campaigns || []) {
    out.push({
      priority: 'high',
      icon: '↓',
      title: `Kampania „${c.name}" oddaje budżet niewspółmiernie do przychodu`,
      source: 'Z danych z Twoich kampanii, ostatni miesiąc',
      detail: escapeHTML(c.alert),
      action: 'Spauzuj tę kampanię. Jeśli to świadoma kampania pozyskująca nowych klientów — sprawdź inne wskaźniki niż zwrot (np. koszt pozyskania klienta).',
    });
  }

  for (const w of snapshot?.winner_campaigns?.slice(0, 1) || []) {
    out.push({
      priority: 'medium',
      icon: '★',
      title: `Skopiuj sposób, w jaki działa „${w.name}"`,
      source: 'Najlepsza Twoja kampania, ostatni miesiąc',
      detail: escapeHTML(w.note),
      action: 'Spójrz, jak ta kampania ma ustawione bidy, grupy assetów i cele ROAS. Zastosuj to samo w pozostałych PMax-ach.',
    });
  }

  const activeRules = rules.filter((r) => r.active);
  const inactive = rules.filter((r) => !r.active);

  if (inactive.length > 0) {
    out.push({
      priority: 'low',
      icon: '◦',
      title: `Masz ${inactive.length} ${inactive.length === 1 ? 'wyłączony test' : 'wyłączone testy'} — może warto sprzątnąć`,
      source: 'Z Twojej listy testów',
      detail: `Testy: ${inactive.map((r) => escapeHTML(r.dupSuffix || r.id)).join(', ')}. Nie generują wariantów, ale wciąż są na liście.`,
      action: 'Skasuj jeśli wiesz, że już do nich nie wrócisz. Zostaw jeśli to reference do tytułów które weszły do głównego feedu.',
    });
  }

  const capsViolations = activeRules.filter((r) => /[A-ZĄĆĘŁŃÓŚŹŻ]{3,}/.test(r.replaceWith || ''));
  if (capsViolations.length > 0) {
    out.push({
      priority: 'medium',
      icon: '⚠',
      title: `${capsViolations.length} ${capsViolations.length === 1 ? 'test ma' : 'testy mają'} krzyczące CAPS-y w nowym tytule`,
      source: 'Z Twojej listy testów',
      detail: `Testy: ${capsViolations.map((r) => escapeHTML(r.dupSuffix)).join(', ')}. Wynikowy tytuł w sklepie i tak będzie miał każde słowo z dużej (system to naprawia), ale w panelu wygląda jak krzyk i wprowadza w błąd.`,
      action: 'Otwórz każdy test i przepisz pole „czym podmienić" tak, żeby wyglądało normalnie (np. „Zasłona do altany" zamiast „ZASŁONA DO ALTANY").',
    });
  }

  if (activeRules.length > 7) {
    out.push({
      priority: 'medium',
      icon: '↑',
      title: `${activeRules.length} testów na raz — to może być za dużo`,
      source: 'Z Twojej listy testów',
      detail: 'Każdy wariant dzieli te same wyświetlenia, więc przy zbyt wielu testach żaden nie zbierze dość kliknięć na sensowną decyzję. Branżowa rekomendacja: 3 do 7 wariantów jednocześnie.',
      action: 'Wyłącz na pauzę najmniej priorytetowe testy lub poczekaj aż obecne się zakończą, zanim dodasz nowe.',
    });
  }

  return out;
}

// ====================================================================
// SHOP — subtabs (perf, health, history)
// ====================================================================
async function renderShop() {
  // Wire subtabs once
  document.querySelectorAll('.subtab').forEach((tab) => {
    if (tab.dataset.bound === '1') return;
    tab.dataset.bound = '1';
    tab.addEventListener('click', (e) => {
      e.preventDefault();
      const sub = tab.dataset.subtab;
      location.hash = '#shop/' + sub;
    });
  });
  // First render — populate the default subtab
  await renderPerformance();
}

async function renderPerformance() {
  await ensureCoreLoaded();
  await ensurePerformanceSnapshotLoaded();

  const banner = document.getElementById('perf-diagnosis-banner');
  const summary = document.getElementById('perf-summary');
  const table = document.getElementById('perf-campaigns-table');
  const actions = document.getElementById('perf-actions');
  const actionsCard = document.getElementById('perf-actions-card');
  const sub = document.getElementById('perf-campaigns-sub');

  if (state.perfSnapshotError) {
    banner.innerHTML = `<div class="alert error show">Snapshot fetch error: ${escapeHTML(state.perfSnapshotError)}</div>`;
    table.innerHTML = '';
    return;
  }
  const s = state.perfSnapshot;
  if (!s) return;

  if (s.duplicate_diagnosis && s.duplicate_diagnosis.status === 'critical') {
    const d = s.duplicate_diagnosis;
    const fix = d.fix_proposal || {};
    banner.innerHTML = `
      <div class="alert error show" style="font-size:14.5px;line-height:1.65;">
        <div style="font-family:var(--font-display);font-size:20px;font-weight:500;margin-bottom:10px;">${escapeHTML(d.headline || 'Twój test tytułów nie zbiera danych')}</div>
        ${d.root_cause_confirmed ? '<div style="margin-bottom:14px;font-style:italic;opacity:0.85;">Wiem już dokładnie dlaczego — sprawdziłem strukturę Twoich kampanii w Google Ads.</div>' : ''}
        <div style="margin-top:12px;"><strong>Co znalazłem:</strong></div>
        <ul style="margin:6px 0 14px 22px;font-size:13.5px;">
          ${(d.evidence || []).map((e) => `<li style="margin-bottom:4px;">${escapeHTML(e)}</li>`).join('')}
        </ul>
        ${fix.name ? `
          <div style="margin-top:18px;padding:16px 18px;background:rgba(154,184,150,0.08);border:1px solid rgba(154,184,150,0.25);border-radius:10px;">
            <div style="color:var(--success);font-family:var(--font-display);font-size:17px;font-weight:500;margin-bottom:8px;">✓ Naprawa gotowa do wdrożenia</div>
            <div style="font-size:13.5px;line-height:1.65;color:var(--text-dim);">
              <strong>Co zrobię:</strong> ${escapeHTML(fix.name)}.<br>
              <strong>Co zachowane:</strong> ${escapeHTML(fix.preserves || '')}.<br>
              <strong>Czego się spodziewać:</strong> ${escapeHTML(fix.expected_outcome_week1 || '')}.<br>
              ${fix.caveat_t6_t7 ? `<strong style="color:var(--warning);">Uwaga:</strong> ${escapeHTML(fix.caveat_t6_t7)}<br>` : ''}
            </div>
            <div style="margin-top:14px;font-size:13px;color:var(--text);"><strong>Powiedz mi „naprawiaj"</strong> w czacie, a wprowadzę zmianę z pełnym pre-flight diff.</div>
          </div>
        ` : ''}
      </div>
    `;
  } else {
    banner.innerHTML = '';
  }

  const sum = s.summary_30d || {};
  summary.innerHTML = `
    <div class="kpi-tile">
      <div class="kpi-label">Zwrot z reklam · 30 dni</div>
      <div class="kpi-value">${(sum.blended_roas || 0).toFixed(2)}<span class="text-muted" style="font-size:16px;font-weight:400;font-style:italic;"> ×</span></div>
      <div class="kpi-sub">Każda 1 zł wydana na reklamę przyniosła ${(sum.blended_roas || 0).toFixed(2)} zł sprzedaży</div>
    </div>
    <div class="kpi-tile">
      <div class="kpi-label">Wydane / zarobione</div>
      <div class="kpi-value">${((sum.total_conv_value_pln || 0) / 1000).toFixed(0)}<span class="text-muted" style="font-size:16px;font-weight:400;"> tys.</span></div>
      <div class="kpi-sub">${(sum.total_conv_value_pln || 0).toLocaleString('pl-PL', { maximumFractionDigits: 0 })} zł przychodu z ${(sum.total_cost_pln || 0).toLocaleString('pl-PL', { maximumFractionDigits: 0 })} zł budżetu</div>
    </div>
    <div class="kpi-tile">
      <div class="kpi-label">Kliknięcia</div>
      <div class="kpi-value">${(sum.total_clicks || 0).toLocaleString('pl-PL')}</div>
      <div class="kpi-sub">${((sum.total_impressions || 0) / 1000).toFixed(0)} tys. wyświetleń · klikalność ${((sum.blended_ctr || 0) * 100).toFixed(2)}% · średnio ${(sum.blended_cpc_pln || 0).toFixed(2)} zł za klik</div>
    </div>
  `;

  const campaigns = s.top_campaigns_30d || [];
  sub.textContent = `${campaigns.length} kampanii — od największego budżetu · łącznie ${(sum.total_cost_pln || 0).toLocaleString('pl-PL', { maximumFractionDigits: 0 })} zł w miesiącu`;
  table.innerHTML = `
    <table class="data-table">
      <thead>
        <tr>
          <th>Kampania</th>
          <th>Rodzaj</th>
          <th style="text-align:right;">Wyświetlenia</th>
          <th style="text-align:right;">Kliknięcia</th>
          <th style="text-align:right;">Klikalność</th>
          <th style="text-align:right;">Cena za klik</th>
          <th style="text-align:right;">Wydane</th>
          <th style="text-align:right;">Konwersje</th>
          <th style="text-align:right;">Przychód</th>
          <th style="text-align:right;">Zwrot</th>
        </tr>
      </thead>
      <tbody>
        ${campaigns.map((c) => {
          const roasClass = c.roas >= 8 ? 'pill-success' : c.roas >= 3 ? 'pill-info' : c.roas >= 1 ? 'pill-warning' : 'pill-error';
          return `
          <tr>
            <td><strong>${escapeHTML(c.name)}</strong></td>
            <td><span class="pill pill-muted">${escapeHTML(c.channel)}</span></td>
            <td style="text-align:right;" class="mono">${c.impressions.toLocaleString('pl-PL')}</td>
            <td style="text-align:right;" class="mono">${c.clicks.toLocaleString('pl-PL')}</td>
            <td style="text-align:right;" class="mono">${(c.ctr * 100).toFixed(2)}%</td>
            <td style="text-align:right;" class="mono">${c.cpc_pln.toFixed(2)} zł</td>
            <td style="text-align:right;" class="mono">${c.cost_pln.toLocaleString('pl-PL', { maximumFractionDigits: 0 })} zł</td>
            <td style="text-align:right;" class="mono">${Math.round(c.conv).toLocaleString('pl-PL')}</td>
            <td style="text-align:right;" class="mono">${c.conv_value_pln.toLocaleString('pl-PL', { maximumFractionDigits: 0 })} zł</td>
            <td style="text-align:right;"><span class="pill ${roasClass}">${c.roas.toFixed(2)} ×</span></td>
          </tr>
        `}).join('')}
      </tbody>
    </table>
  `;

  const recs = s.duplicate_diagnosis?.recommended_actions || [];
  if (recs.length > 0) {
    actionsCard.style.display = 'block';
    actions.innerHTML = `
      <ol style="margin:0 0 0 22px;font-size:14px;line-height:1.7;">
        ${recs.map((a) => `<li style="margin-bottom:10px;">${escapeHTML(a)}</li>`).join('')}
      </ol>
    `;
  }
}

async function renderFeedHealth() {
  await ensureCoreLoaded();

  const regenBtn = document.getElementById('regenerate-btn');
  const regenStatus = document.getElementById('regenerate-status');
  if (regenBtn && regenBtn.dataset.bound !== '1') {
    regenBtn.dataset.bound = '1';
    regenBtn.addEventListener('click', async () => {
      regenBtn.disabled = true;
      regenBtn.textContent = '⟳ Odświeżam…';
      regenStatus.className = 'alert';
      try {
        const r = await fetch('/api/regenerate-feed', { method: 'POST' });
        const j = await r.json();
        if (r.ok) {
          regenStatus.className = 'alert show success';
          regenStatus.innerHTML = `${escapeHTML(j.message)} <button class="pill pill-info" id="regen-refresh" style="margin-left:10px;border:none;cursor:pointer;">odśwież widok →</button>`;
          document.getElementById('regen-refresh')?.addEventListener('click', async () => {
            state.feedStats = null;
            state.statsError = null;
            _coreLoaded = null;
            await ensureCoreLoaded();
            renderFeedHealth();
          });
        } else {
          regenStatus.className = 'alert show error';
          regenStatus.textContent = 'Nie udało się odświeżyć: ' + (j.error || 'nieznany powód') + '. Spróbuj za chwilę.';
        }
      } catch (e) {
        regenStatus.className = 'alert show error';
        regenStatus.textContent = 'Sieć nie odpowiada: ' + e.message;
      } finally {
        regenBtn.disabled = false;
        regenBtn.textContent = '⟳ Odśwież teraz';
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
    ? 'Sprawdzone ' + fmtRelative(state.feedStats.fetched_at)
    : '';

  const o = state.feedStats?.output;
  const c = state.feedStats?.last_config_change;
  const r = state.feedStats?.last_cron_run;

  body.innerHTML = `
    <table class="data-table">
      <tr>
        <th style="width:200px;">Warianty w sklepie</th>
        <td><strong>${o ? o.total_rows.toLocaleString('pl-PL') : '—'}</strong> · ${o ? Math.round(o.size_bytes / 1024) + ' KB' : '—'}</td>
      </tr>
      <tr>
        <th>Ostatnie odświeżenie</th>
        <td>
          ${r ? `
            ${r.conclusion === 'success' ? '<span class="pill pill-success">success</span>' : `<span class="pill pill-${r.conclusion === 'failure' ? 'error' : 'warning'}">${escapeHTML(r.conclusion || r.status)}</span>`}
            · #${r.run_number} · ${fmtRelative(r.completed_at)} (${fmtDate(r.completed_at)})
            · powód: <span class="mono">${escapeHTML(r.trigger || '')}</span>
            · <a href="${escapeHTML(r.html_url)}" target="_blank" rel="noopener" class="mono">otwórz →</a>
          ` : '—'}
        </td>
      </tr>
      <tr>
        <th>Ostatnia zmiana w konfiguracji</th>
        <td>
          ${c ? `
            <div class="text-dim">${escapeHTML(c.message)}</div>
            <div class="text-muted" style="font-size:12px;">
              <span class="mono">${escapeHTML(c.short_sha)}</span> · ${escapeHTML(c.author)} · ${fmtDate(c.timestamp)} · <a href="${escapeHTML(c.html_url)}" target="_blank" rel="noopener" class="mono">otwórz →</a>
            </div>
          ` : '—'}
        </td>
      </tr>
      <tr>
        <th>Łańcuch sklepu</th>
        <td class="text-dim" style="font-size:13px;">
          FeedOptimise (źródło) → GitHub Actions (cron co 1h) → GitHub Pages (TSV) → Google Merchant Center
        </td>
      </tr>
      <tr>
        <th>Re-fetch GMC</th>
        <td class="text-muted">Skonfigurowane w Google Merchant Center · cron 6–24h w zależności od ustawień</td>
      </tr>
    </table>
  `;
}

// History
function humanizeCommitMessage(msg, author) {
  if (!msg) return { title: 'Zmiana', who: author || 'system' };
  const m = msg.replace(/\n.*$/s, '').trim();
  if (/chore: auto-regenerate/.test(m)) return { title: 'Sklep odświeżył się automatycznie', who: 'system', kind: 'auto' };
  if (/chore\(rule-action\)/.test(m)) {
    const issueNum = m.match(/issue #(\d+)/)?.[1];
    return { title: 'Twoja zmiana zastosowana w sklepie', who: 'system', kind: 'action', note: issueNum ? `zlecone z panelu #${issueNum}` : '' };
  }
  if (/chore\(image-rule\)/.test(m)) return { title: 'Nowa reguła obrazka dodana', who: 'system', kind: 'image' };
  if (/chore: manual regenerate/.test(m)) return { title: 'Ręczne odświeżenie sklepu', who: 'Ty', kind: 'manual' };
  if (/feat: add variant/.test(m)) {
    const issueNum = m.match(/issue #(\d+)/)?.[1];
    return { title: 'Nowy test dodany', who: 'Ty', kind: 'add', note: issueNum ? `przez formularz #${issueNum}` : '' };
  }
  if (/chore\(rules\):/.test(m)) {
    if (/toggle/.test(m)) return { title: 'Pauza/wznowienie testu', who: 'Ty', kind: 'toggle' };
    if (/edit/.test(m)) return { title: 'Edycja testu', who: 'Ty', kind: 'edit' };
    if (/delete/.test(m)) return { title: 'Test usunięty', who: 'Ty', kind: 'delete' };
    return { title: 'Zmiana w teście', who: 'Ty', kind: 'edit' };
  }
  if (/^fix/.test(m)) return { title: m.replace(/^fix[\(:][^)]*\)?\s*:?\s*/, '').replace(/^\w/, (c) => c.toUpperCase()), who: author || 'Ty', kind: 'fix' };
  if (/^feat/.test(m)) return { title: m.replace(/^feat\s*:?\s*/, '').replace(/^\w/, (c) => c.toUpperCase()), who: author || 'Ty', kind: 'add' };

  const cleaned = m.replace(/\s*#\d+\s*/g, ' ').replace(/^chore\s*\([^)]+\)\s*:\s*/i, '').replace(/^\w/, (c) => c.toUpperCase());
  return { title: cleaned, who: author || 'system', kind: 'other' };
}

async function renderHistory() {
  const link = document.getElementById('history-github-link');
  if (link) link.href = COMMITS_URL;

  const countEl = document.getElementById('history-count');
  const content = document.getElementById('history-content');

  let data;
  try {
    data = await fetchJSON('/api/commits?path=config.json&per_page=30');
  } catch (e) {
    countEl.textContent = 'Nie udało się wczytać';
    content.innerHTML = `<div class="alert error show">Nie udało się pobrać historii: ${escapeHTML(e.message)}</div>`;
    return;
  }

  const commits = data.commits || [];
  countEl.textContent = commits.length === 0
    ? 'Brak zmian'
    : (commits.length === 1 ? '1 zmiana w Twojej konfiguracji' : `${commits.length} zmian w Twojej konfiguracji`);

  if (commits.length === 0) {
    content.innerHTML = '<div class="placeholder"><div class="placeholder-title">Jeszcze nic się nie działo</div></div>';
    return;
  }

  const iconFor = (kind) => ({
    auto: { c: 'muted', i: '⟳' },
    action: { c: 'info', i: '✎' },
    image: { c: 'info', i: '▣' },
    manual: { c: 'success', i: '⟳' },
    add: { c: 'success', i: '+' },
    toggle: { c: 'info', i: '⏸' },
    edit: { c: 'info', i: '✎' },
    delete: { c: 'error', i: '✕' },
    fix: { c: 'warning', i: '⚠' },
    other: { c: 'muted', i: '·' },
  })[kind] || { c: 'muted', i: '·' };

  content.innerHTML = `
    <div style="display:flex;flex-direction:column;gap:10px;">
      ${commits
        .map((c) => {
          const h = humanizeCommitMessage(c.message_first_line || c.message, c.author);
          const ic = iconFor(h.kind);
          const whoDisplay = h.who === 'system' ? 'automatycznie' : (h.who === 'Ty' ? 'przez Ciebie' : 'przez ' + escapeHTML(h.who));
          return `
        <div class="decision-card" style="margin-bottom:0;">
          <div class="decision-icon ${ic.c}">${ic.i}</div>
          <div class="decision-body">
            <div class="decision-title">${escapeHTML(h.title)}</div>
            <div class="decision-meta">
              ${whoDisplay} · ${fmtRelative(c.timestamp)} (${fmtDate(c.timestamp)})${h.note ? ' · <em>' + escapeHTML(h.note) + '</em>' : ''}
            </div>
          </div>
        </div>
      `;
        })
        .join('')}
    </div>
  `;
}

// ====================================================================
// TOAST + HELPERS
// ====================================================================
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

function showSaveSuccess(action, j) {
  const where = j.method === 'issue_fallback'
    ? 'zapisałem w bezpiecznej kolejce, sklep się zaktualizuje w ciągu minuty'
    : 'sklep zaktualizuje się w ciągu kilku minut';
  const link = j.commit_url || j.issue_url || '#';
  showToast(
    `✓ ${escapeHTML(action)} — ${where}. <a href="${escapeHTML(link)}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;">zobacz szczegóły →</a>`,
    'success'
  );
}

function format403Help(j) {
  if (!j.fix) return escapeHTML(j.error || 'unknown');
  return `
    <strong>${escapeHTML(j.error)}</strong><br>
    <details style="margin-top:8px;">
      <summary style="cursor:pointer;font-weight:600;">Jak naprawić (krok po kroku) ▾</summary>
      <ol style="margin:6px 0 0 18px;font-size:12px;line-height:1.6;">
        <li><a href="${escapeHTML(j.fix.step_1.split(': ')[1])}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;">Generate fine-grained PAT →</a></li>
        <li>${escapeHTML(j.fix.step_2)}</li>
        <li>${escapeHTML(j.fix.step_3)}</li>
        <li><a href="${escapeHTML(j.fix.step_4.split(': ')[1])}" target="_blank" rel="noopener" style="color:inherit;text-decoration:underline;">Update GITHUB_TOKEN in Vercel →</a></li>
        <li>${escapeHTML(j.fix.step_5)}</li>
      </ol>
    </details>
  `;
}

// ====================================================================
// HEALTH BANNER
// ====================================================================
async function renderHealthBanner() {
  const container = document.getElementById('health-banner-container');
  if (!container) return;
  let configOk = false;
  try {
    const r = await fetch('/api/config');
    configOk = r.ok;
  } catch {}

  if (!configOk) {
    container.innerHTML = `
      <div style="background:var(--error-soft);color:var(--error);padding:12px 36px;border-bottom:1px solid rgba(194,91,60,0.3);font-size:14px;text-align:center;">
        Coś nie tak — nie mogę dotrzeć do Twoich danych. Spróbuj odświeżyć stronę za chwilę.
      </div>
    `;
    return;
  }

  container.innerHTML = `
    <div id="health-banner-inner" style="background:var(--primary-soft);color:var(--primary);padding:10px 36px;border-bottom:1px solid rgba(212,165,116,0.25);font-size:13px;text-align:center;transition:opacity 0.4s;font-style:italic;">
      Wszystko gra. Każda zmiana którą tu zrobisz zostanie zapisana bezpiecznie i trafi do sklepu w ciągu kilku minut.
      <button id="health-banner-dismiss" style="margin-left:14px;background:transparent;border:none;color:inherit;cursor:pointer;font-weight:600;font-size:14px;">✕</button>
    </div>
  `;
  document.getElementById('health-banner-dismiss').addEventListener('click', () => {
    container.innerHTML = '';
  });
  setTimeout(() => {
    const el = document.getElementById('health-banner-inner');
    if (el) el.style.opacity = '0';
    setTimeout(() => { container.innerHTML = ''; }, 500);
  }, 8000);
}

// ====================================================================
// INIT
// ====================================================================
window.addEventListener('hashchange', onHashChange);
document.addEventListener('DOMContentLoaded', () => {
  ensureCoreLoaded();
  renderHealthBanner();
  bindSidePanelHandlers();
  bindAddPanelHandlers();
  onHashChange();
});
