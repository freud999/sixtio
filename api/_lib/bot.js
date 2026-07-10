const APP_URL = process.env.APP_URL || 'https://sixtio.vercel.app';
const OWNER_TELEGRAM_ID = Number(process.env.OWNER_TELEGRAM_ID || 0);

export async function callBot(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || res.status}`);
  return data.result;
}

/**
 * Best-effort owner alert for ops/fraud signals (e.g. referral abuse). No-op if
 * OWNER_TELEGRAM_ID is unset; never throws, so a failed ping can't break a flow.
 * `text` is sent HTML-parsed — callers must pre-escape any user-derived content.
 */
export async function notifyOwner(text) {
  if (!OWNER_TELEGRAM_ID) return;
  try {
    await callBot('sendMessage', { chat_id: OWNER_TELEGRAM_ID, text, parse_mode: 'HTML' });
  } catch (e) {
    console.error('owner notify failed:', e.message);
  }
}

// --- Localization (Task 28) -----------------------------------------------
// Bot pushes are out-of-band: there is no initData to derive the language from,
// so recipients carry their stored users.language_code (synced from the signed
// initData on every app open by /api/me). Same mapping as telegram.resolveLang.
export function botLang(code) {
  const c = String(code || '').toLowerCase().split('-')[0];
  if (!c || c === 'uk') return 'uk';
  if (c === 'ru' || c === 'be') return 'ru';
  return 'en';
}

const T = {
  uk: {
    open_btn: 'Відкрити Sixtio',
    reply_btn: 'Відповісти в Sixtio',
    someone: 'Хтось особливий',
    your_match: 'Твоя пара',
    match_found: (line, reason) =>
      `💜 Sixtio знайшла тобі пару!\n\n${line}\n\n${reason}\n\nВідкрий Sixtio, щоб побачити профіль ✨`,
    referral_bonus: "🎉 Твій друг пройшов інтерв'ю! Тобі нараховано 15 бонусних ⭐",
    instant_match: (name) => `🔥 ШІ знайшов твій ідеальний метч! ${name} чекає на тебе в чаті.`,
    retention: '✨ Sixtio проаналізував нові анкети і знайшов 3 людей з сумісністю >80%. Зазирни в додаток!',
    new_message: (name, preview) => `💬 ${name} написав(-ла) тобі:\n\n"${preview}"`,
  },
  en: {
    open_btn: 'Open Sixtio',
    reply_btn: 'Reply in Sixtio',
    someone: 'Someone special',
    your_match: 'Your match',
    match_found: (line, reason) =>
      `💜 Sixtio found you a match!\n\n${line}\n\n${reason}\n\nOpen Sixtio to see the profile ✨`,
    referral_bonus: '🎉 Your friend finished the interview! You earned 15 bonus ⭐',
    instant_match: (name) => `🔥 The AI found your perfect match! ${name} is waiting for you in the chat.`,
    retention: '✨ Sixtio analyzed new profiles and found 3 people with >80% compatibility. Check the app!',
    new_message: (name, preview) => `💬 ${name} sent you a message:\n\n"${preview}"`,
  },
  ru: {
    open_btn: 'Открыть Sixtio',
    reply_btn: 'Ответить в Sixtio',
    someone: 'Кто-то особенный',
    your_match: 'Твоя пара',
    match_found: (line, reason) =>
      `💜 Sixtio нашла тебе пару!\n\n${line}\n\n${reason}\n\nОткрой Sixtio, чтобы увидеть профиль ✨`,
    referral_bonus: '🎉 Твой друг прошёл интервью! Тебе начислено 15 бонусных ⭐',
    instant_match: (name) => `🔥 ИИ нашёл твой идеальный мэтч! ${name} ждёт тебя в чате.`,
    retention: '✨ Sixtio проанализировал новые анкеты и нашёл 3 человек с совместимостью >80%. Загляни в приложение!',
    new_message: (name, preview) => `💬 ${name} написал(-а) тебе:\n\n"${preview}"`,
  },
};

const dict = (code) => T[botLang(code)];

/** Sends the "we found you a match" message to one user about their partner. */
async function notifyOne(to, partner, reason) {
  const d = dict(to.language_code);
  const name = (partner.name || '').split(' ')[0] || d.someone;
  const line = `${name}, ${partner.age}${partner.city ? ' · ' + partner.city : ''}`;
  const text = d.match_found(line, reason);
  const reply_markup = {
    inline_keyboard: [[{ text: d.open_btn, web_app: { url: APP_URL } }]],
  };
  try {
    if (partner.photo_url) {
      await callBot('sendPhoto', {
        chat_id: to.telegram_id,
        photo: partner.photo_url,
        caption: text,
        reply_markup,
      });
    } else {
      await callBot('sendMessage', { chat_id: to.telegram_id, text, reply_markup });
    }
  } catch (e) {
    // A user who never pressed Start can't receive bot messages — don't fail the match.
    console.error(`match notification to ${to.telegram_id} failed:`, e.message);
  }
}

export async function notifyMatchBoth(userOne, userTwo, reason) {
  await notifyOne(userOne, userTwo, reason);
  await notifyOne(userTwo, userOne, reason);
}

/** Tells a referrer their invited friend finished onboarding and stars were credited. */
export async function notifyReferralBonus(telegramId, langCode) {
  const d = dict(langCode);
  const reply_markup = {
    inline_keyboard: [[{ text: d.open_btn, web_app: { url: APP_URL } }]],
  };
  try {
    await callBot('sendMessage', { chat_id: telegramId, text: d.referral_bonus, reply_markup });
  } catch (e) {
    // A referrer who never pressed Start can't be messaged — don't fail the credit.
    console.error(`referral bonus ping to ${telegramId} failed:`, e.message);
  }
}

// --- Retention engine (Task 9) -----------------------------------------
// Fire-and-forget nudge with an "Open Sixtio" button; self-guarded so a user
// who never pressed Start (can't be messaged) never breaks the caller.
async function nudge(telegramId, text, langCode, url) {
  const reply_markup = {
    inline_keyboard: [[{ text: dict(langCode).open_btn, web_app: { url: url || APP_URL } }]],
  };
  try {
    await callBot('sendMessage', { chat_id: telegramId, text, reply_markup });
  } catch (e) {
    console.error(`nudge to ${telegramId} failed:`, e.message);
  }
}

const firstNameOf = (name, d) => (name || '').split(' ')[0] || d.someone;

/** Instant mutual-swipe match — pings both sides. Never throws. */
export async function notifyInstantMatch(userA, userB) {
  const dA = dict(userA.language_code), dB = dict(userB.language_code);
  await nudge(userA.telegram_id, dA.instant_match(firstNameOf(userB.name, dA)), userA.language_code);
  await nudge(userB.telegram_id, dB.instant_match(firstNameOf(userA.name, dB)), userB.language_code);
}

/** 48-hour inactivity retention nudge. Never throws. */
export async function notifyRetention(telegramId, langCode) {
  await nudge(telegramId, dict(langCode).retention, langCode);
}

/** Pings a user that their match sent them a new in-app message. */
export async function notifyNewMessage(to, fromName, preview, matchId) {
  const d = dict(to.language_code);
  const name = (fromName || '').split(' ')[0] || d.your_match;
  const text = d.new_message(name, preview);
  const url = matchId
    ? `${APP_URL}/conversation.html?match=${encodeURIComponent(matchId)}`
    : `${APP_URL}/chat.html`;
  const reply_markup = {
    inline_keyboard: [[{ text: d.reply_btn, web_app: { url } }]],
  };
  try {
    await callBot('sendMessage', { chat_id: to.telegram_id, text, reply_markup });
  } catch (e) {
    console.error(`new-message ping to ${to.telegram_id} failed:`, e.message);
  }
}
