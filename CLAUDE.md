# Sixtio — project facts for Claude

Telegram Mini App dating service. AI matchmaker: a short interview builds a
"Digital Twin", then matching pairs users on real compatibility. Markets: uk/ru/en.

## Stack
- Frontend: vanilla multi-page HTML + inline JS. Shared assets on every page:
  `i18n.js`, `theme.js`, `paywall.js`, `theme.css`, each with a `?v=NN` cache-buster
  (currently **v=43** — bump ALL references together on any shared-asset change).
- Backend: Vercel serverless (`api/*.js`), ESM. Logic in `api/_lib/`.
- DB/storage: Supabase. AI: **Anthropic Claude for everything**; Google Gemini
  for translation only (see the privacy constraint below).
- Scheduling: Vercel Cron (`vercel.json`, daily) hits `/api/me?op=cron_retention_trigger`,
  which also runs the dependency smoke test and pings `HEALTHCHECK_URL` — an
  external dead-man switch, because an in-app alarm cannot report its own death.
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
- **Gemini does translation and NOTHING else** (PRIV-1, option B, 2026-08-05).
  Everything about a person's psyche or body — Dark Mode interview, Big Five,
  onboarding follow-ups, photo moderation, AI reports, Why Factor — runs on
  Anthropic, which does not train on API traffic; Google's free tier does.
  `api/_lib/gemini.js` was deleted. Enforced by `test/privacy-kink.test.js`,
  which pins the three files allowed to call Gemini; a fourth fails the build.

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
**SEC-1 — CLOSED 2026-08-01, re-verified 2026-08-05.** Signed-URL code deployed
(`api/_lib/photos.js` + all serving points) and `migration-040` applied: the
`photos` bucket is **private**. Re-verified by measurement — `/object/public/`
answers HTTP 400. Every delivery is a 5-minute signed URL minted after the
entitlement check. (This paragraph previously said the bucket was still public;
that staleness cost a session. Security state belongs in ONE place — the audit.)
Account deletion removes both objects (`deleteUserCascade`, `supabase.js:184`) and
a storage failure now raises a Telegram alert instead of a swallowed `console.error`
(SEC-1a, closed 2026-08-05) — an un-erased photo is a GDPR Art. 17 breach, not a log line.
**041 applied 2026-08-05** — `users.ai_calls_today/day` + `bump_ai_usage(uuid,int)`:
durable, atomic per-user daily AI ceiling (`_lib/aibudget.js`, fail-OPEN by design).
**042 applied 2026-08-05** — bounded reads: `calculate_compatibility_for(uuid,uuid[])`,
`calculate_compatibility_page(...)` (gender/age prefilter + LIMIT),
`latest_messages_for_matches(uuid[])`. All compatibility reads go through
`api/_lib/compat.js`, which falls back to the old unbounded RPC on any error.
Migration 027's `calculate_compatibility(uuid)` is deliberately KEPT as that fallback.

## Structure
- Pages: `index` → `onboarding` → `matches`/`feed` → `match` → `chat` → `profile`/`settings`;
  `privacy.html` (trilingual via `[data-doc-lang]`); `waiting.html` is a legacy redirect.
- API (12): me, profile, profile-info, answer, analyze-traits, feed, interact,
  chat (also the Telegram webhook entry), photo, rematch, delete-account, geo.
- Key libs: `telegram.js` (initData HMAC + lang), `entitlements.js` (gender-biased
  paywall), `matching.js` (MIN_SCORE=6), `analytics.js` (bot webhook + Stars credit),
  `events.js` (funnel), `sources.js`/`referrals.js` (attribution), `ratelimit.js`,
  `compat.js` (ALL compatibility reads — never call the RPCs directly),
  `flags.js` (kill switches; no static imports on purpose), `sentry.js` (zero-dep
  error reporting, inert without `SENTRY_DSN`), `aibudget.js` (daily AI ceiling).
- Kill switches, all DEFAULT ON, off only on an unambiguous false/0/off/no:
  `AI_ENABLED`, `MATCHING_ENABLED`, `FEED_ENABLED`, `PAYMENTS_ENABLED`,
  `PHOTOS_ENABLED`, `TRANSLATION_ENABLED`. A down switch alerts hourly and
  `/envcheck` refuses to say "all green".

## Backups
Supabase org is on the **FREE plan → no automatic backups, no PITR** (measured
2026-08-05). `node scripts/backup.mjs` dumps all 12 tables to JSON;
`node scripts/restore-verify.mjs backups/<ts>` checks hashes + schema drift and
emits an abort-guarded insert probe. Full dump→wipe→restore round trip verified
on prod 2026-08-05 (all 12 tables, 0 mismatches, rolled back). Runbook:
`supabase/RESTORE.md`. The dump holds Art. 9 data — `backups/` is gitignored.

## Language
UI language is client-side (`i18n.js`); it recovers `en` from a blank Telegram
`language_code` via `navigator.language`. Server `resolveLang` maps blank → `uk`,
so AI content follows the client-sent `lang` only if the client sends it.
Distinguish reader-language (UI) from source-language (`profiles.lang`,
`users.bio_lang`, `ai_reports.lang`) — conflating them was this project's worst bug.

## Full inventory
See `audit/00_INVENTORY.md` for the complete route/API/env/funnel map.
