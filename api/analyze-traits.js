import { resolveUser } from './_lib/telegram.js';
import { getSupabase, findUserId } from './_lib/supabase.js';
import { questionLabel } from './_lib/questions.js';
import { processOnboardingPersonality } from './_lib/personality.js';

// Standalone Big Five (OCEAN) extraction — deliberately split out of
// api/profile.js so each call stays well under Vercel Hobby's 10s limit.
//
// Flow: the client finishes api/profile.js (Digital Twin), then fires this in
// the background. One Gemini call scores the five traits + tags and upserts
// them onto public.profiles; matching later reads them via the
// calculate_compatibility SQL RPC.
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
    // Read-only lookup: never re-upsert here, so we don't clobber the name.
    const userId = await findUserId(tgUser.id);
    if (!userId) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Pull the same interview Q&A the Digital Twin was built from.
    const { data: rows, error } = await supabase
      .from('answers')
      .select('question_id, answer_text, created_at')
      .eq('user_id', userId)
      .order('created_at', { ascending: true });
    if (error) throw error;
    if (!rows || rows.length === 0) {
      return res.status(400).json({ error: 'No answers to analyze' });
    }

    const answers = rows
      .map((r) => `Питання: ${questionLabel(r.question_id)}\nВідповідь: ${r.answer_text}\n`)
      .join('');

    // Single Gemini call + upsert of trait_* columns and compatibility_tags.
    const { traits, tags } = await processOnboardingPersonality(userId, answers);

    return res.status(200).json({ ok: true, traits, tags });
  } catch (e) {
    console.error('api/analyze-traits failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
