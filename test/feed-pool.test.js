// F-10 / SCALE-3: how the swipe deck picks which candidates to load.
//
// The bug this file exists to prevent shipped for a day and was invisible:
// capping the CANDIDATE query by last_active while capping the COMPATIBILITY
// query by score gives two different sets of 300. Past 300 profiles, an active
// person whose score ranked 301st lands in the deck with no score attached and
// is shown as 0% compatible. Not "unscored" — WRONG, on the number the whole
// product is sold on.
//
// It cannot be caught by opening the app: production has 8 users and the fault
// needs more than POOL_MAX. So it is pinned here instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mergePool } from '../api/feed.js';

const rows = (...ids) => ids.map((id) => ({ id }));

test('scored candidates already in the pool are never displaced by fill', () => {
  const pool = rows('scored-1', 'scored-2');
  mergePool(pool, rows('active-1', 'scored-1', 'active-2'), 4);
  assert.deepEqual(pool.map((r) => r.id), ['scored-1', 'scored-2', 'active-1', 'active-2']);
});

test('the ceiling is absolute, and the scored ones are what survive it', () => {
  const pool = rows('a', 'b', 'c');
  mergePool(pool, rows('x', 'y', 'z'), 4);
  assert.equal(pool.length, 4);
  assert.deepEqual(pool.map((r) => r.id), ['a', 'b', 'c', 'x']);
});

test('a full pool takes nothing more', () => {
  const pool = rows('a', 'b');
  mergePool(pool, rows('x'), 2);
  assert.deepEqual(pool.map((r) => r.id), ['a', 'b']);
});

test('duplicates inside the fill itself are dropped too', () => {
  // Two bounded reads can legitimately return the same row twice; a deck that
  // shows the same person twice reads as a broken app.
  const pool = [];
  mergePool(pool, rows('x', 'x', 'y', 'y', 'x'), 10);
  assert.deepEqual(pool.map((r) => r.id), ['x', 'y']);
});

test('empty or missing fill is not an error — a new market has nobody to add', () => {
  const pool = rows('a');
  mergePool(pool, [], 5);
  mergePool(pool, null, 5);
  mergePool(pool, undefined, 5);
  assert.deepEqual(pool.map((r) => r.id), ['a']);
});

test('fill still works when nothing is scored yet — the launch case', () => {
  // At launch almost nobody has a Big Five vector. If the deck only ever showed
  // scored profiles it would be empty on day one, which is the opposite of the
  // problem we were solving.
  const pool = [];
  mergePool(pool, rows('n1', 'n2', 'n3'), 300);
  assert.equal(pool.length, 3);
});
