import { createHmac } from 'node:crypto';

const MAX_AGE_SECONDS = 24 * 60 * 60;

/**
 * Validates Telegram Mini App initData (HMAC-SHA256 per official docs)
 * and returns the parsed user object, or null if invalid/expired.
 */
export function validateInitData(initData, botToken) {
  if (!initData || !botToken) return null;

  const params = new URLSearchParams(initData);
  const hash = params.get('hash');
  if (!hash) return null;
  params.delete('hash');

  const dataCheckString = [...params.entries()]
    .map(([key, value]) => `${key}=${value}`)
    .sort()
    .join('\n');

  const secretKey = createHmac('sha256', 'WebAppData').update(botToken).digest();
  const computed = createHmac('sha256', secretKey).update(dataCheckString).digest('hex');
  if (computed !== hash) return null;

  const authDate = Number(params.get('auth_date') || 0);
  if (!authDate || Date.now() / 1000 - authDate > MAX_AGE_SECONDS) return null;

  try {
    const user = JSON.parse(params.get('user') || '');
    return user && user.id ? user : null;
  } catch {
    return null;
  }
}

/**
 * Resolves the Telegram user from initData.
 * ALLOW_FAKE_AUTH=1 is a local-dev escape hatch (never set it on Vercel):
 * real initData is still preferred, but a stub user is returned without it.
 */
export function resolveUser(initData) {
  const real = validateInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
  if (real) return real;
  if (process.env.ALLOW_FAKE_AUTH === '1') {
    // FAKE_TG_ID lets local testing impersonate a specific registered user.
    const fakeId = parseInt(process.env.FAKE_TG_ID || '', 10);
    return { id: fakeId || 777000, first_name: 'Dev' };
  }
  return null;
}
