import { getSupabase } from './supabase.js';
import { scoreCandidates } from './claude.js';
import { notifyMatchBoth } from './bot.js';

// Who can match with whom by relationship goal: "situational" is open to everyone.
const COMPATIBLE_GOALS = {
  longterm: ['longterm', 'situational'],
  fun: ['fun', 'situational'],
  situational: ['longterm', 'fun', 'situational'],
};
const MAX_AGE_GAP = 10;
const MIN_SCORE = 6;
const MAX_CANDIDATES_FOR_AI = 5;

function describe(user, profile) {
  return {
    gender: user.gender,
    age: user.age,
    city: user.city,
    goal: user.goal,
    interests: user.interests,
    bio: user.bio,
    traits: profile.traits_json,
    summary: profile.summary_text,
  };
}

async function hasMatch(supabase, userId) {
  const { data, error } = await supabase
    .from('matches')
    .select('id')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .limit(1);
  if (error) throw error;
  return data && data.length > 0;
}

/**
 * Instant matchmaking for a user who just finished onboarding.
 * Filters candidates (mutual gender preference, compatible goal, age gap),
 * lets Claude pick the most psychologically compatible one, records the
 * match, and notifies both people via the Telegram bot.
 */
export async function runMatching(userId) {
  const supabase = getSupabase();

  const { data: me, error: meError } = await supabase
    .from('users')
    .select('*')
    .eq('id', userId)
    .single();
  if (meError) throw meError;
  if (!me || !me.gender || !me.seeking_gender || !me.goal || !me.age) return null;

  const { data: myProfile } = await supabase
    .from('profiles')
    .select('traits_json, summary_text')
    .eq('user_id', userId)
    .maybeSingle();
  if (!myProfile) return null;

  // MVP: one active match per person.
  if (await hasMatch(supabase, userId)) return null;

  const { data: candidates, error: candError } = await supabase
    .from('users')
    .select('id, telegram_id, name, tg_username, gender, seeking_gender, goal, age, city, interests, bio, photo_url')
    .neq('id', userId);
  if (candError) throw candError;

  const eligible = [];
  for (const c of candidates || []) {
    if (!c.gender || !c.seeking_gender || !c.goal || !c.age) continue;
    if (me.seeking_gender !== 'any' && c.gender !== me.seeking_gender) continue;
    if (c.seeking_gender !== 'any' && me.gender !== c.seeking_gender) continue;
    if (!(COMPATIBLE_GOALS[me.goal] || []).includes(c.goal)) continue;
    if (Math.abs(me.age - c.age) > MAX_AGE_GAP) continue;
    if (await hasMatch(supabase, c.id)) continue;
    const { data: cp } = await supabase
      .from('profiles')
      .select('traits_json, summary_text')
      .eq('user_id', c.id)
      .maybeSingle();
    if (!cp) continue; // onboarding not finished
    eligible.push({ user: c, profile: cp });
  }
  if (!eligible.length) return null;

  // Same city first, then smallest age gap; cap the list for the AI call.
  const norm = (s) => (s || '').trim().toLowerCase();
  eligible.sort((a, b) => {
    const cityA = me.city && norm(a.user.city) === norm(me.city) ? 0 : 1;
    const cityB = me.city && norm(b.user.city) === norm(me.city) ? 0 : 1;
    if (cityA !== cityB) return cityA - cityB;
    return Math.abs(me.age - a.user.age) - Math.abs(me.age - b.user.age);
  });
  const shortlist = eligible.slice(0, MAX_CANDIDATES_FOR_AI);

  const verdict = await scoreCandidates(
    describe(me, myProfile),
    shortlist.map((e, index) => ({ index, ...describe(e.user, e.profile) }))
  );
  if (!verdict || verdict.best < 0 || verdict.best >= shortlist.length) return null;
  if (verdict.score < MIN_SCORE) return null;

  const chosen = shortlist[verdict.best];
  const [a, b] = userId < chosen.user.id ? [userId, chosen.user.id] : [chosen.user.id, userId];
  const { error: insertError } = await supabase
    .from('matches')
    .insert({ user_a: a, user_b: b, score: verdict.score, reason: verdict.reason });
  if (insertError) throw insertError;

  await notifyMatchBoth(me, chosen.user, verdict.reason);
  return { partnerId: chosen.user.id, score: verdict.score };
}
