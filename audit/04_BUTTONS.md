# Sixtio — Аудит кнопок та інтерактиву (Фаза 4)

> Прохід по КОЖНОМУ клікабельному елементу з інвентарю Фази 0. Read-only.
> Дата: 2026-07-26. Метод: grep усіх `<button>`, `<a href>`, `addEventListener('click'/'submit')`
> по 10 продуктових HTML-сторінках + `paywall.js` / `theme.js`, з читанням тіла кожного хендлера.
> `clarity-app/` та `node_modules/` виключено (не частина продукту).

---

## 0. Автоматичні перевірки-«пустушки» — РЕЗУЛЬТАТ

Грепи по всьому продукту (`*.html`, корінь):

| Пошук | Патерн | Результат |
|---|---|---|
| Порожні хендлери | `=> {}`, `() => {}` | **0 збігів** |
| Заглушки | `TODO`, `FIXME`, `console.log` | **0 збігів** |
| Битий якір | `href="#"`, `href='#'` | **0 збігів** |
| Inline-onclick | `onclick=` | **0 збігів** (усе через `addEventListener`) |
| Зовн. лінк без `rel` | `target="_blank"` без `rel` | **0** — єдиний зовн. `<a>` (`conversation.html:214`) має `rel="noopener"` |

> Патерн проєкту: **немає React/onclick-атрибутів**. Кожен інтерактив — `<button type="button">`
> + `addEventListener`. Це прибирає цілий клас «кнопок-пустушок» ще на рівні архітектури.

**Головний висновок:** мертвих кнопок, битих роутів і заглушок **не знайдено**.
Єдина справжня знахідка — **5 тумблерів у Settings, що нічого не роблять на сервері**
(нижче, NO-OP-1). Усі платіжні кнопки коректно захищені від подвійного кліку.

---

## 1. Таблиця: КОЖЕН елемент

Легенда статусів: **OK** — працює як обіцяє · **NO-OP** — клікабельний, але без реального
ефекту · **NOTE** — працює, але з нюансом для іншої фази.

### index.html (лендинг)

| елемент | файл:рядок | має робити | реально робить | disabled | loading | помилка | статус |
|---|---|---|---|---|---|---|---|
| `#start` CTA | `index.html:77,105` | → onboarding | `location.href='onboarding.html'` + haptic | — | — | — | **OK** |
| Політика конф. `<a>` | `index.html:79` | → privacy.html | `href="privacy.html"` (внутр.) | — | — | — | **OK** |
| lang-switch | `index.html:61` (`i18n.js`) | зміна мови | перемальовує UI + подія `langchange` | — | — | — | **OK** |

### onboarding.html

| елемент | файл:рядок | має робити | реально робить | disabled | loading | помилка | статус |
|---|---|---|---|---|---|---|---|
| `#sendBtn` (submit) | `onboarding.html:125` | надіслати відповідь | submit-хендлер → `/api/answer`/`/api/profile` | ✅ під час запиту | ✅ (25s AbortController) | try/catch, відновлює ввід | **OK** |
| Enter→submit | `onboarding.html:671` | надіслати з клавіатури | `composer.requestSubmit()` | — | — | — | **OK** |

### matches.html (головний хаб)

| елемент | файл:рядок | має робити | реально робить | disabled | loading | помилка | статус |
|---|---|---|---|---|---|---|---|
| `#findBtn` | `matches.html:182,540` | → feed | `location.href='feed.html'` | — | — | — | **OK** |
| `#likesCard` | `matches.html:194,510` | відкрити «хто лайкнув» | `openLikers()` → `/api/interact op:likers` | — | — | `.catch` → note | **OK** |
| `.lk-pass` (у гриді) | `matches.html:372,502` | пропустити лайкера | disable→`/api/interact` | ✅ | — | `.catch` re-enable | **OK** |
| `#premiumTeaser` | `matches.html:206,516` | відкрити paywall | `SixtioPaywall.open(highlight:premium)` | — | — | — | **OK** |
| `#starsPill` | `matches.html:178,547` | Stars-шоп | `SixtioPaywall.open` | — | — | — | **OK** |
| `[data-theme-toggle]` | `matches.html:177` (`theme.js`) | зміна теми | `SixtioTheme.toggle()` | — | — | — | **OK** |
| `.lk-close` | `matches.html:368,384` | закрити грід | `close()` | — | — | — | **OK** |

### feed.html (свайп-колода)

