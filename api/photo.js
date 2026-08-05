import { resolveUser } from './_lib/telegram.js';
import { getSupabase, upsertUser } from './_lib/supabase.js';
import { rateLimit, LIMITS, sendRateLimited } from './_lib/ratelimit.js';
import { moderatePhoto, photoModerationFailOpen } from './_lib/claude.js';
// The gate runs on Anthropic now (PRIV-1, option B), so "out of quota" is an
// HTTP 429 from that SDK rather than a typed Gemini error. Its `retry-after`
// header, when present, is the only honest number to hand the client.
function isRateLimit(e) {
  return !!e && (e.status === 429 || /\b429\b|rate.?limit/i.test(String(e.message || '')));
}
function retryAfterOf(e) {
  const h = e && e.headers && (e.headers['retry-after'] || e.headers.get?.('retry-after'));
  const n = Number(h);
  return Number.isFinite(n) && n > 0 ? Math.ceil(n) : 60;
}
import { signPhoto, photoKey, blurKey } from './_lib/photos.js';
import { notifyOwner } from './_lib/bot.js';

// Accepts a client-side-downscaled JPEG as base64 (data URL or raw), stores it in
// the PRIVATE `photos` bucket, and records the object KEY on the user (not a URL).
// Delivery is always a short-lived signed URL minted at read time (SEC-1), so the
// full-res file can't be fetched by guessing a public URL past the blur paywall.
const MAX_BASE64_LENGTH = 4 * 1024 * 1024; // ~3 MB decoded, under Vercel's body limit

// Decodes a data-URL/raw base64 JPEG to a Buffer, or null if it isn't valid JPEG
// (checks the SOI magic bytes). `limit` caps the base64 length defensively.
function decodeJpeg(dataUrl, limit = MAX_BASE64_LENGTH) {
  if (typeof dataUrl !== 'string' || !dataUrl || dataUrl.length > limit) return null;
  const base64 = dataUrl.replace(/^data:image\/\w+;base64,/, '');
  let buffer;
  try { buffer = Buffer.from(base64, 'base64'); } catch { return null; }
  if (buffer.length < 100 || buffer[0] !== 0xff || buffer[1] !== 0xd8) return null;
  return buffer;
}

// An unreachable safety gate is an incident, not a user error, so it pings the
// owner rather than only the logs — that is the whole lesson of 2026-08-01.
// Throttled per warm instance: an outage hits every uploader at once, and a
// hundred identical alerts are read as noise and muted, which is how the alarm
// stops working. Deliberately in-memory (no DB round-trip on an upload path);
// a cold start re-arms it, which is the right bias for an alarm.
const MODERATION_ALERT_INTERVAL_MS = 10 * 60 * 1000;
let lastModerationAlertAt = 0;

