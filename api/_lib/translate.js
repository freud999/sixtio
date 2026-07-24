// Profile text in the READER's language (migration 034).
//
// The Digital Twin (traits / vibe / summary) is generated once, in whatever
// language the user onboarded in, and the bio is typed once. Switching the
// interface language used to re-label every button and leave all of that
// untouched — an English chrome wrapped around Ukrainian text, on the one screen
// where the text IS the content.
//
// Re-generating the Twin in the new language would be worse than translating:
// it costs a full interview pass, and the Twin would come back subtly different
// each time, so a profile would change meaning when its owner toggled languages.
// Translation keeps the reading fixed and moves only the wording.
//
// Design constraints that shape everything below:
//   * ONE Gemini call per request, never one per profile. A match list with ten
//     partners must not become ten sequential API calls.
//   * Cached forever after the first view (<col>_i18n), so the cost is paid once
//     per (profile, language) pair and never again.
//   * Never fatal. A translation failure falls back to the original text — a
//     profile in the wrong language is a bad experience, a 500 is a worse one.

import { getSupabase } from './supabase.js';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const LANG_NAME = { uk: 'Ukrainian', en: 'English', ru: 'Russian' };

/**
 * Translates a flat { key: text } bundle in one call. Keys are opaque handles —
 * the model is told to preserve them exactly — which is what lets us pack many
 * unrelated profiles into a single request and unpack them reliably afterwards.
 * Returns {} on any failure, so callers fall back to originals.
 */
async function translateBundle(bundle, targetLang) {
  const keys = Object.keys(bundle);
  if (!keys.length || !process.env.GEMINI_API_KEY) return {};

  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const target = LANG_NAME[targetLang] || LANG_NAME.uk;
  const prompt =
    `Translate the VALUES of this JSON object into ${target}.\n` +
    'Rules:\n' +
    '- Keep every key EXACTLY as given. Do not add, drop or rename keys.\n' +
    '- Translate values only. Preserve tone, warmth and the informal "you".\n' +
    '- These are dating-profile descriptions of a real person: keep the meaning ' +
    'precise, never embellish, never add facts that are not there.\n' +
    '- Keep short tags short (1-3 words).\n' +
    '- If a value is already in ' + target + ', return it unchanged.\n' +
    '- Respond with the JSON object only.\n\n' +
    JSON.stringify(bundle);

  try {
    const res = await fetch(`${API_BASE}/${model}:generateContent`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-goog-api-key': process.env.GEMINI_API_KEY,
      },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [{ text: prompt }] }],
        generationConfig: {
          temperature: 0.2,                  // translation, not creativity
          responseMimeType: 'application/json',
          thinkingConfig: { thinkingBudget: 0 },
        },
      }),
    });
    if (!res.ok) throw new Error(`Gemini ${res.status}`);
    const data = await res.json();
    const text = (data.candidates?.[0]?.content?.parts || [])
      .map((p) => p.text || '').join('').trim();
    const parsed = JSON.parse(text);

    // Only accept keys we asked for, and only non-empty strings: a model that
    // hallucinates a key must not be able to write into a cache.
    const out = {};
    for (const k of keys) {
      if (typeof parsed[k] === 'string' && parsed[k].trim()) out[k] = parsed[k].trim();
    }
    return out;
  } catch (e) {
    console.error('translateBundle failed:', e.message);
    return {};
  }
}

// The translatable fields of a profiles row, and how they map to the client.
// traits is an array, so it is flattened into indexed keys and reassembled.
function profileFields(p) {
  const out = {};
  if (p.vibe) out.vibe = p.vibe;
  if (p.summary_text) out.summary = p.summary_text;
  (Array.isArray(p.traits_json) ? p.traits_json : []).forEach((tag, i) => {
    if (tag) out['trait' + i] = String(tag);
  });
  return out;
}

function applyProfileFields(p, tr) {
  const traits = (Array.isArray(p.traits_json) ? p.traits_json : [])
    .map((tag, i) => tr['trait' + i] || tag);
  return {
    traits,
    vibe: tr.vibe || p.vibe || '',
    summary: tr.summary || p.summary_text || '',
  };
}

/**
 * The language a row's ORIGINAL text is in. A null <col>_lang means the row
 * predates migration 034; the user's stored interface language is the best
 * available guess and is right in the overwhelming majority of cases. Guessing
 * here rather than backfilling keeps the guess out of the data, so a row that is
 * rewritten later gets a real answer instead of inheriting an old assumption.
 */
export function sourceLang(stored, fallbackLang) {
  return stored || fallbackLang || 'uk';
}

/**
 * The AI report (migration 035) in the reader's language.
 *
 * Same contract as the Twin: written once in the buyer's language, translated
 * on demand, cached per language so it costs one call ever. Its own function
 * rather than another `items` shape because a report is always exactly one row
 * belonging to the reader — there is no batch to amortise, and folding it into
 * localizeProfiles would mean threading a third field kind through every branch
 * for a single caller.
 *
 * `report` is an ai_reports row. Returns the sections array, always — on any
 * failure the originals come back, because a report in the wrong language is
 * still the thing the user paid for.
 */
