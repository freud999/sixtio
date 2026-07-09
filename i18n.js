// Sixtio i18n — native Telegram language localization (Task 26).
//
// The app auto-adapts to the user's Telegram interface language, no manual
// toggle: 'uk' (default), 'en', 'ru'. Any other language_code (es, de, …)
// gracefully falls back to English; a missing code falls back to Ukrainian.
//
// Load this AFTER telegram-web-app.js and BEFORE paywall.js / page scripts.
// Usage:
//   SixtioI18n.t('find_btn')                      -> localized string
//   SixtioI18n.t('kv_step', { n: 1, total: 4 })   -> '{x}' params substituted
//   SixtioI18n.kink('dominant')                   -> localized kink marker label
//   <el data-i18n="key">, data-i18n-html, data-i18n-ph (placeholder),
//   data-i18n-aria (aria-label), data-i18n-alt (img alt) — applied
//   automatically on DOMContentLoaded.
(function () {
  var D = {
    // ------------------------------------------------------------- Ukrainian
    uk: {
      // tab bar
      tab_matches: 'Метчі', tab_chat: 'Чат', tab_profile: 'Профіль',
      close: 'Закрити',
      // index (welcome)
      idx_thesis: 'Не свайпи. Знайомства, які справді мають сенс.',
      idx_hello: 'Привіт, {name}! Готові до справжнього знайомства?',
      idx_sub: 'Sixtio — розумна сваха. Вона ставить кілька щирих запитань, вивчає, хто ви, і знаходить людину, з якою у вас справжня сумісність.',
      idx_start: 'Познайомитись із Sixtio',
      idx_note: '<b>Приватно.</b>&nbsp; Вашого профілю Telegram ніхто не бачить.',
      privacy_policy: 'Політика конфіденційності',
      // feed (swipe deck)
      mystery_title: '🔥 Таємний метч дня',
      mystery_pct: '{pct}% сумісності',
      mystery_pct_ph: '— % сумісності',
      mystery_unlock: '🔓 Розблокувати особу · 10 ⭐',
      mystery_unlocking: 'Розблокування…',
      not_enough_stars: 'Недостатньо ⭐',
      lock_premium: '🔒 Premium',
      intimate_score: '🔥 Інтимна сумісність:',
      dark_hint: '🔓 Premium — щоб побачити спільні збіги',
      act_skip: 'Пропустити', act_like: 'Подобається',
      feed_empty: '<b>Поки що це всі.</b><br>Онови анкету через «Покращити профіль» — і зазирни згодом, зʼявляться нові люди.',
      feed_net_error: 'Не вдалося завантажити. Перевір зʼєднання і спробуй ще.',
      loot_title: '🎁 Скриньки Удачі',
      loot_sub: 'Ліміт свайпів вичерпано. Спробуй удачу — перша скринька безкоштовна!',
      loot_first_free: 'Перша скринька — безкоштовно',
      loot_premium: '💎 Або Premium — безлімітні свайпи',
      loot_win_swipes: '🎉 +3 безкоштовні свайпи!',
      loot_win_discount: '🏷️ 30% знижка на Premium!',
      loot_win_empty: 'Пусто… Спробуй ще завтра!',
      loot_no_stars: 'Недостатньо ⭐ для ще однієї спроби',
      loot_try_premium: 'Спробуй Premium нижче ⬇',
      loot_next: 'Наступна скринька — 5 ⭐ · баланс: {bal} ⭐',
      // matches
      find_btn: '🔍 Знайти пару зараз',
      search_banner: '<b>Sixtio шукає твою пару.</b> Тисни «Знайти пару», щойно захочеш — або чекай, поки зʼявиться хтось особливий.',
      matches_empty: 'Поки що сумісних вільних кандидатів немає. Онови анкету через «Покращити профіль» — і спробуй ще 💜',
      row_pct: '{pct}% сумісність',
      row_meta_fallback: 'ваша пара від Sixtio',
      row_intimate: '🔥 Інтимна сумісність — {pct}%',
      pw_locked_subtitle: '🔥 Спільні інтимні маркери приховано. Premium відкриває їх повністю 💎',
      match_locked_hint: '💎 Premium відкриває спільні інтимні маркери — торкнись, щоб відкрити',
      // match page (Task 27)
      mt_back: '‹ Назад', aria_back: 'Назад',
      mt_headline: '✨ ВАШ МЕТЧ',
      mt_photo_alt: 'Фото пари',
      mt_reason_lbl: 'Чому ви пасуєте',
      mt_traits: 'Характер',
      mt_bio: 'Про людину',
      mt_dark: '🔥 Інтимна сумісність',
      mt_why_btn: '🧠 Чому ми підходимо один одному?',
      mt_write_btn: 'Написати повідомлення 💬',
      mt_intimate_line: '🔥 Ваша інтимна сумісність — {pct}%',
      // The Why Factor overlay (match page)
      wf_title: '🧠 Чому ви підходите',
      wf_analyzing: 'Sixtio аналізує вашу сумісність…',
      wf_free_note: 'Перше розкриття на сьогодні — безкоштовне. Наступні — за Stars.',
      wf_teaser: 'Ваша глибинна сумісність за пʼятьма осями особистості вже прорахована — щирість, темп життя, спосіб прив\'язаності та ще кілька несподіваних збігів чекають на тебе…',
      wf_unlock: 'Розблокувати за Stars · {price} ⭐',
      wf_shop_subtitle: 'Замало зірок, щоб розблокувати розкриття. Поповни баланс 💎',
      wf_insufficient: 'Недостатньо зірок (потрібно 10 ⭐). Запроси друзів, щоб отримати більше.',
      wf_fail: 'Не вдалося згенерувати. Спробуй ще раз.',
      // chat list
      chat_you: 'Ти: ',
      chat_start: 'Почніть розмову ✨',
      chat_empty: 'Тут зʼявляться розмови з твоїми парами. Поки метчів немає — зазирни у <a href="matches.html">Метчі</a> й натисни «Знайти пару».',
      // profile — goal labels (gendered, Task 23)
      goal_longterm: 'Шукаю довготривалі стосунки',
      goal_fun: 'Хочу розважитись',
      goal_situational_f: 'Відкрита — по ситуації',
      goal_situational_m: 'Відкритий — по ситуації',
      goal_situational_x: 'Відкритий(-а) — по ситуації',
      // profile — sections & depth
      depth_title: 'Глибина профілю',
      improve_btn: '✨ Покращити профіль із Sixtio',
      depth_q_default: '🧠 Дозаповни профіль (+20%)',
      answer_free_ph: 'Відповідай вільно, своїми словами…',
      depth_submit: 'Відповісти (+20%)',
      extra_q_0: 'Що останнім часом змусило тебе передумати про щось важливе?',
      extra_q_1: 'Коли ти почуваєшся найбільш собою — і хто поруч у цей момент?',
      extra_q_2: 'За що ти вдячний(-а) навіть у складні дні — і чому саме за це?',
      depth_min: 'Кілька слів — і профіль стане глибшим 💬',
      depth_saving: 'Sixtio запамʼятовує…',
      depth_bonus: '🎉 Профіль заповнено! +2 ⭐ бонус',
      depth_done: 'Готово ✓ Профіль глибший на +20%',
      about_me: 'Про мене',
      interests: 'Інтереси',
      bio_nudge: '💬 Додай пару слів про себе (✎)',
      referral_sub: '💸 +15 ⭐️ за кожного друга (після інтерв\'ю)',
      invite_btn: '🎁 Запросити',
      achievements: '🏅 Досягнення',
      achieve_empty: 'Твій психотип формується… відповідай на питання, і бейджі зʼявляться ✨',
      ach_crystal_empath: 'Кришталевий Емпат',
      ach_master_charisma: 'Магістр Харизми',
      ach_rock_stability: 'Скеля Стабільності',
      ach_explorer: 'Першовідкривач',
      ach_zen_strategist: 'Дзен-Стратег',
      // profile — Dark Mode (18+)
      dark_desc: 'Анонімний пошук за інтимною сумісністю. Видно лише тим, хто теж увімкнув Dark Mode.',
      age_confirm: 'Мені є 18 років',
      dark_redo: 'Пройти інтерв\'ю знову',
      kv_title: '🔥 Анонімне інтерв\'ю',
      kv_step: 'Питання {n} з {total}',
      kv_next: 'Далі', kv_finish: 'Завершити',
      kv_min: 'Кілька слів — і рушаємо далі 💬',
      kv_analyzing: 'Sixtio аналізує…',
      kv_fail: 'Не вдалося проаналізувати. Спробуй ще раз.',
      kv_priv: 'Sixtio перетворює відповіді на анонімні теги сумісності. Твої слова не показуються нікому.',
      kv_q_label: 'Питання', kv_a_label: 'Відповідь',
      kink_q_0: 'Яка роль тобі ближча в близькості — вести, слідувати чи змінюватись за настроєм?',
      kink_q_1: 'Що додає пристрасті саме тобі: ніжність і чуттєвість чи сміливі експерименти?',
      kink_q_2: 'Наскільки тобі цікаві рольові ігри, сценарії або легкий бондаж?',
      kink_q_3: 'Що для тебе однозначне табу, а до чого ти відкритий(-а) досліджувати з партнером?',
      // profile — edit form
      edit_title: 'Редагування анкети',
      aria_shop: 'Магазин Stars', aria_edit: 'Редагувати анкету',
      aria_photo: 'Змінити фото', alt_profile_photo: 'Фото профілю',
      f_seeking: 'Кого шукаю',
      opt_male: 'Чоловіка', opt_female: 'Жінку', opt_any: 'Неважливо',
      f_goal: 'Мета',
      opt_longterm: 'Довготривалі стосунки', opt_fun: 'Розважитись', opt_situational: 'По ситуації',
      f_age: 'Вік', f_city: 'Місто',
      f_interests: 'Інтереси (через кому)',
      cancel: 'Скасувати', save: 'Зберегти',
      age_range_err: 'Вік має бути від 18 до 100',
      saving: 'Зберігаю…', saved: 'Збережено ✓',
      save_fail: 'Не вдалося зберегти — спробуй ще раз',
      // profile — misc actions
      delete_account: 'Видалити акаунт',
      delete_confirm: 'Видалити акаунт назавжди? Твоя анкета, відповіді, метчі, повідомлення й фото буде безповоротно стерто.\n\n⚠️ Увага! Твій поточний баланс ({bal} ⭐️) буде безповоротно анульований без можливості повернення коштів після видалення акаунта.',
      delete_fail: 'Не вдалося видалити. Спробуй ще раз.',
      invite_text: 'Приєднуйся до Sixtio — AI знайде тобі справжню пару 💜',
      link_copied: 'Посилання скопійовано!',
      shop_subtitle: 'Магазин Sixtio — поповни баланс і відкрий Premium 💎',
      // onboarding (Task 28) — profile steps
      ob_hello_gender: 'Привіт! Я Sixtio 💜 Спершу трохи про тебе. Хто ти?',
      ob_i_male: 'Чоловік', ob_i_female: 'Жінка',
      ob_seeking_q: 'Кого ти хочеш зустріти?',
      ob_goal_q: 'Що ти шукаєш у Sixtio?',
      ob_age_q: 'Скільки тобі років?',
      ob_city_q: 'З якого ти міста?',
      ob_interests_q: 'Розкажи про свої інтереси — просто через кому. Наприклад: подорожі, кіно, біг',
      ob_bio_q: 'Кілька слів про себе — як би ти представив себе людині, яка тобі подобається?',
      ob_bio_q_f: 'Кілька слів про себе — як би ти представила себе людині, яка тобі подобається?',
      ob_photo_q: 'І додай своє фото — його побачить лише людина, з якою у вас метч.',
      // onboarding — psych interview (ids stay in sync with api/_lib/questions.js)
      ob_q1: 'А тепер — найцікавіше. Розкажи про мить за останній рік, коли ти відчув себе по-справжньому живим. Де ти був, з ким, і що робило її справжньою?',
      ob_q1_f: 'А тепер — найцікавіше. Розкажи про мить за останній рік, коли ти відчула себе по-справжньому живою. Де ти була, з ким, і що робило її справжньою?',
      ob_q2: 'Коли близька людина тебе розчаровує — що відбувається всередині тебе першої хвилини, і як ти зазвичай дієш далі?',
      ob_q3: 'Що людина має зробити чи сказати, щоб ти відчув: «ось із цим я можу бути собою»?',
      ob_q3_f: 'Що людина має зробити чи сказати, щоб ти відчула: «ось із цим я можу бути собою»?',
      ob_q4: 'За що тебе по-справжньому цінують ті, хто знає тебе давно, — і чи згоден ти з ними?',
      ob_q4_f: 'За що тебе по-справжньому цінують ті, хто знає тебе давно, — і чи згодна ти з ними?',
      ob_q5: 'І останнє, найважливіше: чого ти більше не готовий терпіти у стосунках — і що навчило тебе цій межі?',
      ob_q5_f: 'І останнє, найважливіше: чого ти більше не готова терпіти у стосунках — і що навчило тебе цій межі?',
      ob_d1: 'Що в тобі змінилося за останні кілька років — і як ти до цього ставишся?',
      ob_d2: 'Яка твоя маленька дивакуватість, яку по-справжньому оцінить лише правильна людина?',
      ob_d3: 'Коли ти уявляєш спільне майбутнє з кимось — що в цій картині для тебе найважливіше?',
      ob_d4: 'У який момент ти відчуваєш найбільшу самотність — і що допомагає з неї вийти?',
      ob_d5: 'Що ти зрозумів про кохання таке, чого не знав у 20?',
      ob_d5_f: 'Що ти зрозуміла про кохання таке, чого не знала у 20?',
      // onboarding — system messages & controls
      ob_deepen_hello: 'Рада бачити тебе знову! Кілька нових запитань — і я зрозумію тебе ще глибше ✨',
      ob_step: 'Крок {n} з {total}', ob_done_lbl: 'Готово',
      ob_write_ph: 'Напишіть відповідь...', ob_age_ph: 'Вкажи вік числом...', ob_city_ph: 'Напиши місто...',
      ob_send_aria: 'Надіслати',
      ob_pick_photo: '📷 Обрати фото', ob_skip: 'Пропустити', ob_share_gps: '📍 Поділитися локацією',
      ob_city_manual: 'Гаразд — впиши місто вручну 🙂',
      ob_city_fail: 'Не вдалося визначити місто — впиши його вручну 🙂',
      ob_age_minor: 'Sixtio знайомить лише повнолітніх — вкажи вік від 18 🙂',
      ob_age_nan: 'Вкажи, будь ласка, вік числом — наприклад, 25',
      ob_photo_ok: 'Чудове фото! 📸',
      ob_photo_fail: 'Не вдалося завантажити фото — спробуємо пізніше, це не завадить знайомству.',
      ob_photo_read_fail: 'Не вдалося прочитати це фото. Спробуй інше.',
      ob_photo_alt: 'Твоє фото',
      ob_card_title: 'Ось як Sixtio тебе зрозуміла',
      ob_card_next: 'Скоро Sixtio запропонує перше знайомство.',
      ob_thanks: 'Дякую, що поділився(-лась)',
      ob_thanks_sub: 'Sixtio вже аналізує твої відповіді, щоб знайти людину зі справжньою сумісністю. Скоро продовжимо.',
      ob_continue: 'Продовжити',
      // conversation screen (Task 28)
      cv_title: 'Розмова',
      cv_view_match: 'переглянути метч ›',
      cv_intro: 'Sixtio звела вас за справжньою сумісністю. Напиши перше повідомлення — з чогось теплого й щирого.',
      cv_msg_ph: 'Повідомлення...',
      cv_open_tg: 'Відкрити @{u} у Telegram',
      cv_no_username: '✈️ Ви обмінялись — але в людини немає @юзернейма в Telegram',
      cv_waiting: '⏳ Чекаємо, поки {name} теж погодиться',
      cv_pair: 'пара',
      cv_share_btn: 'Обмінятись Telegram',
      // kink marker labels (standardized tokens -> local words)
      kink_dominant: 'Домінування', kink_submissive: 'Підкорення', kink_switch: 'Світч',
      kink_sensual: 'Чуттєвість', kink_passionate: 'Пристрасть', kink_romantic: 'Романтика',
      kink_tender: 'Ніжність', kink_playful: 'Грайливість', kink_experimental: 'Експерименти',
      kink_adventurous: 'Авантюрність', kink_curious: 'Допитливість', kink_vanilla: 'Класика',
      kink_roleplay: 'Рольові ігри', kink_bondage: 'Бондаж', kink_voyeur: 'Вуаєризм',
      kink_exhibitionist: 'Ексгібіціонізм',
      // paywall / Stars shop
      pw_default_sub: 'Твій ліміт вподобань на сьогодні вичерпано. Обери, як продовжити 💜',
      pw_balance: 'Баланс:',
      pw_premium_name: 'Premium · 30 днів',
      pw_hit: 'ХІТ',
      pw_b1: '♾️ Безлімітні вподобання',
      pw_b2: '👁 Фото без розмиття',
      pw_b3: '🧠 «Чому ви підходите» — без обмежень',
      pw_b4: '📊 Аналітика Digital Twin',
      pw_pack_name: '+30 вподобань',
      pw_pack_note: 'Топ-ап на сьогодні. Фото лишаються розмитими.',
      pw_deposit_h: 'Поповнити баланс зірками Telegram',
      pw_tag_popular: 'ПОПУЛЯРНЕ', pw_tag_value: 'ВИГІДНО',
      pw_invite_q: 'Мало зірок?',
      pw_invite_u: 'Запроси друзів (+15 ⭐ за кожного)',
      pw_tg_only: 'Оплата зірками доступна лише в застосунку Telegram.',
      pw_invoice_prep: 'Готуємо рахунок…',
      pw_invoice_fail: 'Не вдалося створити рахунок. Спробуй ще раз.',
      pw_paid: '✅ +{n} ⭐ зараховано на баланс!',
      pw_pay_fail: 'Оплата не пройшла. Спробуй ще раз.',
      pw_net_err: 'Помилка мережі. Спробуй ще раз.',
      pw_processing: 'Обробка…',
      pw_insufficient_invite: 'Недостатньо зірок — запроси друзів, щоб заробити ⭐',
      pw_insufficient: 'Недостатньо зірок.',
      pw_fail: 'Не вдалося. Спробуй ще раз.'
    },
    // --------------------------------------------------------------- English
    en: {
      tab_matches: 'Matches', tab_chat: 'Chat', tab_profile: 'Profile',
      close: 'Close',
      idx_thesis: 'Not swipes. Connections that truly make sense.',
      idx_hello: 'Hi, {name}! Ready for a real connection?',
      idx_sub: 'Sixtio is a smart matchmaker. It asks a few sincere questions, learns who you are, and finds someone you are truly compatible with.',
      idx_start: 'Meet Sixtio',
      idx_note: '<b>Private.</b>&nbsp; No one sees your Telegram profile.',
      privacy_policy: 'Privacy Policy',
      mystery_title: '🔥 Mystery Match of the Day',
      mystery_pct: '{pct}% compatibility',
      mystery_pct_ph: '— % compatibility',
      mystery_unlock: '🔓 Reveal identity · 10 ⭐',
      mystery_unlocking: 'Unlocking…',
      not_enough_stars: 'Not enough ⭐',
      lock_premium: '🔒 Premium',
      intimate_score: '🔥 Intimate compatibility:',
      dark_hint: '🔓 Premium — to see your shared matches',
      act_skip: 'Skip', act_like: 'Like',
      feed_empty: '<b>That’s everyone for now.</b><br>Update your profile via “Improve profile” — and check back later, new people will appear.',
      feed_net_error: 'Couldn’t load. Check your connection and try again.',
      loot_title: '🎁 Lucky Boxes',
      loot_sub: 'You’re out of swipes. Try your luck — the first box is free!',
      loot_first_free: 'First box — free',
      loot_premium: '💎 Or Premium — unlimited swipes',
      loot_win_swipes: '🎉 +3 free swipes!',
      loot_win_discount: '🏷️ 30% off Premium!',
      loot_win_empty: 'Empty… Try again tomorrow!',
      loot_no_stars: 'Not enough ⭐ for another try',
      loot_try_premium: 'Try Premium below ⬇',
      loot_next: 'Next box — 5 ⭐ · balance: {bal} ⭐',
      find_btn: '🔍 Find a match now',
      search_banner: '<b>Sixtio is searching for your match.</b> Tap “Find a match” whenever you like — or wait until someone special appears.',
      matches_empty: 'No compatible candidates available yet. Update your profile via “Improve profile” — and try again 💜',
      row_pct: '{pct}% compatibility',
      row_meta_fallback: 'your Sixtio match',
      row_intimate: '🔥 Intimate compatibility — {pct}%',
      pw_locked_subtitle: '🔥 Your shared intimate markers are hidden. Premium reveals them in full 💎',
      match_locked_hint: '💎 Premium reveals your shared intimate markers — tap to unlock',
      mt_back: '‹ Back', aria_back: 'Back',
      mt_headline: '✨ YOUR MATCH',
      mt_photo_alt: 'Match photo',
      mt_reason_lbl: 'Why you fit together',
      mt_traits: 'Personality',
      mt_bio: 'About them',
      mt_dark: '🔥 Intimate compatibility',
      mt_why_btn: '🧠 Why do we match each other?',
      mt_write_btn: 'Send a message 💬',
      mt_intimate_line: '🔥 Your intimate compatibility — {pct}%',
      wf_title: '🧠 Why you match',
      wf_analyzing: 'Sixtio is analyzing your compatibility…',
      wf_free_note: 'Today’s first reveal is free. The next ones cost Stars.',
      wf_teaser: 'Your deep compatibility across five personality axes is already computed — sincerity, pace of life, attachment style and a few unexpected overlaps are waiting for you…',
      wf_unlock: 'Unlock with Stars · {price} ⭐',
      wf_shop_subtitle: 'Not enough Stars to unlock the reveal. Top up your balance 💎',
      wf_insufficient: 'Not enough Stars (10 ⭐ needed). Invite friends to earn more.',
      wf_fail: 'Couldn’t generate. Try again.',
      chat_you: 'You: ',
      chat_start: 'Start the conversation ✨',
      chat_empty: 'Conversations with your matches will appear here. No matches yet — open <a href="matches.html">Matches</a> and tap “Find a match”.',
      goal_longterm: 'Looking for a long-term relationship',
      goal_fun: 'Here to have fun',
      goal_situational_f: 'Open — depends on the vibe',
      goal_situational_m: 'Open — depends on the vibe',
      goal_situational_x: 'Open — depends on the vibe',
      depth_title: 'Profile depth',
      improve_btn: '✨ Improve your profile with Sixtio',
      depth_q_default: '🧠 Complete your profile (+20%)',
      answer_free_ph: 'Answer freely, in your own words…',
      depth_submit: 'Answer (+20%)',
      extra_q_0: 'What made you change your mind about something important recently?',
      extra_q_1: 'When do you feel most like yourself — and who is beside you in that moment?',
      extra_q_2: 'What are you grateful for even on hard days — and why that in particular?',
      depth_min: 'A few words — and your profile gets deeper 💬',
      depth_saving: 'Sixtio is memorizing…',
      depth_bonus: '🎉 Profile complete! +2 ⭐ bonus',
      depth_done: 'Done ✓ Your profile is +20% deeper',
      about_me: 'About me',
      interests: 'Interests',
      bio_nudge: '💬 Add a few words about yourself (✎)',
      referral_sub: '💸 +15 ⭐️ for every friend (after their interview)',
      invite_btn: '🎁 Invite',
      achievements: '🏅 Achievements',
      achieve_empty: 'Your psych profile is taking shape… answer questions and badges will appear ✨',
      ach_crystal_empath: 'Crystal Empath',
      ach_master_charisma: 'Charisma Master',
      ach_rock_stability: 'Rock of Stability',
      ach_explorer: 'Pioneer',
      ach_zen_strategist: 'Zen Strategist',
      dark_desc: 'Anonymous search by intimate compatibility. Visible only to those who also turned on Dark Mode.',
      age_confirm: 'I am 18 or older',
      dark_redo: 'Retake the interview',
      kv_title: '🔥 Anonymous interview',
      kv_step: 'Question {n} of {total}',
      kv_next: 'Next', kv_finish: 'Finish',
      kv_min: 'A few words — and we move on 💬',
      kv_analyzing: 'Sixtio is analyzing…',
      kv_fail: 'Couldn’t analyze. Try again.',
      kv_priv: 'Sixtio turns your answers into anonymous compatibility tags. Your words are never shown to anyone.',
      kv_q_label: 'Question', kv_a_label: 'Answer',
      kink_q_0: 'Which role feels closer to you in intimacy — leading, following, or switching with the mood?',
      kink_q_1: 'What adds passion for you: tenderness and sensuality, or bold experiments?',
      kink_q_2: 'How interested are you in roleplay, scenarios, or light bondage?',
      kink_q_3: 'What is a definite taboo for you, and what are you open to exploring with a partner?',
      edit_title: 'Edit profile',
      aria_shop: 'Stars shop', aria_edit: 'Edit profile',
      aria_photo: 'Change photo', alt_profile_photo: 'Profile photo',
      f_seeking: 'Who I’m looking for',
      opt_male: 'A man', opt_female: 'A woman', opt_any: 'Doesn’t matter',
      f_goal: 'Goal',
      opt_longterm: 'Long-term relationship', opt_fun: 'Have fun', opt_situational: 'Depends',
      f_age: 'Age', f_city: 'City',
      f_interests: 'Interests (comma-separated)',
      cancel: 'Cancel', save: 'Save',
      age_range_err: 'Age must be between 18 and 100',
      saving: 'Saving…', saved: 'Saved ✓',
      save_fail: 'Couldn’t save — try again',
      delete_account: 'Delete account',
      delete_confirm: 'Delete your account forever? Your profile, answers, matches, messages and photos will be erased irreversibly.\n\n⚠️ Warning! Your current balance ({bal} ⭐️) will be irrevocably forfeited with no refund once the account is deleted.',
      delete_fail: 'Couldn’t delete. Try again.',
      invite_text: 'Join Sixtio — AI will find you a real match 💜',
      link_copied: 'Link copied!',
      shop_subtitle: 'Sixtio shop — top up your balance and unlock Premium 💎',
      ob_hello_gender: 'Hi! I\'m Sixtio 💜 First, a little about you. Who are you?',
      ob_i_male: 'Man', ob_i_female: 'Woman',
      ob_seeking_q: 'Who would you like to meet?',
      ob_goal_q: 'What are you looking for on Sixtio?',
      ob_age_q: 'How old are you?',
      ob_city_q: 'What city are you from?',
      ob_interests_q: 'Tell me about your interests — just comma-separated. For example: travel, movies, running',
      ob_bio_q: 'A few words about yourself — how would you introduce yourself to someone you like?',
      ob_bio_q_f: 'A few words about yourself — how would you introduce yourself to someone you like?',
      ob_photo_q: 'And add your photo — only the person you match with will see it.',
      ob_q1: 'Now — the most interesting part. Tell me about a moment in the past year when you felt truly alive. Where were you, who were you with, and what made it real?',
      ob_q1_f: 'Now — the most interesting part. Tell me about a moment in the past year when you felt truly alive. Where were you, who were you with, and what made it real?',
      ob_q2: 'When someone close disappoints you — what happens inside you in the first minute, and how do you usually act next?',
      ob_q3: 'What does a person have to do or say for you to feel: “with this one, I can be myself”?',
      ob_q3_f: 'What does a person have to do or say for you to feel: “with this one, I can be myself”?',
      ob_q4: 'What do people who have known you for a long time truly value you for — and do you agree with them?',
      ob_q4_f: 'What do people who have known you for a long time truly value you for — and do you agree with them?',
      ob_q5: 'And the last, most important one: what are you no longer willing to tolerate in a relationship — and what taught you that boundary?',
      ob_q5_f: 'And the last, most important one: what are you no longer willing to tolerate in a relationship — and what taught you that boundary?',
      ob_d1: 'What has changed in you over the past few years — and how do you feel about it?',
      ob_d2: 'What\'s your little quirk that only the right person will truly appreciate?',
      ob_d3: 'When you imagine a shared future with someone — what matters most to you in that picture?',
      ob_d4: 'When do you feel the loneliest — and what helps you get out of it?',
      ob_d5: 'What did you come to understand about love that you didn\'t know at 20?',
      ob_d5_f: 'What did you come to understand about love that you didn\'t know at 20?',
      ob_deepen_hello: 'Great to see you again! A few new questions — and I\'ll understand you even deeper ✨',
      ob_step: 'Step {n} of {total}', ob_done_lbl: 'Done',
      ob_write_ph: 'Type your answer...', ob_age_ph: 'Enter your age as a number...', ob_city_ph: 'Type your city...',
      ob_send_aria: 'Send',
      ob_pick_photo: '📷 Choose a photo', ob_skip: 'Skip', ob_share_gps: '📍 Share location',
      ob_city_manual: 'No problem — type your city manually 🙂',
      ob_city_fail: 'Couldn\'t detect your city — type it manually 🙂',
      ob_age_minor: 'Sixtio is for adults only — enter an age of 18+ 🙂',
      ob_age_nan: 'Please enter your age as a number — for example, 25',
      ob_photo_ok: 'Great photo! 📸',
      ob_photo_fail: 'Couldn\'t upload the photo — we\'ll try again later, it won\'t get in the way.',
      ob_photo_read_fail: 'Couldn\'t read this photo. Try another one.',
      ob_photo_alt: 'Your photo',
      ob_card_title: 'Here\'s how Sixtio understood you',
      ob_card_next: 'Sixtio will suggest your first match soon.',
      ob_thanks: 'Thank you for sharing',
      ob_thanks_sub: 'Sixtio is already analyzing your answers to find someone truly compatible. We\'ll continue soon.',
      ob_continue: 'Continue',
      cv_title: 'Conversation',
      cv_view_match: 'view match ›',
      cv_intro: 'Sixtio brought you together over real compatibility. Send the first message — start with something warm and sincere.',
      cv_msg_ph: 'Message...',
      cv_open_tg: 'Open @{u} in Telegram',
      cv_no_username: '✈️ You\'ve exchanged — but they have no @username in Telegram',
      cv_waiting: '⏳ Waiting for {name} to agree too',
      cv_pair: 'your match',
      cv_share_btn: 'Exchange Telegram',
      kink_dominant: 'Dominant', kink_submissive: 'Submissive', kink_switch: 'Switch',
      kink_sensual: 'Sensual', kink_passionate: 'Passionate', kink_romantic: 'Romantic',
      kink_tender: 'Tender', kink_playful: 'Playful', kink_experimental: 'Experimental',
      kink_adventurous: 'Adventurous', kink_curious: 'Curious', kink_vanilla: 'Vanilla',
      kink_roleplay: 'Roleplay', kink_bondage: 'Bondage', kink_voyeur: 'Voyeur',
      kink_exhibitionist: 'Exhibitionist',
      pw_default_sub: 'You’ve used today’s likes. Choose how to continue 💜',
      pw_balance: 'Balance:',
      pw_premium_name: 'Premium · 30 days',
      pw_hit: 'HOT',
      pw_b1: '♾️ Unlimited likes',
      pw_b2: '👁 Photos without blur',
      pw_b3: '🧠 “Why you match” — unlimited',
      pw_b4: '📊 Digital Twin analytics',
      pw_pack_name: '+30 likes',
      pw_pack_note: 'A top-up for today. Photos stay blurred.',
      pw_deposit_h: 'Top up with Telegram Stars',
      pw_tag_popular: 'POPULAR', pw_tag_value: 'BEST VALUE',
      pw_invite_q: 'Short on Stars?',
      pw_invite_u: 'Invite friends (+15 ⭐ each)',
      pw_tg_only: 'Stars payments are available only in the Telegram app.',
      pw_invoice_prep: 'Preparing the invoice…',
      pw_invoice_fail: 'Couldn’t create the invoice. Try again.',
      pw_paid: '✅ +{n} ⭐ added to your balance!',
      pw_pay_fail: 'Payment didn’t go through. Try again.',
      pw_net_err: 'Network error. Try again.',
      pw_processing: 'Processing…',
      pw_insufficient_invite: 'Not enough Stars — invite friends to earn ⭐',
      pw_insufficient: 'Not enough Stars.',
      pw_fail: 'Didn’t work. Try again.'
    },
    // --------------------------------------------------------------- Russian
    ru: {
      tab_matches: 'Мэтчи', tab_chat: 'Чат', tab_profile: 'Профиль',
      close: 'Закрыть',
      idx_thesis: 'Не свайпы. Знакомства, которые действительно имеют смысл.',
      idx_hello: 'Привет, {name}! Готовы к настоящему знакомству?',
      idx_sub: 'Sixtio — умная сваха. Она задаёт несколько искренних вопросов, изучает, кто вы, и находит человека, с которым у вас настоящая совместимость.',
      idx_start: 'Познакомиться с Sixtio',
      idx_note: '<b>Приватно.</b>&nbsp; Ваш профиль Telegram никто не видит.',
      privacy_policy: 'Политика конфиденциальности',
      mystery_title: '🔥 Тайный мэтч дня',
      mystery_pct: '{pct}% совместимости',
      mystery_pct_ph: '— % совместимости',
      mystery_unlock: '🔓 Разблокировать личность · 10 ⭐',
      mystery_unlocking: 'Разблокировка…',
      not_enough_stars: 'Недостаточно ⭐',
      lock_premium: '🔒 Premium',
      intimate_score: '🔥 Интимная совместимость:',
      dark_hint: '🔓 Premium — чтобы увидеть общие совпадения',
      act_skip: 'Пропустить', act_like: 'Нравится',
      feed_empty: '<b>Пока что это все.</b><br>Обнови анкету через «Улучшить профиль» — и загляни позже, появятся новые люди.',
      feed_net_error: 'Не удалось загрузить. Проверь соединение и попробуй ещё раз.',
      loot_title: '🎁 Сундучки Удачи',
      loot_sub: 'Лимит свайпов исчерпан. Испытай удачу — первый сундучок бесплатный!',
      loot_first_free: 'Первый сундучок — бесплатно',
      loot_premium: '💎 Или Premium — безлимитные свайпы',
      loot_win_swipes: '🎉 +3 бесплатных свайпа!',
      loot_win_discount: '🏷️ Скидка 30% на Premium!',
      loot_win_empty: 'Пусто… Попробуй ещё завтра!',
      loot_no_stars: 'Недостаточно ⭐ ещё для одной попытки',
      loot_try_premium: 'Попробуй Premium ниже ⬇',
      loot_next: 'Следующий сундучок — 5 ⭐ · баланс: {bal} ⭐',
      find_btn: '🔍 Найти пару сейчас',
      search_banner: '<b>Sixtio ищет твою пару.</b> Жми «Найти пару», когда захочешь — или жди, пока появится кто-то особенный.',
      matches_empty: 'Пока совместимых свободных кандидатов нет. Обнови анкету через «Улучшить профиль» — и попробуй ещё 💜',
      row_pct: '{pct}% совместимость',
      row_meta_fallback: 'ваша пара от Sixtio',
      row_intimate: '🔥 Интимная совместимость — {pct}%',
      pw_locked_subtitle: '🔥 Общие интимные маркеры скрыты. Premium открывает их полностью 💎',
      match_locked_hint: '💎 Premium открывает общие интимные маркеры — коснись, чтобы открыть',
      mt_back: '‹ Назад', aria_back: 'Назад',
      mt_headline: '✨ ВАШ МЭТЧ',
      mt_photo_alt: 'Фото пары',
      mt_reason_lbl: 'Почему вы подходите',
      mt_traits: 'Характер',
      mt_bio: 'О человеке',
      mt_dark: '🔥 Интимная совместимость',
      mt_why_btn: '🧠 Почему мы подходим друг другу?',
      mt_write_btn: 'Написать сообщение 💬',
      mt_intimate_line: '🔥 Ваша интимная совместимость — {pct}%',
      wf_title: '🧠 Почему вы подходите',
      wf_analyzing: 'Sixtio анализирует вашу совместимость…',
      wf_free_note: 'Первое раскрытие на сегодня — бесплатное. Следующие — за Stars.',
      wf_teaser: 'Ваша глубинная совместимость по пяти осям личности уже просчитана — искренность, темп жизни, стиль привязанности и ещё несколько неожиданных совпадений ждут тебя…',
      wf_unlock: 'Разблокировать за Stars · {price} ⭐',
      wf_shop_subtitle: 'Маловато звёзд, чтобы разблокировать раскрытие. Пополни баланс 💎',
      wf_insufficient: 'Недостаточно звёзд (нужно 10 ⭐). Пригласи друзей, чтобы получить больше.',
      wf_fail: 'Не удалось сгенерировать. Попробуй ещё раз.',
      chat_you: 'Ты: ',
      chat_start: 'Начните разговор ✨',
      chat_empty: 'Здесь появятся разговоры с твоими парами. Пока мэтчей нет — загляни в <a href="matches.html">Мэтчи</a> и нажми «Найти пару».',
      goal_longterm: 'Ищу долгосрочные отношения',
      goal_fun: 'Хочу развлечься',
      goal_situational_f: 'Открыта — по ситуации',
      goal_situational_m: 'Открыт — по ситуации',
      goal_situational_x: 'Открыт(а) — по ситуации',
      depth_title: 'Глубина профиля',
      improve_btn: '✨ Улучшить профиль с Sixtio',
      depth_q_default: '🧠 Дозаполни профиль (+20%)',
      answer_free_ph: 'Отвечай свободно, своими словами…',
      depth_submit: 'Ответить (+20%)',
      extra_q_0: 'Что в последнее время заставило тебя передумать о чём-то важном?',
      extra_q_1: 'Когда ты чувствуешь себя наиболее собой — и кто рядом в этот момент?',
      extra_q_2: 'За что ты благодарен(-на) даже в трудные дни — и почему именно за это?',
      depth_min: 'Пару слов — и профиль станет глубже 💬',
      depth_saving: 'Sixtio запоминает…',
      depth_bonus: '🎉 Профиль заполнен! +2 ⭐ бонус',
      depth_done: 'Готово ✓ Профиль глубже на +20%',
      about_me: 'Обо мне',
      interests: 'Интересы',
      bio_nudge: '💬 Добавь пару слов о себе (✎)',
      referral_sub: '💸 +15 ⭐️ за каждого друга (после интервью)',
      invite_btn: '🎁 Пригласить',
      achievements: '🏅 Достижения',
      achieve_empty: 'Твой психотип формируется… отвечай на вопросы, и бейджи появятся ✨',
      ach_crystal_empath: 'Хрустальный Эмпат',
      ach_master_charisma: 'Магистр Харизмы',
      ach_rock_stability: 'Скала Стабильности',
      ach_explorer: 'Первооткрыватель',
      ach_zen_strategist: 'Дзен-Стратег',
      dark_desc: 'Анонимный поиск по интимной совместимости. Видно только тем, кто тоже включил Dark Mode.',
      age_confirm: 'Мне есть 18 лет',
      dark_redo: 'Пройти интервью заново',
      kv_title: '🔥 Анонимное интервью',
      kv_step: 'Вопрос {n} из {total}',
      kv_next: 'Далее', kv_finish: 'Завершить',
      kv_min: 'Пару слов — и двигаемся дальше 💬',
      kv_analyzing: 'Sixtio анализирует…',
      kv_fail: 'Не удалось проанализировать. Попробуй ещё раз.',
      kv_priv: 'Sixtio превращает ответы в анонимные теги совместимости. Твои слова никому не показываются.',
      kv_q_label: 'Вопрос', kv_a_label: 'Ответ',
      kink_q_0: 'Какая роль тебе ближе в близости — вести, следовать или меняться по настроению?',
      kink_q_1: 'Что добавляет страсти именно тебе: нежность и чувственность или смелые эксперименты?',
      kink_q_2: 'Насколько тебе интересны ролевые игры, сценарии или лёгкий бондаж?',
      kink_q_3: 'Что для тебя однозначное табу, а что ты открыт(а) исследовать с партнёром?',
      edit_title: 'Редактирование анкеты',
      aria_shop: 'Магазин Stars', aria_edit: 'Редактировать анкету',
      aria_photo: 'Изменить фото', alt_profile_photo: 'Фото профиля',
      f_seeking: 'Кого ищу',
      opt_male: 'Мужчину', opt_female: 'Женщину', opt_any: 'Неважно',
      f_goal: 'Цель',
      opt_longterm: 'Долгосрочные отношения', opt_fun: 'Развлечься', opt_situational: 'По ситуации',
      f_age: 'Возраст', f_city: 'Город',
      f_interests: 'Интересы (через запятую)',
      cancel: 'Отмена', save: 'Сохранить',
      age_range_err: 'Возраст должен быть от 18 до 100',
      saving: 'Сохраняю…', saved: 'Сохранено ✓',
      save_fail: 'Не удалось сохранить — попробуй ещё раз',
      delete_account: 'Удалить аккаунт',
      delete_confirm: 'Удалить аккаунт навсегда? Твоя анкета, ответы, мэтчи, сообщения и фото будут безвозвратно стёрты.\n\n⚠️ Внимание! Твой текущий баланс ({bal} ⭐️) будет безвозвратно аннулирован без возможности возврата средств после удаления аккаунта.',
      delete_fail: 'Не удалось удалить. Попробуй ещё раз.',
      invite_text: 'Присоединяйся к Sixtio — AI найдёт тебе настоящую пару 💜',
      link_copied: 'Ссылка скопирована!',
      shop_subtitle: 'Магазин Sixtio — пополни баланс и открой Premium 💎',
      ob_hello_gender: 'Привет! Я Sixtio 💜 Сначала немного о тебе. Кто ты?',
      ob_i_male: 'Мужчина', ob_i_female: 'Женщина',
      ob_seeking_q: 'Кого ты хочешь встретить?',
      ob_goal_q: 'Что ты ищешь в Sixtio?',
      ob_age_q: 'Сколько тебе лет?',
      ob_city_q: 'Из какого ты города?',
      ob_interests_q: 'Расскажи о своих интересах — просто через запятую. Например: путешествия, кино, бег',
      ob_bio_q: 'Пару слов о себе — как бы ты представил себя человеку, который тебе нравится?',
      ob_bio_q_f: 'Пару слов о себе — как бы ты представила себя человеку, который тебе нравится?',
      ob_photo_q: 'И добавь своё фото — его увидит только человек, с которым у вас мэтч.',
      ob_q1: 'А теперь — самое интересное. Расскажи о моменте за последний год, когда ты почувствовал себя по-настоящему живым. Где ты был, с кем, и что делало его настоящим?',
      ob_q1_f: 'А теперь — самое интересное. Расскажи о моменте за последний год, когда ты почувствовала себя по-настоящему живой. Где ты была, с кем, и что делало его настоящим?',
      ob_q2: 'Когда близкий человек тебя разочаровывает — что происходит внутри тебя в первую минуту, и как ты обычно действуешь дальше?',
      ob_q3: 'Что человек должен сделать или сказать, чтобы ты почувствовал: «вот с этим я могу быть собой»?',
      ob_q3_f: 'Что человек должен сделать или сказать, чтобы ты почувствовала: «вот с этим я могу быть собой»?',
      ob_q4: 'За что тебя по-настоящему ценят те, кто знает тебя давно, — и согласен ли ты с ними?',
      ob_q4_f: 'За что тебя по-настоящему ценят те, кто знает тебя давно, — и согласна ли ты с ними?',
      ob_q5: 'И последнее, самое важное: что ты больше не готов терпеть в отношениях — и что научило тебя этой границе?',
      ob_q5_f: 'И последнее, самое важное: что ты больше не готова терпеть в отношениях — и что научило тебя этой границе?',
      ob_d1: 'Что в тебе изменилось за последние несколько лет — и как ты к этому относишься?',
      ob_d2: 'Какая твоя маленькая странность, которую по-настоящему оценит только правильный человек?',
      ob_d3: 'Когда ты представляешь общее будущее с кем-то — что в этой картине для тебя самое важное?',
      ob_d4: 'В какой момент ты чувствуешь наибольшее одиночество — и что помогает из него выйти?',
      ob_d5: 'Что ты понял о любви такого, чего не знал в 20?',
      ob_d5_f: 'Что ты поняла о любви такого, чего не знала в 20?',
      ob_deepen_hello: 'Рада видеть тебя снова! Несколько новых вопросов — и я пойму тебя ещё глубже ✨',
      ob_step: 'Шаг {n} из {total}', ob_done_lbl: 'Готово',
      ob_write_ph: 'Напишите ответ...', ob_age_ph: 'Укажи возраст числом...', ob_city_ph: 'Напиши город...',
      ob_send_aria: 'Отправить',
      ob_pick_photo: '📷 Выбрать фото', ob_skip: 'Пропустить', ob_share_gps: '📍 Поделиться локацией',
      ob_city_manual: 'Хорошо — впиши город вручную 🙂',
      ob_city_fail: 'Не удалось определить город — впиши его вручную 🙂',
      ob_age_minor: 'Sixtio знакомит только совершеннолетних — укажи возраст от 18 🙂',
      ob_age_nan: 'Укажи, пожалуйста, возраст числом — например, 25',
      ob_photo_ok: 'Отличное фото! 📸',
      ob_photo_fail: 'Не удалось загрузить фото — попробуем позже, это не помешает знакомству.',
      ob_photo_read_fail: 'Не удалось прочитать это фото. Попробуй другое.',
      ob_photo_alt: 'Твоё фото',
      ob_card_title: 'Вот как Sixtio тебя поняла',
      ob_card_next: 'Скоро Sixtio предложит первое знакомство.',
      ob_thanks: 'Спасибо, что поделился(-лась)',
      ob_thanks_sub: 'Sixtio уже анализирует твои ответы, чтобы найти человека с настоящей совместимостью. Скоро продолжим.',
      ob_continue: 'Продолжить',
      cv_title: 'Разговор',
      cv_view_match: 'посмотреть мэтч ›',
      cv_intro: 'Sixtio свела вас по настоящей совместимости. Напиши первое сообщение — с чего-то тёплого и искреннего.',
      cv_msg_ph: 'Сообщение...',
      cv_open_tg: 'Открыть @{u} в Telegram',
      cv_no_username: '✈️ Вы обменялись — но у человека нет @юзернейма в Telegram',
      cv_waiting: '⏳ Ждём, пока {name} тоже согласится',
      cv_pair: 'пара',
      cv_share_btn: 'Обменяться Telegram',
      kink_dominant: 'Доминирование', kink_submissive: 'Подчинение', kink_switch: 'Свитч',
      kink_sensual: 'Чувственность', kink_passionate: 'Страсть', kink_romantic: 'Романтика',
      kink_tender: 'Нежность', kink_playful: 'Игривость', kink_experimental: 'Эксперименты',
      kink_adventurous: 'Авантюрность', kink_curious: 'Любопытство', kink_vanilla: 'Классика',
      kink_roleplay: 'Ролевые игры', kink_bondage: 'Бондаж', kink_voyeur: 'Вуайеризм',
      kink_exhibitionist: 'Эксгибиционизм',
      pw_default_sub: 'Твой лимит симпатий на сегодня исчерпан. Выбери, как продолжить 💜',
      pw_balance: 'Баланс:',
      pw_premium_name: 'Premium · 30 дней',
      pw_hit: 'ХИТ',
      pw_b1: '♾️ Безлимитные симпатии',
      pw_b2: '👁 Фото без размытия',
      pw_b3: '🧠 «Почему вы подходите» — без ограничений',
      pw_b4: '📊 Аналитика Digital Twin',
      pw_pack_name: '+30 симпатий',
      pw_pack_note: 'Топ-ап на сегодня. Фото остаются размытыми.',
      pw_deposit_h: 'Пополнить баланс звёздами Telegram',
      pw_tag_popular: 'ПОПУЛЯРНОЕ', pw_tag_value: 'ВЫГОДНО',
      pw_invite_q: 'Мало звёзд?',
      pw_invite_u: 'Пригласи друзей (+15 ⭐ за каждого)',
      pw_tg_only: 'Оплата звёздами доступна только в приложении Telegram.',
      pw_invoice_prep: 'Готовим счёт…',
      pw_invoice_fail: 'Не удалось создать счёт. Попробуй ещё раз.',
      pw_paid: '✅ +{n} ⭐ зачислено на баланс!',
      pw_pay_fail: 'Оплата не прошла. Попробуй ещё раз.',
      pw_net_err: 'Ошибка сети. Попробуй ещё раз.',
      pw_processing: 'Обработка…',
      pw_insufficient_invite: 'Недостаточно звёзд — пригласи друзей, чтобы заработать ⭐',
      pw_insufficient: 'Недостаточно звёзд.',
      pw_fail: 'Не получилось. Попробуй ещё раз.'
    }
  };

  // Map a raw IETF code to a supported app language. Identical contract to the
  // server's resolveLang() in api/_lib/telegram.js — keep them in lock-step.
  //   uk -> uk; ru/be -> ru; any other real code (es, de, …) -> en; ''/missing -> uk.
  function normalize(raw) {
    var code = String(raw || '').toLowerCase().split('-')[0];
    if (!code) return 'uk';
    if (code === 'uk') return 'uk';
    if (code === 'ru' || code === 'be') return 'ru';
    return 'en';
  }

  // Pull language_code STRICTLY from the live Telegram SDK — never from a DB or
  // localStorage cache. Two independent sources are probed so a client that
  // hasn't populated initDataUnsafe yet still resolves from the raw initData
  // query string (both are freshly injected by telegram-web-app.js each launch):
  //   1) window.Telegram.WebApp.initDataUnsafe.user.language_code
  //   2) the `user` param parsed out of window.Telegram.WebApp.initData
  // Returns '' when Telegram genuinely exposes nothing (guest / not-in-Telegram).
  function readTelegramCode() {
    var w;
    try { w = window.Telegram && window.Telegram.WebApp; } catch (e) { w = null; }
    if (!w) return '';
    try {
      var u = w.initDataUnsafe && w.initDataUnsafe.user;
      if (u && u.language_code) return u.language_code;
    } catch (e) {}
    try {
      if (w.initData) {
        var raw = new URLSearchParams(w.initData).get('user');
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.language_code) return parsed.language_code;
        }
      }
    } catch (e) {}
    return '';
  }

  // The webview's own locale — the decisive fallback for ENGLISH users. Telegram
  // omits `language_code` for its DEFAULT interface language (English): uk/ru
  // accounts get an explicit 'uk'/'ru', but an English account frequently sends
  // an EMPTY code. Reading only Telegram then mapped that blank to 'uk', so the
  // UI stayed Ukrainian no matter how the user set Telegram to English — the exact
  // asymmetry reported (uk/ru switch, en never does). navigator.language reflects
  // the OS/Telegram English locale, recovering 'en' when Telegram itself is silent.
  function readBrowserCode() {
    try {
      var n = window.navigator;
      if (!n) return '';
      if (n.languages && n.languages.length) return n.languages[0];
      return n.language || n.userLanguage || '';
    } catch (e) { return ''; }
  }

  // The signed Telegram user id, probed the same two ways as the language code.
  // Used to NAMESPACE our localStorage per account: on Telegram Web (desktop
  // browser) every account shares one origin and therefore one localStorage, so
  // an un-namespaced override/seen from account A would leak into account B when
  // you switch accounts. Keying by id isolates each account. Returns '' when no
  // id is available (guest / not in Telegram) — then a single global key is used.
  function readUserId() {
    var w;
    try { w = window.Telegram && window.Telegram.WebApp; } catch (e) { w = null; }
    if (!w) return '';
    try {
      var u = w.initDataUnsafe && w.initDataUnsafe.user;
      if (u && u.id) return String(u.id);
    } catch (e) {}
    try {
      if (w.initData) {
        var raw = new URLSearchParams(w.initData).get('user');
        if (raw) {
          var parsed = JSON.parse(raw);
          if (parsed && parsed.id) return String(parsed.id);
        }
      }
    } catch (e) {}
    return '';
  }
  function lsKey(base) {
    var uid = readUserId();
    return uid ? (base + '_' + uid) : base;
  }

  // A manual, user-chosen language (the switcher). Needed only where Telegram
  // can't express the wanted language — e.g. English on Telegram Desktop, whose
  // signed `language_code` is the ACCOUNT language ('ru') and never reflects the
  // local Interface Language toggle. Returns '' when the user never picked.
  function readOverride() {
    try {
      var v = window.localStorage.getItem(lsKey('sixtio_lang_override'));
      if (v === 'uk' || v === 'ru' || v === 'en') return v;
    } catch (e) {}
    return '';
  }

  // detect() decides the active language with Telegram as the PRIMARY authority:
  //
  //   1) If Telegram now reports a language DIFFERENT from what it reported at
  //      the previous launch, the user changed their Telegram language — honor
  //      it immediately and drop any stale manual override. (This is what makes
  //      the switcher pill always follow the Telegram setting when it changes.)
  //   2) Otherwise a manual override wins — the only way English survives on
  //      Telegram Desktop, where Telegram keeps reporting 'ru' no matter what.
  //   3) Otherwise follow Telegram's current language,
  //   4) then the webview locale, then 'uk' (home-market default).
  //
  // The last-seen Telegram language is remembered in localStorage so a real
  // Telegram-side language change can be distinguished from a mere re-launch.
  function detect() {
    var tgLang = '';
    var raw = readTelegramCode();
    if (raw) tgLang = normalize(raw);

    var seenKey = lsKey('sixtio_lang_tg_seen');
    var seen = '';
    try { seen = window.localStorage.getItem(seenKey) || ''; } catch (e) {}

    if (tgLang) {
      if (seen && tgLang !== seen) {
        // Telegram's language changed since last launch -> user changed it there.
        try { window.localStorage.setItem(seenKey, tgLang); } catch (e) {}
        try { window.localStorage.removeItem(lsKey('sixtio_lang_override')); } catch (e) {}
        return tgLang;
      }
      if (!seen) {
        // First readable Telegram language: remember it, but keep any existing
        // manual override (so a persisted English choice isn't wiped on upgrade).
        try { window.localStorage.setItem(seenKey, tgLang); } catch (e) {}
      }
    }

    var ov = readOverride();
    if (ov) return ov;

    if (tgLang) return tgLang;
    return normalize(readBrowserCode());
  }

  var lang = detect();
  try { document.documentElement.lang = lang; } catch (e) {}
  try { window.localStorage.setItem('sixtio_lang', lang); } catch (e) {}

  // t('key') / t('key', {n: 3}) — resolves the active language first, then falls
  // back to ENGLISH (the universal international layer), then Ukrainian, then the
  // key itself. English is tried before Ukrainian on purpose: an 'en' user with a
  // (hypothetically) missing key must never be dumped back into Ukrainian — that
  // was the exact "English silently reverts to UK" failure this fixes. A missing
  // translation can still never blank the UI.
  function t(key, params) {
    var s = (D[lang] && D[lang][key]);
    if (s === undefined) s = D.en[key];
    if (s === undefined) s = D.uk[key];
    if (s === undefined) return key;
    if (params) {
      for (var k in params) {
        if (Object.prototype.hasOwnProperty.call(params, k)) {
          s = s.split('{' + k + '}').join(String(params[k]));
        }
      }
    }
    return s;
  }

  // Localized label for a standardized kink marker token; unknown tokens pass
  // through verbatim (server vocabulary may grow ahead of the client).
  function kink(marker) {
    var v = t('kink_' + marker);
    return v === 'kink_' + marker ? marker : v;
  }

  // Rewrites all annotated static nodes under `root` (default: whole document).
  //   data-i18n       -> textContent
  //   data-i18n-html  -> innerHTML (trusted dictionary markup only)
  //   data-i18n-ph    -> placeholder attribute
  //   data-i18n-aria  -> aria-label attribute
  //   data-i18n-alt   -> alt attribute (images)
  function apply(root) {
    root = root || document;
    var i, els;
    els = root.querySelectorAll('[data-i18n]');
    for (i = 0; i < els.length; i++) els[i].textContent = t(els[i].getAttribute('data-i18n'));
    els = root.querySelectorAll('[data-i18n-html]');
    for (i = 0; i < els.length; i++) els[i].innerHTML = t(els[i].getAttribute('data-i18n-html'));
    els = root.querySelectorAll('[data-i18n-ph]');
    for (i = 0; i < els.length; i++) els[i].setAttribute('placeholder', t(els[i].getAttribute('data-i18n-ph')));
    els = root.querySelectorAll('[data-i18n-aria]');
    for (i = 0; i < els.length; i++) els[i].setAttribute('aria-label', t(els[i].getAttribute('data-i18n-aria')));
    els = root.querySelectorAll('[data-i18n-alt]');
    for (i = 0; i < els.length; i++) els[i].setAttribute('alt', t(els[i].getAttribute('data-i18n-alt')));
  }

  // Re-derive the language from the live Telegram SDK and, if it changed since
  // the frozen initial value, hot-swap the whole UI. This defeats two failure
  // modes at once:
  //   • the freeze-race — initDataUnsafe not yet populated when the IIFE first
  //     ran, so `lang` locked to the 'uk' fallback and never recovered;
  //   • a stale interface — the user switched Telegram language mid-session.
  // Because t()/kink() close over the outer `lang`, updating it here instantly
  // re-localizes every subsequent call; apply() repaints the static nodes and a
  // 'sixtio:langchange' event lets pages redraw any dynamic (API-driven) content.
  function refresh() {
    var next = detect();
    if (next === lang) return false;
    lang = next;
    api.lang = next;
    try { document.documentElement.lang = next; } catch (e) {}
    try { window.localStorage.setItem('sixtio_lang', next); } catch (e) {}
    apply(document);
    syncSwitchers();
    try { window.dispatchEvent(new CustomEvent('sixtio:langchange', { detail: next })); } catch (e) {}
    return true;
  }

  // Persist an explicit user choice and hot-swap the UI immediately. Called by
  // the language switcher. Stores the override so it survives reloads and beats
  // auto-detection forever after (until changed). Re-localizes every static node
  // and fires 'sixtio:langchange' so dynamic (API-driven) pages redraw too.
  function setLang(next) {
    if (next !== 'uk' && next !== 'ru' && next !== 'en') return false;
    try { window.localStorage.setItem(lsKey('sixtio_lang_override'), next); } catch (e) {}
    var changed = next !== lang;
    lang = next;
    api.lang = next;
    try { document.documentElement.lang = next; } catch (e) {}
    try { window.localStorage.setItem('sixtio_lang', next); } catch (e) {}
    apply(document);
    syncSwitchers();
    if (changed) {
      try { window.dispatchEvent(new CustomEvent('sixtio:langchange', { detail: next })); } catch (e) {}
    }
    return changed;
  }

  // --- Language switcher widget -------------------------------------------
  // Any element with [data-lang-switch] is turned into a UA/RU/EN segmented
  // control. Self-contained: styles are injected once, so a page only needs the
  // empty host element. Reusable across every screen.
  var SWITCH_OPTS = [['ru', 'RU'], ['uk', 'UA'], ['en', 'EN']];
  function injectSwitchStyle() {
    if (document.getElementById('sx-lang-style')) return;
    var css =
      '[data-lang-switch]{display:inline-flex;gap:2px;padding:3px;border-radius:999px;' +
      'background:rgba(127,127,127,.14);-webkit-backdrop-filter:blur(6px);backdrop-filter:blur(6px);}' +
      '.sx-lang-btn{appearance:none;border:0;cursor:pointer;font:600 12px/1 inherit;' +
      'letter-spacing:.3px;padding:6px 11px;border-radius:999px;color:var(--hint,#8b8b93);' +
      'background:transparent;transition:color .18s ease,background .18s ease;}' +
      '.sx-lang-btn.is-active{color:#fff;background:var(--a1,#7c4dff);' +
      'box-shadow:0 2px 10px -2px var(--glow,rgba(124,77,255,.5));}';
    var st = document.createElement('style');
    st.id = 'sx-lang-style';
    st.textContent = css;
    (document.head || document.documentElement).appendChild(st);
  }
  function syncSwitchers() {
    var btns = document.querySelectorAll('.sx-lang-btn');
    for (var i = 0; i < btns.length; i++) {
      var on = btns[i].getAttribute('data-lang-opt') === lang;
      btns[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      if (on) btns[i].classList.add('is-active'); else btns[i].classList.remove('is-active');
    }
  }
  function mountSwitchers() {
    var hosts = document.querySelectorAll('[data-lang-switch]');
    if (!hosts.length) return;
    injectSwitchStyle();
    for (var h = 0; h < hosts.length; h++) {
      var host = hosts[h];
      if (host.getAttribute('data-lang-mounted')) continue;
      host.setAttribute('data-lang-mounted', '1');
      host.setAttribute('role', 'group');
      host.setAttribute('aria-label', 'Language');
      host.innerHTML = '';
      for (var o = 0; o < SWITCH_OPTS.length; o++) {
        var b = document.createElement('button');
        b.type = 'button';
        b.className = 'sx-lang-btn';
        b.setAttribute('data-lang-opt', SWITCH_OPTS[o][0]);
        b.textContent = SWITCH_OPTS[o][1];
        (function (code) {
          b.addEventListener('click', function () {
            var tg = window.Telegram && window.Telegram.WebApp;
            if (tg && tg.HapticFeedback) { try { tg.HapticFeedback.selectionChanged(); } catch (e) {} }
            setLang(code);
          });
        })(SWITCH_OPTS[o][0]);
        host.appendChild(b);
      }
    }
    syncSwitchers();
  }

  var api = { lang: lang, t: t, kink: kink, apply: apply, detect: detect, refresh: refresh, setLang: setLang, mountSwitchers: mountSwitchers };
  window.SixtioI18n = api;

  // Attach the ACTIVE UI language to every same-origin API call that already
  // carries initData, so the server renders AI content — and stores the language
  // used for out-of-band bot notifications — in the language the user actually
  // SEES (the switcher), not merely the Telegram account language. Done once and
  // centrally, so no per-page api() helper has to change and future calls are
  // covered automatically. Only JSON bodies with an initData field are touched;
  // FormData/binary uploads, cross-origin, and non-API calls pass through as-is.
  (function patchFetchForLang() {
    if (!window.fetch || window.__sixtioLangFetch) return;
    window.__sixtioLangFetch = true;
    var orig = window.fetch.bind(window);
    window.fetch = function (input, init) {
      try {
        var url = typeof input === 'string' ? input : (input && input.url) || '';
        if (init && typeof init.body === 'string' && url.indexOf('/api/') !== -1) {
          var data = JSON.parse(init.body);
          if (data && typeof data === 'object' && !Array.isArray(data) &&
              Object.prototype.hasOwnProperty.call(data, 'initData') && data.lang == null) {
            data.lang = lang;
            init = Object.assign({}, init, { body: JSON.stringify(data) });
          }
        }
      } catch (e) { /* non-JSON body or parse issue -> send unchanged */ }
      return orig(input, init);
    };
  })();

  // Apply as early as possible, then re-verify at every point the Telegram SDK
  // could have finished (or changed) its init data: on DOM ready, and once the
  // WebApp reports ready(). This is the cache-bust sweep the lifecycle needs.
  function sweep() { apply(document); refresh(); mountSwitchers(); }
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', sweep);
  } else {
    sweep();
  }
  try {
    var wa = window.Telegram && window.Telegram.WebApp;
    if (wa && typeof wa.ready === 'function') {
      var origReady = wa.ready.bind(wa);
      wa.ready = function () { var r = origReady(); refresh(); return r; };
    }
  } catch (e) {}
})();
