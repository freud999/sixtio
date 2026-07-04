import { resolveUser } from './_lib/telegram.js';
import { findUserId, getSupabase } from './_lib/supabase.js';

// Records one swipe from the feed deck. Right = like, left = dislike; the target
// is appended to the swiper's own liked_users / disliked_users so it never
// resurfaces. Strictly local DB persistence — no AI, no matchmaking.
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
    const userId = await findUserId(tgUser.id);
    if (!userId) return res.status(200).json({ ok: false });

    const { error } = await getSupabase().rpc('record_swipe', {
      swiper: userId,
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
