// POST /api/regenerate-feed — Manually trigger regenerate-feed.yml workflow.
// Three-tier strategy (auto-fallback):
//   1. PRIMARY: GitHub Actions workflow_dispatch API (needs PAT Actions:R/W)
//   2. FALLBACK A: touch config.json (bump `_lastTouched`) — triggers workflow
//      via push event (paths: config.json). Needs Contents:R/W.
//   3. FALLBACK B: create Issue with `rule-action` label + `regenerate_touch`
//      action — workflow `handle-rule-action-issue.yml` (with built-in
//      GITHUB_TOKEN at full scope) touches config.json. Needs only Issues:W.
//
// All three end-states are identical: cron-equivalent regen runs.

import { createRuleActionIssue } from './_lib/issue-fallback.js';

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

    // Both direct paths failed — try Issue fallback (only needs Issues:W)
    const issueResult = await createRuleActionIssue({
      ghHeaders: headers,
      owner: GITHUB_OWNER,
      repo,
      action: 'regenerate_touch',
      payload: { action: 'regenerate_touch' },
      title: `[ACTION] regenerate feed ${new Date().toISOString()}`,
    });
    if (issueResult.ok) {
      return res.status(202).json({
        success: true,
        method: 'issue_fallback',
        issue_number: issueResult.issue_number,
        issue_url: issueResult.issue_url,
        message: `Direct workflow_dispatch + config touch obie zablokowane przez token scope — queued via Issue #${issueResult.issue_number}. Workflow apply w ~30s, regen w ≤1h.`,
      });
    }

    return res.status(touch.status || 500).json({
      error: 'All three regenerate methods failed (dispatch, touch, issue). PAT may have no permissions at all.',
      workflow_dispatch: { status: dispatch.status, message: dispatch.details?.message },
      config_touch: { status: touch.status, message: touch.details?.message },
      issue_fallback: { status: issueResult.status, error: issueResult.error },
      fix: 'Verify GITHUB_TOKEN in Vercel has at minimum Issues:Write on room99-feed-duplicator.',
    });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
