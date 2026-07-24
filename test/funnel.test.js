import test from 'node:test';
import assert from 'node:assert/strict';
import { renderFunnel } from '../api/_lib/analytics.js';

const f = (o) => Object.fromEntries(
  Object.entries(o).map(([k, v]) => [k, typeof v === 'number' ? { users: v, events: v } : v])
);

test('nothing recorded yet renders nothing at all', () => {
  // A fresh install must show an honest blank, not a wall of zeros.
  assert.deepEqual(renderFunnel({}), []);
  assert.deepEqual(renderFunnel(null), []);
});

test('each step is a share of the step ABOVE it, not of the top', () => {
  const out = renderFunnel(f({
    start: 100, onboarding_complete: 50, first_like: 25, first_match: 5,
  })).join('\n');
  assert.match(out, /Онбординг: <b>50<\/b>\s+<i>\(50%\)<\/i>/);
  // 25 of 50 onboarded is 50% — NOT 25% of the 100 who started.
  assert.match(out, /Перший лайк: <b>25<\/b>\s+<i>\(50%\)<\/i>/);
  // 5 of the 25 who liked is 20%.
  assert.match(out, /Перший метч: <b>5<\/b>\s+<i>\(20%\)<\/i>/);
});

test('the first step shows no share — there is nothing above it', () => {
  const line = renderFunnel(f({ start: 100 })).find((l) => l.includes('Старт'));
  assert.ok(!line.includes('%'), `expected no percentage on the top step: ${line}`);
});

test('repeat purchases are reported alongside the buyer count', () => {
  const out = renderFunnel({
    paywall_open: { users: 10, events: 30 },
    purchase: { users: 3, events: 7 },
  }).join('\n');
  assert.match(out, /Купив: <b>3<\/b>/);       // 3 distinct people bought
  assert.match(out, /7 покупок/);              // …across 7 purchases
});

test('a single purchase per buyer does not add a redundant count', () => {
  const out = renderFunnel({ purchase: { users: 3, events: 3 } }).join('\n');
  assert.ok(!out.includes('покупок'), 'should not repeat 3 as "3 покупок"');
});

test('retention is measured against onboarded users, not against /start', () => {
  // Someone who never finished onboarding was never in the product to return TO.
  const out = renderFunnel(f({
    start: 1000, onboarding_complete: 100, return_d1: 50, return_d3: 20, return_d7: 10,
  })).join('\n');
  assert.match(out, /D1 <b>50<\/b> \(50%\)/);
  assert.match(out, /D3 <b>20<\/b> \(20%\)/);
  assert.match(out, /D7 <b>10<\/b> \(10%\)/);
});

test('a zero base never divides by zero', () => {
  const out = renderFunnel(f({ first_like: 5 })).join('\n');
  assert.ok(!out.includes('NaN'), out);
  assert.ok(!out.includes('Infinity'), out);
});
