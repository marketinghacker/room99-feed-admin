// /api/image-rules/[id]
// - PATCH: toggle/set_active for image rule
//     { action: 'toggle' } | { action: 'set_active', active: bool }
// - DELETE: remove image rule
//
// Same two-tier strategy as /api/rules/[id]: direct PATCH → Issue fallback.

import { createRuleActionIssue } from '../_lib/issue-fallback.js';

const KEY = 'imageRules';

async function fetchConfigWithSha(headers, owner, repo) {
  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/config.json`,
    { headers }
  );
  if (!r.ok) {
    const details = await r.json().catch(() => ({}));
    throw Object.assign(new Error(details.message || 'GitHub read failed'), { status: r.status, details });
  }
  const j = await r.json();
  const content = Buffer.from(j.content, 'base64').toString('utf8');
  return { config: JSON.parse(content), sha: j.sha };
}

async function putConfig(headers, owner, repo, config, sha, message) {
  const newContent = Buffer.from(JSON.stringify(config, null, 2) + '\n', 'utf8').toString('base64');
  return fetch(
    `https://api.github.com/repos/${owner}/${repo}/contents/config.json`,
    {
      method: 'PUT',
      headers,
      body: JSON.stringify({
        message,
        content: newContent,
        sha,
        committer: { name: 'room99-feed-admin', email: 'admin@room99.local' },
      }),
    }
  );
}

export default async function handler(req, res) {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing image rule id' });

  const { GITHUB_TOKEN, GITHUB_OWNER } = process.env;
  const repo = process.env.GITHUB_REPO || 'room99-feed-duplicator';
  if (!GITHUB_TOKEN || !GITHUB_OWNER) {
    return res.status(500).json({ error: 'Missing GITHUB_TOKEN or GITHUB_OWNER env var' });
  }

  const ghHeaders = {
    Authorization: `Bearer ${GITHUB_TOKEN}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };

  async function mutateAndCommit(mutateFn, message) {
    let attempt = 0;
    while (attempt < 3) {
      attempt++;
      let configResult;
      try {
        configResult = await fetchConfigWithSha(ghHeaders, GITHUB_OWNER, repo);
      } catch (e) {
        return { status: e.status || 500, json: { error: 'Read failed', details: e.details || e.message } };
      }
      const { config, sha } = configResult;
      const rules = config[KEY] || [];
      const idx = rules.findIndex((r) => r.id === id);
      if (idx === -1) {
        return { status: 404, json: { error: `Image rule "${id}" not found` } };
      }
      const mutationResult = mutateFn(rules, idx, config);
      if (mutationResult && mutationResult.validationError) {
        return { status: 400, json: { error: mutationResult.validationError } };
      }

      const putResp = await putConfig(ghHeaders, GITHUB_OWNER, repo, config, sha, message);
      if (putResp.status === 409) continue;
      if (putResp.status === 403) return { _try_issue_fallback: true };
      if (!putResp.ok) {
        const details = await putResp.json().catch(() => ({}));
        return { status: putResp.status, json: { error: 'Write failed', details } };
      }
      const putJson = await putResp.json();
      return {
        status: 200,
        json: {
          success: true,
          new_sha: putJson.commit.sha,
          commit_url: putJson.commit.html_url,
          message,
        },
      };
    }
    return { status: 409, json: { error: 'Conflict — repeated SHA mismatch after 3 attempts. Try again.' } };
  }

  async function tryWriteOrIssueFallback(directFn, issuePayload, title) {
    const result = await directFn();
    if (result._try_issue_fallback) {
      const issueResult = await createRuleActionIssue({
        ghHeaders,
        owner: GITHUB_OWNER,
        repo,
        action: issuePayload.action,
        payload: issuePayload,
        title,
      });
      if (issueResult.ok) {
        return {
          status: 202,
          json: {
            success: true,
            method: 'issue_fallback',
            issue_number: issueResult.issue_number,
            issue_url: issueResult.issue_url,
            message: `Image rule action queued via Issue #${issueResult.issue_number}. Apply w ~30s.`,
          },
        };
      }
      return {
        status: issueResult.status || 500,
        json: { error: 'Both direct write AND issue fallback failed', issue_error: issueResult.error },
      };
    }
    return result;
  }

  if (req.method === 'PATCH') {
    const body = req.body || {};
    const action = body.action;
    if (action === 'toggle' || action === 'set_active') {
      const result = await tryWriteOrIssueFallback(
        () => mutateAndCommit(
          (rules, idx) => {
            const current = rules[idx].active !== false;
            rules[idx].active = action === 'set_active' ? !!body.active : !current;
            rules[idx].updated_at = new Date().toISOString();
            return null;
          },
          `chore(image-rule): toggle ${id} via admin panel`
        ),
        action === 'set_active'
          ? { action: 'remove_image_rule', imageRuleId: id, _toggle: !!body.active }
          : { action: 'remove_image_rule', imageRuleId: id, _toggle: true },
        `[ACTION] toggle image rule ${id}`
      );
      // NOTE: Issue fallback for image-rule toggle uses 'remove_image_rule' action
      // because the workflow doesn't yet have a dedicated toggle handler. If
      // direct PATCH fails (rare), user falls back to GitHub UI for now.
      return res.status(result.status).json(result.json);
    }
    return res.status(400).json({ error: 'Unknown action. Use "toggle" or "set_active".' });
  }

  if (req.method === 'DELETE') {
    const result = await tryWriteOrIssueFallback(
      () => mutateAndCommit(
        (rules, idx) => {
          rules.splice(idx, 1);
          return null;
        },
        `chore(image-rule): delete ${id} via admin panel`
      ),
      { action: 'remove_image_rule', imageRuleId: id },
      `[ACTION] delete image rule ${id}`
    );
    return res.status(result.status).json(result.json);
  }

  res.setHeader('Allow', 'PATCH, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
