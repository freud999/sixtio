import { resolveUser } from './_lib/telegram.js';
import { getSupabase, getMatchesFor } from './_lib/supabase.js';
import { buildReferralLink } from './_lib/referrals.js';
import { entitlements, likesLeftForClient } from './_lib/entitlements.js';

// Base completeness after onboarding; each answered "extra" deep question is +20.
const BASE_PROFILE_DEPTH = 40;
const EXTRA_QUESTION_STEP = 20;
const FULL_PROFILE_BONUS = 2;   // ⭐ credited once, on reaching exactly 100%.

// Psychological achievements are derived purely from the user's Big Five vector.
// Thresholds live here (not in SQL) so they can evolve without a migration; the
// resulting key set is persisted to users.achievements and refreshed on fetch.
function computeAchievements(p) {
  const out = [];
  if (!p) return out;
  const n = (v) => (typeof v === 'number' ? v : null);
  const ag = n(p.trait_agreeableness), ex = n(p.trait_extraversion),
        ne = n(p.trait_neuroticism), op = n(p.trait_openness),
        co = n(p.trait_conscientiousness);
  if (ag !== null && ag > 80) out.push('crystal_empath');   // 🏆 Кришталевий Емпат
  if (ex !== null && ex > 80) out.push('master_charisma');  // ⚡ Магістр Харизми
  if (ne !== null && ne < 30) out.push('rock_stability');   // 🛡️ Скеля Стабільності
  if (op !== null && op > 85) out.push('explorer');         // 🪐 Першовідкривач
  if (co !== null && co > 80) out.push('zen_strategist');   // 🎯 Дзен-Стратег
  return out;
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
    const tgUser = resolveUser(body.initData);
    if (!tgUser) {
      return res.status(401).json({ error: 'Invalid Telegram initData' });
    }

    if (body.op === 'submit_extra_question') return submitExtraQuestion(res, tgUser, body);

    const supabase = getSupabase();
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, gender, seeking_gender, goal, age, city, interests, bio, photo_url, stars_balance, premium, premium_until, daily_likes_count, last_like_reset, dark_mode_active, kink_markers, profile_depth, achievements')
      .eq('telegram_id', tgUser.id)
      .maybeSingle();
    if (error) throw error;
    if (!user) {
      return res.status(200).json({ registered: false, user: null, profile: null, matches: [] });
    }

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
    const achievements = computeAchievements(profile);
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

    // Build a public card for every match this user holds.
    const rows = await getMatchesFor(user.id);
    const matches = [];
    for (const m of rows) {
      const { data: partner } = await supabase
        .from('users')
        .select('name, age, city, goal, interests, bio, photo_url')
        .eq('id', m.partnerId)
        .maybeSingle();
      if (!partner) continue;
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
      matches.push({
        matchId: m.matchId,
        reason: m.reason,
        score: m.score,
        // Big Five (OCEAN) math compatibility 0..100, or null if not scored yet.
        compatibility: m.partnerId in compatByUser ? compatByUser[m.partnerId] : null,
        lastMessage: lm
          ? { text: lm.text, mine: lm.sender_id === user.id, createdAt: lm.created_at }
          : null,
        partner: {
          name: (partner.name || '').split(' ')[0] || 'Хтось особливий',
          age: partner.age,
          city: partner.city,
          goal: partner.goal,
          interests: partner.interests || [],
          bio: partner.bio,
          photoUrl: partner.photo_url,
          traits: (partnerProfile && partnerProfile.traits_json) || [],
          vibe: (partnerProfile && partnerProfile.vibe) || '',
        },
      });
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
        darkMode: !!user.dark_mode_active,
        kinkMarkers: user.kink_markers || [],
        // Gamification: completeness meter (0..100) + earned psychological badges.
        profileDepth: typeof user.profile_depth === 'number' ? user.profile_depth : BASE_PROFILE_DEPTH,
        achievements,
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

  const patch = { profile_depth: next };
  if (reachedFull) patch.stars_balance = (user.stars_balance || 0) + FULL_PROFILE_BONUS;

  const { data: updated, error: upError } = await supabase
    .from('users').update(patch).eq('id', user.id)
    .select('profile_depth, stars_balance').maybeSingle();
  if (upError) throw upError;

  return res.status(200).json({
    ok: true,
    profileDepth: updated ? updated.profile_depth : next,
    starsBalance: updated ? updated.stars_balance : (user.stars_balance || 0),
    bonusAwarded: reachedFull,
  });
}
