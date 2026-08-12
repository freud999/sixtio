import { captureError } from './_lib/sentry.js';
import { resolveUser, pickLang } from './_lib/telegram.js';
import { getSupabase, getMatchesFor, getHiddenUserIds } from './_lib/supabase.js';
import { entitlements, likesLeftForClient, intimateCompatibility } from './_lib/entitlements.js';
import { darkActive, DARK_COLUMNS } from './_lib/darkmode.js';
import { rateLimit, LIMITS, sendRateLimited } from './_lib/ratelimit.js';
import { signPhoto, signPhotos, photoKey, blurKey } from './_lib/photos.js';
import { compatibilityPage } from './_lib/compat.js';
import { flagEnabled } from './_lib/flags.js';
import { mutualGenderMatch, wantedGender } from './_lib/gendermatch.js';

// Recommendation feed for the swipe deck (feed.html). Pure Supabase — no AI.
// Candidates are opposite-gender, within ±10 years, never already swiped, and
// ranked by Big Five compatibility (highest first), with unscored profiles
// trailing at 0% so the deck keeps flowing for infinite scroll.
// Age window for the DECK. The matchmaker (_lib/matching.js) keeps its own,
// tighter ±10 — an AI-proposed pair should still be a sensible pair.
//
// Launch phase: effectively off. With a handful of users a ±10 window is not a
// preference, it is an empty screen, and an empty deck is the one thing a
// dating app cannot survive on day one. FEED_MAX_AGE_GAP tightens it back to a
// real number the moment there are enough people to be choosy — no deploy.
//
// Age has NOT stopped mattering: it is now a ranking nudge instead of a wall,
// so closer ages still come first, they simply no longer erase everyone else.
const DEFAULT_MAX_AGE_GAP = 200;
function maxAgeGap() {
  const n = Number(process.env.FEED_MAX_AGE_GAP);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_MAX_AGE_GAP;
}
// How much a year of age difference costs in deck order. Small on purpose: it
// must never outweigh real compatibility, only break ties between strangers.
const AGE_RANK_PENALTY_PER_YEAR = 0.4;
const AGE_RANK_PENALTY_MAX = 20;
const DEFAULT_LIMIT = 20;
// Hard ceiling on how many candidates one deck open pulls into the function
// (F-09/F-10). Before this the query had no `.limit()` at all: 10k profiles
// meant 10k rows with photos, interests and intimate columns crossing the wire
// to build a 20-card page. 300 is ~15 pages of scrolling ahead of the user —
// deep enough that nobody reaches the edge, small enough to stay a fast read.
const POOL_MAX = 300;

// Shared-interest ranking nudge (Layer 2): a small, capped bonus so common
// hobbies lift a candidate in the deck without ever outweighing psychological or
// intimate compatibility. Interests are matched case/space-insensitively, which
// covers both canonical tokens and any legacy free-text a user typed.
const INTEREST_BOOST_PER = 4;
const INTEREST_BOOST_MAX = 12;
const normInterests = (arr) => new Set(
  (Array.isArray(arr) ? arr : []).map((s) => String(s || '').trim().toLowerCase()).filter(Boolean)
);
// Presence: a profile counts as "online" if it pinged within this window. Every
// /api/feed and /api/me call stamps last_active, so this stays accurate & cheap.
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const isOnline = (ts) => { if (!ts) return false; const d = Date.now() - new Date(ts).getTime(); return d >= 0 && d < ONLINE_WINDOW_MS; };

// "Daily Mystery Match": the single strongest Big Five match, refreshed at most
// once per rolling 24h and shown fully anonymized until unlocked (10 ⭐).
// Floor for the daily tease. Lowered 90 -> 80 alongside compatibility v2
// (migration 027) + sharper trait extraction: top pairs now peak ~97 and strong
// matches land ~80-90, so a 90 gate would rarely fire. 80 keeps the tease strong
// yet reliable. It's the single highest match above this floor — relative in
// spirit, absolute in guard.
const MYSTERY_MIN_SCORE = 80;
const MYSTERY_REFRESH_MS = 24 * 60 * 60 * 1000;

