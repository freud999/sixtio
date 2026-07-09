import { getSupabase, getHiddenUserIds, getMatchesFor } from './supabase.js';
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
// No cap on matches — everyone can accumulate as many as Sixtio finds.

function describe(user, profile) {
  return {
    gender: user.gender,
    age: user.age,
    city: user.city,
    goal: user.goal,
    interests: user.interests,
    bio: user.bio,
    traits: profile.traits_json,
    vibe: profile.vibe,
    summary: profile.summary_text,
    portrait: profile.portrait_json,
  };
}

const PROFILE_COLS = 'traits_json, vibe, summary_text, portrait_json';

/**
 * Matchmaking for one user (on onboarding completion or a manual "find match").
 * Filters candidates by mutual gender preference, compatible goal and age gap,
 * excludes anyone already paired with this user or already at their match cap,
 * lets Claude pick the most compatible one, records it and notifies both.
 * People may hold several matches — this can be called repeatedly over time.
 *
 * `lang` (Task 26): the triggering user's native Telegram language — the AI
 * writes the match reason in it. The reason is shared with the partner, so a
 * cross-language pair sees it in the initiator's language (known limitation:
 * per-user reasons would need a schema change).
 */
export async function runMatching(userId, lang = 'uk') {
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
    .select(PROFILE_COLS)
    .eq('user_id', userId)
    .maybeSingle();
  if (!myProfile) return null;

  // Prefilter at the DB (gender + age window + not mass-reported) so we never
  // pull the whole user table — critical once a partner-network drives growth.
  // The their-side seeking / goal / block / already-paired checks then run in
  // memory on the much smaller reduced set.
  let candQuery = supabase
    .from('users')
    .select('id, telegram_id, name, tg_username, gender, seeking_gender, goal, age, city, interests, bio, photo_url, language_code')
    .neq('id', userId)
    .eq('shadow_hidden', false)
    .gte('age', me.age - MAX_AGE_GAP)
    .lte('age', me.age + MAX_AGE_GAP);
  if (me.seeking_gender !== 'any') candQuery = candQuery.eq('gender', me.seeking_gender);
  const { data: candidates, error: candError } = await candQuery;
  if (candError) throw candError;

  // One read each (no N+1): my existing match partners + the two-way block set.
  const pairedIds = new Set();
  try { for (const m of await getMatchesFor(userId)) pairedIds.add(m.partnerId); }
  catch (e) { console.error('matching paired-load failed:', e.message); }
  let hidden = new Set();
  try { hidden = await getHiddenUserIds(userId, me.blocked_users); }
  catch (e) { console.error('matching block-filter failed:', e.message); }

  const prelim = [];
  for (const c of candidates || []) {
    if (hidden.has(c.id) || pairedIds.has(c.id)) continue;  // blocked or already paired
    if (!c.gender || !c.seeking_gender || !c.goal || !c.age) continue;
    if (c.seeking_gender !== 'any' && me.gender !== c.seeking_gender) continue;
    if (!(COMPATIBLE_GOALS[me.goal] || []).includes(c.goal)) continue;
    prelim.push(c);
  }
  if (!prelim.length) return null;

  // Batch-load the survivors' profiles in ONE query (was one round-trip PER
  // candidate). Only those with a profile finished onboarding and are eligible.
  const profById = new Map();
  const { data: profs, error: profErr } = await supabase
    .from('profiles')
    .select(`user_id, ${PROFILE_COLS}`)
    .in('user_id', prelim.map((c) => c.id));
  if (profErr) throw profErr;
  for (const p of profs || []) profById.set(p.user_id, p);

  const eligible = [];
  for (const c of prelim) {
    const cp = profById.get(c.id);
    if (cp) eligible.push({ user: c, profile: cp });
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
    shortlist.map((e, index) => ({ index, ...describe(e.user, e.profile) })),
    lang
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
