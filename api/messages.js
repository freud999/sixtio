import { resolveUser } from './_lib/telegram.js';
import { getSupabase, findUserId, getActiveMatch } from './_lib/supabase.js';

// Returns the conversation for the current user's match: the partner's public
// card + the message history. Each message is tagged as 'me' or 'them'.
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

    const supabase = getSupabase();
    const userId = await findUserId(tgUser.id);
    const match = userId ? await getActiveMatch(userId) : null;
    if (!match) {
      return res.status(200).json({ hasMatch: false, partner: null, messages: [] });
    }

    const { data: partner } = await supabase
      .from('users')
      .select('name, photo_url')
      .eq('id', match.partnerId)
      .maybeSingle();

    const { data: rows, error } = await supabase
      .from('messages')
      .select('id, sender_id, text, created_at')
      .eq('match_id', match.matchId)
      .order('created_at', { ascending: true })
      .limit(500);
    if (error) throw error;

    const messages = (rows || []).map((m) => ({
      id: m.id,
      text: m.text,
      mine: m.sender_id === userId,
      createdAt: m.created_at,
    }));

    return res.status(200).json({
      hasMatch: true,
      partner: {
        name: (partner && (partner.name || '').split(' ')[0]) || 'Твоя пара',
        photoUrl: partner ? partner.photo_url : null,
      },
      messages,
    });
  } catch (e) {
    console.error('api/messages failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
