// Per-user daily AI spend ceiling (F-13 / SCALE-5).
//
// Since 2026-08-05 every AI call is billed. Nothing in the app limited how many
// a single person could trigger: re-running onboarding, re-uploading photos and
// re-requesting matches are all legitimate actions with no cap, so one user in a
// loop — bored, confused, or hostile — spends real money with no upper bound and
// nothing to notice it.
//
// _lib/ratelimit.js does NOT cover this. It is per-instance and fail-open by
// design (a cold start resets the window), which is right for burst protection
// and useless as a spend ceiling. A ceiling has to be durable and atomic, so it
// is one SQL statement (migration 041).
//
// THE DEGRADATION RULE, which is the whole design: hitting the cap is a product
// decision (this person has had their share today), while a BROKEN cap is an
// infrastructure failure. They must not behave the same. A missing RPC or a
// database hiccup ALLOWS the call — a cost guard that fails closed would turn a
// migration that has not been applied yet into a total outage of onboarding.
import { getSupabase } from './supabase.js';
import { alertThrottled, escapeAlert } from './alerts.js';

// Generous on purpose. A full onboarding is ~8 calls; a user who redoes it
// twice, uploads several photos and browses is still well inside 40. This is
// an anti-runaway ceiling, not a quota anyone should ever meet.
const DEFAULT_DAILY_CAP = 40;

export function dailyCap() {
  const n = Number(process.env.AI_DAILY_CAP_PER_USER);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DAILY_CAP;
}

/**
 * Books one AI call against `userId`'s daily allowance.
 *
 * @returns {Promise<{allowed: boolean, used: number|null, capped: boolean}>}
 *   `capped` is true ONLY when the ceiling was genuinely reached — never when
 *   the check itself failed, so callers can tell "you have had enough today"
 *   from "we could not tell" and say different things to the user.
 */
export async function bookAiCall(userId) {
  if (!userId) return { allowed: true, used: null, capped: false };
  const cap = dailyCap();
  try {
    const { data, error } = await getSupabase().rpc('bump_ai_usage', {
      p_user: userId, p_cap: cap,
    });
    if (error) throw new Error(error.message);

    if (data === null || data === undefined) {
      // The RPC ran and refused: this user has spent today's allowance.
      alertThrottled(
        'ai-daily-cap',
        '💸 <b>A user hit the daily AI ceiling</b>\n' +
        `Cap is ${cap} calls/day (AI_DAILY_CAP_PER_USER). Either someone is stuck ` +
        'in a loop, or the cap is now too low for normal use — check which.'
      );
      return { allowed: false, used: cap, capped: true };
    }
    return { allowed: true, used: Number(data), capped: false };
  } catch (e) {
    // Fail OPEN. Migration 041 not applied yet, or the database blinked: either
    // way, refusing here would take onboarding down to protect a few cents.
    console.error('ai budget check failed (allowing):', e.message);
    alertThrottled(
      'ai-budget-broken',
      '⚠️ <b>AI spend ceiling is not working</b>\n' +
      'Calls are being ALLOWED unchecked. If migration 041 is unapplied, apply it.' +
      `\n<pre>${escapeAlert(e.message)}</pre>`
    );
    return { allowed: true, used: null, capped: false };
  }
}
