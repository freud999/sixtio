# Sixtio — Product Inventory (Phase 0)

> Карта продукту перед платним трафіком. Це НЕ аудит — лише інвентар з
> прив'язкою до реальних файлів. Дата: 2026-07-26.

---

## 1. Стек, збірка, оточення

| Аспект | Факт | Доказ |
|---|---|---|
| Frontend | Vanilla multi-page HTML + inline JS + 3 спільні скрипти | корінь репо, `*.html` |
| Спільні ассети | `i18n.js`, `theme.js`, `paywall.js`, `theme.css` (кеш-бастер `?v=43`) | `index.html:8-10` |
| Backend | Vercel serverless functions, ESM (`"type":"module"`) | `package.json:6`, `api/*.js` |
| DB / storage | Supabase (`@supabase/supabase-js`) | `api/_lib/supabase.js` |
| AI | Anthropic Claude SDK + Google Gemini REST | `claude.js`, `gemini.js` |
| Менеджер пакетів | npm (lockfile `package-lock.json`, 17 пакетів) | `npm install` → `up to date, audited 17 packages` |
| **Build** | **немає** (статичні HTML, без бандлера) | немає `build` скрипта в `package.json:8-12` |
| **Typecheck** | **немає** (чистий JS, без TypeScript) | немає `tsconfig.json` |
| **Lint** | **немає** (немає ESLint config) | немає `.eslintrc*` / `eslint.config.*` |
| **CI** | **немає** | немає `.github/workflows` |
| Тести | `node --test test/*.test.js` | `package.json:10` |
| Локальний dev | `scripts/dev-server.js` (порт з `PORT`) | `package.json:9` |
| Vercel config | `maxDuration:30`, no-cache на `*.html` та спільних `.js` | `vercel.json` |
| **Обмеження Vercel Hobby** | рівно **12** serverless-функцій (13-та ламає деплой) | `api/` = 12 `.js` файлів |

**Оточення:** dev (локальний `scripts/dev-server.js` + `.env`) → prod (Vercel, env у панелі).
Окремого **stage** немає. Домен prod: `sixtio.vercel.app` (`api/_lib/bot.js:1`, `analytics.js:11`).

**Фіче-флаги:**

| Флаг | Дія | Файл |
|---|---|---|
| `DARK_MODE_ENABLED` | kill-switch для інтимного шару (18+) | `api/_lib/darkmode.js` |
| `ALLOW_FAKE_AUTH` | LOCAL-ONLY: приймати запити без initData (stub-юзер) | `telegram.js:87` |

---

## 2. Інвентар

### 2.1. Екрани / роути (HTML-сторінки)

| Сторінка | Роль у продукті | Ключові переходи |
|---|---|---|
| `index.html` | Лендинг/вітання; авто-редірект зареєстрованих | → `onboarding.html` (`:107`), → `matches.html` (`:123`) |
| `onboarding.html` | Чат-онбординг + режим `?mode=deepen` | → `matches.html` / `profile.html` (`:738`, `:819`) |
| `matches.html` | Головний хаб: список метчів + картка «хто лайкнув» | → `feed.html` (`:542`), → `onboarding` якщо не зареєстр. (`:532`) |
| `feed.html` | Свайп-колода (discovery, AI-free) | → `onboarding` (`:735`) |
| `match.html` | Деталь метчу / сумісність | → `chat.html` (`:184`), → `conversation.html` (`:260`) |
| `chat.html` | 1:1 листування | → `onboarding` якщо не зареєстр. (`:214`) |
| `conversation.html` | Роутер розмови | → `chat.html` (`:150`), → `match.html` (`:154`) |
| `profile.html` | Свій профіль: edit, deepen, AI-звіт, реферали, видалення | → `settings` (`:965`), → `onboarding?mode=deepen` (`:1103`), → `index` (`:1123`) |
| `settings.html` | Налаштування, edit, приватність, видалення | → `profile.html` (`:202`), → `index` (`:248,256`) |
| `privacy.html` | Тримовна політика конфіденційності | → `profile.html` (`:410`) |
| `waiting.html` | **Легасі** — миттєвий редірект | → `matches.html` (`:7`) |

