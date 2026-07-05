import { resolveUser } from './_lib/telegram.js';
import { getSupabase, getMatchesFor } from './_lib/supabase.js';
import { buildReferralLink } from './_lib/referrals.js';
import { entitlements, likesLeftForClient } from './_lib/entitlements.js';

// Returns the current user's onboarding state, their profile, and the list of
// their matches (each as a public partner card — no Telegram identity exposed).
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { initData } = req.body || {};
    const tgUser = resolveUser(initData);
    if (!tgUser) {
      return res.status(401).json({ error: 'Invalid Telegram initData' });
    }

    const supabase = getSupabase();
    const { data: user, error } = await supabase
      .from('users')
      .select('id, name, gender, seeking_gender, goal, age, city, interests, bio, photo_url, stars_balance, premium, premium_until, daily_likes_count, last_like_reset, dark_mode_active, kink_markers')
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
      .select('traits_json, vibe, summary_text')
      .eq('user_id', user.id)
      .maybeSingle();
    if (profileError) throw profileError;

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
