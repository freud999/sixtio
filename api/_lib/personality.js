// Big Five (OCEAN) personality extraction for onboarding.
//
// One Gemini call turns a user's free-text interview answers into five trait
// scores (1..100) plus three short tags, then persists them to `profiles`.
// Called exactly once per user during onboarding — matching afterwards reads
// the stored traits via the `calculate_compatibility` SQL RPC (no further AI).

import { getSupabase } from './supabase.js';

const GEMINI_API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

// The five canonical Big Five dimensions, in the order we store them.
const TRAITS = [
  'extraversion',
  'agreeableness',
  'conscientiousness',
  'neuroticism',
  'openness',
];

// Gemini enforces this shape server-side (responseSchema), so we get back valid,
// parseable JSON instead of prose we'd have to scrape.
const RESPONSE_SCHEMA = {
  type: 'object',
  properties: {
    extraversion: { type: 'integer' },
    agreeableness: { type: 'integer' },
    conscientiousness: { type: 'integer' },
    neuroticism: { type: 'integer' },
    openness: { type: 'integer' },
    tags: {
      type: 'array',
      items: { type: 'string' },
      minItems: 3,
      maxItems: 3,
    },
  },
  required: [...TRAITS, 'tags'],
  propertyOrdering: [...TRAITS, 'tags'],
};

const SYSTEM_PROMPT = `You are a personality psychologist trained in the Big Five (OCEAN) model.
Analyse the user's interview answers and rate each of the five traits on a 1-100 scale,
where 50 is the population average.

Scoring guide (higher = more of the trait):
- extraversion: sociable, energetic, assertive vs. reserved, solitary.
- agreeableness: warm, cooperative, trusting vs. competitive, skeptical.
- conscientiousness: organised, disciplined, dependable vs. spontaneous, careless.
- neuroticism: anxious, emotionally reactive, moody vs. calm, resilient.
- openness: curious, imaginative, unconventional vs. practical, routine-loving.

Calibration — use the FULL range; do NOT cluster scores around 50:
- 50 is the average, but real people are rarely a flat 50. Most traits land in
  roughly 25-40 or 60-80 — commit to a direction whenever the answers lean one way.
- Read HOW they write, not only what: tone, word choice, emotional intensity, and
  which examples they pick (and omit) are strong evidence even in short answers.
- Reserve below 20 or above 80 for a trait the answers express clearly and repeatedly.
- Fall back toward 50 ONLY for a trait with genuinely no signal — never as a safe default.
- Keep the read stable: the same answers should always yield the same scores.

Rules:
- Base every score ONLY on evidence in the answers.
- Return integers from 1 to 100 (never 0, never above 100).
- Also return exactly 3 short lowercase descriptive tags (1-2 words each), e.g. ["empathetic", "rational", "adventurous"].
- Respond with the JSON object only — no commentary.`;

/** Clamp to a 1..100 integer; falls back to the neutral midpoint on garbage. */
function clampTrait(value) {
  const n = Math.round(Number(value));
  if (!Number.isFinite(n)) return 50;
  return Math.min(100, Math.max(1, n));
}

/** Normalise tags to exactly three short, trimmed, non-empty strings. */
function normalizeTags(tags) {
  const cleaned = (Array.isArray(tags) ? tags : [])
    .map((t) => String(t || '').trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 3);
  while (cleaned.length < 3) cleaned.push('balanced');
  return cleaned;
}

/**
 * Calls Gemini ONCE and returns a validated personality object:
 * `{ traits: { extraversion, ... }, tags: [t1, t2, t3] }`.
 * Pure — no database side effects, so it's easy to unit-test.
 */
export async function analyzePersonality(interviewResponses) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  if (!interviewResponses || !interviewResponses.trim()) {
    throw new Error('interviewResponses is empty');
  }

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const res = await fetch(`${GEMINI_API_BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: interviewResponses }] }],
      systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
      generationConfig: {
        temperature: 0.4, // low: we want a stable, reproducible read
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

  const traits = {};
  for (const trait of TRAITS) traits[trait] = clampTrait(parsed[trait]);
  return { traits, tags: normalizeTags(parsed.tags) };
}

/**
 * Onboarding entry point: analyse the interview once, then persist the Big Five
 * scores and tags onto the user's `profiles` row. Upserts so it works whether or
 * not a profile row already exists. Returns the saved `{ traits, tags }`.
 *
 * @param {string} userId             public.users.id (UUID) of the onboarding user
 * @param {string} interviewResponses concatenated free-text interview answers
 */
export async function processOnboardingPersonality(userId, interviewResponses) {
  if (!userId) throw new Error('userId is required');

  const { traits, tags } = await analyzePersonality(interviewResponses);

  const { error } = await getSupabase()
    .from('profiles')
    .upsert(
      {
        user_id: userId,
        trait_extraversion: traits.extraversion,
        trait_agreeableness: traits.agreeableness,
        trait_conscientiousness: traits.conscientiousness,
        trait_neuroticism: traits.neuroticism,
        trait_openness: traits.openness,
        compatibility_tags: tags,
        updated_at: new Date().toISOString(),
      },
      { onConflict: 'user_id' }
    );
  if (error) throw error;

  return { traits, tags };
}

/**
 * Ranked compatibility for a user via the `calculate_compatibility` RPC.
 * Returns `[{ user_id, name, compatibility_tags, compatibility_score }]`
 * ordered best-first. Pure read — the math lives in Postgres.
 */
export async function getCompatibleUsers(userId, { limit = 20 } = {}) {
  const { data, error } = await getSupabase()
    .rpc('calculate_compatibility', { current_user_id: userId })
    .limit(limit);
  if (error) throw error;
  return data || [];
}
