// Who is actually here — ONE definition, shared by the deck, the matchmaker and
// Mystery Match.
//
// Measured 2026-11-23: of 47 women visible to men, 26 had never opened the app
// again after registering, and only 2 had been active in the last 14 days. Men
// were liking and writing to people who would never answer — and both reports
// this app has ever received were about exactly such an account, filed as
// "fake". She was not fake. She had simply left.
//
// The obvious fix — hide everyone inactive for two weeks — would have left each
// man a deck of TWO cards. So nobody is hidden by default. Instead:
//   • the deck shows people in order of how present they are (tiers below),
//     compatibility deciding WITHIN a tier;
//   • the AI matchmaker and Mystery Match skip "abandoned" accounts, because a
//     match or a paid reveal with someone who never came back is a guaranteed
//     silence the app itself arranged.
// Hiding by inactivity stays available (FEED_HIDE_INACTIVE_DAYS) for when there
// are enough active people for it not to empty the deck.

const DAY_MS = 24 * 60 * 60 * 1000;

export const ACTIVE_DAYS = 14;   // tier 0: here recently
export const RECENT_DAYS = 60;   // tier 1: here this season
// A brand-new account also has last_active ≈ created_at for its first session,
// so "never came back" is only a verdict once they have had time to come back.
export const ABANDON_GRACE_DAYS = 3;
// Session slack: one visit stamps last_active a few minutes after signup.
const SAME_SESSION_MS = 30 * 60 * 1000;

const ms = (v) => (v ? new Date(v).getTime() : 0);

/**
 * Registered, never opened the app again, and has had days to do so.
 * Anyone matched with this account will be writing into silence.
 */
export function isAbandoned(u, now = Date.now()) {
  if (!u) return false;
  const created = ms(u.created_at);
  const seen = ms(u.last_active);
  if (!created || !seen) return false;
  if (now - created < ABANDON_GRACE_DAYS * DAY_MS) return false;
  return seen - created <= SAME_SESSION_MS;
}

/**
 * 0 = active in the last ACTIVE_DAYS, 1 = in the last RECENT_DAYS,
 * 2 = longer ago, abandoned, or unknown. Lower sorts first.
 */
export function activityTier(u, now = Date.now()) {
  if (!u || isAbandoned(u, now)) return 2;
  const seen = ms(u.last_active);
  if (!seen) return 2;
  const age = now - seen;
  if (age <= ACTIVE_DAYS * DAY_MS) return 0;
  if (age <= RECENT_DAYS * DAY_MS) return 1;
  return 2;
}

/**
 * Optional hard cut-off for the deck, in days. 0 / unset = hide nobody (the
 * default, because at today's numbers hiding empties the deck).
 */
export function hideInactiveDays() {
  const n = Number(process.env.FEED_HIDE_INACTIVE_DAYS);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
