import "server-only";
import { createClient, SupabaseClient } from "@supabase/supabase-js";

// Server-side client using the service role key. The "server-only" import
// makes the build fail if this file is ever pulled into browser code.
let client: SupabaseClient | null = null;

export function supabaseAdmin(): SupabaseClient {
  if (!client) {
    client = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.SUPABASE_SERVICE_ROLE_KEY!,
      { auth: { persistSession: false, autoRefreshToken: false } }
    );
  }
  return client;
}
