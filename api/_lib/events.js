// Product-funnel event tracking (migration 033).
//
// Every call here is BEST-EFFORT by construction: analytics must never be able
// to fail a user's request. track() swallows its own errors and returns nothing,
// so call sites can `await` it without a try/catch and without a `.catch()`.
//
// Once-per-user events are deduplicated by a partial unique index in Postgres,
// not here — see the migration. That is why these functions can be called from
// hot paths (every app open, every swipe) without a read-before-write.

import { getSupabase } from './supabase.js';

export const EVENTS = {
  START: 'start',                             // /start in the bot
  ONBOARDING_COMPLETE: 'onboarding_complete', // profile generated & saved
  FIRST_LIKE: 'first_like',
  FIRST_MATCH: 'first_match',
  RETURN_D1: 'return_d1',
  RETURN_D3: 'return_d3',
  RETURN_D7: 'return_d7',
  PAYWALL_OPEN: 'paywall_open',               // the Stars shop was opened
  PURCHASE: 'purchase',                       // something was actually bought
};

const KNOWN = new Set(Object.values(EVENTS));

/**
 * Records one event. Unknown event names are dropped rather than stored: an
 * open-ended event table degenerates into noise within a month, and a typo that
 * silently creates a new event type is worse than a missing row.
 */
export async function track(userId, event, props) {
  if (!userId || !KNOWN.has(event)) return;
  try {
    await getSupabase()
      .from('analytics_events')
      .insert({ user_id: userId, event, props: props || {} });
  } catch (e) {
    // A duplicate on a once-per-user event is the normal, expected outcome on
    // every repeat call — not worth a log line. Anything else is.
    if (!/duplicate key/i.test(e.message || '')) {
      console.error('track failed:', event, e.message);
    }
  }
}

/**
 * /start in the bot — the true top of the funnel, and the one event that
 * happens BEFORE a users row exists. First-time starts therefore carry a null
 * user_id and identify themselves by Telegram id in props instead; stats_funnel
 * counts distinct users over both, so an anonymous start is still one person and
 * not one anonymous blob. Deliberately repeatable: re-starts are real signal.
 */
export async function trackStart(telegramId) {
  if (!telegramId) return;
  try {
    const supabase = getSupabase();
    const { data } = await supabase
      .from('users').select('id').eq('telegram_id', telegramId).maybeSingle();
    await supabase.from('analytics_events').insert({
      user_id: (data && data.id) || null,
      event: EVENTS.START,
      props: { tg: String(telegramId) },
    });
  } catch (e) {
    console.error('trackStart failed:', e.message);
  }
}

/**
 * Retention on app open. The day math and the deduplication both live in the
 * track_return RPC (migration 033): one round trip on a hot path instead of
 * three, and ON CONFLICT against a partial unique index has to repeat the index
 * predicate, which PostgREST's upsert cannot express.
 *
 * Best-effort like everything else here — retention stats must never be able to
 * fail an app open.
 */
export async function trackReturn(userId) {
  if (!userId) return;
  try {
    const { error } = await getSupabase().rpc('track_return', { p_user: userId });
    if (error) throw error;
  } catch (e) {
    console.error('trackReturn failed:', e.message);
  }
}
