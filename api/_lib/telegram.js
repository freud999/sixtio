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

// True on any Vercel environment. ALLOW_FAKE_AUTH is a LOCAL-DEV-ONLY escape
// hatch — CLAUDE.md: "NEVER set ALLOW_FAKE_AUTH on Vercel" — so its presence on
// a deployment is always a misconfiguration. VERCEL=1 is set in every Vercel
// environment (build + runtime, production/preview/development), so this is the
// fail-closed signal; the VERCEL_ENV checks are belt-and-suspenders. The custom
// npm-run-dev server sets neither, so genuine local dev is unaffected.
const IS_DEPLOYED =
  process.env.VERCEL === '1' ||
  process.env.VERCEL_ENV === 'production' ||
  process.env.VERCEL_ENV === 'preview';

// Alert the owner at most once per process (cold-started lambda) if fake auth is
// somehow enabled on a deployment. Dynamic import keeps resolveUser synchronous
// and avoids any import cycle; notifyOwner is a no-op without OWNER_TELEGRAM_ID
// and never throws, so this can't break the auth path.
let prodFakeAuthAlerted = false;
function alertProdFakeAuthOnce() {
  if (prodFakeAuthAlerted) return;
  prodFakeAuthAlerted = true;
  import('./bot.js')
    .then((m) => m.notifyOwner(
      '🚨 <b>ALLOW_FAKE_AUTH is set on a Vercel deployment.</b> Fake login is ' +
      'force-disabled, but remove this env var from the project immediately.'
    ))
    .catch(() => {});
}

/**
 * Resolves the Telegram user from initData.
 * ALLOW_FAKE_AUTH=1 is a LOCAL-DEV-ONLY escape hatch (never set it on Vercel):
 * real initData is always preferred, and a stub user is returned ONLY on a
 * non-deployed (local) run. On any Vercel deployment fake auth is impossible
 * regardless of the env var's value, and the misconfig is alerted to the owner.
 */
export function resolveUser(initData) {
  if (IS_DEPLOYED && process.env.ALLOW_FAKE_AUTH === '1') alertProdFakeAuthOnce();

  const real = validateInitData(initData, process.env.TELEGRAM_BOT_TOKEN);
  if (real) return real;

  if (process.env.ALLOW_FAKE_AUTH === '1' && !IS_DEPLOYED) {
    // FAKE_TG_ID lets local testing impersonate a specific registered user.
    const fakeId = parseInt(process.env.FAKE_TG_ID || '', 10);
    return { id: fakeId || 777000, first_name: 'Dev' };
  }
  return null;
}
