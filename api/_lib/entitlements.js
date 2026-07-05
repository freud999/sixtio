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

// --- Dark Mode (18+) intimate compatibility --------------------------------
//
// The one canonical, non-graphic vocabulary of kink markers. The AI interview
// (api/_lib/kink.js) may only emit these tokens, and both the analyzer and this
// scorer validate against the set, so a corrupt or stale marker can never skew
// the math or leak onto a card.
export const KINK_MARKERS = [
  'dominant', 'submissive', 'switch',
  'sensual', 'passionate', 'romantic', 'tender', 'playful',
  'experimental', 'adventurous', 'curious', 'vanilla',
  'roleplay', 'bondage', 'voyeur', 'exhibitionist',
];

// Complementary pairs: an X in one person "connects" with a listed token in the
// other even without an exact match (the classic dominant/submissive draw). A
// switch pairs with either pole and with another switch.
const KINK_COMPLEMENTS = {
  dominant: ['submissive', 'switch'],
  submissive: ['dominant', 'switch'],
  switch: ['dominant', 'submissive', 'switch'],
  voyeur: ['exhibitionist'],
  exhibitionist: ['voyeur'],
};

const KINK_SET = new Set(KINK_MARKERS);

/** Lower-case, de-dupe, and drop anything outside the canonical vocabulary. */
export function normalizeMarkers(markers) {
  const out = [];
  const seen = new Set();
  for (const raw of Array.isArray(markers) ? markers : []) {
    const m = String(raw || '').trim().toLowerCase();
    if (KINK_SET.has(m) && !seen.has(m)) { seen.add(m); out.push(m); }
  }
  return out;
}

/**
 * Intimate compatibility between two marker sets. A "connection" is either a
 * shared marker or a complementary one (dominant↔submissive, voyeur↔exhibitionist,
 * switch↔either). Score is the share of the smaller set that connects, so two
 * tightly aligned people reach ~100% without one long list drowning the signal.
 * Returns { score: 0..100, tags: [my markers that connected] } — pure, no I/O.
 */
export function intimateCompatibility(mine, theirs) {
  const a = normalizeMarkers(mine);
  const b = normalizeMarkers(theirs);
  if (!a.length || !b.length) return { score: 0, tags: [] };

  const bSet = new Set(b);
  const matched = [];
  for (const x of a) {
    if (bSet.has(x)) { matched.push(x); continue; }
    const comps = KINK_COMPLEMENTS[x] || [];
    if (comps.some((c) => bSet.has(c))) matched.push(x);
  }

  const denom = Math.min(a.length, b.length);
  const score = Math.round(100 * Math.min(1, matched.length / denom));
  return { score, tags: matched };
}
