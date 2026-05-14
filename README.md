# Room99 Feed Command Center

> Dokument dla **AI agentów** rozbudowujących ten projekt (Claude Code, Cursor, ChatGPT). Czytaj uważnie — zawiera business context, deployment, security, sprint plan i sugestie rozbudowy.

> **Sprint 1 (2026-05-14, in progress):** rebuild z single-form mini app do **Command Center** z 7 sekcjami (Today, Rules, Hypotheses, Images, Performance, Feed Health, History) + legacy "+ Add Variant" form. Sprint 1 = **read-only**, zero writes do production.

---

## ⚠️ RULE #0 — DO NOT BREAK CURRENT GENERATION (NADRZĘDNA)

Output TSV `room99-feed-duplicator/output/google-pl-with-test-titles.tsv` feeduje live Google Shopping campaigns. Każda zmiana w `config.json` MUSI być additive, backwards-compatible, reversible. Pełny safety contract: zobacz `room99-feed-duplicator/README.md` + `/Users/marcinmichalski/.claude/plans/rippling-beaming-canyon.md`.

Sprint 1 nie zmienia nic w production — wszystkie nowe endpointy są GET-only, legacy `/api/add-variant` POST zostaje bez zmian.

---

## 1. CEL — co ta aplikacja robi

**Single source of truth dla optymalizacji feedu Room99.pl w Google Shopping (PLA + PMax).**

Marcin (Marketing Hackers agency) zarządza eksperymentami A/B/C/D/E tytułów (i — wkrótce — obrazków głównych) dla 1841 produktów Room99.pl. Cel: ROAS +15%, koszty klików -70% w 3 miesiące.

**Rozwiązanie:** SPA na Vercel z 7 sekcjami nawigacyjnymi (hash router, vanilla JS, zero build step). Backend = GitHub `config.json` w repo `room99-feed-duplicator` (single source of truth, audit trail via git).

**Kluczowe zalety:**
- Mobile-first (działa w iOS/Android Safari/Chrome)
- Można dodać do home screen (PWA-style)
- Zero hostingu od strony Marcina (Vercel free tier)
- Audit trail (każda zmiana = GitHub Issue + commit z autorem)
- Współpracuje z `room99-feed-duplicator` bez kontaktu (issue-based integration)

---

## 2. POŁĄCZENIE Z `room99-feed-duplicator`

To repo jest **klientem** (frontend) który komunikuje się z `room99-feed-duplicator` (backend) przez **GitHub Issues API**.

**Flow:**
1. User wypełnia formularz na `room99-feed-admin.vercel.app`
2. JS POST do `/api/add-variant` (Vercel serverless function w `api/add-variant.js`)
3. Function używa `GITHUB_TOKEN` z env vars Vercel → POST do GitHub Issues API
4. Tworzy Issue w `marketinghacker/room99-feed-duplicator` z:
   - Label: `new-variant` (trigger dla workflow)
   - Title: `[WARIANT] {replaceWith} ({dupSuffix})`
   - Body: markdown z 5 sekcjami `### {pole}\n\n{wartość}` (format zgodny z GitHub Issue Forms)
5. W repo `room99-feed-duplicator` workflow `handle-new-variant-issue.yml` triggeruje się na issues.opened z labelem
6. Workflow parsuje body, dodaje regułę do `config.json`, commit, zamyka issue
7. Push do `config.json` triggeruje `regenerate-feed.yml` → nowy output

**Krytyczne:** Format body Issue (`### labels`) **MUSI** być identyczny we 3 miejscach:
- `api/add-variant.js` (ten plik) — sekcja `issueBody`
- `.github/ISSUE_TEMPLATE/dodaj-wariant.yml` w `room99-feed-duplicator`
- Regex parsera w `.github/workflows/handle-new-variant-issue.yml` w `room99-feed-duplicator`

Aktualnie używane labele (BEZ EMOJI — emoji łamią regex parser):
- `Grupa produktow`
- `Szukaj w tytule`
- `Zastap przez`
- `Sufiks ID`
- `Notatka`

---

## 3. ARCHITEKTURA TECHNICZNA