| елемент | файл:рядок | має робити | реально робить | disabled | loading | помилка | статус |
|---|---|---|---|---|---|---|---|
| `#mysteryBtn` | `feed.html:265,806` | розблок. особу за 10⭐ | precheck балансу → `op:unlock_mystery_match` | ✅ `mysteryBusy`+`disabled` | ✅ текст «…unlocking» | `.catch` re-enable | **OK** |
| loot-box ×3 | `feed.html:280-282,856` | відкрити скриньку | `op:open_lootbox`, idемпот. на сервері | ✅ `lootBusy`+`box.disabled` | ✅ `.opening` | `.catch` re-enable | **OK** |
| `#lootPremium` | `feed.html:287,891` | → paywall | `closeLootbox();openPaywall()` | — | — | — | **OK** |
| `#lootClose` | `feed.html:288,890` | закрити лутбокс | `closeLootbox()` | — | — | — | **OK** |
| `#sheetClose` | `feed.html:315,723` | закрити картку | `closeSheet()` | — | — | — | **OK** |
| `#starsPill` | `feed.html:255` | Stars-шоп | `SixtioPaywall.open` | — | — | — | **OK** |
| swipe-контроли (жести) | `feed.html` pointer* | лайк/пас | `op:swipe`, ліміт на сервері | ✅ під час анімації | — | `.catch` | **OK** |

### match.html (деталь метчу)

| елемент | файл:рядок | має робити | реально робить | disabled | loading | помилка | статус |
|---|---|---|---|---|---|---|---|
| `#back` | `match.html:140,185` | назад | `goBack()` (history/fallback) | — | — | — | **OK** |
| `#menuBtn` (⋯) | `match.html:141,306` | меню дій (block/report) | `tg.showPopup` | — | — | — | **OK** |
| `#writeBtn` | `match.html:168` | → chat | навігація в розмову | — | — | — | **OK** |
| `#whyBtn` | `match.html:167` | «Чому підходимо» | відкриває why-sheet | — | — | — | **OK** |
| `#whyUnlock` | `match.html:404,407` | платний розкрив | миттєво знімає кнопку → `requestReveal(true)` | ✅ (кнопка зникає) | ✅ «unlocking» | shop-fallback | **OK** |
| `.why-close` | `match.html:357,376` | закрити sheet | `close()` | — | — | — | **OK** |

### conversation.html + chat.html (листування)

| елемент | файл:рядок | має робити | реально робить | disabled | loading | помилка | статус |
|---|---|---|---|---|---|---|---|
| `#sendBtn` (submit) | `conversation.html:123,320` | надіслати | `op:send`, оптимістично | ✅ `disabled=true`→re-enable | — | `.catch` відновлює текст | **OK** |
| Enter→submit | `conversation.html:337` | надіслати | `requestSubmit()` | — | — | — | **OK** |
| `#back` | `conversation.html:100,151` | назад | `goBack()` | — | — | — | **OK** |
| `#peer` | `conversation.html:101,152` | картка партнера | навігація/деталь | — | — | — | **OK** |
| `#peerMenu` (⋯) | `conversation.html:109,291` | меню (share/block) | popup | — | — | — | **OK** |
| share-лінк партнера `<a>` | `conversation.html:214` | відкрити @username у TG | `target=_blank rel=noopener` | — | — | fallback «wait/no_username» | **OK** |
| `#starsPill` | `chat.html:74,199` | Stars-шоп | `SixtioPaywall.open` | — | — | — | **OK** |

### profile.html (профіль)

| елемент | файл:рядок | має робити | реально робить | disabled | loading | помилка | статус |
|---|---|---|---|---|---|---|---|
| `#editBtn` (шестерня) | `profile.html:361,963` | → settings | навігація | — | — | — | **OK** |
| `#avaBtn` | `profile.html:364,1007` | змінити фото | `photoInput.click()` → `/api/photo` | — | оптиміст. прев'ю | **422 NSFW → revert + alert** | **OK** |
| `#deepenBtn` | `profile.html:383,1100` | поглиблення (Premium) | premium→onboarding?deepen; інакше paywall | — | — | — | **OK** |
| `#depthSubmit` | `profile.html:403,1307` | відповісти +20% | → `/api/answer` | ✅ | — | `.catch` | **OK** |
| `#reportRow` | `profile.html:424,1555` | відкрити AI-звіт | `openReport()` | — | — | — | **OK** |
| `save` (birth) | `profile.html:1433,1440` | зберегти дату народж. | `op:save_birth` | ✅ `save.disabled` | — | re-enable + msg | **OK** |
| `buy` (AI-звіт) | `profile.html:1510,1519` | купити звіт | `op:buy_ai_report` | ✅ disable до запиту | ✅ «writing» | re-enable, розрізняє `insufficient/no_traits/no_birth/paid` | **OK** |
| `#darkRedo` | `profile.html:470,1298` | пройти kink-інтерв'ю | навігація в інтерв'ю | — | — | — | **OK** |
| `#inviteBtn` | `profile.html:480,1062` | запросити друга | `tg.openTelegramLink(share/url)` / clipboard fallback | guard `!referralLink` | — | — | **OK** |
| `#starsBadge` | `profile.html:1084` | Stars-шоп | `SixtioPaywall.open` | — | — | — | **OK** |
| edit-форма submit | `profile.html:537,~990` | зберегти профіль | `/api/profile-info` | — | — | `.catch`→`save_fail` | **OK** |
| `#cancelBtn`/`#editClose` | `profile.html:536,495,968` | закрити edit | `closeEditForm()` | — | — | — | **OK** |
| `#deleteBtn` | `profile.html:547,1128` | видалити акаунт | **подвійний confirm** → `/api/delete-account` | — | — | `.catch`→`delete_fail` | **OK** |
| консент Dark Mode (`dcOk/dcCancel`) | `profile.html:853,873` | згода/відмова | promise resolve/reject, тумблер ревертиться | — | — | reject→revert | **OK** |

