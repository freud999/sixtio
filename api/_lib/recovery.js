// Recovery after an AI outage: build what was skipped, check what slipped through.
//
// From 2026-10-06 20:01 to 2026-11-23 the Anthropic balance was empty. During
// those 47 days 38 people finished the whole interview and got no Digital Twin,
// and 17 photos were stored without the 18+ check (PHOTO_MODERATION_FAIL_OPEN
// was on). The client repairs a user who comes back — but only 10 of the 46 who
// arrived in that window ever did. So recovery runs on the server, for people
// who are not present.
//
// ONE PHASE PER CALL, ON PURPOSE. Each phase is a single round of AI calls run in
// parallel, so a call costs one AI round trip (≤ AI_TIMEOUT_MS, 20s) and always
// fits inside vercel.json's maxDuration: 30. Doing twins, then traits, then
// photos in one call would mean three round trips back to back — the exact
// pattern that got /api/profile killed at 30s in August. The owner's /recover
// command and the daily cron simply call this again; each call picks up where
// the last one stopped, because every phase is driven by what is still missing
// in the database rather than by a cursor that could get lost.
//
// ORDER MATTERS: photos, then Twin, then Big Five.
//   • Photos first, because they are already being SHOWN. The swipe deck draws
//     candidates from the users table, not from profiles, so a person with no
//     Twin still appears — with their unchecked photo — on an 18+ product.
//     Safety before completeness.
//   • Twin before Big Five. A Big Five write creates the profiles row. If it
//     landed first and the Twin then failed, the user would have a profile with
//     no Twin text — and every "needs a Twin" check looks for a MISSING row, so
//     they would never be repaired. Twin first means a failure leaves nothing.
import { getSupabase } from './supabase.js';
import { resolveLang } from './telegram.js';
import { buildTwin, interviewText } from './twin.js';
import { processOnboardingPersonality } from './personality.js';
import { moderatePhoto } from './claude.js';
import { photoKey } from './photos.js';
import { track, EVENTS } from './events.js';

// Parallel AI calls per phase. High enough that 38 Twins take a handful of
// /recover taps rather than forty; low enough not to trip Anthropic's
// per-minute token limits with a burst of long Sonnet generations.
const DEFAULT_CONCURRENCY = 8;

const errMsg = (e) => String((e && e.message) || e).slice(0, 160);

/**
 * Will retrying this moderation call ever give a different answer? A refusal, an
 * unparseable verdict or a 400 about the image itself will not. A timeout, a
 * 429/5xx, an empty balance or a network error will — those must stay retryable,
 * or one bad minute at Anthropic would hide every honest photo in the batch.
 */
export function isPermanentModerationError(e) {
  const status = e && (e.status || e.statusCode);
  const msg = errMsg(e);
  if (/credit balance|rate.?limit|overloaded|timeout|timed out|abort|ECONN|fetch failed|disabled/i.test(msg)) return false;
  if (status === 400) return true;
  return /refused|no JSON|unbalanced JSON|unexpected shape|image|media.?type/i.test(msg);
}

// A phase that made no progress and finished this fast leaves room in the 30s
// budget for the next phase in the same call. A stuck item must not stall
// everything queued behind it.
const FALLTHROUGH_MS = 8_000;
const progressed = (r) => r && (r.done > 0 || (r.rejected && r.rejected.length > 0));

/** Run fn over items, all at once, collecting outcomes instead of throwing. */
async function settle(items, fn) {
  const results = await Promise.allSettled(items.map(fn));
  return results.map((r, i) => ({
    item: items[i],
    ok: r.status === 'fulfilled',
    value: r.status === 'fulfilled' ? r.value : null,
    error: r.status === 'rejected' ? errMsg(r.reason) : null,
  }));
}

async function phaseTwins(supabase, limit) {
  const { data, error } = await supabase.rpc('users_needing_twin', { p_limit: limit });
  if (error) throw new Error(error.message);
  const users = data || [];
  if (!users.length) return null;

  const out = await settle(users, async (u) => {
    const lang = resolveLang({ language_code: u.language_code });
    const profile = await buildTwin(supabase, u.user_id, { gender: u.gender || null, lang });
    if (!profile) return 'no_answers';
    // The Twin existing IS the definition of "onboarded" (api/profile.js), so a
    // recovered user is counted in the funnel exactly like a live one.
    await track(u.user_id, EVENTS.ONBOARDING_COMPLETE);
    return 'built';
  });
  return {
    phase: 'twins',
    done: out.filter((r) => r.ok && r.value === 'built').length,
    failed: out.filter((r) => !r.ok),
  };
}

