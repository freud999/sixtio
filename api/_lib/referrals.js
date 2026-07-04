import { getSupabase } from './supabase.js';
import { notifyReferralBonus } from './bot.js';

// Bonus credited to the referrer once their invited friend finishes onboarding.
const REFERRAL_BONUS = 15;
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
 * Credits the referrer +15 stars once the invited user completes onboarding.
 * Idempotent: an atomic flip of referral_rewarded (false -> true) guarantees the
 * bonus is granted exactly once, even if api/profile runs again (e.g. "deepen").
 * Fire-and-forget-safe: callers wrap it so a failure never breaks onboarding.
 */
export async function rewardReferrerOnOnboarding(userId) {
  const supabase = getSupabase();

  // Win the race: only the update that flips the flag proceeds to credit.
  const { data: won, error } = await supabase
    .from('users')
    .update({ referral_rewarded: true })
    .eq('id', userId)
    .eq('referral_rewarded', false)
    .not('referred_by', 'is', null)
    .select('referred_by')
    .maybeSingle();
  if (error) throw error;
  if (!won || won.referred_by == null) return; // no referrer, or already rewarded

  const referrerTg = won.referred_by;
  const { error: creditError } = await supabase.rpc('increment_stars_by_tg', {
    tg: referrerTg,
    amount: REFERRAL_BONUS,
  });
  if (creditError) throw creditError;

  await notifyReferralBonus(referrerTg);
}
