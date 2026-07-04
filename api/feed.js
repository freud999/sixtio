import { resolveUser } from './_lib/telegram.js';
import { getSupabase } from './_lib/supabase.js';

// Recommendation feed for the swipe deck (feed.html). Pure Supabase — no AI.
// Candidates are opposite-gender, within ±10 years, never already swiped, and
// ranked by Big Five compatibility (highest first), with unscored profiles
// trailing at 0% so the deck keeps flowing for infinite scroll.
const MAX_AGE_GAP = 10;          // same convention as matching.js
const DEFAULT_LIMIT = 20;

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
      .select('id, gender, seeking_gender, age, liked_users, disliked_users, premium')
      .eq('telegram_id', tgUser.id)
      .maybeSingle();
    if (meError) throw meError;
    if (!me) return res.status(200).json({ registered: false, candidates: [], hasMore: false });

    // Everyone this user has already acted on (plus themselves) is off the deck.
    const seen = new Set([me.id, ...(me.liked_users || []), ...(me.disliked_users || [])]);

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
      .select('id, name, gender, seeking_gender, age, city, photo_url')
      .neq('id', me.id);
    if (candError) throw candError;

    const ranked = [];
    for (const c of candidates || []) {
      if (seen.has(c.id)) continue;                              // already swiped
      if (!c.gender || !c.seeking_gender || !c.age) continue;    // incomplete profile
      // Opposite gender by mutual preference ('any' is a wildcard on either side).
      if (me.seeking_gender !== 'any' && c.gender !== me.seeking_gender) continue;
      if (c.seeking_gender !== 'any' && me.gender !== c.seeking_gender) continue;
      // Preferred age range — ±10 years, no geographical radius.
      if (me.age && Math.abs(me.age - c.age) > MAX_AGE_GAP) continue;

      const hit = compatByUser[c.id];
      ranked.push({
        userId: c.id,
        name: (c.name || '').split(' ')[0] || 'Хтось особливий',
        age: c.age,
        city: c.city || '',
        photoUrl: c.photo_url || '',
        // 0..100; unscored profiles get 0 so they sort after scored ones.
        compatibility: hit ? hit.score : 0,
        tags: hit ? (hit.tags || []).slice(0, 3) : [],
      });
    }

    // Highly compatible first (99 → 0), then the rest for endless scrolling.
    ranked.sort((a, b) => b.compatibility - a.compatibility);

    const start = Math.max(0, parseInt(offset, 10) || 0);
    const size = Math.min(50, Math.max(1, parseInt(limit, 10) || DEFAULT_LIMIT));
    const page = ranked.slice(start, start + size);

    return res.status(200).json({
      registered: true,
      premium: !!me.premium,
      candidates: page,
      hasMore: start + size < ranked.length,
    });
  } catch (e) {
    console.error('api/feed failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
