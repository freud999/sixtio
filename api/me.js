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
      .select('id, name')
      .eq('telegram_id', tgUser.id)
      .maybeSingle();
    if (error) throw error;
    if (!user) {
      return res.status(200).json({ registered: false, profile: null });
    }

    const { data: profile, error: profileError } = await supabase
      .from('profiles')
      .select('traits_json, summary_text')
      .eq('user_id', user.id)
      .maybeSingle();
    if (profileError) throw profileError;

    return res.status(200).json({
      registered: true,
      profile: profile
        ? { traits: profile.traits_json || [], summary: profile.summary_text || '' }
        : null,
    });
  } catch (e) {
    console.error('api/me failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
