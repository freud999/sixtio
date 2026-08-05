// F-13: the follow-up gate and the per-user daily AI ceiling.
//
// Since every AI call became billed (PRIV-1, 2026-08-05), two things that were
// merely wasteful became expensive: follow-ups to non-answers, and a user free
// to trigger unlimited calls by redoing onboarding in a loop.
import test from 'node:test';
import assert from 'node:assert/strict';
import { worthFollowingUp } from '../api/_lib/questions.js';
import { dailyCap } from '../api/_lib/aibudget.js';

test('throwaway answers do not earn a paid follow-up', () => {
  for (const junk of ['ок', 'ok', 'не знаю', 'хз', 'нормально', 'норм', 'да', '...', '   ', '']) {
    assert.equal(worthFollowingUp(junk), false, `should skip: ${JSON.stringify(junk)}`);
  }
});

test('a SHORT but real answer still gets one — this is the expensive mistake to avoid', () => {
  // The whole risk of this optimisation is silencing someone who said something
  // that matters in few words. Depth is the product; a fraction of a cent is not.
  const real = [
    'Коли я втратив батька',
    'Когда я перестал бояться',
    'When my daughter was born',
    'Мені було страшно, але я лишився',
  ];
  for (const answer of real) {
    assert.equal(worthFollowingUp(answer), true, `should ask: ${answer}`);
  }
});

test('a long answer always qualifies, punctuation and all', () => {
  assert.equal(
    worthFollowingUp('Ну, це було минулого літа... я поїхав сам, і раптом зрозумів!'),
    true
  );
});

test('the daily cap is generous enough that normal use never meets it', () => {
  // A full onboarding is ~8 calls. A cap anywhere near that would break the
  // product to save pennies — the ceiling exists for runaway loops, not users.
  assert.ok(dailyCap() >= 20, 'a normal user redoing onboarding must stay under it');
});

test('AI_DAILY_CAP_PER_USER overrides the default', () => {
  const saved = process.env.AI_DAILY_CAP_PER_USER;
  try {
    process.env.AI_DAILY_CAP_PER_USER = '5';
    assert.equal(dailyCap(), 5);
    process.env.AI_DAILY_CAP_PER_USER = 'nonsense';
    assert.ok(dailyCap() >= 20, 'a malformed value falls back to the safe default');
  } finally {
    if (saved === undefined) delete process.env.AI_DAILY_CAP_PER_USER;
    else process.env.AI_DAILY_CAP_PER_USER = saved;
  }
});
