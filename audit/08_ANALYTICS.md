# ФАЗА 8 — Аналітика та трекінг для платного трафіку

**Статус за замовчуванням: P0.** Якщо трекінг зламано — рекламний бюджет
витрачається наосліп. Нижче — що реально є, чого немає, і що це коштує.

**Метод:** статичний аналіз (grep по всьому дереву) + живий запуск (`npm run dev`,
перехоплення мережі в браузері). Технічні терміни/код — англійською.

---

## 0. Головний висновок (TL;DR)

**Зовнішнього рекламного трекінгу НЕМАЄ ЖОДНОГО.** Ні Meta Pixel, ні Meta CAPI,
ні Google Ads / Enhanced Conversions, ні TikTok Pixel, ні GA4/GTM, ні
PostHog/Amplitude/Mixpanel/Segment. Уся аналітика — **внутрішня**: таблиця
`analytics_events` у Supabase + дашборд `/stats` у боті.

Це **не баг у коді** — це **свідома архітектура** під Telegram Mini App
(атрибуція через deep-link `?start=<src>`, а не через cookie/pixel). Для
**Telegram Ads** цього майже достатньо. Для **Meta / Google / TikTok** —
**ні**: ці платформи оптимізують показ за conversion-сигналом (Pixel/CAPI),
якого тут фізично немає, тож ви зможете крутити тільки traffic/click-кампанії,
а не purchase-optimized. Це найдорожче обмеження перед запуском.

---

## 1. Таксономія подій — Є ЄДИНА СХЕМА (це сильна сторона)

Єдиний реєстр подій, whitelist, typo-захист — `api/_lib/events.js:13-25`:

```js
export const EVENTS = {
  START:'start', ONBOARDING_COMPLETE:'onboarding_complete',
  FIRST_LIKE:'first_like', FIRST_MATCH:'first_match',
  RETURN_D1:'return_d1', RETURN_D3:'return_d3', RETURN_D7:'return_d7',
  PAYWALL_OPEN:'paywall_open', PURCHASE:'purchase',
};
const KNOWN = new Set(Object.values(EVENTS));  // невідома подія — відкидається
```

Усі події та точки відправлення (усе — **server-side**, окрім `paywall_open`):

| Подія | Де шлеться (`file:line`) | Тригер | Дедуп |
|---|---|---|---|
| `start` | `_lib/analytics.js:190` (`trackStart`, `events.js:54`) | `/start` у webhook | ні (повтори — сигнал) |
| `onboarding_complete` | `profile.js:70` | профіль згенеровано й збережено | так (partial unique index, mig 033) |
| `first_like` | `interact.js:159` | перший лайк | так |
| `first_match` | `interact.js:200-201` (обидві сторони) | взаємний метч | так |
| `paywall_open` | `interact.js:482` (`CLIENT_EVENTS`, :473) | відкриття магазину | ні |
| `purchase` | `interact.js:278` + `:751` (AI-звіт) | реальна покупка | ні (повтори — сигнал) |
| `return_d1/d3/d7` | `me.js:131` (`trackReturn`→RPC `track_return`) | app-open на D1/D3/D7 | так (в RPC) |

**Оцінка:** архітектурно чисто. Всі гроше-/воронко-критичні події деривуються
**на сервері з самої дії**, а не з клієнта (`interact.js:470-472`: «a client that
can post arbitrary events is a client that can fake the funnel»). Клієнт може
надіслати рівно одну подію — `paywall_open` — і та в whitelist. Підробити воронку
з фронта неможливо. Це **краще**, ніж 90% продуктів на pixel-only трекінгу.

---

## 2. Ключові події воронки — присутні, з поправкою на модель

Стандартний чекліст воронки проти реальності:

| Канон | Є? | Відповідник тут |
|---|---|---|
| page_view / app_open | ✅ | `return_d*` + `last_active` на кожен `/api/me` |
| signup_start | ✅ | `start` (top of funnel, ще до `users` row) |
| signup_complete | ✅ | `onboarding_complete` |
| activation | ✅ | `first_like` / `first_match` |
| trial_start | n/a | немає trial-моделі (Premium — разовий) |
| **purchase** | ✅ | `purchase` (+ реальний ledger, див. §3) |
| subscribe | n/a | немає підписки (разовий Premium) |
| churn | ⚠️ | явної події немає; деривується з відсутності `return_d*` |

