// i18n-check — finds the class of bug that keeps reaching production:
// text that exists in one language and not the others, keys the pages ask for
// that nobody defined, and Cyrillic strings hardcoded past the dictionary.
//
//   node scripts/i18n-check.mjs
//
// Exit 1 if anything is MISSING or UNDEFINED. Hardcoded strings are advisory
// (exit code unaffected) because some are legitimately language-neutral —
// they are printed for a human to judge, not to fail a build.
import { readFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const LANGS = ['uk', 'en', 'ru'];

// Blank out string literals before scanning for `key:` — values contain colons
// ("18+", "12:00", URLs) and would otherwise register as keys.
function blankStrings(src) {
  return src.replace(/'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"|`(?:\\.|[^`\\])*`/g, (m) => "''");
}

function langBlocks(src) {
  const lines = src.split('\n');
  const out = {};
  for (const lang of LANGS) {
    const start = lines.findIndex((l) => l.trimEnd() === `    ${lang}: {`);
    if (start < 0) throw new Error(`i18n.js: no top-level "${lang}: {" block — did the dictionary shape change?`);
    let depth = 1, end = -1;
    for (let i = start + 1; i < lines.length; i++) {
      const bare = blankStrings(lines[i]);
      depth += (bare.match(/{/g) || []).length - (bare.match(/}/g) || []).length;
      if (depth === 0) { end = i; break; }
    }
    if (end < 0) throw new Error(`i18n.js: "${lang}" block never closes`);
    out[lang] = lines.slice(start + 1, end).join('\n');
  }
  return out;
}

function keysIn(block) {
  const keys = new Set();
  // `m` matters: a key that opens a line is preceded by a newline, not by `,`
  // or `{`, and without it every such key reads as undefined.
  const re = /(?:^\s*|[,{]\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:/gm;
  let m;
  const bare = blankStrings(block).replace(/\/\/[^\n]*/g, '');
  while ((m = re.exec(bare))) keys.add(m[1]);
  return keys;
}

const i18nSrc = readFileSync(join(ROOT, 'i18n.js'), 'utf8');
const defined = {};
for (const [lang, block] of Object.entries(langBlocks(i18nSrc))) defined[lang] = keysIn(block);

// --- 1. keys present in one language, absent in another ---------------------
const union = new Set(LANGS.flatMap((l) => [...defined[l]]));
const gaps = [];
for (const key of [...union].sort()) {
  const missing = LANGS.filter((l) => !defined[l].has(key));
  if (missing.length) gaps.push({ key, missing, has: LANGS.filter((l) => defined[l].has(key)) });
}

// --- 2. keys the app asks for that no language defines ----------------------
const SOURCES = readdirSync(ROOT)
  .filter((f) => /\.(html|js)$/.test(f) && f !== 'i18n.js')
  .map((f) => [f, readFileSync(join(ROOT, f), 'utf8')]);

const asked = new Map();  // key -> Set<file>
function note(key, file) {
  if (!asked.has(key)) asked.set(key, new Set());
  asked.get(key).add(file);
}
for (const [file, src] of SOURCES) {
  for (const m of src.matchAll(/data-i18n(?:-html|-ph|-aria|-alt)?\s*=\s*"([^"]+)"/g)) note(m[1], file);
  // The `(?![^)]*\+)`-style guard: t('sign_' + s) builds its key at runtime, so
  // the literal prefix is not a key and must not be reported as one. Only a
  // literal that closes the call — `t('key')` or `t('key', {…})` — counts.
  for (const m of src.matchAll(/\bt\(\s*'([a-z][a-z0-9_]*)'\s*(?=[),])/g)) note(m[1], file);
}
const undef = [...asked.entries()]
  .filter(([key]) => !union.has(key))
  .map(([key, files]) => ({ key, files: [...files].sort() }))
  .sort((a, b) => a.key.localeCompare(b.key));

// --- 3. Cyrillic text sitting outside the dictionary ------------------------
// Advisory. privacy.html is exempt: it is three separately authored legal
// documents selected by [data-doc-lang], which is the design, not a leak.
//
// Judged per ELEMENT, not per line. A line-based rule reports text whose
// data-i18n attribute sits on the line above it — which is most of the markup
// here, since attributes and content routinely wrap. Wrong findings train you
// to skim the list, so the scan resolves the enclosing tag instead.
function enclosingTag(src, at) {
  const open = src.lastIndexOf('<', at);
  if (open < 0) return '';
  const close = src.indexOf('>', open);
  if (close < 0) return '';
  // Two shapes, both legitimate: the text sits INSIDE the tag (an attribute
  // value, open < at < close) or AFTER it (a text node whose parent's opening
  // tag this is, open < close < at). Either way the tag that owns the string is
  // the same slice — which is the whole point of not judging by line.
  return src.slice(open, close + 1);
}
function insideHtmlComment(src, at) {
  const open = src.lastIndexOf('<!--', at);
  return open >= 0 && src.indexOf('-->', open) > at;
}

// Which data-i18n* attribute would localize the string at this position.
// Per-attribute, not per-element: a button can localize its label via
// data-i18n and still carry a hardcoded aria-label, and treating any
// data-i18n on the tag as absolution hides exactly that — it hid four
// untranslated aria-labels from this scan's first version.
const ATTR_KEY = {
  'aria-label': 'data-i18n-aria',
  placeholder: 'data-i18n-ph',
  alt: 'data-i18n-alt',
};
// True when the position sits inside a tag (an attribute value) rather than in
// a text node between tags.
function insideTag(src, at) {
  const open = src.lastIndexOf('<', at);
  if (open < 0) return false;
  const close = src.indexOf('>', open);
  return close < 0 ? false : close > at;
}

// Which data-i18n* attribute would have to be present for the attribute value
// at this position to count as localized. `[]` means "no rule covers this
// attribute", which is treated as a finding worth a human's eye.
function attrLocalizer(src, at) {
  const open = src.lastIndexOf('<', at);
  const attr = [...src.slice(open, at).matchAll(/([a-zA-Z-]+)\s*=\s*["'][^"']*$/g)].pop();
  const name = attr ? attr[1] : null;
  if (!name) return ['data-i18n', 'data-i18n-html'];
  return ATTR_KEY[name] ? [ATTR_KEY[name]] : [];
}

// Character ranges whose TEXT is written by the dictionary: the content of every
// element carrying data-i18n or data-i18n-html, close tag matched by depth.
//
// The nearest enclosing tag is not enough here. data-i18n-html content contains
// nested markup (`<b>Приватно.</b> …`), so text after the <b> reports an inline
// tag that carries no attribute of its own while the dictionary owns the whole
// span. Attribute positions deliberately do NOT consult these ranges — an
// element can own its text and still carry a hardcoded aria-label.
function localizedContentRanges(src) {
  const ranges = [];
  const re = /<([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*\bdata-i18n(?:-html)?\s*=[^>]*>/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1];
    let depth = 1, i = m.index + m[0].length;
    const start = i;
    const tagRe = new RegExp(`<(/?)${name}\\b[^>]*>`, 'g');
    tagRe.lastIndex = i;
    let t;
    while ((t = tagRe.exec(src))) {
      depth += t[1] ? -1 : 1;
      if (depth === 0) { ranges.push([start, t.index]); break; }
    }
  }
  return ranges;
}

const hardcoded = [];
for (const [file, src] of SOURCES) {
  if (file === 'privacy.html') continue;
  const lineStarts = [];
  for (let i = 0, n = 0; n >= 0; i++) { lineStarts.push(n); n = src.indexOf('\n', n) + 1 || -1; }
  const lineAt = (pos) => {
    let lo = 0, hi = lineStarts.length - 1;
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (lineStarts[mid] <= pos) lo = mid; else hi = mid - 1; }
    return lo + 1;
  };
  const owned = localizedContentRanges(src);
  const seen = new Set();
  for (const m of src.matchAll(/[А-Яа-яЀ-ӿ]+/g)) {
    const at = m.index;
    if (insideHtmlComment(src, at)) continue;
    if (insideTag(src, at)) {
      const accepts = attrLocalizer(src, at);
      const tag = enclosingTag(src, at);
      if (accepts.length && accepts.some((a) => tag.includes(a))) continue;
    } else if (owned.some(([s, e]) => at >= s && at < e)) {
      continue;                                   // the dictionary writes this text
    }
    const line = lineAt(at);
    if (seen.has(line)) continue;
    const text = src.slice(lineStarts[line - 1], src.indexOf('\n', at) + 1 || src.length).trim();
    // Only JS call sites are excused by line: `data-i18n` must NOT appear here,
    // or a localized element's hardcoded attribute is skipped by proximity and
    // the per-attribute rule above never gets to speak.
    if (/SixtioI18n|\bt\(\s*'/.test(text)) continue;
    if (/^\s*(?:\/\/|\/\*|\*)/.test(text)) continue;
    seen.add(line);
    hardcoded.push({ file, line, text: text.slice(0, 100) });
  }
}

// --- report ----------------------------------------------------------------
const counts = LANGS.map((l) => `${l} ${defined[l].size}`).join(' · ');
console.log(`i18n-check — ${union.size} keys (${counts})\n`);

if (gaps.length) {
  console.log(`MISSING TRANSLATIONS (${gaps.length})`);
  for (const g of gaps) console.log(`  ${g.key} — has ${g.has.join('/')}, missing ${g.missing.join('/')}`);
  console.log('');
}
if (undef.length) {
  console.log(`UNDEFINED KEYS — asked for, never defined (${undef.length})`);
  for (const u of undef) console.log(`  ${u.key} — ${u.files.join(', ')}`);
  console.log('');
}
if (hardcoded.length) {
  console.log(`HARDCODED CYRILLIC — advisory, review by hand (${hardcoded.length})`);
  for (const h of hardcoded.slice(0, 40)) console.log(`  ${h.file}:${h.line}  ${h.text}`);
  if (hardcoded.length > 40) console.log(`  … ${hardcoded.length - 40} more`);
  console.log('');
}
if (!gaps.length && !undef.length && !hardcoded.length) console.log('Clean.');

process.exit(gaps.length || undef.length ? 1 : 0);
