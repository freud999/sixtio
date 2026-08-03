// Tests for environment shape validation: the alarm channel first, per-variable
// formats, and the generic ways a value gets mangled in transit.
// Pure logic only — no env, no network — run with `npm test` (node --test).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  validateEnv, formatProblems, alarmChannelBroken, hintFor, LEVEL,
  reportEnvOnce, resetEnvReportForTests,
} from '../api/_lib/env.js';

// A complete, well-formed environment. Every case below starts from this and
// breaks exactly one thing, so a failure names the rule that broke.
const GOOD = {
  OWNER_TELEGRAM_ID: '123456789',
  SUPABASE_URL: 'https://ncoiiwhjyocqvqqgebla.supabase.co',
  SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_abcdefghijklmnopqrstuvwxyz',
  TELEGRAM_BOT_TOKEN: '8012345678:AAH1zXcVbNmQwErTyUiOpAsDfGhJkLzXcVb',
  ANTHROPIC_API_KEY: 'sk-ant-api03-abcdefghijklmnop',
  GEMINI_API_KEY: 'AQ.Ab8RN6JabcdefghijklmnopqrstuvwxyZ0123456789',
  CRON_SECRET: 'a-sufficiently-long-cron-secret',
  APP_URL: 'https://sixtio.vercel.app',
  BOT_USERNAME: 'Sixtiobot',
  TELEGRAM_WEBHOOK_SECRET: 'webhook-secret',
  ADMIN_TELEGRAM_IDS: '123456789, 987654321',
  CLAUDE_MODEL: 'claude-opus-4-8',
  MATCH_MODEL: 'claude-sonnet-5',
  GEMINI_MODEL: 'gemini-2.5-flash',
};

const broken = (over) => validateEnv({ ...GOOD, ...over });
const nameOf = (problems) => problems.map((p) => p.name);
const only = (problems) => {
  assert.equal(problems.length, 1, `expected one problem, got ${JSON.stringify(problems)}`);
  return problems[0];
};

test('a well-formed environment reports nothing', () => {
  assert.deepEqual(validateEnv(GOOD), []);
});

test('an empty or missing environment reports every required variable', () => {
  for (const env of [{}, null, undefined]) {
    const problems = validateEnv(env);
    assert.deepEqual(nameOf(problems), [
      'OWNER_TELEGRAM_ID', 'SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY',
      'TELEGRAM_BOT_TOKEN', 'ANTHROPIC_API_KEY', 'GEMINI_API_KEY', 'CRON_SECRET',
    ]);
    assert.ok(problems.every((p) => p.problem === 'is not set'));
  }
});

// --- the alarm channel ----------------------------------------------------

test('OWNER_TELEGRAM_ID is reported FIRST — a broken alarm channel leads', () => {
  const problems = broken({ OWNER_TELEGRAM_ID: '', SUPABASE_URL: 'nonsense' });
  assert.equal(problems[0].name, 'OWNER_TELEGRAM_ID');
  assert.equal(problems[0].level, LEVEL.ALARM);
});

test('OWNER_TELEGRAM_ID has its own severity, above every other variable', () => {
  const alarms = validateEnv({}).filter((p) => p.level === LEVEL.ALARM);
  assert.deepEqual(nameOf(alarms), ['OWNER_TELEGRAM_ID']);
});

test('alarmChannelBroken distinguishes a dead alarm from ordinary breakage', () => {
  assert.equal(alarmChannelBroken(broken({ OWNER_TELEGRAM_ID: '0' })), true);
  assert.equal(alarmChannelBroken(broken({ APP_URL: 'not-a-url' })), false);
  assert.equal(alarmChannelBroken([]), false);
});

test('OWNER_TELEGRAM_ID rejects anything that is not a positive integer id', () => {
  for (const bad of ['0', '-5', 'me', '12.5', '12 34']) {
    assert.equal(only(broken({ OWNER_TELEGRAM_ID: bad })).name, 'OWNER_TELEGRAM_ID', bad);
  }
});

// --- the generic diseases -------------------------------------------------
// These are how SUPABASE_URL actually died, so they are checked on EVERY
// variable rather than being folded into any one format rule.

test('the literal [SENSITIVE] placeholder is caught on any variable', () => {
  for (const name of ['SUPABASE_URL', 'GEMINI_API_KEY', 'APP_URL', 'OWNER_TELEGRAM_ID']) {
    const p = only(broken({ [name]: '[SENSITIVE]' }));
    assert.equal(p.name, name);
    assert.match(p.problem, /\[SENSITIVE\] placeholder/);
  }
});

