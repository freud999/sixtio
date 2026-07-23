import { getSupabase } from './supabase.js';
import { callBot, botLang } from './bot.js';
import { handleUserCommand, handleUserCallback } from './commands.js';
import { captureStartSource, sourceStats } from './sources.js';

// --- /start welcome (Task 28) ---------------------------------------------
// The webhook used to ignore /start entirely, so users saw only BotFather's
// static (Ukrainian) description. Now the bot answers in the sender's CURRENT
// Telegram interface language, read live from update.message.from.language_code.
const APP_URL = process.env.APP_URL || 'https://sixtio.vercel.app';
const WELCOME = {
  uk: {
    text:
      '💜 Привіт! Я Sixtio — розумна сваха.\n\n' +
      'Я ставлю кілька щирих запитань, вивчаю, хто ти, і знаходжу людину, ' +
      'з якою у тебе справжня сумісність. Не свайпи — знайомства, які мають сенс.\n\n' +
      '🔒 Приватно: твого профілю Telegram ніхто не бачить.',
    btn: '✨ Почати знайомство',
  },
  en: {
    text:
      '💜 Hi! I\'m Sixtio — a smart matchmaker.\n\n' +
      'I ask a few sincere questions, learn who you are, and find someone ' +
      'you are truly compatible with. Not swipes — connections that make sense.\n\n' +
      '🔒 Private: no one sees your Telegram profile.',
    btn: '✨ Start meeting',
  },
  ru: {
    text:
      '💜 Привет! Я Sixtio — умная сваха.\n\n' +
      'Я задаю несколько искренних вопросов, изучаю, кто ты, и нахожу человека, ' +
      'с которым у тебя настоящая совместимость. Не свайпы — знакомства, которые имеют смысл.\n\n' +
      '🔒 Приватно: твой профиль Telegram никто не видит.',
    btn: '✨ Начать знакомство',
  },
};

async function sendStartWelcome(msg) {
  const w = WELCOME[botLang(msg.from && msg.from.language_code)] || WELCOME.uk;
  try {
    await callBot('sendMessage', {
      chat_id: msg.chat.id,
      text: w.text,
      reply_markup: { inline_keyboard: [[{ text: w.btn, web_app: { url: APP_URL } }]] },
    });
  } catch (e) {
    console.error('/start welcome failed:', e.message);
  }
}

// --- /stats_sources: per-source acquisition funnel (admin only) --------------
// Plain-text table (wrapped in <pre> for monospace alignment in Telegram) of
// clicks -> registrations -> key action per acquisition source.
async function sendSourceStats(chatId) {
  let rows;
  try {
    rows = await sourceStats();
  } catch (e) {
    console.error('sourceStats failed:', e.message);
    await callBot('sendMessage', { chat_id: chatId, text: '⚠️ stats_sources failed: ' + e.message })
      .catch(() => {});
    return;
  }
  if (!rows.length) {
    await callBot('sendMessage', { chat_id: chatId, text: '📊 No source data yet.' }).catch(() => {});
    return;
  }

  const cell = (v, w, right) => {
    const s = String(v);
    return right ? s.padStart(w) : s.slice(0, w).padEnd(w);
  };
  const header =
    cell('source', 14) + cell('clk', 5, true) + cell('reg', 5, true) +
    cell('7d', 4, true) + cell('30d', 5, true) + cell('key', 5, true) + cell('cvr', 6, true);
  const lines = rows.map((r) => {
    const cvr = r.completionRate == null ? '—' : Math.round(r.completionRate * 100) + '%';
    return cell(r.source == null ? '(none)' : r.source, 14) +
      cell(r.clicks, 5, true) + cell(r.registrations, 5, true) +
      cell(r.reg7d, 4, true) + cell(r.reg30d, 5, true) +
      cell(r.keyAction, 5, true) + cell(cvr, 6, true);
  });
  // Escape only the dynamic table body; the labels are static & safe.
  const body = [header, ...lines].join('\n').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const text = '📊 <b>Acquisition sources</b>\n' +
    '<i>clk=clicks · reg=registrations · key=match|paid · cvr=reg/clicks</i>\n' +
    '<pre>' + body + '</pre>';
  await callBot('sendMessage', { chat_id: chatId, text, parse_mode: 'HTML' }).catch((e) =>
    console.error('sendSourceStats send failed:', e.message));
}

