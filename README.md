# Room99 Feed Admin — mini panel webowy

Strona z formularzem do dodawania wariantów tytułów. Wypełnij 4 pola → Submit → automatycznie tworzy GitHub Issue → workflow w repo `room99-feed-duplicator` dodaje regułę do config.json.

**Hostuj na Vercel (free).**

---

## Setup — 10 minut

### Wymagania (musisz mieć już zrobione):
1. **Repo `room99-feed-duplicator`** na GitHub z plikami feed-duplicator (workflow handle-new-variant-issue.yml).
2. **Konto Vercel** (zarejestruj się free na https://vercel.com)

### Krok 1: Wgraj te pliki na nowe repo GitHub
1. https://github.com/new → nazwa `room99-feed-admin` → **Public** lub Private → Create
2. **Add file → Upload files** → przeciągnij **wszystkie pliki z folderu feed-duplicator-admin/** (zachowaj strukturę: `api/`, `public/`)
3. Commit

### Krok 2: Wygeneruj GitHub Personal Access Token
1. https://github.com/settings/tokens?type=beta
2. **Generate new token** → fine-grained
3. **Token name:** `room99-feed-admin`
4. **Expiration:** 1 year
5. **Repository access:** Only select repositories → wybierz `room99-feed-duplicator`
6. **Permissions → Repository permissions:**
   - **Issues**: Read and write
   - Reszta: No access
7. **Generate token** → **SKOPIUJ token** (zaczyna się od `github_pat_...`)

### Krok 3: Deploy na Vercel
1. https://vercel.com/new
2. **Import Git Repository** → wybierz `room99-feed-admin`
3. **Configure Project:**
   - Framework: **Other**
   - Build Command: (puste)
   - Output Directory: `public`
4. **Environment Variables** (rozwiń):
   - `GITHUB_TOKEN` = wklej token z Kroku 2
   - `GITHUB_OWNER` = Twój username GitHub (np. `marcinmichalski`)
   - `GITHUB_REPO` = `room99-feed-duplicator`
5. **Deploy**

Po ~30s dostajesz URL typu `https://room99-feed-admin.vercel.app`. **To Twoja strona do zarządzania.**

### Krok 4: Dodaj do Closetabs / Home Screen na telefonie
- iOS Safari: Share → Add to Home Screen
- Android Chrome: ⋮ → Add to Home screen

Klikasz ikonę z home screen → wypełniasz formularz → variant dodany.

---

## Jak działa

1. Formularz HTML → POST do `/api/add-variant` (Vercel serverless function)
2. Function tworzy **GitHub Issue** w repo `room99-feed-duplicator` z labelem `new-variant`
3. GitHub Action `handle-new-variant-issue.yml` (w repo room99-feed-duplicator) automatycznie:
   - Czyta issue body
   - Dodaje regułę do `config.json`
   - Commituje
   - Zamyka issue z komentarzem
4. Cron regenerate-feed odpala się przy push do config.json → świeży feed dostępny w ciągu sekund

---

## Bezpieczeństwo

- **GITHUB_TOKEN** ma uprawnienia tylko do Issues w jednym repo (room99-feed-duplicator) — nawet jeśli wycieknie, max szkoda = ktoś może utworzyć kilka issues które trafią do config.json
- Strona publiczna ale **bez submit'a nic nie robi** — możesz ją zostawić nawet jako public
- Dla większej ochrony: dodaj Vercel Password Protection (Pro plan) lub Cloudflare Access (free)

---

## Skalowanie

Dodawanie nowych grup produktów:
- W formularzu wpisz np. `MARSHMALLOW` jako match group + odpowiednie pola
- Nowy variant od razu trafia do config + następnego regen

Możesz testować dziesiątki keywordów paralel bez ograniczeń.
