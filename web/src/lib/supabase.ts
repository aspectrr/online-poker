import { createClient, type SupabaseClient } from "@supabase/supabase-js";

/**
 * Supabase client from env. Returns null when unset — pages must degrade
 * gracefully (show config hint instead of crashing).
 */
let client: SupabaseClient | null | undefined;

export function supabase(): SupabaseClient | null {
  if (client !== undefined) return client;
  const url = import.meta.env.VITE_SUPABASE_URL as string | undefined;
  const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined;
  client = url && key ? createClient(url, key) : null;
  return client;
}
