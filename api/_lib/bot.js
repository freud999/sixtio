const APP_URL = process.env.APP_URL || 'https://sixtio.vercel.app';

async function callBot(method, payload) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  const data = await res.json();
  if (!data.ok) throw new Error(`Telegram ${method}: ${data.description || res.status}`);
  return data.result;
}

/** Sends the "we found you a match" message to one user about their partner. */
async function notifyOne(to, partner, reason) {
  const name = (partner.name || '').split(' ')[0] || 'Хтось особливий';
  const line = `${name}, ${partner.age}${partner.city ? ' · ' + partner.city : ''}`;
  const text =
    `💜 Sixtio знайшла тобі пару!\n\n` +
    `${line}\n\n` +
    `${reason}\n\n` +
    `Відкрий Sixtio, щоб побачити профіль ✨`;
  const reply_markup = {
    inline_keyboard: [[{ text: 'Відкрити Sixtio', web_app: { url: APP_URL } }]],
  };
  try {
    if (partner.photo_url) {
      await callBot('sendPhoto', {
        chat_id: to.telegram_id,
        photo: partner.photo_url,
        caption: text,
        reply_markup,
      });
    } else {
      await callBot('sendMessage', { chat_id: to.telegram_id, text, reply_markup });
    }
  } catch (e) {
    // A user who never pressed Start can't receive bot messages — don't fail the match.
    console.error(`match notification to ${to.telegram_id} failed:`, e.message);
  }
}

export async function notifyMatchBoth(userOne, userTwo, reason) {
  await notifyOne(userOne, userTwo, reason);
  await notifyOne(userTwo, userOne, reason);
}

/** Pings a user that their match sent them a new in-app message. */
export async function notifyNewMessage(to, fromName, preview, matchId) {
  const name = (fromName || '').split(' ')[0] || 'Твоя пара';
  const text = `💬 ${name} написав(-ла) тобі:\n\n"${preview}"`;
  const url = matchId
    ? `${APP_URL}/conversation.html?match=${encodeURIComponent(matchId)}`
    : `${APP_URL}/chat.html`;
  const reply_markup = {
    inline_keyboard: [[{ text: 'Відповісти в Sixtio', web_app: { url } }]],
  };
  try {
    await callBot('sendMessage', { chat_id: to.telegram_id, text, reply_markup });
  } catch (e) {
    console.error(`new-message ping to ${to.telegram_id} failed:`, e.message);
  }
}