```
┌──────────────────────────────────────────────────────────────────┐
│  Browser (mobile/desktop)                                        │
│  - public/index.html                                             │
│  - Formularz: matchInTitle, searchInTitle, replaceWith,          │
│    dupSuffix, notes                                              │
│  - JS fetch POST '/api/add-variant'                              │
└─────┬────────────────────────────────────────────────────────────┘
      │ JSON body
      ▼
┌──────────────────────────────────────────────────────────────────┐
│  Vercel Edge / Serverless Function                               │
│  - api/add-variant.js                                            │
│  - Validates input (regex sufiksu, non-empty fields)             │
│  - Reads env vars: GITHUB_TOKEN, GITHUB_OWNER, GITHUB_REPO       │
│  - POST github.com/repos/.../issues z body + label 'new-variant' │
│  - Returns { success, issueNumber, url }                         │
└─────┬────────────────────────────────────────────────────────────┘
      │ HTTP POST /repos/.../issues
      ▼
┌──────────────────────────────────────────────────────────────────┐
│  GitHub API → tworzy Issue → trigger workflow                    │
│  (reszta opisana w README repo room99-feed-duplicator)           │
└──────────────────────────────────────────────────────────────────┘
```

---

## 4. PLIKI W PROJEKCIE

### `public/index.html`

Single-page HTML z embedded CSS + JS (zero npm dependencies).

**Stack:**
- Vanilla HTML5 + CSS3 (dark theme zgodny z Twoim brandem)
- Vanilla JS (fetch API, no frameworks)

**UX:**
- Formularz 4 wymaganych pól + 1 opcjonalne (notes)
- Walidacja `pattern="[a-z0-9]+"` na `dupSuffix` (krótkie, lowercase)
- Disabled button podczas submitu
- Alert success/error w UI

**Mobile optimizacje:**
- Viewport `width=device-width, initial-scale=1.0`
- Inputs z odpowiednim `type="text"` (na iOS keyboard alfabetyczny)
- Touch-friendly button size (`padding: 14px`)

### `api/add-variant.js`

Vercel serverless function (Node 18+). **Export default async handler** zgodny z Vercel API Routes spec.

**Logika:**
1. Sprawdź `req.method === 'POST'`
2. Walidacja inputu (4 wymagane pola, dupSuffix pattern)
3. Read env vars: `GITHUB_TOKEN`, `GITHUB_OWNER`, `GITHUB_REPO`
4. Build issue body z markdown sekcjami (format zgodny z handler regex)
5. POST do `https://api.github.com/repos/${OWNER}/${REPO}/issues`
6. Response do client: `{success, issueNumber, url}` lub `{error}`

**Bezpieczeństwo:**
- Token w env vars (nie wystawia się w response)
- Permission scope tokena: `Issues: Read and write` w jednym repo
- Worst case: ktoś zaspamuje issuami → max szkoda = config.json zaśmiecony, ale Marcin może wyłączyć regułę

### `package.json`

Minimal — tylko scripts dla local dev (`vercel dev`).

### `vercel.json`

```json
{
  "rewrites": [
    { "source": "/", "destination": "/index.html" }
  ]
}
```

Wymusza serwowanie `index.html` na root URL. Bez tego Vercel pokazywałby file listing.

---

## 5. DEPLOYMENT NA VERCEL — krok po kroku

### Wymagania:
- Konto Vercel (free): https://vercel.com/signup
- Repo `room99-feed-admin` na GitHub
- Repo `room99-feed-duplicator` już istniejące (z workflow handle-new-variant-issue.yml)

### Setup:

**Krok 1: GitHub repo**
```
github.com/new → name: room99-feed-admin → Public lub Private → Create
Upload files: public/index.html, api/add-variant.js, package.json, vercel.json, README.md
Commit
```

**Krok 2: Wygeneruj GitHub Personal Access Token**
1. https://github.com/settings/tokens?type=beta
2. Generate new token → fine-grained
3. Name: `room99-feed-admin`
4. Expiration: 1 year (lub krótszy, według polityki)
5. Repository access: Only select repositories → `marketinghacker/room99-feed-duplicator`
6. Permissions → Repository → **Issues: Read and write**
7. Generate token → **SKOPIUJ** (zaczyna się od `github_pat_...`)

