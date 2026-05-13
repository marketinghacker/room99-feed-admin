# Room99 Feed Admin

> Dokument dla **AI agentów** rozbudowujących ten projekt (Claude Code, Cursor, ChatGPT). Czytaj uważnie — zawiera business context, deployment, security i sugestie rozbudowy.

---

## 1. CEL — co ta aplikacja robi

**Front-end (mobile-friendly) do dodawania nowych wariantów tytułów do feeda Room99.**

Marcin (project owner) zarządza eksperymentami A/B/C/D/E tytułów produktów w Google Shopping. Bez tej aplikacji musiałby ręcznie edytować `config.json` w repo `room99-feed-duplicator` na GitHub — niemożliwe z telefonu, frustrujące na desktop.

**Rozwiązanie:** Strona z prostym formularzem (4 pola) hostowana na Vercel. Wypełnia formularz → submit → automatycznie powstaje GitHub Issue → workflow w `room99-feed-duplicator` przetwarza issue → dodaje regułę do config.json → regeneruje feed → Google Merchant Center pobiera nowy feed.

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
| `GITHUB_TOKEN` | TAK | - | Personal Access Token z `Issues: Write` permissionem |
| `GITHUB_OWNER` | TAK | - | Username GitHub (np. `marketinghacker`) |
| `GITHUB_REPO` | NIE | `room99-feed-duplicator` | Nazwa repo gdzie tworzymy issues |

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

## 12. AKTUALNY STAN (2026-05-13)

- ✅ Single-page admin app działa
- ✅ Formularz dodawania wariantów funkcjonalny
- ✅ Issues są tworzone i procesowane przez backend
- ✅ Vercel deployed
- ✅ Mobile-friendly

**Co dalej:** rozszerzenie o features z sekcji 9 (Priority 1 najpierw).

---

*Plik napisany 2026-05-13 przez Claude w cowork mode z Marcinem. Edycja w przyszłości — zachowuj sekcję "Lessons Learned" i "Połączone projekty".*
