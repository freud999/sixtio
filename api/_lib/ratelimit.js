// In-memory per-user rate limiting — zero infrastructure, safe for serverless.
//
// Why in-memory (not Redis/DB): each Vercel instance keeps its own sliding-window
// log. A single abuser hammering AI / Telegram-Stars endpoints keeps hitting a
// warm instance and gets throttled there; cold starts reset the window (fail-open),
// which is exactly what we want — protection against cost-draining floods without
// ever blocking a legitimate user or adding paid infra. For hard cross-instance
// guarantees the money paths already rely on atomic, idempotent SQL RPCs, so this
// layer is defense-in-depth, not the sole safeguard.
//
// Usage:
//   import { rateLimit, LIMITS, sendRateLimited } from './_lib/ratelimit.js';
//   const rl = rateLimit(`profile:${tgUser.id}`, LIMITS.ai_heavy);
//   if (!rl.allowed) return sendRateLimited(res, rl.retryAfterSec);

// key -> ascending array of request timestamps (ms).
const store = new Map();
let lastSweep = 0;

// Named presets. Each rule is a {limit, windowMs} pair; a key may carry several
// windows (e.g. a burst-per-minute AND a sustained-per-hour cap) checked together.
export const LIMITS = {
  // Claude/Gemini profile generation + Big Five extraction — expensive, rare.
  ai_heavy: [{ limit: 6, windowMs: 60_000 }, { limit: 40, windowMs: 3_600_000 }],
  // Onboarding answers fire in bursts as the user types — keep this generous.
  answer: [{ limit: 30, windowMs: 60_000 }, { limit: 300, windowMs: 3_600_000 }],
  // Photo upload (+ blur thumb) — storage writes.
  photo: [{ limit: 8, windowMs: 60_000 }, { limit: 30, windowMs: 3_600_000 }],
  // Telegram-Stars spends (purchase / lootbox / mystery unlock).
  money: [{ limit: 20, windowMs: 60_000 }],
  // Cheap reads (feed, me, profile-info) — mostly anti-scraping.
  read: [{ limit: 120, windowMs: 60_000 }],
  // Writes/interactions (swipes, chat send, rematch, block/report).
  write: [{ limit: 60, windowMs: 60_000 }],
};

// Bound memory: occasionally drop keys whose newest entry is stale.
function maybeSweep(now) {
  if (now - lastSweep < 300_000) return; // at most every 5 min
  lastSweep = now;
  for (const [k, arr] of store) {
    if (!arr.length || arr[arr.length - 1] < now - 3_600_000) store.delete(k);
  }
}

// Returns { allowed:true } or { allowed:false, retryAfterSec }.
// Increments the counter only when the request is allowed.
export function rateLimit(key, rules) {
  const now = Date.now();
  const maxWindow = Math.max(...rules.map((r) => r.windowMs));

  let arr = store.get(key);
  if (!arr) {
    arr = [];
    store.set(key, arr);
  }
  // Trim entries older than the widest window (arr is ascending).
  const cutoff = now - maxWindow;
  let drop = 0;
  while (drop < arr.length && arr[drop] <= cutoff) drop++;
  if (drop) arr.splice(0, drop);

  // A request must satisfy every window.
  for (const r of rules) {
    const from = now - r.windowMs;
    let count = 0;
    for (let j = arr.length - 1; j >= 0 && arr[j] > from; j--) count++;
    if (count >= r.limit) {
      const oldest = arr.find((t) => t > from);
      const retryMs = oldest ? oldest + r.windowMs - now : r.windowMs;
      return { allowed: false, retryAfterSec: Math.max(1, Math.ceil(retryMs / 1000)) };
    }
  }

  arr.push(now);
  maybeSweep(now);
  return { allowed: true };
}

// Standard 429 with a Retry-After hint the client can back off on.
export function sendRateLimited(res, retryAfterSec) {
  res.setHeader('Retry-After', String(retryAfterSec));
  return res.status(429).json({ error: 'rate_limited', retryAfter: retryAfterSec });
}
