// POST /api/rule-impact — compute impact of a proposed (or existing) rule
// against the live FO source feed. Returns:
//   - matched_count: how many products this rule would create duplicates for
//   - samples: 3 example before/after title transformations
//   - validators: array of {level: 'error'|'warning'|'info', code, message}
//     covering Title-Case enforcement, length, CAPS ratio, forbidden words,
//     match overlap with other active rules (if provided).
//   - conflict: optional info about overlap with another rule
//
// Body: { matchInTitle, searchInTitle, replaceWith, dupSuffix?, ruleId?, otherRules? }
// All fields optional except matchInTitle. dupSuffix/ruleId help conflict detection.

const FEED_SOURCE_URL = 'https://io.feedoptimise.com/feed/1805/3809/507fc39b-dc19-4f5d-9107-db1900f6bb21/google-pl.tsv';
let _feedCache = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchFeed() {
  if (_feedCache && Date.now() - _feedCache.ts < CACHE_TTL_MS) return _feedCache.products;
  const r = await fetch(FEED_SOURCE_URL);
  if (!r.ok) throw new Error('Source feed fetch failed: HTTP ' + r.status);
  const tsv = await r.text();
  const lines = tsv.split(/\r?\n/);
  const headers = lines[0].split('\t');
  const titleIdx = headers.indexOf('title');
  const idIdx = headers.indexOf('id');
  const availIdx = headers.indexOf('availability');
  const products = [];
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i].trim()) continue;
    const f = lines[i].split('\t');
    products.push({
      id: f[idIdx] || '',
      title: f[titleIdx] || '',
      availability: f[availIdx] || '',
    });
  }
  _feedCache = { ts: Date.now(), products };
  return products;
}