function alertModerationDown(err, failOpen) {
  const now = Date.now();
  if (now - lastModerationAlertAt < MODERATION_ALERT_INTERVAL_MS) return;
  lastModerationAlertAt = now;
  const reason = String(err && err.message ? err.message : err)
    .slice(0, 300)
    .replace(/[<>&]/g, (c) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' }[c]));
  // Rate limiting is a different incident from an outage: nothing is broken, we
  // are simply going too fast. Saying "DOWN" for it would send us debugging the
  // provider instead of waiting out a window.
  const head = isRateLimit(err)
    ? (failOpen
      ? '⚠️ <b>Photo moderation SKIPPED — rate limited</b>\nPhotos are being stored UNCHECKED (fail-open is ON).'
      : '⏳ <b>Photo moderation paused — rate limited</b>\nUploads are asked to retry shortly (fail-closed).')
    : (failOpen
      ? '⚠️ <b>Photo moderation is DOWN and fail-open is ON</b>\nPhotos are being stored UNCHECKED.'
      : '🚨 <b>Photo moderation is DOWN</b>\nUploads are being refused (fail-closed).');
  notifyOwner(`${head}\n<pre>${reason}</pre>`).catch(() => {});
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { initData, imageBase64, blurBase64 } = req.body || {};
    const tgUser = resolveUser(initData);
    if (!tgUser) {
      return res.status(401).json({ error: 'Invalid Telegram initData' });
    }

    const rl = rateLimit(`photo:${tgUser.id}`, LIMITS.photo);
    if (!rl.allowed) return sendRateLimited(res, rl.retryAfterSec);

    if (typeof imageBase64 !== 'string' || !imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required' });
    }
    if (imageBase64.length > MAX_BASE64_LENGTH) {
      return res.status(413).json({ error: 'Image too large' });
    }

    const buffer = decodeJpeg(imageBase64);
    if (!buffer) return res.status(400).json({ error: 'Not a JPEG image' });

    // Safety gate: reject explicit NSFW (nudity/sexual/graphic-violence) before
    // the photo is ever stored or shown. A missing face is fine and passes.
    //
    // FAIL-CLOSED (2026-08-01). This used to swallow the error and store the
    // photo unchecked, which meant a Gemini outage silently turned NSFW
    // moderation off on an 18+ product while every upload still returned 200 —
    // indistinguishable, from the outside, from a working gate. No check, no
    // upload. The two failures below are different events and are treated as
    // such: a verdict of "nsfw" is a normal product answer (422, no alert),
    // being unable to GET a verdict is an outage (503, alert, retryable).
    try {
      const verdict = await moderatePhoto(buffer.toString('base64'));
      if (verdict.nsfw) {
        console.warn(`photo rejected (nsfw) for tg ${tgUser.id}: ${verdict.reason}`);
        return res.status(422).json({ error: 'photo_rejected' });
      }
    } catch (modErr) {
      const failOpen = photoModerationFailOpen();
      console.error(
        `photo moderation unavailable (${failOpen ? 'fail-open OVERRIDE' : 'fail-closed'}):`,
        modErr.message
      );
      alertModerationDown(modErr, failOpen);
      if (!failOpen) {
        // 503 + Retry-After, not 500: the client already turns this into
        // "check unavailable, try again in a minute" with a retry button
        // (onboarding.html, profile.html). A rate limit carries the provider's
        // own window, so the hint is a real number rather than a shrug.
        const retryAfter = isRateLimit(modErr) ? retryAfterOf(modErr) : 60;
        res.setHeader('Retry-After', String(retryAfter));
        return res.status(503).json({ error: 'moderation_unavailable', retryAfter });
      }
    }

    const supabase = getSupabase();
    const userId = await upsertUser(tgUser);

    const { error: uploadError } = await supabase.storage
      .from('photos')
      .upload(photoKey(userId), buffer, { contentType: 'image/jpeg', upsert: true });
    if (uploadError) throw uploadError;

    // Blurred thumbnail (client-generated, tiny). Served to free males INSTEAD of
    // the real photo, so the full-res object is never signed for a non-entitled
    // client. Optional & best-effort: an old client that doesn't send one just
    // gets the legacy behavior (feed shows no photo to free males for this profile).
    let blurStoredKey = null;
    const blurBuf = typeof blurBase64 === 'string' && blurBase64
      ? decodeJpeg(blurBase64, MAX_BASE64_LENGTH) : null;
    if (blurBuf) {
      const { error: blurErr } = await supabase.storage
        .from('photos')
        .upload(blurKey(userId), blurBuf, { contentType: 'image/jpeg', upsert: true });
      if (blurErr) console.error('blur thumb upload failed:', blurErr.message);
      else blurStoredKey = blurKey(userId);
    }

    // Store the object KEYS, not URLs — the bucket is private and every read mints
    // a fresh signed URL. The columns double as "has a (blur) photo" presence flags.
    const patch = { photo_url: photoKey(userId) };
    if (blurStoredKey) patch.photo_blur_url = blurStoredKey;
    const { error } = await supabase.from('users').update(patch).eq('id', userId);
    if (error) throw error;

    // Immediate self-preview: a signed URL for the just-uploaded full photo.
    const photoUrl = await signPhoto(photoKey(userId), supabase);
    return res.status(200).json({ ok: true, photoUrl });
  } catch (e) {
    console.error('api/photo failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
