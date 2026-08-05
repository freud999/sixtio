// The free-tier budget and the negative cache — the two things that stand
// between six users and an exhausted Gemini quota. Run with `npm test`.
//
// Everything here fakes `fetch`, because the behaviour under test is precisely
// how many times (and whether) we go to the network.
import test from 'node:test';
import assert from 'node:assert/strict';
import {
  geminiFetch, isQuotaError, resetGeminiBudget, geminiBudgetState,
} from '../api/_lib/geminifetch.js';
import { localizeProfiles, resetTranslateFailures } from '../api/_lib/translate.js';

const PING = { contents: [{ role: 'user', parts: [{ text: 'ping' }] }] };
const OK_BODY = { candidates: [{ content: { parts: [{ text: '{}' }] } }] };

function fakeFetch(responses) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    calls.push({ url, init });
    const r = responses[Math.min(calls.length - 1, responses.length - 1)];
    return {
      ok: r.status === 200,
      status: r.status,
      json: async () => OK_BODY,
      text: async () => r.body || '',
    };
  };
  return calls;
}

const realFetch = globalThis.fetch;
function restore() { globalThis.fetch = realFetch; }

function withEnv(vars, fn) {
  const saved = {};
  for (const [k, v] of Object.entries(vars)) {
    saved[k] = process.env[k];
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(saved)) {
        if (v === undefined) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

test('the budget refuses the call that would exceed it, without a request', async () => {
  await withEnv({ GEMINI_API_KEY: 'test-key', GEMINI_MAX_RPM: '2' }, async () => {
    resetGeminiBudget();
    const calls = fakeFetch([{ status: 200 }]);
    try {
      await geminiFetch(PING);
      await geminiFetch(PING);
      assert.equal(calls.length, 2);

      // The third must not reach Google at all — spending a request to be told
      // we are out of requests is the exact loop this exists to break.
      await assert.rejects(() => geminiFetch(PING), (e) => {
        assert.ok(isQuotaError(e), 'must be a typed quota error');
        assert.ok(e.retryAfterSec > 0);
        return true;
      });
      assert.equal(calls.length, 2, 'no network call for a refused request');
    } finally { restore(); }
  });
});

test('a 429 from Google puts every model call on ice for its own window', async () => {
  await withEnv({ GEMINI_API_KEY: 'test-key', GEMINI_MAX_RPM: '10' }, async () => {
    resetGeminiBudget();
    const calls = fakeFetch([
      { status: 429, body: '{"error":{"details":[{"retryDelay":"21s"}]}}' },
    ]);
    try {
      await assert.rejects(() => geminiFetch(PING), (e) => {
        assert.ok(isQuotaError(e));
        assert.equal(e.retryAfterSec, 21, "Google's own window, not a guess");
        return true;
      });
      assert.equal(calls.length, 1);

      // Budget still had room — the cooldown, not the counter, is what stops us.
      await assert.rejects(() => geminiFetch(PING), isQuotaError);
      assert.equal(calls.length, 1, 'the cooldown suppresses the next request');
      assert.ok(geminiBudgetState().cooldownSec > 0);
    } finally { restore(); }
  });
});

test('the wrong-knob retry spends budget too, so it cannot outrun the limit', async () => {
  await withEnv({ GEMINI_API_KEY: 'test-key', GEMINI_MAX_RPM: '1' }, async () => {
    resetGeminiBudget();
    const calls = fakeFetch([{ status: 400, body: 'INVALID_ARGUMENT' }]);
    try {
      // First attempt burns the single unit; the knob retry has nothing left and
      // must report quota rather than quietly making a second request.
      await assert.rejects(
        () => geminiFetch(PING, { thinkingOff: true, label: 'Gemini' }),
        isQuotaError
      );
      assert.equal(calls.length, 1);
    } finally { restore(); }
  });
});

test('a 400 is still not a quota error — the two must never be conflated', async () => {
  await withEnv({ GEMINI_API_KEY: 'test-key', GEMINI_MAX_RPM: '10' }, async () => {
    resetGeminiBudget();
    fakeFetch([{ status: 400, body: 'INVALID_ARGUMENT' }]);
    try {
      await assert.rejects(() => geminiFetch(PING), (e) => {
        assert.equal(isQuotaError(e), false);
        return /400/.test(e.message);
      });
    } finally { restore(); }
  });
});

test('a failed translation is remembered, so the next view costs nothing', async () => {
  await withEnv({ GEMINI_API_KEY: 'test-key', GEMINI_MAX_RPM: '10' }, async () => {
    resetGeminiBudget();
    resetTranslateFailures();
    const calls = fakeFetch([{ status: 500, body: 'boom' }]);
    const items = [{
      key: 'a', userId: 'u1',
      profile: { lang: 'uk', vibe: 'тиха сила', summary_text: 'Ти шукаєш глибину.', traits_json: ['щира'] },
      user: { language_code: 'uk' },
    }];
    try {
      const first = await localizeProfiles(items, 'en');
      assert.equal(first.a.vibe, 'тиха сила', 'falls back to the original');
      assert.equal(calls.length, 1);

      // The whole bug: this second view used to issue the same doomed request.
      const second = await localizeProfiles(items, 'en');
      assert.equal(second.a.vibe, 'тиха сила');
      assert.equal(calls.length, 1, 'no second request within the negative TTL');
    } finally { restore(); }
  });
});

test('the negative cache is per language, not a blanket mute', async () => {
  await withEnv({ GEMINI_API_KEY: 'test-key', GEMINI_MAX_RPM: '10' }, async () => {
    resetGeminiBudget();
    resetTranslateFailures();
    const calls = fakeFetch([{ status: 500, body: 'boom' }]);
    const profile = { lang: 'uk', vibe: 'тиха сила', summary_text: 'Ти шукаєш глибину.', traits_json: ['щира'] };
    const items = [{ key: 'a', userId: 'u1', profile, user: { language_code: 'uk' } }];
    try {
      await localizeProfiles(items, 'en');
      await localizeProfiles(items, 'ru');
      assert.equal(calls.length, 2, 'a different reader language is a different question');
    } finally { restore(); }
  });
});

test('the two models have separate pools — spending one leaves the other whole', async () => {
  await withEnv({ GEMINI_API_KEY: 'test-key', GEMINI_MAX_RPM: '1', GEMINI_MAX_RPM_LIGHT: '2' }, async () => {
    resetGeminiBudget();
    const calls = fakeFetch([{ status: 200 }]);
    try {
      await geminiFetch(PING);                       // spends the strong model's only unit
      await assert.rejects(() => geminiFetch(PING), isQuotaError);
      assert.equal(calls.length, 1);

      // The whole reason for splitting: translation and photo moderation must
      // still work while an onboarding has the strong model saturated.
      await geminiFetch(PING, { light: true });
      await geminiFetch(PING, { light: true });
      assert.equal(calls.length, 3);
      assert.ok(/flash-lite/.test(calls[1].url), 'the light call goes to the light model');

      await assert.rejects(() => geminiFetch(PING, { light: true }), isQuotaError);
      assert.equal(calls.length, 3, 'the light pool has its own separate limit');
    } finally { restore(); }
  });
});

test('a 429 on one model does not put the other on ice', async () => {
  await withEnv({ GEMINI_API_KEY: 'test-key', GEMINI_MAX_RPM: '10', GEMINI_MAX_RPM_LIGHT: '10' }, async () => {
    resetGeminiBudget();
    let n = 0;
    globalThis.fetch = async (url) => {
      n += 1;
      const light = /flash-lite/.test(url);
      return {
        ok: light, status: light ? 200 : 429,
        json: async () => OK_BODY,
        text: async () => '{"error":{"details":[{"retryDelay":"30s"}]}}',
      };
    };
    try {
      await assert.rejects(() => geminiFetch(PING), isQuotaError);
      // Freezing both pools on one model's 429 would hand back the capacity the
      // split just bought — the quota is per model, so the cooldown is too.
      await geminiFetch(PING, { light: true });
      assert.equal(n, 2);
      assert.ok(geminiBudgetState().cooldownSec > 0, 'the strong model is on ice');
      assert.equal(geminiBudgetState('gemini-flash-lite-latest').cooldownSec, 0);
    } finally { restore(); }
  });
});

test('GEMINI_MODEL_LIGHT pointing at the main model collapses the pools, not doubles them', async () => {
  await withEnv({
    GEMINI_API_KEY: 'test-key', GEMINI_MAX_RPM: '1',
    GEMINI_MODEL: 'gemini-flash-latest', GEMINI_MODEL_LIGHT: 'gemini-flash-latest',
  }, async () => {
    resetGeminiBudget();
    const calls = fakeFetch([{ status: 200 }]);
    try {
      await geminiFetch(PING);
      await assert.rejects(() => geminiFetch(PING, { light: true }), isQuotaError);
      assert.equal(calls.length, 1, 'same model name = one shared window');
    } finally { restore(); }
  });
});
