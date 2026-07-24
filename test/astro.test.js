import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import {
  parseBirthDate, zodiacSign, signElement, ageFromBirthDate,
  socionicsType, SOCIONICS_CODES, ZODIAC_SIGNS, WEAK_AXIS_MARGIN,
} from '../api/_lib/astro.js';

// --- dates ---------------------------------------------------------------

test('a well-formed date parses; junk does not', () => {
  assert.deepEqual(parseBirthDate('1994-11-07'), { y: 1994, m: 11, d: 7 });
  assert.equal(parseBirthDate('07.11.1994'), null);
  assert.equal(parseBirthDate('1994-11-7'), null);
  assert.equal(parseBirthDate(''), null);
  assert.equal(parseBirthDate(null), null);
});

test('impossible calendar days are rejected, not rolled forward', () => {
  // `new Date(1994, 1, 30)` silently becomes March 2 — a birth date that quietly
  // moves to another month would hand the user a different sign than the one on
  // the form they filled in.
  assert.equal(parseBirthDate('1994-02-30'), null);
  assert.equal(parseBirthDate('1994-13-01'), null);
  assert.equal(parseBirthDate('1994-00-10'), null);
  assert.deepEqual(parseBirthDate('1996-02-29'), { y: 1996, m: 2, d: 29 }); // real leap day
});

// --- signs ---------------------------------------------------------------

test('every sign resolves at its own first and last day', () => {
  const spans = [
    ['aries', '2000-03-21', '2000-04-19'],
    ['taurus', '2000-04-20', '2000-05-20'],
    ['gemini', '2000-05-21', '2000-06-20'],
    ['cancer', '2000-06-21', '2000-07-22'],
    ['leo', '2000-07-23', '2000-08-22'],
    ['virgo', '2000-08-23', '2000-09-22'],
    ['libra', '2000-09-23', '2000-10-22'],
    ['scorpio', '2000-10-23', '2000-11-21'],
    ['sagittarius', '2000-11-22', '2000-12-21'],
    ['aquarius', '2000-01-20', '2000-02-18'],
    ['pisces', '2000-02-19', '2000-03-20'],
  ];
  for (const [sign, first, last] of spans) {
    assert.equal(zodiacSign(first), sign, `${sign} start`);
    assert.equal(zodiacSign(last), sign, `${sign} end`);
  }
});

test('Capricorn wraps the year end in both directions', () => {
  // The one sign that spans New Year, and therefore the only one a naive
  // "first boundary at or before this date" scan can get wrong.
  assert.equal(zodiacSign('2000-12-22'), 'capricorn');
  assert.equal(zodiacSign('2000-12-31'), 'capricorn');
  assert.equal(zodiacSign('2000-01-01'), 'capricorn');
  assert.equal(zodiacSign('2000-01-19'), 'capricorn');
});

test('a bad date yields no sign rather than a wrong one', () => {
  assert.equal(zodiacSign('nonsense'), null);
  assert.equal(zodiacSign(null), null);
});

test('elements cycle fire/earth/air/water from Aries', () => {
  assert.equal(signElement('aries'), 'fire');
  assert.equal(signElement('taurus'), 'earth');
  assert.equal(signElement('gemini'), 'air');
  assert.equal(signElement('cancer'), 'water');
  assert.equal(signElement('pisces'), 'water');
  assert.equal(signElement('not-a-sign'), null);
});

test('every sign has an element', () => {
  for (const s of ZODIAC_SIGNS) assert.ok(signElement(s), s);
});

// --- age -----------------------------------------------------------------

test('age counts whole years and does not round the birthday up', () => {
  const today = new Date(Date.UTC(2026, 6, 24));   // 2026-07-24
  assert.equal(ageFromBirthDate('1994-07-24', today), 32);  // birthday today
  assert.equal(ageFromBirthDate('1994-07-25', today), 31);  // tomorrow
  assert.equal(ageFromBirthDate('1994-07-23', today), 32);  // yesterday
});

// --- socionics -----------------------------------------------------------

