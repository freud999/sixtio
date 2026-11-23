// Building a Digital Twin from a user's saved interview — ONE implementation.
//
// It used to live inline in api/profile.js, which was fine while the only way
// to get a Twin was to be sitting in onboarding when it was generated. The
// 47-day Anthropic outage (2026-10-06 → 2026-11-23) broke that assumption:
// 38 people finished the interview, got no profile, and most of them never
// opened the app again. Recovering them means building Twins on the server, for
// people who are not present — and a second copy of this logic would drift
// from the first the moment either was edited.
import { generateProfile } from './claude.js';
import { questionLabel } from './questions.js';

/**
 * Reads the user's answers, generates the Twin, and saves it.
 *
 * @returns {Promise<object|null>} the generated profile, or null when the user
 *   has no answers (nothing to build from — not an error).
 * @throws on an AI or database failure, so callers can tell "nothing to do"
 *   from "could not do it" and retry the latter.
 */
export async function buildTwin(supabase, userId, { gender = null, lang = 'uk' } = {}) {
  const { data: rows, error } = await supabase
    .from('answers')
    .select('question_id, answer_text, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  if (!rows || rows.length === 0) return null;

  const qaLines = rows.map(
    (r) => `Питання: ${questionLabel(r.question_id)}\nВідповідь: ${r.answer_text}\n`
  );
  const profile = await generateProfile(qaLines, gender, lang);

  const { error: upsertError } = await supabase.from('profiles').upsert(
    {
      user_id: userId,
      traits_json: profile.traits,
      vibe: profile.vibe || null,
      summary_text: profile.summary,
      portrait_json: profile.portrait || null,
      // Record which language this was written in, so readers never have to
      // guess — and drop any cached translations, which now describe text that
      // no longer exists (migration 034).
      lang,
      i18n: {},
      updated_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' }
  );
  if (upsertError) throw upsertError;

  return profile;
}

/** The interview transcript in the shape the Big Five extractor expects. */
export async function interviewText(supabase, userId) {
  const { data: rows, error } = await supabase
    .from('answers')
    .select('question_id, answer_text')
    .eq('user_id', userId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (rows || [])
    .map((r) => `Питання: ${questionLabel(r.question_id)}\nВідповідь: ${r.answer_text}\n`)
    .join('');
}
