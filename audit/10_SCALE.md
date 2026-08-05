# ФАЗА 10 — Навантаження та масштабування (10 000 користувачів з реклами)

Read-only аудит. Кожна знахідка з доказом (`файл:рядок` + цитата) або позначена
`НЕ ЗМІГ ПЕРЕВІРИТИ`. Прогноз порахований скриптом
`scratchpad/phase10_load.mjs` — реальний вивід у §9.

---

## 0. TL;DR

| # | P | Область | Суть |
|---|---|---------|------|
| **SCALE-1** | **P0** | БД / egress | `calculate_compatibility` **без LIMIT** — повертає ВЕСЬ scored-набір профілів на КОЖЕН `/api/feed` і `/api/me`. При 10k профілів це **1.3 МБ на виклик × 30 000 викликів = 39 ГБ/добу** трафіку Postgres→lambda. Навантаження росте як **O(N²)**. |
| **SCALE-2** | **P0** | N+1 | `api/me.js` робить **3 послідовні запити на КОЖЕН матч** (partner, profile, last message). 8 матчів = 35 запитів у одному HTTP-виклику, ~0.9 с чистого RTT ще до AI. |
| **SCALE-3** | **P1** | БД | `api/feed.js` тягне **всіх кандидатів без `.limit()`**, будує повний ranked-масив, і лише потім робить `.slice(offset)`. Кожна сторінка infinite-scroll = повний перерахунок з нуля. |
| **SCALE-4** | **P1** | Зовнішні API | **Ніде немає таймаутів, ретраїв, backoff чи circuit breaker.** Жодного `AbortController`. Підвислий Anthropic/Gemini тримає функцію всі 30 с. |
| **SCALE-5** | **P1** | AI-вартість | Немає довічного AI-бюджету на юзера. Rate limit — **in-memory, fail-open, per-instance**. Один абузер = **$46/добу** на теплому інстансі, і це не стеля. (= ALG-3 з Фази 9) |
| **SCALE-6** | **P2** | Записи | `last_active` оновлюється на **кожен** `/api/me` і `/api/feed` → ~150k UPDATE/добу по таблиці `users`, на якій висить 3 GIN-індекси. |
| **SCALE-7** | **P2** | Кеш / CDN | Фото віддаються з Supabase Storage з `?v=<timestamp>` — **кеш-бастер на кожне завантаження фото**, CDN-хіти лише до наступної зміни фото. HTML має `no-store`. |
| **SCALE-8** | **P3** | Дубль-запит | `getHiddenUserIds` викликається **двічі** за один `/api/me` (рядок 222 і всередині `getPendingLikers`). |
| **INFO-1** | ✅ | Пул з'єднань | **Проблеми немає.** `supabase-js` ходить через PostgREST по HTTPS, не тримає Postgres-конекшени з lambda. Стеля — пул самого PostgREST. |
| **INFO-2** | ✅ | Ідемпотентність оплат | **Зроблено правильно.** `credit_stars_deposit` ідемпотентний по `telegram_payment_charge_id`. |
| **INFO-3** | ✅ | Захист від ботів | **Зроблено правильно.** 11 з 12 ендпоінтів під HMAC-перевіркою Telegram `initData`. |

---

## 1. N+1, повні скани, важкі запити на гарячих шляхах

### SCALE-1 (P0) — `calculate_compatibility` без LIMIT

`supabase/migration-027-compatibility-v2.sql:82-87`:
```sql
  from public.profiles p
  join public.users u on u.id = p.user_id
  cross join me
  where p.user_id <> current_user_id
    and p.trait_extraversion is not null          -- only fully-scored profiles
  order by compatibility_score desc;
```
Немає ні `LIMIT`, ні фільтра за статтю/віком/містом. Функція рахує
`sqrt`/`power` для **кожного** scored-профілю в базі, сортує весь набір і
серіалізує його в JSON.

Викликається на двох найгарячіших шляхах:
- `api/feed.js:116-119` — на кожне завантаження стрічки, **включно з кожною сторінкою** пагінації
- `api/me.js:196-199` — на кожен відкрив застосунку

Це єдина знахідка з **нелінійним** профілем: вартість одного запиту ~ O(N),
кількість запитів ~ O(N) → сумарне навантаження **O(N²)**. Саме тому воно
непомітне сьогодні й вибухає рівно там, куди веде реклама:

