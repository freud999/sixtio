import { getSupabase } from './supabase.js';

// Photo delivery for a PRIVATE `photos` bucket (SEC-1). The bucket is no longer
// public: the full-res `<user_id>.jpg` can't be fetched by guessing the URL, so
// the blur/paywall can't be bypassed. Every delivery is a short-lived SIGNED URL
// minted here, server-side, ONLY after the caller has already applied its
// entitlement/blur rule (feed gender bias, paid reveal, mutual match, self, …).
//
// Object keys are deterministic from the user id (written by api/photo.js):
//   <user_id>.jpg       — full-res
//   <user_id>_blur.jpg  — pre-blurred thumbnail shown to non-entitled viewers
//
// TTL is deliberately short — long enough for a client render or a Telegram
// sendPhoto fetch, short enough that a leaked link dies quickly. A signed URL is
// unique per mint, which also retires the old ?v=<timestamp> cache-buster.
export const PHOTO_TTL_SEC = 300; // 5 minutes

export const photoKey = (userId) => `${userId}.jpg`;
export const blurKey = (userId) => `${userId}_blur.jpg`;

// Sign one key. Returns '' on empty key or ANY failure, so "no photo" and
// "couldn't sign" are indistinguishable to callers — it never throws and never
// leaks a raw path.
export async function signPhoto(key, supabase = getSupabase()) {
  if (!key) return '';
  try {
    const { data, error } = await supabase.storage
      .from('photos')
      .createSignedUrl(key, PHOTO_TTL_SEC);
    if (error || !data || !data.signedUrl) return '';
    return data.signedUrl;
  } catch {
    return '';
  }
}

// Batch-sign many keys in ONE round trip (feed deck, likers list). Returns
// Map<key, signedUrl>; keys that failed to sign are simply absent, so a caller
// that does `map.get(key) || ''` degrades to "no photo", never to a leak.
export async function signPhotos(keys, supabase = getSupabase()) {
  const uniq = [...new Set((keys || []).filter(Boolean))];
  const out = new Map();
  if (!uniq.length) return out;
  try {
    const { data, error } = await supabase.storage
      .from('photos')
      .createSignedUrls(uniq, PHOTO_TTL_SEC);
    if (!error && data) {
      for (const row of data) {
        if (row && row.signedUrl && !row.error) out.set(row.path, row.signedUrl);
      }
    }
  } catch {
    /* empty map = no photos; fail closed, never leak */
  }
  return out;
}
