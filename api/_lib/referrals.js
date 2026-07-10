import { getSupabase } from './supabase.js';
import { notifyReferralBonus, notifyOwner } from './bot.js';

// Bonus credited to the referrer once their invited friend actually engages
// (their first swipe) — not merely on signup. See rewardReferrerOnEngagement.
const REFERRAL_BONUS = 15;
// Anti-abuse caps: any one referrer earns at most this many rewards per rolling
// 24h and this many in total, bounding a multi-account farm (migration 025).
const REWARD_DAILY_CAP = 10;
const REWARD_TOTAL_CAP = 100;
// More than this many rewards to one referrer within an hour pings the owner.
const VELOCITY_ALERT_PER_HOUR = 5;
const REF_PREFIX = 'ref_';
// @Sixtiobot — overridable so a rename doesn't require a code change.
const BOT_USERNAME = process.env.BOT_USERNAME || 'Sixtiobot';

/** Builds the shareable referral link that carries the referrer's Telegram id. */
export function buildReferralLink(telegramId) {
  return `https://t.me/${BOT_USERNAME}?startapp=${REF_PREFIX}${telegramId}`;
}

/** Extracts the referrer's Telegram id from a start_param like "ref_123", or null. */
export function parseReferrerId(startParam) {
  if (!startParam || !startParam.startsWith(REF_PREFIX)) return null;
  const id = Number(startParam.slice(REF_PREFIX.length));
  return Number.isInteger(id) && id > 0 ? id : null;
}

/**
 * Records who referred this user — but only once, and only for a real, different
 * referrer. Safe to call on every onboarding step; it no-ops after the first set.
 */
export async function captureReferral(userId, startParam) {
  const referrerTg = parseReferrerId(startParam);
  if (!referrerTg) return;

  const supabase = getSupabase();
  const { data: me } = await supabase
    .from('users')
    .select('telegram_id, referred_by')
    .eq('id', userId)
    .maybeSingle();
  if (!me || me.referred_by != null) return;        // already attributed
  if (Number(me.telegram_id) === referrerTg) return; // can't refer yourself

  // Referrer must be a real registered user.
  const { data: referrer } = await supabase
    .from('users')
    .select('id')
    .eq('telegram_id', referrerTg)
    .maybeSingle();
  if (!referrer) return;

  // Conditional on still-null so a concurrent write can't be clobbered.
  await supabase
    .from('users')
    .update({ referred_by: referrerTg })
    .eq('id', userId)
    .is('referred_by', null);
}

/**
 * Credits the referrer +15 stars once the invited user actually ENGAGES (their
 * first real swipe), applying per-referrer anti-abuse caps. Safe to call on every
 * swipe: the reward_referrer_capped RPC (migration 025) does an atomic once-only
 * flip of referral_rewarded, so 99% of calls no-op cheaply and the bonus is
 * granted at most once per invited user even under concurrent swipes.
 * Fire-and-forget-safe: callers wrap it so a failure never breaks a swipe.
 */
export async function rewardReferrerOnEngagement(invitedUserId) {
  const supabase = getSupabase();

  const { data, error } = await supabase.rpc('reward_referrer_capped', {
    p_invited: invitedUserId,
    p_bonus: REFERRAL_BONUS,
    p_daily_cap: REWARD_DAILY_CAP,
    p_total_cap: REWARD_TOTAL_CAP,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.status) return;          // no referrer, or already processed
  const referrerTg = row.referrer_tg;

  // Cap hit: nothing credited. A referrer legitimately maxing out is rare, so a
  // cap trip is a useful farm signal — tell the owner (best-effort, HTML-safe id).
  if (row.status === 'capped') {
    console.warn(`referral reward capped for referrer ${referrerTg} (day=${row.day_count})`);
    await notifyOwner(
      '⚠️ <b>Реферали Sixtio</b>\n' +
      `Реферер: <code>${referrerTg}</code>\n` +
      `Досягнуто ліміт (${row.day_count}/добу або ${REWARD_TOTAL_CAP} всього) — нову нагороду НЕ нараховано.`
    );
    return;
  }

  // Credited. Ping the referrer in THEIR stored language (Task 28) — best-effort.
  let referrerLang = null;
  try {
    const { data: ref } = await supabase
      .from('users').select('language_code').eq('telegram_id', referrerTg).maybeSingle();
    referrerLang = ref && ref.language_code;
  } catch (e) { /* fall back to uk inside the bot */ }
  await notifyReferralBonus(referrerTg, referrerLang);

  // Velocity signal: many rewards to one referrer within an hour looks like a farm.
  if (row.hour_count > VELOCITY_ALERT_PER_HOUR) {
    await notifyOwner(
      '⚠️ <b>Реферали Sixtio</b>\n' +
      `Реферер: <code>${referrerTg}</code>\n` +
      `${row.hour_count} нагород за годину — можлива накрутка.`
    );
  }
}
