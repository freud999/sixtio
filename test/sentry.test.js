// F-22 / OPS-1: error reporting that outlives the log retention.
//
// The rule this file exists to defend: REPORTING AN ERROR MUST NEVER CAUSE ONE.
// A monitoring system that can take the app down is worse than none, because it
// turns "we lost visibility" into "we lost the product". So most of these tests
// feed captureError things that should never happen and assert it stays quiet.
import test from 'node:test';
import assert from 'node:assert/strict';
import { captureError, sentryConfigured, resetSentry } from '../api/_lib/sentry.js';

function withDsn(value, fn) {
  const prev = process.env.SENTRY_DSN;
  if (value === undefined) delete process.env.SENTRY_DSN; else process.env.SENTRY_DSN = value;
  resetSentry();
  try { return fn(); } finally {
    if (prev === undefined) delete process.env.SENTRY_DSN; else process.env.SENTRY_DSN = prev;
    resetSentry();
  }
}

/** Replaces global fetch and records what would have been sent. */
function captureFetch(fn) {
  const real = globalThis.fetch;
  const calls = [];
  globalThis.fetch = (url, opts) => { calls.push({ url, opts }); return Promise.resolve({ ok: true }); };
  try { fn(calls); } finally { globalThis.fetch = real; }
  return calls;
}

test('no DSN means no network call at all — not a silent failed one', () => {
  withDsn(undefined, () => {
    assert.equal(sentryConfigured(), false);
    const calls = captureFetch(() => captureError(new Error('boom'), { route: 'api/me' }));
    assert.equal(calls.length, 0);
  });
});

test('a malformed DSN reports nothing rather than throwing', () => {
  // Present-but-broken is the dangerous state: it reads as "monitoring is on".
  // /envcheck flags the shape; here we only require that it cannot crash a request.
  for (const bad of ['not a url', 'https://nokey.example.com/42', 'https://key@host', '   ']) {
    withDsn(bad, () => {
      assert.equal(sentryConfigured(), false, `should refuse: ${bad}`);
      const calls = captureFetch(() => captureError(new Error('boom')));
      assert.equal(calls.length, 0);
    });
  }
});

test('a valid DSN posts one envelope to the right endpoint', () => {
  withDsn('https://abc123@o1.ingest.example.com/456', () => {
    assert.equal(sentryConfigured(), true);
    const calls = captureFetch(() => captureError(new Error('kaboom'), { route: 'api/feed', userId: 'u-1' }));
    assert.equal(calls.length, 1);
    assert.match(calls[0].url, /^https:\/\/o1\.ingest\.example\.com\/api\/456\/envelope\/\?sentry_key=abc123/);
    const lines = calls[0].opts.body.trim().split('\n');
    assert.equal(lines.length, 3, 'envelope is header + item header + payload');
    const event = JSON.parse(lines[2]);
    assert.equal(event.exception.values[0].value, 'kaboom');
    assert.equal(event.tags.route, 'api/feed');
    assert.equal(event.user.id, 'u-1');
  });
});

test('a throwing fetch does not escape captureError', () => {
  // The realistic version of this is DNS failing during the incident that
  // produced the error in the first place.
  withDsn('https://k@h.example.com/1', () => {
    const real = globalThis.fetch;
    globalThis.fetch = () => { throw new Error('network is down'); };
    try {
      assert.doesNotThrow(() => captureError(new Error('original problem')));
    } finally { globalThis.fetch = real; }
  });
});

test('non-Error values are accepted — callers catch whatever was thrown', () => {
  withDsn('https://k@h.example.com/1', () => {
    for (const weird of ['a string', null, undefined, 42, { nope: true }]) {
      assert.doesNotThrow(() => captureFetch(() => captureError(weird)));
    }
  });
});

test('no user text is sent — only ids and route names', () => {
  // Same reasoning that moved Art. 9 data off Gemini (PRIV-1): this leaves our
  // infrastructure. The context object has no field for free text, and this
  // pins that an answer smuggled into `extra` is the caller's choice, never a
  // default of the reporter.
  withDsn('https://k@h.example.com/1', () => {
    const calls = captureFetch(() => captureError(new Error('failed'), { route: 'api/answer', userId: 'u-9' }));
    const event = JSON.parse(calls[0].opts.body.trim().split('\n')[2]);
    assert.equal(event.extra, undefined);
    assert.equal(event.server_name, undefined);
    assert.deepEqual(Object.keys(event.user), ['id']);
  });
});
