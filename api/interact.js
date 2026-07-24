import { resolveUser, pickLang } from './_lib/telegram.js';
import {
  findUserId, getSupabase, blockUser, unblockUser, reportUser, getPendingLikers,
} from './_lib/supabase.js';
import {
  entitlements, likesLeftForClient, likesPassActive,
  FREE_DAILY_LIMIT, PREMIUM_PRICE, PREMIUM_DAYS, SWIPE_PACK_PRICE,
  MYSTERY_UNLOCK_PRICE, LOOTBOX_PRICE,
  LIKE_REVEAL_PRICE, LIKES_PASS_PRICE, LIKES_PASS_DAYS, AI_REPORT_PRICE,
} from './_lib/entitlements.js';
import { zodiacSign, signElement, socionicsType, parseBirthDate } from './_lib/astro.js';
import { generateAiReport } from './_lib/gemini.js';
import { localizeReport } from './_lib/translate.js';
import { processKinkInterview } from './_lib/kink.js';
import {
  darkActive, darkModeEnabled, recordDarkConsent,
  DARK_CONSENT_VERSION, DARK_COLUMNS,
} from './_lib/darkmode.js';
import { notifyInstantMatch, callBot } from './_lib/bot.js';
import { rewardReferrerOnEngagement } from './_lib/referrals.js';
import { rateLimit, LIMITS, sendRateLimited } from './_lib/ratelimit.js';
import { track, EVENTS } from './_lib/events.js';

// Real Telegram Stars top-up packs (Task 19). Server-authoritative so the client
// can never forge the price/amount: buying pack P pays P.stars Telegram Stars
// (currency XTR) and credits the same number to the in-app wallet on payment.
const STAR_PACKS = {
  pack_50:  { stars: 50,  title: 'Sixtio · 50 ⭐',  label: 'Поповнення балансу · 50 ⭐' },
  pack_100: { stars: 100, title: 'Sixtio · 100 ⭐', label: 'Поповнення балансу · 100 ⭐' },
  pack_250: { stars: 250, title: 'Sixtio · 250 ⭐', label: 'Поповнення балансу · 250 ⭐' },
};