**Модалки / оверлеї:** paywall sheet (`paywall.js`), report sheet + consent + deepen (у `profile.html`), lootbox (`feed.html:277`), likers grid (`matches.html`).

### 2.2. API endpoints (12 функцій — межа Hobby)

| Файл | Операції | Rate-limit |
|---|---|---|
| `api/me.js` | профіль-агрегат + **cron** `cron_retention_trigger` | `read` / cron: `CRON_SECRET` |
| `api/profile.js` | генерація Digital Twin = **activation**, тригер матчингу | `ai_heavy` |
| `api/profile-info.js` | збереження анкети (gender/goal/age/city/...) | `write` |
| `api/answer.js` | AI-follow-up на кожну відповідь | `answer` |
| `api/analyze-traits.js` | фонова екстракція рис | `ai_heavy` |
| `api/feed.js` | колода для свайпів | `read` |
| `api/interact.js` | swipe/purchase/dark_mode/kink/likers/report/block/lootbox/ai_report/invoice | per-op |
| `api/chat.js` | list/send/share/why_factor **+ вхід Telegram-webhook** | per-op |
| `api/photo.js` | завантаження фото + blur-thumb | `photo` |
| `api/rematch.js` | новий пошук метчу | `ai_heavy` |
| `api/delete-account.js` | видалення акаунту | `write` |
| `api/geo.js` | місто за IP (Vercel headers) | — |

**Спільні бібліотеки (`api/_lib/`, не рахуються як функції):** analytics, astro, bot, claude, commands, darkmode, depth, entitlements, events, gemini, kink, langdetect, matching, personality, questions, ratelimit, referrals, sources, supabase, telegram, translate.

### 2.3. Точки входу ззовні

| Тип | Значення | Файл |
|---|---|---|
| Mini App launch | відкриття застосунку в Telegram | `index.html` |
| Referral deep link | `t.me/<Bot>?startapp=ref_<id>` (без bot-webhook) | `referrals.js:23`, `telegram.js:42` |
| Ad source deep link | `/start <src>` → стейджиться, атрибутується при реєстрації | `sources.js:23,149` |
| Bot webhook | усі апдейти бота → `POST /api/chat` | `chat.js:31` → `analytics.js:125` |
| Stars invoice | `openInvoice` → `successful_payment` webhook | `interact.js:303`, `analytics.js:145` |
| Share Telegram | взаємний обмін @username після метчу | `conversation.html:214`, `chat.js` op:share |

### 2.4. Форми та поля

| Форма | Поля | Файл |
|---|---|---|
| Онбординг (профіль) | gender, seekingGender, goal, age(18–100), city, interests[], values[], bio, photo | `i18n.js:148-160`, `onboarding.html:512-523` |
| Психо-інтервʼю | q1–q5 (+ AI-follow-ups), deepen d1–d5 | `i18n.js:165-180` |
| Дата народження (AI-звіт) | birthDate + опц. час/місце | `interact.js` op:save_birth |
| Kink-інтервʼю (Dark Mode) | вільний текст → канонічні маркери | `interact.js` op:submit_kink_interview |
| Редагування профілю | ті самі поля, режим edit | `profile.html?edit=1` |
| Feedback (бот) | `/feedback <текст>` | `commands.js` |

### 2.5. Кнопки / інтерактив (репрезентативно)

Патерн: `<button ...>` + `addEventListener('click', ...)` (немає React/onPress).
Ключові CTA: `#start` (index.html:77,105), `findBtn`→feed (matches.html:540), paywall-опції та deposit-паки (`paywall.js:286,242`), likers card (matches.html:510), premium teaser (matches.html:516), swipe-контроли + lootbox (feed.html), deepen/report/referral/delete (profile.html), theme toggle `[data-theme-toggle]` (theme.js:45), language switcher `[data-lang-switch]` (index.html:61).

