import { resolveUser, resolveLang } from './_lib/telegram.js';
import { findUserId, getSupabase } from './_lib/supabase.js';
import {
  entitlements, likesLeftForClient,
  FREE_DAILY_LIMIT, PREMIUM_PRICE, PREMIUM_DAYS, SWIPE_PACK_PRICE,
  MYSTERY_UNLOCK_PRICE, LOOTBOX_PRICE,
} from './_lib/entitlements.js';
import { processKinkInterview } from './_lib/kink.js';
import { notifyInstantMatch, callBot } from './_lib/bot.js';

// Real Telegram Stars top-up packs (Task 19). Server-authoritative so the client
// can never forge the price/amount: buying pack P pays P.stars Telegram Stars
// (currency XTR) and credits the same number to the in-app wallet on payment.
const STAR_PACKS = {
  pack_50:  { stars: 50,  title: 'Sixtio · 50 ⭐',  label: 'Поповнення балансу · 50 ⭐' },
  pack_100: { stars: 100, title: 'Sixtio · 100 ⭐', label: 'Поповнення балансу · 100 ⭐' },
  pack_250: { stars: 250, title: 'Sixtio · 250 ⭐', label: 'Поповнення балансу · 250 ⭐' },
};

// Chance-based lootbox reward table. Rolled server-side so the client can't
// bias the odds: 40% +3 swipes, 20% a 30% Premium discount, 40% nothing.
const LOOTBOX_REWARDS = [
  { type: '+3_swipes',   weight: 40 },
  { type: 'discount_30', weight: 20 },
  { type: 'empty',       weight: 40 },
];
function rollLootboxReward() {
  const total = LOOTBOX_REWARDS.reduce((s, r) => s + r.weight, 0);
  let roll = Math.random() * total;
  for (const r of LOOTBOX_REWARDS) {
    if (roll < r.weight) return r.type;
    roll -= r.weight;
  }
  return 'empty';
}

// Consolidated user-interaction endpoint. Vercel Hobby caps a project at 12
// serverless functions, so several write-ops share one file and route on `op`:
//   op: 'swipe'                -> body { targetId, action:'like'|'dislike' }
//   op: 'purchase'             -> body { item:'premium'|'swipe_pack' }
//   op: 'toggle_dark_mode'     -> body { active:bool }        Dark Mode (18+) on/off
//   op: 'submit_kink_interview'-> body { answers:string }     AI kink-marker analysis
//   op: 'unlock_mystery_match' -> {}                          reveal the daily match (10 ⭐)
//   op: 'open_lootbox'         -> {}                          open a luck box (first free, then 5 ⭐)
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
    if (op === 'create_stars_invoice') return createStarsInvoice(res, tgUser, body);
    if (op === 'purchase') return purchase(req, res, tgUser, body);
    if (op === 'toggle_dark_mode') return toggleDarkMode(res, tgUser, body);
    if (op === 'submit_kink_interview') return submitKinkInterview(res, tgUser, body);
    if (op === 'unlock_mystery_match') return unlockMysteryMatch(res, tgUser);
    if (op === 'open_lootbox') return openLootbox(res, tgUser);
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
    .select('id, name, gender, premium, premium_until, daily_likes_count, last_like_reset')
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

  // Instant match: a LIKE that the target already returned = mutual. Create the
  // match (idempotent via the unique(user_a,user_b) constraint) and ping both in
  // Telegram. Notifications fire ONLY on a freshly-inserted row, so re-swipes or
  // an already-AI-matched pair never double-notify. Fully self-guarded — nothing
  // here can 500 or block the swipe response.
  let matched = false;
  if (action === 'like') {
    try {
      const { data: target } = await supabase
        .from('users')
        .select('id, name, telegram_id, liked_users, language_code')
        .eq('id', String(targetId))
        .maybeSingle();

      if (target && (target.liked_users || []).includes(me.id)) {
        const [a, b] = me.id < target.id ? [me.id, target.id] : [target.id, me.id];
        const { data: inserted, error: insErr } = await supabase
          .from('matches')
          .upsert(
            // Language-neutral token — /api/me localizes it per viewer (Task 28).
            { user_a: a, user_b: b, reason: 'mutual_like' },
            { onConflict: 'user_a,user_b', ignoreDuplicates: true }
          )
          .select('id');
        if (insErr) throw insErr;

        if (Array.isArray(inserted) && inserted.length) {
          matched = true;
          await notifyInstantMatch(
            { telegram_id: tgUser.id, name: me.name, language_code: resolveLang(tgUser) },
            { telegram_id: target.telegram_id, name: target.name, language_code: target.language_code }
          );
        }
      }
    } catch (e) {
      console.error('instant match/notify failed:', e);
    }
  }

  return res.status(200).json({ ok: true, matched });
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

