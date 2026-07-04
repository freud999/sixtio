import { resolveUser } from './_lib/telegram.js';
import { getSupabase } from './_lib/supabase.js';
import { entitlements, FREE_DAILY_LIMIT } from './_lib/entitlements.js';

// Records one swipe from the feed deck. Right = like, left = dislike; the target
// is appended to the swiper's own liked_users / disliked_users so it never
// resurfaces. Strictly local DB persistence — no AI, no matchmaking.
//
// Metering (paywall): only RIGHT swipes (likes) by NON-premium MALE users are
// counted, against a rolling 30/24h allowance. Dislikes are always free, and
// females / premium males are never limited. Hitting the cap returns a paywall
// signal and does NOT record the swipe (the person can be liked after top-up).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { initData, targetId, action } = req.body || {};
    if (!targetId || (action !== 'like' && action !== 'dislike')) {
      return res.status(400).json({ error: 'targetId and action (like|dislike) are required' });
    }

    const tgUser = resolveUser(initData);
    if (!tgUser) {
      return res.status(401).json({ error: 'Invalid Telegram initData' });
    }

    const supabase = getSupabase();
    const { data: me, error: meError } = await supabase
      .from('users')
      .select('id, gender, premium, premium_until, daily_likes_count, last_like_reset')
      .eq('telegram_id', tgUser.id)
      .maybeSingle();
    if (meError) throw meError;
    if (!me) return res.status(200).json({ ok: false });

    const ent = entitlements(me);

    // Only likes are metered, and only for the non-premium tier. Dislikes and
    // entitled users (females + premium males) skip the counter entirely.
    if (action === 'like' && !ent.premiumActive) {
      const { data: allowed, error: consumeError } = await supabase.rpc('try_consume_like', {
        swiper: me.id, daily_limit: FREE_DAILY_LIMIT,
      });
      if (consumeError) throw consumeError;
      if (!allowed) {
        return res.status(200).json({ ok: false, limitReached: true, paywall: true });
      }
    }

    const { error } = await supabase.rpc('record_swipe', {
      swiper: me.id,
      target: String(targetId),
      liked: action === 'like',
    });
    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('api/swipe failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
