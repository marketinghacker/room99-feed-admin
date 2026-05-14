// /api/rules/[id]
// - PATCH: edit / toggle existing rule. Body shapes:
//     { action: 'toggle' }                          — flip active boolean
//     { action: 'set_active', active: true|false }  — explicit
//     { action: 'edit', changes: { matchInTitle?, searchInTitle?, replaceWith?, dupSuffix?, notes? } }
// - DELETE: remove rule from config.json
//
// TWO-TIER STRATEGY (auto-fallback):
//   1. PRIMARY: direct PUT on config.json (needs Contents:R/W).
//      Race-safe via GET+SHA → PUT If-Match. 3× retry on 409.
//   2. FALLBACK: on 403, create a GitHub Issue with label 'rule-action'.
//      The workflow handle-rule-action-issue.yml processes it with its
//      own (full-scope) GITHUB_TOKEN. Same end-state, +1 commit delay ~30s.

import { createRuleActionIssue } from '../_lib/issue-fallback.js';

const RULES_KEY = 'duplicateRules';

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
  const r = await fetch(
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
  return r;
}

export default async function handler(req, res) {
  const id = req.query.id;
  if (!id) return res.status(400).json({ error: 'Missing rule id' });

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

  // Apply mutation function with retry on 409
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
      const rules = config[RULES_KEY] || [];
      const idx = rules.findIndex((r) => r.id === id);
      if (idx === -1) {
        return { status: 404, json: { error: `Rule "${id}" not found` } };
      }
      let mutationResult;
      try {
        mutationResult = mutateFn(rules, idx, config);
      } catch (e) {
        return { status: 400, json: { error: e.message } };
      }
      if (mutationResult && mutationResult.validationError) {
        return { status: 400, json: { error: mutationResult.validationError } };
      }

      const putResp = await putConfig(ghHeaders, GITHUB_OWNER, repo, config, sha, message);
      if (putResp.status === 409) {
        // SHA mismatch — retry
        continue;
      }
      if (putResp.status === 403) {
        // Direct PUT failed — token lacks Contents:Write. Try Issue fallback.
        return { _try_issue_fallback: true };
      }
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
          rule: rules[idx],
          message,
        },
      };
    }
    return { status: 409, json: { error: 'Conflict — repeated SHA mismatch after 3 attempts. Try again.' } };
  }

  // Helper: try direct mutate, on 403 fallback to Issue API
  async function tryWriteOrIssueFallback(directFn, issuePayload, title) {
    const result = await directFn();
    if (result._try_issue_fallback) {
      // Fall back to creating an Issue with rule-action label
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
            message: `Direct write blocked by token scope — queued via Issue #${issueResult.issue_number}. Workflow będzie apply w ~30s, feed regeneruje w ≤1h.`,
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
      const issuePayload = action === 'set_active'
        ? { action: 'set_active', ruleId: id, active: !!body.active }
        : { action: 'toggle', ruleId: id };

      const result = await tryWriteOrIssueFallback(
        () => mutateAndCommit(
          (rules, idx) => {
            const current = rules[idx].active === true;
            rules[idx].active = action === 'set_active' ? !!body.active : !current;
            return null;
          },
          `chore(rules): toggle ${id} via admin panel`
        ),
        issuePayload,
        `[ACTION] toggle ${id}`
      );
      return res.status(result.status).json(result.json);
    }

    if (action === 'edit') {
      const changes = body.changes || {};
      const allowedFields = ['matchInTitle', 'searchInTitle', 'replaceWith', 'dupSuffix', 'notes', 'active', 'testType', 'descriptionOverride'];
      const filteredChanges = {};
      for (const key of allowedFields) {
        if (changes[key] !== undefined) filteredChanges[key] = changes[key];
      }

      const result = await tryWriteOrIssueFallback(
        () => mutateAndCommit(
          (rules, idx, config) => {
            if (filteredChanges.dupSuffix && filteredChanges.dupSuffix !== rules[idx].dupSuffix) {
              const dupSuffix = String(filteredChanges.dupSuffix).trim();
              if (!/^[a-z0-9]+$/.test(dupSuffix)) {
                return { validationError: 'dupSuffix must be lowercase letters/digits only' };
              }
              const collision = rules.find((r, j) => j !== idx && r.dupSuffix === dupSuffix);
              if (collision) {
                return { validationError: `dupSuffix "${dupSuffix}" already used in rule "${collision.id}"` };
              }
            }
            // testType validation
            if (filteredChanges.testType !== undefined) {
              const tt = filteredChanges.testType;
              if (!['title', 'description', 'both'].includes(tt)) {
                return { validationError: `testType must be one of: title, description, both (got "${tt}")` };
              }
            }
            // descriptionOverride length check
            if (filteredChanges.descriptionOverride && filteredChanges.descriptionOverride.length > 4950) {
              return { validationError: `descriptionOverride exceeds 4950 chars (got ${filteredChanges.descriptionOverride.length}) — Google PLA limit is 5000` };
            }
            // For title-type tests, searchInTitle and replaceWith must be non-empty
            const effectiveTestType = filteredChanges.testType !== undefined ? filteredChanges.testType : (rules[idx].testType || 'title');
            for (const key of ['matchInTitle', 'searchInTitle', 'replaceWith']) {
              if (filteredChanges[key] !== undefined && !String(filteredChanges[key]).trim()) {
                // For description-only test, searchInTitle/replaceWith MAY be empty if descriptionOverride is present
                if (effectiveTestType === 'description' && (key === 'searchInTitle' || key === 'replaceWith')) {
                  const hasOverride = (filteredChanges.descriptionOverride !== undefined ? filteredChanges.descriptionOverride : rules[idx].descriptionOverride);
                  if (hasOverride) continue; // OK — full override means search/replace not needed
                }
                return { validationError: `${key} cannot be empty` };
              }
            }
            for (const [k, v] of Object.entries(filteredChanges)) {
              // Treat empty descriptionOverride as removal
              if (k === 'descriptionOverride' && (!v || !String(v).trim())) {
                delete rules[idx].descriptionOverride;
              } else {
                rules[idx][k] = v;
              }
            }
            rules[idx].updated_at = new Date().toISOString();
            if (filteredChanges.dupSuffix && (!rules[idx].customLabel1 || rules[idx].customLabel1 === rules[idx].dupSuffix)) {
              rules[idx].customLabel1 = filteredChanges.dupSuffix;
            }
            return null;
          },
          `chore(rules): edit ${id} via admin panel (${Object.keys(filteredChanges).join(', ')})`
        ),
        { action: 'edit', ruleId: id, changes: filteredChanges },
        `[ACTION] edit ${id} (${Object.keys(filteredChanges).join(', ')})`
      );
      return res.status(result.status).json(result.json);
    }

    return res.status(400).json({ error: 'Unknown action. Use "toggle", "set_active", or "edit".' });
  }

  if (req.method === 'DELETE') {
    const result = await tryWriteOrIssueFallback(
      () => mutateAndCommit(
        (rules, idx, config) => {
          rules.splice(idx, 1);
          return null;
        },
        `chore(rules): delete ${id} via admin panel`
      ),
      { action: 'delete', ruleId: id },
      `[ACTION] delete ${id}`
    );
    return res.status(result.status).json(result.json);
  }

  res.setHeader('Allow', 'PATCH, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
