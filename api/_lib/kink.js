// Dark Mode (18+) kink-interview analysis.
//
// One Gemini call turns a user's short, free-text answers about intimate
// preferences into a small array of STANDARDIZED, non-graphic markers drawn from
// a fixed vocabulary (KINK_MARKERS), then persists them to users.kink_markers and
// flips dark_mode_active on. Mirrors personality.js: schema-constrained JSON out,
// defensive re-validation, single upsert. Matching afterwards is pure JS
// (entitlements.intimateCompatibility) — no further AI at read time.

import { getSupabase } from './supabase.js';
import { KINK_MARKERS, normalizeMarkers } from './entitlements.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// Gemini enforces the enum server-side, so it can only ever return tokens from
// our canonical set — we still re-validate via normalizeMarkers() defensively.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    markers: {
      type: 'array',
      items: { type: 'string', enum: KINK_MARKERS },
      minItems: 0,
      maxItems: 8,
    },
  },
  required: ['markers'],
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
 * Calls Gemini ONCE and returns a validated marker array (subset of
 * KINK_MARKERS, de-duped, ≤8). Pure — no database side effects.
 */
export async function analyzeKinkMarkers(answers) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  if (!answers || !answers.trim()) throw new Error('answers is empty');

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const res = await fetch(`${GEMINI_API_BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: answers }] }],
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: {
        temperature: 0.3, // low: a stable, reproducible read
        responseMimeType: 'application/json',
        responseSchema: RESPONSE_SCHEMA,
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 500)}`);
  }

  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || '')
    .join('')
    .trim();
  if (!text) throw new Error('Gemini returned an empty response');

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Gemini returned non-JSON: ${text.slice(0, 200)}`);
  }

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