test('a line break is caught (the multiline paste)', () => {
  for (const bad of ['https://x.supabase.co\n', 'https://x.supabase.co\r\nmore']) {
    assert.match(only(broken({ SUPABASE_URL: bad })).problem, /line break/);
  }
});

test('leading or trailing whitespace is caught', () => {
  assert.match(only(broken({ SUPABASE_URL: ' https://x.supabase.co' })).problem, /whitespace/);
  assert.match(only(broken({ GEMINI_API_KEY: 'AIzaSyABCDEFGH ' })).problem, /whitespace/);
});

test('a quoted value is caught (the shell-quoting paste)', () => {
  assert.match(only(broken({ SUPABASE_URL: '"https://x.supabase.co"' })).problem, /quotes/);
  assert.match(only(broken({ BOT_USERNAME: "'Sixtiobot'" })).problem, /quotes/);
});

test('a legitimate apostrophe inside a value is not mistaken for quoting', () => {
  assert.deepEqual(broken({ CRON_SECRET: "it's-a-long-enough-secret" }), []);
});

// --- per-variable formats -------------------------------------------------

test('SUPABASE_URL must be an https supabase.co URL — the actual outage', () => {
  assert.match(only(broken({ SUPABASE_URL: 'ncoiiwhjyocqvqqgebla.supabase.co' })).problem, /not a valid URL/);
  assert.match(only(broken({ SUPABASE_URL: 'http://x.supabase.co' })).problem, /must be https/);
  assert.match(only(broken({ SUPABASE_URL: 'https://example.com' })).problem, /supabase\.co/);
});

test('SUPABASE_URL accepts both current and legacy service keys', () => {
  assert.deepEqual(broken({ SUPABASE_SERVICE_ROLE_KEY: 'eyJhbGciOiJIUzI1NiJ9.body.sig' }), []);
  assert.match(only(broken({ SUPABASE_SERVICE_ROLE_KEY: 'anon-key' })).problem, /sb_secret_/);
});

test('TELEGRAM_BOT_TOKEN must look like a bot token', () => {
  for (const bad of ['abc', '123:short', 'bot8012345678:AAH1zXcVbNmQwErTyUiOpAsDfGhJkLzXcVb']) {
    assert.equal(only(broken({ TELEGRAM_BOT_TOKEN: bad })).name, 'TELEGRAM_BOT_TOKEN', bad);
  }
});

test('AI keys are checked by their vendor prefix', () => {
  assert.match(only(broken({ ANTHROPIC_API_KEY: 'sk-proj-abc' })).problem, /sk-ant-/);
  const p = only(broken({ GEMINI_API_KEY: 'sk-ant-abc' }));
  assert.equal(p.level, LEVEL.FATAL);
  assert.match(p.problem, /AQ\./);
  assert.match(p.problem, /AIza/);
});

// Google is retiring the KEY FORMAT, not a key. A validator that called the new
// format broken sent us hunting through model names for a day and a half, so
// both shapes are pinned here explicitly.
test('an AQ. auth key is accepted with nothing to say about it', () => {
  assert.deepEqual(broken({ GEMINI_API_KEY: 'AQ.Ab8RN6Jzzz0123456789' }), []);
});