```
 1,000 профілів: 0.13 МБ/виклик ×  30 000 = 3.9 ГБ/добу   (зараз — невидимо)
10,000 профілів: 1.30 МБ/виклик ×  30 000 = 39 ГБ/добу    (ціль реклами)
50,000 профілів: 6.50 МБ/виклик ×  30 000 = 195 ГБ/добу
```

Крім egress — це ще CPU Postgres (10k × sqrt+power+sort на виклик) і
десеріалізація 10k JSON-об'єктів у lambda на кожен виклик.

**Fix:** додати параметри й `LIMIT` у RPC — рахувати сумісність лише для тих
кандидатів, які реально потрібні (у feed це вже відфільтрований набір, у me —
рівно список партнерів по матчах). Сигнатура міняється, але викликів усього
два. ~1 день з тестами.

### SCALE-2 (P0) — N+1 у `api/me.js`

`api/me.js:228-247` — цикл по матчах, три `await` **послідовно** всередині:
```js
    for (const m of rows) {
      if (hidden.has(m.partnerId)) continue;
      const { data: partner } = await supabase
        .from('users')
        .select('name, age, city, goal, interests, bio, bio_i18n, ...')
        .eq('id', m.partnerId)
        .maybeSingle();
      ...
      const { data: partnerProfile } = await supabase
        .from('profiles')
        ...
      const { data: lastRows } = await supabase
        .from('messages')
        ...
```

Порахунок з коду: базових запитів у `/api/me` — 11, плюс `3 × кількість матчів`.
При 8 матчах — **35 запитів у одному HTTP-виклику**, всі послідовні. При RTT
~25 мс до Supabase це **~0.9 с** чистого очікування БД ще до `localizeProfiles`
(яка додає Gemini-виклик без таймауту, див. SCALE-4).

**Fix:** три batched-запити замість 3×M — `.in('id', partnerIds)` для users і
profiles, і один запит по messages з `.in('match_id', matchIds)`. ~0.5 дня.

### SCALE-3 (P1) — стрічка без `.limit()` + повний перерахунок на кожну сторінку

`api/feed.js:134-141`:
```js
    let candQuery = supabase
      .from('users')
      .select('id, name, gender, seeking_gender, age, city, photo_url, ...')
      .neq('id', me.id)
      .eq('shadow_hidden', false);
    if (me.seeking_gender && me.seeking_gender !== 'any') candQuery = candQuery.eq('gender', me.seeking_gender);
    if (me.age) candQuery = candQuery.gte('age', me.age - MAX_AGE_GAP).lte('age', me.age + MAX_AGE_GAP);
    const { data: candidates, error: candError } = await candQuery;
```
Індекс `users_gender_age_idx` (migration-024) є, і префільтр по статі+віку
працює — але **`.limit()` немає**. У 10k-базі типовий чоловік 25 років
отримає всіх жінок 15–35 — тисячі рядків з `photo_url`, `bio`, `kink_markers`,
`interests` на кожен виклик.

Гірше — пагінація застосовується **після** повної побудови (`api/feed.js:218-220`):
```js
    const start = Math.max(0, parseInt(offset, 10) || 0);
    const size = Math.min(50, Math.max(1, parseInt(limit, 10) || DEFAULT_LIMIT));
    const page = ranked.slice(start, start + size);
```
Тобто `offset=100` виконує рівно ту саму роботу, що `offset=0`: повне
завантаження кандидатів + повний `calculate_compatibility` + повне сортування.
Infinite scroll множить SCALE-1 на кількість прокруток.

**Fix:** `.limit(200)` на candQuery + серверний курсор замість offset-перерахунку.

### SCALE-8 (P3) — дубльований запит блок-листа

`api/me.js:222` викликає `getHiddenUserIds(user.id, user.blocked_users)`, а
далі `api/me.js:336` викликає `getPendingLikers(user)`, який на
`api/_lib/supabase.js:258` **знову** робить `getHiddenUserIds` — той самий
`users .contains('blocked_users', [userId])` двічі за запит.

### Індекси — стан добрий

Перевірено всі 23 `create index` у `supabase/`. Гарячі шляхи покриті:
- `users.telegram_id` — `unique not null` (`schema.sql:6`) → унікальний індекс
- `users (gender, age)` — migration-024 → префільтр стрічки
- `users.liked_users` GIN — migration-031 → `getPendingLikers`
- `users.blocked_users` GIN — migration-022 → `getHiddenUserIds`
- `messages (match_id, created_at)` — migration-004 → прев'ю чату
- `matches (user_a)` / `(user_b)` — migration-003 → `.or()` йде BitmapOr
- `profiles (trait_extraversion) where not null` — migration-007

