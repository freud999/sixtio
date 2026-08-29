import { flagEnabled } from './flags.js';

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

// --- The free-tier budget ---------------------------------------------------
//
// gemini-3.6-flash allows 5 requests per MINUTE on the free tier. Measured
// 2026-08-03 with six users: we exhausted it, and then kept exhausting it,
// because nothing in the app knew the number existed. Every caller happily
// posted into a quota that had been empty for ten minutes, and each of those
// posts was itself a request Google counted against us.
//
// So the limit is enforced HERE, before the network, and a refusal is a typed
// error rather than a generic throw: callers must be able to tell "the quota is
// gone, degrade gracefully" from "the request was malformed". No queue — a
// queue would hold a lambda open for the 45 seconds until the window rolls, and
// Vercel bills that and then kills it at maxDuration anyway. Refuse fast.
// The quota is PER MODEL. Measured 2026-08-05, a 429 body names its own quota:
//   GenerateRequestsPerMinutePerProjectPerModel-FreeTier
// which is why splitting the work across two models is not a micro-optimisation
// but a second, independent pool. Budget it per model or the split buys nothing:
// one shared counter would refuse a flash-lite call because flash was busy.
const DEFAULT_MAX_RPM = 4;         // gemini-flash-latest measures 5; one below, so a racing instance still fits
const DEFAULT_MAX_RPM_LIGHT = 12;  // gemini-flash-lite-latest measures 15 (burst-tested 2026-08-05)
const WINDOW_MS = 60_000;

// Translation is the fastest call in the app and the least worth waiting for —
// its failure mode is "show the original", which costs nothing. Well inside
// vercel.json's maxDuration: 30, so a stall still leaves room to answer.
// 8s, not 12s — because there are now TWO attempts (main model, then the light
// one) and both have to finish inside vercel.json's maxDuration: 30 alongside
// everything else /api/me does. 8+8 leaves real headroom; 12+12 would not.
// Translation is also the least worth waiting for: its failure mode is "show
// the original text", which costs nothing.
const DEFAULT_TIMEOUT_MS = 8_000;

function timeoutMs() {
  const n = Number(process.env.GEMINI_TIMEOUT_MS);
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_TIMEOUT_MS;
}

function limitFor(isLight) {
  const n = Number(isLight ? process.env.GEMINI_MAX_RPM_LIGHT : process.env.GEMINI_MAX_RPM);
  if (Number.isFinite(n) && n > 0) return n;
  return isLight ? DEFAULT_MAX_RPM_LIGHT : DEFAULT_MAX_RPM;
}

function maxRpmFor(model) {
  const isLight = model === geminiModelLight();
  const isMain = model === geminiModel();
  // Both names resolving to the same model means ONE Google-side window, so the
  // allowance has to be the smaller of the two — not the lighter model's larger
  // one. Getting this backwards would let an operator raise the strong model's
  // limit to 12 against a 5 RPM quota by setting GEMINI_MODEL_LIGHT to it.
  if (isLight && isMain) return Math.min(limitFor(true), limitFor(false));
  return limitFor(isLight);
}

// model -> { times: ms timestamps we let through (ascending), cooldownUntil }.
// Keyed by the resolved model NAME, so pointing GEMINI_MODEL_LIGHT at the main
// model correctly collapses the two pools back into one instead of silently
// doubling the allowance.
const budgets = new Map();

function budgetFor(model) {
  let b = budgets.get(model);
  if (!b) { b = { times: [], cooldownUntil: 0 }; budgets.set(model, b); }
  return b;
}

/**
 * Thrown when a call was NOT made because the quota is spent — locally budgeted
 * or refused by Google with a 429. `retryAfterSec` is Google's own hint when we
 * have it. Distinct from every other failure on purpose: this is the one the
 * product degrades around instead of erroring.
 */
export class GeminiQuotaError extends Error {
  constructor(message, retryAfterSec) {
    super(message);
    this.name = 'GeminiQuotaError';
    this.code = 'gemini_quota';
    this.retryAfterSec = retryAfterSec;
  }
}

/** True for a quota refusal, ours or Google's. Use this, not `instanceof`. */
export function isQuotaError(e) {
  return !!e && e.code === 'gemini_quota';
}

