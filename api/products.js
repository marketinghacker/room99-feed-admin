// GET /api/products — Parse feed source and return paginated product list
//
// Strategy:
//   1) Try FeedOptimise source (live, fastest, includes original feed)
//   2) On 429 / non-200 fall back to repo's output/google-pl-with-test-titles.tsv on raw.githubusercontent.com
//      (filtered output = base products + duplicate variants, refreshed every cron tick ≤1h old)
//   3) On both failures → return cached snapshot if any, else error
//
// Query params:
//   ?page=1 (default)
//   &perPage=50 (default, max 200)
//   &q=search-term (filters by title or id, case-insensitive substring)
//   &id=12345 (returns single product by exact id)
//
// Response shape:
//   { products: [{ id, title, image_link, additional_image_link: [...], price, availability, product_type, total_images }],
//     pagination: { page, perPage, total, totalPages },
//     source: "feedoptimise" | "github_fallback" | "stale_cache",
//     fetched_at: ISO }

const FEED_SOURCE_URL = 'https://io.feedoptimise.com/feed/1805/3809/507fc39b-dc19-4f5d-9107-db1900f6bb21/google-pl.tsv';
const FALLBACK_TSV_URL = 'https://raw.githubusercontent.com/marketinghacker/room99-feed-duplicator/main/output/google-pl-with-test-titles.tsv';

// Module-level cache (warm across invocations on same Vercel container)
let _cache = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

function parseTsv(tsv) {
  const lines = tsv.split(/\r?\n/);
  if (lines.length < 2) throw new Error('Empty feed');

  const headers = lines[0].split('\t');
  const col = (name) => headers.indexOf(name);
  const idIdx = col('id');
  const titleIdx = col('title');
  const linkIdx = col('link');
  const imageIdx = col('image_link');
  const addImgIdx = col('additional_image_link');
  const priceIdx = col('price');
  const availIdx = col('availability');
  const typeIdx = col('product_type');
  const brandIdx = col('brand');
  const descIdx = col('description');

  const products = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const f = line.split('\t');

    const main = (f[imageIdx] || '').trim();
    const additional = (f[addImgIdx] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean)
      .filter((url) => url !== main); // ← dedupe: don't show main image twice

    products.push({
      id: f[idIdx] || '',
      title: f[titleIdx] || '',
      link: f[linkIdx] || '',
      brand: f[brandIdx] || '',
      image_link: main,
      additional_image_link: additional,
      total_images: (main ? 1 : 0) + additional.length,
      price: f[priceIdx] || '',
      availability: f[availIdx] || '',
      product_type: f[typeIdx] || '',
      description: descIdx >= 0 ? (f[descIdx] || '') : '',
    });
  }
  return products;
}

async function fetchWithTimeout(url, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    return await fetch(url, {
      headers: {
        'Cache-Control': 'no-cache',
        'User-Agent': 'room99-feed-admin/1.1',
      },
      signal: ctrl.signal,
    });
  } finally {
    clearTimeout(timer);
  }
}

async function loadProducts() {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return { products: _cache.products, source: _cache.source };
  }

  // Try 1: FeedOptimise
  let foError = null;
  try {
    const r = await fetchWithTimeout(FEED_SOURCE_URL);
    if (r.ok) {
      const tsv = await r.text();
      const products = parseTsv(tsv);
      _cache = { ts: Date.now(), products, source: 'feedoptimise' };
      return { products, source: 'feedoptimise' };
    }
    foError = `HTTP ${r.status}`;
  } catch (e) {
    foError = e.message || 'fetch error';
  }

  // Try 2: GitHub raw output (filtered TSV — base + duplicates, refreshed by cron)
  let ghError = null;
  try {
    const r = await fetchWithTimeout(FALLBACK_TSV_URL);
    if (r.ok) {
      const tsv = await r.text();
      const products = parseTsv(tsv);
      _cache = { ts: Date.now(), products, source: 'github_fallback' };
      return { products, source: 'github_fallback', fo_error: foError };
    }
    ghError = `HTTP ${r.status}`;
  } catch (e) {
    ghError = e.message || 'fetch error';
  }

  // Try 3: stale cache as last resort (better stale than 500)
  if (_cache) {
    return { products: _cache.products, source: 'stale_cache', fo_error: foError, gh_error: ghError };
  }

  throw new Error(`Both sources failed. FO: ${foError}. GitHub: ${ghError}`);
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { products: all, source, fo_error, gh_error } = await loadProducts();

    const qRaw = (req.query.q || '').toString().trim().toLowerCase();
    const idExact = (req.query.id || '').toString().trim();

    let filtered = all;
    if (idExact) {
      filtered = all.filter((p) => p.id === idExact);
    } else if (qRaw) {
      filtered = all.filter(
        (p) => p.title.toLowerCase().includes(qRaw) || p.id === qRaw
      );
    }

    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const perPage = Math.min(200, Math.max(1, parseInt(req.query.perPage, 10) || 50));
    const start = (page - 1) * perPage;
    const slice = filtered.slice(start, start + perPage);

    res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');
    return res.status(200).json({
      products: slice,
      pagination: {
        page,
        perPage,
        total: filtered.length,
        totalPages: Math.ceil(filtered.length / perPage),
      },
      total_in_feed: all.length,
      source,
      ...(fo_error && { fo_error }),
      ...(gh_error && { gh_error }),
      fetched_at: new Date().toISOString(),
      cache_warm: _cache ? Date.now() - _cache.ts < CACHE_TTL_MS : false,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
