// /api/rules/[id]
// - PATCH: edit / toggle existing rule. Body shapes:
//     { action: 'toggle' }                          — flip active boolean
//     { action: 'set_active', active: true|false }  — explicit
//     { action: 'edit', changes: { matchInTitle?, searchInTitle?, replaceWith?, dupSuffix?, notes? } }
// - DELETE: remove rule from config.json
//
// Race-safety: GET config + SHA → mutate → PUT with If-Match.
// On 409 (ETag mismatch): retry up to 3× with fresh fetch.
//
// RULE #0 SAFETY: this is a write to production config.json. The cron will pick
// up changes within 1h. To make change visible faster, also bumps a noop field
// (config.json "_comment_lastChange") which triggers regenerate-feed.yml via
// push event (paths: config.json).

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
        const details = await putResp.json().catch(() => ({}));
        return {
          status: 403,
          json: {
            error: 'GITHUB_TOKEN w Vercel ma tylko Contents:Read — potrzebuję Contents:Read+Write żeby zapisać zmianę reguły.',
            github_message: details.message,
            fix: {
              step_1: 'Wygeneruj nowy fine-grained PAT: https://github.com/settings/personal-access-tokens/new',
              step_2: 'Repository: marketinghacker/room99-feed-duplicator',
              step_3: 'Permissions: Contents R/W + Issues R/W + Actions R/W + Metadata Read',
              step_4: 'Update GITHUB_TOKEN w Vercel: https://vercel.com/marketinghacker/room99-feed-admin/settings/environment-variables',
              step_5: 'Redeploy: Deployments → najnowszy → ⋮ → Redeploy',
            },
          },
        };
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

  if (req.method === 'PATCH') {
    const body = req.body || {};
    const action = body.action;

    if (action === 'toggle' || action === 'set_active') {
      const result = await mutateAndCommit(
        (rules, idx) => {
          const current = rules[idx].active === true;
          rules[idx].active = action === 'set_active' ? !!body.active : !current;
          return null;
        },
        `chore(rules): toggle ${id} via admin panel`
      );
      return res.status(result.status).json(result.json);
    }

    if (action === 'edit') {
      const changes = body.changes || {};
      const allowedFields = ['matchInTitle', 'searchInTitle', 'replaceWith', 'dupSuffix', 'notes', 'active'];
      const filteredChanges = {};
      for (const key of allowedFields) {
        if (changes[key] !== undefined) filteredChanges[key] = changes[key];
      }

      const result = await mutateAndCommit(
        (rules, idx, config) => {
          // Validation: dupSuffix uniqueness
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
          // Validation: non-empty for required strings
          for (const key of ['matchInTitle', 'searchInTitle', 'replaceWith']) {
            if (filteredChanges[key] !== undefined && !String(filteredChanges[key]).trim()) {
              return { validationError: `${key} cannot be empty` };
            }
          }

          // Apply
          for (const [k, v] of Object.entries(filteredChanges)) {
            rules[idx][k] = v;
          }
          rules[idx].updated_at = new Date().toISOString();
          // Mirror customLabel1 to dupSuffix if convention holds
          if (filteredChanges.dupSuffix && (!rules[idx].customLabel1 || rules[idx].customLabel1 === rules[idx].dupSuffix)) {
            rules[idx].customLabel1 = filteredChanges.dupSuffix;
          }
          return null;
        },
        `chore(rules): edit ${id} via admin panel (${Object.keys(filteredChanges).join(', ')})`
      );
      return res.status(result.status).json(result.json);
    }

    return res.status(400).json({ error: 'Unknown action. Use "toggle", "set_active", or "edit".' });
  }

  if (req.method === 'DELETE') {
    const result = await mutateAndCommit(
      (rules, idx, config) => {
        rules.splice(idx, 1);
        return null;
      },
      `chore(rules): delete ${id} via admin panel`
    );
    return res.status(result.status).json(result.json);
  }

  res.setHeader('Allow', 'PATCH, DELETE');
  return res.status(405).json({ error: 'Method not allowed' });
}