/** Take one unit of `model`'s budget, or say how long until one frees up. */
function reserveCall(model) {
  const b = budgetFor(model);
  const now = Date.now();
  if (now < b.cooldownUntil) {
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil((b.cooldownUntil - now) / 1000)) };
  }
  while (b.times.length && b.times[0] <= now - WINDOW_MS) b.times.shift();
  if (b.times.length >= maxRpmFor(model)) {
    const retryMs = b.times[0] + WINDOW_MS - now;
    return { ok: false, retryAfterSec: Math.max(1, Math.ceil(retryMs / 1000)) };
  }
  b.times.push(now);
  return { ok: true };
}

// Google reports the window in the error body as `"retryDelay": "21s"`. Trusting
// it beats guessing: it is the only place the real remaining time is written.
function retryAfterFromBody(body) {
  const m = /"retryDelay"\s*:\s*"(\d+(?:\.\d+)?)s"/.exec(body || '');
  return m ? Math.max(1, Math.ceil(Number(m[1]))) : 30;
}

/** Test seam: forget every model's window and cooldown. */
export function resetGeminiBudget() {
  budgets.clear();
}

/** For diagnostics: { model, used, limit, cooldownSec } right now. */
export function geminiBudgetState(model) {
  const name = model || geminiModel();
  const b = budgetFor(name);
  const now = Date.now();
  while (b.times.length && b.times[0] <= now - WINDOW_MS) b.times.shift();
  return {
    model: name,
    used: b.times.length,
    limit: maxRpmFor(name),
    cooldownSec: now < b.cooldownUntil ? Math.ceil((b.cooldownUntil - now) / 1000) : 0,
  };
}

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

/** The cheap model for work that does not need the strong one: translation and
 *  the photo safety gate.
 *
 *  Measured 2026-08-05 by real generateContent calls (never by models.list):
 *  gemini-flash-lite-latest answers 200 for text, for vision with inlineData,
 *  and for responseMimeType: application/json — and its free window is 15 RPM
 *  against the main model's 5. Note gemini-2.5-flash-lite is LISTED and
 *  advertises generateContent yet 404s "no longer available to new users",
 *  which is the same trap that cost seven days. Only a real call is proof. */
