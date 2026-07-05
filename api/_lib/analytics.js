import { getSupabase } from './supabase.js';
import { callBot } from './bot.js';

// Owner-only executive analytics (Task 11). The Telegram webhook is pointed at
// /api/chat; chat.js forwards raw updates here when they carry `update_id`. Only
// OWNER_TELEGRAM_ID may use /stats; every other update is silently ignored (the
// bot exposes no other commands). Kept in _lib so it adds no Vercel function.
const OWNER_TELEGRAM_ID = Number(process.env.OWNER_TELEGRAM_ID || 0);
const WEBHOOK_SECRET = process.env.TELEGRAM_WEBHOOK_SECRET || '';

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
    // Reject forged updates when a webhook secret is configured (defence in depth
    // on top of the owner-id check).
    if (WEBHOOK_SECRET && req.headers['x-telegram-bot-api-secret-token'] !== WEBHOOK_SECRET) {
      return res.status(200).json({ ok: true });
    }

    const cb = update.callback_query;
    const msg = update.message;

    if (cb && typeof cb.data === 'string' && cb.data.startsWith('stats:')) {
      if (!isOwner(cb.from)) { await ack(cb.id); return res.status(200).json({ ok: true }); }
      await renderInto(cb.message.chat.id, cb.message.message_id, cb.data.slice(6));
      await ack(cb.id, '📊 Оновлено');
      return res.status(200).json({ ok: true });
    }

    if (msg && typeof msg.text === 'string' && msg.text.trim().split(/\s+/)[0] === '/stats') {
      if (isOwner(msg.from)) await renderNew(msg.chat.id, '24h');
      return res.status(200).json({ ok: true });   // non-owner: silently ignore
    }

    return res.status(200).json({ ok: true });      // any other update: ignore
  } catch (e) {
    console.error('analytics update failed:', e.message);
    return res.status(200).json({ ok: true });       // never make Telegram retry
  }
}

function isOwner(from) {
  return !!from && !!OWNER_TELEGRAM_ID && Number(from.id) === OWNER_TELEGRAM_ID;
}

function ack(id, text) {
  const payload = text ? { callback_query_id: id, text } : { callback_query_id: id };
  return callBot('answerCallbackQuery', payload).catch(() => {});
}

async function renderNew(chatId, period) {
  await callBot('sendMessage', {
    chat_id: chatId, text: await buildDashboard(period),
    parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: KEYBOARD,
  });
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