test('an AIza standard key still works but carries its expiry date', () => {
  const p = only(broken({ GEMINI_API_KEY: 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456' }));
  assert.equal(p.name, 'GEMINI_API_KEY');
  // WARN, not FATAL: the key works today, and blocking on it would take the app
  // down over a deadline that has not arrived.
  assert.equal(p.level, LEVEL.WARN);
  assert.match(p.problem, /September 2026/);
});

test('an expiring credential does not read as a broken alarm channel', () => {
  const problems = broken({ GEMINI_API_KEY: 'AIzaSyABCDEFGHIJKLMNOPQRSTUVWXYZ0123456' });
  assert.equal(alarmChannelBroken(problems), false);
});

test('CRON_SECRET must be long enough to be worth having', () => {
  assert.match(only(broken({ CRON_SECRET: 'short' })).problem, /16 characters/);
});

test('BOT_USERNAME must be a bare username, not an @handle or a link', () => {
  for (const bad of ['@Sixtiobot', 'https://t.me/Sixtiobot', 'bot']) {
    assert.equal(only(broken({ BOT_USERNAME: bad })).name, 'BOT_USERNAME', bad);
  }
});

test('ADMIN_TELEGRAM_IDS must be a clean id list', () => {
  assert.deepEqual(broken({ ADMIN_TELEGRAM_IDS: '1' }), []);
  assert.match(only(broken({ ADMIN_TELEGRAM_IDS: '123;456' })).problem, /comma-separated/);
  assert.match(only(broken({ ADMIN_TELEGRAM_IDS: '123,abc' })).problem, /comma-separated/);
});

// --- optional variables ---------------------------------------------------

test('optional variables are silent when unset, checked when present', () => {
  const optional = [
    'APP_URL', 'BOT_USERNAME', 'TELEGRAM_WEBHOOK_SECRET',
    'ADMIN_TELEGRAM_IDS', 'CLAUDE_MODEL', 'MATCH_MODEL', 'GEMINI_MODEL',
  ];
  for (const name of optional) {
    const env = { ...GOOD };
    delete env[name];
    assert.deepEqual(validateEnv(env), [], `${name} unset should be silent`);
  }
  assert.equal(only(broken({ APP_URL: 'not-a-url' })).level, LEVEL.WARN);
});

test('GEMINI_MODEL unset is silent — the live Gemini 404 is not a shape problem', () => {
  const env = { ...GOOD };
  delete env.GEMINI_MODEL;
  assert.deepEqual(validateEnv(env), []);
  // Shape validation cannot know a model was retired; only a live call can.
  assert.deepEqual(broken({ GEMINI_MODEL: 'gemini-2.5-flash' }), []);
});

// --- rendering ------------------------------------------------------------

test('formatProblems names the variable and the diagnosis, never a value', () => {
  const secret = 'AIzaTOTALLYSECRETVALUE';
  const text = formatProblems(broken({ GEMINI_API_KEY: ` ${secret} ` }));
  assert.match(text, /GEMINI_API_KEY/);
  assert.match(text, /whitespace/);
  assert.equal(text.includes(secret), false);
});

test('formatProblems is empty for a healthy environment', () => {
  assert.equal(formatProblems(validateEnv(GOOD)), '');
  assert.equal(formatProblems([]), '');
});

test('every reported variable carries a hint explaining what it breaks', () => {
  for (const p of validateEnv({})) assert.ok(hintFor(p.name).length > 0, p.name);
});

// --- reporting ------------------------------------------------------------
// reportEnvOnce runs at module load in _lib/supabase.js, so the contract that
// matters most is that it CANNOT take the app down.

test('reportEnvOnce never throws, however broken the environment is', () => {
  const quiet = mute();
  try {
    resetEnvReportForTests();
    assert.doesNotThrow(() => reportEnvOnce({}));
    resetEnvReportForTests();
    assert.doesNotThrow(() => reportEnvOnce(null));
    resetEnvReportForTests();
    assert.doesNotThrow(() => reportEnvOnce({ SUPABASE_URL: '[SENSITIVE]' }));
  } finally {
    quiet.restore();
  }
});

test('reportEnvOnce reports once per process, then stays quiet', () => {
  const quiet = mute();
  try {
    resetEnvReportForTests();
    assert.equal(reportEnvOnce({}).length > 0, true);
    assert.deepEqual(reportEnvOnce({}), [], 'second call must be a no-op');
  } finally {
    quiet.restore();
  }
});

test('reportEnvOnce is silent — and logs nothing — when everything is healthy', () => {
  const quiet = mute();
  try {
    resetEnvReportForTests();
    assert.deepEqual(reportEnvOnce(GOOD), []);
    assert.equal(quiet.lines.length, 0);
  } finally {
    quiet.restore();
  }
});

test('a dead alarm channel says so explicitly in the log', () => {
  const quiet = mute();
  try {
    resetEnvReportForTests();
    reportEnvOnce({ ...GOOD, OWNER_TELEGRAM_ID: '' });
  } finally {
    quiet.restore();
  }
  assert.match(quiet.lines.join('\n'), /OWNER_TELEGRAM_ID IS BROKEN/);
});

/** Captures console.error so the suite output stays readable. */
function mute() {
  const original = console.error;
  const lines = [];
  console.error = (...args) => lines.push(args.join(' '));
  return { lines, restore: () => { console.error = original; } };
}
