import { resolveUser, pickLang } from './_lib/telegram.js';
import { getSupabase, getMatchesFor, getHiddenUserIds } from './_lib/supabase.js';
import { buildReferralLink } from './_lib/referrals.js';
import { entitlements, likesLeftForClient, intimateCompatibility } from './_lib/entitlements.js';
import { darkActive, darkModeEnabled, consentStale, DARK_COLUMNS } from './_lib/darkmode.js';
import { notifyRetention } from './_lib/bot.js';
import { sanitizeAiText } from './_lib/claude.js';
import { rateLimit, LIMITS, sendRateLimited } from './_lib/ratelimit.js';

// Presence window for the online dot (mirrors api/feed.js). Every /api/me and
// /api/feed call stamps last_active, so this stays accurate without extra writes.
const ONLINE_WINDOW_MS = 5 * 60 * 1000;
const isOnline = (ts) => { if (!ts) return false; const d = Date.now() - new Date(ts).getTime(); return d >= 0 && d < ONLINE_WINDOW_MS; };
const normInt = (arr) => (Array.isArray(arr) ? arr : []).map((s) => String(s || '').trim()).filter(Boolean);
// Shared interests between two lists (case-insensitive), preserving the second
// list's original casing for display.
function sharedInterests(a, b) {
  const setA = new Set(normInt(a).map((s) => s.toLowerCase()));
  const out = [];
  for (const it of normInt(b)) if (setA.has(it.toLowerCase())) out.push(it);
  return out;
}

// Base completeness after onboarding; each answered "extra" deep question is +20.
const BASE_PROFILE_DEPTH = 40;
const EXTRA_QUESTION_STEP = 20;
// The one-time 100%-completion bonus (+2 ⭐) is now credited atomically in the DB
// (credit_profile_completion_bonus RPC, migration-019), the single source of truth.

// Psychological achievements. Big Five badges are derived from the user's OCEAN
// vector; thresholds live here (not in SQL) so they can evolve without a
// migration. Thresholds were loosened (was 80/80/30/85/80) so a solid — not only
// an extreme — profile earns something and the block rarely stays empty.
const ACH_RULES = [
  { key: 'crystal_empath', field: 'trait_agreeableness',    op: 'gt', target: 70 }, // 🏆
  { key: 'master_charisma', field: 'trait_extraversion',    op: 'gt', target: 70 }, // ⚡
  { key: 'rock_stability', field: 'trait_neuroticism',      op: 'lt', target: 35 }, // 🛡️
  { key: 'explorer',       field: 'trait_openness',         op: 'gt', target: 75 }, // 🪐
  { key: 'zen_strategist', field: 'trait_conscientiousness', op: 'gt', target: 70 }, // 🎯
];

// `p` = profiles row (trait_* numbers); `user` supplies profile_depth for the
// completion badge. Returns the earned key set (persisted to users.achievements).
function computeAchievements(p, user) {
  const out = [];
  if (p) {
    for (const r of ACH_RULES) {
      const v = typeof p[r.field] === 'number' ? p[r.field] : null;
      if (v === null) continue;
      if ((r.op === 'gt' && v > r.target) || (r.op === 'lt' && v < r.target)) out.push(r.key);
    }
  }
  // 💎 Completion badge — a guaranteed reward for finishing the profile (was tied
  // to nothing before, so a 100% profile could still show zero badges).
  if (user && user.profile_depth === 100) out.push('complete_100');
  return out;
}

// The unearned Big Five badge the user is CLOSEST to, as { key, pct } (pct 0..99),
// or null. Lets the UI show "almost there" progress instead of an empty block.
function nearestAchievement(p, earned) {
  if (!p) return null;
  let best = null;
  for (const r of ACH_RULES) {
    if (earned.includes(r.key)) continue;
    const v = typeof p[r.field] === 'number' ? p[r.field] : null;
    if (v === null) continue;
    // gt: how close from below; lt: how close from above (lower is better).
    let pct = r.op === 'gt' ? (v / r.target) * 100 : (r.target / Math.max(v, 1)) * 100;
    pct = Math.max(0, Math.min(99, Math.round(pct)));
    if (!best || pct > best.pct) best = { key: r.key, pct };
  }
  return best;
}

