import { createBrowserClient } from "@supabase/ssr";

// Browser client. Cookie-based session storage so the server can also
// see the login session (used by the admin area).
export const supabase = createBrowserClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);
