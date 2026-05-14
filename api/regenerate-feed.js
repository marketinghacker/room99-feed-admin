// POST /api/regenerate-feed — Manually trigger the regenerate-feed.yml workflow
// in room99-feed-duplicator instead of waiting for the hourly cron.
// Uses GitHub Actions workflow_dispatch (already configured in the workflow file).
// Safe operation: workflow_dispatch is the same code path as the cron — no risk
// of breaking the live feed beyond what the cron itself can break.

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { GITHUB_TOKEN, GITHUB_OWNER } = process.env;
  const repo = process.env.GITHUB_REPO || 'room99-feed-duplicator';

  if (!GITHUB_TOKEN || !GITHUB_OWNER) {
    return res.status(500).json({ error: 'Missing GITHUB_TOKEN or GITHUB_OWNER env var' });
  }

  try {
    const r = await fetch(
      `https://api.github.com/repos/${GITHUB_OWNER}/${repo}/actions/workflows/regenerate-feed.yml/dispatches`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${GITHUB_TOKEN}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ref: 'main' }),
      }
    );

    // GitHub returns 204 No Content on successful dispatch
    if (r.status !== 204) {
      const details = await r.json().catch(() => ({ message: r.statusText }));
      return res.status(r.status).json({
        error: details.message || 'GitHub API error',
        details,
      });
    }

    return res.status(200).json({
      success: true,
      message: 'Workflow dispatched. New run should appear in ~5–10s.',
      workflow: 'regenerate-feed.yml',
      ref: 'main',
      dispatched_at: new Date().toISOString(),
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
