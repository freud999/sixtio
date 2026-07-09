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
 * Returns the signed start_param from initData (e.g. "ref_123456" for referral
 * links opened via t.me/Bot?startapp=ref_123456), or null if absent/invalid.
 * start_param is part of the HMAC-signed payload, so this is trustworthy.
 */
export function getStartParam(initData) {
  if (!validateInitData(initData, process.env.TELEGRAM_BOT_TOKEN)) return null;
  const param = new URLSearchParams(initData).get('start_param');
  return param || null;
}

/**
 * Maps the user's native Telegram interface language to a supported app
 * language (Task 26). language_code arrives inside the HMAC-signed initData
 * user object, so it's server-trustworthy — no extra client field needed.
 * uk -> uk; ru/be -> ru; any other real code (es, de, …) -> en; missing -> uk.
 */
export function resolveLang(tgUser) {
  const code = String((tgUser && tgUser.language_code) || '')
    .toLowerCase()
    .split('-')[0];
  if (!code) return 'uk';
  if (code === 'uk') return 'uk';
  if (code === 'ru' || code === 'be') return 'ru';
  return 'en';
}

/**
 * Prefers an EXPLICIT client-supplied UI language (the in-app UA/RU/EN switcher,
 * sent as `lang` on every API call) over the Telegram account language. This is
 * essential on Telegram Desktop, where the signed language_code is the account
 * language and never reflects the user's chosen interface language — so AI
 * content and stored bot-notification language must follow the switcher instead.
 * Only the three whitelisted values are honored; anything else falls back to the
 * signed Telegram language, so an arbitrary client string can inject nothing.
 */
export function pickLang(clientLang, tgUser) {
  const c = String(clientLang || '').toLowerCase();
  if (c === 'uk' || c === 'ru' || c === 'en') return c;
  return resolveLang(tgUser);
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
