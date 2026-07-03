import Anthropic from '@anthropic-ai/sdk';

let client;
function getClient() {
  if (!client) {
    client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return client;
}

// claude-opus-4-8 by default; set CLAUDE_MODEL=claude-haiku-4-5 for a cheaper/faster option.
const MODEL = process.env.CLAUDE_MODEL || 'claude-opus-4-8';

function textOf(response) {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

/** One short, warm follow-up question (Ukrainian) to the user's answer. */
export async function generateFollowup(questionText, answerText) {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 300,
    system:
      'Ти — Sixtio, тепла й уважна ШІ-сваха в застосунку знайомств. ' +
      'Користувач щойно відповів на твоє запитання. Постав ОДНЕ коротке (до 20 слів) ' +
      'живе уточнююче підпитання українською, звертаючись на «ти». ' +
      'Без привітань, без коментарів, без лапок — лише саме питання.',
    messages: [
      {
        role: 'user',
        content: `Твоє запитання: ${questionText}\nВідповідь користувача: ${answerText}`,
      },
    ],
  });
  if (response.stop_reason === 'refusal') {
    throw new Error('Claude refused the follow-up request');
  }
  const text = textOf(response);
  if (!text) throw new Error('Claude returned an empty follow-up');
  return text.replace(/^["«]|["»]$/g, '').trim();
}

/** Analyzes all answers → { traits: string[4-6], summary: "2 sentences" }. */
export async function generateProfile(qaLines) {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2000,
    system:
      'Ти — Sixtio, тепла й прониклива ШІ-сваха. Проаналізуй відповіді користувача ' +
      'на психологічні запитання. Поверни traits — 4–6 коротких (1–3 слова) тегів рис ' +
      'характеру українською, та summary — рівно 2 теплих речення українською від імені ' +
      'Sixtio, звертання на «ти», про те, як ти зрозуміла цю людину.',
    messages: [{ role: 'user', content: qaLines.join('\n') }],
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            traits: { type: 'array', items: { type: 'string' } },
            summary: { type: 'string' },
          },
          required: ['traits', 'summary'],
          additionalProperties: false,
        },
      },
    },
  });
  if (response.stop_reason === 'refusal') {
    throw new Error('Claude refused the profile request');
  }
  const parsed = JSON.parse(textOf(response));
  if (!Array.isArray(parsed.traits) || typeof parsed.summary !== 'string') {
    throw new Error('Claude profile JSON has unexpected shape');
  }
  return { traits: parsed.traits.slice(0, 6), summary: parsed.summary };
}
