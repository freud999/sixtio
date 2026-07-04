import { resolveUser } from './_lib/telegram.js';
import { getSupabase, getMatchesFor } from './_lib/supabase.js';

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
      .select('id, name, gender, seeking_gender, goal, age, city, interests, bio, photo_url')
      .eq('telegram_id', tgUser.id)
      .maybeSingle();
    if (error) throw error;
    if (!user) {
      return res.status(200).json({ registered: false, user: null, profile: null, matches: [] });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('traits_json, vibe, summary_text')
      .eq('user_id', user.id)
      .maybeSingle();
    if (profileError) throw profileError;

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
      matches.push({
        matchId: m.matchId,
        reason: m.reason,
        score: m.score,
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
