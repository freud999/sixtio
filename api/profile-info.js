import { resolveUser, pickLang } from './_lib/telegram.js';
import { getSupabase, upsertUser } from './_lib/supabase.js';
import { rateLimit, LIMITS, sendRateLimited } from './_lib/ratelimit.js';

const GENDERS = ['male', 'female'];
const SEEKING = ['male', 'female', 'any'];
const GOALS = ['longterm', 'fun', 'situational'];
// Canonical life-values (Layer 3); anything outside this set is dropped server-side.
const VALUE_TOKENS = new Set([
  'feminism', 'sober', 'therapy_minded', 'unconditional_love',
  'body_positive', 'gender_free', 'non_smoker',
]);

// Saves the structured profile fields collected at the start of onboarding.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { initData, gender, seekingGender, goal, age, city, interests, values, bio, lang: clientLang } = req.body || {};
    const tgUser = resolveUser(initData);
    if (!tgUser) {
      return res.status(401).json({ error: 'Invalid Telegram initData' });
    }

    const rl = rateLimit(`profinfo:${tgUser.id}`, LIMITS.write);
    if (!rl.allowed) return sendRateLimited(res, rl.retryAfterSec);

    const fields = {};
    // Bind the account to the user's CHOSEN UI language at registration (the
    // in-app switcher), falling back to the Telegram language; /api/me re-syncs
    // it on every later open. Drives bot-notification language (Task 36).
    fields.language_code = pickLang(clientLang, tgUser);
    if (GENDERS.includes(gender)) fields.gender = gender;
    if (SEEKING.includes(seekingGender)) fields.seeking_gender = seekingGender;
    if (GOALS.includes(goal)) fields.goal = goal;

    const parsedAge = parseInt(age, 10);
    if (parsedAge >= 18 && parsedAge <= 100) fields.age = parsedAge;

    if (typeof city === 'string' && city.trim()) fields.city = city.trim().slice(0, 100);
    if (typeof bio === 'string' && bio.trim()) {
      fields.bio = bio.trim().slice(0, 600);
      // Whatever language the UI is in right now is the language they just typed
      // in. Any cached translations describe the PREVIOUS text and would now be
      // served as if they were this one — drop them (migration 034).
      fields.bio_lang = fields.language_code;
      fields.bio_i18n = {};
    }
    if (Array.isArray(interests)) {
      const cleaned = interests
        .filter((i) => typeof i === 'string' && i.trim())
        .map((i) => i.trim().slice(0, 40))
        .slice(0, 15);
      if (cleaned.length) fields.interests = cleaned;
    }
    // Life values: keep only canonical tokens, de-duped and capped.
    if (Array.isArray(values)) {
      const seen = new Set();
      const vals = [];
      for (const v of values) {
        const tok = typeof v === 'string' ? v.trim() : '';
        if (VALUE_TOKENS.has(tok) && !seen.has(tok)) { seen.add(tok); vals.push(tok); }
      }
      fields.core_values = vals;   // may be [] — an explicit "no values picked"
    }

    if (!fields.gender || !fields.seeking_gender || !fields.goal || !fields.age) {
      return res.status(400).json({ error: 'gender, seekingGender, goal and age (18+) are required' });
    }

    const userId = await upsertUser(tgUser);
    const { error } = await getSupabase().from('users').update(fields).eq('id', userId);
    if (error) throw error;

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('api/profile-info failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
