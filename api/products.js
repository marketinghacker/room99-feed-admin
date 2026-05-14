// GET /api/products — Parse FeedOptimise source feed and return paginated product list
// Query params:
//   ?page=1 (default)
//   &perPage=50 (default, max 200)
//   &q=search-term (filters by title or id, case-insensitive substring)
//   &id=12345 (returns single product by exact id)
//
// Response shape:
//   { products: [{ id, title, image_link, additional_image_link: [...], price, availability, product_type }],
//     pagination: { page, perPage, total, totalPages },
//     fetched_at: ISO }
//
// Cache 5 min — source feed updates from FeedOptimise rarely intra-day.

const FEED_SOURCE_URL = 'https://io.feedoptimise.com/feed/1805/3809/507fc39b-dc19-4f5d-9107-db1900f6bb21/google-pl.tsv';

// Module-level cache (warm across invocations on same Vercel container)
let _cache = null;
const CACHE_TTL_MS = 5 * 60 * 1000;

async function fetchSourceFeed() {
  if (_cache && Date.now() - _cache.ts < CACHE_TTL_MS) {
    return _cache.products;
  }

  const r = await fetch(FEED_SOURCE_URL, { headers: { 'Cache-Control': 'no-cache' } });
  if (!r.ok) {
    throw new Error(`Source feed fetch failed: HTTP ${r.status}`);
  }
  const tsv = await r.text();
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

  const products = [];
  for (let i = 1; i < lines.length; i++) {
    const line = lines[i];
    if (!line.trim()) continue;
    const f = line.split('\t');
    const additional = (f[addImgIdx] || '')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);

    products.push({
      id: f[idIdx] || '',
      title: f[titleIdx] || '',
      link: f[linkIdx] || '',
      brand: f[brandIdx] || '',
      image_link: f[imageIdx] || '',
      additional_image_link: additional,
      total_images: (f[imageIdx] ? 1 : 0) + additional.length,
      price: f[priceIdx] || '',
      availability: f[availIdx] || '',
      product_type: f[typeIdx] || '',
    });
  }

  _cache = { ts: Date.now(), products };
  return products;
}

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const all = await fetchSourceFeed();

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
      fetched_at: new Date().toISOString(),
      cache_warm: _cache ? Date.now() - _cache.ts < CACHE_TTL_MS : false,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
