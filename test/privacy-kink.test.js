// PRIV-1: no intimate (GDPR Art. 9) data may reach Gemini.
//
// The rule is a privacy commitment, not a coding preference, and it is exactly
// the kind of rule that decays quietly: someone adds a Gemini call in a file
// that happens to have kink_markers in scope, and nothing anywhere complains.
// So the proof is a test rather than a grep run once by hand — the search is
// re-run on every `npm test`, and re-introducing the leak fails the build.
//
// The argument it encodes, in two steps:
//   1. Every Gemini request body in the app is built in one of a KNOWN, pinned
//      set of files. A new door anywhere else fails the first test.
//   2. None of those files reference intimate data at all.
// Together that is a whole-repo proof, not a spot check — and it does not
// depend on reading every call site by eye.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['api', 'api/_lib', 'scripts'];

function jsFiles() {
  const out = [];
  for (const dir of ROOTS) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      // `!e.isDirectory()`, NOT `e.isFile()`. Measured 2026-08-29: after the
      // project folder was moved into OneDrive and back, Windows reported 38 of
      // 41 source files as reparse points — isFile() returned false for almost
      // the whole repo, and this scan silently dropped from 42 files to 3.
      //
      // That is the worst failure a test like this can have. It kept passing
      // while proving nothing: a new Gemini door in any of the 39 invisible
      // files would have gone unnoticed. isDirectory() is the property we
      // actually mean, and it survives placeholders and symlinks.
      if (!e.isDirectory() && e.name.endsWith('.js')) out.push(`${dir}/${e.name}`.replace(/\\/g, '/'));
    }
  }
  return out;
}

// The lower bound exists because the check above already went blind once, and
// nothing complained. A scan that finds almost nothing must FAIL, not pass —
// otherwise "no new Gemini doors" means "we did not look".
const MIN_FILES_SCANNED = 30;

/** Source with comments stripped: comments are where we RECORD this rule. */
function codeOf(file) {
  return readFileSync(join(...file.split('/')), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// The words that mean "this code handles intimate data". Plain "intimate" is too
// broad — it appears in comments and field names about WITHHOLDING it — so the
// markers column and the interview entry points are what count.
const INTIMATE = /kink_markers|kinkMarkers|analyzeKinkMarkers|processKinkInterview|\.kink\b/;

// Files allowed to build a Gemini request body. Deliberately a hardcoded list:
// the point is that adding a door anywhere else has to be a conscious edit to
// this test, with this comment in front of it.
//
// This list shrank on 2026-08-05 (PRIV-1, option B). Gemini now does exactly one
// job — translating text that is already shown publicly on a profile. Everything
// about a person's psyche or body (the Dark Mode interview, Big Five, follow-up
// answers, the AI report, photo moderation) is on Anthropic, which does not
// train on API traffic. api/_lib/gemini.js was deleted outright.
const GEMINI_DOORS = [
  'api/_lib/geminifetch.js',  // the door itself
  'api/_lib/translate.js',    // profile/bio/report translation — the ONLY job left
  'api/_lib/env.js',          // the /envcheck ping
];

test('the scan can actually see the repository', () => {
  // Guards the two tests below from passing vacuously. Without it, a
  // filesystem quirk turns a whole-repo privacy proof into a no-op.
  const n = jsFiles().length;
  assert.ok(n >= MIN_FILES_SCANNED,
    `only ${n} source files were scanned — the Gemini-door check is blind, fix the walk before trusting it`);
});

test('only the pinned files talk to Gemini', () => {
  const callers = jsFiles().filter((f) => /geminiFetch\s*\(|generativelanguage/.test(codeOf(f)));
  assert.deepEqual(callers.sort(), [...GEMINI_DOORS].sort(),
    'a new Gemini call site appeared — verify it carries no Art. 9 data, then pin it here');
});

test('no file that talks to Gemini touches intimate markers', () => {
  const offenders = GEMINI_DOORS.filter((f) => INTIMATE.test(codeOf(f)));
  assert.deepEqual(offenders, [],
    'these files reach Gemini AND handle intimate data — Art. 9 data goes to Anthropic only');
});

test('the Dark Mode interview is wired to Anthropic, not Google', () => {
  const code = codeOf('api/_lib/kink.js');
  assert.match(code, /claudeJson/, 'kink.js must call Claude');
  assert.doesNotMatch(code, /gemini/i, 'kink.js must not reference Gemini in code');
  assert.match(code, /ANTHROPIC_API_KEY/, 'and must guard on the Anthropic key');
});

test('every psychological and biometric call is on Anthropic', () => {
  const claude = readFileSync('api/_lib/claude.js', 'utf8');
  for (const fn of ['generateWhyFactor', 'moderatePhoto', 'generateAiReport', 'generateFollowup']) {
    assert.match(claude, new RegExp(`export (async )?function ${fn}\\b`), `${fn} must live in claude.js`);
  }
  assert.match(readFileSync('api/_lib/personality.js', 'utf8'), /claudeJson/,
    'Big Five must go through Claude');
  assert.match(readFileSync('api/chat.js', 'utf8'), /generateWhyFactor.*from '\.\/_lib\/claude\.js'/s);
});

test('api/_lib/gemini.js is gone, so it cannot quietly grow a second door', () => {
  assert.equal(existsSync('api/_lib/gemini.js'), false);
});

test('the follow-up path no longer has a Gemini branch to fall back from', () => {
  const code = codeOf('api/answer.js');
  assert.doesNotMatch(code, /gemini/i);
  assert.match(code, /from '\.\/_lib\/claude\.js'/);
});
