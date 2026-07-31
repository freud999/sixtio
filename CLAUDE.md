# Sixtio — project facts for Claude

Telegram Mini App dating service. AI matchmaker: a short interview builds a
"Digital Twin", then matching pairs users on real compatibility. Markets: uk/ru/en.

## Stack
- Frontend: vanilla multi-page HTML + inline JS. Shared assets on every page:
  `i18n.js`, `theme.js`, `paywall.js`, `theme.css`, each with a `?v=NN` cache-buster
  (currently **v=43** — bump ALL references together on any shared-asset change).
- Backend: Vercel serverless (`api/*.js`), ESM. Logic in `api/_lib/`.
- DB/storage: Supabase. AI: Anthropic Claude + Google Gemini.
- No build / typecheck / lint / CI. No TypeScript. Verify via tests + `node --check`.

## Commands
```
npm test        # node --test test/*.test.js  (80 tests)
npm run i18n    # scripts/i18n-check.mjs — 3-language coverage, must be Clean
npm run dev     # scripts/dev-server.js (needs .env; ALLOW_FAKE_AUTH for stubbed auth)
```
Before committing shared assets: bump `?v=`, run tests + i18n, verify in browser
across uk/ru/en and light/dark. See `.claude/skills/ship`.

## Hard constraints
- **Vercel Hobby cap = 12 serverless functions.** `api/` holds exactly 12 files;
  a 13th breaks the deploy and takes the app offline. Add server ops via the
  `op`-dispatch pattern inside an existing file (see `.claude/skills/api-budget`),
  never a new `api/*.js`.
- Push to `main` ONLY when the user explicitly asks. Commit trailer:
  `Co-Authored-By: Claude Opus 4.8 <noreply@anthropic.com>`. Git via PowerShell.
- Never commit `.env`/secrets. NEVER set `ALLOW_FAKE_AUTH`/`FAKE_TG_ID` on Vercel.
- Additive Supabase migrations are authorized; destructive DB ops need explicit OK.
- 18+ privacy is #1: free male users must NOT receive intimate tags over the API;
  intimate data reaches the AI only on mutual Dark Mode opt-in.

## Deploy
GitHub `freud999/sixtio` → Vercel project `sixtio` (team **Aura** `xaurax`),
auto-deploy on push to `main`. Prod domain `sixtio.vercel.app`. No `.vercel/project.json`
in repo — discover ids via Vercel MCP `list_teams`/`list_projects`.

## DB security state
Migrations **036–039 applied to prod 2026-07-31** (already run — do NOT re-apply):
RLS enabled (no policies, deny-all) on `signup_sources`/`analytics_events`/`ai_reports`;
`EXECUTE` revoked from `public/anon/authenticated` on every `public` function (+ default
privileges), so RPCs are service-role-only; `search_path` pinned on all functions;
base-table DML grants revoked from `anon/authenticated` on all public tables (039).
Rollbacks live beside them as `supabase/rollback-036…039-*.sql` (not applied).
Server uses `SUPABASE_SERVICE_ROLE_KEY` (bypasses RLS), so these are transparent to the app.
**SEC-1 (P0):** signed-URL code landed (`api/_lib/photos.js` + all serving points);
bucket stays **public until the code deploys**, then apply `migration-040` to flip it
private. Mechanism verified 2026-07-31. See `audit/AUDIT_REPORT.md` §5-Б.

## Structure
- Pages: `index` → `onboarding` → `matches`/`feed` → `match` → `chat` → `profile`/`settings`;
  `privacy.html` (trilingual via `[data-doc-lang]`); `waiting.html` is a legacy redirect.
- API (12): me, profile, profile-info, answer, analyze-traits, feed, interact,
  chat (also the Telegram webhook entry), photo, rematch, delete-account, geo.
- Key libs: `telegram.js` (initData HMAC + lang), `entitlements.js` (gender-biased
  paywall), `matching.js` (MIN_SCORE=6), `analytics.js` (bot webhook + Stars credit),
  `events.js` (funnel), `sources.js`/`referrals.js` (attribution), `ratelimit.js`.

## Language
UI language is client-side (`i18n.js`); it recovers `en` from a blank Telegram
`language_code` via `navigator.language`. Server `resolveLang` maps blank → `uk`,
so AI content follows the client-sent `lang` only if the client sends it.
Distinguish reader-language (UI) from source-language (`profiles.lang`,
`users.bio_lang`, `ai_reports.lang`) — conflating them was this project's worst bug.

## Full inventory
See `audit/00_INVENTORY.md` for the complete route/API/env/funnel map.
