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
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const ROOTS = ['api', 'api/_lib', 'scripts'];

function jsFiles() {
  const out = [];
  for (const dir of ROOTS) {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      if (e.isFile() && e.name.endsWith('.js')) out.push(`${dir}/${e.name}`.replace(/\\/g, '/'));
    }
  }
  return out;
}

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
const GEMINI_DOORS = [
  'api/_lib/geminifetch.js',  // the door itself
  'api/_lib/gemini.js',       // photo moderation, follow-ups, AI reports
  'api/_lib/personality.js',  // Big Five from the interview answers
  'api/_lib/translate.js',    // profile/bio/report translation
  'api/_lib/env.js',          // the /envcheck ping
];

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

test('the Why Factor left gemini.js and did not leave a copy behind', () => {
  assert.doesNotMatch(codeOf('api/_lib/gemini.js'), /generateWhyFactor/);
  assert.match(readFileSync('api/_lib/claude.js', 'utf8'), /export async function generateWhyFactor/);
  assert.match(readFileSync('api/chat.js', 'utf8'), /generateWhyFactor.*from '\.\/_lib\/claude\.js'/s);
});
