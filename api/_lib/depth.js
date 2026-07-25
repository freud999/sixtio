// Profile depth — the completeness meter on the profile screen.
//
// It used to be a counter: base 40, +20 whenever a client said an extra question
// had been answered. Two things went wrong with that.
//
// First, the only path that ever incremented it was an inline widget on the
// profile screen that is never shown. The path users actually take — the depth
// row → onboarding.html?mode=deepen — saves its answers through /api/answer and
// bumped nothing, so the ring sat at 40 forever no matter how many sessions they
// completed. Second, a counter cannot tell a new answer from the same question
// answered again, and deepen mode drew 3 questions at random from a pool of 5, so
// the same ones came back and would have inflated the meter for no new material.
//
// So depth is DERIVED instead: it is a function of which distinct deep questions
// this user has on record. That makes it idempotent — answering the same question
// twice changes nothing, answering a new one moves the ring — and it makes the
// meter self-correcting, because it is recomputed from the answers themselves
// rather than remembered from whatever the increments happened to add up to.

// Everything the profile screen shows before any deep question is answered:
// gender, goal, age, city, interests, values, bio, photo, the interview.
export const BASE_PROFILE_DEPTH = 40;
export const DEEP_STEP = 20;
// Three answers take 40 → 100. The pool is larger than this on purpose, so a
// user who comes back is asked something new rather than the same three again.
export const DEEP_STEPS_TO_FULL = 3;
export const DEEP_QUESTION_IDS = ['d1', 'd2', 'd3', 'd4', 'd5'];

// `d1`–`d5` are the deepen-mode pool (api/_lib/questions.js); `extra_deep_N` is
// the inline widget's id scheme. Follow-ups (`..._f`) are elaborations on a
// question already counted, so they are deliberately not their own step.
const DEEP_ID = /^(?:d[1-5]|extra_deep_\d+)$/;

export function isDeepQuestion(id) {
  return DEEP_ID.test(String(id == null ? '' : id).trim());
}

/** Depth for a number of distinct deep answers. Pure. */
export function depthFor(answeredCount) {
  const steps = Math.min(DEEP_STEPS_TO_FULL, Math.max(0, Number(answeredCount) || 0));
  return Math.min(100, BASE_PROFILE_DEPTH + steps * DEEP_STEP);
}

/** The deepen pool ordered so unanswered questions come first. Pure. */
export function nextDeepQuestions(answeredIds, count) {
  const seen = new Set(answeredIds || []);
  const fresh = DEEP_QUESTION_IDS.filter((id) => !seen.has(id));
  const rest = DEEP_QUESTION_IDS.filter((id) => seen.has(id));
  return fresh.concat(rest).slice(0, count);
}

/**
 * Which distinct deep questions a user has answered.
 * Returns { answered: string[], depth } — depth is what the meter SHOULD read.
 */
export async function deepAnswerState(supabase, userId) {
  const { data, error } = await supabase
    .from('answers')
    .select('question_id')
    .eq('user_id', userId);
  if (error) throw error;

  const answered = [];
  const seen = new Set();
  for (const row of data || []) {
    const id = String(row.question_id || '').trim();
    if (!isDeepQuestion(id) || seen.has(id)) continue;
    seen.add(id);
    answered.push(id);
  }
  return { answered, depth: depthFor(answered.length) };
}

/**
 * Brings users.profile_depth in line with the answers on record, and pays the
 * one-time completion bonus if this is the moment it reached 100.
 *
 * Idempotent: it writes only when the stored value actually disagrees, and the
 * bonus goes through the same atomic RPC as before, which is DB-guaranteed to pay
 * at most once per user however many times this runs.
 *
 * Returns { depth, answered, bonusAwarded, starsBalance } — starsBalance is null
 * when no bonus was paid and the caller should keep whatever it already had.
 */
export async function syncProfileDepth(supabase, userId, storedDepth) {
  const { answered, depth } = await deepAnswerState(supabase, userId);
  const current = typeof storedDepth === 'number' ? storedDepth : BASE_PROFILE_DEPTH;

  // Never walk the meter BACKWARDS. Answers can be pruned and older accounts may
  // have been credited depth through paths that predate this derivation; taking
  // progress away from someone who did the work would be the worse error.
  if (depth <= current) return { depth: current, answered, bonusAwarded: false, starsBalance: null };

  const { error } = await supabase
    .from('users').update({ profile_depth: depth }).eq('id', userId);
  if (error) throw error;

  let starsBalance = null;
  let bonusAwarded = false;
  if (depth === 100 && current < 100) {
    // Atomic and idempotent (migration 019): the RPC owns the amount and cannot
    // pay twice, so a user who crossed 100 before this code existed is credited
    // exactly once and never again.
    const { data, error: bonusErr } = await supabase.rpc(
      'credit_profile_completion_bonus', { user_id_param: userId }
    );
    if (bonusErr) throw bonusErr;
    if (typeof data === 'number') { starsBalance = data; bonusAwarded = true; }
  }

  return { depth, answered, bonusAwarded, starsBalance };
}
