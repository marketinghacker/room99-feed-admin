// Shared helper: when a direct write to feed-duplicator config.json fails
// with 403 (PAT scope insufficient), fall back to creating a GitHub Issue
// with label `rule-action`. The `handle-rule-action-issue.yml` workflow
// in feed-duplicator processes the issue, applies changes via its own
// built-in GITHUB_TOKEN (full repo scope), commits, and closes the issue.
//
// This unblocks Marcin: the Vercel-side PAT can stay with minimum scopes
// (Contents:R + Issues:R/W); writes go through workflow privilege.

export async function createRuleActionIssue({ ghHeaders, owner, repo, action, payload, title }) {
  const issueBody = `Auto-created by Room99 Feed Command Center.

Action: \`${action}\`

\`\`\`json
${JSON.stringify(payload, null, 2)}
\`\`\`

This issue is processed by \`.github/workflows/handle-rule-action-issue.yml\`.`;

  const r = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/issues`,
    {
      method: 'POST',
      headers: ghHeaders,
      body: JSON.stringify({
        title: title || `[ACTION] ${action}`,
        body: issueBody,
        labels: ['rule-action'],
      }),
    }
  );
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
    return { ok: false, status: r.status, error: j.message || 'Issue create failed', details: j };
  }
  return {
    ok: true,
    method: 'issue_fallback',
    issue_number: j.number,
    issue_url: j.html_url,
  };
}