// Owner-only executive analytics (Task 11). The Telegram webhook is pointed at
// /api/chat; chat.js forwards raw updates here when they carry `update_id`. Only
// OWNER_TELEGRAM_ID may use /stats; every other update is silently ignored (the
// bot exposes no other commands). Kept in _lib so it adds no Vercel function.
const OWNER_TELEGRAM_ID = Number(process.env.OWNER_TELEGRAM_ID || 0);
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

// Admins allowed to run /stats_sources: a comma-separated ADMIN_TELEGRAM_IDS env,
// unioned with the existing single OWNER_TELEGRAM_ID (so the owner always counts).
const ADMIN_TELEGRAM_IDS = new Set(
  String(process.env.ADMIN_TELEGRAM_IDS || '')
    .split(',').map((s) => Number(s.trim())).filter((n) => Number.isInteger(n) && n > 0)
);
if (OWNER_TELEGRAM_ID) ADMIN_TELEGRAM_IDS.add(OWNER_TELEGRAM_ID);
function isAdmin(from) { return !!from && ADMIN_TELEGRAM_IDS.has(Number(from.id)); }

const PERIODS = {
  '24h': { label: '🕐 Останні 24 години', ms: 24 * 60 * 60 * 1000 },
  '7d':  { label: '📅 Останні 7 днів',    ms: 7 * 24 * 60 * 60 * 1000 },
  '30d': { label: '🗓️ Останні 30 днів',   ms: 30 * 24 * 60 * 60 * 1000 },
};

const KEYBOARD = {
  inline_keyboard: [[
    { text: '🕐 24 год',  callback_data: 'stats:24h' },
    { text: '📅 7 днів',  callback_data: 'stats:7d' },
    { text: '🗓️ 30 днів', callback_data: 'stats:30d' },
    { text: '📊 MoM',     callback_data: 'stats:mom' },
  ]],
};

