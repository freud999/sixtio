import { resolveUser } from './_lib/telegram.js';
import { getSupabase, upsertUser } from './_lib/supabase.js';

// Accepts a client-side-downscaled JPEG as base64 (data URL or raw),
// stores it in the public `photos` bucket, and saves the URL on the user.
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
    if (typeof imageBase64 !== 'string' || !imageBase64) {
      return res.status(400).json({ error: 'imageBase64 is required' });
    }
    if (imageBase64.length > MAX_BASE64_LENGTH) {
      return res.status(413).json({ error: 'Image too large' });
    }

    const buffer = decodeJpeg(imageBase64);
    if (!buffer) return res.status(400).json({ error: 'Not a JPEG image' });

    const supabase = getSupabase();
    const userId = await upsertUser(tgUser);
    const stamp = Date.now();

    const { error: uploadError } = await supabase.storage
      .from('photos')
      .upload(`${userId}.jpg`, buffer, { contentType: 'image/jpeg', upsert: true });
    if (uploadError) throw uploadError;
    // Cache-buster: the file name is stable, so browsers would otherwise show the old photo.
    const photoUrl = `${supabase.storage.from('photos').getPublicUrl(`${userId}.jpg`).data.publicUrl}?v=${stamp}`;

    // Blurred thumbnail (client-generated, tiny). Served to free males INSTEAD of
    // the real photo, so the full-res URL never reaches a non-entitled client.
    // Optional & best-effort: an old client that doesn't send one just gets the
    // legacy behavior (feed shows no photo to free males for this profile).
    let photoBlurUrl = null;
    const blurBuf = typeof blurBase64 === 'string' && blurBase64
      ? decodeJpeg(blurBase64, MAX_BASE64_LENGTH) : null;
    if (blurBuf) {
      const { error: blurErr } = await supabase.storage
        .from('photos')
        .upload(`${userId}_blur.jpg`, blurBuf, { contentType: 'image/jpeg', upsert: true });
      if (blurErr) console.error('blur thumb upload failed:', blurErr.message);
      else photoBlurUrl = `${supabase.storage.from('photos').getPublicUrl(`${userId}_blur.jpg`).data.publicUrl}?v=${stamp}`;
    }

    const patch = { photo_url: photoUrl };
    if (photoBlurUrl) patch.photo_blur_url = photoBlurUrl;
    const { error } = await supabase.from('users').update(patch).eq('id', userId);
    if (error) throw error;

    return res.status(200).json({ ok: true, photoUrl });
  } catch (e) {
    console.error('api/photo failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
