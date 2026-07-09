// Sixtio — public bot commands (Task 37).
//
// The Telegram webhook points at /api/chat, which forwards raw updates with an
// `update_id` to analytics.handleTelegramUpdate. That router owns /start, /stats
// (owner-only) and Stars payments; this module owns the remaining PUBLIC user
// commands so the bot feels like a real product, not just a Mini-App launcher:
//
//   /help      — help + command list + "Open Sixtio" button
//   /feedback  — two-way feedback: forwards the user's message to the owner;
//                the owner can REPLY to that forwarded message and the bot relays
//                the reply back to the user (stateless — the user id is parsed out
//                of the forwarded message text, no DB/session needed)
//   /language  — how to change the interface language (the in-app 🌐 switcher)
//
// It lives in /api/_lib so it adds ZERO Vercel functions (Hobby caps at 12).
// Every reply is localized uk/ru/en via the sender's live Telegram language_code.

import { callBot, botLang } from './bot.js';
import { findUserId, deleteUserCascade } from './supabase.js';
import { buildReferralLink } from './referrals.js';

const APP_URL = process.env.APP_URL || 'https://sixtio.vercel.app';
const OWNER_TELEGRAM_ID = Number(process.env.OWNER_TELEGRAM_ID || 0);

// Marker embedded in every forwarded-feedback message. Used to (a) recognise an
// owner REPLY to a feedback item and (b) parse the original sender's id back out.
// Kept language-neutral so owner replies work regardless of the owner's language.
const FEEDBACK_TAG = '🆔';

