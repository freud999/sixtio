// Funnel health — the counters that find breakage nobody threw an error about.
//
// WHY THIS EXISTS, precisely. On 2026-08-29, 40 users had a Digital Twin and
// only 15 had a Big Five vector: two thirds of the userbase with no
// compatibility percentage, the one number the product is sold on. It had been
// that way for a month.
//
// Nothing had failed. No exception, no 500, no alert. The request that computes
// the traits was simply CANCELLED by a page navigation, and a cancelled request
// is not an error anywhere — not in the logs, not in Vercel's error groups, and
// not in an error reporter either. Sentry would not have caught it.
//
// What caught it was one question asked of the data: "how many people who have
// a Twin also have traits?" So that question now gets asked automatically.
//
// THE RULE: MONITOR THE OUTCOME, NOT ONLY THE ERROR. A step that silently does
// not happen produces no error to catch, and those are the failures that
// survive for a month.
//
// The counting lives in SQL (migration 043) because the first version of this
// counted in JavaScript and got the DENOMINATOR wrong — comparing Twins against
// everyone who filled the questionnaire (66) instead of everyone who finished
// the interview (41), which turned a healthy 2% loss into an alarming 39%. A
// monitor that cries wolf is worse than none.
import { getSupabase } from './supabase.js';

/**
 * The whole funnel in one round trip, or null if it cannot be read.
 * Never throws: this feeds a dashboard and an alert, and neither is worth
 * failing a request or a cron tick over.
 */
export async function funnelHealth() {
  try {
    const { data, error } = await getSupabase().rpc('funnel_health');
    if (error) throw new Error(error.message);
    const row = Array.isArray(data) ? data[0] : data;
    if (!row) return null;
    const h = {
      users: Number(row.users || 0),
      questionnaire: Number(row.questionnaire || 0),
      interviewDone: Number(row.interview_done || 0),
      twins: Number(row.twins || 0),
      bigFive: Number(row.big_five || 0),
      photos: Number(row.photos || 0),
      matches: Number(row.matches || 0),
      messages: Number(row.messages || 0),
      active24h: Number(row.active_24h || 0),
      active7d: Number(row.active_7d || 0),
      new7d: Number(row.new_7d || 0),
    };
    h.problems = problemsIn(h);
    return h;
  } catch (e) {
    console.error('funnel health unavailable:', e.message);
    return null;
  }
}

// A stage is broken when a LOT of people reach it and then do not pass it.
// Both halves matter: a ratio alone screams on day one (0 of 1), and a count
// alone never notices a 90% loss in a small cohort.
//
// Measured against production on 2026-08-29, these thresholds separate the two
// cases correctly: Twin loss 2% (healthy, silent) vs Big Five loss 63% (the
// real defect, alerts).
const MIN_COHORT = 10;
const MAX_LOSS = 0.4;

/**
 * Human-readable problems, empty when healthy.
 *
 * Only stages the SERVER owns are checked. Someone choosing not to upload a
 * photo is a product outcome, not a fault, and alerting on it would teach
 * everyone to ignore this list — which is how the useful alarm gets missed.
 */
export function problemsIn(h) {
  const out = [];
  const lost = (from, to) => (from > 0 ? 1 - to / from : 0);

  // Finished the interview but no Twin: /api/profile never completed for them.
  if (h.interviewDone >= MIN_COHORT && lost(h.interviewDone, h.twins) > MAX_LOSS) {
    out.push(`${h.interviewDone - h.twins}/${h.interviewDone} finished the interview but have NO Digital Twin`);
  }
  // Twin but no Big Five: exactly the 2026-08-29 bug. An automatic step, so a
  // large loss here is a defect and never a user's decision.
  if (h.twins >= MIN_COHORT && lost(h.twins, h.bigFive) > MAX_LOSS) {
    out.push(`${h.twins - h.bigFive}/${h.twins} have a Twin but NO Big Five — no compatibility %`);
  }
  return out;
}

/** Plain-text block for /stats and the cron alert. */
export function formatFunnelHealth(h) {
  if (!h) return 'funnel health unavailable';
  const line = (label, part, whole) => {
    const p = whole > 0 ? Math.round((part / whole) * 100) : 0;
    return `${label.padEnd(15)}${String(part).padStart(4)} / ${String(whole).padEnd(4)} ${p}%`;
  };
  return [
    line('registered', h.users, h.users),
    line('questionnaire', h.questionnaire, h.users),
    line('interview', h.interviewDone, h.questionnaire),
    line('digital twin', h.twins, h.interviewDone),
    line('big five %', h.bigFive, h.twins),
    line('photo', h.photos, h.users),
    '',
    `matches ${h.matches} · messages ${h.messages}`,
    `active 24h ${h.active24h} · 7d ${h.active7d} · new 7d ${h.new7d}`,
    ...(h.problems && h.problems.length ? ['', '! ' + h.problems.join('\n! ')] : []),
  ].join('\n');
}
