// Central entitlement logic for the gender-biased paywall.
//
//   * Females  -> full Premium for free: never blurred, infinite likes, no
//                 counter, no paywall, deepen freely.
//   * Males    -> premiumActive only while premium_until is in the future.
//                 Free males get FREE_DAILY_LIMIT right-swipes per rolling 24h;
//                 dislikes are unlimited and never metered.
//
// Pass a users row that includes: gender, premium_until, daily_likes_count,
// last_like_reset. Returns a plain object the endpoints reshape for the client.

export const FREE_DAILY_LIMIT = 30;   // free male right-swipes per rolling 24h
export const PREMIUM_PRICE   = 150;   // ⭐ for 30-day Premium
export const PREMIUM_DAYS    = 30;
export const SWIPE_PACK_PRICE = 10;   // ⭐ for +30 likes today
export const DAY_MS = 24 * 60 * 60 * 1000;

export function entitlements(user) {
  const now = Date.now();
  const isFemale = user && user.gender === 'female';
  const premiumUntilMs = user && user.premium_until ? new Date(user.premium_until).getTime() : 0;

  // Females are always entitled; males only while their subscription is live.
  const premiumActive = isFemale || premiumUntilMs > now;

  // Remaining free likes only matters for the metered (non-premium male) tier.
  let likesLeft = Infinity;
  if (!premiumActive) {
    const lastReset = user && user.last_like_reset ? new Date(user.last_like_reset).getTime() : 0;
    // Mirror the RPC: a stale window is treated as already reset to 0 used.
    const used = lastReset < now - DAY_MS ? 0 : (user.daily_likes_count || 0);
    likesLeft = Math.max(0, FREE_DAILY_LIMIT - used);
  }

  return {
    isFemale,
    premiumActive,
    premiumUntil: premiumUntilMs ? new Date(premiumUntilMs).toISOString() : null,
    blur: !premiumActive,                       // free males only
    likesLeft,                                   // Infinity when unlimited
    rateLimited: !premiumActive && likesLeft <= 0,
  };
}

// JSON-safe likes counter: null means unlimited (never leak Infinity).
export function likesLeftForClient(ent) {
  return ent.premiumActive ? null : ent.likesLeft;
}