const T = {
  uk: {
    help:
      '🧭 <b>Sixtio — довідка</b>\n\n' +
      'Я — AI-сваха. Ставлю кілька щирих запитань і знаходжу людину, ' +
      'з якою в тебе справжня сумісність. Не свайпи — знайомства, що мають сенс.\n\n' +
      '<b>Команди:</b>\n' +
      '/start — почати або відкрити застосунок\n' +
      '/help — ця довідка\n' +
      '/invite — запросити друга (+15 ⭐ за кожного)\n' +
      '/feedback — надіслати відгук або повідомити про проблему\n' +
      '/language — як змінити мову\n' +
      '/delete — видалити акаунт\n\n' +
      '🔒 Приватно: твого профілю Telegram ніхто не бачить.',
    open_btn: 'Відкрити Sixtio',
    inv_text:
      '🎁 <b>Запроси друга в Sixtio</b>\n\n' +
      'За кожного друга, який пройде інтерв\'ю, ти отримаєш <b>+15 ⭐</b>.\n\n' +
      'Твоє персональне посилання:\n{link}',
    inv_share_btn: '📨 Поділитися посиланням',
    inv_share_text: 'Знайди свою пару за психологічною сумісністю в Sixtio 💜',
    del_confirm_q:
      '⚠️ <b>Видалити акаунт?</b>\n\n' +
      'Це назавжди видалить твій профіль, відповіді, метчі та листування. ' +
      'Дію не можна скасувати.',
    del_yes_btn: '🗑️ Так, видалити',
    del_no_btn: 'Скасувати',
    del_done: '🗑️ Твій акаунт видалено. Буде сумно без тебе — повертайся будь-коли через /start.',
    del_gone: 'Акаунта вже немає.',
    del_cancelled: '💜 Скасовано. Твій акаунт на місці.',
    fb_prompt:
      '✍️ Напиши свій відгук або опиши проблему одним повідомленням — ' +
      'я передам його команді Sixtio.',
    fb_placeholder: 'Твій відгук…',
    fb_thanks: '💜 Дякуємо! Твій відгук передано команді Sixtio.',
    fb_empty: 'Порожній відгук. Спробуй ще раз: /feedback',
    reply_from_team: '💬 Відповідь від команди Sixtio:',
    lang:
      '🌐 Мову інтерфейсу можна змінити прямо у застосунку — натисни іконку 🌐 ' +
      'угорі на головному екрані або у профілі.\n\n' +
      'Доступно: Українська · Русский · English.',
  },
  en: {
    help:
      '🧭 <b>Sixtio — help</b>\n\n' +
      'I\'m an AI matchmaker. I ask a few sincere questions and find someone ' +
      'you\'re truly compatible with. Not swipes — connections that make sense.\n\n' +
      '<b>Commands:</b>\n' +
      '/start — begin or open the app\n' +
      '/help — this help\n' +
      '/invite — invite a friend (+15 ⭐ each)\n' +
      '/feedback — send feedback or report a problem\n' +
      '/language — how to change the language\n' +
      '/delete — delete your account\n\n' +
      '🔒 Private: no one sees your Telegram profile.',
    open_btn: 'Open Sixtio',
    inv_text:
      '🎁 <b>Invite a friend to Sixtio</b>\n\n' +
      'For every friend who finishes the interview you earn <b>+15 ⭐</b>.\n\n' +
      'Your personal link:\n{link}',
    inv_share_btn: '📨 Share the link',
    inv_share_text: 'Find your match by real psychological compatibility on Sixtio 💜',
    del_confirm_q:
      '⚠️ <b>Delete your account?</b>\n\n' +
      'This permanently removes your profile, answers, matches and chats. ' +
      'This cannot be undone.',
    del_yes_btn: '🗑️ Yes, delete',
    del_no_btn: 'Cancel',
    del_done: '🗑️ Your account was deleted. We\'ll miss you — come back anytime via /start.',
    del_gone: 'There\'s no account to delete.',
    del_cancelled: '💜 Cancelled. Your account is safe.',
    fb_prompt:
      '✍️ Write your feedback or describe the issue in one message — ' +
      'I\'ll pass it to the Sixtio team.',
    fb_placeholder: 'Your feedback…',
    fb_thanks: '💜 Thank you! Your feedback was sent to the Sixtio team.',
    fb_empty: 'Empty feedback. Try again: /feedback',
    reply_from_team: '💬 A reply from the Sixtio team:',
    lang:
      '🌐 You can change the interface language right inside the app — tap the 🌐 ' +
      'icon at the top of the home screen or in your profile.\n\n' +
      'Available: Українська · Русский · English.',
  },
  ru: {
    help:
      '🧭 <b>Sixtio — справка</b>\n\n' +
      'Я — AI-сваха. Задаю несколько искренних вопросов и нахожу человека, ' +
      'с которым у тебя настоящая совместимость. Не свайпы — знакомства со смыслом.\n\n' +
      '<b>Команды:</b>\n' +
      '/start — начать или открыть приложение\n' +
      '/help — эта справка\n' +
      '/invite — пригласить друга (+15 ⭐ за каждого)\n' +
      '/feedback — отправить отзыв или сообщить о проблеме\n' +
      '/language — как изменить язык\n' +
      '/delete — удалить аккаунт\n\n' +
      '🔒 Приватно: твой профиль Telegram никто не видит.',
    open_btn: 'Открыть Sixtio',
    inv_text:
      '🎁 <b>Пригласи друга в Sixtio</b>\n\n' +
      'За каждого друга, который пройдёт интервью, ты получишь <b>+15 ⭐</b>.\n\n' +
      'Твоя персональная ссылка:\n{link}',
    inv_share_btn: '📨 Поделиться ссылкой',
    inv_share_text: 'Найди свою пару по психологической совместимости в Sixtio 💜',
    del_confirm_q:
      '⚠️ <b>Удалить аккаунт?</b>\n\n' +
      'Это навсегда удалит твой профиль, ответы, мэтчи и переписку. ' +
      'Действие нельзя отменить.',
    del_yes_btn: '🗑️ Да, удалить',
    del_no_btn: 'Отмена',
    del_done: '🗑️ Твой аккаунт удалён. Будем скучать — возвращайся в любой момент через /start.',
    del_gone: 'Аккаунта уже нет.',
    del_cancelled: '💜 Отменено. Твой аккаунт на месте.',
    fb_prompt:
      '✍️ Напиши свой отзыв или опиши проблему одним сообщением — ' +
      'я передам его команде Sixtio.',
    fb_placeholder: 'Твой отзыв…',
    fb_thanks: '💜 Спасибо! Твой отзыв передан команде Sixtio.',
    fb_empty: 'Пустой отзыв. Попробуй ещё раз: /feedback',
    reply_from_team: '💬 Ответ от команды Sixtio:',
    lang:
      '🌐 Язык интерфейса можно изменить прямо в приложении — нажми иконку 🌐 ' +
      'вверху на главном экране или в профиле.\n\n' +
      'Доступно: Українська · Русский · English.',
  },
};

const d = (code) => T[botLang(code)];
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const openKeyboard = (t) => ({ inline_keyboard: [[{ text: t.open_btn, web_app: { url: APP_URL } }]] });

function isOwner(from) {
  return !!from && !!OWNER_TELEGRAM_ID && Number(from.id) === Number(OWNER_TELEGRAM_ID);
}

// Bare command word, lowercased and stripped of a group-style @BotUsername suffix.
function commandOf(msg) {
  if (!msg || typeof msg.text !== 'string') return '';
  const first = msg.text.trim().split(/\s+/)[0].toLowerCase();
  return first.split('@')[0];
}

