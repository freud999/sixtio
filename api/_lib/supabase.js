import { createClient } from '@supabase/supabase-js';

let client;

export function getSupabase() {
  if (!client) {
    client = createClient(
      process.env.SUPABASE_URL,
      process.env.SUPABASE_SERVICE_ROLE_KEY,
      { auth: { persistSession: false } }
    );
  }
  return client;
}

/** Looks up an existing user id by Telegram id without writing anything. */
export async function findUserId(telegramId) {
  const { data, error } = await getSupabase()
    .from('users')
    .select('id')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  return data ? data.id : null;
}

/** All of the user's matches (newest first) as [{ matchId, partnerId, score, reason }]. */
export async function getMatchesFor(userId) {
  const { data, error } = await getSupabase()
    .from('matches')
    .select('id, user_a, user_b, score, reason, created_at')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data || []).map((m) => ({
    matchId: m.id,
    partnerId: m.user_a === userId ? m.user_b : m.user_a,
    score: m.score,
    reason: m.reason,
    createdAt: m.created_at,
  }));
}

/** The user's most recent match as { matchId, partnerId } or null. */
export async function getActiveMatch(userId) {
  const all = await getMatchesFor(userId);
  return all.length ? { matchId: all[0].matchId, partnerId: all[0].partnerId } : null;
}

/** How many matches a user currently has. */
export async function countMatches(userId) {
  const { count, error } = await getSupabase()
    .from('matches')
    .select('id', { count: 'exact', head: true })
    .or(`user_a.eq.${userId},user_b.eq.${userId}`);
  if (error) throw error;
  return count || 0;
}

/** True if these two users are already matched together. */
export async function pairExists(userId, otherId) {
  const [a, b] = userId < otherId ? [userId, otherId] : [otherId, userId];
  const { data, error } = await getSupabase()
    .from('matches')
    .select('id')
    .eq('user_a', a)
    .eq('user_b', b)
    .limit(1);
  if (error) throw error;
  return data && data.length > 0;
}

/**
 * Telegram-exchange state for one match from `userId`'s side.
 * Returns { matchId, side, shareMine, shareBoth, partnerId, partnerUsername }.
 * partnerUsername is revealed only once both sides consented.
 */
export async function getShareState(userId, matchId) {
  const { data: row, error } = await getSupabase()
    .from('matches')
    .select('id, user_a, user_b, share_a, share_b')
    .eq('id', matchId)
    .maybeSingle();
  if (error) throw error;
  if (!row || (row.user_a !== userId && row.user_b !== userId)) return null;

  const side = row.user_a === userId ? 'a' : 'b';
  const shareMine = side === 'a' ? row.share_a : row.share_b;
  const shareBoth = row.share_a && row.share_b;
  const partnerId = side === 'a' ? row.user_b : row.user_a;

  let partnerUsername = null;
  if (shareBoth) {
    const { data: partner } = await getSupabase()
      .from('users')
      .select('tg_username')
      .eq('id', partnerId)
      .maybeSingle();
    partnerUsername = (partner && partner.tg_username) || null;
  }
  return { matchId: row.id, side, shareMine, shareBoth, partnerId, partnerUsername };
}

/** Records this user's consent to reveal Telegram on a match, returns new state. */
export async function setShareConsent(userId, matchId) {
  const state = await getShareState(userId, matchId);
  if (!state) return null;
  if (!state.shareMine) {
    const col = state.side === 'a' ? 'share_a' : 'share_b';
    const { error } = await getSupabase()
      .from('matches')
      .update({ [col]: true })
      .eq('id', matchId);
    if (error) throw error;
  }
  return getShareState(userId, matchId);
}

/** Resolves a matchId the caller belongs to; falls back to the most recent. */
export async function resolveMatchForUser(userId, matchId) {
  const all = await getMatchesFor(userId);
  if (!all.length) return null;
  if (matchId) {
    const found = all.find((m) => m.matchId === matchId);
    return found || null;
  }
  return all[0];
}

// --- Feedback flow (Task 38) ---------------------------------------------
// A bare "/feedback" arms this flag; the user's next plain message is captured
// as feedback (no reply-quote needed). Only fires within FEEDBACK_WINDOW_MS.
export const FEEDBACK_WINDOW_MS = 10 * 60 * 1000;