// Columns holding the stored Big Five (0..100) on the `profiles` row.
const TRAIT_COLS = 'user_id, trait_openness, trait_conscientiousness, trait_extraversion, trait_agreeableness, trait_neuroticism';
const clamp100 = (n) => Math.max(0, Math.min(100, Math.round(Number(n) || 0)));
// Read-only surfacing of the ALREADY-computed personality scores for the deep-
// compatibility sheet (feed.html). This does NOT feed the matching algorithm —
// `calculate_compatibility` remains the sole ranker. Returns canonical keys the
// client localizes; "stability" is the inverse of neuroticism. null when the
// profile has no analysed traits yet (unscored → sheet hides the trait bars).
function big5FromTraits(p) {
  if (!p || p.trait_openness == null) return null;
  return {
    openness: clamp100(p.trait_openness),
    conscientiousness: clamp100(p.trait_conscientiousness),
    extraversion: clamp100(p.trait_extraversion),
    agreeableness: clamp100(p.trait_agreeableness),
    stability: 100 - clamp100(p.trait_neuroticism),
  };
}

/**
 * Appends `extra` to `pool` up to `max`, skipping anyone already there.
 *
 * De-duplication happens HERE rather than in the query, because excluding 300
 * uuids with `.not('id','in',(…))` is an ~11 KB request URI — PostgREST and the
 * proxy in front of it reject that long before the query itself is a problem.
 * Overfetching and dropping the overlap keeps it to one bounded read.
 *
 * Exported for testing: the failure it prevents (a scored candidate silently
 * displaced by an unscored one) only appears past POOL_MAX profiles, which is
 * far more than production has — so it cannot be caught by looking at the app.
 */
