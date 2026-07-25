import test from 'node:test';
import assert from 'node:assert/strict';
import {
  depthFor, isDeepQuestion, nextDeepQuestions,
  BASE_PROFILE_DEPTH, DEEP_QUESTION_IDS, DEEP_STEPS_TO_FULL,
} from '../api/_lib/depth.js';

test('an untouched profile sits at the base, three deep answers fill it', () => {
  assert.equal(depthFor(0), BASE_PROFILE_DEPTH);
  assert.equal(depthFor(1), 60);
  assert.equal(depthFor(2), 80);
  assert.equal(depthFor(DEEP_STEPS_TO_FULL), 100);
});

test('answering more than it takes cannot push past 100', () => {
  // The pool is deliberately larger than the number of steps to full, so a user
  // who answers all five must land on exactly 100, not 140.
  assert.equal(depthFor(DEEP_QUESTION_IDS.length), 100);
  assert.equal(depthFor(99), 100);
});

test('nonsense counts do not produce nonsense depth', () => {
  assert.equal(depthFor(-3), BASE_PROFILE_DEPTH);
  assert.equal(depthFor(null), BASE_PROFILE_DEPTH);
  assert.equal(depthFor(undefined), BASE_PROFILE_DEPTH);
});

test('only real deep questions count towards depth', () => {
  for (const id of DEEP_QUESTION_IDS) assert.ok(isDeepQuestion(id), id);
  assert.ok(isDeepQuestion('extra_deep_0'));
  assert.ok(isDeepQuestion('extra_deep_12'));
});

test('the onboarding interview and follow-ups are not extra depth', () => {
  // q1–q5 are what the base 40% already pays for; a follow-up elaborates on a
  // question that has already been counted once.
  for (const id of ['q1', 'q2', 'q5', 'q7']) assert.equal(isDeepQuestion(id), false, id);
  assert.equal(isDeepQuestion('d1_f'), false);
  assert.equal(isDeepQuestion('d9'), false);
  assert.equal(isDeepQuestion(''), false);
  assert.equal(isDeepQuestion(null), false);
});

test('unanswered questions are offered before ones already answered', () => {
  const next = nextDeepQuestions(['d1', 'd2'], 3);
  assert.deepEqual(next.slice(0, 3), ['d3', 'd4', 'd5']);
});

test('a session never repeats a question inside itself', () => {
  const next = nextDeepQuestions([], DEEP_QUESTION_IDS.length);
  assert.equal(new Set(next).size, next.length);
});

test('when everything is answered there is nothing fresh left to offer', () => {
  // The signal the deepen screen needs: answering these again earns no depth, so
  // it says the profile is complete instead of handing out unpaid work.
  const answered = DEEP_QUESTION_IDS;
  const fresh = nextDeepQuestions(answered, 3).filter((id) => !answered.includes(id));
  assert.deepEqual(fresh, []);
});
