// The single door to Gemini's generateContent.
//
// Why this file exists: the same eight-line `fetch` was copy-pasted into six
// places across four files, each with its own hand-written generationConfig.
// When Google retired the model name in our default, and later changed which
// "think less" parameter a model accepts, the fix had to be found and applied
// six times — and until it was, a one-word difference in a request body was a
// seven-day outage that returned 200 to every user. One door means one place to
// fix, and one place that can learn.

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

/** The model every call uses.
 *
 *  The default was `gemini-2.5-flash` and that was the outage: measured
 *  2026-08-03, it answers 404 "no longer available to new users" on every knob.
 *  Note it is still LISTED by models.list and still advertises generateContent —
 *  appearing in the catalogue is not the same as being callable, so never trust
 *  that list as proof a model works. Only a real generateContent is proof.
 *
 *  The default below is verified 200. Set GEMINI_MODEL anyway: a floating alias
 *  silently changes generation under you, which is the other half of this bug. */
export function geminiModel() {
  return process.env.GEMINI_MODEL || 'gemini-flash-latest';
}

// Which knob turns thinking down depends on the model's generation, and the
// wrong one is NOT ignored — it comes back 400 INVALID_ARGUMENT and the call
// dies. Gemini 1.x/2.x take thinkingBudget (a token budget); 3.x replaced it
// with thinkingLevel (a semantic level). A floating alias like
// "gemini-flash-latest" names no generation at all, so it cannot be classified
// from its name — for those, the first call finds out and we remember.
const BUDGET = 'thinkingBudget';
const LEVEL = 'thinkingLevel';
const KNOB_CONFIG = {
  [BUDGET]: { thinkingConfig: { thinkingBudget: 0 } },
  [LEVEL]: { thinkingConfig: { thinkingLevel: 'low' } },
};

// model name -> the knob it actually accepted. Module scope, so it lives as long
// as the warm lambda: the double request costs one round-trip per cold start at
// worst, never one per call. Deliberately not persisted — a cold start
// re-learning from scratch is exactly what we want the day Google moves an alias
// to a new generation.
const resolvedKnob = new Map();

/**
 * The knob to TRY first for `model`. Exported for the tests: which guess we make
 * for an unclassifiable alias is the whole behaviour worth pinning down.
 */
export function pickThinkingKnob(model) {
  const learned = resolvedKnob.get(model);
  if (learned) return learned;
  if (/^gemini-[12]\d*[.-]/.test(model)) return BUDGET;
  if (/^gemini-[3-9]\d*[.-]/.test(model)) return LEVEL;
  // Alias: no generation in the name, so this is a guess — but not a blind one.
  // Measured 2026-08-03, gemini-flash-latest takes thinkingLevel and 400s on
  // thinkingBudget: the aliases have moved to 3.x. Guessing LEVEL costs zero
  // extra round-trips today; the retry below covers us if they ever move back.
  return LEVEL;
}

/** Test seam: forget everything learned so far. */
export function resetThinkingKnobs() {
  resolvedKnob.clear();
}

function withKnob(payload, knob) {
  return {
    ...payload,
    generationConfig: { ...(payload.generationConfig || {}), ...KNOB_CONFIG[knob] },
  };
}

async function post(model, payload) {
  const res = await fetch(`${API_BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify(payload),
  });
  if (res.ok) return { ok: true, data: await res.json() };
  return { ok: false, status: res.status, body: await res.text() };
}

/**
 * POSTs `payload` to generateContent and returns the parsed response body.
 * Throws `${label} ${status}: ${body}` on any non-2xx — the body is included
 * because "Gemini 400" on its own is what made the last outage unreadable.
 *
 * @param {object} payload  request body WITHOUT any thinkingConfig — this owns it
 * @param {object} [opts]
 * @param {boolean} [opts.thinkingOff]  ask the model not to think (default: no).
 *   When set, the right knob for the model is chosen, and a 400 on the first
 *   attempt is retried ONCE with the other generation's knob. Only a 400 can be
 *   a wrong-knob error — 404 is a missing model and 429/5xx are the service —
 *   so nothing else is retried, or we would double every outage.
 * @param {string} [opts.label]  error prefix, e.g. 'Gemini vision'
 */
export async function geminiFetch(payload, opts = {}) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  const model = geminiModel();
  const label = opts.label || 'Gemini';

  if (!opts.thinkingOff) {
    const r = await post(model, payload);
    if (r.ok) return r.data;
    throw new Error(`${label} ${r.status}: ${r.body.slice(0, 500)}`);
  }

  const knob = pickThinkingKnob(model);
  let r = await post(model, withKnob(payload, knob));
  if (r.ok) {
    resolvedKnob.set(model, knob);
    return r.data;
  }

  // Already learned this model's knob, or a failure a different knob can't fix.
  if (r.status !== 400 || resolvedKnob.get(model) === knob) {
    throw new Error(`${label} ${r.status}: ${r.body.slice(0, 500)}`);
  }

  const other = knob === BUDGET ? LEVEL : BUDGET;
  console.warn(`Gemini 400 with ${knob} on "${model}" — retrying with ${other}`);
  r = await post(model, withKnob(payload, other));
  if (!r.ok) {
    throw new Error(`${label} ${r.status} (tried ${knob} and ${other}): ${r.body.slice(0, 500)}`);
  }
  resolvedKnob.set(model, other);
  console.warn(`Gemini: "${model}" accepts ${other} — knob resolved for this instance`);
  return r.data;
}

/** The concatenated text of a generateContent response (never null). */
export function geminiText(data) {
  return (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || '')
    .join('')
    .trim();
}
