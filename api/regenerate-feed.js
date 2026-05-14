// POST /api/regenerate-feed — Manually trigger regenerate-feed.yml workflow.
// Two-tier strategy (auto-fallback):
//   1. PRIMARY: GitHub Actions workflow_dispatch API (needs PAT scope Actions:R/W)
//   2. FALLBACK: touch config.json (bump `_lastTouched` field) — triggers the
//      same workflow via push event (paths: config.json). Needs only Contents:R/W
//      which we already have for /api/rules/[id] writes.
//
// The fallback is identical end-state — generate-feed.js runs same code path,
// produces same TSV. The only difference is +1 commit in feed-duplicator history.

async function tryWorkflowDispatch(headers, owner, repo) {
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/regenerate-feed.yml/dispatches`,
    {
      method: 'POST',
      headers,
      body: JSON.stringify({ ref: 'main' }),
    }
  );
  if (r.status === 204) return { ok: true, method: 'workflow_dispatch' };
  const details = await r.json().catch(() => ({ message: r.statusText }));
  return { ok: false, status: r.status, details };
}

async function tryConfigTouch(headers, owner, repo) {
  // GET current config + SHA
  const getR = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/config.json`,
    { headers }
  );
  if (!getR.ok) {
    const details = await getR.json().catch(() => ({}));
    return { ok: false, status: getR.status, details };
  }
  const j = await getR.json();
  const content = Buffer.from(j.content, 'base64').toString('utf8');
  const config = JSON.parse(content);

  // Add/bump no-op field — does NOT impact generate-feed.js logic
  config._lastTouched = new Date().toISOString();
  config._lastTouchedBy = 'admin-regenerate';

  const newContent = Buffer.from(JSON.stringify(config, null, 2) + '\n', 'utf8').toString('base64');
  const putR = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/config.json`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `chore: manual regenerate trigger (touch config) ${new Date().toISOString()}`,
        content: newContent,
        sha: j.sha,
        committer: { name: 'room99-feed-admin', email: 'admin@room99.local' },
      }),
    }
  );
  if (!putR.ok) {
    const details = await putR.json().catch(() => ({}));
    return { ok: false, status: putR.status, details };
  }
  return { ok: true, method: 'config_touch' };
}

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

  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  try {
    // Try workflow_dispatch first
    const dispatch = await tryWorkflowDispatch(headers, GITHUB_OWNER, repo);
    if (dispatch.ok) {
      return res.status(200).json({
        success: true,
        method: 'workflow_dispatch',
        message: 'Workflow dispatched. New run should appear in ~5–10s.',
        dispatched_at: new Date().toISOString(),
      });
    }

    // Fallback: try config touch (works with Contents:R/W only)
    const touch = await tryConfigTouch(headers, GITHUB_OWNER, repo);
    if (touch.ok) {
      return res.status(200).json({
        success: true,
        method: 'config_touch',
        message: 'Token brak Actions scope — użyto fallback (touch config.json → push trigger). Workflow zaraz ruszy.',
        dispatched_at: new Date().toISOString(),
        note: 'Add Actions:R/W scope to PAT for direct workflow_dispatch (no extra commit).',
      });
    }

    // Both failed — return diagnostics
    return res.status(touch.status || 500).json({
      error: 'Both regenerate methods failed. Check PAT scope (need at least Contents:R/W).',
      workflow_dispatch: { status: dispatch.status, message: dispatch.details?.message },
      config_touch: { status: touch.status, message: touch.details?.message },
      fix: 'Update GITHUB_TOKEN in Vercel with permissions: Contents:R/W + Actions:R/W on room99-feed-duplicator → redeploy.',
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