### settings.html

| елемент | файл:рядок | має робити | реально робить | disabled | loading | помилка | статус |
|---|---|---|---|---|---|---|---|
| `#backBtn` | `settings.html:76,201` | → profile | навігація | — | — | — | **OK** |
| `#editProfileRow` | `settings.html:85,204` | → редагування | `profile.html?edit=1` | — | — | — | **OK** |
| `#swTheme` | `settings.html:151,237` | темна тема | `SixtioTheme.toggle()` (реально персист.) | — | — | — | **OK** |
| **`#swShow` «Показувати мене»** | `settings.html:100,223` | ховати з пошуку | **лише localStorage — на сервер НЕ йде** | — | — | — | **🟡 NO-OP** |
| **`#swInc` «Інкогніто»** | `settings.html:117,224` | інкогніто-режим | **лише localStorage** | — | — | — | **🟡 NO-OP** |
| **`#swRead` «Звіти про прочитання»** | `settings.html:121,225` | вимк. read-receipts | **лише localStorage** | — | — | — | **🟡 NO-OP** |
| **`#swMatch` «Сповіщення про метч»** | `settings.html:138,226` | вимк. пуші метчів | **лише localStorage — пуші йдуть попри вимкнення** | — | — | — | **🟡 NO-OP** |
| **`#swMsg` «Сповіщення про повідомл.»** | `settings.html:142,227` | вимк. пуші повідомл. | **лише localStorage — пуші йдуть попри вимкнення** | — | — | — | **🟡 NO-OP** |
| `#logoutBtn` | `settings.html:155,245` | «вийти» | `tg.close()` (закриває Mini App) | — | — | — | **NOTE** (див. NOTE-2) |
| `#deleteBtn` | `settings.html:159,261` | видалити акаунт | подвійний confirm → delete | — | — | `.catch`→alert | **OK** |

### privacy.html + paywall.js + theme.js

| елемент | файл:рядок | має робити | реально робить | статус |
|---|---|---|---|---|
| `#back` | `privacy.html:46,411` | назад до profile | `goBack()` | **OK** |
| «Написати нам @Sixtiobot» | `privacy.html:398` | контакт підтримки | **звичайний жирний текст, НЕ клікабельний** | **NOTE-3** |
| paywall-опції (пакети) | `paywall.js:242,286` | купівля Stars-товару | `op:purchase`/`create_stars_invoice`→`openInvoice` | **OK** |
| закриття paywall (✕/backdrop) | `paywall.js:219-220` | закрити | завжди закривається | **OK** |
| `[data-theme-toggle]` (усі стор.) | `theme.js:45` | зміна теми | `SixtioTheme.toggle()`, персист. | **OK** |

> **Захист від подвійної оплати — перевірено на КОЖНІЙ платній кнопці:**
> `paywall.js` `busy`-guard (`:244,288`), `mysteryBtn` (`feed.html:809`),
> loot-box (`feed.html:857`), AI-звіт `buy` (`profile.html:1520`),
> `save_birth` (`profile.html:1442`), why-factor (кнопка знімається миттєво,
> `match.html:409`), chat `sendBtn` (`conversation.html:325`). **Дір немає.**

---

## 2. ЗНАХІДКИ

### 🟡 P2 — NO-OP-1: 5 тумблерів Settings нічого не роблять на сервері

**Доказ:** `settings.html:208-227`. Коментар автора прямо визнає:
`// ---- local visual preferences (no backend field — persisted client-side) ----`.
`bindSwitch()` пише лише `localStorage['sixtio_settings']` і **жодного разу не викликає API**.
Серед op-ів `interact.js` немає операції видимості/сповіщень — підтверджено.

Що бачить користувач: тумблер клацає, зафарбовується «on/off», виглядає збереженим.
Реального ефекту немає. Три з п'яти несуть **пряму обіцянку, яку продукт не виконує**:

