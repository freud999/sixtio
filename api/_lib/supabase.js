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

/** Upserts the Telegram user into public.users and returns the row id. */
export async function upsertUser(tgUser) {
  const name = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ') || null;
  const { data, error } = await getSupabase()
    .from('users')
    .upsert({ telegram_id: tgUser.id, name }, { onConflict: 'telegram_id' })
    .select('id')
    .single();
  if (error) throw error;
  return data.id;
}
