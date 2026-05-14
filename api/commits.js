// GET /api/commits?path=config.json&per_page=30
// Returns recent commits on a path in room99-feed-duplicator.
// Read-only. Used by History section to show real timeline.

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

  const path = (req.query.path || 'config.json').toString();
  const perPage = Math.min(100, Math.max(1, parseInt(req.query.per_page, 10) || 30));

  try {
    const r = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${repo}/commits?path=${encodeURIComponent(path)}&per_page=${perPage}`,
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
    const commits = await r.json();
    const summary = commits.map((c) => ({
      sha: c.sha,
      short_sha: c.sha.substring(0, 7),
      message: c.commit.message,
      message_first_line: c.commit.message.split('\n')[0],
      author: c.commit.author?.name || c.commit.author?.email || 'unknown',
      timestamp: c.commit.author?.date,
      html_url: c.html_url,
    }));

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({ path, commits: summary });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
