// The one gender rule (2026-08-12): a woman looking for men sees men only.
//
// Reported from production. The rule itself was fine in the deck — but it was
// written out by hand in TWO places and missing from a THIRD, and the third was
// the "who liked you" screen, where revealing a name costs Stars. This file
// exists so the rule has one definition and one set of expectations.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mutualGenderMatch, wantedGender } from '../api/_lib/gendermatch.js';

const p = (gender, seeking) => ({ gender, seeking_gender: seeking });

test('the reported case: a woman looking for men sees men, and only men', () => {
  const her = p('female', 'male');
  assert.equal(mutualGenderMatch(her, p('male', 'female')), true);
  assert.equal(mutualGenderMatch(her, p('female', 'male')), false);
  assert.equal(mutualGenderMatch(her, p('female', 'female')), false);
  assert.equal(mutualGenderMatch(her, p('female', 'any')), false);
});

test('and the mirror: a man looking for women sees women, and only women', () => {
  const him = p('male', 'female');
  assert.equal(mutualGenderMatch(him, p('female', 'male')), true);
  assert.equal(mutualGenderMatch(him, p('male', 'female')), false);
  assert.equal(mutualGenderMatch(him, p('male', 'any')), false);
});

test("'any' is no longer a wildcard — it means the opposite gender", () => {
  // As a wildcard it leaked same-gender profiles into a straight user's deck,
  // and into their paid likers list. This is the actual behaviour change.
  assert.equal(wantedGender(p('female', 'any')), 'male');
  assert.equal(wantedGender(p('male', 'any')), 'female');
  assert.equal(mutualGenderMatch(p('female', 'any'), p('male', 'any')), true);
  assert.equal(mutualGenderMatch(p('female', 'any'), p('female', 'any')), false);
});

test('an EXPLICIT same-sex preference still works on both sides', () => {
  // Two women who both chose 'female' are each other's stated choice. The fix
  // removes a wildcard, it does not overwrite what someone actually picked.
  assert.equal(mutualGenderMatch(p('female', 'female'), p('female', 'female')), true);
  assert.equal(mutualGenderMatch(p('male', 'male'), p('male', 'male')), true);
});

test('one-sided interest is not a match — the rule is symmetric', () => {
  // She wants men; he wants men. Showing him to her would mean showing her a
  // person who would never be shown her back.
  assert.equal(mutualGenderMatch(p('female', 'male'), p('male', 'male')), false);
  assert.equal(mutualGenderMatch(p('male', 'male'), p('female', 'male')), false);
});

test('the rule is symmetric for every combination, without exception', () => {
  const genders = ['male', 'female'];
  const seekings = ['male', 'female', 'any', null, undefined, 'nonsense'];
  for (const g1 of genders) for (const s1 of seekings)
    for (const g2 of genders) for (const s2 of seekings) {
      const a = p(g1, s1), b = p(g2, s2);
      assert.equal(
        mutualGenderMatch(a, b), mutualGenderMatch(b, a),
        `asymmetric for ${g1}/${s1} vs ${g2}/${s2}`
      );
    }
});

test('an incomplete profile matches NOBODY rather than everybody', () => {
  // Disappearing from the deck is small and self-correcting. Being shown to
  // everyone is not.
  assert.equal(mutualGenderMatch(p(null, 'male'), p('male', 'female')), false);
  assert.equal(mutualGenderMatch(p('female', 'male'), p(null, 'female')), false);
  assert.equal(mutualGenderMatch(null, p('male', 'female')), false);
  assert.equal(mutualGenderMatch(p('male', 'female'), undefined), false);
  assert.equal(wantedGender(p(null, null)), null);
});

test('a missing preference falls back to the opposite of your own gender', () => {
  // Older rows predate the question being asked. Guessing straight is right far
  // more often than showing them everyone.
  assert.equal(wantedGender(p('female', null)), 'male');
  assert.equal(wantedGender(p('male', undefined)), 'female');
  assert.equal(mutualGenderMatch(p('female', null), p('male', null)), true);
  assert.equal(mutualGenderMatch(p('female', null), p('female', null)), false);
});