### 2.6. Зовнішні залежності-сервіси

| Сервіс | Призначення | Ключ/доказ |
|---|---|---|
| Anthropic Claude | генерація профілю + скоринг метчів | `ANTHROPIC_API_KEY`, `claude.js` |
| Google Gemini | follow-ups, звіт, переклад, kink, personality | `GEMINI_API_KEY`, `gemini.js:1` |
| Supabase | БД + сховище фото | `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` |
| Telegram Bot API | нотифікації, invoice, webhook | `TELEGRAM_BOT_TOKEN`, `bot.js:7` |
| Vercel | хостинг + serverless | `vercel.json` |
| **Nominatim (OSM)** | reverse-geocode міста з GPS (третя сторона, без ключа) | `onboarding.html:462` |
| Google Fonts | шрифти (зовнішній CDN) | `*.html:7` `fonts.gstatic.com` |
| Telegram WebApp SDK | `telegram-web-app.js` | `*.html:8` |
| Платежі / пошта / SMS | **пошти й SMS немає**; платежі — лише Telegram Stars | — |

### 2.7. Env-змінні

| Змінна | Де використовується | В локальному `.env`? |
|---|---|---|
| `ANTHROPIC_API_KEY` | `claude.js` | так |
| `GEMINI_API_KEY` | `gemini/kink/translate/personality.js` | так |
| `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` | `supabase.js` | так |
| `TELEGRAM_BOT_TOKEN` | `telegram.js`, `bot.js` | так (**getMe → 401**, див. нижче) |
| `CLAUDE_MODEL`, `MATCH_MODEL` | `claude.js` | так (`haiku-4-5`, `sonnet-5`) |
| `GEMINI_MODEL` | `geminifetch.js` (єдина точка) | ні (default `gemini-flash-latest`, перевірено 200) |
| `OWNER_TELEGRAM_ID` | `interact.js:36`, `analytics.js`, `bot.js`, `commands.js` | **ні** |
| `ADMIN_TELEGRAM_IDS` | `analytics.js` (`/stats_sources`) | **ні** |
| `APP_URL` | `bot.js`, `analytics.js`, `commands.js` | **ні** (default `sixtio.vercel.app`) |
| `BOT_USERNAME` | `referrals.js` (реф-лінки) | **ні** |
| `CRON_SECRET` | `me.js:477` (retention cron) | **ні** |
| `TELEGRAM_WEBHOOK_SECRET` | `analytics.js` (згадка; гейт знято) | **ні** |
| `DARK_MODE_ENABLED` | `darkmode.js` kill-switch | **ні** |
| `ALLOW_FAKE_AUTH`, `FAKE_TG_ID` | `telegram.js` (LOCAL-ONLY) | так (**не має бути на Vercel**) |
| `PORT` | `dev-server.js` | — |

> `.env` у `.gitignore` (перевірено — не в git). Прод-значення живуть лише у Vercel і звідси невидимі.

### 2.8. Мови / локалі

| Локаль | Де | Обсяг |
|---|---|---|
| uk / en / ru | `i18n.js` (клієнт) | 481 ключ × 3, `npm run i18n` → clean |
| uk / en / ru | `privacy.html` через `[data-doc-lang]` | 3 окремі юр-документи |
| uk / en / ru | `commands.js` (тексти бота) | окремий словник |
| Визначення мови | `navigator.language` fallback для порожнього TG-коду | `i18n.js:1134` |

### 2.9. Cron / фонові задачі / webhooks

| Тип | Тригер | Авторизація | Файл |
|---|---|---|---|
| Telegram webhook | усі апдейти бота | `OWNER_TELEGRAM_ID` (для /stats) | `chat.js:31`, `analytics.js` |
| Retention cron (48h) | **зовнішній** cron (напр. cron-job.org) → `POST /api/me {op:cron_retention_trigger}` | `Bearer CRON_SECRET` | `me.js:476` |
| Background traits | fire-and-forget після онбордингу | initData | `onboarding.html:753` |