// --- Create Stars invoice (real top-up) ---------------------------------
// Builds a one-off Telegram Stars invoice link for a top-up pack and hands it to
// the client, which opens it with Telegram.WebApp.openInvoice. The wallet is NOT
// credited here — crediting happens ONLY on the signed successful_payment webhook
// (api/_lib/analytics.js), so a user can never self-credit by hitting this route.
//   * currency:       'XTR'  (Telegram Stars — the only accepted token)
//   * provider_token: ''     (MUST be empty for Stars)
//   * prices:         [{ amount }] where amount is the whole number of Stars
//   * payload:        'deposit:<userId>:<packId>' — echoed back on payment so the
//                     webhook can attribute the credit to the right buyer.
async function createStarsInvoice(res, tgUser, body) {
  const packId = typeof body.packId === 'string' ? body.packId : '';
  const pack = STAR_PACKS[packId];
  if (!pack) return res.status(400).json({ error: 'unknown packId' });

  const userId = await findUserId(tgUser.id);
  if (!userId) return res.status(200).json({ ok: false });

  try {
    const invoiceLink = await callBot('createInvoiceLink', {
      title: pack.title,
      description: `Поповнення балансу Sixtio на ${pack.stars} ⭐. Оплата зірками Telegram.`,
      payload: `deposit:${userId}:${packId}`,
      provider_token: '',                                   // empty = Telegram Stars
      currency: 'XTR',
      prices: [{ label: pack.label, amount: pack.stars }],  // XTR amount = whole Stars
    });
    return res.status(200).json({ ok: true, invoiceLink, packId, stars: pack.stars });
  } catch (e) {
    console.error('createInvoiceLink failed:', e.message);
    return res.status(502).json({ ok: false, error: 'invoice_failed' });
  }
}

// --- Dark Mode toggle ---------------------------------------------------
// Flips users.dark_mode_active. Intimate data is only ever computed between two
// users who BOTH have this on (see api/feed.js), so switching off instantly and
// fully hides this user from — and blinds them to — the intimate layer.
async function toggleDarkMode(res, tgUser, body) {
  const active = !!body.active;
  const userId = await findUserId(tgUser.id);
  if (!userId) return res.status(200).json({ ok: false });

  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('users')
    .update({ dark_mode_active: active })
    .eq('id', userId)
    .select('dark_mode_active, kink_markers')
    .maybeSingle();
  if (error) throw error;

  return res.status(200).json({
    ok: true,
    darkModeActive: !!(data && data.dark_mode_active),
    // Lets the client decide whether the first-run interview is still needed.
    hasMarkers: !!(data && data.kink_markers && data.kink_markers.length),
  });
}

// --- Kink interview -----------------------------------------------------
// One AI pass maps the short anonymous interview to standardized markers, saves
// them, and turns Dark Mode on. `answers` is the concatenated Q&A free text.
async function submitKinkInterview(res, tgUser, body) {
  const answers = typeof body.answers === 'string' ? body.answers.trim() : '';
  if (!answers) return res.status(400).json({ error: 'answers is required' });

  const userId = await findUserId(tgUser.id);
  if (!userId) return res.status(200).json({ ok: false });

  const markers = await processKinkInterview(userId, answers);
  return res.status(200).json({ ok: true, darkModeActive: true, kinkMarkers: markers });
}

