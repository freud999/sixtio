import { resolveUser } from './_lib/telegram.js';
import { getSupabase, findUserId, getActiveMatch } from './_lib/supabase.js';
import { notifyNewMessage } from './_lib/bot.js';

const MAX_LEN = 2000;

// Sends a chat message to the current user's match and pings the partner.
export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const { initData, text } = req.body || {};
    const tgUser = resolveUser(initData);
    if (!tgUser) {
      return res.status(401).json({ error: 'Invalid Telegram initData' });
    }
    const body = typeof text === 'string' ? text.trim() : '';
    if (!body) return res.status(400).json({ error: 'text is required' });
    if (body.length > MAX_LEN) return res.status(413).json({ error: 'Message too long' });

    const supabase = getSupabase();
    const userId = await findUserId(tgUser.id);
    const match = userId ? await getActiveMatch(userId) : null;
    if (!match) return res.status(409).json({ error: 'No match yet' });

    const { data: inserted, error } = await supabase
      .from('messages')
      .insert({ match_id: match.matchId, sender_id: userId, text: body })
      .select('id, created_at')
      .single();
    if (error) throw error;

    // Notify the partner out-of-band; never let a bot failure block sending.
    try {
      const { data: me } = await supabase.from('users').select('name').eq('id', userId).maybeSingle();
      const { data: partner } = await supabase
        .from('users')
        .select('telegram_id')
        .eq('id', match.partnerId)
        .maybeSingle();
      if (partner) {
        await notifyNewMessage(partner, me ? me.name : '', body.slice(0, 120));
      }
    } catch (notifyError) {
      console.error('new-message notify failed:', notifyError.message);
    }

    return res.status(200).json({
      ok: true,
      message: { id: inserted.id, text: body, mine: true, createdAt: inserted.created_at },
    });
  } catch (e) {
    console.error('api/send-message failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}
