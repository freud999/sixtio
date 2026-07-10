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

// --- JSON-leakage hardening (Task 24) ----------------------------------------
// Production showed a match notification ending in raw model chatter:
//   «…} Actually let me reconsider — must be JSON only.}»
// i.e. the model emitted its JSON object and then kept talking; naive parsing of
// the whole text either failed or the stray tail ended up inside `reason`.
// Two defenses: (1) parse ONLY the first balanced JSON object, ignoring anything
// before/after it; (2) sanitize every user-facing string so no braces, code
// fences, or trailing meta-commentary can ever reach a notification or the UI.

/** Extracts and parses the first balanced {...} object in `text` (string-aware). */
export function parseModelJson(text) {
  try { return JSON.parse(text); } catch (e) { /* fall through to extraction */ }
  const start = text.indexOf('{');
  if (start === -1) throw new Error('no JSON object in model output');
  let depth = 0, inStr = false, esc = false;
  for (let i = start; i < text.length; i++) {
    const ch = text[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === '\\') esc = true;
      else if (ch === '"') inStr = false;
    } else if (ch === '"') inStr = true;
    else if (ch === '{') depth++;
    else if (ch === '}') {
      depth--;
      if (depth === 0) return JSON.parse(text.slice(start, i + 1));
    }
  }
  throw new Error('unbalanced JSON object in model output');
}

