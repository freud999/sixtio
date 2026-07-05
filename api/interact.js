import { resolveUser } from './_lib/telegram.js';
import { findUserId, getSupabase } from './_lib/supabase.js';
import {
  entitlements, likesLeftForClient,
  FREE_DAILY_LIMIT, PREMIUM_PRICE, PREMIUM_DAYS, SWIPE_PACK_PRICE,
} from './_lib/entitlements.js';

// Consolidated user-interaction endpoint. Vercel Hobby caps a project at 12
// serverless functions, so swipe + purchase share one file and route on `op`:
//   op: 'swipe'    -> body { targetId, action:'like'|'dislike' }
//   op: 'purchase' -> body { item:'premium'|'swipe_pack' }
// (Legacy callers that omit `op` but send targetId/action still swipe.)
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const body = req.body || {};
    const tgUser = resolveUser(body.initData);
    if (!tgUser) {
      return res.status(401).json({ error: 'Invalid Telegram initData' });
    }

    const op = body.op || (body.item ? 'purchase' : 'swipe');
    if (op === 'purchase') return purchase(req, res, tgUser, body);
    return swipe(req, res, tgUser, body);
  } catch (e) {
    console.error('api/interact failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// --- Swipe --------------------------------------------------------------
// Records one swipe from the feed deck. Right = like, left = dislike; the target
// is appended to the swiper's own liked_users / disliked_users so it never
// resurfaces. Metering (paywall): only RIGHT swipes (likes) by NON-premium MALE
// users are counted, against a rolling 30/24h allowance. Dislikes are always
// free, and females / premium males are never limited. Hitting the cap returns a
// paywall signal and does NOT record the swipe (the person can be liked later).
async function swipe(req, res, tgUser, body) {
  const { targetId, action } = body;
  if (!targetId || (action !== 'like' && action !== 'dislike')) {
    return res.status(400).json({ error: 'targetId and action (like|dislike) are required' });
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
}

// --- Purchase -----------------------------------------------------------
// Virtual Telegram Stars checkout for the paywall. No real Stars invoice — the
// wallet is earned via referrals (migration-008) and spent here locally.
//   item: 'premium'    -> 150 ⭐, 30-day Premium (infinite likes, no blur, twin)
//   item: 'swipe_pack' -> 10 ⭐, +30 likes for the current rolling window
// All deduction happens inside a guarded single-statement RPC, so a user can
// never double-spend or go negative.
async function purchase(req, res, tgUser, body) {
  const { item } = body;
  if (item !== 'premium' && item !== 'swipe_pack') {
    return res.status(400).json({ error: "item must be 'premium' or 'swipe_pack'" });
  }

  const userId = await findUserId(tgUser.id);
  if (!userId) return res.status(200).json({ ok: false });

  const supabase = getSupabase();

  // Atomic, guarded deduction. RPC returns the new balance, or null when the
  // WHERE (stars_balance >= price) matched nothing = insufficient funds.
  let newBalance;
  if (item === 'premium') {
    const { data, error } = await supabase.rpc('purchase_premium', {
      buyer: userId, price: PREMIUM_PRICE, days: PREMIUM_DAYS,
    });
    if (error) throw error;
    newBalance = data;
  } else {
    const { data, error } = await supabase.rpc('purchase_swipe_pack', {
      buyer: userId, price: SWIPE_PACK_PRICE,
    });
    if (error) throw error;
    newBalance = data;
  }

  if (newBalance === null || newBalance === undefined) {
    const { data: u } = await supabase
      .from('users').select('stars_balance').eq('id', userId).maybeSingle();
    return res.status(200).json({
      ok: false, reason: 'insufficient', starsBalance: (u && u.stars_balance) || 0,
    });
  }

  // Re-read the fresh entitlement so the client can update instantly.
  const { data: fresh } = await supabase
    .from('users')
    .select('gender, premium, premium_until, daily_likes_count, last_like_reset, stars_balance')
    .eq('id', userId)
    .maybeSingle();
  const ent = entitlements(fresh);

  return res.status(200).json({
    ok: true,
    item,
    starsBalance: fresh.stars_balance,
    premium: ent.premiumActive,
    premiumUntil: ent.premiumUntil,
    likesLeft: likesLeftForClient(ent),
    blur: ent.blur,
  });
}