export function geminiModelLight() {
  return process.env.GEMINI_MODEL_LIGHT || 'gemini-flash-lite-latest';
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

// Throws GeminiQuotaError instead of posting when the budget is spent, and
// converts a 429 from Google into the same error — so the two cases are one
// thing to the caller, which is what they are: no answer, come back later.
async function post(model, payload, label) {
  const slot = reserveCall(model);
  if (!slot.ok) {
    throw new GeminiQuotaError(
      `${label} skipped: free-tier budget spent on ${model}, retry in ${slot.retryAfterSec}s`,
      slot.retryAfterSec
    );
  }

  // fetch has NO default timeout, so a provider that accepts the connection and
  // then goes quiet holds the lambda until Vercel kills it at maxDuration — no
  // catch, no alert, no answer to the client. Translation is the fastest thing
  // we ask for, so its budget is tighter than Claude's.
  let res;
  try {
    res = await fetch(`${API_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify(payload),
      signal: AbortSignal.timeout(timeoutMs()),
    });
  } catch (e) {
    // A timeout must read as a timeout. "The operation was aborted" in a log at
    // 2am is how you end up debugging the wrong system.
    const timedOut = e && (e.name === 'TimeoutError' || e.name === 'AbortError');
    throw new Error(
      timedOut
        ? `${label} timed out after ${timeoutMs()}ms on ${model}`
        : `${label} request failed on ${model}: ${e.message}`
    );
  }
  if (res.ok) return { ok: true, data: await res.json() };

  const body = await res.text();
  if (res.status === 429) {
    // Google knows the real window; our local counter was evidently optimistic
    // (another instance, or a limit we guessed wrong). Believe the 429 and stop
    // calling entirely until it expires — retrying here is what turned one
    // exhausted minute into an exhausted afternoon.
    const retryAfterSec = retryAfterFromBody(body);
    // Only THIS model goes on ice — the quota is per model, so freezing the
    // other pool too would throw away the whole point of splitting them.
    budgetFor(model).cooldownUntil = Date.now() + retryAfterSec * 1000;
    throw new GeminiQuotaError(
      `${label} 429 on ${model}: quota exhausted, retry in ${retryAfterSec}s`,
      retryAfterSec
    );
  }
  return { ok: false, status: res.status, body };
}

/**
 * POSTs `payload` to generateContent and returns the parsed response body.
 * Throws `${label} ${status}: ${body}` on any non-2xx — the body is included
 * because "Gemini 400" on its own is what made the last outage unreadable.
 *
 * The one exception is quota: a spent budget or a 429 throws GeminiQuotaError
 * (test it with isQuotaError). Callers are expected to degrade on that one —
 * show the original text, skip the question — never to surface it as an error.
 *
 * @param {object} payload  request body WITHOUT any thinkingConfig — this owns it
 * @param {object} [opts]
 * @param {boolean} [opts.thinkingOff]  ask the model not to think (default: no).
 *   When set, the right knob for the model is chosen, and a 400 on the first
 *   attempt is retried ONCE with the other generation's knob. Only a 400 can be
 *   a wrong-knob error — 404 is a missing model and 429/5xx are the service —
 *   so nothing else is retried, or we would double every outage.
 * @param {string} [opts.label]  error prefix, e.g. 'Gemini vision'
 * @param {boolean} [opts.light]  route to the cheap model (geminiModelLight) and
 *   its own separate per-minute pool. For work where the strong model buys
 *   nothing: translation, the photo safety gate.
 */
export async function geminiFetch(payload, opts = {}) {
  // Kill switch (F-19). Reported as a quota refusal on purpose: "translation is
  // unavailable, show the original text" is already a fully handled, tested path
  // (the free tier runs out routinely). A switch that reuses an existing
  // degradation is a switch that has been tested; a new error type would not be.
  if (!flagEnabled('TRANSLATION_ENABLED')) {
    throw new GeminiQuotaError('translation is disabled by the TRANSLATION_ENABLED kill switch', 60);
  }
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  const model = opts.light ? geminiModelLight() : geminiModel();
  const label = opts.label || 'Gemini';

  // Falling back to the light model is only useful when it is a DIFFERENT
  // model — it has its own free-tier window (15 RPM vs 5) and its own load, so
  // it is genuinely a second chance rather than the same queue twice.
  const fallback = geminiModelLight();
  const canFallBack = !opts.light && !opts.noFallback && fallback !== model;

  try {
    return await attempt(model, payload, label, opts);
  } catch (e) {
    if (!canFallBack || !isTransient(e)) throw e;
    console.warn(`${label}: "${model}" is ${e.status === 503 ? 'overloaded' : 'not answering'} — retrying on "${fallback}"`);
    return attempt(fallback, payload, label, opts);
  }
}

/**
 * Transient = the request deserves a second chance on another model.
 *
 * Measured 2026-08-29: Google's free tier answered `503 "This model is
 * currently experiencing high demand"` and, more often, simply stopped
 * answering until the deadline. Neither is our bug and neither is permanent —
 * but a single attempt turned both into "profiles shown in the wrong language".
 *
 * A 429 is deliberately NOT here: the quota is spent, and hammering a second
 * model is how you spend that one too. It stays a typed refusal the caller
 * degrades around.
 */
function isTransient(e) {
  if (!e || e.code === 'gemini_quota') return false;
  if (e.status >= 500) return true;
  return /timed out after/.test(String(e.message || ''));
}

/** One model's worth of the request, including the thinking-knob dance. */
async function attempt(model, payload, label, opts) {
  const fail = (r, extra) => {
    const err = new Error(`${label} ${r.status}${extra || ''}: ${r.body.slice(0, 500)}`);
    err.status = r.status;   // so isTransient() can tell 503 from 400
    return err;
  };

  if (!opts.thinkingOff) {
    const r = await post(model, payload, label);
    if (r.ok) return r.data;
    throw fail(r);
  }

  const knob = pickThinkingKnob(model);
  let r = await post(model, withKnob(payload, knob), label);
  if (r.ok) {
    resolvedKnob.set(model, knob);
    return r.data;
  }

  // Already learned this model's knob, or a failure a different knob can't fix.
  if (r.status !== 400 || resolvedKnob.get(model) === knob) throw fail(r);

  const other = knob === BUDGET ? LEVEL : BUDGET;
  console.warn(`Gemini 400 with ${knob} on "${model}" — retrying with ${other}`);
  r = await post(model, withKnob(payload, other), label);
  if (!r.ok) throw fail(r, ` (tried ${knob} and ${other})`);
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
