// GET /api/feed-stats — Derived statistics about feed health
// - Output TSV row count + size
// - Last config.json commit (sha, message, author, timestamp, url)
// - Last regenerate-feed workflow run (status, started/completed)
// All read-only. Cache 60s.

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

  const ghHeaders = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  try {
    const [outputResp, configCommitsResp, runsResp] = await Promise.all([
      fetch(
        `https://raw.githubusercontent.com/${GITHUB_OWNER}/${repo}/main/output/google-pl-with-test-titles.tsv`,
        { headers: { 'Cache-Control': 'no-cache' } }
      ),
      fetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${repo}/commits?path=config.json&per_page=1`,
        { headers: ghHeaders }
      ),
      fetch(
        `https://api.github.com/repos/${GITHUB_OWNER}/${repo}/actions/workflows/regenerate-feed.yml/runs?per_page=1`,
        { headers: ghHeaders }
      ),
    ]);

    let output = null;
    if (outputResp.ok) {
      const text = await outputResp.text();
      const lines = text.split('\n').filter((l) => l.trim());
      output = {
        total_rows: Math.max(0, lines.length - 1),
        size_bytes: text.length,
      };
    }

    let last_config_change = null;
    if (configCommitsResp.ok) {
      const commits = await configCommitsResp.json();
      const c = commits[0];
      if (c) {
        last_config_change = {
          sha: c.sha,
          short_sha: c.sha.substring(0, 7),
          message: c.commit.message.split('\n')[0],
          author: c.commit.author.name,
          timestamp: c.commit.author.date,
          html_url: c.html_url,
        };
      }
    }

    let last_cron_run = null;
    if (runsResp.ok) {
      const runs = await runsResp.json();
      const r = runs.workflow_runs?.[0];
      if (r) {
        last_cron_run = {
          status: r.status,
          conclusion: r.conclusion,
          started_at: r.run_started_at,
          completed_at: r.updated_at,
          run_number: r.run_number,
          html_url: r.html_url,
          trigger: r.event,
        };
      }
    }

    res.setHeader('Cache-Control', 's-maxage=60, stale-while-revalidate=300');
    return res.status(200).json({
      output,
      last_config_change,
      last_cron_run,
      fetched_at: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
