import { getSupabase } from './supabase.js';

// Acquisition-source tracking via Telegram `?start=` deep links.
//
// Flow (see migration 029): the payload of t.me/Bot?start=<src> reaches the bot
// WEBHOOK as "/start <src>", before the users row exists. We stage it in
// signup_sources (keyed by telegram_id) and copy it onto users.source exactly
// once, at registration. A returning, already-registered user with an empty
// source may be backfilled — but we never overwrite an existing attribution, so
// the first ad a user came from always wins.

// Telegram's own deep-link payload limit is 64 chars; allow only URL-safe token
// characters. Anything else is treated as "no source" (organic).
const SOURCE_RE = /^[A-Za-z0-9_-]{1,64}$/;
// `ref_<id>` is the REFERRAL channel (see referrals.js), not an ad source — keep
// the two attribution systems from colliding.
const REFERRAL_PREFIX = 'ref_';

/**
 * Pulls the payload out of a "/start <payload>" message. Returns the raw payload
 * string, or null for a bare "/start" (organic) or a non-/start message. Pure.
 */
export function extractStartPayload(text) {
  if (typeof text !== 'string') return null;
  const trimmed = text.trim();
  const parts = trimmed.split(/\s+/);
  if (parts[0] !== '/start' && parts[0].split('@')[0] !== '/start') return null;
  return parts.length > 1 ? parts.slice(1).join(' ') : null;
}

/**
 * Validates a raw source payload. Returns the clean value, or null if it's
 * absent, malformed (non-token chars, >64 chars) or a referral code. Pure — the
 * single gate every entry point runs through, so bad input can never be stored.
 */
export function parseSource(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!SOURCE_RE.test(s)) return null;
  if (s.toLowerCase().startsWith(REFERRAL_PREFIX)) return null; // that's a referral
  return s;
}

/**
 * Decides what a /start with a (already validated) payload should do, given the
 * current user state. Pure, so the "don't overwrite / backfill once" rules are
 * unit-testable without a database:
 *   - no payload              -> 'skip'
 *   - user doesn't exist yet  -> 'stash'   (stage until they register)
 *   - user exists, no source  -> 'backfill'(fill once; log separately)
 *   - user exists, has source -> 'skip'    (never rewrite attribution)
 */
export function decideSourceAction({ userExists, existingSource, payload }) {
  if (!payload) return 'skip';
  if (!userExists) return 'stash';
  if (existingSource == null || existingSource === '') return 'backfill';
  return 'skip';
}

/**
 * Records the /start payload for a telegram_id that hasn't registered yet.
 * Insert-only: a repeat /start (even with a different ad) never overwrites the
 * first-seen source. Best-effort; never throws into the webhook path.
 */
export async function stashPendingSource(telegramId, source) {
  const clean = parseSource(source);
  if (!clean || !telegramId) return;
  try {
    // ignoreDuplicates: keep the earliest attribution on repeat /start.
    await getSupabase()
      .from('signup_sources')
      .upsert(
        { telegram_id: telegramId, source: clean, first_seen_at: new Date().toISOString() },
        { onConflict: 'telegram_id', ignoreDuplicates: true }
      );
  } catch (e) {
    console.error('stashPendingSource failed:', e.message);
  }
}

/**
 * Backfills users.source for an already-registered user who arrived via a
 * tracked /start but had no source yet. Guarded on source IS NULL so it can
 * never overwrite an existing attribution, and logs the backfill separately (per
 * spec) so it's distinguishable from first-registration attribution.
 */
export async function backfillExistingUserSource(userId, telegramId, source) {
  const clean = parseSource(source);
  if (!clean || !userId) return;
  try {
    const { data } = await getSupabase()
      .from('users')
      .update({ source: clean, source_first_seen_at: new Date().toISOString() })
      .eq('id', userId)
      .is('source', null)          // never clobber an existing source
      .select('id');
    if (data && data.length) {
      console.log(`[source] backfilled existing user ${userId} (tg ${telegramId}) with source="${clean}"`);
    }
  } catch (e) {
    console.error('backfillExistingUserSource failed:', e.message);
  }
}

/**
 * Applies a source to a user AT REGISTRATION — called right after the users row
 * is created (profile.js). Order of precedence for the value:
 *   1. an explicit non-referral `?startapp=` start_param (Mini App direct link)
 *   2. the pending payload staged at /start (signup_sources)
 * Writes users.source only when it's still NULL, so it is set once, on first
 * registration, and never overwrites. Best-effort; never throws into onboarding.
 */
export async function applySourceOnRegistration(userId, telegramId, startParamSource) {
  if (!userId || !telegramId) return;
  try {
    const supabase = getSupabase();

    // Skip entirely if this user already carries a source.
    const { data: existing } = await supabase
      .from('users').select('source').eq('id', userId).maybeSingle();
    if (existing && existing.source != null) return;

    // Prefer an explicit start_param, else the staged pending source.
    let source = parseSource(startParamSource);
    if (!source) {
      const { data: pending } = await supabase
        .from('signup_sources').select('source').eq('telegram_id', telegramId).maybeSingle();
      source = pending ? parseSource(pending.source) : null;
    }
    if (!source) return;

    await supabase
      .from('users')
      .update({ source, source_first_seen_at: new Date().toISOString() })
      .eq('id', userId)
      .is('source', null);         // race-safe: first-registration-only
  } catch (e) {
    console.error('applySourceOnRegistration failed:', e.message);
  }
}

/**
 * Orchestrates source capture from a /start webhook message: extract + validate
 * the payload, look up the user, and route to stash / backfill / skip via the
 * pure decideSourceAction. Best-effort; never throws into the webhook. A bare
 * "/start" (organic) or invalid payload is a no-op, so existing /start behaviour
 * is untouched.
 */
export async function captureStartSource(telegramId, text) {
  const payload = parseSource(extractStartPayload(text));
  if (!payload || !telegramId) return;
  try {
    const { data: user } = await getSupabase()
      .from('users').select('id, source').eq('telegram_id', telegramId).maybeSingle();
    const action = decideSourceAction({
      userExists: !!user,
      existingSource: user ? user.source : null,
      payload,
    });
    if (action === 'stash') await stashPendingSource(telegramId, payload);
    else if (action === 'backfill') await backfillExistingUserSource(user.id, telegramId, payload);
  } catch (e) {
    console.error('captureStartSource failed:', e.message);
  }
}

/**
 * Per-source acquisition funnel for /stats_sources. Returns an array of
 * { source, clicks, registrations, reg7d, reg30d, keyAction, completionRate }.
 * Aggregation runs in one SQL function (source_stats, migration 029).
 */
export async function sourceStats() {
  const { data, error } = await getSupabase().rpc('source_stats');
  if (error) throw error;
  return (data || []).map((r) => {
    const clicks = Number(r.clicks) || 0;
    const registrations = Number(r.registrations) || 0;
    return {
      source: r.source,
      clicks,
      registrations,
      reg7d: Number(r.reg_7d) || 0,
      reg30d: Number(r.reg_30d) || 0,
      keyAction: Number(r.key_action) || 0,
      completionRate: clicks > 0 ? registrations / clicks : null,
    };
  });
}
