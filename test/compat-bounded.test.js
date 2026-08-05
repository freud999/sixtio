// F-09 / F-11: compatibility and chat previews must ask for what they need.
//
// Before migration 042 all three callers ran the same unbounded RPC — score
// every scored profile, return them all — and the match list additionally ran
// three queries per match. Both are invisible at 6 users and degrade sharply
// with growth, which is exactly the class of bug that ships unnoticed.
//
// These tests drive a fake Supabase client, so they pin the SHAPE of the call
// (which RPC, which arguments, how many round trips) rather than the SQL. The
// SQL itself is verified against the real database in migration 042.
import test from 'node:test';
import assert from 'node:assert/strict';
import { compatibilityFor, compatibilityPage, latestMessages } from '../api/_lib/compat.js';

/** Records every rpc()/from() call and replays scripted answers. */
function fakeDb({ rpc = {}, rows = [] } = {}) {
  const calls = { rpc: [], from: [] };
  return {
    calls,
    rpc(name, args) {
      calls.rpc.push({ name, args });
      const h = rpc[name];
      if (!h) return Promise.resolve({ data: null, error: { message: `no function ${name}` } });
      return Promise.resolve(h(args));
    },
    from(table) {
      calls.from.push(table);
      const q = {
        select: () => q, eq: () => q, order: () => q,
        limit: () => Promise.resolve({ data: rows, error: null }),
      };
      return q;
    },
  };
}

test('a targeted score asks for exactly those ids, not the whole table', async () => {
  const db = fakeDb({
    rpc: {
      calculate_compatibility_for: () => ({
        data: [{ user_id: 'b', name: 'B', compatibility_tags: ['x'], compatibility_score: 77 }],
        error: null,
      }),
    },
  });
  const map = await compatibilityFor(db, 'a', ['b', 'c', 'b']);
  assert.equal(db.calls.rpc.length, 1);
  assert.equal(db.calls.rpc[0].name, 'calculate_compatibility_for');
  // De-duplicated, and the caller's own id list is passed through verbatim.
  assert.deepEqual(db.calls.rpc[0].args.p_user_ids, ['b', 'c']);
  assert.equal(map.get('b').score, 77);
  assert.deepEqual(map.get('b').tags, ['x']);
});

test('an empty id list costs zero queries', async () => {
  const db = fakeDb();
  assert.equal((await compatibilityFor(db, 'a', [])).size, 0);
  assert.equal(db.calls.rpc.length, 0);
});

test('a missing migration falls back to the old RPC instead of blanking scores', async () => {
  // The failure mode this prevents: rollback (or a stale schema cache) silently
  // showing every match at "no compatibility", which reads as a broken product.
  const db = fakeDb({
    rpc: {
      calculate_compatibility: () => ({
        data: [
          { user_id: 'b', compatibility_tags: [], compatibility_score: 55 },
          { user_id: 'z', compatibility_tags: [], compatibility_score: 91 },
        ],
        error: null,
      }),
    },
  });
  const map = await compatibilityFor(db, 'a', ['b']);
  assert.deepEqual(db.calls.rpc.map((c) => c.name),
    ['calculate_compatibility_for', 'calculate_compatibility']);
  assert.equal(map.get('b').score, 55);
  assert.equal(map.has('z'), false, 'the fallback must still return only what was asked for');
});

test('both RPCs failing degrades to an empty map, never a thrown request', async () => {
  const db = fakeDb();
  assert.equal((await compatibilityFor(db, 'a', ['b'])).size, 0);
});

test('the feed page passes its gender/age filter and a hard limit into SQL', async () => {
  const db = fakeDb({ rpc: { calculate_compatibility_page: () => ({ data: [], error: null }) } });
  await compatibilityPage(db, 'a', { gender: 'female', minAge: 20, maxAge: 40, limit: 300 });
  const args = db.calls.rpc[0].args;
  assert.equal(args.p_gender, 'female');
  assert.equal(args.p_min_age, 20);
  assert.equal(args.p_max_age, 40);
  assert.equal(args.p_limit, 300);
});

test("'any' seeking preference sends NULL, which must widen the deck, not empty it", async () => {
  const db = fakeDb({ rpc: { calculate_compatibility_page: () => ({ data: [], error: null }) } });
  await compatibilityPage(db, 'a', { gender: null, minAge: null, maxAge: null });
  const args = db.calls.rpc[0].args;
  assert.equal(args.p_gender, null);
  assert.equal(args.p_min_age, null);
  assert.equal(args.p_max_age, null);
});

test('chat previews for N matches cost ONE query', async () => {
  const db = fakeDb({
    rpc: {
      latest_messages_for_matches: () => ({
        data: [
          { match_id: 'm1', text: 'hi', sender_id: 'u1', created_at: 't1' },
          { match_id: 'm2', text: 'yo', sender_id: 'u2', created_at: 't2' },
        ],
        error: null,
      }),
    },
  });
  const map = await latestMessages(db, ['m1', 'm2', 'm3']);
  assert.equal(db.calls.rpc.length, 1);
  assert.equal(db.calls.from.length, 0, 'no per-match table reads');
  assert.equal(map.get('m1').text, 'hi');
  assert.equal(map.get('m1').senderId, 'u1');
  assert.equal(map.get('m3'), undefined, 'a match with no messages simply has no preview');
});

test('without the RPC, previews still appear — one query per match', async () => {
  const db = fakeDb({ rows: [{ text: 'hey', sender_id: 'u9', created_at: 't9' }] });
  const map = await latestMessages(db, ['m1', 'm2']);
  assert.deepEqual(db.calls.from, ['messages', 'messages']);
  assert.equal(map.get('m2').text, 'hey');
});
