import { getSupabase } from './supabase.js';
import { notifyReferralBonus, notifyOwner } from './bot.js';

// Bonus credited to the referrer once their invited friend proves to be a real
// user — see rewardReferrerOnEngagement for what "real" means here.
const REFERRAL_BONUS = 15;
// The qualification (migration 032). A farm can fake either of these alone; the
// point is that faking BOTH, per fake invite, costs more than earning the Stars.
const QUALIFY_MIN_DEPTH = 60;   // the invited user actually filled a profile in
const QUALIFY_MIN_DAYS = 3;     // …and was still opening the app on D3
// Stamped on every reward row so a later rule change leaves distinguishable
// cohorts in the stats instead of one undifferentiated pile.
const QUALIFY_RULE = 'depth60_d3';
// There is no cap any more, but velocity is still worth a look: many qualifying
// invites inside one hour is either a viral moment or a well-funded farm.
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
 * Credits the referrer +15 ⭐ once the invited user has PROVEN to be real: a
 * profile filled to at least 60% depth AND still opening the app on day 3.
 *
 * Deliberately not "on signup" and no longer "on first swipe" — both are one tap
 * and so are exactly what a farm produces cheaply. Depth costs effort and a D3
 * return costs time, and no amount of Stars makes buying both worthwhile.
 *
 * Because the qualification lives inside the RPC's WHERE clause, an unqualified
 * call matches no rows and is a cheap no-op. That is what makes it safe to
 * re-check on every app open — which is necessary, since the moment a user
 * BECOMES qualified is a day 3 app open, not any particular action.
 *
 * Fire-and-forget-safe: callers wrap it so a failure never breaks their request.
 */
export async function rewardReferrerOnEngagement(invitedUserId) {
  const supabase = getSupabase();

  const { data, error } = await supabase.rpc('reward_referrer_qualified', {
    p_invited: invitedUserId,
    p_bonus: REFERRAL_BONUS,
    p_min_depth: QUALIFY_MIN_DEPTH,
    p_min_days: QUALIFY_MIN_DAYS,
    p_rule: QUALIFY_RULE,
  });
  if (error) throw error;

  const row = Array.isArray(data) ? data[0] : data;
  if (!row || !row.status) return;   // no referrer, already paid, or not yet qualified
  const referrerTg = row.referrer_tg;

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
      `${row.hour_count} нагород за годину — можлива накрутка.\n` +
      `<i>Лімітів немає; кваліфікація: глибина ≥${QUALIFY_MIN_DEPTH}% + повернення D${QUALIFY_MIN_DAYS}.</i>`
    );
  }
}