// Entry point from chat.js. ALWAYS answers 200 so Telegram never retries.
export async function handleTelegramUpdate(req, res, update) {
  try {
    // Security note: authorization relies EXCLUSIVELY on isOwner(from) — a
    // hardcoded numeric Telegram id — so the WEBHOOK_SECRET header gate was
    // removed to eliminate setWebhook-secret sync as a failure mode. No update
    // can trigger /stats without matching OWNER_TELEGRAM_ID.
    const cb = update.callback_query;
    const msg = update.message;

    // --- Telegram Stars payments (Task 19) -------------------------------
    // The bot webhook points here, so Stars checkout updates arrive on this path.
    // pre_checkout_query MUST be answered ok:true within 10s or Telegram voids the
    // payment; successful_payment then credits the wallet. Both are handled before
    // the owner /stats logic and are open to every user (not owner-gated).
    if (update.pre_checkout_query) {
      await callBot('answerPreCheckoutQuery', {
        pre_checkout_query_id: update.pre_checkout_query.id, ok: true,
      }).catch((e) => console.error('answerPreCheckoutQuery failed:', e.message));
      return res.status(200).json({ ok: true });
    }
    if (msg && msg.successful_payment) {
      await creditSuccessfulPayment(msg);
      return res.status(200).json({ ok: true });
    }

    if (cb && typeof cb.data === 'string' && cb.data.startsWith('stats:')) {
      if (!isOwner(cb.from)) {
        console.log('Stats callback but ID mismatch:', cb.from && cb.from.id, 'vs env:', OWNER_TELEGRAM_ID);
        await ack(cb.id);
        return res.status(200).json({ ok: true });
      }
      await renderInto(cb.message.chat.id, cb.message.message_id, cb.data.slice(6));
      await ack(cb.id, '📊 Оновлено');
      return res.status(200).json({ ok: true });
    }

    // Public inline-button callbacks (/delete confirm/cancel). Kept in _lib.
    if (cb && await handleUserCallback(cb)) {
      return res.status(200).json({ ok: true });
    }

    // Public user commands (/help, /feedback, /language) + owner feedback replies.
    // Owns everything except /start and /stats; returns true when it consumed the
    // update. Kept in _lib so it adds no Vercel function.
    if (msg && await handleUserCommand(msg)) {
      return res.status(200).json({ ok: true });
    }

    // Admin-only acquisition-source funnel (migration 029). Checked before the
    // generic /start branch so "/stats_sources" is never treated as a /start.
    if (msg && typeof msg.text === 'string' && msg.text.trim().split(/\s+/)[0].split('@')[0] === '/stats_sources') {
      if (isAdmin(msg.from)) {
        await sendSourceStats(msg.chat.id);
      } else {
        console.log('stats_sources but not admin:', msg.from && msg.from.id);
      }
      return res.status(200).json({ ok: true });   // non-admin: silently ignore
    }

    // Open to every user (not owner-gated). Handles bare /start and payloads
    // like "/start tgads1" (acquisition source, captured best-effort below).
    if (msg && typeof msg.text === 'string' && msg.text.trim().split(/\s+/)[0].split('@')[0] === '/start') {
      // Capture acquisition source BEFORE the welcome (best-effort, never blocks).
      await captureStartSource(msg.from && msg.from.id, msg.text)
        .catch((e) => console.error('captureStartSource:', e.message));
      await sendStartWelcome(msg);
      return res.status(200).json({ ok: true });
    }

    if (msg && typeof msg.text === 'string' && msg.text.trim().split(/\s+/)[0] === '/stats') {
      if (isOwner(msg.from)) {
        await renderNew(msg.chat.id, '24h');
      } else {
        // Non-owner: silently ignore. Never reveal to a stranger that /stats
        // exists — only a server-side log is emitted for observability.
        console.log('Stats command but ID mismatch:', msg.from && msg.from.id, 'vs env:', OWNER_TELEGRAM_ID);
      }
      return res.status(200).json({ ok: true });   // non-owner: silently ignore
    }

    return res.status(200).json({ ok: true });      // any other update: ignore
  } catch (e) {
    console.error('analytics update failed:', e.message);
    return res.status(200).json({ ok: true });       // never make Telegram retry
  }
}

// --- Stars deposit crediting (Task 19) -----------------------------------
// Credits a wallet from a Telegram Stars payment. The amount of Stars credited is
// taken from Telegram's own total_amount (never trusted from the client), and the
// buyer is identified by both the authenticated `from.id` and the userId embedded
// in the invoice payload. Crediting runs through credit_stars_deposit, which is
// idempotent on telegram_payment_charge_id — so a redelivered webhook is a silent
// no-op and can never double-credit real money. Never throws (always 200 upstream).
async function creditSuccessfulPayment(msg) {
  try {
    const sp = msg.successful_payment;
    const payload = String(sp.invoice_payload || '');
    const parts = payload.split(':');            // deposit:<userId>:<packId>
    if (parts[0] !== 'deposit') return;          // not ours — ignore

    const userId = parts[1] || null;
    const tgId = msg.from && msg.from.id;
    const stars = Number(sp.total_amount || 0);  // XTR total = whole Stars paid
    const charge = sp.telegram_payment_charge_id;
    if (!tgId || !stars || !charge) {
      console.error('successful_payment missing fields:', { tg: !!tgId, stars, charge: !!charge });
      return;
    }

    // Owner topping up their own bot (ad budget) is not customer revenue — tag it
    // so the dashboard excludes it. Derived from OWNER_TELEGRAM_ID, never trusted
    // from the client (from.id is authenticated by Telegram).
    const isSelf = !!OWNER_TELEGRAM_ID && Number(tgId) === OWNER_TELEGRAM_ID;

    const supabase = getSupabase();
    const { data: newBalance, error } = await supabase.rpc('credit_stars_deposit', {
      p_charge: charge, p_user: userId, p_tg: tgId, p_stars: stars, p_payload: payload,
      p_self: isSelf,
    });
    if (error) throw error;

    if (newBalance === null || newBalance === undefined) {
      // Duplicate webhook for an already-processed charge — expected, harmless.
      console.log('Stars deposit already processed (idempotent no-op):', charge);
    } else {
      console.info('[Sixtio] Stars deposit credited:', stars, '⭐ → balance', newBalance);
    }
  } catch (e) {
    console.error('successful_payment credit failed:', e.message);
  }
}

