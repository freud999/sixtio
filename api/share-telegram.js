import { resolveUser } from './_lib/telegram.js';
import { findUserId, resolveMatchForUser, getShareState, setShareConsent } from './_lib/supabase.js';

// Mutual-consent Telegram exchange.
// GET-style (action:"state") returns current state; action:"consent" records
// this user's agreement. Usernames are revealed only when both sides agreed.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { initData, matchId, action } = req.body || {};
    const tgUser = resolveUser(initData);
    if (!tgUser) {
      return res.status(401).json({ error: 'Invalid Telegram initData' });
    }
    const userId = await findUserId(tgUser.id);
    if (!userId) return res.status(409).json({ error: 'Not registered' });

    const match = await resolveMatchForUser(userId, matchId);
    if (!match) return res.status(409).json({ error: 'No match' });

    const state =
      action === 'consent'
        ? await setShareConsent(userId, match.matchId)
        : await getShareState(userId, match.matchId);
    if (!state) return res.status(409).json({ error: 'No match' });

    return res.status(200).json({
      shareMine: state.shareMine,
      shareBoth: state.shareBoth,
      partnerUsername: state.partnerUsername,
    });
  } catch (e) {
    console.error('api/share-telegram failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