**Krok 3: Deploy na Vercel**
1. https://vercel.com/new
2. Import Git Repository → wybierz `room99-feed-admin`
3. Configure Project:
   - Framework: **Other** (NIE Next.js — overkill)
   - Build Command: (puste)
   - Output Directory: `public`
4. Environment Variables (PRZED kliknięciem Deploy!):
   - `GITHUB_TOKEN` = token z Kroku 2
   - `GITHUB_OWNER` = `marketinghacker`
   - `GITHUB_REPO` = `room99-feed-duplicator`
5. Deploy

Po 30s dostajesz URL: `https://room99-feed-admin.vercel.app` (lub custom domain).

**Krok 4: Add to Home Screen (mobile)**
- iOS Safari: tap Share → Add to Home Screen → name "Room99 Variants"
- Android Chrome: ⋮ menu → Add to Home screen

---

## 6. ENV VARS — co i dlaczego

| Variable | Wymagane | Default | Co robi |
|---|---|---|---|
| `GITHUB_TOKEN` | TAK | - | Fine-grained PAT z permissions: **Issues: R/W**, **Contents: R/W**, **Actions: R/W**, **Metadata: R** na repo `room99-feed-duplicator` |
| `GITHUB_OWNER` | TAK | - | Username GitHub (np. `marketinghacker`) |
| `GITHUB_REPO` | NIE | `room99-feed-duplicator` | Nazwa repo gdzie operujemy |

**WAŻNE — token scope rotation w Sprint 2:** Sprint 1 wymagał tylko Issues+Contents. Sprint 2 dodał `/api/regenerate-feed` który używa `workflow_dispatch` API → wymaga dodatkowo **Actions: Read and write**. Jeśli klikasz "Regenerate now" w panelu i dostajesz error 403 "Resource not accessible by personal access token", to znaczy że token w Vercel env vars trzeba rotować z nowym scope.

Procedura rotacji tokena:
1. https://github.com/settings/tokens?type=beta → wybierz istniejący `room99-feed-admin` token albo wygeneruj nowy
2. Repository access: `marketinghacker/room99-feed-duplicator`
3. Permissions → Repository:
   - **Contents**: Read and write (read config.json, edits w Sprint 3+)
   - **Issues**: Read and write (legacy Add Variant flow)
   - **Actions**: Read and write (workflow_dispatch dla Regenerate now)
   - **Metadata**: Read-only (mandatory)
4. Skopiuj nowy token (zaczyna się od `github_pat_...`)
5. https://vercel.com/marketinghacker/room99-feed-admin/settings/environment-variables → edit `GITHUB_TOKEN` → paste new
6. Redeploy (Vercel → Deployments → ⋮ → Redeploy latest)

**Rotacja tokena:**
- Jeśli token wycieknie (np. w logach Vercel, w czacie z AI agent) → idź do https://github.com/settings/tokens → Delete → Generate new → update Vercel env var

---

## 7. SECURITY NOTES

- **Token jest sekretny** — jeśli dostanie się publicznie, ktoś może tworzyć Issues w Twoim repo. Worst case: spam config.json.
- **Strona publiczna** — każdy z URL może wypełnić formularz. Dla większego bezpieczeństwa:
  - **Vercel Password Protection** (Pro plan, $20/m-c) — wymaga hasła
  - **Cloudflare Access** (free dla < 50 users) — SSO login
  - **Basic Auth w api/add-variant.js** — sprawdza Authorization header
- **Rate limiting:** Vercel free tier ma 100GB bandwidth/m-c (więcej niż wystarczy), 100k function invocations/m-c (też dużo). Brak built-in rate limit per IP — można dodać przez Vercel KV lub external (Upstash Redis).
- **Walidacja po stronie serwera:** mimo że HTML ma `required` i `pattern`, JS w przeglądarce można obejść. **Zawsze waliduj w `api/add-variant.js`** (już mamy `if (!matchInTitle || ...)` i regex sprawdzający dupSuffix).

---

## 8. LESSONS LEARNED

### a) Vercel CLI vs Web UI
Deploy przez Web UI z GitHub repo = auto-deploy na każdy push. **Nie używaj** `vercel deploy --prod` z lokalnego CLI — szybsze tymczasowo, ale tracisz CI/CD integration.

