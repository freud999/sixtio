// Recovery after the 47-day AI outage (2026-11-23).
//
// From 2026-10-06 to 2026-11-23 the Anthropic balance was empty: 38 people
// finished the interview and got no Digital Twin, and 17 photos were stored
// without the 18+ check. These tests pin the decisions that make recovery safe
// to run over and over, by hand or by cron, against a live database.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recoverStep } from '../api/_lib/recovery.js';

const recovery = readFileSync('api/_lib/recovery.js', 'utf8');
const photo = readFileSync('api/photo.js', 'utf8');
const profile = readFileSync('api/profile.js', 'utf8');
const commands = readFileSync('api/_lib/commands.js', 'utf8');
const m049 = readFileSync('supabase/migration-049-recovery.sql', 'utf8');

/** A Supabase stand-in where every query returns an empty list. */
function emptyDb() {
  const chain = () => {
    const q = {
      select: () => q, not: () => q, is: () => q, limit: () => q, eq: () => q, order: () => q,
      then: (ok) => Promise.resolve({ data: [], error: null, count: 0 }).then(ok),
    };
    return q;
  };
  return { rpc: () => Promise.resolve({ data: [], error: null }), from: chain };
}

test('nothing left means a clean null, and no AI is called', async () => {
  // The command reports "nothing left" on null. If an empty backlog ever made a
  // model call, re-running /recover after recovery finished would cost money.
  assert.equal(await recoverStep({ supabase: emptyDb() }), null);
});

test('photos are checked FIRST — they are already on screen', () => {
  // The deck reads candidates from users, not profiles: a person with no Twin
  // still appears, with their unchecked photo, on an 18+ product.
  assert.match(recovery,
    /return \(await phasePhotos\(supabase, concurrency\)\)\s*\|\| \(await phaseTwins\(supabase, concurrency\)\)\s*\|\| \(await phaseTraits\(supabase, concurrency\)\);/);
});

test('one phase per call, so a call always fits inside the 30s limit', () => {
  // Three AI round trips back to back is the pattern that killed /api/profile
  // at 30s in August. Each phase is one parallel round.
  assert.match(recovery, /Promise\.allSettled\(items\.map\(fn\)\)/);
  assert.match(recovery, /ONE PHASE PER CALL/);
});

test('a Twin is built before Big Five, never the other way round', () => {
  // A Big Five write creates the profiles row. If it came first and the Twin
  // failed, the "needs a Twin" check (a MISSING row) would never fire again.
  assert.match(m049, /where not exists \(select 1 from public\.profiles p where p\.user_id = u\.id\)/);
  assert.match(recovery, /phaseTwins[\s\S]*phaseTraits/);
});

test('only FINISHED interviews get a Twin — five main questions, follow-ups excluded', () => {
  // Six people started and did not finish. A Twin built from half an interview
  // would describe someone who does not exist.
  assert.match(m049, /a\.question_id not like '%\\_f'\) >= 5/);
});

test('a rejected photo is hidden, never deleted', () => {
  // Clearing the two columns removes it from every screen; the files stay so a
  // wrong verdict can be undone. A batch job does not get to destroy user files.
  const nsfw = recovery.slice(recovery.indexOf('if (verdict.nsfw)'), recovery.indexOf("return 'rejected'"));
  assert.match(nsfw, /photo_url: null, photo_blur_url: null/);
  assert.doesNotMatch(recovery, /storage\.from\('photos'\)\.remove/);
});

test('a missing file cannot block recovery forever', () => {
  // Photos run first; one row pointing at a deleted file would otherwise fail
  // on every call and stop every Twin queued behind it.
  assert.match(recovery, /not\.\?found\|404/);
  assert.match(recovery, /return 'missing'/);
});

test('uploads record whether a verdict actually came back', () => {
  assert.match(photo, /let checked = false;/);
  assert.match(photo, /checked = true;/);
  // Always written, including null: a re-upload must not inherit the old stamp.
  assert.match(photo, /photo_checked_at: checked \? new Date\(\)\.toISOString\(\) : null/);
});

test('the migration only marks photos that predate the outage as checked', () => {
  // Matched on the file's own timestamp — one existing user replaced their photo
  // mid-outage, which a signup-date rule would have missed.
  assert.match(m049, /o\.updated_at < '2026-10-06 20:01:00\+00'/);
});

test('live onboarding and recovery build Twins with the same code', () => {
  assert.match(profile, /import \{ buildTwin \} from '\.\/_lib\/twin\.js'/);
  assert.match(recovery, /import \{ buildTwin, interviewText \} from '\.\/twin\.js'/);
  assert.doesNotMatch(profile, /generateProfile\(/, 'no second copy of the Twin logic');
});

test('/recover is owner-only and silent for everyone else', () => {
  const fn = commands.slice(commands.indexOf('async function recover(msg)'),
                            commands.indexOf('async function sendEnvCheck'));
  assert.match(fn, /OWNER_TELEGRAM_ID[\s\S]{0,120}?return;/);
  assert.match(fn, /Anthropic still has no credit/, 'it must say so when the cause is billing');
});
