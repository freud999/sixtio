// Telegram WebApp SDK wrapper.
// Inside Telegram: uses the real WebApp (theme, haptics, viewport).
// In a plain browser (preview): falls back to matchMedia + navigator.vibrate.

const tg = (typeof window !== 'undefined' && window.Telegram && window.Telegram.WebApp) || null;

export function initTelegram() {
  if (!tg) return;
  try {
    tg.ready();
    tg.expand();
    // keep the header/background in step with our porcelain shell
    if (tg.setBackgroundColor) tg.setBackgroundColor('#EDE8DF');
  } catch { /* older clients */ }
}

// initial theme: Telegram colorScheme first, else system preference
export function initialTheme() {
  if (tg && tg.colorScheme) return tg.colorScheme === 'dark' ? 'dark' : 'light';
  if (typeof window !== 'undefined' && window.matchMedia) {
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }
  return 'light';
}

export function onThemeChange(cb) {
  if (tg && tg.onEvent) {
    const h = () => cb(tg.colorScheme === 'dark' ? 'dark' : 'light');
    tg.onEvent('themeChanged', h);
    return () => tg.offEvent && tg.offEvent('themeChanged', h);
  }
  if (typeof window !== 'undefined' && window.matchMedia) {
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const h = (e) => cb(e.matches ? 'dark' : 'light');
    mq.addEventListener('change', h);
    return () => mq.removeEventListener('change', h);
  }
  return () => {};
}

// Haptics — Telegram HapticFeedback when available, else Vibration API.
// `kind`: 'light' | 'medium' | 'heavy' | 'success' | 'warning' | 'error' | 'select'
export function haptic(kind = 'light') {
  const hf = tg && tg.HapticFeedback;
  if (hf) {
    try {
      if (kind === 'success' || kind === 'warning' || kind === 'error') hf.notificationOccurred(kind);
      else if (kind === 'select') hf.selectionChanged();
      else hf.impactOccurred(kind); // light|medium|heavy
      return;
    } catch { /* fall through */ }
  }
  if (typeof navigator !== 'undefined' && navigator.vibrate) {
    const map = { light: 5, medium: 8, heavy: 12, select: 4, success: [8, 30, 14], warning: 10, error: [10, 40, 10] };
    try { navigator.vibrate(map[kind] ?? 6); } catch { /* blocked */ }
  }
}

export const inTelegram = !!tg;