// A user is auto-hidden from every feed/match once this many DISTINCT people
// report them (see report_user RPC, migration 022). Blocking is always instant.
const REPORT_HIDE_THRESHOLD = 3;
const OWNER_TELEGRAM_ID = Number(process.env.OWNER_TELEGRAM_ID || 0);

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
//   op: 'likers'               -> {}                          who liked you (count free, names gated)
//   op: 'reveal_liker'         -> body { targetId }           reveal one of them (5 ⭐)
//   op: 'save_birth'           -> body { birthDate, ... }     birth data for the AI report
//   op: 'ai_report'            -> {}                          free reading + the report if owned
//   op: 'buy_ai_report'        -> {}                          write the report (50 ⭐, once ever)
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

    // Per-op rate limit: Stars spends are the costliest to abuse, the kink
    // interview spends AI budget, everything else is a cheap write.
    const MONEY_OPS = ['create_stars_invoice', 'purchase', 'unlock_mystery_match', 'open_lootbox', 'reveal_liker'];
    // buy_ai_report spends BOTH Stars and AI budget, and its free-retry path
    // spends AI without Stars — so it takes the stricter of the two presets.
    const AI_OPS = ['submit_kink_interview', 'buy_ai_report'];
    const rlPreset = AI_OPS.includes(op)
      ? LIMITS.ai_heavy
      : MONEY_OPS.includes(op) ? LIMITS.money : LIMITS.write;
    const rl = rateLimit(`interact:${op}:${tgUser.id}`, rlPreset);
    if (!rl.allowed) return sendRateLimited(res, rl.retryAfterSec);

    if (op === 'create_stars_invoice') return createStarsInvoice(res, tgUser, body);
    if (op === 'purchase') return purchase(req, res, tgUser, body);
    if (op === 'toggle_dark_mode') return toggleDarkMode(res, tgUser, body);
    if (op === 'submit_kink_interview') return submitKinkInterview(res, tgUser, body);
    if (op === 'unlock_mystery_match') return unlockMysteryMatch(res, tgUser);
    if (op === 'open_lootbox') return openLootbox(res, tgUser);
    if (op === 'track') return trackClientEvent(res, tgUser, body);
    if (op === 'likers') return listLikers(res, tgUser);
    if (op === 'reveal_liker') return revealLiker(res, tgUser, body);
    if (op === 'save_birth') return saveBirth(res, tgUser, body);
    if (op === 'ai_report') return aiReport(res, tgUser, body, false);
    if (op === 'buy_ai_report') return aiReport(res, tgUser, body, true);
    if (op === 'block' || op === 'unblock') return blockOrUnblock(res, tgUser, body, op);
    if (op === 'report') return report(res, tgUser, body);
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
    .select('id, name, gender, premium, premium_until, daily_likes_count, last_like_reset, referred_by, referral_rewarded')
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

  // Funnel: only the FIRST like is interesting (the index dedupes the rest).
  if (action === 'like') await track(me.id, EVENTS.FIRST_LIKE);

  // Referral quality gate: the +15 ⭐ is credited only once the invited user has
  // proven real (profile depth ≥ 60 AND a D3 return — migration 032), never on
  // signup and no longer on a first swipe. A swipe can still be the call that
  // finds them already qualified, so we keep the hook here as well as on app
  // open; the RPC no-ops otherwise. Self-guarded: never breaks the swipe.
  if (me.referred_by != null && me.referral_rewarded === false) {
    try { await rewardReferrerOnEngagement(me.id); }
    catch (e) { console.error('referral reward on swipe failed:', e.message); }
  }

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
          // A match is mutual, so it is a first_match for BOTH sides.
          await track(me.id, EVENTS.FIRST_MATCH);
          await track(target.id, EVENTS.FIRST_MATCH);
          await notifyInstantMatch(
            { telegram_id: tgUser.id, name: me.name, language_code: pickLang(body.lang, tgUser) },
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
  const ITEMS = ['premium', 'swipe_pack', 'likes_pass'];
  if (!ITEMS.includes(item)) {
    return res.status(400).json({ error: `item must be one of ${ITEMS.join(', ')}` });
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
  } else if (item === 'likes_pass') {
    // Returns the new expiry (or null when the balance did not cover it), so we
    // read the balance back below rather than getting it from the RPC.
    const { data, error } = await supabase.rpc('buy_likes_pass', {
      buyer: userId, price: LIKES_PASS_PRICE, days: LIKES_PASS_DAYS,
    });
    if (error) throw error;
    newBalance = data == null ? null : 0;   // sentinel: non-null = the buy went through
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
    .select('gender, premium, premium_until, daily_likes_count, last_like_reset, stars_balance, likes_pass_until')
    .eq('id', userId)
    .maybeSingle();
  const ent = entitlements(fresh);

  // Funnel: repeat purchases are the signal, so this one is deliberately not
  // deduplicated. `item` rides along so the shop mix is readable later.
  await track(userId, EVENTS.PURCHASE, { item });

  return res.status(200).json({
    ok: true,
    item,
    starsBalance: fresh.stars_balance,
    premium: ent.premiumActive,
    premiumUntil: ent.premiumUntil,
    likesLeft: likesLeftForClient(ent),
    blur: ent.blur,
    likesPass: likesPassActive(fresh, ent),
    likesPassUntil: fresh.likes_pass_until || null,
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
//
// Turning it ON is asymmetric on purpose: kink markers are special-category data,
// so activation requires an explicit consent act carrying the CURRENT consent
// version plus a separate 18+ affirmation, and both are recorded (migration 030).
// Turning it OFF is unconditional and never asks for anything — withdrawal must
// always be at least as easy as giving consent.
async function toggleDarkMode(res, tgUser, body) {
  const active = !!body.active;
  const userId = await findUserId(tgUser.id);
  if (!userId) return res.status(200).json({ ok: false });

  const supabase = getSupabase();

  if (active) {
    // Operator kill switch: the layer can be taken offline without a deploy.
    if (!darkModeEnabled()) {
      return res.status(403).json({ error: 'Dark Mode is currently unavailable' });
    }
    // The client must echo back the version of the text it actually displayed —
    // a bare `active:true` can no longer switch the layer on.
    if (body.consentVersion !== DARK_CONSENT_VERSION || body.ageConfirmed !== true) {
      return res.status(400).json({ error: 'consent required', consentVersion: DARK_CONSENT_VERSION });
    }
    await recordDarkConsent(userId);
  } else {
    const { error } = await supabase
      .from('users')
      .update({ dark_mode_active: false })
      .eq('id', userId);
    if (error) throw error;
  }

  const { data, error: readError } = await supabase
    .from('users')
    .select(DARK_COLUMNS + ', kink_markers')
    .eq('id', userId)
    .maybeSingle();
  if (readError) throw readError;

  return res.status(200).json({
    ok: true,
    darkModeActive: darkActive(data),
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

  // The interview itself activates the layer, so it carries the same consent
  // burden as the toggle — otherwise it would be a way in around it. Checked
  // BEFORE the AI call so a consentless request costs nothing.
  if (!darkModeEnabled()) {
    return res.status(403).json({ error: 'Dark Mode is currently unavailable' });
  }
  if (body.consentVersion !== DARK_CONSENT_VERSION || body.ageConfirmed !== true) {
    return res.status(400).json({ error: 'consent required', consentVersion: DARK_CONSENT_VERSION });
  }
  await recordDarkConsent(userId);

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

// --- Client-reported funnel event ---------------------------------------
// Only ONE event is reportable from the client, and it is on the whitelist by
// name: opening the shop is a pure UI moment with no server side, so there is
// nothing else to observe it. Everything else in the funnel (likes, matches,
// purchases, retention) is derived server-side from the action itself, which is
// the only way those numbers stay trustworthy — a client that can post arbitrary
// events is a client that can fake the funnel.
const CLIENT_EVENTS = new Set([EVENTS.PAYWALL_OPEN]);

async function trackClientEvent(res, tgUser, body) {
  const event = typeof body.event === 'string' ? body.event : '';
  if (!CLIENT_EVENTS.has(event)) return res.status(400).json({ error: 'unknown event' });

  const userId = await findUserId(tgUser.id);
  if (!userId) return res.status(200).json({ ok: false });

  await track(userId, event);
  return res.status(200).json({ ok: true });
}

// --- Who liked you ------------------------------------------------------
// Returns everyone who right-swiped this user and is still waiting for an
// answer. The COUNT is always free — it is the whole hook, and a hidden count
// would just read as an empty screen. IDENTITY is what is gated:
//
//   * Premium / the 7-day pass -> everyone is revealed;
//   * otherwise               -> only the people already paid for individually,
//                                the rest come back as blurred stubs carrying NO
//                                name, age, city or sharp photo. The gating is
//                                done HERE, server-side: a locked liker's real
//                                data never crosses the wire, so nobody can read
//                                it out of the network tab.
//
// People this user already swiped are excluded (they are answered), as are
// blocks in either direction and shadow-hidden accounts.
async function listLikers(res, tgUser) {
  const supabase = getSupabase();
  const { data: me, error } = await supabase
    .from('users')
    .select('id, gender, premium, premium_until, daily_likes_count, last_like_reset, ' +
            'liked_users, disliked_users, blocked_users, likes_pass_until, revealed_likers')
    .eq('telegram_id', tgUser.id)
    .maybeSingle();
  if (error) throw error;
  if (!me) return res.status(200).json({ ok: false });

  const pending = await getPendingLikers(me, 'name, age, city, photo_url, photo_blur_url');

  const ent = entitlements(me);
  const pass = likesPassActive(me, ent);
  const revealed = new Set(me.revealed_likers || []);

  const likers = pending.map((u) => {
    if (pass || revealed.has(u.id)) {
      return {
        userId: u.id,
        name: (u.name || '').split(' ')[0] || '',
        age: u.age, city: u.city || '',
        photoUrl: u.photo_url || '',
        locked: false,
      };
    }
    // Locked: a blurred silhouette and nothing else. No name, no age, no city.
    return { userId: u.id, photoUrl: u.photo_blur_url || '', locked: true };
  });

  return res.status(200).json({
    ok: true,
    count: likers.length,
    likers,
    pass,
    passUntil: me.likes_pass_until || null,
    revealPrice: LIKE_REVEAL_PRICE,
    passPrice: LIKES_PASS_PRICE,
    passDays: LIKES_PASS_DAYS,
  });
}

// --- Reveal one liker (5 ⭐) ---------------------------------------------
// The RPC is the guard, not this function: it charges only when the target
// genuinely liked this user, was not already revealed, and the balance covers
// it — all in one statement, so double taps cannot double-charge. A null return
// means one of those failed, and we re-read the row to say which.
async function revealLiker(res, tgUser, body) {
  const targetId = body.targetId ? String(body.targetId) : '';
  if (!targetId) return res.status(400).json({ error: 'targetId is required' });

  const supabase = getSupabase();
  const { data: me, error } = await supabase
    .from('users')
    .select('id, gender, premium, premium_until, stars_balance, likes_pass_until, revealed_likers')
    .eq('telegram_id', tgUser.id)
    .maybeSingle();
  if (error) throw error;
  if (!me) return res.status(200).json({ ok: false });
  if (targetId === me.id) return res.status(400).json({ error: 'cannot reveal yourself' });

  // Already entitled (Premium or an active pass) or already bought: no charge.
  const free = likesPassActive(me) || (me.revealed_likers || []).includes(targetId);

  let starsBalance = me.stars_balance || 0;
  if (!free) {
    const { data: newBalance, error: rpcError } = await supabase.rpc('reveal_liker', {
      viewer: me.id, liker: targetId, price: LIKE_REVEAL_PRICE,
    });
    if (rpcError) throw rpcError;
    if (newBalance === null || newBalance === undefined) {
      // Either the wallet was short or that person never actually liked us.
      const { data: liker } = await supabase
        .from('users').select('liked_users').eq('id', targetId).maybeSingle();
      const reallyLiked = !!(liker && (liker.liked_users || []).includes(me.id));
      return res.status(200).json({
        ok: false, reason: reallyLiked ? 'insufficient' : 'not_a_liker', starsBalance,
      });
    }
    starsBalance = newBalance;
  }

  const { data: u } = await supabase
    .from('users')
    .select('id, name, age, city, photo_url')
    .eq('id', targetId)
    .maybeSingle();
  if (!u) return res.status(200).json({ ok: false, reason: 'gone', starsBalance });

  return res.status(200).json({
    ok: true,
    starsBalance,
    liker: {
      userId: u.id,
      name: (u.name || '').split(' ')[0] || '',
      age: u.age, city: u.city || '',
      photoUrl: u.photo_url || '',
      locked: false,
    },
  });
}

// --- AI-звіт: birth data ------------------------------------------------
// The date is the only required field. Time and place are optional and exist so
// the reading can say "sun sign only" honestly rather than implying a natal
// chart it does not have. Validated with the same pure parser the sign math uses
// (parseBirthDate), so a date the reading cannot use can never be stored.
//
// Deliberately does NOT touch users.age. Age drives matching and the feed, it
// was confirmed at onboarding, and silently re-deriving it here would let a
// typo in an optional field quietly change who a person is shown to.
async function saveBirth(res, tgUser, body) {
  const parsed = parseBirthDate(body.birthDate);
  if (!parsed) return res.status(400).json({ error: 'birthDate must be YYYY-MM-DD' });

  const userId = await findUserId(tgUser.id);
  if (!userId) return res.status(200).json({ ok: false });

  const patch = { birth_date: body.birthDate };
  // Optional, free-text, and length-capped: they are only ever fed to the model
  // as context, never parsed, so precision is the user's business.
  if (typeof body.birthTime === 'string') patch.birth_time = body.birthTime.trim().slice(0, 10) || null;
  if (typeof body.birthPlace === 'string') patch.birth_place = body.birthPlace.trim().slice(0, 120) || null;

  const { error } = await getSupabase().from('users').update(patch).eq('id', userId);
  if (error) throw error;

  return res.status(200).json({ ok: true, birthDate: body.birthDate });
}

// --- AI-звіт: the reading, and the paid report --------------------------
// One function serves both ops because they answer the same question ("what do
// we have for this user?") and differ only in whether a missing report is
// allowed to be written. Splitting them would mean duplicating the whole
// gather-and-shape half.
//
// FREE, always, for everyone:
//   * the sun sign, derived from the birth date;
//   * the socionics type, derived from the Big Five vector the user already has.
// Both are computed in plain JS (_lib/astro.js) — they cost nothing, so charging
// for them would be charging for arithmetic. Nobody pays to learn their own type.
//
// PAID (50 ⭐, once ever): the written report. That is the part with a real
// marginal cost, so that is the part that is sold.
async function aiReport(res, tgUser, body, buying) {
  const supabase = getSupabase();
  const { data: me, error } = await supabase
    .from('users')
    .select('id, gender, goal, core_values, interests, language_code, ' +
            'birth_date, birth_time, birth_place, ai_report_paid_at, stars_balance')
    .eq('telegram_id', tgUser.id)
    .maybeSingle();
  if (error) throw error;
  if (!me) return res.status(200).json({ ok: false });

  const { data: profile } = await supabase
    .from('profiles')
    .select('traits_json, summary_text, trait_extraversion, trait_agreeableness, ' +
            'trait_conscientiousness, trait_neuroticism, trait_openness')
    .eq('user_id', me.id)
    .maybeSingle();

  const lang = pickLang(body.lang, tgUser);
  const sign = zodiacSign(me.birth_date);
  const socionics = socionicsType(profile);

  // The free reading, and the shape every early return below shares.
  const base = {
    ok: true,
    price: AI_REPORT_PRICE,
    birthDate: me.birth_date || null,
    birthTime: me.birth_time || null,
    birthPlace: me.birth_place || null,
    sign,
    element: signElement(sign),
    socionics,
    paid: !!me.ai_report_paid_at,
    starsBalance: me.stars_balance || 0,
  };

  const { data: existing } = await supabase
    .from('ai_reports')
    .select('user_id, sections, sign, socionics, lang, i18n')
    .eq('user_id', me.id)
    .maybeSingle();

  // Already written: re-reading is free forever, in the reader's current
  // language. `reportSign`/`reportType` come from the STORED row, not from the
  // recomputed values above — a report has to keep saying what it said when it
  // was written, even if the birth date is corrected or the Big Five re-run.
  if (existing) {
    let sections = existing.sections;
    try { sections = await localizeReport(existing, lang, me.language_code); }
    catch (e) { console.error('report localization failed:', e.message); }
    return res.status(200).json({
      ...base, sections,
      reportSign: existing.sign || null,
      reportType: existing.socionics || null,
    });
  }

  if (!buying) return res.status(200).json({ ...base, sections: null });

  // --- buying -------------------------------------------------------------
  // The two things the report is actually made of. Refusing here, before any
  // charge, is the difference between "we can't write this yet" and "you paid
  // for a report about nothing".
  if (!me.birth_date) return res.status(200).json({ ...base, ok: false, reason: 'no_birth_date' });
  if (!socionics) return res.status(200).json({ ...base, ok: false, reason: 'no_traits' });

  // Charge FIRST, then generate. The RPC sets ai_report_paid_at and refuses to
  // fire twice, so if generation then fails the retry below regenerates for
  // free instead of charging again for a report that was never delivered. A
  // refund path would have to be exactly right under concurrency; not needing
  // one is better than getting one right.
  let starsBalance = me.stars_balance || 0;
  if (!me.ai_report_paid_at) {
    const { data: newBalance, error: rpcError } = await supabase.rpc('purchase_ai_report', {
      buyer: me.id, price: AI_REPORT_PRICE,
    });
    if (rpcError) throw rpcError;
    if (newBalance === null || newBalance === undefined) {
      return res.status(200).json({ ...base, ok: false, reason: 'insufficient' });
    }
    starsBalance = newBalance;
  }

  let sections;
  try {
    sections = await generateAiReport({
      gender: me.gender, goal: me.goal,
      values: me.core_values || [], interests: me.interests || [],
      traits: profile, sign, element: signElement(sign), socionics,
    }, lang);
  } catch (e) {
    console.error('ai report generation failed:', e.message);
    // Paid, undelivered, and retryable at no further cost — the client shows a
    // "try again" rather than a dead end, and paid:true says the Stars are safe.
    return res.status(200).json({ ...base, ok: false, reason: 'generation_failed', paid: true, starsBalance });
  }

  const { error: saveError } = await supabase.from('ai_reports').upsert({
    user_id: me.id, sections, sign, socionics: socionics.code,
    lang,                       // written in the buyer's language; translated on read
    i18n: {},
    created_at: new Date().toISOString(),
  }, { onConflict: 'user_id' });
  if (saveError) throw saveError;

  await track(me.id, EVENTS.PURCHASE, { item: 'ai_report' });

  return res.status(200).json({
    ...base, paid: true, starsBalance, sections,
    reportSign: sign, reportType: socionics.code,
  });
}

// --- Block / Unblock ----------------------------------------------------
// Blocking is a private, two-way hide: the target vanishes from this user's
// feed/matches/chat and vice versa (the read paths union both directions). It
// never notifies anyone and never deletes data — unblocking fully reverses it.
async function blockOrUnblock(res, tgUser, body, op) {
  const targetId = body.targetId ? String(body.targetId) : '';
  if (!targetId) return res.status(400).json({ error: 'targetId is required' });

  const userId = await findUserId(tgUser.id);
  if (!userId) return res.status(200).json({ ok: false });
  if (targetId === userId) return res.status(400).json({ error: 'cannot block yourself' });

  if (op === 'block') await blockUser(userId, targetId);
  else await unblockUser(userId, targetId);

  return res.status(200).json({ ok: true, blocked: op === 'block' });
}

// --- Report -------------------------------------------------------------
// Flags a user to the owner for review and auto-hides them once enough distinct
// people report them. A report also blocks the reporter -> reported direction
// immediately, so the reporter never has to see them again while we review.
async function report(res, tgUser, body) {
  const targetId = body.targetId ? String(body.targetId) : '';
  if (!targetId) return res.status(400).json({ error: 'targetId is required' });

  const userId = await findUserId(tgUser.id);
  if (!userId) return res.status(200).json({ ok: false });
  if (targetId === userId) return res.status(400).json({ error: 'cannot report yourself' });

  const reason = typeof body.reason === 'string' ? body.reason.trim().slice(0, 500) : '';
  const count = await reportUser(userId, targetId, reason, REPORT_HIDE_THRESHOLD);
  // A report implies a block — hide them from the reporter right away.
  try { await blockUser(userId, targetId); } catch (e) { console.error('report auto-block failed:', e.message); }

  const hidden = count >= REPORT_HIDE_THRESHOLD;
  // Notify the owner so a real human can review. Best-effort, never fatal.
  if (OWNER_TELEGRAM_ID) {
    const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const text =
      '🚩 <b>Скарга Sixtio</b>\n' +
      `Порушник: <code>${targetId}</code>\n` +
      `Скаржник: <code>${userId}</code>\n` +
      `Причина: ${reason ? esc(reason) : '—'}\n` +
      `Унікальних скарг: <b>${count}</b>` +
      (hidden ? '\n\n⛔️ Авто-приховано (досягнуто поріг).' : '');
    try {
      await callBot('sendMessage', { chat_id: OWNER_TELEGRAM_ID, text, parse_mode: 'HTML' });
    } catch (e) { console.error('report owner notify failed:', e.message); }
  }

  return res.status(200).json({ ok: true, reported: true, hidden });
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