**Немає P0-діри у складі подій.** Воронка `start → onboarding → like → match →
paywall_open → purchase` повна й вимірна (рендериться в `analytics.js:360-389`
`renderFunnel`, з % кроку відносно попереднього — чесно показує, де відвал).

---

## 3. `purchase`: value / currency / transaction_id / дедуп

**Подія `analytics_events.purchase` несе лише `{ item }`** (`interact.js:278`,
`:751`) — **без `value`, без `currency`, без `transaction_id`**. Для **зовнішнього**
conversion-трекінгу цього було б замало.

АЛЕ реальні гроші живуть не тут, а в ledger — `_lib/analytics.js:220-257`
`creditSuccessfulPayment`:
- `value` = `sp.total_amount` (сума в XTR/Stars, з боку Telegram, ніколи не з клієнта — `:229`);
- `currency` = XTR (Stars) неявно;
- `transaction_id` = `telegram_payment_charge_id` (`:230`);
- **дедуплікація/ідемпотентність** = RPC `credit_stars_deposit` ідемпотентний
  по `charge` (`:242-250`), тож ределівер webhook — тихий no-op, подвійного
  нарахування грошей бути не може.

**Оцінка (внутрішньо):** ✅ гроші рахуються коректно й ідемпотентно.
**Оцінка (зовнішньо):** дедуп «pixel vs server-side через `event_id`» — **не
застосовне**, бо pixel-каналу немає взагалі. Коли з'явиться CAPI (див. §9),
`event_id` для дедупу треба буде взяти саме з `telegram_payment_charge_id` — він
уже унікальний і вже під рукою. Валюта у CAPI-події має бути **не XTR**
(рекламні платформи його не знають), а перерахована у USD/EUR за курсом Stars.

---

## 4. Meta CAPI / Google Enhanced Conversions / server-side — НЕМАЄ

**Доказ (grep по всьому дереву, production-файли):** жодного `fbq`, `gtag`,
`dataLayer`, `ttq`, `fbevents`, `connect.facebook.net`, `capi`,
`conversions_api`, `google-analytics`, `gtm`. У `.env.example` (весь файл, 28
рядків) — **немає жодного** `META_PIXEL_ID` / `META_CAPI_TOKEN` /
`GOOGLE_ADS_*` / `TIKTOK_*`. Інфраструктура під це навіть не заведена.

> Збіги grep на `pixel`/`analytics`/`clarity` — хибні: `i18n.js:716`
> `'📊 Digital Twin analytics'` (текст лейбла), а `clarity-app/` — окремий
> **React-прототип, НЕ підключений до бекенду** (`clarity-app/README.md:7-8`:
> «This is an evaluation prototype: it is NOT wired to the Sixtio backend»), у
> прод не деплоїться.

**Тестові події / підписи / токени:** перевіряти нічого — інтеграцій нема.

**Живе підтвердження (RULE 4).** Підняв `npm run dev`, відкрив `/index.html`,
перехопив мережу. На boot застосунок робить рівно:
```
POST http://localhost:5173/api/me → 200        (×2)
GET  /index.html, /i18n.js?v=43, /theme.js?v=43, /theme.css?v=43 → 200
```
**Жодного** запиту на `facebook.com`, `google-analytics.com`, `tiktok`,
`connect.facebook.net` чи будь-який третій домен. Пікселя фізично нема що
перехоплювати — підтверджено і статикою, і трафіком.

---

## 5. Атрибуція: click-id, крос-девайс, відкладена покупка

**Модель атрибуції** — deep-link source-теги (`_lib/sources.js`), не cookie:

- **Джерело зберігається до покупки?** ✅ ТАК і назавжди. `users.source`
  ставиться раз при реєстрації (`sources.js:113` `applySourceOnRegistration`),
  ніколи не перезаписується (`.is('source', null)`, `:136`). Покупка через
  дні/тижні join'иться на `users.source` → **відкладена покупка атрибутується
  коректно** на рівні кампанії.