function isOwner(from) {
  // Coerce BOTH sides to primitive numbers — Vercel env vars arrive as strings,
  // Telegram ids as numbers; a strict === across those types silently fails.
  return !!from && !!OWNER_TELEGRAM_ID && Number(from.id) === Number(OWNER_TELEGRAM_ID);
}

function ack(id, text) {
  const payload = text ? { callback_query_id: id, text } : { callback_query_id: id };
  return callBot('answerCallbackQuery', payload).catch(() => {});
}

async function renderNew(chatId, period) {
  try {
    await callBot('sendMessage', {
      chat_id: chatId, text: await buildDashboard(period),
      parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: KEYBOARD,
    });
  } catch (e) {
    // Surface the exact Telegram fault (expired token, unescaped HTML, bad chat) —
    // callBot throws with Telegram's `description`, so never swallow it silently.
    console.error('renderNew sendMessage failed:', e.message);
    throw e;
  }
}

async function renderInto(chatId, messageId, period) {
  try {
    await callBot('editMessageText', {
      chat_id: chatId, message_id: messageId, text: await buildDashboard(period),
      parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: KEYBOARD,
    });
  } catch (e) {
    // Re-tapping the same period yields identical text — Telegram rejects that; ignore.
    if (!/not modified/i.test(e.message)) throw e;
  }
}

// --- Data ----------------------------------------------------------------
async function buildDashboard(periodKey) {
  const supabase = getSupabase();
  const now = new Date();

  if (periodKey === 'mom') {
    const thisStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const lastStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1));
    const [cur, prev] = await Promise.all([
      rpc(supabase, thisStart, now),
      rpc(supabase, lastStart, thisStart),
    ]);
    return renderMoM(cur, prev, now);
  }

  const p = PERIODS[periodKey] || PERIODS['24h'];
  const d = await rpc(supabase, new Date(now.getTime() - p.ms), now);
  return renderPeriod(d, p.label);
}

async function rpc(supabase, since, until) {
  const { data, error } = await supabase.rpc('stats_dashboard', {
    p_since: since.toISOString(), p_until: until.toISOString(),
  });
  if (error) throw error;
  return data || {};
}

