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

/** One short, warm follow-up question (Ukrainian) to the user's answer. */
export async function generateFollowup(questionText, answerText, gender) {
  const prompt =
    'Ти — Sixtio: ультимативно розумний психолог і архітектор взаємин. Тон — вишуканий, ' +
    'преміальний, зі смаком, але теплий. Ти читаєш психолінгвістику відповідей. ' +
    genderLine(gender) +
    'Користувач щойно відповів. Постав ОДНЕ коротке (до 18 слів) вишукане уточнююче ' +
    'підпитання українською, звертаючись на «ти», яке йде вглиб — до мотиву, почуття чи ' +
    'сенсу за відповіддю. Без привітань, без коментарів, без лапок — лише саме питання.\n\n' +
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
export async function generateWhyFactor(me, partner) {
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
    '. Напиши ОДИН захопливий, глибоко аналітичний абзац (4–6 речень) українською, ' +
    'звертаючись на «ти», який пояснює САМЕ ЧОМУ ви двоє ' +
    (intimate ? 'психологічно та інтимно ' : 'психологічно ') +
    'підходите одне одному — назви конкретні риси, що резонують або доповнюють одна одну, ' +
    'і чому саме це створює справжнє притягання. Тон — вишуканий, преміальний, інтригуючий, ' +
    'теплий. Без списків, без заголовків, без лапок — лише живий, плинний текст.\n\n' +
    `Твій профіль: ${traitLine(me.traits)}.` + (intimate ? ` Інтимні маркери: ${myKink}.` : '') + '\n' +
    `Профіль ${partnerName}: ${traitLine(partner.traits)}.` + (intimate ? ` Інтимні маркери: ${theirKink}.` : '');

  return callGemini(prompt, { temperature: 0.9, thinkingConfig: { thinkingBudget: 0 } });
}
