import { resolveUser } from './_lib/telegram.js';
import { getSupabase } from './_lib/supabase.js';

// Returns the current user's onboarding state: whether they exist in the DB
// and their generated profile (if onboarding is complete).
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
      return res.status(200).json({ registered: false, user: null, profile: null });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('traits_json, summary_text')
      .eq('user_id', user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    // Most recent match for this user, with the partner's public card.
    let match = null;
    const { data: matchRow, error: matchError } = await supabase
      .from('matches')
      .select('user_a, user_b, score, reason, created_at')
      .or(`user_a.eq.${user.id},user_b.eq.${user.id}`)
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    if (matchError) throw matchError;

    if (matchRow) {
      const partnerId = matchRow.user_a === user.id ? matchRow.user_b : matchRow.user_a;
      const { data: partner } = await supabase
        .from('users')
        .select('name, age, city, goal, interests, bio, photo_url')
        .eq('id', partnerId)
        .maybeSingle();
      const { data: partnerProfile } = await supabase
        .from('profiles')
        .select('traits_json')
        .eq('user_id', partnerId)
        .maybeSingle();
      if (partner) {
        // Public card only — no Telegram identity is exposed here (Sixtio's privacy promise).
        match = {
          reason: matchRow.reason,
          score: matchRow.score,
          partner: {
            name: (partner.name || '').split(' ')[0] || 'Хтось особливий',
            age: partner.age,
            city: partner.city,
            goal: partner.goal,
            interests: partner.interests || [],
            bio: partner.bio,
            photoUrl: partner.photo_url,
            traits: (partnerProfile && partnerProfile.traits_json) || [],
          },
        };
      }
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
        ? { traits: profile.traits_json || [], summary: profile.summary_text || '' }
        : null,
      match,
    });
  } catch (e) {
    console.error('api/me failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