Відсутнього індексу, який би зараз щось ламав, **не знайшов**. Проблема не в
індексах, а в тому, що два запити свідомо не обмежені.

---

## 2. Ліміт з'єднань до БД vs кількість lambda. Пул.

**INFO-1 — тут проблеми немає, і це варто зафіксувати, щоб не «чинити».**

`api/_lib/supabase.js:3-14`:
```js
let client;
export function getSupabase() {
  if (!client) {
    client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
  }
  return client;
}
```
Модульний singleton — один клієнт на теплий інстанс. Головне: `supabase-js`
спілкується з PostgREST по HTTPS, а **не** відкриває Postgres-конекшени. Тому
класична serverless-проблема «300 lambda × 1 конекшн = вичерпаний
`max_connections`» тут **не виникає** — pooler не потрібен, PgBouncer не
потрібен.

Реальна стеля — внутрішній пул самого PostgREST і CPU інстанса Postgres. І
впремося ми в неї не через кількість lambda, а через SCALE-1/SCALE-2: 61 запит/с
у піку (§9), де частина запитів — повні скани.

**НЕ ЗМІГ ПЕРЕВІРИТИ:** фактичний тариф Supabase-проєкту й розмір `db-pool`
PostgREST — це налаштування дешборду, не репозиторію. **Як перевірити вручну:**
Supabase Dashboard → Settings → Compute and Disk (план) і Database → Connection
pooling (`Pool Size`). Якщо план Free/Nano — SCALE-1 покладе його першим.

---

## 3. Кешування, TTL, інвалідація, CDN

**Що кешується (`vercel.json:7-32`):**
```json
{ "source": "/(.*)\\.html", "headers": [{ "key": "Cache-Control", "value": "no-cache, no-store, must-revalidate" }] },
{ "source": "/(i18n|theme|paywall)\\.js", "headers": [{ "key": "Cache-Control", "value": "no-cache, must-revalidate" }] }
```
- HTML — `no-store`: свідомо, щоб `?v=` не залипав. Ок для мультисторінкового
  застосунку, але означає, що **кожне відкриття тягне HTML з origin**.
- Спільні ассети — `no-cache, must-revalidate` + `?v=43` cache-buster. Тобто
  на кожне відкриття йде **revalidation-запит** (304), а не кеш-хіт. З `?v=`
  це надлишково: cache-buster уже гарантує інвалідацію, тому тут безпечно
  ставити `max-age=31536000, immutable` і прибрати 4 зайві round-trip на
  кожне відкриття. Дешевий і безризиковий виграш.
- **API-відповіді не кешуються взагалі** — і не мають, вони персональні.

**SCALE-7 (P2) — фото.** `api/photo.js:68`:
```js
    const photoUrl = `${supabase.storage.from('photos').getPublicUrl(`${userId}.jpg`).data.publicUrl}?v=${stamp}`;
```
`stamp = Date.now()` на момент завантаження, зберігається в `users.photo_url`.
Тобто URL стабільний між завантаженнями фото — CDN Supabase кешуватиме його
нормально, і інвалідація при зміні фото працює правильно. Це **коректно**.

Ризик інший: фото віддає **Supabase Storage CDN**, і кожен перегляд стрічки
тягне 20 фото. При 12 000 завантажень стрічки/добу × 20 фото це ~240k
запитів до Storage/добу. **НЕ ЗМІГ ПЕРЕВІРИТИ:** ліміти Storage egress на
поточному тарифі. **Як перевірити:** Dashboard → Reports → Storage egress.

**Чого немає взагалі:** кешу для `calculate_compatibility`. Результат
детермінований від пари трейт-векторів, які змінюються раз на життя профілю —
тобто це ідеальний кандидат на матеріалізацію, а рахується з нуля 30 000
разів на добу.

---

## 4. Rate limiting і захист від ботів

