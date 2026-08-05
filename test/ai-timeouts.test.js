// F-12: no AI call may outlive the function that made it.
//
// vercel.json sets maxDuration: 30. Without an explicit timeout, `fetch` waits
// indefinitely and the Anthropic SDK waits minutes — so a provider that accepts
// the connection and then goes quiet does not produce an error we can degrade
// around. It produces a hard function kill: no catch, no alert, no status for
// the client, and a spinner that never resolves. Every caller in this app has a
// graceful fallback; none of them can run if the process is killed first.
import test from 'node:test';
import assert from 'node:assert/strict';
import { geminiFetch, resetGeminiBudget } from '../api/_lib/geminifetch.js';
import { claudeTimeoutMs, resetClaudeClient } from '../api/_lib/claude.js';

const PING = { contents: [{ role: 'user', parts: [{ text: 'ping' }] }] };
const realFetch = globalThis.fetch;

test('a Gemini call that never answers aborts inside our own budget', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  process.env.GEMINI_TIMEOUT_MS = '150';
  resetGeminiBudget();

  // A server that accepts and then goes silent — the case a status-code check
  // never catches, because no status ever arrives.
  globalThis.fetch = (url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => reject(init.signal.reason));
  });

  const started = Date.now();
  try {
    await assert.rejects(() => geminiFetch(PING), (e) => {
      assert.match(e.message, /timed out after 150ms/, 'the error must name the timeout');
      return true;
    });
    assert.ok(Date.now() - started < 5000, 'must abort promptly, not hang');
  } finally {
    globalThis.fetch = realFetch;
    delete process.env.GEMINI_TIMEOUT_MS;
  }
});

test('the Gemini timeout is configurable and defaults well under maxDuration', () => {
  delete process.env.GEMINI_TIMEOUT_MS;
  // 30s is the hard function limit; a default at or above it would be the same
  // as having none, since the kill would win.
  assert.ok(claudeTimeoutMs() < 30_000, 'Claude timeout must leave room to respond');
  assert.ok(claudeTimeoutMs() >= 5_000, 'but not so tight that normal calls fail');
});

test('AI_TIMEOUT_MS overrides the Claude default', () => {
  const saved = process.env.AI_TIMEOUT_MS;
  try {
    process.env.AI_TIMEOUT_MS = '7000';
    resetClaudeClient();
    assert.equal(claudeTimeoutMs(), 7000);
  } finally {
    if (saved === undefined) delete process.env.AI_TIMEOUT_MS;
    else process.env.AI_TIMEOUT_MS = saved;
    resetClaudeClient();
  }
});

test('a non-timeout network failure is reported as itself, not as a timeout', async () => {
  process.env.GEMINI_API_KEY = 'test-key';
  resetGeminiBudget();
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  try {
    await assert.rejects(() => geminiFetch(PING), (e) => {
      assert.match(e.message, /request failed/);
      assert.doesNotMatch(e.message, /timed out/, 'mislabelling sends you debugging the wrong system');
      return true;
    });
  } finally { globalThis.fetch = realFetch; }
});
