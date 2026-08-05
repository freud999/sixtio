// Big Five compatibility reads (F-09 / SCALE-1).
//
// One place decides HOW MANY rows a compatibility read pulls. Before this file
// all three callers ran the same unbounded RPC — score every scored profile in
// the database, return them all, discard 99% in JavaScript — and then each did
// its own filtering. Bounding the query at each call site separately would have
// meant three chances to get it wrong, so the shape lives here instead.
//
// THE FALLBACK RULE. Every function degrades to the pre-042 unbounded RPC when
// the new one is missing or errors. Migration 042 is additive and applied, but a
// rollback, a stale PostgREST schema cache or a branch database must not blank
// out compatibility across the app — a slower correct answer beats a fast empty
// one. The fallback is logged, never silent: if it starts firing constantly,
// that is the migration missing and it should be visible in the logs.
import { getSupabase } from './supabase.js';

/** Rows -> Map(userId -> { score, tags }). One shape for every caller. */
function toMap(rows) {
  const map = new Map();
  for (const r of rows || []) {
    map.set(r.user_id, {
      score: r.compatibility_score,
      tags: r.compatibility_tags || [],
    });
  }
  return map;
}

/** The pre-042 path: score everyone, keep what was asked for. */
async function legacyFor(supabase, userId, ids) {
  const { data, error } = await supabase.rpc('calculate_compatibility', {
    current_user_id: userId,
  });
  if (error) throw new Error(error.message);
  const wanted = new Set(ids);
  return (data || []).filter((r) => wanted.has(r.user_id));
}

/**
 * Scores `userId` against a KNOWN list of people (match cards, Mystery reveal).
 * @returns {Promise<Map<string, {score:number, tags:string[]}>>} empty on failure.
 */
export async function compatibilityFor(supabase, userId, ids) {
  const db = supabase || getSupabase();
  const list = [...new Set((ids || []).filter(Boolean))];
  if (!userId || !list.length) return new Map();
  try {
    const { data, error } = await db.rpc('calculate_compatibility_for', {
      current_user_id: userId, p_user_ids: list,
    });
    if (error) throw new Error(error.message);
    return toMap(data);
  } catch (e) {
    console.error('compat: targeted rpc failed, falling back to full scan:', e.message);
    try {
      return toMap(await legacyFor(db, userId, list));
    } catch (e2) {
      console.error('compat: legacy rpc failed too:', e2.message);
      return new Map();
    }
  }
}

/**
 * One page of ranked candidates, prefiltered in SQL by gender and age window.
 * `gender`/`minAge`/`maxAge` may be null — null means "do not filter", which is
 * how the 'any' seeking preference and ageless profiles stay in the deck.
 * @returns {Promise<Map<string, {score:number, tags:string[]}>>} empty on failure.
 */
export async function compatibilityPage(supabase, userId, opts = {}) {
  const db = supabase || getSupabase();
  if (!userId) return new Map();
  const { gender = null, minAge = null, maxAge = null, limit = 200, offset = 0 } = opts;
  try {
    const { data, error } = await db.rpc('calculate_compatibility_page', {
      current_user_id: userId,
      p_gender: gender || null,
      p_min_age: Number.isFinite(minAge) ? minAge : null,
      p_max_age: Number.isFinite(maxAge) ? maxAge : null,
      p_limit: limit,
      p_offset: offset,
    });
    if (error) throw new Error(error.message);
    return toMap(data);
  } catch (e) {
    console.error('compat: paged rpc failed, falling back to full scan:', e.message);
    try {
      const { data, error } = await db.rpc('calculate_compatibility', {
        current_user_id: userId,
      });
      if (error) throw new Error(error.message);
      return toMap(data);
    } catch (e2) {
      console.error('compat: legacy rpc failed too:', e2.message);
      return new Map();
    }
  }
}

/**
 * Latest message per match, in one round trip (F-11 / SCALE-2).
 * @returns {Promise<Map<string, {text:string, senderId:string, createdAt:string}>>}
 */
export async function latestMessages(supabase, matchIds) {
  const db = supabase || getSupabase();
  const list = [...new Set((matchIds || []).filter(Boolean))];
  const out = new Map();
  if (!list.length) return out;
  try {
    const { data, error } = await db.rpc('latest_messages_for_matches', {
      p_match_ids: list,
    });
    if (error) throw new Error(error.message);
    for (const r of data || []) {
      out.set(r.match_id, { text: r.text, senderId: r.sender_id, createdAt: r.created_at });
    }
    return out;
  } catch (e) {
    // Pre-042 path: one query per match. Slow, but the chat list still shows
    // previews — the whole point of keeping a fallback at all.
    console.error('compat: latest-messages rpc failed, falling back per match:', e.message);
    for (const id of list) {
      try {
        const { data } = await db
          .from('messages')
          .select('text, sender_id, created_at')
          .eq('match_id', id)
          .order('created_at', { ascending: false })
          .limit(1);
        const lm = data && data[0];
        if (lm) out.set(id, { text: lm.text, senderId: lm.sender_id, createdAt: lm.created_at });
      } catch (inner) {
        console.error('compat: per-match preview failed:', inner.message);
      }
    }
    return out;
  }
}
