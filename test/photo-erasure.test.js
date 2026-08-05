// SEC-1a: a failed photo erasure must be loud.
//
// deleteUserCascade discarded the result of storage.remove(). supabase-js
// returns { error } instead of throwing, so a refused delete produced no
// exception, no log line and no alert — while the user had already been told
// their account was gone. Under GDPR Art. 17 that is an unmet obligation nobody
// could have discovered, and on Hobby's 1-hour log retention, not even later.
//
// Driven through the real client with fetch stubbed, so the thing under test is
// our handling of supabase-js's actual contract, not a mock of it.
import test from 'node:test';
import assert from 'node:assert/strict';

process.env.SUPABASE_URL = 'https://stub.supabase.co';
process.env.SUPABASE_SERVICE_ROLE_KEY = 'sb_secret_stub';
process.env.TELEGRAM_BOT_TOKEN = '123456:AAstub';
process.env.OWNER_TELEGRAM_ID = '424242';

const { deleteUserCascade } = await import('../api/_lib/supabase.js');
const { resetAlertThrottle } = await import('../api/_lib/alerts.js');

const USER = '00000000-0000-4000-8000-000000000001';

/** Captures outbound calls; `storageOk` decides whether the delete succeeds. */
function stubFetch({ storageOk }) {
  const calls = [];
  globalThis.fetch = async (url, init) => {
    const u = String(url);
    calls.push({ url: u, body: init && init.body });
    if (u.includes('/storage/v1/object/photos') && !storageOk) {
      return {
        ok: false, status: 400,
        text: async () => '{"error":"Object not found","message":"Object not found"}',
        json: async () => ({ error: 'Object not found', message: 'Object not found' }),
        headers: new Map(),
      };
    }
    return {
      ok: true, status: 200,
      text: async () => '[]',
      json: async () => [],
      headers: new Map(),
    };
  };
  return calls;
}

const realFetch = globalThis.fetch;

test('a refused photo erasure raises an owner alert', async () => {
  resetAlertThrottle();
  const calls = stubFetch({ storageOk: false });
  try {
    await deleteUserCascade(USER);
  } finally {
    globalThis.fetch = realFetch;
  }

  const alert = calls.find((c) => c.url.includes('api.telegram.org') && c.url.includes('sendMessage'));
  assert.ok(alert, 'a failed erasure must reach the owner, not just the logs');
  assert.match(String(alert.body), /NOT erased/);
  assert.match(String(alert.body), /Art\. 17/);
});

test('a successful erasure stays silent — the alarm must not cry wolf', async () => {
  resetAlertThrottle();
  const calls = stubFetch({ storageOk: true });
  try {
    await deleteUserCascade(USER);
  } finally {
    globalThis.fetch = realFetch;
  }

  assert.ok(
    calls.some((c) => c.url.includes('/storage/v1/object/photos')),
    'the erasure must actually be attempted'
  );
  assert.equal(
    calls.some((c) => c.url.includes('sendMessage')), false,
    'no alert on the happy path, or the real one gets muted as noise'
  );
});
