// Who may be shown to whom. ONE rule, one file.
//
// It used to be two inline conditions copy-pasted into api/feed.js and
// api/_lib/matching.js — and simply absent from getPendingLikers(), so the
// "who liked you" screen showed people the deck would never show, on a screen
// where revealing a name COSTS STARS. A rule that lives in three places is a
// rule that is enforced in two.
//
// THE RULE, both directions:
//   • the other person's gender is what I am looking for, AND
//   • my gender is what they are looking for.
//
// 'any' RESOLVES TO THE OPPOSITE GENDER rather than acting as a wildcard.
// That is the fix asked for on 2026-08-12: a woman looking for men must see
// men only. As a wildcard, 'any' leaked same-gender profiles into a straight
// user's deck — and, worse, into their paid likers list. An EXPLICIT same-sex
// preference still works: two people who both chose 'female' still match,
// because the rule reads each side's stated choice first and only falls back
// when there is nothing to read.
//
// Missing gender or preference resolves to null, and null matches NOBODY.
// An incomplete profile disappearing from the deck is a small, self-correcting
// problem; an incomplete profile shown to everyone is not.

/**
 * The gender this user should be shown, as 'male' | 'female' | null.
 * An explicit choice wins; 'any' or a missing value falls back to the opposite
 * of their own gender, which is the straight default this product is built on.
 */
export function wantedGender(user) {
  if (!user) return null;
  const seeking = user.seeking_gender;
  if (seeking === 'male' || seeking === 'female') return seeking;
  if (user.gender === 'male') return 'female';
  if (user.gender === 'female') return 'male';
  return null;
}

/**
 * May `other` appear in `me`'s deck, matches, or likers list?
 * Symmetric on purpose: if it is true for me it is true for them, so nobody is
 * ever shown a person who would never be shown them back.
 */
export function mutualGenderMatch(me, other) {
  if (!me || !other) return false;
  if (!me.gender || !other.gender) return false;
  const iWant = wantedGender(me);
  const theyWant = wantedGender(other);
  if (!iWant || !theyWant) return false;
  return other.gender === iWant && me.gender === theyWant;
}
