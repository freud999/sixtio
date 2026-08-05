// F-19: operator kill switches.
//
// The dangerous bug in a kill switch is not that it fails to stop something —
// you find that out in the first minute of the incident. It is that a typo, an
// empty string or an unset variable silently stops something on an ordinary
// Tuesday, and nobody notices for a month. So most of these tests are about the
// OFF switch refusing to turn off.
import test from 'node:test';
import assert from 'node:assert/strict';
import { flagEnabled, flagStates, flagsDown, SWITCHES } from '../api/_lib/flags.js';

function withEnv(name, value, fn) {
  const had = Object.prototype.hasOwnProperty.call(process.env, name);
  const prev = process.env[name];
  if (value === undefined) delete process.env[name]; else process.env[name] = value;
  try { return fn(); } finally {
    if (had) process.env[name] = prev; else delete process.env[name];
  }
}

test('a switch nobody has ever set is ON', () => {
  for (const name of Object.keys(SWITCHES)) {
    withEnv(name, undefined, () => {
      assert.equal(flagEnabled(name), true, `${name} must default to on`);
    });
  }
});

test('junk, typos and empty values leave the feature ON — the important case', () => {
  // Every one of these is a plausible dashboard accident. None of them may take
  // a feature offline: the app must only go dark when someone says so clearly.
  for (const junk of ['', '   ', 'ture', 'yes please', 'disabled', 'null', 'undefined', 'ON']) {
    withEnv('FEED_ENABLED', junk, () => {
      assert.equal(flagEnabled('FEED_ENABLED'), true, `must stay on for ${JSON.stringify(junk)}`);
    });
  }
});

test('only an unambiguous "no" turns a feature off', () => {
  for (const off of ['false', 'FALSE', '0', 'off', 'no', ' Off ']) {
    withEnv('AI_ENABLED', off, () => {
      assert.equal(flagEnabled('AI_ENABLED'), false, `must switch off for ${JSON.stringify(off)}`);
    });
  }
});

test('an unknown switch name is ON — a typo in CODE must not disable anything either', () => {
  assert.equal(flagEnabled('NOT_A_REAL_SWITCH'), true);
});

test('every switch documents what it stops and how it degrades', () => {
  // The alert text is built from these. A switch nobody can interpret at 2am is
  // a switch that gets flipped wrongly, or not flipped when it should be.
  for (const [name, meta] of Object.entries(SWITCHES)) {
    assert.ok(meta.stops && meta.stops.length > 10, `${name} needs a real 'stops'`);
    assert.ok(meta.degrades && meta.degrades.length > 10, `${name} needs a real 'degrades'`);
  }
});

test('flagsDown reports exactly what is off, and nothing when all is well', () => {
  withEnv('PAYMENTS_ENABLED', 'false', () => {
    assert.deepEqual(flagsDown(), ['PAYMENTS_ENABLED']);
  });
  assert.deepEqual(flagsDown(), [], 'a clean environment has no switches down');
  assert.equal(flagStates().length, Object.keys(SWITCHES).length);
});