test('each axis follows its own Big Five trait', () => {
  const high = {
    extraversion: 80, openness: 80, agreeableness: 80, conscientiousness: 80,
  };
  assert.equal(socionicsType(high).mbti, 'ENFJ');

  const low = {
    extraversion: 20, openness: 20, agreeableness: 20, conscientiousness: 20,
  };
  assert.equal(socionicsType(low).mbti, 'ISTP');
});

test('the profiles-row shape works as well as the plain one', () => {
  // The caller reads a profiles row (trait_*); the tests read far better plain.
  const row = {
    trait_extraversion: 80, trait_openness: 80,
    trait_agreeableness: 80, trait_conscientiousness: 80,
    trait_neuroticism: 90,          // present, and deliberately ignored
  };
  assert.equal(socionicsType(row).mbti, 'ENFJ');
});

test('neuroticism cannot change the type', () => {
  const base = { extraversion: 70, openness: 70, agreeableness: 30, conscientiousness: 30 };
  const calm = socionicsType({ ...base, neuroticism: 5 });
  const anxious = socionicsType({ ...base, neuroticism: 95 });
  assert.equal(calm.code, anxious.code);
});

test('exactly 50 commits to the high letter rather than returning nothing', () => {
  const t = socionicsType({
    extraversion: 50, openness: 50, agreeableness: 50, conscientiousness: 50,
  });
  assert.equal(t.mbti, 'ENFJ');
  // …but every axis is flagged weak, so the UI hedges instead of asserting it.
  assert.ok(t.axes.every((a) => a.weak));
});

test('an axis is weak only within the margin', () => {
  const t = socionicsType({
    extraversion: 50 + WEAK_AXIS_MARGIN,      // exactly on the boundary = strong
    openness: 50 + WEAK_AXIS_MARGIN - 1,      // one inside = weak
    agreeableness: 90,
    conscientiousness: 10,
  });
  const by = Object.fromEntries(t.axes.map((a) => [a.axis, a]));
  assert.equal(by.EI.weak, false);
  assert.equal(by.NS.weak, true);
  assert.equal(by.FT.weak, false);
  assert.equal(by.JP.weak, false);
});

test('a partial or missing vector is not typed at all', () => {
  // Inventing a type from three traits would be indistinguishable, to the
  // reader, from one derived from four.
  assert.equal(socionicsType({ extraversion: 70, openness: 70, agreeableness: 70 }), null);
  assert.equal(socionicsType({}), null);
  assert.equal(socionicsType(null), null);
});

test('all sixteen combinations map to a distinct socionics code', () => {
  const seen = new Set();
  for (let i = 0; i < 16; i++) {
    const t = socionicsType({
      extraversion:      (i & 1) ? 80 : 20,
      openness:          (i & 2) ? 80 : 20,
      agreeableness:     (i & 4) ? 80 : 20,
      conscientiousness: (i & 8) ? 80 : 20,
    });
    assert.ok(t, `combination ${i} produced no type`);
    seen.add(t.code);
  }
  assert.equal(seen.size, 16);
  assert.deepEqual([...seen].sort(), [...SOCIONICS_CODES].sort());
});

// --- i18n coverage -------------------------------------------------------

test('every sign and type this file can return has a label in all 3 languages', () => {
  // astro.js emits codes, i18n.js owns the words. Nothing at runtime connects
  // the two, so a code added here without labels would surface to a user as a
  // raw "soc_SLI" — this is the join the code cannot make for itself.
  // i18n.js is a browser IIFE and cannot be imported, so it is read as text.
  const src = readFileSync(new URL('../i18n.js', import.meta.url), 'utf8');
  const missing = [];
  for (const key of [
    ...ZODIAC_SIGNS.map((s) => 'sign_' + s),
    ...SOCIONICS_CODES.map((c) => 'soc_' + c),
    ...['fire', 'earth', 'air', 'water'].map((e) => 'elem_' + e),
    ...['E', 'I', 'N', 'S', 'F', 'T', 'J', 'P'].map((l) => 'soc_axis_' + l),
  ]) {
    const hits = src.split(new RegExp('\\b' + key + '\\s*:')).length - 1;
    if (hits < 3) missing.push(`${key} (${hits}/3)`);
  }
  assert.deepEqual(missing, []);
});
