import { resolveUser, getStartParam, pickLang } from './_lib/telegram.js';
import { getSupabase, upsertUser } from './_lib/supabase.js';
import { captureReferral } from './_lib/referrals.js';
import { generateFollowup } from './_lib/claude.js';
import { rateLimit, LIMITS, sendRateLimited } from './_lib/ratelimit.js';
import { isDeepQuestion, syncProfileDepth } from './_lib/depth.js';
import { worthFollowingUp } from './_lib/questions.js';
import { bookAiCall } from './_lib/aibudget.js';
import { alertThrottled, escapeAlert } from './_lib/alerts.js';

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { initData, questionId, questionText, answerText, isFollowup, skipFollowup, gender, lang: clientLang } = req.body || {};
    if (!questionId || !answerText) {
      return res.status(400).json({ error: 'questionId and answerText are required' });
    }

    const tgUser = resolveUser(initData);
    if (!tgUser) {
      return res.status(401).json({ error: 'Invalid Telegram initData' });
    }

    const rl = rateLimit(`answer:${tgUser.id}`, LIMITS.answer);
    if (!rl.allowed) return sendRateLimited(res, rl.retryAfterSec);

    const userId = await upsertUser(tgUser);

    // Attribute the referral on the very first onboarding answer (once only).
    // Never let a referral hiccup block saving the answer.
    try {
      await captureReferral(userId, getStartParam(initData));
    } catch (refError) {
      console.error('captureReferral failed:', refError.message);
    }

    const supabase = getSupabase();
    const { error } = await supabase
      .from('answers')
      .insert({ user_id: userId, question_id: String(questionId), answer_text: String(answerText) });
    if (error) throw error;

    // A deepen-mode answer is the one thing that moves the profile-depth meter,
    // and this is the ONLY endpoint those answers pass through. It used to move
    // nothing at all, so the ring stayed at 40 however many deepen sessions a
    // user completed. Derived from the distinct questions on record, so answering
    // the same one again is correctly worth nothing. Best-effort: the answer is
    // already saved and a meter is not worth failing the request over.
    let depth = null;
    if (isDeepQuestion(questionId)) {
      try {
        const { data: row } = await supabase
          .from('users').select('profile_depth').eq('id', userId).maybeSingle();
        depth = await syncProfileDepth(supabase, userId, row && row.profile_depth);
      } catch (depthError) {
        console.error('profile depth sync failed:', depthError.message);
      }
    }
    const depthFields = depth
      ? { profileDepth: depth.depth, bonusAwarded: depth.bonusAwarded, starsBalance: depth.starsBalance }
      : {};

    // Follow-up answers don't get their own follow-up — keep the dialog moving.
    // skipFollowup: deepen mode saves AI budget by not generating follow-ups at all.
    if (isFollowup || skipFollowup) {
      return res.status(200).json({ ok: true, followup: null, ...depthFields });
    }

    // A follow-up on a throwaway answer is worth nothing to anyone: there is no
    // motive to go deeper into, the model produces a generic probe, and it costs
    // a paid call. Since 2026-08-05 every call is billed, so the cheapest call is
    // the one not made — and skipping here also RAISES quality, because a
    // hollow follow-up is worse than moving on.
    //
    // The bar is deliberately low. This filters "ок", "не знаю", "нормально" —
    // not shy answers. Someone who wrote a real sentence still gets asked.
    if (!worthFollowingUp(answerText)) {
      return res.status(200).json({ ok: true, followup: null, ...depthFields });
    }

    // The daily ceiling (F-13). A skipped follow-up is invisible to the user —
    // the dialog simply moves on — which makes this the safest place in the app
    // to absorb a cap, and the reason it is checked here rather than deeper down.
    const budget = await bookAiCall(userId);
    if (!budget.allowed) {
      console.warn(`followup skipped: daily AI cap reached for user ${userId}`);
      return res.status(200).json({ ok: true, followup: null, ...depthFields });
    }

    // One provider, not two. The follow-up carries the user's own words about
    // their inner life, so it goes to Anthropic like every other psychological
    // call (PRIV-1, option B) — the Gemini-first path was removed 2026-08-05.
    // The question comes back in the user's native Telegram language (Task 26).
    const safeGender = ['male', 'female'].includes(gender) ? gender : null;
    const lang = pickLang(clientLang, tgUser);
    let followup = null;
    try {
      followup = await generateFollowup(questionText || '', answerText, safeGender, lang);
    } catch (followupError) {
      // The question is SKIPPED, never blocked: the client treats a null
      // follow-up as "move on", so onboarding always completes. The answer
      // itself is already saved above — this is the enrichment, not the data.
      console.error('followup failed:', followupError.message);
      alertThrottled(
        'followup-failed',
        '⚠️ <b>Onboarding follow-ups are failing</b>\n' +
        'Questions are being skipped; onboarding still completes, but interviews ' +
        'are shallower than designed.' +
        `\n<pre>${escapeAlert(followupError.message)}</pre>`
      );
    }
    return res.status(200).json({ ok: true, followup, ...depthFields });
  } catch (e) {
    console.error('api/answer failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
