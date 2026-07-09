import { resolveUser, getStartParam, pickLang } from './_lib/telegram.js';
import { getSupabase, upsertUser } from './_lib/supabase.js';
import { generateProfile } from './_lib/claude.js';
import { questionLabel } from './_lib/questions.js';
import { runMatching } from './_lib/matching.js';
import { captureReferral, rewardReferrerOnOnboarding } from './_lib/referrals.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { initData, lang: clientLang } = req.body || {};
    const tgUser = resolveUser(initData);
    if (!tgUser) {
      return res.status(401).json({ error: 'Invalid Telegram initData' });
    }

    const supabase = getSupabase();
    const userId = await upsertUser(tgUser);

    const { data: rows, error } = await supabase
      .from('answers')
      .select('question_id, answer_text, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: 'No answers to analyze' });
    }

    const { data: userRow } = await supabase
      .from('users')
      .select('gender')
      .eq('id', userId)
      .maybeSingle();

    const qaLines = rows.map(
      (r) => `Питання: ${questionLabel(r.question_id)}\nВідповідь: ${r.answer_text}\n`
    );
    // Digital Twin traits/vibe/summary in the user's native language (Task 26).
    const lang = pickLang(clientLang, tgUser);
    const profile = await generateProfile(qaLines, userRow ? userRow.gender : null, lang);

    const { error: upsertError } = await supabase.from('profiles').upsert(
      {
        user_id: userId,
        traits_json: profile.traits,
        vibe: profile.vibe || null,
        summary_text: profile.summary,
        portrait_json: profile.portrait || null,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
    if (upsertError) throw upsertError;

    // Onboarding is complete once the Digital Twin exists — credit the referrer
    // (+15 stars, once) now. captureReferral covers the rare case the referral
    // wasn't attributed earlier. Neither may fail the profile response.
    try {
      await captureReferral(userId, getStartParam(initData));
      await rewardReferrerOnOnboarding(userId);
    } catch (refError) {
      console.error('referral reward failed:', refError.message);
    }

    // Instant matchmaking: try to pair this user right after their profile is ready.
    // Never let matching (or its bot notifications) fail the profile response.
    try {
      await runMatching(userId, lang);
    } catch (matchError) {
      console.error('matching failed:', matchError.message);
    }

    return res.status(200).json(profile);
  } catch (e) {
    console.error('api/profile failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
