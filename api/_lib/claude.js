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

// Matching runs once per onboarding (rare, high-stakes) and needs consistent
// judgment — Haiku flip-flops on nuanced compatibility, so use a stronger model.
const MATCH_MODEL = process.env.MATCH_MODEL || 'claude-sonnet-5';

function textOf(response) {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

function genderLine(gender) {
  if (gender === 'female') return 'Користувач — жінка: звертайся до неї в жіночому роді. ';
  if (gender === 'male') return 'Користувач — чоловік: звертайся до нього в чоловічому роді. ';
  return '';
}

/** One short, warm follow-up question (Ukrainian) to the user's answer. */
export async function generateFollowup(questionText, answerText, gender) {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 300,
    system:
      'Ти — Sixtio, тепла й уважна ШІ-сваха в застосунку знайомств. ' +
      genderLine(gender) +
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
export async function generateProfile(qaLines, gender) {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2000,
    system:
      'Ти — Sixtio, тепла й прониклива ШІ-сваха. ' +
      genderLine(gender) +
      'Проаналізуй відповіді користувача ' +
      'на психологічні запитання. Поверни traits — 4–6 коротких (1–3 слова) тегів рис ' +
      'характеру українською (у правильному роді), та summary — рівно 2 теплих речення ' +
      'українською від імені Sixtio, звертання на «ти», про те, як ти зрозуміла цю людину.',
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

/**
 * Picks the most compatible candidate for `person` from `candidates`.
 * Returns { best: index | -1, score: 1-10, reason: "2 sentences" }.
 */
export async function scoreCandidates(person, candidates) {
  const response = await getClient().messages.create({
    model: MATCH_MODEL,
    // Generous budget: strong models may use adaptive thinking here, which shares
    // this budget with the JSON output — too low truncates the response.
    max_tokens: 4000,
    system:
      'Ти — Sixtio, досвідчена сваха. Тобі дають психологічний портрет людини та ' +
      'список кандидатів. Обери ОДНОГО найсумiснiшого кандидата (глибинна психологічна ' +
      'сумісність: цінності, темп життя, стиль вирішення конфліктів, потреби в близькості; ' +
      'спільне місто та інтереси — плюс, але не головне). Поверни JSON: best — index ' +
      'найкращого кандидата, або -1 якщо ніхто не пасує щиро; score — сумісність 1–10 ' +
      '(чесно, не завищуй); reason — 2 теплих речення українською, чому ці двоє пасують ' +
      'одне одному (звертання «ви», без імен).',
    messages: [
      {
        role: 'user',
        content:
          'Людина:\n' + JSON.stringify(person) +
          '\n\nКандидати:\n' + JSON.stringify(candidates),
      },
    ],
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            best: { type: 'integer' },
            score: { type: 'integer' },
            reason: { type: 'string' },
          },
          required: ['best', 'score', 'reason'],
          additionalProperties: false,
        },
      },
    },
  });
  if (response.stop_reason === 'refusal') {
    throw new Error('Claude refused the matching request');
  }
  const parsed = JSON.parse(textOf(response));
  if (typeof parsed.best !== 'number' || typeof parsed.score !== 'number') {
    throw new Error('Claude matching JSON has unexpected shape');
  }
  return parsed;
}