> **У `vercel.json` cron-блоку НЕМАЄ** — retention-пуш залежить від зовнішнього планувальника. Якщо він не налаштований, нагадування не шлються.

---

## 3. Граф воронки (крок → файл)

```
Реклама (Telegram Ads / deep link ?startapp / /start <src>)
   │        ├─ атрибуція джерела ......... sources.js:149 (captureStartSource)
   │        └─ подія START .............. events.js:54 (trackStart)
   ▼
Запуск Mini App .......................... index.html
   │  (зареєстрований? → matches.html:123)
   ▼
Онбординг ................................ onboarding.html
   │  профіль-поля → profile-info.js
   │  q1–q5 + follow-ups → answer.js
   ▼
ACTIVATION: Digital Twin створено ........ profile.js:49-70 (ONBOARDING_COMPLETE)
   │  └─ миттєвий матчинг ............... matching.js:46 (MIN_SCORE=6)
   ▼
Хаб + discovery .......................... matches.html / feed.html
   │  свайп (лімійт на сервері) ......... interact.js:141 (try_consume_like)
   │  взаємний лайк → метч .............. interact.js:185 + notifyInstantMatch
   ▼
Монетизація (Telegram Stars) ............. paywall.js → interact.js:223 (purchase)
   │  поповнення → invoice ............. interact.js:303
   │  зарахування ...................... analytics.js:220 (successful_payment, ідемпотентно)
   ▼
Повернення ............................... events.js:79 (trackReturn D1/D3/D7)
   └─ 48h nudge ......................... me.js:476 (retention cron)
```

---

## 4. Результати запусків (реальний вивід)

```
npm install   → up to date, audited 17 packages in 1s; found 0 vulnerabilities
npm test      → tests 80 · pass 80 · fail 0 · duration ~426ms
npm run i18n  → 481 keys (uk 481 · en 481 · ru 481) · Clean.
node --check  → 38/38 JS файлів без syntax-error
build/typecheck/lint → відсутні в проєкті (vanilla JS, без TS/ESLint/CI)
```

Нічого не падає → жодного P0 на цьому кроці з боку інструментів.
**Прогалина процесу (не P0, але ризик):** немає build/typecheck/lint/CI — регресії ловляться лише тестами (80) і `node --check`. Клієнтський inline-JS у HTML взагалі не покритий статичною перевіркою.

---

## 5. Найризикованіші зони — копати першими

1. **Telegram bot token / webhook у проді.** Локальний token дає `getMe → 401`. Від нього залежать 100% initData-перевірок (`telegram.js:22`), Stars-webhook і нотифікації. Найвищий ризик × повна невідомість. Копати першим.
2. **Vercel env-набір.** `OWNER_TELEGRAM_ID`, `CRON_SECRET`, `BOT_USERNAME`, `APP_URL` відсутні локально — треба підтвердити в проді, інакше тихо ламаються /stats, retention-cron, реф-лінки. І перевірити, що `ALLOW_FAKE_AUTH` там **не** заданий (обхід автентифікації).
3. **Мовна консистентність не-UA трафіку.** Клієнт-UI ловить English, але API не отримує `lang` → AI-контент і нотифікації українською. Прямий удар по activation платного не-UA трафіку.
4. **Cold-start ліквідність.** `MIN_SCORE=6` + вузькі фільтри (`matching.js`) на малій базі = порожні метчі/feed для першої когорти. Стратегія запуску, не баг.
5. **Залежність від Nominatim (OSM).** Єдина не-Telegram/не-своя third-party у клієнті (`onboarding.html:462`), без ключа й SLA; має fallback на ручний ввід — перевірити, що fallback справді не блокує онбординг під навантаженням/rate-limit OSM.

> Детальні знахідки з пріоритетами — у попередньому звіті цієї сесії; ця фаза лише карта.