- **Крос-девайс?** ✅ ТАК, безкоштовно. Ідентифікатор — Telegram id, а не cookie;
  один акаунт = одна людина на всіх пристроях. Це **перевага** над web-pixel.

**⚠️ ВИТІК-1 (P1, з Фази 2, підтверджую) — click-id не долітає.**
`SOURCE_RE = /^[A-Za-z0-9_-]{1,64}$/` (`sources.js:14`). Meta `fbclid` (~100+
символів), Google `gclid` (~90), TikTok `ttclid` — **довші за 64 та/або містять
неприпустимі символи** → відкидаються як «organic». Наслідок: ви можете
атрибутувати трафік лише до рівня **кампанії/креативу** (тег `tgads1`), але
**не до конкретного кліку**. Без click-id **CAPI не зможе зіставити покупку з
показом реклами** → Meta/Google не зможуть навчати оптимізацію на конверсії.
**Це блокер саме для conversion-кампаній.**
Фікс (~0.5 дня): нова колонка `users.click_id` (без обмеження 64), окремий
парсинг start-payload у форматі `src__clickid`, збереження повного click-id
поруч із коротким `source`.

**⚠️ ВИТІК-2 (P2, з Фази 2) — вхід через `?startapp=` не рахується як клік.**
`start` пишеться лише з webhook `/start` (`analytics.js:190`); прямий Mystery
Mini App `?startapp=SRC` реєстрацію атрибутує, але подію `start` не створює →
`clicks` у `source_stats` занижені → CVR роздутий. Фікс ~2 год (писати `start`
при першій реєстрації через start_param).

---

## 6. Консент-гейтинг трекерів (GDPR / ePrivacy)

Трекерів третіх сторін немає → **cookie-consent банер під трекінг не потрібен**
(немає чого гейтити; нема ризику «стрельнули до згоди»). Це знімає цілий клас
GDPR/ePrivacy-ризиків, з якими б'ються pixel-продукти.

Застереження для Фази 32 (легал): якщо CAPI/Pixel таки додаватимуть — тоді
з'явиться вимога до консенту й до privacy-policy. Наразі єдиний «консент» у
продукті — Dark Mode 18+ (не трекінговий).

**Потребує перевірки юристом**, бо: передача Telegram id + факту покупки у Meta
CAPI = передача персональних даних третій стороні (GDPR ст. 6/44), і вимагає
законної підстави + розкриття в політиці. Джерело вимоги: GDPR Art. 6, Meta
Business Tools Terms.

---

## 7. PII у подіях

Перевірив props кожної події:

| Подія | props | PII? |
|---|---|---|
| `start` | `{ tg: String(telegramId) }` (`events.js:63`) | Telegram id (псевдо-ID) |
| `onboarding_complete`/`first_like`/`first_match`/`paywall_open` | `{}` | немає |
| `purchase` | `{ item }` (`interact.js:278`) | немає |

**email / телефон / ім'я у подіях не летять — бо їх у продукті взагалі немає**
(Telegram-auth, без реєстрації email/пароль). Telegram id — псевдо-ідентифікатор,
лишається всередині власного Supabase, третім сторонам не передається. Вимоги
хешувати немає, бо немає зовнішнього отримувача. **Коли з'явиться CAPI** —
Telegram id **не можна** слати в сирому вигляді; Meta вимагає SHA-256 хеш
`external_id`. Зафіксувати як умову впровадження CAPI.

---

## 8. Дашборди: CAC / CR по кроках / ROAS

| Метрика | Є завтра? | Де / чому ні |
|---|---|---|
| **CR по кроках воронки** | ✅ ТАК | `/stats` → блок ВОРОНКА (`renderFunnel`, кожен крок % від попереднього) + `/stats_sources` (clk→reg→key→cvr по джерелах) |
| Утримання D1/D3/D7 | ✅ ТАК | `/stats` → блок УТРИМАННЯ |
| Дохід (усього/період/MoM) | ✅ ТАК | `/stats`, `/stats` MoM |
| **CAC** | ❌ НІ | ніде не вводиться рекламний **spend**. Рахується лише вручну: spend з Ads Manager ÷ `registrations` із `/stats_sources` по джерелу |
| **ROAS** | ❌ НІ (напівавтомат) | `source_stats` показує `key_action`=match\|paid (`sources.js:184`), але **не revenue по джерелу** → дохід/кампанію не видно; ROAS рахується лише зшиванням двох звітів руками |