export function mergePool(pool, extra, max) {
  const have = new Set(pool.map((c) => c.id));
  for (const u of extra || []) {
    if (pool.length >= max) break;
    if (!u || have.has(u.id)) continue;
    have.add(u.id);
    pool.push(u);
  }
  return pool;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { initData, offset, limit } = req.body || {};
    const tgUser = resolveUser(initData);
    if (!tgUser) {
      return res.status(401).json({ error: 'Invalid Telegram initData' });
    }

    const rl = rateLimit(`feed:${tgUser.id}`, LIMITS.read);
    if (!rl.allowed) return sendRateLimited(res, rl.retryAfterSec);

    // Kill switch (F-19). An empty deck is a shape the client already renders
    // ("no more people right now"), so taking the feed offline looks like a quiet
    // day rather than a broken screen — and matches, chat and profile keep working.
    if (!flagEnabled('FEED_ENABLED')) {
      return res.status(200).json({ registered: true, candidates: [], hasMore: false });
    }

    const lang = pickLang(req.body && req.body.lang, tgUser);
    const NAME_FALLBACK = { uk: 'Хтось особливий', en: 'Someone special', ru: 'Кто-то особенный' };
    const nameFallback = NAME_FALLBACK[lang] || NAME_FALLBACK.uk;

    const supabase = getSupabase();
    const { data: me, error: meError } = await supabase
      .from('users')
      .select('id, gender, seeking_gender, age, liked_users, disliked_users, blocked_users, premium, premium_until, daily_likes_count, last_like_reset, ' + DARK_COLUMNS + ', kink_markers, interests, last_mystery_match_id, last_mystery_match_time, mystery_match_unlocked')
      .eq('telegram_id', tgUser.id)
      .maybeSingle();
    if (meError) throw meError;
    if (!me) return res.status(200).json({ registered: false, candidates: [], hasMore: false });

    // Retention: stamp activity when the swipe deck loads (best-effort).
    try {
      await supabase.from('users')
        .update({ last_active: new Date().toISOString() })
        .eq('id', me.id);
    } catch (e) { console.error('last_active stamp failed:', e.message); }

    // Gender-biased entitlement: females & premium males see clean photos with
    // no limit; free males see blurred photos and a 30/24h like allowance.
    const ent = entitlements(me);

    // Everyone this user has already acted on (plus themselves) is off the deck.
    const seen = new Set([me.id, ...(me.liked_users || []), ...(me.disliked_users || [])]);

    // Already-matched partners never resurface in the deck (Task 24). Swipe
    // arrays don't cover AI-created matches (runMatching pairs people without a
    // like from this side), so exclude by the matches table directly.
    try {
      for (const m of await getMatchesFor(me.id)) seen.add(m.partnerId);
    } catch (e) { console.error('feed match-dedup failed:', e.message); }

    // Block list (two-way): everyone this user blocked AND everyone who blocked
    // them is removed from the deck. shadow_hidden (mass-reported) users are
    // filtered per-candidate below.
    try {
      for (const id of await getHiddenUserIds(me.id, me.blocked_users)) seen.add(id);
    } catch (e) { console.error('feed block-dedup failed:', e.message); }

    // Big Five ranking + tags. The RPC now applies the SAME gender/age prefilter
    // as the candidate query below and returns at most POOL_MAX rows, instead of
    // scoring every profile in the database on every deck open (F-09). Isolated:
    // on any failure the deck still renders, every candidate just scoring 0.
    // 'any' resolves to the opposite gender rather than dropping the filter, so
    // the SQL prefilter and the JS rule below can never disagree — a wildcard
    // here is what let same-gender profiles into a straight user's deck.
    const wantGender = wantedGender(me);
    const gap = maxAgeGap();
    const minAge = me.age ? me.age - gap : null;
    const maxAge = me.age ? me.age + gap : null;
    const compatMap = await compatibilityPage(supabase, me.id, {
      gender: wantGender, minAge, maxAge, limit: POOL_MAX,
    });
    const compatByUser = Object.fromEntries(compatMap);

    // The candidate pool, bounded at POOL_MAX (F-10) and built in TWO passes.
    //
    // The obvious one-query version is wrong, and it was wrong here for a day:
    // capping the candidate query by `last_active` while capping the compatibility
    // query by SCORE produces two DIFFERENT sets of 300. Past 300 profiles, an
    // active person whose score ranked 301st would be in the deck with no score
    // at all — shown as 0% compatible, which is not "unscored", it is WRONG, and
    // on a product whose entire promise is the percentage.
    //
    // So the scored candidates come first, by id, straight from the ranking that
    // was just computed. Only the leftover room is filled with recently-active
    // people who have no Big Five yet, so the deck still flows for a new market
    // where almost nobody is scored.
    const COLS = 'id, name, gender, seeking_gender, age, city, photo_url, photo_blur_url, '
      + DARK_COLUMNS + ', kink_markers, interests, last_active, shadow_hidden';
    const scoredIds = [...compatMap.keys()];

    const candidates = [];
    if (scoredIds.length) {
      const { data, error } = await supabase.from('users').select(COLS)
        .in('id', scoredIds).eq('shadow_hidden', false);
      if (error) throw error;
      candidates.push(...(data || []));
    }

    // Room left over → recently active profiles that the ranker did not return
    // (no Big Five yet). Ordered by last_active because if a ceiling has to cut
    // someone, cutting dormant accounts is a product rule and an arbitrary
    // truncation is not.
    if (candidates.length < POOL_MAX) {
      let fill = supabase.from('users').select(COLS)
        .neq('id', me.id)
        .eq('shadow_hidden', false);
      if (wantGender) fill = fill.eq('gender', wantGender);
      if (me.age) fill = fill.gte('age', minAge).lte('age', maxAge);
      const { data, error } = await fill
        .order('last_active', { ascending: false, nullsFirst: false })
        .limit(POOL_MAX);
      if (error) throw error;
      mergePool(candidates, data, POOL_MAX);
    }

    // Dark Mode (18+) is a mutual, opt-in layer: intimate data is computed ONLY
    // when this user has it on, and then only against candidates who also do.
    // darkActive() additionally requires a current, recorded consent on BOTH
    // sides and the operator kill switch to be up (api/_lib/darkmode.js).
    const darkOn = darkActive(me);
    const myInterests = normInterests(me.interests);

    const ranked = [];
    for (const c of candidates || []) {
      if (seen.has(c.id)) continue;                              // already swiped / blocked
      if (c.shadow_hidden) continue;                             // mass-reported, auto-hidden
      if (!c.gender || !c.age) continue;                         // incomplete profile
      // The one gender rule, shared with the matchmaker and the likers list
      // (_lib/gendermatch.js). It was two inline conditions here, duplicated in
      // matching.js and simply missing from the likers list.
      if (!mutualGenderMatch(me, c)) continue;
      // Preferred age range — ±10 years, no geographical radius.
      if (me.age && Math.abs(me.age - c.age) > gap) continue;

      const hit = compatByUser[c.id];
      const card = {
        userId: c.id,
        name: (c.name || '').split(' ')[0] || nameFallback,
        age: c.age,
        city: c.city || '',
        // Privacy + paywall: free males receive ONLY the pre-blurred thumbnail
        // (the full-res object is never signed for them). Entitled viewers (all
        // women + premium males) get the real photo. Legacy profiles with no blur
        // thumbnail send nothing to free males rather than leak the original. The
        // key is resolved to a short-lived signed URL for the PAGE only, below.
        photoUrl: '',
        _photoKey: ent.blur
          ? (c.photo_blur_url ? blurKey(c.id) : '')
          : (c.photo_url ? photoKey(c.id) : ''),
        // 0..100, or NULL when this profile has no Big Five yet. Null, not 0:
        // "we have not measured you two" and "you are 0% compatible" are
        // different statements, and showing the second for the first insults a
        // person who has simply not been analysed yet. The client renders null
        // as "—" with an empty ring. Ranking still treats it as 0, so scored
        // profiles lead the deck and unscored ones follow instead of vanishing.
        compatibility: hit ? hit.score : null,
        // Compatibility tags drive the "Why you match" reason line on the card.
        tags: hit ? (hit.tags || []).slice(0, 3) : [],
        // The candidate's own interests → value chips under the reason.
        interests: (c.interests || []).slice(0, 3),
        // Live presence for the green online dot on the card.
        online: isOnline(c.last_active),
      };

      // Shared-interest nudge (Layer 2): count normalized overlaps for ranking.
      let sharedInterests = 0;
      if (myInterests.size) {
        for (const it of normInterests(c.interests)) if (myInterests.has(it)) sharedInterests++;
      }
      card.sharedInterests = sharedInterests;

      // Only surface the intimate layer when BOTH sides opted in — otherwise the
      // card stays byte-for-byte standard, keeping opted-out users fully private.
      if (darkOn && darkActive(c)) {
        const intim = intimateCompatibility(me.kink_markers, c.kink_markers);
        card.darkMode = true;
        card.intimateCompatibility = intim.score;
        // Stage 1 of two-stage disclosure: BEFORE a match, both sides see only
        // the markers they actually SHARE — never the other person's full list.
        // Symmetric and free by design: the paywall (ent.blur) deliberately does
        // not reach this layer, so nobody can buy their way into someone else's
        // intimate data. Full lists unlock only on a mutual match, in api/me.js.
        card.intimateTags = intim.tags;
        card.intimateTagsBlurred = false;
      }

      ranked.push(card);
    }

    // Highly compatible first (99 → 0), then the rest for endless scrolling.
    // A 0% GENERAL score never removes anyone from the deck — and when the
    // mutual Dark Mode layer is on, ranking uses the BEST of general vs
    // intimate compatibility, so a 0%-personality / high-kink-overlap profile
    // surfaces near the top instead of drowning at the tail (Task 24).
    // Age is a nudge here, not a wall (see maxAgeGap). It used to remove people
    // outright; now a bigger gap only costs order, and never enough to bury
    // someone genuinely compatible under a stranger who happens to be 25.
    const agePenalty = (c) => (me.age && c.age)
      ? Math.min(AGE_RANK_PENALTY_MAX, Math.abs(me.age - c.age) * AGE_RANK_PENALTY_PER_YEAR)
      : 0;
    const rankScore = (c) =>
      Math.max(c.compatibility || 0, c.darkMode ? (c.intimateCompatibility || 0) : 0)
      + Math.min(INTEREST_BOOST_MAX, (c.sharedInterests || 0) * INTEREST_BOOST_PER)
      - agePenalty(c);
    ranked.sort((a, b) => rankScore(b) - rankScore(a));

    const start = Math.max(0, parseInt(offset, 10) || 0);
    const size = Math.min(50, Math.max(1, parseInt(limit, 10) || DEFAULT_LIMIT));
    const page = ranked.slice(start, start + size);

    // Mint signed photo URLs for the PAGE only (never the whole ranked deck), in
    // one batched round trip. A key that fails to sign degrades to '' — no leak.
    try {
      const sigMap = await signPhotos(page.map((c) => c._photoKey), supabase);
      for (const c of page) c.photoUrl = c._photoKey ? (sigMap.get(c._photoKey) || '') : '';
    } catch (e) { console.error('feed photo signing failed:', e.message); }
    for (const c of page) delete c._photoKey;

    // Big Five for the deep-compatibility sheet: batch-load the paged candidates'
    // stored traits (+ this viewer's) in ONE query and attach them read-only.
    // Never blocks the feed — on any error cards simply carry no `big5`.
    let viewerBig5 = null;
    try {
      const ids = page.map((c) => c.userId);
      const { data: profRows } = await supabase
        .from('profiles')
        .select(TRAIT_COLS)
        .in('user_id', ids.concat(me.id));
      const byId = new Map((profRows || []).map((p) => [p.user_id, p]));
      viewerBig5 = big5FromTraits(byId.get(me.id));
      for (const card of page) card.big5 = big5FromTraits(byId.get(card.userId));
    } catch (traitErr) {
      console.error('big5 surface failed:', traitErr.message);
    }

    // Mystery Match is a once-per-load concern: only compute (and possibly
    // refresh) it on the first page so paginated scroll stays a pure read.
    let mysteryMatch = null;
    if (start === 0) {
      try {
        mysteryMatch = await resolveMysteryMatch(supabase, me, ranked, compatByUser, nameFallback);
      } catch (mmError) {
        console.error('mystery match failed:', mmError.message);
      }
    }

    return res.status(200).json({
      registered: true,
      // Drives the frosted-glass gate on the client (false = clean photos).
      premium: ent.premiumActive,
      // null = unlimited (female / premium male); 0 = free male out of likes.
      likesLeft: likesLeftForClient(ent),
      // Frontend intercepts this to pop the paywall over the deck.
      rateLimited: ent.rateLimited,
      candidates: page,
      hasMore: start + size < ranked.length,
      // This viewer's own Big Five (canonical keys), for the sheet's paired bars.
      viewerBig5,
      // Anonymized-until-unlocked daily tease (null when no match clears the floor).
      mysteryMatch,
    });
  } catch (e) {
    console.error('api/feed failed:', e);
    captureError(e, { route: 'api/feed' });
    return res.status(500).json({ error: 'Internal error' });
  }
}