/** Arms the "awaiting feedback" flag for a registered user (no-op if unknown). */
export async function armFeedback(telegramId) {
  const { error } = await getSupabase()
    .from('users')
    .update({ feedback_pending_at: new Date().toISOString() })
    .eq('telegram_id', telegramId);
  if (error) throw error;
}

/**
 * Reads and clears the flag in one shot. Returns true only if it was armed and
 * still fresh (within FEEDBACK_WINDOW_MS) — so a stale flag never captures an
 * unrelated message. Always clears, so it can fire at most once per /feedback.
 */
export async function consumeFeedback(telegramId) {
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('users')
    .select('feedback_pending_at')
    .eq('telegram_id', telegramId)
    .maybeSingle();
  if (error) throw error;
  if (!data || !data.feedback_pending_at) return false;

  await supabase
    .from('users')
    .update({ feedback_pending_at: null })
    .eq('telegram_id', telegramId);

  return Date.now() - new Date(data.feedback_pending_at).getTime() <= FEEDBACK_WINDOW_MS;
}

/**
 * Permanently deletes a user and everything tied to them. The foreign keys
 * cascade (answers, profile, matches, messages); the stored photo is removed too.
 * Photo cleanup is best-effort and never blocks the row deletion. Shared by the
 * in-app /api/delete-account endpoint and the bot's /delete command.
 */
export async function deleteUserCascade(userId) {
  const supabase = getSupabase();
  try {
    await supabase.storage.from('photos').remove([`${userId}.jpg`, `${userId}_blur.jpg`]);
  } catch (storageError) {
    console.error('photo cleanup failed:', storageError.message);
  }
  const { error } = await supabase.from('users').delete().eq('id', userId);
  if (error) throw error;
}

// --- Block & Report (migration 022) --------------------------------------
// Blocking is a private, two-way hide. reportUser flags to the owner and, past a
// threshold of distinct reporters, shadow-hides the target from every feed.

/** Appends target to blocker's blocked_users (atomic, dedup-guarded). */
export async function blockUser(blockerId, targetId) {
  const { error } = await getSupabase().rpc('block_user', { blocker: blockerId, target: targetId });
  if (error) throw error;
}

/** Removes target from blocker's blocked_users. */
export async function unblockUser(blockerId, targetId) {
  const { error } = await getSupabase().rpc('unblock_user', { blocker: blockerId, target: targetId });
  if (error) throw error;
}

/** Records a report and auto-hides past `hideThreshold`. Returns distinct-reporter count. */
export async function reportUser(reporterId, targetId, reason, hideThreshold) {
  const { data, error } = await getSupabase().rpc('report_user', {
    reporter: reporterId, target: targetId,
    reason_text: reason ? String(reason).slice(0, 500) : null,
    hide_threshold: hideThreshold,
  });
  if (error) throw error;
  return typeof data === 'number' ? data : 0;
}

/** True if either user has blocked the other (checks both directions in one read). */
export async function areUsersBlocked(aId, bId) {
  const { data, error } = await getSupabase()
    .from('users').select('id, blocked_users').in('id', [aId, bId]);
  if (error) throw error;
  for (const r of data || []) {
    const other = r.id === aId ? bId : aId;
    if ((r.blocked_users || []).includes(other)) return true;
  }
  return false;
}

/**
 * The full set of user ids this user must never see (and who must never see
 * them): everyone THEY blocked, plus everyone who blocked THEM. Pass the caller's
 * own blocked_users array (already loaded on their row) to save a round-trip.
 * Shadow-hidden users are filtered separately at the candidate level.
 */
export async function getHiddenUserIds(userId, myBlockedList) {
  const set = new Set(myBlockedList || []);
  const { data, error } = await getSupabase()
    .from('users').select('id').contains('blocked_users', [userId]);
  if (error) throw error;
  for (const r of data || []) set.add(r.id);
  return set;
}

/** Upserts the Telegram user into public.users and returns the row id. */
export async function upsertUser(tgUser) {
  const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || null;
  const { data, error } = await getSupabase()
    .from('users')
    .upsert(
      { telegram_id: tgUser.id, name, tg_username: tgUser.username || null },
      { onConflict: 'telegram_id' }
    )
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}
