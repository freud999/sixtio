import { resolveUser, resolveLang } from './_lib/telegram.js';
import {
  getSupabase, findUserId, resolveMatchForUser,
  getShareState, setShareConsent,
} from './_lib/supabase.js';
import { notifyNewMessage } from './_lib/bot.js';
import { entitlements, WHY_FACTOR_PRICE } from './_lib/entitlements.js';
import { generateWhyFactor } from './_lib/gemini.js';
import { handleTelegramUpdate } from './_lib/analytics.js';

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

    // Telegram webhook updates (owner /stats analytics) are POSTed here too — the
    // bot's webhook points at /api/chat. They carry `update_id` and no initData, so
    // intercept them before the Mini App auth path. Function count stays at 12.
    if (body.update_id !== undefined) return handleTelegramUpdate(req, res, body);

    const tgUser = resolveUser(body.initData);
    if (!tgUser) {
      return res.status(401).json({ error: 'Invalid Telegram initData' });
    }

    const op = body.op || (typeof body.text === 'string' ? 'send' : 'list');
    if (op === 'send') return send(res, tgUser, body);
    if (op === 'share') return share(res, tgUser, body);
    if (op === 'the_why_factor') return whyFactor(res, tgUser, body);
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

  const NAME_FALLBACK = { uk: 'Твоя пара', en: 'Your match', ru: 'Твоя пара' };
  return res.status(200).json({
    hasMatch: true,
    matchId: match.matchId,
    partner: {
      name: (partner && (partner.name || '').split(' ')[0]) ||
        NAME_FALLBACK[resolveLang(tgUser)] || NAME_FALLBACK.uk,
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
      .select('telegram_id, language_code')
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

// --- The Why Factor (premium / 10 ⭐) ------------------------------------
// Generates one AI paragraph on why the current user and their match are deeply
// compatible. Premium reveals for free; everyone else pays WHY_FACTOR_PRICE ⭐.
// Order is intentional: we generate FIRST, then charge atomically on success —
// so a Gemini failure never costs the user Stars, and the guarded RPC still makes
// the deduction race-safe (never double-charge, never negative). The intimate
// layer is fed to the AI ONLY on a mutual Dark Mode opt-in (both sides), so a
// paying user can never surface a partner's intimate profile without her consent.
async function whyFactor(res, tgUser, body) {
  const supabase = getSupabase();

  const { data: me, error: meErr } = await supabase
    .from('users')
    .select('id, gender, premium, premium_until, stars_balance, dark_mode_active, kink_markers')
    .eq('telegram_id', tgUser.id)
    .maybeSingle();
  if (meErr) throw meErr;
  if (!me) return res.status(409).json({ error: 'Not registered' });

  const match = await resolveMatchForUser(me.id, body.matchId);
  if (!match) return res.status(409).json({ error: 'No match' });

  const ent = entitlements(me);
  let starsBalance = me.stars_balance || 0;

  // Free males get ONE free Why Factor reveal per UTC day (a conversion taste);
  // every later reveal is locked behind Stars. Premium (all females + premium
  // males) is always free & unlimited. Daily usage is derived from the append-only
  // ledger, so the free/paid decision is server-authoritative and can't be forged
  // by the client. The text payload is generated & returned ONLY on the free look
  // or an explicitly confirmed paid unlock — never on a locked/insufficient reply.
  let freeToday = false;
  if (!ent.premiumActive) {
    const since = new Date(); since.setUTCHours(0, 0, 0, 0);
    const { count, error: cErr } = await supabase
      .from('star_transactions')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', me.id)
      .in('feature', ['why_factor', 'why_factor_free'])
      .gte('created_at', since.toISOString());
    if (cErr) throw cErr;
    freeToday = (count || 0) === 0;

    if (!freeToday && !body.confirmUnlock) {
      // Today's free look is spent: withhold the text, tell the client to render
      // the blurred lock + "Розблокувати за Stars" CTA. Nothing is generated.
      return res.status(200).json({ ok: false, reason: 'locked', locked: true, price: WHY_FACTOR_PRICE, starsBalance });
    }
    if (!freeToday && starsBalance < WHY_FACTOR_PRICE) {
      // Paid unlock requested but unaffordable — route the client to the shop.
      return res.status(200).json({ ok: false, reason: 'insufficient', paywall: true, starsBalance });
    }
  }

  const PCOLS = 'traits_json, trait_openness, trait_conscientiousness, trait_extraversion, trait_agreeableness, trait_neuroticism';
  const { data: myProfile } = await supabase
    .from('profiles').select(PCOLS).eq('user_id', me.id).maybeSingle();
  const { data: partner } = await supabase
    .from('users').select('name, gender, dark_mode_active, kink_markers').eq('id', match.partnerId).maybeSingle();
  const { data: partnerProfile } = await supabase
    .from('profiles').select(PCOLS).eq('user_id', match.partnerId).maybeSingle();

  // Intimate markers only on a MUTUAL Dark Mode opt-in — otherwise withheld.
  // The paragraph is generated in the requesting user's native language (Task 26).
  const mutualIntimate = !!(me.dark_mode_active && partner && partner.dark_mode_active);
  const text = await generateWhyFactor(
    { gender: me.gender, traits: myProfile, kink: mutualIntimate ? me.kink_markers : [] },
    {
      name: partner && partner.name, gender: partner && partner.gender,
      traits: partnerProfile, kink: mutualIntimate ? (partner && partner.kink_markers) : [],
    },
    resolveLang(tgUser)
  );

  // Settle after a successful generation (premium reveals free). For free males:
  // the daily free look logs a 0-amount ledger marker so tomorrow's gate — and a
  // second look today — see it; a paid unlock deducts atomically and logs revenue.
  if (!ent.premiumActive) {
    if (freeToday) {
      const { error: logErr } = await supabase
        .from('star_transactions')
        .insert({ user_id: me.id, feature: 'why_factor_free', amount: 0 });
      if (logErr) throw logErr;
    } else {
      const { data: newBalance, error: spendErr } = await supabase.rpc('spend_stars', {
        buyer: me.id, price: WHY_FACTOR_PRICE, feat: 'why_factor',
      });
      if (spendErr) throw spendErr;
      if (newBalance === null || newBalance === undefined) {
        // Lost a race for the last Stars between the pre-gate and the charge.
        return res.status(200).json({ ok: false, reason: 'insufficient', paywall: true, starsBalance });
      }
      starsBalance = newBalance;
    }
  }

  return res.status(200).json({ ok: true, text, free: !ent.premiumActive && freeToday, starsBalance });
}
