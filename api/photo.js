import { resolveUser } from './_lib/telegram.js';
import { getSupabase, upsertUser } from './_lib/supabase.js';

// Accepts a client-side-downscaled JPEG as base64 (data URL or raw),
// stores it in the public `photos` bucket, and saves the URL on the user.
const MAX_BASE64_LENGTH = 4 * 1024 * 1024; // ~3 MB decoded, under Vercel's body limit

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { initData, imageBase64 } = req.body || {};
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

    const base64 = imageBase64.replace(/^data:image\/\w+;base64,/, '');
    let buffer;
    try {
      buffer = Buffer.from(base64, 'base64');
    } catch {
      return res.status(400).json({ error: 'Invalid base64' });
    }
    // JPEG magic bytes — the client always sends canvas-encoded JPEG.
    if (buffer.length < 100 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
      return res.status(400).json({ error: 'Not a JPEG image' });
    }

    const supabase = getSupabase();
    const userId = await upsertUser(tgUser);
    const path = `${userId}.jpg`;

    const { error: uploadError } = await supabase.storage
      .from('photos')
      .upload(path, buffer, { contentType: 'image/jpeg', upsert: true });
    if (uploadError) throw uploadError;

    const { data: pub } = supabase.storage.from('photos').getPublicUrl(path);
    // Cache-buster: the file name is stable, so browsers would otherwise show the old photo.
    const photoUrl = `${pub.publicUrl}?v=${Date.now()}`;

    const { error } = await supabase.from('users').update({ photo_url: photoUrl }).eq('id', userId);
    if (error) throw error;

    return res.status(200).json({ ok: true, photoUrl });
  } catch (e) {
    console.error('api/photo failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
