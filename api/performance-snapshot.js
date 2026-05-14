// GET /api/performance-snapshot — Returns the cached Google Ads performance snapshot
// from /data/snapshot.json. Read-only. Cache 60s edge-side.
//
// The snapshot is currently refreshed manually (committed to repo by Claude via
// MCP queries). Next iteration: scheduled Vercel Cron job that calls Google Ads
// API directly (requires OAuth setup with Ads developer token + refresh token).

import fs from 'node:fs';
import path from 'node:path';

let _cached = null;
let _cachedAt = 0;
const CACHE_TTL_MS = 60 * 1000;

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    if (_cached && Date.now() - _cachedAt < CACHE_TTL_MS) {
      res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
      return res.status(200).json(_cached);
    }

    // Vercel bundles /data files into deployment
    const snapshotPath = path.join(process.cwd(), 'data', 'snapshot.json');
    let raw;
    try {
      raw = fs.readFileSync(snapshotPath, 'utf8');
    } catch (e) {
      // Fallback: try public dir
      try {
        raw = fs.readFileSync(path.join(process.cwd(), 'public', 'snapshot.json'), 'utf8');
      } catch (e2) {
        return res.status(404).json({
          error: 'Snapshot not found in /data/snapshot.json or /public/snapshot.json',
          tried_paths: [snapshotPath, path.join(process.cwd(), 'public', 'snapshot.json')],
          message: e.message,
        });
      }
    }
    const data = JSON.parse(raw);
    _cached = data;
    _cachedAt = Date.now();

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json(data);
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