function escapeRegExp(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Mirror of generate-feed.js wordCapitalize — Title Case with x-between-digits preserved
function wordCapitalize(s) {
  if (!s) return '';
  return String(s)
    .toLowerCase()
    .replace(/(?<![\p{L}\d])(\p{L})(\p{L}*)/gu, (m, a, b) => a.toUpperCase() + b);
}

// GMC + industry validators
const PROMO_WORDS_PL = [
  'najlepszy', 'najtańszy', 'tani', 'tanio', 'promocja', 'okazja',
  'gwarancja', 'natychmiastowy', 'sale', 'free shipping', 'darmowa wysyłka',
  'bestseller', 'topowy', 'wyprzedaż',
];
const FORBIDDEN_CHARS = /[★☆♦♣♠♥!]{2,}|[#@]{2,}/;

function validateProposedTitle(proposedTitle) {
  const issues = [];
  const len = proposedTitle.length;
  if (len > 150) issues.push({ level: 'error', code: 'TITLE_TOO_LONG', message: `Tytuł ma ${len} znaków — Google PLA ignoruje >150 znaków` });
  else if (len > 70) issues.push({ level: 'warning', code: 'TITLE_TRUNCATED_MOBILE', message: `Tytuł ${len} znaków — mobile Shopping pokazuje tylko ~70` });
  else if (len < 30) issues.push({ level: 'info', code: 'TITLE_SHORT', message: `Tytuł ${len} znaków — niewykorzystany potencjał (do 70 znaków bez truncation)` });

  // CAPS ratio (excluding dimensions like 140x280)
  const letters = proposedTitle.match(/\p{L}/gu) || [];
  const caps = proposedTitle.match(/[A-ZĄĆĘŁŃÓŚŹŻ]/g) || [];
  const capsRatio = letters.length ? caps.length / letters.length : 0;
  if (capsRatio > 0.5) issues.push({ level: 'error', code: 'CAPS_RATIO_HIGH', message: `${Math.round(capsRatio * 100)}% liter wielkich — Google disapproval risk` });
  if (/[A-ZĄĆĘŁŃÓŚŹŻ]{3,}/.test(proposedTitle)) issues.push({ level: 'warning', code: 'ALL_CAPS_SEQUENCE', message: 'Tytuł zawiera 3+ kolejne wielkie litery — Title Case enforced by generator' });

  const promoFound = PROMO_WORDS_PL.filter((w) => new RegExp('\\b' + w + '\\b', 'i').test(proposedTitle));
  if (promoFound.length) issues.push({ level: 'warning', code: 'PROMO_WORDS', message: `Promocyjne słowa: ${promoFound.join(', ')} — Google policy może odrzucić` });

  if (FORBIDDEN_CHARS.test(proposedTitle)) issues.push({ level: 'warning', code: 'FORBIDDEN_CHARS', message: 'Powtarzające się znaki specjalne (!!!, ★★) — Google penalty risk' });

  return issues;
}

function validateReplaceField(replaceWith) {
  const issues = [];
  if (!replaceWith || !replaceWith.trim()) {
    issues.push({ level: 'error', code: 'REPLACE_EMPTY', message: 'Replace value jest puste' });
    return issues;
  }
  if (/[A-ZĄĆĘŁŃÓŚŹŻ]{3,}/.test(replaceWith)) {
    const normalized = wordCapitalize(replaceWith);
    issues.push({
      level: 'info',
      code: 'CAPS_NORMALIZED',
      message: `Wpisałeś ALL-CAPS — generator zamieni na "${normalized}"`,
    });
  }
  return issues;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { matchInTitle, searchInTitle, replaceWith, dupSuffix, ruleId, otherRules } = req.body || {};
  if (!matchInTitle) return res.status(400).json({ error: 'matchInTitle required' });

  let products;
  try {
    products = await fetchFeed();
  } catch (e) {
    return res.status(500).json({ error: 'Feed fetch failed: ' + e.message });
  }

  const matchRegex = new RegExp(escapeRegExp(matchInTitle), 'i');
  const matched = products.filter((p) => {
    const avail = (p.availability || '').toLowerCase();
    const inStock = !avail || avail === 'in stock' || avail === 'in_stock';
    return inStock && matchRegex.test(p.title);
  });

  // Transformations
  const samples = matched.slice(0, 3).map((p) => {
    let after = p.title;
    let appliedReplace = false;
    if (searchInTitle && replaceWith) {
      const before = after;
      after = after.replace(new RegExp(escapeRegExp(searchInTitle), 'i'), replaceWith);
      appliedReplace = before !== after;
      after = wordCapitalize(after);
    }
    return {
      id: p.id,
      before: p.title,
      after,
      applied_replace: appliedReplace,
    };
  });

  // Validators
  const validators = [];
  validators.push(...validateReplaceField(replaceWith || ''));
  if (samples[0]) {
    validators.push(...validateProposedTitle(samples[0].after));
  }
  if (searchInTitle && replaceWith && samples.length > 0 && !samples[0].applied_replace) {
    validators.push({
      level: 'warning',
      code: 'SEARCH_NOT_FOUND_IN_MATCH',
      message: `"${searchInTitle}" nie znaleziono w pierwszym matched produkcie — replace nie zadziała`,
    });
  }
  if (matched.length === 0) {
    validators.push({
      level: 'warning',
      code: 'ZERO_MATCH',
      message: `Brak produktów matchujących "${matchInTitle}" w aktywnym feedzie`,
    });
  }

  // Conflict detection — overlap with other rules
  let conflict = null;
  if (Array.isArray(otherRules)) {
    for (const other of otherRules) {
      if (other.id === ruleId) continue; // skip self
      if (!other.active) continue;
      if (!other.matchInTitle) continue;
      try {
        const otherRegex = new RegExp(escapeRegExp(other.matchInTitle), 'i');
        const overlap = matched.filter((p) => otherRegex.test(p.title));
        if (overlap.length > 0) {
          conflict = {
            level: 'warning',
            code: 'RULE_OVERLAP',
            other_rule_id: other.id,
            overlap_count: overlap.length,
            message: `Nakłada się z regułą "${other.id}" (${other.dupSuffix || ''}) — ${overlap.length} produktów dostanie 2 duplikaty`,
          };
          break;
        }
      } catch {}
    }
  }
  if (conflict) validators.push(conflict);

  // Dup suffix conflict
  if (dupSuffix && Array.isArray(otherRules)) {
    const dupSuffixConflict = otherRules.find((r) => r.id !== ruleId && r.dupSuffix === dupSuffix);
    if (dupSuffixConflict) {
      validators.push({
        level: 'error',
        code: 'SUFFIX_DUPLICATE',
        message: `Sufiks "${dupSuffix}" już istnieje w regule "${dupSuffixConflict.id}"`,
      });
    }
  }

  res.setHeader('Cache-Control', 'no-store');
  return res.status(200).json({
    matched_count: matched.length,
    total_products: products.length,
    samples,
    validators,
    conflict,
  });
}
