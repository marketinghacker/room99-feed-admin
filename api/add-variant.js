// POST /api/add-variant — Tworzy nowy test (rule) w config.json
//
// Body: {
//   testType: "title" | "description" | "both",  // optional, default "title"
//   matchInTitle, searchInTitle, replaceWith,
//   descriptionOverride?,   // optional full description override
//   dupSuffix, notes
// }
//
// Strategy:
//   1) PRIMARY: direct PATCH on config.json (race-safe via SHA)
//   2) FALLBACK: on 403, create Issue with rule-action label + action="create"
//      (handle-rule-action-issue.yml processes it with full-scope GITHUB_TOKEN)

import { createRuleActionIssue } from './_lib/issue-fallback.js';

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

function buildNewRule(input) {
  const testType = input.testType || 'title';
  const rule = {
    id: `panel-${input.dupSuffix}-${Date.now()}`,
    testType,
    matchInTitle: input.matchInTitle,
    searchInTitle: input.searchInTitle,
    replaceWith: input.replaceWith,
    dupSuffix: input.dupSuffix,
    customLabel1: input.dupSuffix,
    active: true,
    notes: input.notes || `Dodane przez panel ${new Date().toISOString().slice(0, 10)}`,
    created_at: new Date().toISOString(),
  };
  if (input.descriptionOverride && String(input.descriptionOverride).trim()) {
    rule.descriptionOverride = String(input.descriptionOverride).slice(0, 4950);
  }
  return rule;
}

function validateInput(input) {
  const testType = input.testType || 'title';
  if (!['title', 'description', 'both'].includes(testType)) {
    return `testType must be one of: title, description, both (got "${testType}")`;
  }
  if (!input.matchInTitle || !input.dupSuffix) {
    return 'matchInTitle i dupSuffix są wymagane';
  }
  if (!/^[a-z0-9]+$/.test(input.dupSuffix)) {
    return 'dupSuffix może zawierać tylko małe litery i cyfry';
  }
  // For title/both: searchInTitle + replaceWith required
  if (testType === 'title' || testType === 'both') {
    if (!input.searchInTitle || !input.replaceWith) {
      return 'Test typu „tytuł" wymaga searchInTitle i replaceWith';
    }
  }
  // For description: must have either (searchInTitle + replaceWith) OR descriptionOverride
  if (testType === 'description') {
    const hasSearchReplace = input.searchInTitle && input.replaceWith;
    const hasOverride = input.descriptionOverride && String(input.descriptionOverride).trim();
    if (!hasSearchReplace && !hasOverride) {
      return 'Test typu „opis" wymaga albo searchInTitle+replaceWith, albo descriptionOverride';
    }
  }
  if (input.descriptionOverride && String(input.descriptionOverride).length > 4950) {
    return `descriptionOverride przekracza 4950 znaków (${input.descriptionOverride.length}) — limit Google PLA to 5000`;
  }
  return null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const input = req.body || {};
  const validationError = validateInput(input);
  if (validationError) {
    return res.status(400).json({ error: validationError });
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
    'Content-Type': 'application/json',
  };

  const newRule = buildNewRule(input);

  // Try direct PATCH first (3× retry on 409)
  let attempt = 0;
  while (attempt < 3) {
    attempt++;
    let configResult;
    try {
      configResult = await fetchConfigWithSha(ghHeaders, GITHUB_OWNER, repo);
    } catch (e) {
      return res.status(e.status || 500).json({ error: 'Read failed', details: e.details || e.message });
    }
    const { config, sha } = configResult;
    const rules = config[RULES_KEY] || [];

    // Collision check
    const dupCollision = rules.find((r) => r.dupSuffix === newRule.dupSuffix);
    if (dupCollision) {
      return res.status(409).json({
        error: `dupSuffix "${newRule.dupSuffix}" już istnieje w teście "${dupCollision.id}". Wybierz inny kod (np. ${newRule.dupSuffix}b lub t${rules.length + 1}).`,
      });
    }

    rules.push(newRule);
    config[RULES_KEY] = rules;

    const message = `feat: add variant ${newRule.dupSuffix} (${newRule.testType}) via admin panel`;
    const putResp = await putConfig(ghHeaders, GITHUB_OWNER, repo, config, sha, message);

    if (putResp.status === 409) {
      continue; // retry on SHA mismatch
    }
    if (putResp.status === 403) {
      // Fallback to Issue creation
      const issueResult = await createRuleActionIssue({
        ghHeaders,
        owner: GITHUB_OWNER,
        repo,
        action: 'create',
        // Use `ruleData` key — matches handle-rule-action-issue.yml expected schema
        payload: { action: 'create', ruleData: newRule },
        title: `[ACTION] create rule ${newRule.dupSuffix} (${newRule.testType})`,
      });
      if (issueResult.ok) {
        return res.status(202).json({
          success: true,
          method: 'issue_fallback',
          rule: newRule,
          issue_number: issueResult.issue_number,
          issue_url: issueResult.issue_url,
          url: issueResult.issue_url,
          message: `Nowy test zapisany w bezpiecznej kolejce (Issue #${issueResult.issue_number}). Wjedzie do sklepu w ciągu minuty.`,
        });
      }
      return res.status(issueResult.status || 500).json({
        error: 'Direct write blocked + Issue fallback failed',
        issue_error: issueResult.error,
      });
    }
    if (!putResp.ok) {
      const details = await putResp.json().catch(() => ({}));
      return res.status(putResp.status).json({ error: 'Write failed', details });
    }
    const putJson = await putResp.json();
    return res.status(200).json({
      success: true,
      method: 'direct',
      rule: newRule,
      new_sha: putJson.commit.sha,
      commit_url: putJson.commit.html_url,
      url: putJson.commit.html_url,
      message,
    });
  }

  return res.status(409).json({ error: 'Conflict — repeated SHA mismatch after 3 attempts. Try again.' });
}
