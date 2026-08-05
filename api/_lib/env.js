// Environment validation.
//
// Three outages in one day (Invalid supabaseUrl, Gemini 404, a retention cron
// that had been dead for 14 hours) shared one shape: a configuration value was
// wrong, nothing crashed loudly enough to notice, and the only record was a log
// line nobody was reading. This module checks the SHAPE of every value the app
// depends on, so a broken one is caught at the first cold start rather than a
// day later.
//
// validateEnv is PURE — it reads the object it is handed, never process.env,
// never the network — so the whole rule set is unit-testable (test/env.test.js).
//
// OWNER_TELEGRAM_ID is checked FIRST and at its own severity, because it is the
// alarm channel itself: with it unset, notifyOwner is a silent no-op and every
// other alert in this file — and everywhere else in the app — goes nowhere.

/** `vercel env pull` returns this literal for Sensitive-flagged variables. */
const SENSITIVE_PLACEHOLDER = '[SENSITIVE]';

export const LEVEL = {
  /** The alarm channel is broken: nothing else can report itself. */
  ALARM: 'alarm',
  /** The app cannot serve requests correctly with this value. */
  FATAL: 'fatal',
  /** A feature is silently degraded; the app still runs. */
  WARN: 'warn',
};

/**
 * The failure modes that are not about any one variable's meaning — the ways a
 * value gets mangled in transit between a password manager, a shell and the
 * Vercel dashboard. SUPABASE_URL died of exactly one of these, so they are
 * checked before (and independently of) every format rule below.
 */
