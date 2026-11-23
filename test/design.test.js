// Design «Glow» over «Clarity» (2026-11-23).
//
// The owner asked for the new look AND a fast way back to the old one. That
// promise only holds while three things stay true; these tests pin them.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';

const glow = readFileSync('theme-glow.css', 'utf8');
const themeJs = readFileSync('theme.js', 'utf8');
const pages = readdirSync('.').filter((f) => f.endsWith('.html') && f !== 'waiting.html');

test('every Glow rule is scoped, so "classic" is the untouched old design', () => {
  // Strip comments and @-blocks' headers, then check every selector list.
  const css = glow.replace(/\/\*[\s\S]*?\*\//g, '');
  const selectors = [...css.matchAll(/([^{}@]+)\{/g)]
    .map((m) => m[1].trim())
    .filter((s) => s && !/^(from|to|\d+%|media |supports |keyframes )/.test(s));
  for (const list of selectors) {
    for (const sel of list.split(',').map((s) => s.trim())) {
      if (/keyframes/.test(sel)) continue;
      // .sx-* is the ghost logo's own markup, which only Glow pages render.
      const ok = sel.startsWith('html[data-design="glow"]') ||
                 sel.startsWith('html:not([data-design="glow"])') ||
                 /\.sx-(logo|tile)/.test(sel);
      assert.ok(ok, `unscoped Glow selector would leak into classic: ${sel}`);
    }
  }
});

test('rolling back is one constant, and it names a real design', () => {
  const m = themeJs.match(/var DESIGN = '(\w+)';/);
  assert.ok(m, 'theme.js must keep a single DESIGN constant');
  assert.match(themeJs, /var DESIGNS = \{ glow: 1, classic: 1 \};/);
  assert.ok(['glow', 'classic'].includes(m[1]));
  assert.match(themeJs, /root\.setAttribute\('data-design', design\)/);
});

test('a cached, expired photo URL is never requested, and a failed one never shows broken', () => {
  // Signed URLs live 5 minutes; screens paint from an older cache first.
  assert.match(themeJs, /exp \* 1000 > Date\.now\(\) \+ 15000/);
  assert.match(themeJs, /document\.addEventListener\('error', function \(e\)[\s\S]{0,200}img\.src = PHOTO_PH;/);
  for (const p of ['chat.html', 'conversation.html', 'match.html', 'matches.html', 'profile.html']) {
    const html = readFileSync(p, 'utf8');
    assert.doesNotMatch(html, /if \((pt|p|u|partner)\.photoUrl\) \{/, `${p} renders a photo URL without checking its expiry`);
  }
});

test('every page loads the Glow layer AFTER theme.css, on the same ?v=', () => {
  for (const p of pages) {
    const html = readFileSync(p, 'utf8');
    const base = html.indexOf('theme.css?v=');
    const layer = html.indexOf('theme-glow.css?v=');
    assert.ok(base > -1 && layer > base, `${p}: theme-glow.css missing or before theme.css`);
    const vs = new Set([...html.matchAll(/\?v=(\d+)/g)].map((x) => x[1]));
    assert.equal(vs.size, 1, `${p}: mixed cache-busters ${[...vs]}`);
  }
});