const sameSet = (a, b) =>
  a.length === b.length && [...a].sort().join('|') === [...b].sort().join('|');

// Returns the current user's onboarding state, their profile, and the list of
// their matches (each as a public partner card — no Telegram identity exposed).
// Consolidated (12-function cap): body.op === 'submit_extra_question' routes to
// the profile-depth writer below; otherwise this is the normal profile fetch.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const body = req.body || {};

    // Server-to-server retention cron (Vercel Scheduled / external). Authorized
    // by CRON_SECRET, NOT Telegram initData — so it runs before resolveUser.
    if (body.op === 'cron_retention_trigger') return cronRetentionTrigger(req, res);

    const tgUser = resolveUser(body.initData);
    if (!tgUser) {
      return res.status(401).json({ error: 'Invalid Telegram initData' });
    }

    const rl = rateLimit(`me:${tgUser.id}`, LIMITS.read);
    if (!rl.allowed) return sendRateLimited(res, rl.retryAfterSec);

    if (body.op === 'submit_extra_question') return submitExtraQuestion(res, tgUser, body);
    if (body.op === 'update_location') return updateLocation(res, tgUser, body);

    const supabase = getSupabase();
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, gender, seeking_gender, goal, age, city, interests, core_values, bio, photo_url, stars_balance, premium, premium_until, daily_likes_count, last_like_reset, ' + DARK_COLUMNS + ', kink_markers, blocked_users, profile_depth, achievements')
      .eq('telegram_id', tgUser.id)
      .maybeSingle();
    if (error) throw error;
    if (!user) {
      return res.status(200).json({ registered: false, user: null, profile: null, matches: [] });
    }

    // Retention: stamp activity on every authenticated app load (best-effort,
    // never fatal). Covers profile/matches/app-boot; feed.js stamps the deck.
    // Task 28: the CURRENT Telegram interface language is re-synced on every
    // open (from the signed initData, unforgeable) so bot notifications and all
    // later AI generations follow the user's language switch immediately.
    try {
      await supabase.from('users')
        .update({ last_active: new Date().toISOString(), language_code: pickLang(body.lang, tgUser) })
        .eq('id', user.id);
    } catch (e) { console.error('last_active stamp failed:', e.message); }

    // Paywall entitlement (gender-biased): drives blur, deepen gating, and the
    // remaining-likes counter on every screen from one cached payload.
    const ent = entitlements(user);

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('traits_json, vibe, summary_text, trait_extraversion, trait_agreeableness, trait_conscientiousness, trait_neuroticism, trait_openness')
      .eq('user_id', user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    // Sync psychological badges from the latest Big Five vector. Persist only
    // when the set actually changed, so a plain fetch stays read-mostly.
    const achievements = computeAchievements(profile, user);
    const achievementProgress = nearestAchievement(profile, achievements);
    const storedAchievements = user.achievements || [];
    if (!sameSet(achievements, storedAchievements)) {
      const { error: achError } = await supabase
        .from('users').update({ achievements }).eq('id', user.id);
      if (achError) console.error('achievements sync failed:', achError.message);
    }

    // Big Five compatibility %: one RPC call ranks every scored profile against
    // this user. We map partnerId -> score and enrich each match card below.
    // Isolated: if the migration/RPC isn't live yet, the feed still works.
    const compatByUser = {};
    try {
      const { data: compat, error: compatError } = await supabase.rpc(
        'calculate_compatibility',
        { current_user_id: user.id }
      );
      if (compatError) throw compatError;
      for (const c of compat || []) compatByUser[c.user_id] = c.compatibility_score;
    } catch (compatError) {
      console.error('compatibility rpc failed:', compatError.message);
    }

    // Build a public card for every match this user holds. The viewer's native
    // Telegram language (Task 26) localizes the rare server-side fallbacks.
    const lang = pickLang(body.lang, tgUser);
    const NAME_FALLBACK = { uk: 'Хтось особливий', en: 'Someone special', ru: 'Кто-то особенный' };
    // Instant mutual-swipe matches store the token 'mutual_like' (Task 28), so
    // each viewer reads the reason in their own language — unlike AI reasons,
    // which are one shared string generated in the initiator's language.
    const MUTUAL_REASON = {
      uk: 'Ви вподобали одне одного 🔥',
      en: 'You liked each other 🔥',
      ru: 'Вы понравились друг другу 🔥',
    };
    const rows = await getMatchesFor(user.id);
    const darkOn = darkActive(user);
    // Blocked (either direction) partners never surface as match cards.
    let hidden = new Set();
    try { hidden = await getHiddenUserIds(user.id, user.blocked_users); }
    catch (e) { console.error('matches block-filter failed:', e.message); }
    const matches = [];
    for (const m of rows) {
      if (hidden.has(m.partnerId)) continue;
      const { data: partner } = await supabase
        .from('users')
        .select('name, age, city, goal, interests, bio, photo_url, ' + DARK_COLUMNS + ', kink_markers, last_active, shadow_hidden')
        .eq('id', m.partnerId)
        .maybeSingle();
      if (!partner || partner.shadow_hidden) continue;
      const { data: partnerProfile } = await supabase
        .from('profiles')
        .select('traits_json, vibe')
        .eq('user_id', m.partnerId)
        .maybeSingle();
      // Last message for the chat-list preview.
      const { data: lastRows } = await supabase
        .from('messages')
        .select('text, sender_id, created_at')
        .eq('match_id', m.matchId)
        .order('created_at', { ascending: false })
        .limit(1);
      const lm = lastRows && lastRows[0];
      const card = {
        matchId: m.matchId,
        // Partner's internal user id — needed by the client to block/report them
        // (never the Telegram identity, which stays private until mutual consent).
        partnerId: m.partnerId,
        // Sanitized on read too: rows written before the parser hardening may
        // carry leaked JSON/meta-commentary at the tail (see claude.js).
        reason: m.reason === 'mutual_like'
          ? (MUTUAL_REASON[lang] || MUTUAL_REASON.uk)
          : sanitizeAiText(m.reason),
        score: m.score,
        // Big Five (OCEAN) math compatibility 0..100, or null if not scored yet.
        compatibility: m.partnerId in compatByUser ? compatByUser[m.partnerId] : null,
        // Interests shared with this partner → the "спільне: …" line on the card.
        common: sharedInterests(user.interests, partner.interests).slice(0, 3),
        lastMessage: lm
          ? { text: lm.text, mine: lm.sender_id === user.id, createdAt: lm.created_at }
          : null,
        partner: {
          name: (partner.name || '').split(' ')[0] || NAME_FALLBACK[lang] || NAME_FALLBACK.uk,
          age: partner.age,
          city: partner.city,
          goal: partner.goal,
          interests: partner.interests || [],
          bio: partner.bio,
          photoUrl: partner.photo_url,
          // Live presence for the online dot in the chat list.
          online: isOnline(partner.last_active),
          traits: (partnerProfile && partnerProfile.traits_json) || [],
          vibe: (partnerProfile && partnerProfile.vibe) || '',
        },
      };

      // Dark Mode (18+) on match cards — same mutual-opt-in contract as the feed
      // (api/feed.js): computed ONLY when BOTH sides have it on, and free males
      // get the % with the tags WITHHELD server-side (never recoverable from the
      // wire), so the intimate layer stays byte-for-byte private otherwise.
      if (darkOn && darkActive(partner)) {
        const intim = intimateCompatibility(user.kink_markers, partner.kink_markers);
        card.darkMode = true;
        card.intimateCompatibility = intim.score;
        // Stage 2 of two-stage disclosure: disclosure grows with the relationship.
        // A match is already mutual and both sides consented to the same terms, so
        // each now sees the OTHER'S FULL list and their own alongside it, with the
        // shared markers flagged for highlighting. Strictly symmetric — she sees
        // exactly what he sees — and free: ent.blur is deliberately not consulted,
        // so intimate data can never be bought.
        card.intimateTags = intim.tags;              // shared → highlighted client-side
        card.intimateTagsBlurred = false;
        card.intimatePartnerMarkers = partner.kink_markers || [];
        card.intimateMyMarkers = user.kink_markers || [];
      }

      matches.push(card);
    }

    return res.status(200).json({
      registered: true,
      user: {
        name: user.name,
        gender: user.gender,
        seekingGender: user.seeking_gender,
        goal: user.goal,
        age: user.age,
        city: user.city,
        interests: user.interests || [],
        values: user.core_values || [],
        bio: user.bio,
        photoUrl: user.photo_url,
        // Telegram Stars wallet + this user's shareable referral link.
        starsBalance: user.stars_balance || 0,
        referralLink: buildReferralLink(tgUser.id),
        // Paywall entitlement — cached client-side to gate blur / likes / deepen.
        premium: ent.premiumActive,
        premiumUntil: ent.premiumUntil,
        likesLeft: likesLeftForClient(ent),   // null = unlimited
        blur: ent.blur,
        // Dark Mode (18+): the user's own state, so the profile toggle + the
        // first-run kink interview can render. Markers are the user's own only.
        // darkMode reflects the EFFECTIVE state (all three gates), so the switch
        // can never sit "on" while the layer is actually withheld.
        darkMode: darkOn,
        // Kill switch is down → the whole card is hidden rather than shown broken.
        darkModeAvailable: darkModeEnabled(),
        // Opted in under superseded consent wording: the UI explains and re-asks
        // instead of showing an unexplained empty intimate layer.
        darkConsentStale: darkModeEnabled() && consentStale(user),
        kinkMarkers: user.kink_markers || [],
        // Gamification: completeness meter (0..100) + earned psychological badges.
        profileDepth: typeof user.profile_depth === 'number' ? user.profile_depth : BASE_PROFILE_DEPTH,
        achievements,
        // Nearest unearned Big Five badge ({ key, pct }) for the "almost there" hint.
        achievementProgress,
      },
      profile: profile
        ? { traits: profile.traits_json || [], vibe: profile.vibe || '', summary: profile.summary_text || '' }
        : null,
      matches,
      // Back-compat: the first match, same shape older clients expected.
      match: matches[0] || null,
    });
  } catch (e) {
    console.error('api/me failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// --- Extra deep question (profile depth) --------------------------------
// One answered "tricky" question raises profile_depth by +20 (capped at 100).
// Crossing to exactly 100 credits a one-time +2 ⭐ completion bonus. The raw
// answer is stored in `answers` so the background AI can refine the profile
// description later — mirroring how onboarding responses are persisted.
async function submitExtraQuestion(res, tgUser, body) {
  const answer = typeof body.answer === 'string' ? body.answer.trim() : '';
  if (!answer) return res.status(400).json({ error: 'answer is required' });

  const supabase = getSupabase();
  const { data: user, error } = await supabase
    .from('users')
    .select('id, profile_depth, stars_balance')
    .eq('telegram_id', tgUser.id)
    .maybeSingle();
  if (error) throw error;
  if (!user) return res.status(200).json({ ok: false });

  const current = typeof user.profile_depth === 'number' ? user.profile_depth : BASE_PROFILE_DEPTH;
  const next = Math.min(100, current + EXTRA_QUESTION_STEP);
  const reachedFull = current < 100 && next === 100;   // award the bonus exactly once

  // Persist the answer for background AI refinement (best-effort, non-fatal).
  const questionId = body.questionId ? String(body.questionId).slice(0, 60) : 'extra_deep';
  const { error: ansError } = await supabase.from('answers').insert({
    user_id: user.id,
    question_id: questionId,
    answer_text: answer.slice(0, 2000),
  });
  if (ansError) console.error('extra-answer save failed:', ansError.message);

  // Persist the depth meter only; the Stars bonus is credited separately below.
  const { data: updated, error: upError } = await supabase
    .from('users').update({ profile_depth: next }).eq('id', user.id)
    .select('profile_depth, stars_balance').maybeSingle();
  if (upError) throw upError;

  // Award the one-time completion bonus through an ATOMIC, idempotent RPC (was a
  // JS read-modify-write that could clobber a coincident referral/Stars-deposit
  // credit and, in theory, double-award). The RPC is the single source of truth
  // for the +2 amount and can never pay it twice (DB-enforced uniqueness).
  let starsBalance = updated ? updated.stars_balance : (user.stars_balance || 0);
  if (reachedFull) {
    const { data: bonusBalance, error: bonusErr } = await supabase.rpc(
      'credit_profile_completion_bonus', { user_id_param: user.id }
    );
    if (bonusErr) throw bonusErr;
    if (typeof bonusBalance === 'number') starsBalance = bonusBalance;
  }

  return res.status(200).json({
    ok: true,
    profileDepth: updated ? updated.profile_depth : next,
    starsBalance,
    bonusAwarded: reachedFull,
  });
}

// --- Location capture (GPS reverse-geocoded client-side, or manual) ---------
// The frontend resolves a city name itself (Nominatim or a typed value) to keep
// zero backend footprint under the 12-function cap; here we just sanitize and
// persist it. Self-guarded so a bad payload can never bubble a 500 to onboarding.
async function updateLocation(res, tgUser, body) {
  try {
    const city = typeof body.city === 'string' ? body.city.trim().slice(0, 120) : '';
    if (!city) return res.status(400).json({ ok: false, error: 'city is required' });

    const supabase = getSupabase();
    const { error } = await supabase
      .from('users')
      .update({ city })
      .eq('telegram_id', tgUser.id);
    if (error) throw error;

    return res.status(200).json({ ok: true, city });
  } catch (e) {
    console.error('update_location failed:', e);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
}

// --- 48h inactivity retention cron -------------------------------------
// Finds users idle > 48h who haven't been nudged in the last 48h, pings each via
// the bot, and stamps last_retention_push to lock the next window. Authorized by
// a shared CRON_SECRET (Bearer), never by Telegram identity. Batched so one run
// stays well under the serverless time budget; the cron drains the rest next tick.
const RETENTION_BATCH = 50;

async function cronRetentionTrigger(req, res) {
  const secret = process.env.CRON_SECRET;
  // Node lowercases header names; read both casings defensively regardless.
  const authHeader = req.headers.authorization || req.headers.Authorization || '';
  if (!secret || authHeader !== `Bearer ${secret}`) {
    // Never log the token itself. This isolates the two failure modes: whether
    // Vercel actually sees CRON_SECRET, and whether cron-job.org sent any header.
    console.error(
      'Cron auth failed. Expected:', secret ? 'set' : 'not set',
      'Received length:', authHeader.length
    );
    return res.status(401).json({ ok: false, error: 'Unauthorized' });
  }

  try {
    const supabase = getSupabase();
    const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString();

    const { data: users, error } = await supabase
      .from('users')
      .select('id, telegram_id, last_retention_push, language_code')
      .lt('last_active', cutoff)
      .or(`last_retention_push.is.null,last_retention_push.lt.${cutoff}`)
      .not('telegram_id', 'is', null)
      .limit(RETENTION_BATCH);
    if (error) throw error;

    let sent = 0;
    for (const u of users || []) {
      await notifyRetention(u.telegram_id, u.language_code);
      const { error: upErr } = await supabase
        .from('users')
        .update({ last_retention_push: new Date().toISOString() })
        .eq('id', u.id);
      if (upErr) console.error('retention stamp failed:', upErr.message);
      else sent++;
    }

    return res.status(200).json({ ok: true, candidates: (users || []).length, sent });
  } catch (e) {
    console.error('cron_retention_trigger failed:', e);
    return res.status(500).json({ ok: false, error: 'Internal error' });
  }
}
