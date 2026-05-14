// POST /api/image-rules — Add image rule (promote alternative image to main).
// Body: { offerId, promote_to_main_index, custom_image_url, dupSuffix, customLabel1, notes }
//
// Two-tier strategy (auto-fallback):
//   1. PRIMARY: direct PUT on config.json (needs Contents:R/W).
//   2. FALLBACK: GitHub Issue with `rule-action` label + `add_image_rule`
//      action — workflow processes it.

import { createRuleActionIssue } from './_lib/issue-fallback.js';

async function tryDirectImageRuleAdd(headers, owner, repo, imageRule) {
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/config.json`,
    { headers }
  );
  if (!r.ok) {
    const details = await r.json().catch(() => ({}));
    return { ok: false, status: r.status, error: details.message };
  }
  const j = await r.json();
  const config = JSON.parse(Buffer.from(j.content, 'base64').toString('utf8'));
  config.imageRules = config.imageRules || [];

  // Validate dupSuffix uniqueness across image rules
  if (config.imageRules.some((x) => x.dupSuffix === imageRule.dupSuffix)) {
    return { ok: false, status: 400, error: `Image rule dupSuffix "${imageRule.dupSuffix}" already exists` };
  }

  config.imageRules.push({ ...imageRule, created_at: new Date().toISOString(), active: true });

  const putR = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/config.json`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message: `chore(image-rule): add for offer ${imageRule.offerId} via admin panel`,
        content: Buffer.from(JSON.stringify(config, null, 2) + '\n', 'utf8').toString('base64'),
        sha: j.sha,
        committer: { name: 'room99-feed-admin', email: 'admin@room99.local' },
      }),
    }
  );
  if (putR.status === 403) return { ok: false, status: 403, error: 'PAT scope insufficient' };
  if (!putR.ok) {
    const details = await putR.json().catch(() => ({}));
    return { ok: false, status: putR.status, error: details.message };
  }
  const putJson = await putR.json();
  return { ok: true, method: 'direct', commit_url: putJson.commit?.html_url };
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

  const { offerId, promote_to_main_index, custom_image_url, dupSuffix, customLabel1, notes } = req.body || {};
  if (!offerId) return res.status(400).json({ error: 'offerId required' });
  if (promote_to_main_index === undefined && !custom_image_url) {
    return res.status(400).json({ error: 'either promote_to_main_index or custom_image_url required' });
  }
  if (!dupSuffix || !/^img_[a-z0-9]+$/.test(dupSuffix)) {
    return res.status(400).json({ error: 'dupSuffix must match /^img_[a-z0-9]+$/' });
  }

  const imageRule = {
    id: `img-${offerId}-${dupSuffix}`,
    offerId: String(offerId),
    promote_to_main_index: promote_to_main_index !== undefined ? parseInt(promote_to_main_index, 10) : null,
    custom_image_url: custom_image_url || null,
    dupSuffix,
    customLabel1: customLabel1 || dupSuffix,
    notes: notes || '',
  };

  const headers = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  const direct = await tryDirectImageRuleAdd(headers, GITHUB_OWNER, repo, imageRule);
  if (direct.ok) {
    return res.status(200).json({ success: true, method: 'direct', commit_url: direct.commit_url, imageRule });
  }

  if (direct.status === 403) {
    const issueResult = await createRuleActionIssue({
      ghHeaders: headers,
      owner: GITHUB_OWNER,
      repo,
      action: 'add_image_rule',
      payload: { action: 'add_image_rule', imageRule },
      title: `[ACTION] add image rule for offer ${offerId} (${dupSuffix})`,
    });
    if (issueResult.ok) {
      return res.status(202).json({
        success: true,
        method: 'issue_fallback',
        issue_number: issueResult.issue_number,
        issue_url: issueResult.issue_url,
        message: `Image rule queued via Issue #${issueResult.issue_number}. Workflow apply w ~30s, feed regen w ≤1h.`,
        imageRule,
      });
    }
  }

  return res.status(direct.status || 500).json({ error: direct.error || 'Image rule creation failed' });
}
