import { resolveUser } from './_lib/telegram.js';
import { getSupabase, upsertUser } from './_lib/supabase.js';
import { generateFollowup as geminiFollowup } from './_lib/gemini.js';
import { generateFollowup as claudeFollowup } from './_lib/claude.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { initData, questionId, questionText, answerText, isFollowup, gender } = req.body || {};
    if (!questionId || !answerText) {
      return res.status(400).json({ error: 'questionId and answerText are required' });
    }

    const tgUser = resolveUser(initData);
    if (!tgUser) {
      return res.status(401).json({ error: 'Invalid Telegram initData' });
    }

    const userId = await upsertUser(tgUser);
    const { error } = await getSupabase()
      .from('answers')
      .insert({ user_id: userId, question_id: String(questionId), answer_text: String(answerText) });
    if (error) throw error;

    // Follow-up answers don't get their own follow-up — keep the dialog moving.
    if (isFollowup) {
      return res.status(200).json({ ok: true, followup: null });
    }

    // Gemini first (free/cheap tier); Claude as fallback if Gemini is down or unconfigured.
    const safeGender = ['male', 'female'].includes(gender) ? gender : null;
    let followup = null;
    try {
      followup = await geminiFollowup(questionText || '', answerText, safeGender);
    } catch (geminiError) {
      console.error('Gemini followup failed:', geminiError.message);
      try {
        followup = await claudeFollowup(questionText || '', answerText, safeGender);
      } catch (claudeError) {
        // AI failure must not block onboarding — the client just moves on.
        console.error('Claude fallback followup failed:', claudeError.message);
      }
    }
    return res.status(200).json({ ok: true, followup });
  } catch (e) {
    console.error('api/answer failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