### b) `vercel.json` rewrites > redirects
Rewrite zachowuje URL (`/` pokazuje `/index.html` ale URL pozostaje `/`). Redirect zmienia URL — gorsze UX.

### c) Format body Issue MUSI matchować
Jeśli w `api/add-variant.js` użyjesz `### 🎯 Grupa`, ale w handler regex w `room99-feed-duplicator` jest `### Grupa produktow`, parser zwróci `null` i workflow failuje. **3 pliki muszą być sync.**

### d) Nie używaj OAuth dla single-user app
Mogłbyś użyć GitHub OAuth App dla Marcina żeby logowanie było per-user — ale to overkill. Single static token z scope `Issues: Write` w jednym repo = wystarczy + prościej.

### e) Vercel preview deployments
Każda branch w GitHub = osobny preview URL na Vercel. Możesz testować zmiany w nowej branch bez wpływu na production. Production = tylko `main`.

### f) GitHub Issues API zwraca pełne URL'e
`response.html_url` to URL widoczny w przeglądarce (np. `github.com/marketinghacker/room99-feed-duplicator/issues/3`). Wracaj to do clienta żeby user mógł kliknąć i zobaczyć issue.

---

## 9. SUGESTIE ROZBUDOWY (TODO dla AI agents)

Marcin chce więcej funkcji. Najprawdopodobniejsze:

### Priority 1 — UX improvements
1. **Lista aktywnych reguł** — pobierz `config.json` z `room99-feed-duplicator` przez `https://raw.githubusercontent.com/marketinghacker/room99-feed-duplicator/main/config.json` i pokaż tabelę:
   ```
   Suffix | Match | Search | Replace | Active
   t1     | GARDEN LINE | ZASŁONA NA TARAS | ZASŁONA DO ALTANY | ✓
   t2     | ...
   ```
   + button "Deactivate" na każdej (PATCH issue lub direct config edit przez API)

2. **Live preview** — przy tworzeniu nowej reguły, pokaż user'owi sample 3 produktów które dostanie ta reguła (pobranie feedu, filter po `matchInTitle`, pokaż 3 tytuły before/after)

3. **Validate przed submit:**
   - Czy `dupSuffix` już istnieje? (pobierz config.json, sprawdź)
   - Czy `matchInTitle` znajdzie jakikolwiek produkt? (pokaż liczbę)
   - Czy `searchInTitle` jest w którymś tytule? (jeśli nie — error)

### Priority 2 — Analytics & decisions
4. **Performance dashboard** — Google Ads API integration, pokaż per `custom_label_1`:
   - Impressions, Clicks, CTR, CPC, Conversions, ROAS
   - Sortowanie po ROAS
   - Highlight: wariant z najwyższym ROAS
5. **Auto-deactivation** — jeśli wariant ma niski ROAS przez 14+ dni, propozycja `active: false`
6. **Statystyczna istotność** — chi-square test t1 vs original — czy wystarczy data dla decyzji?

### Priority 3 — Skalowanie
7. **Bulk import** — CSV upload z listą reguł (np. 50 keywordów na raz)
8. **Multiple feed sources** — wspierać Bing/Meta feedy, nie tylko Google
9. **AI keyword suggestions** — Claude API lub OpenAI: dla danej grupy (np. `MARSHMALLOW`) zaproponuj 5 alternatywnych keywords na podstawie konkurencji

### Priority 4 — Operacje
10. **Slack notifications** — po regeneracji feedu (winning variant, errors)
11. **Audit log UI** — historia wszystkich zmian (każda = GitHub commit)
12. **Rollback** — przywróć config sprzed N commitów

---

## 10. POŁĄCZONE PROJEKTY