async function sendHelp(msg) {
  const t = d(msg.from && msg.from.language_code);
  await callBot('sendMessage', {
    chat_id: msg.chat.id, text: t.help,
    parse_mode: 'HTML', disable_web_page_preview: true,
    reply_markup: openKeyboard(t),
  }).catch((e) => console.error('/help failed:', e.message));
}

async function sendLanguageInfo(msg) {
  const t = d(msg.from && msg.from.language_code);
  await callBot('sendMessage', {
    chat_id: msg.chat.id, text: t.lang, reply_markup: openKeyboard(t),
  }).catch((e) => console.error('/language failed:', e.message));
}

// Sends the user their personal referral link (?startapp=ref_<id>) with a native
// Telegram "share" button. The link carries the sender's own Telegram id, so the
// +15⭐ credit lands on them once an invited friend finishes onboarding.
async function sendInvite(msg) {
  const from = msg.from || {};
  const t = d(from.language_code);
  const link = buildReferralLink(from.id);
  const shareUrl = 'https://t.me/share/url?url=' + encodeURIComponent(link) +
    '&text=' + encodeURIComponent(t.inv_share_text);
  await callBot('sendMessage', {
    chat_id: msg.chat.id,
    text: t.inv_text.replace('{link}', link),
    parse_mode: 'HTML', disable_web_page_preview: true,
    reply_markup: { inline_keyboard: [[{ text: t.inv_share_btn, url: shareUrl }]] },
  }).catch((e) => console.error('/invite failed:', e.message));
}

// Deleting an account is irreversible, so /delete never acts immediately — it
// asks for an explicit confirmation tap. The actual deletion runs in the
// del:confirm callback (handleUserCallback), keyed off the authenticated from.id.
async function startDelete(msg) {
  const t = d(msg.from && msg.from.language_code);
  await callBot('sendMessage', {
    chat_id: msg.chat.id, text: t.del_confirm_q, parse_mode: 'HTML',
    reply_markup: { inline_keyboard: [[
      { text: t.del_yes_btn, callback_data: 'del:confirm' },
      { text: t.del_no_btn, callback_data: 'del:cancel' },
    ]] },
  }).catch((e) => console.error('/delete prompt failed:', e.message));
}

// Resolves the confirm/cancel tap from /delete. On confirm, deletes the account
// tied to the authenticated caller (cb.from.id) — a user can only ever delete
// their own account this way. Always answers the callback so the spinner clears.
async function handleDeleteCallback(cb) {
  const t = d(cb.from && cb.from.language_code);
  const chatId = cb.message && cb.message.chat && cb.message.chat.id;
  const msgId = cb.message && cb.message.message_id;
  const show = async (text) => {
    if (chatId && msgId) {
      // Editing the confirm message drops its buttons — no double-tap possible.
      await callBot('editMessageText', {
        chat_id: chatId, message_id: msgId, text, parse_mode: 'HTML',
      }).catch(() => {});
    } else if (chatId) {
      await callBot('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' }).catch(() => {});
    }
  };

  if (cb.data === 'del:cancel') {
    await show(t.del_cancelled);
  } else {
    try {
      const userId = await findUserId(cb.from.id);
      if (!userId) await show(t.del_gone);
      else { await deleteUserCascade(userId); await show(t.del_done); }
    } catch (e) {
      console.error('/delete confirm failed:', e.message);
      await show('⚠️ ' + e.message);
    }
  }
  await callBot('answerCallbackQuery', { callback_query_id: cb.id }).catch(() => {});
}

/**
 * Handles inline-button callbacks owned by this module (currently /delete's
 * confirm/cancel). Returns true if consumed. Called from analytics.js for any
 * callback_query that isn't the owner-only stats: dashboard.
 */
export async function handleUserCallback(cb) {
  if (!cb || typeof cb.data !== 'string') return false;
  if (cb.data === 'del:confirm' || cb.data === 'del:cancel') {
    await handleDeleteCallback(cb);
    return true;
  }
  return false;
}

// Prompt the user to type their feedback as a reply (force_reply makes the next
// message a reply we can recognise). Detection keys off the prompt text, so the
// flow needs no stored session state.
async function askForFeedback(msg) {
  const t = d(msg.from && msg.from.language_code);
  await callBot('sendMessage', {
    chat_id: msg.chat.id, text: t.fb_prompt,
    reply_markup: { force_reply: true, input_field_placeholder: t.fb_placeholder },
  }).catch((e) => console.error('/feedback prompt failed:', e.message));
}

