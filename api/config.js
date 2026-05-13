// GET /api/config — Read config.json from room99-feed-duplicator
// Returns: { config, sha, html_url }
// Caches 60s edge-side via Cache-Control.
// Read-only in Sprint 1. PUT will be added in Sprint 2 with ETag/If-Match.

export default async function handler(req, res) {
  if (req.method !== 'GET') {
    res.setHeader('Allow', 'GET');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { GITHUB_TOKEN, GITHUB_OWNER } = process.env;
  const repo = process.env.GITHUB_REPO || 'room99-feed-duplicator';

  if (!GITHUB_TOKEN || !GITHUB_OWNER) {
    return res.status(500).json({ error: 'Missing GITHUB_TOKEN or GITHUB_OWNER env var' });
  }

  try {
    const r = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${repo}/contents/config.json`,
      {
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      }
    );

    if (!r.ok) {
      const details = await r.json().catch(() => ({}));
      return res.status(r.status).json({ error: 'GitHub API error', details });
    }

    const j = await r.json();
    const content = Buffer.from(j.content, 'base64').toString('utf8');
    const config = JSON.parse(content);

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({
      config,
      sha: j.sha,
      html_url: j.html_url,
      size: j.size,
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