export async function localizeReport(report, lang, fallbackLang) {
  const sections = Array.isArray(report && report.sections) ? report.sections : [];
  if (!sections.length) return sections;

  const src = sourceLang(report.lang, fallbackLang);
  if (src === lang) return sections;

  const cached = (report.i18n || {})[lang];
  const applyCache = (c) => sections.map((s) => ({ key: s.key, body: c[s.key] || s.body }));
  if (cached) return applyCache(cached);

  const bundle = {};
  for (const s of sections) if (s.body) bundle[s.key] = s.body;
  const translated = await translateBundle(bundle, lang);
  if (!Object.keys(translated).length) return sections;

  try {
    await getSupabase()
      .from('ai_reports')
      .update({ i18n: { ...(report.i18n || {}), [lang]: translated }, lang: src })
      .eq('user_id', report.user_id);
  } catch (e) { console.error('report i18n cache write failed:', e.message); }

  return applyCache(translated);
}

/**
 * Localizes many profiles at once.
 *
 * `items` is [{ profile, user, key }] where `profile` is a profiles row (may be
 * null), `user` carries language_code + bio + bio_i18n + bio_lang, and `key`
 * identifies the item to the caller. Returns { [key]: { traits, vibe, summary,
 * bio } } already in `lang`.
 *
 * Everything missing from the caches across ALL items goes into ONE Gemini call;
 * the results are written back so the next reader pays nothing.
 */
export async function localizeProfiles(items, lang) {
  const result = {};
  const bundle = {};
  const wants = [];   // what each bundle key belongs to, for the write-back

  for (const it of items) {
    const p = it.profile || {};
    const u = it.user || {};

    // Start from the originals — this is also the fallback if anything fails.
    result[it.key] = {
      traits: Array.isArray(p.traits_json) ? p.traits_json : [],
      vibe: p.vibe || '',
      summary: p.summary_text || '',
      bio: u.bio || '',
    };

    // --- Digital Twin ---
    if (it.profile) {
      const src = sourceLang(p.lang, u.language_code);
      if (src !== lang) {
        const cached = (p.i18n || {})[lang];
        if (cached) {
          result[it.key] = { ...result[it.key], ...applyProfileFields(p, cached) };
        } else {
          const fields = profileFields(p);
          if (Object.keys(fields).length) {
            for (const [f, v] of Object.entries(fields)) bundle[`${it.key}|p|${f}`] = v;
            wants.push({ kind: 'profile', item: it });
          }
        }
      }
    }

    // --- bio (user-typed) ---
    if (u.bio) {
      const src = sourceLang(u.bio_lang, u.language_code);
      if (src !== lang) {
        const cached = (u.bio_i18n || {})[lang];
        if (cached) result[it.key].bio = cached;
        else {
          bundle[`${it.key}|b|bio`] = u.bio;
          wants.push({ kind: 'bio', item: it });
        }
      }
    }
  }

  if (!Object.keys(bundle).length) return result;

  const translated = await translateBundle(bundle, lang);
  if (!Object.keys(translated).length) return result;   // fall back to originals

  // Regroup the flat response back per item, apply, and persist the cache.
  const writes = [];
  for (const w of wants) {
    const it = w.item;
    const prefix = `${it.key}|${w.kind === 'profile' ? 'p' : 'b'}|`;
    const fields = {};
    for (const [k, v] of Object.entries(translated)) {
      if (k.startsWith(prefix)) fields[k.slice(prefix.length)] = v;
    }
    if (!Object.keys(fields).length) continue;

    if (w.kind === 'profile') {
      result[it.key] = { ...result[it.key], ...applyProfileFields(it.profile, fields) };
      writes.push({
        table: 'profiles', match: { user_id: it.userId },
        col: 'i18n', langCol: 'lang',
        next: { ...(it.profile.i18n || {}), [lang]: fields },
        src: sourceLang(it.profile.lang, (it.user || {}).language_code),
      });
    } else {
      result[it.key].bio = fields.bio;
      writes.push({
        table: 'users', match: { id: it.userId },
        col: 'bio_i18n', langCol: 'bio_lang',
        next: { ...((it.user || {}).bio_i18n || {}), [lang]: fields.bio },
        src: sourceLang((it.user || {}).bio_lang, (it.user || {}).language_code),
      });
    }
  }

  // Cache write-back is pure optimisation: if it fails the reader still got the
  // right text, we just pay for the translation again next time.
  const supabase = getSupabase();
  await Promise.all(writes.map(async (w) => {
    try {
      const patch = { [w.col]: w.next, [w.langCol]: w.src };
      const q = supabase.from(w.table).update(patch);
      for (const [k, v] of Object.entries(w.match)) q.eq(k, v);
      await q;
    } catch (e) { console.error('i18n cache write failed:', e.message); }
  }));

  return result;
}