**INFO-3 — захист від ботів сильний.** `api/_lib/telegram.js:22-24`:
```js
  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (computed !== hash) return null;
```
Це стандартна перевірка Telegram `initData`. Підробити її без `BOT_TOKEN`
неможливо, тобто **анонімний скрапінг/флуд по API виключений**. 11 з 12
ендпоінтів під нею (перевірено grep'ом по `api/*.js`). Виняток — `api/geo.js`,
який просто повертає заголовки Vercel і **не торкається БД**:
```js
export default function handler(req, res) {
  const rawCity = req.headers['x-vercel-ip-city'];
```
Ризику немає.

**SCALE-5 (P1) — але сам rate limit слабкий.** `api/_lib/ratelimit.js:1-9`
чесно це декларує:
```js
// Why in-memory (not Redis/DB): each Vercel instance keeps its own sliding-window
// log. ... cold starts reset the window (fail-open),
```
Наслідки під рекламним трафіком: Vercel піднімає багато інстансів,
кожен зі своїм `Map`. Ліміт `ai_heavy = 40/год` — це 40/год **на інстанс**.
Абузер, що б'є з паузами (щоб потрапляти на холодні старти), обходить його
повністю. При цьому 40 регенерацій профілю/год на одному теплому інстансі
вже коштують **$46.56/добу** (§9 §5).

Немає **жодного** довічного бюджету на юзера: ні лічильника AI-викликів у БД,
ні перевірки перед `generateProfile`. Це той самий ALG-3 із Фази 9.

**Fix:** лічильник `ai_calls_total` на `users` + атомарний guarded-інкремент
у RPC (той самий патерн, що вже використовується для Stars). ~0.5–1 день.
Це єдиний захист, який працює крізь інстанси.

---

## 5. Таймаути, ретраї з backoff, circuit breaker

**SCALE-4 (P1) — нічого з цього немає.**

```
$ grep -rn "AbortController|signal:|retry|backoff" api/ --include=*.js
(жодного збігу по AbortController / signal / backoff — лише retryAfterSec
 з ratelimit.js та коментарі про Telegram-ретраї)
```

Конкретно:
- `api/_lib/gemini.js:6` — голий `fetch(...)` без `signal`
- `api/_lib/translate.js:53` — голий `fetch(...)` без `signal`
- `api/_lib/kink.js:57`, `api/_lib/personality.js:97` — те саме
- `api/_lib/claude.js` — SDK Anthropic з дефолтним таймаутом (10 хв), що
  **більше** за `maxDuration: 30` у `vercel.json` — тобто таймаут SDK ніколи
  не спрацює першим; функцію вб'є Vercel.

Що це означає під навантаженням: якщо Gemini або Anthropic деградує (а під
рекламним піком це саме той момент, коли всі одночасно онбордяться), кожен
запит висить **всі 30 с** і тримає інстанс. Це класичний каскад: повільний
провайдер → всі інстанси зайняті → черга → таймаути на здорових запитах.

Фолбеки, що є:
- `api/answer.js:74-84` — Gemini → Claude fallback на followup. **Єдиний
  справжній фолбек у проєкті**, і зроблений правильно.
- `api/interact.js:738` — безкоштовний retry AI-звіту при `generation_failed`.

Фолбеків **немає** на: `generateProfile` (Opus), `scoreCandidates` (Sonnet),
`processOnboardingPersonality`, `moderatePhoto`, `localizeProfiles`.

Circuit breaker відсутній повністю — якщо провайдер лежить, кожен запит все
одно йде до нього й чекає 30 с.

**Fix:** `AbortController` з таймаутом 8–12 с на всі `fetch` + `timeout` в
конструкторі Anthropic-клієнта. ~2 години. Це найдешевша з усіх P1-правок і
знімає найгірший режим відмови.

---

## 6. Ідемпотентність вебхуків (оплата!)

**INFO-2 — зроблено правильно, це найкраще місце в системі.**

`supabase/migration-018-stars-deposits.sql:42-49`:
```sql
  -- Idempotency gate: a redelivered webhook for the same charge inserts nothing.
  insert into public.star_deposits (charge_id, user_id, stars, payload)
  values (p_charge, p_user, p_stars, p_payload)
  on conflict (charge_id) do nothing;

  if not found then
    return null;                       -- already credited this payment; do not repeat
  end if;
```
Ключ ідемпотентності — `telegram_payment_charge_id` (PRIMARY KEY), тобто
глобально унікальний ідентифікатор платежу від Telegram. При at-least-once
доставці повторний вебхук — тихий no-op. **Подвійне зарахування грошей
неможливе.**

Сума береться з `sp.total_amount` самого Telegram, не з клієнта
(`api/_lib/analytics.js:229`):
```js
    const stars = Number(sp.total_amount || 0);  // XTR total = whole Stars paid
```

`pre_checkout_query` відповідається одразу (`analytics.js:139-144`), у межах
10-секундного вікна Telegram. Webhook завжди повертає 200
(`analytics.js:207-210`), щоб Telegram не ретраїв — правильно для ідемпотентного
обробника.

**Єдине зауваження — не про масштаб, а про доступ.** `analytics.js:127-130`:
```js
    // Security note: authorization relies EXCLUSIVELY on isOwner(from) — a
    // hardcoded numeric Telegram id — so the WEBHOOK_SECRET header gate was
    // removed to eliminate setWebhook-secret sync as a failure mode.
```
Тобто `secret_token` на вебхуці немає свідомо. Це та сама знахідка **P12-1**
з Фази 12 — не дублюю її тут, лише підтверджую, що вона все ще актуальна.
Під рекламним трафіком вона стає трохи гострішою: хто знає URL, може
надсилати підроблені `successful_payment`. Ідемпотентність від цього не
рятує — вона захищає від дублів, не від підробок.

---

## 7. Черги: backpressure, dead letter, повтори

**Черг немає взагалі.** Ані брокера, ані таблиці-черги, ані Vercel Queue.
Уся робота синхронна в межах HTTP-запиту.

Що виконується синхронно, хоч за природою фонове:
- `api/profile.js:95` — `runMatching()` (Claude Sonnet, 4000 max_tokens) прямо
  всередині запиту генерації профілю
- `api/me.js:316` — `localizeProfiles()` (Gemini) на кожен відкрив застосунку
- `api/photo.js:50` — модерація фото блокує завантаження

Backpressure реалізовано лише через `maxDuration: 30` — тобто «черга»
переповнюється у вигляді 504 користувачу. Dead letter немає: якщо
`runMatching` впав, він просто логується й губиться
(`api/profile.js:96-98`):
```js
    } catch (matchError) {
      console.error('matching failed:', matchError.message);
    }
```
Користувач не дізнається, що матчинг не відбувся, і повтору не буде ніколи.

Єдиний ретрай-механізм у системі — `cron_retention_trigger`
(`api/me.js:474-500`) з `RETENTION_BATCH = 50`, який свідомо батчиться й
«доливає» решту наступним тіком. Це правильний патерн — але застосований
лише тут.

**Оцінка:** для 10k користувачів відсутність черг — прийнятно, це не блокер.
Але це прямий наслідок ліміту 12 функцій Vercel Hobby: додати воркер ніде.
Позначаю як архітектурне обмеження, а не як баг.

---

## 8. Квоти третіх сторін і вартість на 1000 користувачів

**Ціни Anthropic (звірено з довідником API, кеш 2026-06-24):**
`claude-opus-4-8` — $5 / $25 за 1M токенів (in/out);
`claude-sonnet-5` — $3 / $15 (діє інтро $2 / $10 до 2026-08-31).

**НЕ ЗМІГ ПЕРЕВІРИТИ:** ціни Google на `gemini-2.5-flash` — узяв $0.30 / $2.50
за 1M як робоче наближення. **Як перевірити вручну:** ai.google.dev/pricing.
На підсумок це майже не впливає — Gemini дає 6% витрат.

**Вартість AI на одного онбордженого користувача** (§9 §4):

| Виклик | Модель | $/юзер |
|--------|--------|--------|
| 5 × followup (`api/answer.js:75`) | gemini-2.5-flash | $0.0024 |
| Digital Twin (`claude.js:126`, max_tokens 2500) | **claude-opus-4-8** | **$0.0485** |
| Big Five (`personality.js:96`) | gemini-2.5-flash | $0.0015 |
| Модерація фото (`photo.js:50`) | gemini-2.5-flash | $0.0005 |
| Матчинг (`claude.js:193`, max_tokens 4000) | claude-sonnet-5 | $0.0210 |
| **РАЗОМ** | | **$0.0739** |

### **≈ $74 на 1000 онбурджених користувачів**

Структура: **Opus 66%, Sonnet 28%, Gemini 6%.**

При 1000 онбурджених/добу — **$74/добу ≈ $2 217/місяць** тільки на AI, і це
без урахування повторних `rematch`, перекладів профілів і AI-звітів.

**Головний важіль:** 66% витрат — це один виклик Opus 4.8. Перевести
`generateProfile` на Sonnet 5 (`CLAUDE_MODEL` — вже env-змінна,
`claude.js:12`) знизило б цю статтю приблизно втричі, тобто загальну
вартість — до ~$0.04/юзер. Це продуктове рішення про якість Twin'а, не баг —
але його варто прийняти свідомо **до** запуску реклами, а не після першого
рахунку.

**Скільки витримаємо на піку:** 1000 онбордингів/добу — це ~14 AI-викликів на
кожен, тобто ~14 000 викликів/добу, у піку (20% за годину) ~0.8 виклику/с.
Це далеко від рейт-лімітів Anthropic на будь-якому платному тарифі.
**НЕ ЗМІГ ПЕРЕВІРИТИ:** фактичний tier організації в Anthropic Console і
квоту Gemini API. **Як перевірити:** Anthropic Console → Limits;
Google AI Studio → API keys → quota.

**Email/SMS — не використовуються взагалі.** Уся комунікація йде через
Telegram Bot API (`api/_lib/bot.js`), який має ліміт ~30 повідомлень/с.
Ретеншн-крон шле батчами по 50 послідовно — вписується.

---

## 9. Навантажувальний прогноз — реальний вивід

```
$ node scratchpad/phase10_load.mjs

=== INPUTS ===
clicks/day=10,000  starts=4,000  onboarded=1,000  DAU(steady)=3,000

=== 1. HTTP REQUESTS / DAY ===
    20,000  app-open (geo+me) x every click
    56,000  onboarding (profile-info,answer x10,photo,profile,analyze)
    25,000  first feed session (feed x3, swipe x20, me x2)
    90,000  returning DAU (me x2, feed x3, swipe x25)
   191,000  TOTAL requests/day
  avg 2.21 rps   peak 10.6 rps (20% of day in 1h)

=== 2. DB QUERIES / DAY (counted from source) ===
  /api/me   = 11 + 3 x 8 matches = 35 queries  <-- N+1
  /api/feed = 8 queries (2 of them UNBOUNDED)
  me=18,000 calls  feed=12,000  swipe=95,000
  TOTAL ~1,106,000 DB queries/day  (13 q/s avg, 61 q/s peak)

=== 3. calculate_compatibility EGRESS (the wall) ===
   1,000 scored profiles: 0.13 MB/call x 30,000 calls = 3.9 GB/day
   5,000 scored profiles: 0.65 MB/call x 30,000 calls = 19.5 GB/day
  10,000 scored profiles: 1.30 MB/call x 30,000 calls = 39.0 GB/day
  50,000 scored profiles: 6.50 MB/call x 30,000 calls = 195.0 GB/day

=== 4. AI COST PER 1000 ONBOARDED USERS ===
  $0.0024  5 x Gemini followup (api/answer.js:75)
  $0.0485  1 x Opus 4.8 generateProfile (claude.js:126)
  $0.0015  1 x Gemini Big Five (personality.js:96)
  $0.0005  1 x Gemini photo moderation (photo.js:50)
  $0.0210  1 x Sonnet 5 scoreCandidates (claude.js:193)
  $0.0739  per onboarded user  ->  $73.92 per 1000 onboarded
  at 1,000 onboarded/day = $73.92/day = $2217/month
  share: Opus 66%  Sonnet 28%  Gemini 6%

=== 5. ABUSE CEILING (no per-user AI budget) ===
  1 abuser x 40 profile regenerations/h x 24h = $46.5600/day (single warm instance)
  ...and the in-memory window resets per lambda instance -> effectively unbounded across instances

=== 6. SERVERLESS ===
  Vercel Hobby: 12 functions (AT CAP), maxDuration=30s (vercel.json)
  /api/me at 35 sequential queries x ~25ms RTT = ~0.9s wall clock BEFORE any AI call
  + localizeProfiles Gemini call (no timeout) on the same request
```

### Де саме впремося в стелю

**RPS — не проблема.** 2.2 rps середніх, 10.6 rps у піку. Vercel це не помітить.

**Кількість запитів до БД — на межі.** 61 запит/с у піку. Само по собі
нормально для Postgres — але лише якщо запити дешеві. Тут два з них не дешеві.

**Реальна стеля — SCALE-1.** 39 ГБ/добу egress з Postgres при 10k профілів,
плюс 30 000 повних сканів `profiles` на добу. Це впирається в CPU інстанса
Postgres задовго до того, як впреться щось інше. І це **не лінійно**: подвоєння
бази вчетверо збільшує навантаження.

**Порядок відмови під рекламою (прогноз):**
1. `calculate_compatibility` починає займати сотні мс → `/api/feed` і `/api/me` гальмують
2. Повільні запити тримають з'єднання PostgREST → пул вичерпується
3. Запити стають у чергу → частина упирається в `maxDuration: 30` → 504
4. Клієнт ретраїть → навантаження зростає, бо жодного backoff немає (SCALE-4)

**Що тримає нас від цього прямо зараз:** мала база. При 1000 профілів це
0.13 МБ/виклик і все працює. Тобто **проблема з'явиться саме тоді, коли
реклама спрацює** — це найгірший можливий момент.

### Порядок робіт (моя рекомендація)

| Пріоритет | Що | Оцінка |
|---|---|---|
| 1 | **SCALE-4** — `AbortController` + таймаути на всі AI-виклики | ~2 год |
| 2 | **SCALE-1** — `LIMIT` + фільтр у `calculate_compatibility` | ~1 день |
| 3 | **SCALE-2** — batched-запити замість N+1 у `me.js` | ~0.5 дня |
| 4 | **SCALE-5** — довічний AI-бюджет на юзера (RPC-лічильник) | ~0.5–1 день |
| 5 | **SCALE-3** — `.limit()` на стрічку + курсорна пагінація | ~0.5 дня |
| 6 | Рішення: `CLAUDE_MODEL` = Opus чи Sonnet (−66% AI-вартості) | продуктове |

Пункти 1–3 знімають режим відмови під трафіком. Без них реклама на 10k
працюватиме рівно до моменту, коли база дійде до кількох тисяч профілів.

---

## 10. НЕ ЗМІГ ПЕРЕВІРИТИ (повний список)

| Що | Чому | Як перевірити вручну |
|---|---|---|
| Тариф Supabase, розмір пулу PostgREST, ліміт egress | налаштування дешборду, не в репо | Supabase Dashboard → Settings → Compute and Disk; Database → Connection pooling |
| Реальний час виконання `calculate_compatibility` | потрібен прод із 10k профілів | `explain analyze select * from calculate_compatibility('<uuid>')` на staging із засіяними даними |
| Ліміти Storage egress для фото | тариф | Dashboard → Reports → Storage |
| Anthropic rate-limit tier організації | акаунт-налаштування | Anthropic Console → Limits |
| Квота Gemini API + актуальна ціна `gemini-2.5-flash` | акаунт + прайсинг Google | Google AI Studio → API keys; ai.google.dev/pricing |
| Реальна латентність AI-викликів проти `maxDuration: 30` | потрібні прод-логи | Vercel → Logs, фільтр по тривалості > 20 s |
| Чи справді Vercel піднімає багато інстансів (наскільки fail-open rate limit) | потрібен прод під навантаженням | Vercel → Observability → Function invocations / concurrency |
| Реальні CR (click→start→onboard) | реклами ще не було | прогноз §9 побудований на CR 40%/25% — перерахувати після перших 1000 кліків |

---

## 11. Що вже зроблено добре (щоб не переробляти)

- **Пул з'єднань не потрібен** — PostgREST-архітектура прибирає класичну
  serverless-проблему з конекшенами (`_lib/supabase.js:3-14`)
- **Ідемпотентність платежів бездоганна** — `on conflict (charge_id) do nothing`
  + сума з Telegram, не з клієнта (`migration-018:42-49`)
- **Захист від ботів на рівні криптографії** — HMAC `initData` на 11/12
  ендпоінтів (`_lib/telegram.js:22-24`)
- **Індекси на гарячих шляхах є** — включно з GIN на масивах для block/like
- **Префільтр стрічки на боці БД** — коментар у `feed.js:131-133` показує, що
  про масштаб думали: *"so we never pull the whole user table into the
  function — essential at scale"*. Бракує лише `.limit()`
- **Ретеншн-крон батчиться** (`RETENTION_BATCH = 50`) — єдине місце, де
  backpressure зроблено свідомо й правильно
- **Аналітика best-effort by construction** — `_lib/events.js:32-45` ніколи не
  валить запит користувача
- **Дедуплікація once-per-user подій у Postgres**, а не в коді — partial unique
  index замість read-before-write на гарячому шляху
