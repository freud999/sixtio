// Error reporting (F-22 / OPS-1).
//
// THE PROBLEM. The app has ~100 `console.error` calls and, on Vercel Hobby,
// logs live about an hour and cannot be forwarded anywhere. So an error is only
// ever seen by someone who happens to open the dashboard during that hour,
// looking at the right function. In practice that means errors are seen when
// they are already an outage — which is exactly how three failures survived for
// 13.5 hours, 7 days and 12.5 hours in one week.
//
// Sentry is a service that receives errors and keeps them: grouped by cause,
// counted, with the stack trace and the surrounding context, searchable months
// later. The Telegram alerts we already have answer "is something on fire right
// now"; this answers "what exactly broke, how often, and since when" — the
// question you cannot answer from a log that no longer exists.
//
// WHY NO SDK. @sentry/node is a large dependency that patches globals at import
// time, and every millisecond of it lands on cold starts for all 12 functions.
// What we actually need is one HTTPS POST of a documented JSON envelope. This
// file is that POST. Zero dependencies, nothing patched, nothing imported when
// SENTRY_DSN is unset.
//
// THE RULE: reporting an error must never cause one. Every failure in here is
// swallowed. A monitoring system that can take the app down is worse than no
// monitoring system, because it converts "we lost visibility" into "we lost the
// product".

let parsed;          // memoised DSN parse: undefined = not tried, null = unusable
let warnedBadDsn = false;

/**
 * Sentry DSN: https://<publicKey>@<host>/<projectId>
 * Returns { url, key } for the envelope endpoint, or null.
 */
function dsn() {
  if (parsed !== undefined) return parsed;
  const raw = String(process.env.SENTRY_DSN || '').trim();
  if (!raw) { parsed = null; return parsed; }
  try {
    const u = new URL(raw);
    const projectId = u.pathname.replace(/^\/+/, '');
    if (!u.username || !projectId) throw new Error('missing key or project id');
    parsed = {
      url: `${u.protocol}//${u.host}/api/${projectId}/envelope/?sentry_key=${u.username}&sentry_version=7`,
      key: u.username,
    };
  } catch (e) {
    // Loud once, then silent: a malformed DSN means errors are going nowhere,
    // and that is itself worth knowing — but not worth a line per request.
    if (!warnedBadDsn) {
      warnedBadDsn = true;
      console.error('SENTRY_DSN is set but unusable, errors are NOT being reported:', e.message);
    }
    parsed = null;
  }
  return parsed;
}

/** True when errors are actually going somewhere. Used by /envcheck. */
export function sentryConfigured() {
  return !!dsn();
}

/** Test seam + config reload after an env change. */
export function resetSentry() { parsed = undefined; warnedBadDsn = false; }

function frames(stack) {
  return String(stack || '')
    .split('\n')
    .slice(1, 30)
    .map((line) => ({ filename: line.trim() }))
    .reverse();   // Sentry renders oldest-first
}

/**
 * Report one error. Fire-and-forget by design: nothing awaits it, nothing
 * depends on it, and a serverless function that is about to return a 500
 * should not spend its remaining budget on telemetry.
 *
 * @param {Error|string} err
 * @param {{route?: string, op?: string, userId?: string, extra?: object}} [ctx]
 *        NEVER pass user text, answers, bios or intimate markers. This leaves
 *        our infrastructure and goes to a third party — the same reasoning that
 *        moved Art. 9 data off Gemini applies here (PRIV-1). Ids and route
 *        names are enough to find the bug.
 */
export function captureError(err, ctx = {}) {
  const d = dsn();
  if (!d) return;
  try {
    const e = err instanceof Error ? err : new Error(String(err));
    const eventId = (globalThis.crypto && globalThis.crypto.randomUUID)
      ? globalThis.crypto.randomUUID().replace(/-/g, '')
      : Math.random().toString(16).slice(2).padEnd(32, '0').slice(0, 32);

    const event = {
      event_id: eventId,
      timestamp: Date.now() / 1000,
      platform: 'node',
      level: 'error',
      logger: ctx.route || 'app',
      environment: process.env.VERCEL_ENV || 'local',
      release: process.env.VERCEL_GIT_COMMIT_SHA || undefined,
      server_name: undefined,   // never leak instance identity
      exception: {
        values: [{
          type: e.name || 'Error',
          value: String(e.message || '').slice(0, 1000),
          stacktrace: { frames: frames(e.stack) },
        }],
      },
      tags: {
        route: ctx.route || 'unknown',
        op: ctx.op || undefined,
      },
      // user.id is our internal uuid, not the Telegram identity — enough to
      // answer "is this one person or everyone", which is the question that
      // decides whether something is an incident (OPS-3).
      user: ctx.userId ? { id: String(ctx.userId) } : undefined,
      extra: ctx.extra || undefined,
    };

    const body =
      JSON.stringify({ event_id: eventId, sent_at: new Date().toISOString() }) + '\n' +
      JSON.stringify({ type: 'event' }) + '\n' +
      JSON.stringify(event) + '\n';

    // 3s and no retry: this is the last thing a dying request should wait on.
    fetch(d.url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-sentry-envelope' },
      body,
      signal: AbortSignal.timeout(3000),
    }).catch(() => {});
  } catch {
    // Deliberately empty. See THE RULE at the top of this file.
  }
}