| Тумблер | Обіцянка користувачу | Реальність | Ризик |
|---|---|---|---|
| **Показувати мене** | зникнути з колоди/пошуку | продовжує показуватись | приватність + скарги |
| **Інкогніто** | приховати активність | нічого | приватність |
| **Сповіщення про метч** | вимкнути пуші | пуші **йдуть далі** | **юзер блокує бота → втрата каналу** |
| **Сповіщення про повідомл.** | вимкнути пуші | пуші **йдуть далі** | те саме |
| Звіти про прочитання | приховати «прочитано» | нічого | косметика |

**Гроші/вплив:** «вимкнув сповіщення, а вони йдуть» — класична причина **блоку бота**
у Telegram. Заблокований бот = назавжди втрачений платний користувач (нотифікації,
retention-nudge, invoice більше не доходять). «Показувати мене» вимкнене, а профіль
у колоді — прямий репутаційний/приватнісний ризик для 18+ сервісу.

**Фікс (напрямок, після «фіксимо»):** або (а) провести notif/visibility-прапорці
через існуючий `op` в `interact.js` (в межах 12-функційного ліміту) і реально їх
шанувати у `feed.js`/нотифікаціях; або (б) якщо на лаунч це поза скоупом — **прибрати
ці тумблери з UI**, щоб не давати невиконуваних обіцянок. Оцінка: (а) 0.5–1 день, (б) 15 хв.

### NOTE-2 — «Вийти» не розлогінює (і не може)

`settings.html:245` — `logoutBtn` викликає `tg.close()`. Сесії немає: авторизація
per-`initData`, тож при повторному відкритті користувач одразу «залогінений» знову.
Для Telegram Mini App це **коректна** поведінка (концепту logout не існує), але лейбл
«Вийти» вводить в оману. Рекомендація для копірайту (Фаза 37): «Закрити застосунок»
або прибрати. **Не баг, лейбл.**

### NOTE-3 — Контакт підтримки не клікабельний

`privacy.html:398`: єдиний канал зв'язку — жирний текст `@Sixtiobot`, не `<a>`.
Технічно працює (бот = сам застосунок), але користувачу треба вручну шукати бота.
Немає окремої кнопки «Підтримка»/«Зв'язатися» ніде в UI. Для платного трафіку варто
додати клікабельний `tg://resolve?domain=Sixtiobot` або пункт у Settings. **Low.**

---

## 3. Свідомо ВІДСУТНІ кнопки (не баг — фіксуємо для інших фаз)

| Очікувана кнопка | Чому відсутня | Вердикт |
|---|---|---|
| **«Скасувати підписку»** | Premium — **разовий на строк** (`premiumUntil`), не автопродовження | ✅ відсутність КОРЕКТНА; але UI ніде не має обіцяти «підписку» (прапорець для Фаз 32/37) |
| **«Restore purchases»** | баланс ⭐ серверно-авторитетний, купівлі ідемпотентні по `charge_id` | ✅ не потрібна |
| **Email/пароль/OAuth/reset** | авторизація через Telegram `initData` | ✅ цілий клас відсутній коректно |
| **Refund** | політика повернень Stars — на боці Telegram | прапорець для легалу (Фаза 32) |

---

## 4. НЕ ЗМІГ ПЕРЕВІРИТИ

- **Реальний рендер disabled/loading-станів** — статичний аналіз підтверджує логіку
  (`disabled=true`, зміну тексту), але візуальний стан кнопок не знято в браузері.
  Перевірити вручну: Фаза 38 (in-browser across languages/themes) — клік по кожній
  платній кнопці на повільній мережі, спостерегти disabled+спінер/текст.
- **`tg.showPopup`/`showConfirm` меню дій** (`match.html:306`, `conversation.html:291`) —
  тіло не прочитано повністю; пункти (block/report/share) припускаються за назвами op.
  Перевірити: прочитати `match.html:306-355` та відповідні `op` в `interact.js`/`chat.js`.

---

## 5. Пріоритети

| # | Знахідка | Пріор. | Вплив на гроші | Фікс | Оцінка |
|---|---|---|---|---|---|
| NO-OP-1 | 5 тумблерів Settings без сервер-ефекту (2 з них — сповіщення) | **P2** | блок бота = втрата платного юзера | провести через `op` або прибрати | 0.5–1 д / 15 хв |
| NOTE-2 | «Вийти» ≠ logout (лейбл) | P3 | — | копірайт | 5 хв |
| NOTE-3 | немає клікабельної «Підтримки» | P3 | тертя саппорту | лінк на бота | 15 хв |

**Підсумок Фази 4:** з ~55 інтерактивних елементів **мертвих/битих — 0**, заглушок — 0,
битих роутів — 0, незахищених платіжних кнопок — **0**. Єдина функціональна діра —
NO-OP тумблери Settings (P2, б'ють по retention через блок бота). Решта продукту
кнопково-цілісна.
