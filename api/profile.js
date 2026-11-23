import { resolveUser, getStartParam, pickLang } from './_lib/telegram.js';
import { getSupabase, upsertUser } from './_lib/supabase.js';
import { buildTwin } from './_lib/twin.js';
import { runMatching } from './_lib/matching.js';
import { captureReferral } from './_lib/referrals.js';
import { applySourceOnRegistration } from './_lib/sources.js';
import { rateLimit, LIMITS, sendRateLimited } from './_lib/ratelimit.js';
import { track, EVENTS } from './_lib/events.js';
import { captureError } from './_lib/sentry.js';

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

    // This handler does two AI calls back to back — the Digital Twin, then the
    // matchmaker — inside vercel.json's maxDuration: 30. Measured 2026-08-29:
    // that budget was blown, repeatedly ("matching failed: Request timed out"
    // x5, plus hard "Task timed out after 30 seconds" kills). A hard kill is
    // the worst outcome available: no catch runs, no response reaches the
    // client, and the user's finished onboarding ends in a spinner — even
    // though their Twin was already saved.
    const startedAt = Date.now();
    const supabase = getSupabase();
    const userId = await upsertUser(tgUser);

    const { data: userRow } = await supabase
      .from('users')
      .select('gender')
      .eq('id', userId)
      .maybeSingle();

    // Digital Twin traits/vibe/summary in the user's native language (Task 26).
    // Built by the same function server-side recovery uses (_lib/twin.js), so
    // a Twin made live and a Twin made after an outage cannot differ.
    const lang = pickLang(clientLang, tgUser);
    const profile = await buildTwin(supabase, userId, {
      gender: userRow ? userRow.gender : null, lang,
    });
    if (!profile) {
      return res.status(400).json({ error: 'No answers to analyze' });
    }

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

    // Instant matchmaking: try to pair this user right after their profile is
    // ready. Never let matching (or its bot notifications) fail the response —
    // and never let it run us into the function's own deadline.
    //
    // MATCH_BUDGET_MS is what is left over. The matchmaker's own AI call is
    // capped at AI_TIMEOUT_MS (20s), so starting it with less than that on the
    // clock is choosing a hard kill over a skipped pairing. A skipped pairing
    // costs nothing: the user gets their Twin, and matching happens on their
    // next open or on the daily cron. A kill costs the whole response.
    const MATCH_BUDGET_MS = 21_000;
    const elapsed = Date.now() - startedAt;
    if (elapsed > MATCH_BUDGET_MS) {
      console.warn(`matching skipped: profile took ${elapsed}ms, no room inside maxDuration`);
    } else {
      try {
        await runMatching(userId, lang);
      } catch (matchError) {
        console.error('matching failed:', matchError.message);
      }
    }

    return res.status(200).json(profile);
  } catch (e) {
    console.error('api/profile failed:', e);
    captureError(e, { route: 'api/profile' });
    return res.status(500).json({ error: 'Internal error' });
  }
}
