const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';

async function callGemini(prompt, generationConfig = {}) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const res = await fetch(`${API_BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: prompt }] }],
      generationConfig,
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini ${res.status}: ${body.slice(0, 500)}`);
  }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || '')
    .join('')
    .trim();
  if (!text) throw new Error('Gemini returned an empty response');
  return text;
}

function genderLine(gender) {
  if (gender === 'female') return 'Користувач — жінка: звертайся до неї в жіночому роді. ';
  if (gender === 'male') return 'Користувач — чоловік: звертайся до нього в чоловічому роді. ';
  return '';
}

// Output language (Task 26) — mirrors claude.js langLine: one hard instruction
// so every user-facing string is generated in the user's native language.
const LANG_NAME = { uk: 'українською', en: 'англійською (English)', ru: 'російською' };
function langLine(lang) {
  const name = LANG_NAME[lang] || LANG_NAME.uk;
  return 'КРИТИЧНО: увесь текст для користувача пиши ВИКЛЮЧНО ' + name +
    ' — це рідна мова користувача. Жодного змішування мов у відповіді. ';
}

/**
 * Vision safety gate for profile photos (Gemini multimodal). Returns
 * { nsfw:boolean, reason:string }. Conservatively rejects ONLY explicit NSFW —
 * nudity, sexual/erotic content, pornography, or graphic violence/gore. A photo
 * without a visible face is fine and passes (nsfw:false). Throws on API/parse
 * failure so the caller can fail-open (treat a throw as "allow").
 * @param {string} base64Jpeg raw base64 (no data: prefix) of a JPEG image
 */