async function phaseTraits(supabase, limit) {
  const { data, error } = await supabase
    .from('profiles')
    .select('user_id')
    .is('trait_extraversion', null)
    .limit(limit);
  if (error) throw new Error(error.message);
  const rows = data || [];
  if (!rows.length) return null;

  const out = await settle(rows, async (r) => {
    const text = await interviewText(supabase, r.user_id);
    if (!text) return 'no_answers';
    await processOnboardingPersonality(r.user_id, text);
    return 'built';
  });
  return {
    phase: 'big_five',
    done: out.filter((x) => x.ok && x.value === 'built').length,
    failed: out.filter((x) => !x.ok),
  };
}

async function phasePhotos(supabase, limit) {
  const { data, error } = await supabase
    .from('users')
    .select('id, telegram_id')
    .not('photo_url', 'is', null)
    .is('photo_checked_at', null)
    .limit(limit);
  if (error) throw new Error(error.message);
  const users = data || [];
  if (!users.length) return null;

  const rejected = [];
  const out = await settle(users, async (u) => {
    const now = new Date().toISOString();
    const { data: blob, error: dlErr } = await supabase.storage.from('photos').download(photoKey(u.id));
    if (dlErr) {
      // A row pointing at a file that no longer exists would fail here on every
      // call FOREVER — and since photos run first, it would block every Twin
      // behind it. There is nothing to serve, so the row is corrected to say so.
      if (/not.?found|404/i.test(String(dlErr.message || dlErr.statusCode || ''))) {
        await supabase.from('users')
          .update({ photo_url: null, photo_blur_url: null, photo_checked_at: now })
          .eq('id', u.id);
        return 'missing';
      }
      throw new Error(`download: ${dlErr.message}`);
    }
    const base64 = Buffer.from(await blob.arrayBuffer()).toString('base64');
    let verdict;
    try {
      verdict = await moderatePhoto(base64);
    } catch (e) {
      // A photo the checker can NEVER judge (refused, malformed, not really a
      // JPEG) failed on every /recover forever — and, photos running first, it
      // held all 38 Twins behind it (2026-11-23). It is treated exactly as a live
      // upload is with fail-open off: unverified means not shown. Files are kept.
      if (!isPermanentModerationError(e)) throw e;
      const { error: upErr } = await supabase.from('users')
        .update({ photo_url: null, photo_blur_url: null, photo_checked_at: now })
        .eq('id', u.id);
      if (upErr) throw new Error(upErr.message);
      rejected.push({ id: u.id, reason: `unverifiable: ${errMsg(e).slice(0, 60)}` });
      return 'rejected';
    }

    if (verdict.nsfw) {
      // Stop SERVING it, do not destroy it. Clearing the two columns removes the
      // photo from every screen at once (they are what every serving path keys
      // on), while the stored objects stay put so a wrong verdict can be undone
      // by hand. Deleting user files is not a call a batch job gets to make.
      const { error: upErr } = await supabase.from('users')
        .update({ photo_url: null, photo_blur_url: null, photo_checked_at: now })
        .eq('id', u.id);
      if (upErr) throw new Error(upErr.message);
      rejected.push({ id: u.id, reason: verdict.reason || '' });
      return 'rejected';
    }

    const { error: upErr } = await supabase.from('users')
      .update({ photo_checked_at: now }).eq('id', u.id);
    if (upErr) throw new Error(upErr.message);
    return 'passed';
  });
  return {
    phase: 'photos',
    done: out.filter((x) => x.ok && x.value === 'passed').length,
    rejected,
    failed: out.filter((x) => !x.ok),
  };
}

/** What is still left, so every report can say "N to go". */
export async function recoveryBacklog(supabase = getSupabase()) {
  const [twins, traits, photos] = await Promise.all([
    supabase.rpc('users_needing_twin', { p_limit: 10000 })
      .then(({ data }) => (data || []).length, () => null),
    supabase.from('profiles').select('user_id', { count: 'exact', head: true })
      .is('trait_extraversion', null)
      .then(({ count }) => count || 0, () => null),
    supabase.from('users').select('id', { count: 'exact', head: true })
      .not('photo_url', 'is', null).is('photo_checked_at', null)
      .then(({ count }) => count || 0, () => null),
  ]);
  return { twins, traits, photos };
}

/**
 * Runs the first phase that still has work, once.
 * @returns {Promise<null | {phase, done, failed:[], rejected?:[]}>} null = nothing left
 */
export async function recoverStep({ concurrency = DEFAULT_CONCURRENCY, supabase = getSupabase() } = {}) {
  const phases = [phasePhotos, phaseTwins, phaseTraits];
  let stalled = null;
  for (const phase of phases) {
    const t0 = Date.now();
    const r = await phase(supabase, concurrency);
    if (!r) continue;                       // nothing to do here
    if (progressed(r)) return r;
    // Work existed but none of it moved. Report it, and if time allows, let the
    // next phase run rather than spend every call on the same stuck item.
    stalled = stalled || r;
    if (Date.now() - t0 > FALLTHROUGH_MS) return stalled;
  }
  return stalled;
}
