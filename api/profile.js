import { resolveUser, getStartParam, pickLang } from './_lib/telegram.js';
import { getSupabase, upsertUser } from './_lib/supabase.js';
import { generateProfile } from './_lib/claude.js';
import { questionLabel } from './_lib/questions.js';
import { runMatching } from './_lib/matching.js';
import { captureReferral } from './_lib/referrals.js';
import { applySourceOnRegistration } from './_lib/sources.js';
import { rateLimit, LIMITS, sendRateLimited } from './_lib/ratelimit.js';
import { track, EVENTS } from './_lib/events.js';

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

    const rl = rateLimit(`profile:${tgUser.id}`, LIMITS.ai_heavy);
    if (!rl.allowed) return sendRateLimited(res, rl.retryAfterSec);

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

    // Funnel: the Digital Twin existing IS the definition of "onboarded".
    await track(userId, EVENTS.ONBOARDING_COMPLETE);

    // Onboarding is complete once the Digital Twin exists — attribute the referrer
    // now (covers the rare case it wasn't captured on an earlier step). The +15 ⭐
    // bonus itself is NOT paid here: it is credited only once this invited user
    // proves real (profile depth ≥ 60 plus a D3 return — see _lib/referrals.js).
    // Attribution must never fail the profile response.
    try {
      await captureReferral(userId, getStartParam(initData));
    } catch (refError) {
      console.error('referral capture failed:', refError.message);
    }

    // Acquisition-source attribution (migration 029): copy the pending /start
    // source (or a non-referral ?startapp= param) onto users.source, once, on
    // first registration. Never overwrites; must never fail the profile response.
    try {
      await applySourceOnRegistration(userId, tgUser.id, getStartParam(initData));
    } catch (srcError) {
      console.error('source attribution failed:', srcError.message);
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