**Мінімальний набір, якого бракує (сформулював):**
1. **Revenue по джерелу** — додати у `source_stats` RPC суму Stars-депозитів,
   join `stars_ledger → users.source`. Тоді ROAS = revenue_source / spend_source.
2. **Поле spend** — маленька таблиця `ad_spend(source, date, amount_usd)`, що
   заповнюється вручну (або імпортом), щоб `/stats_sources` рахував CAC і ROAS
   сам, а не в голові.
3. Курс Stars→USD (одна константа env) — щоб revenue у ⭐ звести до грошей для
   ROAS/CAC.

---

## 9. Що зробити ДО платного трафіку (пріоритети)

| # | P | Проблема | Money-impact | Фікс | Час |
|---|---|---|---|---|---|
| A | **P0** | Нема conversion-сигналу назад у Meta/Google/TikTok (нема CAPI) | Не можна крутити purchase-optimized кампанії → CPA у рази вищий; алгоритм платформи «сліпий» | Server-side CAPI: на `purchase` (`interact.js:278`) POST у Meta CAPI з `event_id=telegram_payment_charge_id`, hashed `external_id`, value в USD. Без нового `api/*.js` — через `op`/утиліту в `_lib` | 1–2 дні на канал |
| B | **P1** | ВИТІК-1: click-id обрізається (`sources.js:14`) → CAPI нічого зіставити | Без click-id A-фікс дає слабку атрибуцію (тільки за `external_id`) | `users.click_id` + парсинг `src__clickid` у start-payload | ~0.5 дня |
| C | **P1** | Revenue/spend по джерелу відсутні → нема ROAS/CAC у дашборді | Рішення про масштабування кампаній — наосліп | `ad_spend` таблиця + revenue-join у `source_stats` + курс Stars→USD | ~1 день |
| D | **P2** | ВИТІК-2: `?startapp=` не рахується як `start` | Криві `clicks`/CVR у `source_stats` | писати `start` при реєстрації через start_param | ~2 год |

**Порядок для мінімального запуску:** якщо перший канал — **Telegram Ads**, то
A/B не обов'язкові (Telegram-атрибуція вже працює через `?start=`), достатньо
**C + D**, щоб бачити ROAS/CAC — і можна запускатися. Якщо перший канал —
**Meta/Google/TikTok**, то **A + B — блокери**: без них платите за кліки без
жодного навчання оптимізації.

---

## 10. НЕ ЗМІГ ПЕРЕВІРИТИ

1. **Реальний payload у Meta/Google** — нема інтеграції, перехоплювати нічого
   (доведено §4). Коли додасте CAPI — перевірити через Meta Events Manager →
   Test Events (там видно кожну подію й помилки підпису).
2. **Точна поведінка Telegram щодо `/start` при вході через `?startapp=`**
   (успадковано з Фази 2, НЕ ЗМІГ #1) — треба відкрити `t.me/Sixtiobot/app?startapp=test1`
   на чистому акаунті й глянути у Vercel-логах, чи спрацював `trackStart`. Впливає
   на масштаб ВИТІК-2.

---

## Підсумок

Внутрішня аналітика — **зріла й чесна**: єдина схема подій, server-side деривація
(підробити воронку з клієнта не можна), ідемпотентні гроші, крос-девайс-атрибуція
безкоштовно, воронка + утримання + MoM у `/stats`. Класу «трекінг зламано, льєм
наосліп» **немає** — для Telegram Ads все на місці (лишаються C+D для ROAS/CAC).

**Але для Meta/Google/TikTok продукт не готовий:** немає conversion-каналу (CAPI)
і не долітає click-id. Це не поломка, а свідомо не збудований шар — його треба
збудувати (A+B) **перед** першим доларом у ці платформи, інакше алгоритми
оптимізації працюватимуть наосліп і CPA буде кратно вищий.