function genericProblem(raw) {
  const s = String(raw);
  if (s === SENSITIVE_PLACEHOLDER) {
    return 'is the literal [SENSITIVE] placeholder (a `vercel env pull` artifact, not a real value)';
  }
  if (/[\r\n]/.test(s)) return 'contains a line break';
  if (s !== s.trim()) return 'has leading or trailing whitespace';
  if (s.length >= 2 && /^(["']).*\1$/s.test(s)) return 'is wrapped in quotes';
  return null;
}

const isPositiveInt = (s) => /^\d+$/.test(s) && Number(s) > 0;

function httpsUrlProblem(s, { host } = {}) {
  let url;
  try {
    url = new URL(s);
  } catch {
    return 'is not a valid URL';
  }
  if (url.protocol !== 'https:') return `must be https, got ${url.protocol.replace(':', '')}`;
  if (host && !url.hostname.endsWith(host)) return `host must end with ${host}, got ${url.hostname}`;
  return null;
}

// Order matters: this is the order problems are reported in, and the owner id
// leads so a broken alarm channel is the first thing read.
const CHECKS = [
  {
    name: 'OWNER_TELEGRAM_ID',
    level: LEVEL.ALARM,
    required: true,
    hint: 'every alert the app can raise is delivered to this Telegram id',
    format: (s) => (isPositiveInt(s) ? null : 'must be a positive integer Telegram id'),
  },
  {
    name: 'SUPABASE_URL',
    level: LEVEL.FATAL,
    required: true,
    hint: 'every database read and write',
    format: (s) => httpsUrlProblem(s, { host: '.supabase.co' }),
  },
  {
    name: 'SUPABASE_SERVICE_ROLE_KEY',
    level: LEVEL.FATAL,
    required: true,
    hint: 'the server bypasses RLS with this key; without it every query is denied',
    format: (s) =>
      /^(sb_secret_|eyJ)/.test(s) ? null : 'must start with sb_secret_ (current) or eyJ (legacy JWT)',
  },
  {
    name: 'TELEGRAM_BOT_TOKEN',
    level: LEVEL.FATAL,
    required: true,
    hint: 'initData signature checks AND every bot message',
    format: (s) =>
      /^\d{6,}:[A-Za-z0-9_-]{30,}$/.test(s) ? null : 'must look like 123456789:AA...',
  },
  {
    name: 'ANTHROPIC_API_KEY',
    level: LEVEL.FATAL,
    required: true,
    hint: 'matching and the Digital Twin',
    format: (s) => (s.startsWith('sk-ant-') ? null : 'must start with sk-ant-'),
  },
  {
    name: 'GEMINI_API_KEY',
    level: LEVEL.FATAL,
    required: true,
    hint: 'photo moderation, personality analysis, translation, AI reports',
    // Google is retiring the key format itself, not just individual keys. "AQ."
    // auth keys are what AI Studio issues now; "AIza" standard keys still work
    // but the Gemini API stops accepting them in September 2026. A rule that
    // only knew the old shape rejected a working new key — a validator that
    // calls a good credential broken is worse than no validator, because it
    // sends you looking in the wrong place. So: both are accepted, and the one
    // with an expiry date says so at WARN rather than blocking anything.
    format: (s) => {
      if (s.startsWith('AQ.')) return null;
      if (s.startsWith('AIza')) {
        return {
          level: LEVEL.WARN,
          problem: 'is a legacy AIza standard key — the Gemini API rejects these from ' +
                   'September 2026; reissue it in AI Studio as an AQ. auth key',
        };
      }
      return 'must start with AQ. (current auth key) or AIza (legacy, retired September 2026)';
    },
  },
  {
    name: 'CRON_SECRET',
    level: LEVEL.WARN,
    required: true,
    hint: 'retention pushes stop silently without it — this is how they died for 14h',
    format: (s) => (s.length >= 16 ? null : 'must be at least 16 characters'),
  },
  {
    name: 'APP_URL',
    level: LEVEL.WARN,
    required: false,
    hint: 'a wrong value ships broken links in every bot message',
    format: (s) => httpsUrlProblem(s),
  },
  {
    name: 'BOT_USERNAME',
    level: LEVEL.WARN,
    required: false,
    hint: 'a wrong value ships dead referral links',
    format: (s) =>
      /^[A-Za-z0-9_]{5,32}$/.test(s) ? null : 'must be a bare Telegram username, no @ and no URL',
  },
  {
    name: 'TELEGRAM_WEBHOOK_SECRET',
    level: LEVEL.WARN,
    required: false,
    hint: 'guards the bot webhook',
    format: (s) => (s.length >= 8 ? null : 'must be at least 8 characters'),
  },
  {
    name: 'ADMIN_TELEGRAM_IDS',
    level: LEVEL.WARN,
    required: false,
    hint: 'a malformed list silently leaves admins without access',
    format: (s) =>
      s.split(',').every((p) => isPositiveInt(p.trim()))
        ? null
        : 'must be comma-separated positive integer Telegram ids',
  },
  ...['CLAUDE_MODEL', 'MATCH_MODEL', 'FOLLOWUP_MODEL', 'KINK_MODEL', 'WHY_MODEL',
      'GEMINI_MODEL', 'GEMINI_MODEL_LIGHT'].map((name) => ({
    name,
    level: LEVEL.WARN,
    required: false,
    hint: 'an unknown model name fails at call time, not here',
    format: (s) =>
      /^[A-Za-z0-9][A-Za-z0-9.-]*$/.test(s) ? null : 'is not a plausible model id',
  })),
];

/**
 * Checks a plain object of environment values against every rule above.
 * Returns `[{ name, level, problem }]`, empty when everything looks sane.
 * Never throws, never reads process.env, never touches the network.
 *
 * Only the SHAPE is checked here. "This key is accepted by the service" cannot
 * be answered without a live call — that is what the cron smoke test does.
 */
export function validateEnv(env) {
  const source = env || {};
  const problems = [];

  for (const check of CHECKS) {
    const raw = source[check.name];

    if (raw === undefined || raw === null || String(raw) === '') {
      if (check.required) problems.push({ name: check.name, level: check.level, problem: 'is not set' });
      continue;
    }

    const generic = genericProblem(raw);
    if (generic) {
      problems.push({ name: check.name, level: check.level, problem: generic });
      continue;
    }

    // A format rule returns either a problem string (reported at the check's own
    // level) or { problem, level } when the value is USABLE but worth flagging at
    // a different severity — a credential with an announced end-of-life is the
    // case this exists for.
    const bad = check.format(String(raw));
    if (bad) {
      const { problem, level } = typeof bad === 'string' ? { problem: bad, level: null } : bad;
      problems.push({ name: check.name, level: level || check.level, problem });
    }
  }

  return problems;
}

/** The one-line hint explaining what a variable is for (empty if unknown). */
export function hintFor(name) {
  const check = CHECKS.find((c) => c.name === name);
  return check ? check.hint : '';
}

/**
 * The verdict on a getWebhookInfo response: a problem string, or null when the
 * inbound channel is healthy. PURE, so the rules are unit-testable — the whole
 * point is that this judgement is never again made only by a human reading JSON.
 *
 * @param {object} info      the `result` of getWebhookInfo
 * @param {string} [appUrl]  APP_URL; when set, the webhook must point at its /api/chat
 */
export function webhookProblem(info, appUrl) {
  const w = info || {};
  if (!w.url) {
    return 'NOT SET — every /start, /stats and Stars payment is being dropped';
  }
  if (appUrl) {
    const expected = `${String(appUrl).replace(/\/+$/, '')}/api/chat`;
    if (w.url !== expected) return `points at ${w.url}, expected ${expected}`;
  }
  // A backlog means updates ARE arriving and are not being consumed — a
  // different failure from "not set", and just as quiet from the outside.
  const pending = Number(w.pending_update_count || 0);
  if (pending > 50) return `${pending} updates queued — the endpoint is failing or too slow`;
  if (w.last_error_message) {
    return `last delivery failed: ${String(w.last_error_message).slice(0, 100)}`;
  }
  return null;
}

/** True if the alarm channel itself is among the problems. */
export function alarmChannelBroken(problems) {
  return (problems || []).some((p) => p.level === LEVEL.ALARM);
}

/** Renders problems as plain lines. Never includes a value, only a diagnosis. */
export function formatProblems(problems) {
  return (problems || [])
    .map((p) => `[${p.level}] ${p.name} ${p.problem} — ${hintFor(p.name)}`)
    .join('\n');
}

// --- reporting ------------------------------------------------------------
// Runs once per process (i.e. once per cold-started lambda), the same dedupe
// shape as telegram.js's prod-fake-auth alert. A redeploy will produce a handful
// of duplicate alerts while the lambdas warm up; that is the price of not
// depending on the database, which is itself a candidate for being the broken
// thing.

let reported = false;

/**
 * Validates process.env and reports anything wrong to BOTH channels: console
 * (always — it reaches Vercel's runtime errors even when everything else is
 * broken) and Telegram (best-effort). Returns the problems it found.
 *
 * DELIBERATELY NEVER THROWS. This runs at module load, so throwing would turn a
 * typo in APP_URL into a total outage of all eleven database-backed functions —
 * strictly worse than the silent failure it exists to prevent. Values that are
 * genuinely fatal still fail where they are used, exactly as before; the only
 * thing that changes is that someone finds out immediately.
 */
export function reportEnvOnce(env) {
  if (reported) return [];
  reported = true;

  const problems = validateEnv(env || process.env);
  if (!problems.length) return problems;

  const body = formatProblems(problems);
  console.error(`Environment check failed:\n${body}`);
  if (alarmChannelBroken(problems)) {
    console.error(
      'OWNER_TELEGRAM_ID IS BROKEN — no Telegram alert can be delivered for this ' +
      'or any other problem. This log line is the only notice you will get.'
    );
  }

  // Dynamic import keeps this synchronous and avoids the supabase -> bot ->
  // photos -> supabase import cycle. notifyOwner no-ops without an owner id and
  // never throws, so a dead alarm channel cannot break module loading.
  import('./bot.js')
    .then((m) => m.notifyOwner(
      `🚨 <b>Environment check failed</b> on ${process.env.VERCEL_ENV || 'local'}:\n` +
      `<pre>${body.replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]))}</pre>`
    ))
    .catch(() => {});

  return problems;
}

/** Test seam: forgets that a report was already made. */
export function resetEnvReportForTests() {
  reported = false;
}

// --- live smoke test ------------------------------------------------------
// Shape validation cannot answer the only question that actually matters —
// "does this credential still work?". Today's Gemini 404 is the proof: the value
// was never touched, the model was retired underneath it, and every shape rule
// in this file would have passed it. That needs a real call.
//
// It runs from the retention cron (already scheduled, already authorized,
// off the request path) and from the owner's /envcheck command. Never from a
// user request: three round-trips is far too much to put in a hot path.

// NOTE the import-then-export shape below. This was written as
//   export { geminiModel as geminiModelInUse } from './geminifetch.js';
// which forwards the export but creates NO local binding — so every use of
// geminiModelInUse() inside smokeEnv threw "is not defined". The probe's own
// try/catch then dutifully reported it as "❌ Gemini", i.e. the health check
// blamed the dependency for a bug in the health check. It went unseen because
// the webhook was down, so /envcheck could not be run at all. Import first,
// then re-export the local names.
import { geminiFetch, geminiModel, geminiModelLight } from './geminifetch.js';
import { kinkModelInUse } from './claude.js';

/** The models the app will actually use. Re-exported from the one place that
 *  resolves each, so /envcheck can never report a model the callers don't use —
 *  a duplicated default is how the last one drifted out of sight. */
const geminiModelInUse = geminiModel;
const geminiModelLightInUse = geminiModelLight;
export { geminiModelInUse, geminiModelLightInUse, kinkModelInUse };

async function probe(name, fn) {
  try {
    const detail = await fn();
    return { name, ok: true, detail: detail || 'ok' };
  } catch (e) {
    return { name, ok: false, detail: String((e && e.message) || e).slice(0, 200) };
  }
}

/**
 * One cheap live call per external dependency.
 * Returns `[{ name, ok, detail }]` and never throws — a caller can always
 * report the result. Details never contain a credential.
 */
export async function smokeEnv() {
  return [
    await probe('Supabase', async () => {
      const { getSupabase } = await import('./supabase.js');
      const { error, count } = await getSupabase()
        .from('users')
        .select('id', { count: 'exact', head: true });
      if (error) throw new Error(error.message);
      return `${count ?? 0} users`;
    }),

    await probe('Telegram', async () => {
      const { callBot } = await import('./bot.js');
      const me = await callBot('getMe', {});
      return `@${me.username}`;
    }),

    // The INBOUND channel, and the reason this probe exists.
    //
    // Measured 2026-08-05: the webhook had been unset for ~10 days — a token
    // rotation clears it — and nothing noticed, because everything that reports
    // on the bot is OUTBOUND. Alerts arrived, getMe answered, the domain served.
    // Meanwhile every /start went unanswered, so nobody got the "open the app"
    // button, so there were zero signups for ten days. 369 updates were sitting
    // in Telegram's queue.
    //
    // The lesson is the same one as the model list: a healthy outbound call is
    // not evidence of a healthy inbound path. Only getWebhookInfo is.
    await probe('Telegram webhook', async () => {
      const { callBot } = await import('./bot.js');
      const info = await callBot('getWebhookInfo', {});
      const bad = webhookProblem(info, process.env.APP_URL);
      if (bad) throw new Error(bad);
      const pending = Number(info.pending_update_count || 0);
      return `ok${pending ? ` · ${pending} queued` : ''}`;
    }),

    await probe('Gemini', async () => {
      if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
      const wanted = geminiModelInUse();
      // Deliberately NOT models.list. That list is not evidence: measured
      // 2026-08-03, gemini-2.5-flash appears in it AND advertises
      // generateContent, yet every real call returns 404 "no longer available
      // to new users". A check built on the list would have reported the dead
      // model healthy for all seven days of the outage.
      //
      // So: send the smallest real request, through the same door the app uses.
      // That proves the key, the model, and the thinking knob at once — the
      // three things that were separately broken — and nothing less does.
      await geminiFetch(
        { contents: [{ role: 'user', parts: [{ text: 'ping' }] }] },
        { thinkingOff: true, label: 'Gemini generateContent' }
      );
      return wanted;
    }),

    // The light model is a SECOND thing that can be retired underneath us, and
    // it now carries translation and the photo safety gate. Checking only the
    // main model would report "Gemini ✅" while every upload was being refused.
    await probe('Gemini light', async () => {
      if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
      const wanted = geminiModelLightInUse();
      await geminiFetch(
        { contents: [{ role: 'user', parts: [{ text: 'ping' }] }] },
        { thinkingOff: true, light: true, label: 'Gemini light generateContent' }
      );
      return wanted;
    }),

    await probe('Anthropic', async () => {
      const key = process.env.ANTHROPIC_API_KEY;
      if (!key) throw new Error('ANTHROPIC_API_KEY is not set');
      // Deliberately NOT /v1/models. Same lesson as Gemini: a catalogue listing
      // is not evidence the model answers, and this key now carries the Dark
      // Mode interview — the one call that must never silently fail over to
      // anything else. So: the smallest real message, on the model that does it.
      const model = kinkModelInUse();
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': key,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model, max_tokens: 1, messages: [{ role: 'user', content: 'ping' }],
        }),
      });
      if (!res.ok) throw new Error(`messages ${res.status}: ${(await res.text()).slice(0, 120)}`);
      // Anthropic reports the tier's real headroom in the response headers —
      // the only honest answer to "how close are we to the next quota outage".
      const left = res.headers.get('anthropic-ratelimit-requests-remaining');
      const inputLeft = res.headers.get('anthropic-ratelimit-input-tokens-remaining');
      return [model, left && `${left} req left`, inputLeft && `${inputLeft} in-tok left`]
        .filter(Boolean).join(' · ');
    }),
  ];
}

/** Renders smoke results as a ✅/❌ list. Contains no values, only verdicts. */
export function formatSmoke(results) {
  return (results || [])
    .map((r) => `${r.ok ? '✅' : '❌'} ${r.name}: ${r.detail}`)
    .join('\n');
}