// --- Unlock Mystery Match (10 ⭐) ----------------------------------------
// Reveals the identity behind today's anonymized "?" card. Charges once via a
// guarded RPC (never double-charges, never goes negative); if already unlocked
// we skip the charge and just re-serve the identity. Returns the full card so
// the client can flip the "?" into a real person without another round-trip.
async function unlockMysteryMatch(res, tgUser) {
  const supabase = getSupabase();
  const { data: me, error } = await supabase
    .from('users')
    .select('id, last_mystery_match_id, mystery_match_unlocked, stars_balance')
    .eq('telegram_id', tgUser.id)
    .maybeSingle();
  if (error) throw error;
  if (!me || !me.last_mystery_match_id) {
    return res.status(200).json({ ok: false, reason: 'no_match' });
  }

  let starsBalance = me.stars_balance || 0;
  if (!me.mystery_match_unlocked) {
    const { data: newBalance, error: rpcError } = await supabase.rpc('unlock_mystery_match', {
      buyer: me.id, price: MYSTERY_UNLOCK_PRICE,
    });
    if (rpcError) throw rpcError;
    if (newBalance === null || newBalance === undefined) {
      return res.status(200).json({ ok: false, reason: 'insufficient', starsBalance });
    }
    starsBalance = newBalance;
  }

  const profile = await revealMysteryCard(supabase, me.id, me.last_mystery_match_id);
  return res.status(200).json({ ok: true, starsBalance, profile });
}

// Builds the unlocked Mystery Match card (identity + fresh Big Five score/tags).
async function revealMysteryCard(supabase, meId, targetId) {
  const { data: u } = await supabase
    .from('users')
    .select('id, name, age, city, photo_url')
    .eq('id', targetId)
    .maybeSingle();
  if (!u) return null;

  let compatibility = null;
  let tags = [];
  try {
    const { data: compat, error } = await supabase.rpc('calculate_compatibility', {
      current_user_id: meId,
    });
    if (error) throw error;
    const hit = (compat || []).find((c) => c.user_id === targetId);
    if (hit) { compatibility = hit.compatibility_score; tags = (hit.compatibility_tags || []).slice(0, 3); }
  } catch (e) {
    console.error('mystery reveal compat failed:', e.message);
  }

  return {
    userId: u.id,
    name: (u.name || '').split(' ')[0] || 'Хтось особливий',
    age: u.age, city: u.city || '', photoUrl: u.photo_url || '',
    compatibility, tags, isMysteryMatch: true, unlocked: true,
  };
}

// --- Open Lootbox (first free / then 5 ⭐) -------------------------------
// The reward is rolled HERE (server-authoritative odds) and handed to the RPC,
// which atomically prices the open (free first today, 5 ⭐ after), charges it,
// bumps the daily counter, and — for a '+3_swipes' win — rolls this user's like
// usage back by 3. Returns the reward, the cost actually charged, the new daily
// count, and the fresh Stars balance so the client can update the wallet + the
// remaining-likes gate immediately.
async function openLootbox(res, tgUser) {
  const userId = await findUserId(tgUser.id);
  if (!userId) return res.status(200).json({ ok: false });

  const supabase = getSupabase();
  const rewardType = rollLootboxReward();

  const { data: rows, error } = await supabase.rpc('open_lootbox', {
    opener: userId, subsequent_price: LOOTBOX_PRICE, reward: rewardType,
  });
  if (error) throw error;

  // Empty result set = no such user or insufficient Stars for a paid open.
  const result = Array.isArray(rows) ? rows[0] : rows;
  if (!result) {
    const { data: u } = await supabase
      .from('users').select('stars_balance').eq('id', userId).maybeSingle();
    return res.status(200).json({
      ok: false, reason: 'insufficient', starsBalance: (u && u.stars_balance) || 0,
    });
  }

  return res.status(200).json({
    ok: true,
    rewardType,
    cost: result.charged,
    lootboxesOpenedToday: result.opened_today,
    starsBalance: result.balance,
  });
}