export async function moderatePhoto(base64Jpeg) {
  if (!process.env.GEMINI_API_KEY) throw new Error('GEMINI_API_KEY is not set');
  const model = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
  const prompt =
    'Ти — суворий модератор фото для застосунку знайомств. Оціни зображення на безпеку. ' +
    'Поверни ЛИШЕ JSON без пояснень: {"nsfw": true|false, "reason": "коротка причина"}. ' +
    'Постав nsfw=true ЛИШЕ якщо на фото є: оголеність або видимі статеві органи/оголені груди/сідниці; ' +
    'відверто сексуальний чи еротичний контент, пози або білизна з явним сексуальним підтекстом; ' +
    'порнографія; графічне насильство, кров, каліцтва; або будь-що з неповнолітніми у сексуалізованому контексті. ' +
    'Постав nsfw=false для звичайних фото: портрет, селфі, люди в одязі, помірні пляжні фото у купальнику/плавках, ' +
    'краєвиди, тварини, предмети. ВАЖЛИВО: відсутність обличчя або відсутність людини — це НОРМА і НЕ робить фото nsfw. ' +
    'Не будь надто прискіпливим: сумніваєшся — став nsfw=false.';
  const res = await fetch(`${API_BASE}/${model}:generateContent`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-goog-api-key': process.env.GEMINI_API_KEY,
    },
    body: JSON.stringify({
      contents: [{
        role: 'user',
        parts: [
          { text: prompt },
          { inlineData: { mimeType: 'image/jpeg', data: base64Jpeg } },
        ],
      }],
      generationConfig: {
        temperature: 0,
        responseMimeType: 'application/json',
        thinkingConfig: { thinkingBudget: 0 },
      },
    }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Gemini vision ${res.status}: ${body.slice(0, 300)}`);
  }
  const data = await res.json();
  const text = (data.candidates?.[0]?.content?.parts || [])
    .map((p) => p.text || '')
    .join('')
    .trim();
  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('Gemini vision returned non-JSON');
  }
  return { nsfw: parsed.nsfw === true, reason: String(parsed.reason || '').slice(0, 120) };
}

/** One short, warm follow-up question (in the user's language) to the answer. */
export async function generateFollowup(questionText, answerText, gender, lang) {
  const prompt =
    'Ти — Sixtio: ультимативно розумний психолог і архітектор взаємин. Тон — вишуканий, ' +
    'преміальний, зі смаком, але теплий. Ти читаєш психолінгвістику відповідей. ' +
    genderLine(gender) +
    'Користувач щойно відповів. Постав ОДНЕ коротке (до 18 слів) вишукане уточнююче ' +
    'підпитання, звертаючись на «ти», яке йде вглиб — до мотиву, почуття чи ' +
    'сенсу за відповіддю. Без привітань, без коментарів, без лапок — лише саме питання. ' +
    langLine(lang) + '\n\n' +
    `Твоє запитання: ${questionText}\n` +
    `Відповідь користувача: ${answerText}`;
  const text = await callGemini(prompt, {
    temperature: 0.9,
    thinkingConfig: { thinkingBudget: 0 },
  });
  return text.replace(/^["«]|["»]$/g, '').trim();
}

/**
 * "The Why Factor": one thrilling, analytical paragraph on why two people are
 * psychologically (Big Five / OCEAN) — and, when BOTH opted into the intimate
 * layer, intimately — compatible. `me`/`partner` = { gender, name?, traits, kink }.
 * traits = a profiles row (trait_* numbers + traits_json labels); kink = markers[]
 * (already gated to [] by the caller unless the match is a mutual intimate opt-in).
 */
export async function generateWhyFactor(me, partner, lang) {
  const OCEAN = {
    trait_openness: 'відкритість',
    trait_conscientiousness: 'сумлінність',
    trait_extraversion: 'екстраверсія',
    trait_agreeableness: 'доброзичливість',
    trait_neuroticism: 'емоційність',
  };
  const traitLine = (p) => {
    if (!p) return 'немає даних';
    const nums = [];
    for (const k in OCEAN) if (typeof p[k] === 'number') nums.push(`${OCEAN[k]} ${p[k]}`);
    const tags = Array.isArray(p.traits_json) ? p.traits_json.slice(0, 6).join(', ') : '';
    return [nums.join(', '), tags && `риси: ${tags}`].filter(Boolean).join('; ') || 'немає даних';
  };
  const kinkLine = (arr) => (Array.isArray(arr) && arr.length ? arr.join(', ') : null);
  const partnerName = (partner.name || '').split(' ')[0] || 'ця людина';

  const myKink = kinkLine(me.kink);
  const theirKink = kinkLine(partner.kink);
  const intimate = myKink && theirKink;   // only when BOTH sides have markers

  const prompt =
    'Ти — Sixtio: геніальний психолог стосунків і аналітик глибинної сумісності. ' +
    genderLine(me.gender) +
    'Проаналізуй два психологічні профілі за моделлю Big Five (OCEAN)' +
    (intimate ? ' та їхні інтимні маркери' : '') +
    '. Напиши ОДИН захопливий, глибоко аналітичний абзац (4–6 речень), ' +
    'звертаючись на «ти», який пояснює САМЕ ЧОМУ ви двоє ' +
    (intimate ? 'психологічно та інтимно ' : 'психологічно ') +
    'підходите одне одному — назви конкретні риси, що резонують або доповнюють одна одну, ' +
    'і чому саме це створює справжнє притягання. Тон — вишуканий, преміальний, інтригуючий, ' +
    'теплий. Без списків, без заголовків, без лапок — лише живий, плинний текст. ' +
    langLine(lang) + '\n\n' +
    `Твій профіль: ${traitLine(me.traits)}.` + (intimate ? ` Інтимні маркери: ${myKink}.` : '') + '\n' +
    `Профіль ${partnerName}: ${traitLine(partner.traits)}.` + (intimate ? ` Інтимні маркери: ${theirKink}.` : '');

  return callGemini(prompt, { temperature: 0.9, thinkingConfig: { thinkingBudget: 0 } });
}

// --- AI-звіт (50 ⭐) -----------------------------------------------------
//
// The paid long-form report. The five sections are fixed and enforced by a
// response schema rather than parsed out of prose: a report that sometimes has
// four sections and sometimes seven cannot be rendered, cached or translated
// consistently, and a missing "who fits you" is exactly the part people paid
// for.
const REPORT_SECTIONS = [
  { key: 'core',      brief: 'хто ця людина насправді — ядро характеру, як вона влаштована всередині' },
  { key: 'love',      brief: 'як вона любить і привʼязується: що дає в стосунках, чого потребує, як поводиться, коли близько' },
  { key: 'strength',  brief: 'її головна сила у стосунках — і зворотний бік цієї ж сили, пастка, в яку вона через неї потрапляє' },
  { key: 'fit',       brief: 'хто їй підходить: тип партнера, з яким це працює, і тип, з яким вигорає' },
  { key: 'next',      brief: 'що конкретно робити далі — 2-3 практичні, здійсненні кроки, без загальних слів' },
];

const REPORT_SCHEMA = {
  type: 'object',
  properties: Object.fromEntries(
    REPORT_SECTIONS.map((s) => [s.key, { type: 'string' }])
  ),
  required: REPORT_SECTIONS.map((s) => s.key),
  propertyOrdering: REPORT_SECTIONS.map((s) => s.key),
};

/**
 * Writes the paid report. Everything factual is passed IN — the Big Five vector,
 * the sun sign and the socionics type are computed elsewhere (deterministically,
 * see _lib/astro.js) and handed over as givens. The model's whole job is to read
 * them together and write; it never decides what type someone is, because a
 * model asked twice would answer differently and the report would stop being
 * about the person.
 *
 * @param {object} input { gender, goal, values[], interests[], traits (profiles row),
 *                         sign, element, socionics: { code, mbti, axes[] } }
 * @returns {Promise<Array<{key:string, body:string}>>} sections in fixed order
 */
export async function generateAiReport(input, lang) {
  const OCEAN = {
    trait_openness: 'відкритість до нового',
    trait_conscientiousness: 'сумлінність',
    trait_extraversion: 'екстраверсія',
    trait_agreeableness: 'доброзичливість',
    trait_neuroticism: 'емоційна реактивність',
  };
  const p = input.traits || {};
  const oceanLine = Object.keys(OCEAN)
    .filter((k) => typeof p[k] === 'number')
    .map((k) => `${OCEAN[k]} ${p[k]}/100`)
    .join(', ') || 'немає даних';

  // Axes that landed near the midpoint are a coin flip, not a reading. Naming
  // them forces the text to hedge exactly there instead of asserting a 51 as a
  // verdict — the difference between an analysis and a horoscope generator.
  const weak = (input.socionics && input.socionics.axes || [])
    .filter((a) => a.weak).map((a) => a.axis);

  const parts = [
    'Ти — Sixtio: геніальний психолог стосунків. Пишеш глибоко, конкретно й тепло, ' +
    'звертаючись на «ти». Це платний персональний звіт — він має бути вартий своїх грошей: ' +
    'жодної води, жодних гороскопних банальностей, жодних компліментів заради компліментів. ' +
    genderLine(input.gender) +
    'Головне джерело правди — профіль Big Five (OCEAN): саме він побудований на реальних ' +
    'відповідях людини. Знак зодіаку та соціотип — це додаткові лінзи й мова опису, а не докази: ' +
    'спирайся на них лише там, де вони збігаються з Big Five, і НІКОЛИ не подавай астрологію ' +
    'як факт про характер. Якщо лінзи суперечать Big Five — вір Big Five і скажи про це прямо. ' +
    'Не став діагнозів і не давай медичних порад. ' +
    langLine(lang),
    '',
    'ДАНІ ПРО ЛЮДИНУ:',
    `Big Five: ${oceanLine}.`,
    Array.isArray(p.traits_json) && p.traits_json.length ? `Ключові риси: ${p.traits_json.slice(0, 8).join(', ')}.` : '',
    p.summary_text ? `Портрет: ${p.summary_text}` : '',
    input.sign ? `Сонячний знак: ${input.sign}${input.element ? ` (стихія: ${input.element})` : ''}.` : '',
    input.socionics ? `Соціотип: ${input.socionics.code} (${input.socionics.mbti}).` : '',
    weak.length ? `УВАГА: осі ${weak.join(', ')} майже посередині — тут пиши обережно, «швидше…, ніж…», без категоричності.` : '',
    input.goal ? `Мета в застосунку: ${input.goal}.` : '',
    Array.isArray(input.values) && input.values.length ? `Цінності: ${input.values.slice(0, 8).join(', ')}.` : '',
    Array.isArray(input.interests) && input.interests.length ? `Інтереси: ${input.interests.slice(0, 10).join(', ')}.` : '',
    '',
    'СТРУКТУРА ВІДПОВІДІ — рівно ці ключі, кожен зі своїм текстом на 4–6 речень, суцільним абзацом без списків і заголовків усередині:',
    ...REPORT_SECTIONS.map((s) => `- ${s.key}: ${s.brief}`),
  ];

  const text = await callGemini(parts.filter(Boolean).join('\n'), {
    temperature: 0.85,
    responseMimeType: 'application/json',
    responseSchema: REPORT_SCHEMA,
  });

  let parsed;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error('AI report returned non-JSON');
  }

  // Fixed order, and a section that came back empty is dropped rather than
  // rendered as a blank card with a heading over nothing.
  const sections = REPORT_SECTIONS
    .map((s) => ({ key: s.key, body: String(parsed[s.key] || '').trim() }))
    .filter((s) => s.body);
  if (!sections.length) throw new Error('AI report came back empty');
  return sections;
}
