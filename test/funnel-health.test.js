// Funnel health thresholds (2026-08-29).
//
// This monitor exists because 25 of 40 users sat without a Big Five vector for
// a month and nothing threw. But a monitor is only worth having if it stays
// quiet when things are fine — an alarm that cries wolf gets muted, and then
// the real one is missed too. So both directions are pinned here, against the
// actual production numbers that motivated it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { problemsIn, formatFunnelHealth } from '../api/_lib/funnelhealth.js';

// Production, 2026-08-29. Twin loss 2% (fine), Big Five loss 63% (the defect).
const REAL = {
  users: 66, questionnaire: 66, interviewDone: 41,
  twins: 40, bigFive: 15, photos: 25,
  matches: 23, messages: 35, active24h: 3, active7d: 25, new7d: 21,
};

test('it catches the bug it was built for', () => {
  const p = problemsIn(REAL);
  assert.equal(p.length, 1);
  assert.match(p[0], /25\/40 have a Twin but NO Big Five/);
});

test('and it does NOT flag the healthy step next to it', () => {
  // 40 of 41 is a 2% loss. The first version of this compared Twins against
  // everyone who filled the questionnaire (66) instead of everyone who
  // finished the interview (41) — a wrong denominator turned 2% into 39% and
  // would have fired a false alarm beside the true one.
  assert.equal(problemsIn(REAL).some((s) => /Digital Twin/.test(s)), false);
});

test('a healthy funnel is completely silent', () => {
  assert.deepEqual(problemsIn({ interviewDone: 100, twins: 98, bigFive: 95 }), []);
});

test('a tiny cohort never alarms, however bad the ratio', () => {
  // 0 of 3 is 100% loss and means nothing on day one. Alerting there is how a
  // monitor gets muted before it is ever useful.
  assert.deepEqual(problemsIn({ interviewDone: 3, twins: 0, bigFive: 0 }), []);
  assert.deepEqual(problemsIn({ interviewDone: 9, twins: 9, bigFive: 0 }), []);
});

test('a real collapse in a real cohort does alarm', () => {
  const p = problemsIn({ interviewDone: 50, twins: 10, bigFive: 10 });
  assert.equal(p.length, 1);
  assert.match(p[0], /40\/50 finished the interview but have NO Digital Twin/);
});

test('photos are never a "problem" — that is a choice, not a fault', () => {
  // Only server-owned steps are checked. Flagging a personal decision would
  // train everyone to ignore this list.
  const p = problemsIn({ ...REAL, bigFive: 40, photos: 0 });
  assert.deepEqual(p, []);
});

test('zero users cannot divide by zero or invent a problem', () => {
  assert.deepEqual(problemsIn({ interviewDone: 0, twins: 0, bigFive: 0 }), []);
  assert.doesNotThrow(() => formatFunnelHealth({
    users: 0, questionnaire: 0, interviewDone: 0, twins: 0, bigFive: 0, photos: 0,
    matches: 0, messages: 0, active24h: 0, active7d: 0, new7d: 0, problems: [],
  }));
});

test('the rendered block states the numbers and the warning', () => {
  const out = formatFunnelHealth({ ...REAL, problems: problemsIn(REAL) });
  assert.match(out, /big five %\s+15 \/ 40\s+38%/);
  assert.match(out, /digital twin\s+40 \/ 41\s+98%/);
  assert.match(out, /! 25\/40 have a Twin but NO Big Five/);
});

test('a missing reading renders as unavailable, not as zeros', () => {
  // Reporting "0 users" when the query failed would look like the app died.
  assert.equal(formatFunnelHealth(null), 'funnel health unavailable');
});
