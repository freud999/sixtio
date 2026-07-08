// Sixtio — Telegram bot profile & command localization (Task 30).
//
// One-time (idempotent) setup script. Pushes the bot's public-facing copy to
// Telegram in all three supported interface languages, so @Sixtiobot looks
// premium and native no matter which language the user's Telegram is set to.
//
// This is NOT a serverless function — it lives in /scripts and is run by hand:
//     TELEGRAM_BOT_TOKEN=xxxxx node scripts/setup-bot.mjs
// (or set the token in the environment first). It never touches the DB.
//
// Telegram lets every profile field be localized per `language_code`. We set:
//   • the DEFAULT (no language_code) to English — the safest international base,
//   • uk / ru explicit overrides for our home markets.
// Fields:
//   setMyName            — the bot's display name (identical across languages)
//   setMyShortDescription— the one-liner under the bot's name / in share cards
//   setMyDescription     — the "What can this bot do?" text shown on the START
//                          screen before the user presses Start (this IS the
//                          effective /start welcome for a Mini-App bot with no
//                          message webhook)
//   setMyCommands        — the / command menu

const TOKEN = process.env.TELEGRAM_BOT_TOKEN;
if (!TOKEN) {
  console.error('TELEGRAM_BOT_TOKEN is not set. Run: TELEGRAM_BOT_TOKEN=xxx node scripts/setup-bot.mjs');
  process.exit(1);
}

const api = async (method, payload) => {
  const res = await fetch(`https://api.telegram.org/bot${TOKEN}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`${method}: ${data.description || res.status}`);
  return data.result;
};

// --- Copy (premium, psych-intelligent, sleek AI-matchmaker voice) -----------
const NAME = 'Sixtio';

const SHORT = {
  en: 'Your AI matchmaker. Real connections by psychological compatibility — not swipes.',
  uk: 'Твоя AI-сваха. Справжні знайомства за психологічною сумісністю — без свайпів.',
  ru: 'Твоя AI-сваха. Настоящие знакомства по психологической совместимости — без свайпов.',
};

// Shown on the Start screen — this is the effective /start welcome.
const DESCRIPTION = {
  en:
    'Sixtio is not another swipe app. 💜\n\n' +
    'It\'s an AI matchmaker that asks a few sincere questions, learns who you really are, ' +
    'and introduces you to people you\'re genuinely compatible with — mind first.\n\n' +
    '✨ A short, warm interview instead of endless swiping\n' +
    '🧠 Deep compatibility across five personality dimensions\n' +
    '🔒 Private — no one sees your Telegram profile\n\n' +
    'Tap Start and meet someone who actually fits.',
  uk:
    'Sixtio — це не черговий свайп-застосунок. 💜\n\n' +
    'Це AI-сваха, яка ставить кілька щирих запитань, вивчає, хто ти насправді, ' +
    'і знайомить із людьми, з якими у тебе справжня сумісність — розумом передусім.\n\n' +
    '✨ Коротке тепле інтерв\'ю замість нескінченних свайпів\n' +
    '🧠 Глибока сумісність за п\'ятьма вимірами особистості\n' +
    '🔒 Приватно — твого профілю Telegram ніхто не бачить\n\n' +
    'Тисни «Почати» і познайомся з тим, хто справді пасує.',
  ru:
    'Sixtio — это не очередное свайп-приложение. 💜\n\n' +
    'Это AI-сваха, которая задаёт несколько искренних вопросов, изучает, кто ты на самом деле, ' +
    'и знакомит с людьми, с которыми у тебя настоящая совместимость — умом прежде всего.\n\n' +
    '✨ Короткое тёплое интервью вместо бесконечных свайпов\n' +
    '🧠 Глубокая совместимость по пяти измерениям личности\n' +
    '🔒 Приватно — твой профиль Telegram никто не видит\n\n' +
    'Жми «Начать» и познакомься с тем, кто действительно подходит.',
};

const COMMANDS = {
  en: [{ command: 'start', description: 'Meet Sixtio & find your match' }],
  uk: [{ command: 'start', description: 'Познайомитись із Sixtio і знайти пару' }],
  ru: [{ command: 'start', description: 'Познакомиться с Sixtio и найти пару' }],
};

async function run() {
  // Name is language-neutral; set once (default scope).
  await api('setMyName', { name: NAME });
  console.log('OK  setMyName');

  // Default scope = English (international base), then explicit uk / ru.
  for (const [lang, code] of [['en', undefined], ['uk', 'uk'], ['ru', 'ru']]) {
    const langArg = code ? { language_code: code } : {};
    await api('setMyShortDescription', { short_description: SHORT[lang], ...langArg });
    await api('setMyDescription', { description: DESCRIPTION[lang], ...langArg });
    await api('setMyCommands', { commands: COMMANDS[lang], ...langArg });
    console.log(`OK  short/description/commands -> ${code || 'default(en)'}`);
  }
  console.log('\n✅ Bot profile localized for en (default) / uk / ru.');
}

run().catch((e) => { console.error('setup-bot failed:', e.message); process.exit(1); });
