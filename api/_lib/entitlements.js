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
export const MYSTERY_UNLOCK_PRICE = 10;   // ⭐ to reveal the daily Mystery Match
export const LOOTBOX_PRICE = 5;           // ⭐ per lootbox after the free daily one
export const WHY_FACTOR_PRICE = 10;       // ⭐ per "The Why Factor" AI reveal (non-premium)
export const LIKE_REVEAL_PRICE = 5;       // ⭐ to reveal ONE person who liked you
export const LIKES_PASS_PRICE = 40;       // ⭐ to reveal everyone for LIKES_PASS_DAYS
export const LIKES_PASS_DAYS = 7;
export const AI_REPORT_PRICE = 50;        // ⭐ for the written personal report (bought once, kept forever)
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

/**
 * May this user see WHO liked them, without paying per person? True while the
 * 7-day pass is live, and always for Premium — subscribers (and therefore every
 * female account) are not asked to pay a second time for the same thing.
 * The COUNT of likes is free for everyone and is not gated by this.
 */
export function likesPassActive(user, ent) {
  const e = ent || entitlements(user);
  if (e.premiumActive) return true;
  const until = user && user.likes_pass_until ? new Date(user.likes_pass_until).getTime() : 0;
  return until > Date.now();
}

// --- Dark Mode (18+) intimate compatibility --------------------------------
//
// The one canonical, non-graphic vocabulary of kink markers. The AI interview
// (api/_lib/kink.js) may only emit these tokens, and both the analyzer and this
// scorer validate against the set, so a corrupt or stale marker can never skew
// the math or leak onto a card.
export const KINK_MARKERS = [
  // Dynamic — who leads.
  'dominant', 'submissive', 'switch',
  // Tone / emotional texture.
  'sensual', 'passionate', 'romantic', 'tender', 'playful', 'slow', 'intense',
  // Appetite for novelty.
  'curious', 'experimental', 'adventurous', 'vanilla',
  // Affection & sensuality.
  'kissing', 'cuddling', 'massage', 'sensation_play', 'teasing', 'dirty_talk', 'sexting', 'fantasies',
  // Specific interests — emitted only when clearly, positively expressed.
  'roleplay', 'toys', 'bondage', 'blindfold', 'edging', 'spanking', 'biting',
  'wax_play', 'footplay', 'strap_on', 'oral', 'mirrors', 'voyeur', 'exhibitionist',
];

// Complementary pairs (FULL credit, 1.0): an X in one person "connects" with a
// listed token in the other even without an exact match (the classic
// dominant/submissive draw). A switch pairs with either pole and with a switch.
const KINK_COMPLEMENTS = {
  dominant: ['submissive', 'switch'],
  submissive: ['dominant', 'switch'],
  switch: ['dominant', 'submissive', 'switch'],
  voyeur: ['exhibitionist'],
  exhibitionist: ['voyeur'],
};

// Affinity clusters (PARTIAL credit, 0.5): tokens in the same cluster harmonize
// even without an exact match — so "romantic" and "tender" draw together instead
// of scoring zero. Exact matches and hard complements above still win at 1.0.
// vanilla is deliberately clusterless (it connects only with another vanilla).
const KINK_AFFINITY = [
  ['sensual', 'romantic', 'tender', 'slow', 'massage', 'kissing', 'cuddling'],
  ['passionate', 'intense', 'adventurous', 'experimental', 'oral'],
  ['playful', 'teasing', 'curious', 'dirty_talk', 'sexting', 'fantasies', 'roleplay'],
  ['sensation_play', 'wax_play', 'blindfold', 'edging', 'bondage', 'footplay', 'toys', 'strap_on', 'spanking', 'biting'],
  ['voyeur', 'exhibitionist', 'mirrors'],
  ['dominant', 'submissive', 'switch'],
];

// token -> Set of its clustermates, for O(1) affinity lookups during scoring.
const KINK_AFFINITY_BY_TOKEN = new Map();
for (const cluster of KINK_AFFINITY) {
  for (const t of cluster) {
    const mates = KINK_AFFINITY_BY_TOKEN.get(t) || new Set();
    for (const u of cluster) if (u !== t) mates.add(u);
    KINK_AFFINITY_BY_TOKEN.set(t, mates);
  }
}

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
 * Intimate compatibility between two marker sets. Each of my markers connects to
 * the other person at a weight: 1.0 for an exact shared marker or a hard
 * complement (dominant↔submissive, voyeur↔exhibitionist, switch↔either), and 0.5
 * for an affinity-cluster sibling (romantic↔tender, playful↔teasing, …) so
 * kindred tones no longer score zero. Score is the summed weight over the smaller
 * set, so two tightly aligned people reach ~100% without one long list drowning
 * the signal. Returns { score: 0..100, tags: [my markers that connected] } — pure.
 */
export function intimateCompatibility(mine, theirs) {
  const a = normalizeMarkers(mine);
  const b = normalizeMarkers(theirs);
  if (!a.length || !b.length) return { score: 0, tags: [] };

  const bSet = new Set(b);
  let sum = 0;
  const matched = [];
  for (const x of a) {
    let w = 0;
    if (bSet.has(x)) w = 1;                                          // exact
    else if ((KINK_COMPLEMENTS[x] || []).some((c) => bSet.has(c))) w = 1; // complement
    else {
      const mates = KINK_AFFINITY_BY_TOKEN.get(x);                  // same-cluster kinship
      if (mates && b.some((y) => mates.has(y))) w = 0.5;
    }
    if (w > 0) { sum += w; matched.push(x); }
  }

  const denom = Math.min(a.length, b.length);
  const score = Math.round(100 * Math.min(1, sum / denom));
  return { score, tags: matched };
}
