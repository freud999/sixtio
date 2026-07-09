import { resolveUser } from './_lib/telegram.js';
import { getSupabase, getMatchesFor, getHiddenUserIds } from './_lib/supabase.js';
import { entitlements, likesLeftForClient, intimateCompatibility } from './_lib/entitlements.js';

// Recommendation feed for the swipe deck (feed.html). Pure Supabase — no AI.
// Candidates are opposite-gender, within ±10 years, never already swiped, and
// ranked by Big Five compatibility (highest first), with unscored profiles
// trailing at 0% so the deck keeps flowing for infinite scroll.
const MAX_AGE_GAP = 10;          // same convention as matching.js
const DEFAULT_LIMIT = 20;

// "Daily Mystery Match": the single strongest Big Five match, refreshed at most
// once per rolling 24h and shown fully anonymized until unlocked (10 ⭐).
const MYSTERY_MIN_SCORE = 90;    // only a >90% match is worth teasing
const MYSTERY_REFRESH_MS = 24 * 60 * 60 * 1000;

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

    const supabase = getSupabase();
    const { data: me, error: meError } = await supabase
      .from('users')
      .select('id, gender, seeking_gender, age, liked_users, disliked_users, blocked_users, premium, premium_until, daily_likes_count, last_like_reset, dark_mode_active, kink_markers, last_mystery_match_id, last_mystery_match_time, mystery_match_unlocked')
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

    // Big Five ranking + tags, in one RPC. Isolated: if the migration/RPC isn't
    // live yet, the feed still works — every candidate just scores 0.
    const compatByUser = {};
    try {
      const { data: compat, error: compatError } = await supabase.rpc(
        'calculate_compatibility',
        { current_user_id: me.id }
      );
      if (compatError) throw compatError;
      for (const c of compat || []) {
        compatByUser[c.user_id] = {
          score: c.compatibility_score,
          tags: c.compatibility_tags || [],
        };
      }
    } catch (compatError) {
      console.error('compatibility rpc failed:', compatError.message);
    }

    const { data: candidates, error: candError } = await supabase
      .from('users')
      .select('id, name, gender, seeking_gender, age, city, photo_url, dark_mode_active, kink_markers, shadow_hidden')
      .neq('id', me.id);
    if (candError) throw candError;

    // Dark Mode (18+) is a mutual, opt-in layer: intimate data is computed ONLY
    // when this user has it on, and then only against candidates who also do.
    const darkOn = !!me.dark_mode_active;

    const ranked = [];
    for (const c of candidates || []) {
      if (seen.has(c.id)) continue;                              // already swiped / blocked
      if (c.shadow_hidden) continue;                             // mass-reported, auto-hidden
      if (!c.gender || !c.seeking_gender || !c.age) continue;    // incomplete profile
      // Opposite gender by mutual preference ('any' is a wildcard on either side).
      if (me.seeking_gender !== 'any' && c.gender !== me.seeking_gender) continue;
      if (c.seeking_gender !== 'any' && me.gender !== c.seeking_gender) continue;
      // Preferred age range — ±10 years, no geographical radius.
      if (me.age && Math.abs(me.age - c.age) > MAX_AGE_GAP) continue;

      const hit = compatByUser[c.id];
      const card = {
        userId: c.id,
        name: (c.name || '').split(' ')[0] || 'Хтось особливий',
        age: c.age,
        city: c.city || '',
        photoUrl: c.photo_url || '',
        // 0..100; unscored profiles get 0 so they sort after scored ones.
        compatibility: hit ? hit.score : 0,
        tags: hit ? (hit.tags || []).slice(0, 3) : [],
      };

      // Only surface the intimate layer when BOTH sides opted in — otherwise the
      // card stays byte-for-byte standard, keeping opted-out users fully private.
      if (darkOn && c.dark_mode_active) {
        const intim = intimateCompatibility(me.kink_markers, c.kink_markers);
        card.darkMode = true;
        card.intimateCompatibility = intim.score;
        // Privacy-first: free males get the % only — the actual matching tags are
        // WITHHELD from the payload entirely (not just CSS-blurred), so they can
        // never be recovered from the wire. Premium males & all females (never
        // blurred) receive the full tag list. `intimateTagsBlurred` still tells
        // the client to render the locked/upsell state.
        card.intimateTagsBlurred = ent.blur;
        card.intimateTags = ent.blur ? [] : intim.tags;
      }

      ranked.push(card);
    }

    // Highly compatible first (99 → 0), then the rest for endless scrolling.
    // A 0% GENERAL score never removes anyone from the deck — and when the
    // mutual Dark Mode layer is on, ranking uses the BEST of general vs
    // intimate compatibility, so a 0%-personality / high-kink-overlap profile
    // surfaces near the top instead of drowning at the tail (Task 24).
    const rankScore = (c) =>
      Math.max(c.compatibility || 0, c.darkMode ? (c.intimateCompatibility || 0) : 0);
    ranked.sort((a, b) => rankScore(b) - rankScore(a));

    const start = Math.max(0, parseInt(offset, 10) || 0);
    const size = Math.min(50, Math.max(1, parseInt(limit, 10) || DEFAULT_LIMIT));
    const page = ranked.slice(start, start + size);

    // Mystery Match is a once-per-load concern: only compute (and possibly
    // refresh) it on the first page so paginated scroll stays a pure read.
    let mysteryMatch = null;
    if (start === 0) {
      try {
        mysteryMatch = await resolveMysteryMatch(supabase, me, ranked, compatByUser);
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
      // Anonymized-until-unlocked daily tease (null when there's no >90% match).
      mysteryMatch,
    });
  } catch (e) {
    console.error('api/feed failed:', e);
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
async function resolveMysteryMatch(supabase, me, ranked, compatByUser) {
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

  // Unlocked: reveal identity. Prefer the already-built ranked card; fall back
  // to a direct fetch if this person has since dropped out of the eligible deck.
  let card = ranked.find((c) => c.userId === targetId);
  if (!card) {
    const { data: u } = await supabase
      .from('users')
      .select('id, name, age, city, photo_url')
      .eq('id', targetId)
      .maybeSingle();
    if (!u) return null;
    card = {
      userId: u.id,
      name: (u.name || '').split(' ')[0] || 'Хтось особливий',
      age: u.age, city: u.city || '', photoUrl: u.photo_url || '',
      tags: hit ? (hit.tags || []).slice(0, 3) : [],
    };
  }
  return {
    userId: card.userId, compatibility, isMysteryMatch: true, unlocked: true,
    name: card.name, age: card.age, city: card.city, photoUrl: card.photoUrl,
    tags: card.tags || [],
  };
}
