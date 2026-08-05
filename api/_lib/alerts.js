// Throttled owner alerts for degradation events.
//
// Degradation is invisible by design — that is the point of it — so the only
// thing that tells us it is happening is the alert. But an AI quota outage hits
// every request at once, and a hundred identical pings in a minute get muted,
// which is exactly how an alarm stops working. So: one per key per interval.
//
// In-memory on purpose. It lives as long as the warm instance, costs no DB
// round-trip on a user path, and a cold start re-arms it — the right bias for
// an alarm, and the same trade api/photo.js already makes for moderation.

import { notifyOwner } from './bot.js';

const DEFAULT_INTERVAL_MS = 10 * 60 * 1000;
const lastSentAt = new Map();   // key -> ms

/** HTML-escapes text that goes inside the <pre> of an alert. */
export function escapeAlert(s) {
  return String(s == null ? '' : s)
    .slice(0, 300)
    .replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
}

/**
 * Sends `text` at most once per `intervalMs` for `key`. Returns true if it was
 * sent. Never throws and never awaited on a user path — a failed ping must not
 * be able to fail the request it is reporting on.
 */
export function alertThrottled(key, text, intervalMs = DEFAULT_INTERVAL_MS) {
  const now = Date.now();
  const last = lastSentAt.get(key) || 0;
  if (now - last < intervalMs) return false;
  lastSentAt.set(key, now);
  notifyOwner(text).catch(() => {});
  return true;
}

/** Test seam: forget every throttle window. */
export function resetAlertThrottle() {
  lastSentAt.clear();
}