- **`room99-feed-duplicator`** — backend (skrypt + workflow). Tu siedzi `config.json` i logika generation. Wymaga osobny `README.md` (też dla AI agentów).
- **FeedOptimise** (https://app.feedoptimise.com/dashboard/1805) — źródło feedu. Marcin ma full access.
- **Google Merchant Center** — konsument feedu. Marcin zarządza handlowo.
- **Google Ads** — performance data (przyszły dashboard).

---

## 11. KONTAKTY

- Marcin Michalski — marcin@marketing-hackers.com (project owner)
- Vercel docs — https://vercel.com/docs/functions
- GitHub Issues API — https://docs.github.com/en/rest/issues/issues

---

## 12. AKTUALNY STAN — co działa, co nie (PEŁNA TRANSPARENCJA)

| Sekcja | Działa? | Co konkretnie |
|---|---|---|
| **Today** | ✅ działa w pełni | 4 KPI tiles z live snapshot + 5-6 actionable decisions (heuristic z snapshot + config) + Feed activity card |
| **Rules** | ✅ pełne CRUD | Read live config · inline status toggle · side-panel edit (impact preview, validators, samples, diff) · delete · auto-fallback do Issue gdy 403 |
| **Hypotheses** | ✅ live recommendations | 5+ kart ranked (critical/high/medium/low) generowane z snapshot + config heuristic. NIE placeholder. |
| **Images** | ✅ Apply enabled | Browse 1841 produktów · per-product gallery · BEFORE/AFTER preview · **Apply commits image rule** (direct OR Issue fallback). Generation gated by `feature_flags.image_rules_enabled=false` w config.json — flip flag żeby aktywować generation. |
| **Performance** | ✅ live snapshot | Top 15 campaigns 30d + Top 10 campaigns 7d + diagnosis banner + 4 KPI tiles + summary (blended ROAS 30d=9.69x, 7d=7.95x). Snapshot refreshed manually via MCP — auto-refresh planned. |
| **Feed Health** | ✅ + Regenerate | Cron status · ⟳ Regenerate now (3-tier fallback: dispatch → touch → Issue) |
| **History** | ✅ live commits | 30 ostatnich commitów na config.json z icon (feat/fix/chore/auto-regen), short SHA, author, relative time, click-through link |
| **Add Variant** | ✅ legacy form | Tworzy GitHub Issue (workflow processuje) + Title Case live preview |
| **Health Banner** | ✅ top of page | "System ready — auto-fallback do Issue" · auto-dismiss 12s |

### NIC nie jest "Coming in Sprint X" w UI. Każda sekcja ma realny content i działa.

### ZNANE OGRANICZENIA (Marcin może zaakceptować lub fix):

1. **Token scope w Vercel env (PAT)**: aktualnie tylko Contents:Read + Issues:R/W. Direct PATCH na config.json zwraca 403, ALE wszystkie write paths mają auto-fallback przez Issue (workflow `handle-rule-action-issue.yml` w feed-duplicator processuje z built-in token). Marcin nie musi rotować — wszystko działa. JEŚLI Marcin chce direct writes (instant zamiast +30s Issue workflow): rotate PAT z Contents:R/W + Actions:R/W (instrukcja w sekcji 6).

2. **A/B test duplikatów ma 0 impressions od 2 miesięcy**: KRYTYCZNE — proven via shopping_performance_view query. Hypothesis (high probability): `custom_label_0='TITLE_TEST'` override w config.json `duplicateFieldOverrides` powoduje że duplikaty wypadają poza inventory filter wszystkich PMAX/PLA campaigns Marcina (które są scoped na product category). **Fix przygotowany** lokalnie z pre-flight diff PASSED — czeka na Marcin TAK/NIE. Po fix duplikaty wpadną do tych samych campaigns co parent products, TITLE_TEST przeniesione na `custom_label_2` (unused slot).

3. **Performance snapshot refresh = manual**: Snapshot.json compiluje JA via MCP queries manualnie. Auto-refresh wymaga Vercel Cron + Google Ads OAuth (developer token + refresh token w env) — następna iteracja.

4. **Image rules generation gated**: `feature_flags.image_rules_enabled=false` w config.json. Image rules zapisane w config (przez Apply button), ale generate-feed.js NIE generuje image-variant duplikatów dopóki Marcin nie flip flag → true. To safety gate.

### Sprint 3+ (2026-05-14) — DONE
- ✅ `api/rule-impact.js` — POST returns `matched_count`, 3 sample title transformations, validators (title length 30/70/150, CAPS ratio, promo words, search-not-found-in-match, zero-match, rule overlap, dupSuffix duplicate). Mirror of `wordCapitalize()` in generate-feed.js.
- ✅ `api/rules/[id].js` — PATCH (`action: toggle | set_active | edit`) and DELETE with ETag race-safety + 3× retry on 409. Mutations: validate dupSuffix uniqueness, write `updated_at`, mirror customLabel1 to dupSuffix. Friendly 403 message if PAT scope lacks Contents:R/W.
- ✅ `api/regenerate-feed.js` — two-tier strategy: tries `workflow_dispatch` first, falls back to `config.json` touch (`_lastTouched` field) which triggers regenerate-feed.yml via push event (paths: config.json). Works with only Contents:R/W scope.
- ✅ Rules section: clickable rows, inline status toggle pill, live match count badge (parallel /api/rule-impact calls per rule), Edit → button opens side-panel.
- ✅ Side-panel slide-in (520px from right): editable fields (matchInTitle, searchInTitle, replaceWith, dupSuffix, notes) + impact banner ("N of 1841 products affected") + live validators with severity icons + 3 sample title transformations + collapsed Diff JSON section + footer (Usuń / Pause/Resume / Zapisz). Save disabled when any validator error. Esc + backdrop click + close button all dismiss.
- ✅ Toast system (Linear pattern, bottom-right, 5s auto-dismiss) for action confirmations.
- ✅ Warning hints on `searchInTitle` and `dupSuffix` fields per Google Ads expert recommendation (changing these resets A/B stats cohort — suggest `_v2` rule pattern instead).

### Sprint 2 (2026-05-14) — Manual regenerate trigger + Image Manager browser + CAPS live preview
- ✅ `api/regenerate-feed.js` — POST workflow_dispatch on regenerate-feed.yml
- ✅ `api/products.js` — paginated FO source feed products with image arrays (5min cache)
- ✅ Feed Health: ⟳ Regenerate now button + friendly error if PAT scope insufficient
- ✅ Image Manager (browse-only): 1841 products grid, search, click → per-product gallery with MAIN badge + numbered tiles, click non-main → BEFORE/AFTER swap preview + generated imageRule JSON (Apply disabled — write awaits pre-flight diff infra)
- ✅ Add Variant: live Title Case preview (warning color if input ≠ normalized output)

### Sprint 1 (2026-05-14) — Read-only Command Center foundation
- ✅ SPA shell z 7-sekcyjnym hash routerem (Today, Rules, Hypotheses, Images, Performance, Feed Health, History) + legacy "+ Add Variant"
- ✅ `public/index.html` — SPA HTML
- ✅ `public/styles.css` — dark theme, command-center aesthetic
- ✅ `public/app.js` — vanilla JS, hash router, lazy section render, fetch helpers
- ✅ `api/config.js` — GET /api/config (reads config.json from feed-duplicator)
- ✅ `api/feed-stats.js` — GET /api/feed-stats (output size, last cron run, last commit)
- ✅ `api/add-variant.js` — unchanged, legacy POST endpoint still works (Issue-based flow)
- ✅ Today section: 4 KPI tiles (active rules, duplicates count, last regeneration, last config change) + decisions feed + feed activity
- ✅ Rules section: read-only table of all rules with status pills
- ✅ Feed Health section: cron status, output stats, last commit
- ✅ Hypotheses/Images/Performance/History: placeholders with "Coming in Sprint X" messaging
- ✅ Graceful degradation if API endpoints fail (error alerts in UI)
- ✅ Zero writes to production data in Sprint 1

### Co może być następne (jeśli Marcin chce):

1. Auto-refresh snapshot.json via Vercel Cron (wymaga Google Ads OAuth setup)
2. "Why It Won" card per winning rule (wymaga performance data per t1..t7 — DEPENDS na fix #2 z "Znane ograniczenia")
3. Cannibalization monitor (original SKU baseline vs duplicates)
4. Bulk operations (multi-select rules → bulk toggle)
5. Bing/Meta feed export

Full plan: `/Users/marcinmichalski/.claude/plans/rippling-beaming-canyon.md` (pushed do git jako design doc).

---

*Plik utworzony 2026-05-13, rebuild 2026-05-14 (Sprint 1) przez Claude w cowork mode z Marcinem. Edycja w przyszłości — zachowuj sekcję "Lessons Learned" i "Połączone projekty".*