// --- Formatting ----------------------------------------------------------
const num = (x) => Number(x || 0);
const pct = (part, whole) => (num(whole) > 0 ? Math.round((num(part) / num(whole)) * 1000) / 10 : 0);
const stars = (x) => `${num(x).toLocaleString('uk-UA')} ⭐`;
const esc = (s) => String(s == null ? '' : s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const fmtTime = (dt) => `${dt.toISOString().slice(11, 16)} UTC`;

function renderPeriod(d, label) {
  const total = num(d.total_users);
  const male = num(d.male), female = num(d.female);
  const tx = d.tx_all || {}, txP = d.tx_period_by_feature || {};
  const prem = num(d.premium_active);
  const revAll = num(d.revenue_all);
  const arpu = total > 0 ? Math.round((revAll / total) * 10) / 10 : 0;
  const refs = num(d.referral_signups);
  const kFactor = total > 0 ? Math.round((refs / total) * 100) / 100 : 0;
  const cities = (d.top_cities || [])
    .map((c, i) => `   ${i + 1}. ${esc(c.city)} — <b>${num(c.n)}</b>`).join('\n') || '   —';

  return [
    '📊 <b>SIXTIO — ВИКОНАВЧА ПАНЕЛЬ</b>',
    `<i>${label}</i>`,
    '',
    '👥 <b>АУДИТОРІЯ</b>',
    `• Усього: <b>${total}</b>  (+${num(d.new_users_period)} за період)`,
    `• Стать: 👨 ${pct(male, male + female)}%  /  👩 ${pct(female, male + female)}%`,
    `• Вік: 18–21 <b>${num(d.age_18_21)}</b> · 22–25 <b>${num(d.age_22_25)}</b> · 26–30 <b>${num(d.age_26_30)}</b> · 31+ <b>${num(d.age_31_plus)}</b>`,
    '• Топ-міста:',
    cities,
    '',
    '💎 <b>БІЗНЕС &amp; ARPU</b>',
    `• Дохід усього: <b>${stars(revAll)}</b>`,
    `• Дохід за період: <b>${stars(d.revenue_period)}</b>`,
    ...(num(d.self_funding) > 0
      ? [`• 🔁 Само-поповнення (реклама, не дохід): <b>${stars(d.self_funding)}</b>`]
      : []),
    `• Premium активних: <b>${prem}</b>  ·  Конверсія: <b>${pct(prem, total)}%</b>`,
    `• ARPU: <b>${arpu} ⭐</b>`,
    '• Мікротранзакції (період):',
    `   🔮 Mystery <b>${num(txP.mystery_match)}</b> · 🧠 Why Factor <b>${num(txP.why_factor)}</b> · 🎁 Lootbox <b>${num(txP.lootbox)}</b>`,
    '',
    '🚀 <b>ВІРАЛЬНІСТЬ &amp; AI</b>',
    `• Реферальних реєстрацій: <b>${refs}</b>  ·  K-фактор: <b>${kFactor}</b>`,
    `• AI: 🧠 Why Factor <b>${num(tx.why_factor)}</b> · 🎤 Інтерв'ю <b>${num(d.ai_interviews)}</b> · 💞 Скоринг <b>${num(d.ai_matches)}</b>`,
    '',
    `📈 <i>Оновлено ${fmtTime(new Date())}</i>`,
  ].join('\n');
}

function renderMoM(cur, prev, now) {
  const total = num(cur.total_users), prem = num(cur.premium_active);
  return [
    '📊 <b>SIXTIO — MoM ДЕЛЬТА</b>',
    '<i>📊 Цей місяць проти минулого</i>',
    '',
    '💎 <b>ДОХІД</b>',
    `• Цей місяць: <b>${stars(cur.revenue_period)}</b>`,
    `• Минулий місяць: <b>${stars(prev.revenue_period)}</b>`,
    `• Дельта: <b>${delta(num(cur.revenue_period), num(prev.revenue_period))}</b>`,
    '',
    '🚀 <b>НОВІ РЕЄСТРАЦІЇ</b>',
    `• Цей місяць: <b>${num(cur.new_users_period)}</b>`,
    `• Минулий місяць: <b>${num(prev.new_users_period)}</b>`,
    `• Дельта: <b>${delta(num(cur.new_users_period), num(prev.new_users_period))}</b>`,
    '',
    '👥 <b>ПОТОЧНИЙ СТАН</b>',
    `• Усього: <b>${total}</b> · Premium: <b>${prem}</b> (${pct(prem, total)}%)`,
    `• Дохід усього: <b>${stars(cur.revenue_all)}</b>`,
    '',
    `📈 <i>Оновлено ${fmtTime(now)}</i>`,
  ].join('\n');
}

function delta(cur, prev) {
  const diff = cur - prev;
  const arrow = diff > 0 ? '▲ +' : diff < 0 ? '▼ −' : '– ';
  const pctTxt = prev > 0 ? ` (${diff >= 0 ? '+' : ''}${Math.round((diff / prev) * 100)}%)` : '';
  return `${arrow}${Math.abs(diff)}${pctTxt}`;
}
