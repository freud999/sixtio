// The two "lenses" of the AI report: a sun sign and a socionics type.
//
// Everything in this file is PURE — no network, no env, no database. That is
// deliberate: these are the only parts of the report a user can check against
// their own knowledge ("I'm a Scorpio", "I always test as an intuitive"), so
// they must be reproducible byte-for-byte, free to compute, and unit-testable
// without a Gemini key. The AI is handed these as FACTS and only writes prose
// around them — it never gets to decide what type someone is, because a model
// asked the same question twice would answer differently and the report would
// stop being about the person.
//
// Labels live in i18n.js, keyed by the codes returned here. This file therefore
// contains no user-facing text at all and needs no translation.

// Sign boundaries as [month, firstDay] — the day the sign STARTS. Ordered by
// calendar so a single scan backwards finds the sign for any date. Capricorn
// wraps the year end, which is why it appears twice and January 1 resolves to
// the December entry.
const SIGN_BOUNDS = [
  [1, 1, 'capricorn'],  [1, 20, 'aquarius'],
  [2, 19, 'pisces'],
  [3, 21, 'aries'],
  [4, 20, 'taurus'],
  [5, 21, 'gemini'],
  [6, 21, 'cancer'],
  [7, 23, 'leo'],
  [8, 23, 'virgo'],
  [9, 23, 'libra'],
  [10, 23, 'scorpio'],
  [11, 22, 'sagittarius'],
  [12, 22, 'capricorn'],
];

// Classical element per sign, in zodiac order starting at Aries: fire, earth,
// air, water, repeating. Derived rather than tabulated so it cannot drift.
const SIGN_ORDER = [
  'aries', 'taurus', 'gemini', 'cancer', 'leo', 'virgo',
  'libra', 'scorpio', 'sagittarius', 'capricorn', 'aquarius', 'pisces',
];
const ELEMENTS = ['fire', 'earth', 'air', 'water'];

/** 'YYYY-MM-DD' -> { y, m, d } or null. Parsed by hand: `new Date(str)` reads
 *  a bare date as UTC midnight, which shifts the day for anyone west of GMT and
 *  would hand people born on a cusp the wrong sign. */
export function parseBirthDate(value) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
  if (!m) return null;
  const y = Number(m[1]), mo = Number(m[2]), d = Number(m[3]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  // Reject impossible days (Feb 30) by round-tripping through a UTC date, where
  // an overflow silently rolls into the next month.
  const probe = new Date(Date.UTC(y, mo - 1, d));
  if (probe.getUTCMonth() !== mo - 1 || probe.getUTCDate() !== d) return null;
  if (y < 1900 || y > new Date().getUTCFullYear()) return null;
  return { y, m: mo, d };
}

/** Sun sign key ('scorpio', …) for a 'YYYY-MM-DD' date, or null if unparseable. */
export function zodiacSign(birthDate) {
  const p = parseBirthDate(birthDate);
  if (!p) return null;
  let sign = SIGN_BOUNDS[0][2];
  for (const [mo, day, key] of SIGN_BOUNDS) {
    if (p.m > mo || (p.m === mo && p.d >= day)) sign = key;
    else break;
  }
  return sign;
}

/** 'fire' | 'earth' | 'air' | 'water' for a sign key, or null. */
export function signElement(sign) {
  const i = SIGN_ORDER.indexOf(sign);
  return i < 0 ? null : ELEMENTS[i % 4];
}

/** Whole years old on `today` (default: now). Null when the date is unusable. */
export function ageFromBirthDate(birthDate, today) {
  const p = parseBirthDate(birthDate);
  if (!p) return null;
  const now = today || new Date();
  let age = now.getUTCFullYear() - p.y;
  const beforeBirthday =
    now.getUTCMonth() + 1 < p.m ||
    (now.getUTCMonth() + 1 === p.m && now.getUTCDate() < p.d);
  if (beforeBirthday) age -= 1;
  return age < 0 ? null : age;
}

// --- Socionics ----------------------------------------------------------
//
// Socionics splits people along the same four dichotomies as MBTI, so a Big
// Five vector maps onto it directly — and mapping it is far more honest than
// asking a model to "guess the type", because the Big Five scores are already
// evidence-derived and stable, while a second AI pass would just add noise on
// top of them.
//
//   E/I  <- extraversion        (the same construct under both names)
//   N/S  <- openness            (abstract/imaginative vs concrete/practical)
//   F/T  <- agreeableness       (decides by people vs by logic)
//   J/P  <- conscientiousness   (structure vs improvisation)
//
// Neuroticism is deliberately NOT part of the type. It has no dichotomy to sit
// on, and folding it in would let emotional weather masquerade as personality
// structure. It is reported alongside instead, as its own reading.
const TYPE_BY_MBTI = {
  ENTP: 'ILE', ISFP: 'SEI', ESFJ: 'ESE', INTJ: 'LII',
  ENFJ: 'EIE', ISTJ: 'LSI', ESTP: 'SLE', INFP: 'IEI',
  ENTJ: 'LIE', ISFJ: 'ESI', ESFP: 'SEE', INTP: 'ILI',
  ENFP: 'IEE', ISTP: 'SLI', ESTJ: 'LSE', INFJ: 'EII',
};

// Which trait drives which axis, and which letter the HIGH end produces.
const AXES = [
  { axis: 'EI', trait: 'extraversion',       high: 'E', low: 'I' },
  { axis: 'NS', trait: 'openness',           high: 'N', low: 'S' },
  { axis: 'FT', trait: 'agreeableness',      high: 'F', low: 'T' },
  { axis: 'JP', trait: 'conscientiousness',  high: 'J', low: 'P' },
];

// An axis this close to the midpoint is a coin flip, not a reading. The UI says
// so rather than presenting a 51 as a verdict — overclaiming on a tie is the
// fastest way for a report like this to feel like a horoscope generator.
export const WEAK_AXIS_MARGIN = 8;

/**
 * Socionics type from a Big Five vector.
 *
 * `traits` accepts either the profiles-row shape (trait_extraversion, …) or the
 * plain one (extraversion, …), because the caller reads a profiles row while the
 * tests are far more readable with plain keys.
 *
 * Returns { code, mbti, axes: [{ axis, letter, score, strength, weak }] }, or
 * null when the vector is missing entirely — a type invented from no data would
 * be indistinguishable from a real one to the reader.
 */
export function socionicsType(traits) {
  const t = traits || {};
  const get = (name) => {
    const v = typeof t['trait_' + name] === 'number' ? t['trait_' + name] : t[name];
    return typeof v === 'number' && Number.isFinite(v) ? v : null;
  };

  const axes = [];
  let mbti = '';
  for (const a of AXES) {
    const score = get(a.trait);
    if (score === null) return null;          // partial vectors are not typed
    const letter = score >= 50 ? a.high : a.low;
    const strength = Math.abs(score - 50);
    axes.push({ axis: a.axis, letter, score, strength, weak: strength < WEAK_AXIS_MARGIN });
    mbti += letter;
  }

  const code = TYPE_BY_MBTI[mbti];
  if (!code) return null;
  return { code, mbti, axes };
}

/** Every socionics code, so i18n coverage can be asserted in a test. */
export const SOCIONICS_CODES = Object.values(TYPE_BY_MBTI);
export const ZODIAC_SIGNS = SIGN_ORDER;
