import { resolveUser } from './_lib/telegram.js';
import {
  getSupabase, findUserId, resolveMatchForUser,
  getShareState, setShareConsent,
} from './_lib/supabase.js';
import { notifyNewMessage } from './_lib/bot.js';

// Consolidated conversation endpoint. Vercel Hobby caps a project at 12
// serverless functions, so the three chat operations share one file, routed
// on `op` (all key off the same match, resolved via matchId):
//   op: 'list'  -> body { matchId? }            read the conversation + partner card
//   op: 'send'  -> body { matchId?, text }      send a message + ping the partner
//   op: 'share' -> body { matchId?, action }    mutual Telegram-handle exchange
// (Legacy callers that omit `op` but send `text` still send; otherwise list.)
const MAX_LEN = 2000;

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  try {
    const body = req.body || {};
    const tgUser = resolveUser(body.initData);
    if (!tgUser) {
      return res.status(401).json({ error: 'Invalid Telegram initData' });
    }

    const op = body.op || (typeof body.text === 'string' ? 'send' : 'list');
    if (op === 'send') return send(res, tgUser, body);
    if (op === 'share') return share(res, tgUser, body);
    return list(res, tgUser, body);
  } catch (e) {
    console.error('api/chat failed:', e);
    return res.status(500).json({ error: 'Internal error' });
  }
}

// --- List ---------------------------------------------------------------
// Returns one conversation: the partner's public card + the message history.
// Accepts an optional matchId (multi-match); defaults to the most recent match.
async function list(res, tgUser, body) {
  const supabase = getSupabase();
  const userId = await findUserId(tgUser.id);
  const match = userId ? await resolveMatchForUser(userId, body.matchId) : null;
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
    matchId: match.matchId,
    partner: {
      name: (partner && (partner.name || '').split(' ')[0]) || 'Твоя пара',
      photoUrl: partner ? partner.photo_url : null,
    },
    messages,
  });
}

// --- Send ---------------------------------------------------------------
// Sends a chat message to the current user's match and pings the partner.
async function send(res, tgUser, body) {
  const text = typeof body.text === 'string' ? body.text.trim() : '';
  if (!text) return res.status(400).json({ error: 'text is required' });
  if (text.length > MAX_LEN) return res.status(413).json({ error: 'Message too long' });

  const supabase = getSupabase();
  const userId = await findUserId(tgUser.id);
  const match = userId ? await resolveMatchForUser(userId, body.matchId) : null;
  if (!match) return res.status(409).json({ error: 'No match yet' });

  const { data: inserted, error } = await supabase
    .from('messages')
    .insert({ match_id: match.matchId, sender_id: userId, text })
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
      await notifyNewMessage(partner, me ? me.name : '', text.slice(0, 120), match.matchId);
    }
  } catch (notifyError) {
    console.error('new-message notify failed:', notifyError.message);
  }

  return res.status(200).json({
    ok: true,
    message: { id: inserted.id, text, mine: true, createdAt: inserted.created_at },
  });
}

// --- Share --------------------------------------------------------------
// Mutual-consent Telegram exchange. action:"state" returns current state;
// action:"consent" records this user's agreement. Usernames are revealed only
// when both sides agreed.
async function share(res, tgUser, body) {
  const userId = await findUserId(tgUser.id);
  if (!userId) return res.status(409).json({ error: 'Not registered' });

  const match = await resolveMatchForUser(userId, body.matchId);
  if (!match) return res.status(409).json({ error: 'No match' });

  const state =
    body.action === 'consent'
      ? await setShareConsent(userId, match.matchId)
      : await getShareState(userId, match.matchId);
  if (!state) return res.status(409).json({ error: 'No match' });

  return res.status(200).json({
    shareMine: state.shareMine,
    shareBoth: state.shareBoth,
    partnerUsername: state.partnerUsername,
  });
}
