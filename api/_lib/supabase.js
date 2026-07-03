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

/** Returns the user's most recent match as { matchId, partnerId } or null. */
export async function getActiveMatch(userId) {
  const { data, error } = await getSupabase()
    .from('matches')
    .select('id, user_a, user_b')
    .or(`user_a.eq.${userId},user_b.eq.${userId}`)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    matchId: data.id,
    partnerId: data.user_a === userId ? data.user_b : data.user_a,
  };
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
