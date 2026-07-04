import { resolveUser } from './_lib/telegram.js';
import { findUserId, getSupabase } from './_lib/supabase.js';
import {
  entitlements, likesLeftForClient,
  PREMIUM_PRICE, PREMIUM_DAYS, SWIPE_PACK_PRICE,
} from './_lib/entitlements.js';

// Virtual Telegram Stars checkout for the paywall. No real Stars invoice — the
// wallet is earned via referrals (migration-008) and spent here locally.
//   item: 'premium'    -> 150 ⭐, 30-day Premium (infinite likes, no blur, twin)
//   item: 'swipe_pack' -> 10 ⭐, +30 likes for the current rolling window
// All deduction happens inside a guarded single-statement RPC, so a user can
// never double-spend or go negative.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { initData, item } = req.body || {};
    if (item !== 'premium' && item !== 'swipe_pack') {
      return res.status(400).json({ error: "item must be 'premium' or 'swipe_pack'" });
    }

    const tgUser = resolveUser(initData);
    if (!tgUser) return res.status(401).json({ error: 'Invalid Telegram initData' });
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
  } catch (e) {
    console.error('api/purchase failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
