// Vercel Serverless Function
// POST /api/add-variant
// Body: { matchInTitle, searchInTitle, replaceWith, dupSuffix, notes }
// → tworzy GitHub Issue z labelem 'new-variant' w repo
// Handler workflow w repo przetwarza issue i dodaje regulę do config.json

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const { matchInTitle, searchInTitle, replaceWith, dupSuffix, notes } = req.body || {};

  // Validation
  if (!matchInTitle || !searchInTitle || !replaceWith || !dupSuffix) {
    return res.status(400).json({ error: 'Brakuje wymaganego pola' });
  }
  if (!/^[a-z0-9]+$/.test(dupSuffix)) {
    return res.status(400).json({ error: 'Sufiks może zawierać tylko małe litery i cyfry' });
  }

  // Read env vars
  const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
  const GITHUB_OWNER = process.env.GITHUB_OWNER;
  const GITHUB_REPO = process.env.GITHUB_REPO || 'room99-feed-duplicator';

  if (!GITHUB_TOKEN || !GITHUB_OWNER) {
    return res.status(500).json({ error: 'Brakuje GITHUB_TOKEN lub GITHUB_OWNER w env vars Vercel' });
  }

  // Build issue body w formacie ktory parsuje handler-workflow
  // UWAGA: labels MUSZA byc identyczne z dodaj-wariant.yml issue template i regex w handle-new-variant-issue.yml
  const issueBody = `### Grupa produktow

${matchInTitle}

### Szukaj w tytule

${searchInTitle}

### Zastap przez

${replaceWith}

### Sufiks ID

${dupSuffix}

### Notatka

${notes || '_No response_'}
`;

  // Call GitHub Issues API
  try {
    const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_OWNER}/${GITHUB_REPO}/issues`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${GITHUB_TOKEN}`,
        'Accept': 'application/vnd.github+json',
        'Content-Type': 'application/json',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      body: JSON.stringify({
        title: `[WARIANT] ${replaceWith} (${dupSuffix})`,
        body: issueBody,
        labels: ['new-variant']
      })
    });

    const ghJson = await ghRes.json();

    if (!ghRes.ok) {
      console.error('GitHub API error:', ghJson);
      return res.status(500).json({ error: ghJson.message || 'GitHub API error', details: ghJson });
    }

    return res.status(200).json({
      success: true,
      issueNumber: ghJson.number,
      url: ghJson.html_url
    });
  } catch (e) {
    console.error('Error:', e);
    return res.status(500).json({ error: e.message });
  }
}
