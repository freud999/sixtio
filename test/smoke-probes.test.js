// The health check must not be the thing that is broken.
//
// /envcheck reported "❌ Gemini: geminiModelInUse is not defined" in production
// on 2026-08-05. The dependency was fine; the probe referenced a name that a
// re-export (`export { x } from …`) never binds locally, and probe()'s own
// try/catch turned that ReferenceError into a verdict about Google.
//
// A health check that can blame a dependency for its own defect is worse than
// none, because it sends you to fix the wrong system. So: run every probe with
// the network stubbed and assert that no failure is an internal error.
import test from 'node:test';
import assert from 'node:assert/strict';
import { smokeEnv, geminiModelInUse, geminiModelLightInUse, kinkModelInUse } from '../api/_lib/env.js';

const realFetch = globalThis.fetch;

test('no probe fails with an internal error of its own', async () => {
  const saved = { ...process.env };
  Object.assign(process.env, {
    GEMINI_API_KEY: 'AQ.test', ANTHROPIC_API_KEY: 'sk-ant-test',
    SUPABASE_URL: 'https://x.supabase.co', SUPABASE_SERVICE_ROLE_KEY: 'sb_secret_test',
    TELEGRAM_BOT_TOKEN: '123456:AAtest', APP_URL: 'https://sixtio.vercel.app',
  });
  // Everything answers plausibly, so any failure left is ours, not theirs.
  globalThis.fetch = async () => ({
    ok: true, status: 200,
    headers: { get: () => null },
    json: async () => ({
      ok: true,
      result: { username: 'Sixtiobot', url: 'https://sixtio.vercel.app/api/chat', pending_update_count: 0 },
      candidates: [{ content: { parts: [{ text: 'ok' }] } }],
    }),
    text: async () => '{}',
  });

  try {
    const results = await smokeEnv();
    for (const r of results) {
      assert.doesNotMatch(r.detail, /is not defined|is not a function|Cannot read/,
        `probe "${r.name}" failed with its own bug, not the dependency's: ${r.detail}`);
    }
    // And the probes we added must actually be present.
    const names = results.map((r) => r.name);
    // Renamed 2026-08-29 from "Gemini light" to what it means for a user: this
    // is the model translation actually runs on, and its failure shows profiles
    // in a language the reader cannot read.
    assert.ok(names.includes('Gemini translation'), 'the model translation uses must be probed');
    assert.ok(names.includes('Gemini fallback'), 'and the spare, so a silent single point of failure is visible');
    assert.ok(names.includes('Telegram webhook'), 'the inbound channel must be probed');
  } finally {
    globalThis.fetch = realFetch;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
});

test('the model accessors are callable, not just exported', () => {
  // The exact failure: a name can be exported and still unbound where it is used.
  for (const fn of [geminiModelInUse, geminiModelLightInUse, kinkModelInUse]) {
    assert.equal(typeof fn, 'function');
    assert.ok(fn().length > 0);
  }
});
