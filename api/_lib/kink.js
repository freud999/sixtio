// Dark Mode (18+) kink-interview analysis.
//
// One Claude call turns a user's short, free-text answers about intimate
// preferences into a small array of STANDARDIZED, non-graphic markers drawn from
// a fixed vocabulary (KINK_MARKERS), then persists them to users.kink_markers and
// flips dark_mode_active on. Mirrors personality.js: schema-constrained JSON out,
// defensive re-validation, single upsert. Matching afterwards is pure JS
// (entitlements.intimateCompatibility) — no further AI at read time.
//
// WHY CLAUDE AND NOT GEMINI. This is the single most sensitive payload the app
// produces: a named adult's own words about their sexual preferences — a special
// category under GDPR Art. 9. On Google's FREE tier, prompts may be used to
// improve their models; Anthropic does not train on API traffic. That difference
// is the whole reason this call moved, 2026-08-05. Do not move it back to
// Gemini for cost or quota reasons — the quota is not what is being spent here.
// See audit PRIV-1.

import { getSupabase } from './supabase.js';
import { KINK_MARKERS, normalizeMarkers } from './entitlements.js';
import { claudeJson, kinkModelInUse } from './claude.js';

// The schema constrains the output server-side, so the model can only ever
// return tokens from our canonical set — we still re-validate defensively.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    markers: {
      type: 'array',
      items: { type: 'string', enum: KINK_MARKERS },
    },
  },
  required: ['markers'],
  additionalProperties: false,
};

const SYSTEM_PROMPT = `You classify a consenting adult's answers to a short intimacy questionnaire on a dating app.
Map what they express to a compact set of standardized, non-graphic preference markers.

Allowed markers (use ONLY these tokens): ${KINK_MARKERS.join(', ')}.

Meaning guide:
- Dynamic: dominant / submissive / switch (leading, following, or fluid).
- Tone: sensual, passionate, romantic, tender, playful, slow (unhurried, savouring), intense (fiery, high-intensity).
- Novelty: curious, experimental, adventurous, vanilla (prefers the classic/traditional).
- Affection & sensuality: kissing, cuddling, massage, sensation_play (light sensory play — temperature, feathers), teasing, dirty_talk, sexting, fantasies.
- Specific interests (emit ONLY when clearly and positively expressed): roleplay, toys, bondage, blindfold, edging, spanking, biting, wax_play, footplay, strap_on, oral, mirrors, voyeur, exhibitionist.

Rules:
- Return ONLY markers the answers clearly and positively support — never infer taboos the user rules out.
- Prefer precision over breadth: 2 to 6 markers is typical; return an empty array if nothing is clearly expressed.
- Respect stated limits: if they mark something as a hard "no", do not emit it.
- Respond with the JSON object only — no commentary.`;

/**
 * Calls Claude ONCE and returns a validated marker array (subset of
 * KINK_MARKERS, de-duped, ≤8). Pure — no database side effects.
 */
export async function analyzeKinkMarkers(answers) {
  if (!process.env.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is not set');
  if (!answers || !answers.trim()) throw new Error('answers is empty');

  const parsed = await claudeJson({
    model: kinkModelInUse(),
    system: SYSTEM_PROMPT,
    user: answers,
    schema: RESPONSE_SCHEMA,
    maxTokens: 500,
  });

  // Defensive: re-validate against the canonical set and cap at 8.
  return normalizeMarkers(parsed.markers).slice(0, 8);
}

/**
 * Dark-Mode entry point: analyse the interview once, then persist the markers and
 * turn dark_mode_active on. Returns the saved marker array.
 *
 * @param {string} userId  public.users.id (UUID)
 * @param {string} answers concatenated free-text interview answers
 */
export async function processKinkInterview(userId, answers) {
  if (!userId) throw new Error('userId is required');

  const markers = await analyzeKinkMarkers(answers);

  const { error } = await getSupabase()
    .from('users')
    .update({ kink_markers: markers, dark_mode_active: true })
    .eq('id', userId);
  if (error) throw error;

  return markers;
}
