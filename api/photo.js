import { resolveUser } from './_lib/telegram.js';
import { getSupabase, upsertUser } from './_lib/supabase.js';
import { rateLimit, LIMITS, sendRateLimited } from './_lib/ratelimit.js';
import { moderatePhoto } from './_lib/gemini.js';
import { signPhoto, photoKey, blurKey } from './_lib/photos.js';

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
    // Fail-open — if the vision check errors, never block a legitimate upload
    // (the crowd-report auto-hide from migration 022 stays as the human net).
    try {
      const verdict = await moderatePhoto(buffer.toString('base64'));
      if (verdict.nsfw) {
        console.warn(`photo rejected (nsfw) for tg ${tgUser.id}: ${verdict.reason}`);
        return res.status(422).json({ error: 'photo_rejected' });
      }
    } catch (modErr) {
      console.error('photo moderation skipped (fail-open):', modErr.message);
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