// Forwards one feedback message to the owner and thanks the sender. The owner
// message embeds the sender's id (FEEDBACK_TAG line) so an owner reply can be
// routed back to the user without any persisted state.
async function forwardFeedback(msg, text) {
  const from = msg.from || {};
  const t = d(from.language_code);
  const clean = String(text || '').trim();
  if (!clean) {
    await callBot('sendMessage', { chat_id: msg.chat.id, text: t.fb_empty })
      .catch(() => {});
    return;
  }

  if (OWNER_TELEGRAM_ID) {
    const who = [esc(from.first_name || ''), esc(from.last_name || '')].join(' ').trim() || '—';
    const uname = from.username ? ` @${esc(from.username)}` : '';
    const ownerText =
      '📩 <b>Новий відгук Sixtio</b>\n' +
      `👤 ${who}${uname}\n` +
      `${FEEDBACK_TAG} <code>${from.id}</code>\n` +
      `🌐 ${botLang(from.language_code)}\n\n` +
      esc(clean) +
      '\n\n<i>↩️ Відповідай на це повідомлення, щоб написати користувачу.</i>';
    await callBot('sendMessage', {
      chat_id: OWNER_TELEGRAM_ID, text: ownerText,
      parse_mode: 'HTML', disable_web_page_preview: true,
    }).catch((e) => console.error('feedback forward to owner failed:', e.message));
  }

  await callBot('sendMessage', { chat_id: msg.chat.id, text: t.fb_thanks })
    .catch((e) => console.error('feedback thanks failed:', e.message));
}

// Owner replied to a forwarded feedback message → relay the reply to the user.
// Returns true if this update was a handled owner reply.
async function tryOwnerReply(msg) {
  if (!isOwner(msg.from)) return false;
  const src = msg.reply_to_message;
  if (!src || typeof src.text !== 'string') return false;
  if (src.text.indexOf('Новий відгук Sixtio') === -1) return false;
  const m = src.text.match(/🆔\s*(\d+)/);
  if (!m) return false;
  const reply = typeof msg.text === 'string' ? msg.text.trim() : '';
  if (!reply) return false;

  const targetId = Number(m[1]);
  // The reply body is whatever the owner types; only the framing label is ours.
  // The recipient's language isn't carried out of band here, so the label uses a
  // fixed set (Ukrainian) — the substance is the owner's own words.
  const label = T.uk.reply_from_team;
  await callBot('sendMessage', {
    chat_id: targetId,
    text: `${label}\n\n${reply}`,
    reply_markup: openKeyboard(T.uk),
  }).then(() => {
    return callBot('sendMessage', { chat_id: msg.chat.id, text: '✅ Відповідь надіслано.' });
  }).catch((e) => {
    console.error('owner reply relay failed:', e.message);
    return callBot('sendMessage', {
      chat_id: msg.chat.id, text: `⚠️ Не вдалося надіслати: ${e.message}`,
    }).catch(() => {});
  });
  return true;
}

/**
 * Handles the public user commands owned by this module.
 * Returns true if the update was consumed (caller should stop and answer 200),
 * false to let the caller's own routing (/start, /stats, …) run.
 */
export async function handleUserCommand(msg) {
  if (!msg || !msg.chat) return false;

  // 1) Owner replying to a forwarded feedback item — relay it back to the user.
  if (msg.reply_to_message && await tryOwnerReply(msg)) return true;

  // 2) A user's reply to the feedback prompt — forward it to the owner.
  const src = msg.reply_to_message;
  if (src && src.from && src.from.is_bot && typeof src.text === 'string' &&
      FEEDBACK_PROMPTS.has(src.text) && !commandOf(msg).startsWith('/')) {
    await forwardFeedback(msg, msg.text);
    return true;
  }

  // 3) Slash commands.
  const cmd = commandOf(msg);
  if (cmd === '/help' || cmd === '/about') { await sendHelp(msg); return true; }
  if (cmd === '/invite' || cmd === '/refer') { await sendInvite(msg); return true; }
  if (cmd === '/language' || cmd === '/lang') { await sendLanguageInfo(msg); return true; }
  if (cmd === '/delete') { await startDelete(msg); return true; }
  if (cmd === '/feedback' || cmd === '/support') {
    // Inline form "/feedback some text" forwards immediately; bare "/feedback" asks.
    const rest = msg.text.trim().replace(/^\S+\s*/, '');
    if (rest) await forwardFeedback(msg, rest);
    else await askForFeedback(msg);
    return true;
  }

  return false; // not ours — let the caller handle /start, /stats, etc.
}

// The set of localized feedback prompts, used to recognise a user's reply to the
// force_reply prompt without any stored session state.
const FEEDBACK_PROMPTS = new Set([T.uk.fb_prompt, T.en.fb_prompt, T.ru.fb_prompt]);