/** Strips code fences, braces, wrapper quotes and anything after a leaked `{`/`}`. */
export function sanitizeAiText(s) {
  if (typeof s !== 'string') return '';
  let out = s.replace(/```[a-z]*|```/gi, '');
  // A brace never belongs in prose for humans — treat the first one as the start
  // of leaked structure and cut there (kills «…} Actually let me reconsider…}»).
  const brace = out.search(/[{}]/);
  if (brace !== -1) out = out.slice(0, brace);
  return out.replace(/^["'«\s]+|["'»\s]+$/g, '').replace(/\s{2,}/g, ' ').trim();
}

function genderLine(gender) {
  if (gender === 'female') return 'Користувач — жінка: звертайся до неї в жіночому роді. ';
  if (gender === 'male') return 'Користувач — чоловік: звертайся до нього в чоловічому роді. ';
  return '';
}

// --- Output language (Task 26) ----------------------------------------------
// The user's native Telegram language ('uk' | 'en' | 'ru', resolved by
// telegram.js resolveLang) drives EVERY user-facing string the model produces.
// One hard instruction at the end of each system prompt prevents cross-bleed.
const LANG_NAME = { uk: 'українською', en: 'англійською (English)', ru: 'російською' };
export function langLine(lang) {
  const name = LANG_NAME[lang] || LANG_NAME.uk;
  return 'КРИТИЧНО: увесь текст для користувача пиши ВИКЛЮЧНО ' + name +
    ' — це рідна мова користувача. Жодного змішування мов у відповіді. ';
}

// The premium Sixtio persona — shared voice across every AI touch.
const PERSONA =
  'Ти — Sixtio: ультимативно розумний психолог, коуч і архітектор людських взаємин. ' +
  'Ти проводиш делікатне глибинне інтерв\'ю, щоб створити «Digital Twin» — ' +
  'психологічний двійник людини. Твій тон — вишуканий, дорогий, преміальний, зі смаком, ' +
  'але теплий і невимушений. Ти читаєш психолінгвістику: не лише що людина каже, а як. ';

/** One short, refined follow-up question (in the user's language). */
export async function generateFollowup(questionText, answerText, gender, lang) {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 300,
    system:
      PERSONA +
      genderLine(gender) +
      'Користувач щойно відповів. Постав ОДНЕ коротке (до 18 слів) вишукане уточнююче ' +
      'підпитання, звертаючись на «ти», яке йде вглиб — до мотиву, почуття чи ' +
      'сенсу за відповіддю. Без привітань, без коментарів, без лапок — лише саме питання. ' +
      langLine(lang),
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

/**
 * Builds the Digital Twin from the interview.
 * Returns { traits[4-6], vibe, summary, portrait{values,pace,attachment,conflict,closeness,dealbreakers} }.
 * `portrait` holds the comparable psychological axes used for matching.
 */
export async function generateProfile(qaLines, gender, lang) {
  const response = await getClient().messages.create({
    model: MODEL,
    max_tokens: 2500,
    system:
      PERSONA +
      genderLine(gender) +
      'Проаналізуй інтерв\'ю й сформуй зашифрований профіль «Digital Twin». Поверни JSON:\n' +
      '- traits: 4–6 коротких (1–3 слова) тегів стилю та характеру, у правильному роді;\n' +
      '- vibe: одна вишукана фраза (3–6 слів), що передає загальний вайб людини;\n' +
      '- summary: рівно 2 преміальних, теплих речення від імені Sixtio, звертання на «ти», ' +
      'про те, ким ти побачила цю людину;\n' +
      '- portrait: обʼєкт із 6 стислих (1 речення кожне) психологічних осей для зіставлення сумісності: ' +
      'values (що для неї найважливіше), pace (темп і ритм життя), attachment (як любить і прив\'язується), ' +
      'conflict (як поводиться в конфлікті), closeness (що для неї справжня близькість і чого потребує), ' +
      'dealbreakers (її чіткі межі — чого вона більше не готова терпіти у стосунках; з відповіді про це). ' +
      'Осі пиши нейтрально й точно — вони порівнюватимуться з іншими людьми. ' +
      langLine(lang),
    messages: [{ role: 'user', content: qaLines.join('\n') }],
    output_config: {
      format: {
        type: 'json_schema',
        schema: {
          type: 'object',
          properties: {
            traits: { type: 'array', items: { type: 'string' } },
            vibe: { type: 'string' },
            summary: { type: 'string' },
            portrait: {
              type: 'object',
              properties: {
                values: { type: 'string' },
                pace: { type: 'string' },
                attachment: { type: 'string' },
                conflict: { type: 'string' },
                closeness: { type: 'string' },
                dealbreakers: { type: 'string' },
              },
              required: ['values', 'pace', 'attachment', 'conflict', 'closeness', 'dealbreakers'],
              additionalProperties: false,
            },
          },
          required: ['traits', 'vibe', 'summary', 'portrait'],
          additionalProperties: false,
        },
      },
    },
  });
  if (response.stop_reason === 'refusal') {
    throw new Error('Claude refused the profile request');
  }
  const parsed = parseModelJson(textOf(response));
  if (!Array.isArray(parsed.traits) || typeof parsed.summary !== 'string') {
    throw new Error('Claude profile JSON has unexpected shape');
  }
  return {
    traits: parsed.traits.slice(0, 6),
    vibe: typeof parsed.vibe === 'string' ? parsed.vibe : '',
    summary: parsed.summary,
    portrait: parsed.portrait || null,
  };
}

/**
 * Picks the most compatible candidate for `person` from `candidates`.
 * Returns { best: index | -1, score: 1-10, reason: "2 sentences" }.
 */
export async function scoreCandidates(person, candidates, lang) {
  const response = await getClient().messages.create({
    model: MATCH_MODEL,
    // Generous budget: strong models may use adaptive thinking here, which shares
    // this budget with the JSON output — too low truncates the response.
    max_tokens: 4000,
    system:
      PERSONA +
      'Тобі дають Digital Twin людини та список кандидатів (кожен зі своїм portrait — ' +
      'осями values / pace / attachment / conflict / closeness / dealbreakers). Зістав портрети й обери ' +
      'ОДНОГО найсумiснiшого кандидата за глибинною психологічною сумісністю: збіг цінностей, ' +
      'сумісність темпу життя, взаємодоповнення стилів конфлікту та потреб у близькості. ' +
      'Зваж стилі прив\'язаності (attachment): тривожний + уникаючий — ризикована пара; ' +
      'двоє надійних або надійний із будь-ким — міцніше. ' +
      'КРИТИЧНО про межі: перевір dealbreakers ОБОХ сторін — якщо кандидат явно порушує межі людини, ' +
      'АБО людина порушує межі кандидата, це сильний мінус: не обирай таку пару попри інші збіги. ' +
      'Спільне місто та інтереси — приємний бонус, але не головне. Поверни JSON: best — index ' +
      'найкращого кандидата, або -1 якщо ніхто не пасує по-справжньому; score — сумісність 1–10 ' +
      '(чесно й вимогливо, не завищуй); reason — рівно 2 вишуканих теплих речення, ' +
      'чому саме ці двоє резонують (звертання «ви», без імен). ' +
      langLine(lang),
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
  const parsed = parseModelJson(textOf(response));
  if (typeof parsed.best !== 'number' || typeof parsed.score !== 'number') {
    throw new Error('Claude matching JSON has unexpected shape');
  }
  // `reason` is stored in matches.reason AND sent verbatim in the Telegram
  // notification — it must never carry leaked JSON/meta-commentary.
  parsed.reason = sanitizeAiText(parsed.reason);
  return parsed;
}
