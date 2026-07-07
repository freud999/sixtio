import { resolveUser, resolveLang } from './_lib/telegram.js';
import { getSupabase, upsertUser } from './_lib/supabase.js';

const GENDERS = ['male', 'female'];
const SEEKING = ['male', 'female', 'any'];
const GOALS = ['longterm', 'fun', 'situational'];

// Saves the structured profile fields collected at the start of onboarding.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { initData, gender, seekingGender, goal, age, city, interests, bio } = req.body || {};
    const tgUser = resolveUser(initData);
    if (!tgUser) {
      return res.status(401).json({ error: 'Invalid Telegram initData' });
    }

    const fields = {};
    // Task 28: bind the account to the CURRENT Telegram interface language at
    // registration; /api/me re-syncs it on every later open.
    fields.language_code = resolveLang(tgUser);
    if (GENDERS.includes(gender)) fields.gender = gender;
    if (SEEKING.includes(seekingGender)) fields.seeking_gender = seekingGender;
    if (GOALS.includes(goal)) fields.goal = goal;

    const parsedAge = parseInt(age, 10);
    if (parsedAge >= 18 && parsedAge <= 100) fields.age = parsedAge;

    if (typeof city === 'string' && city.trim()) fields.city = city.trim().slice(0, 100);
    if (typeof bio === 'string' && bio.trim()) fields.bio = bio.trim().slice(0, 600);
    if (Array.isArray(interests)) {
      const cleaned = interests
        .filter((i) => typeof i === 'string' && i.trim())
        .map((i) => i.trim().slice(0, 40))
        .slice(0, 15);
      if (cleaned.length) fields.interests = cleaned;
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
