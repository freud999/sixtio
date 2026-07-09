import { resolveUser } from './_lib/telegram.js';
import { findUserId, deleteUserCascade } from './_lib/supabase.js';

// Permanently deletes the user and everything tied to them. The foreign keys
// cascade (answers, profile, matches, messages); the photo is removed too.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { initData } = req.body || {};
    const tgUser = resolveUser(initData);
    if (!tgUser) {
      return res.status(401).json({ error: 'Invalid Telegram initData' });
    }

    const userId = await findUserId(tgUser.id);
    if (!userId) return res.status(200).json({ ok: true }); // already gone

    await deleteUserCascade(userId);

    return res.status(200).json({ ok: true });
  } catch (e) {
    console.error('api/delete-account failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
