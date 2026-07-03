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

/** One short, warm follow-up question (Ukrainian) to the user's answer. */
export async function generateFollowup(questionText, answerText) {
  const prompt =
    'Ти — Sixtio, тепла й уважна ШІ-сваха в застосунку знайомств. ' +
    'Користувач щойно відповів на твоє запитання. Постав ОДНЕ коротке (до 20 слів) ' +
    'живе уточнююче підпитання українською, звертаючись на «ти». ' +
    'Без привітань, без коментарів, без лапок — лише саме питання.\n\n' +
    `Твоє запитання: ${questionText}\n` +
    `Відповідь користувача: ${answerText}`;
  const text = await callGemini(prompt, {
    temperature: 0.9,
    thinkingConfig: { thinkingBudget: 0 },
  });
  return text.replace(/^["«]|["»]$/g, '').trim();
}