// --- Daily Mystery Match ----------------------------------------------------
// Picks (and, at most once per 24h, refreshes + persists) this user's single
// strongest Big Five match above MYSTERY_MIN_SCORE. Returns a fully anonymized
// card (name '?', no photo/bio/tags — only the compatibility % and the
// isMysteryMatch flag) until the user pays to unlock it, after which the real
// identity is revealed. `ranked` is the already-filtered, score-sorted deck;
// `compatByUser` maps userId -> { score, tags }.
async function resolveMysteryMatch(supabase, me, ranked, compatByUser, nameFallback = 'Хтось особливий') {
  const now = Date.now();
  const lastMs = me.last_mystery_match_time ? new Date(me.last_mystery_match_time).getTime() : 0;
  const needRefresh = !lastMs || (now - lastMs) > MYSTERY_REFRESH_MS;

  let targetId;
  let unlocked;
  if (needRefresh) {
    // Mystery Match stays a GENERAL-compatibility tease: scan for the highest
    // Big Five score (the deck order now also weighs intimate compatibility).
    let best = null;
    for (const c of ranked) {
      if (c.compatibility > MYSTERY_MIN_SCORE && (!best || c.compatibility > best.compatibility)) best = c;
    }
    targetId = best ? best.userId : null;
    unlocked = false;
    const { error } = await supabase
      .from('users')
      .update({
        last_mystery_match_id: targetId,
        last_mystery_match_time: new Date(now).toISOString(),
        mystery_match_unlocked: false,
      })
      .eq('id', me.id);
    if (error) console.error('mystery match persist failed:', error.message);
  } else {
    targetId = me.last_mystery_match_id || null;
    unlocked = !!me.mystery_match_unlocked;
  }
  if (!targetId) return null;

  const hit = compatByUser[targetId];
  const compatibility = hit ? hit.score : null;

  // Locked: expose ONLY the compatibility % and the flag; everything else blank.
  if (!unlocked) {
    return {
      userId: targetId, compatibility, isMysteryMatch: true, unlocked: false,
      name: '?', age: null, city: '', photoUrl: '', tags: [], bio: '',
    };
  }

  // Unlocked: reveal identity with the REAL photo — the ranked card only carries
  // the blurred thumbnail for free males, but an unlocked Mystery Match was paid
  // for, so fetch photo_url directly.
  const { data: u } = await supabase
    .from('users')
    .select('id, name, age, city, photo_url')
    .eq('id', targetId)
    .maybeSingle();
  if (!u) return null;
  return {
    userId: u.id, compatibility, isMysteryMatch: true, unlocked: true,
    name: (u.name || '').split(' ')[0] || nameFallback,
    age: u.age, city: u.city || '',
    // Paid unlock → full photo, as a fresh signed URL.
    photoUrl: u.photo_url ? await signPhoto(photoKey(u.id), supabase) : '',
    tags: hit ? (hit.tags || []).slice(0, 3) : [],
  };
}
