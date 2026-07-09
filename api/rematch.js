import { resolveUser, pickLang } from './_lib/telegram.js';
import { findUserId } from './_lib/supabase.js';
import { runMatching } from './_lib/matching.js';

// User-triggered "find me a match" (the button on the matches page).
// Explicit, so it never spends AI budget or pings people without intent.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { initData, lang: clientLang } = req.body || {};
    const tgUser = resolveUser(initData);
    if (!tgUser) {
      return res.status(401).json({ error: 'Invalid Telegram initData' });
    }
    const userId = await findUserId(tgUser.id);
    if (!userId) return res.status(200).json({ matched: false });

    // Match reason is generated in the requester's chosen UI language (Task 36).
    const result = await runMatching(userId, pickLang(clientLang, tgUser));
    return res.status(200).json({ matched: !!result });
  } catch (e) {
    console.error('api/rematch failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
