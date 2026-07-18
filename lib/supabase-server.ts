import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { createServerClient } from "@supabase/ssr";
import type { User } from "@supabase/supabase-js";
import { supabaseAdmin } from "./supabase-admin";

// Anon-key client that reads the auth session from request cookies.
// Used only to identify the logged-in user — data access goes through
// the service-role client in supabase-admin.ts.
export async function supabaseServer() {
  const cookieStore = await cookies();
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => cookieStore.getAll(),
        setAll: (cookiesToSet) => {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Server Components cannot write cookies; middleware handles
            // session refresh persistence.
          }
        },
      },
    }
  );
}

// Fails closed: no session, no ADMIN_EMAIL configured, or a mismatch
// all return null.
export const getAdminUser = cache(async (): Promise<User | null> => {
  // Read cookies before anything can short-circuit, so Next always treats
  // admin pages as per-request (never statically prerendered).
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  // Belt and braces: the session's email must match ADMIN_EMAIL AND the
  // profile must be flagged is_admin (checked with the service role, so
  // no client-side state can influence it). Fails closed on both.
  const adminEmail = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  if (!adminEmail) return null;
  if (!user?.email || user.email.toLowerCase() !== adminEmail) return null;
  const { data: profile } = await supabaseAdmin()
    .from("profiles")
    .select("is_admin")
    .eq("id", user.id)
    .maybeSingle();
  if (!profile?.is_admin) return null;
  return user;
});

export async function requireAdmin(): Promise<User> {
  const user = await getAdminUser();
  if (!user) redirect("/admin/login");
  return user;
}

// Any signed-in organiser (no approval required — approval gates
// publishing, not building).
export const getSessionUser = cache(async (): Promise<User | null> => {
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user ?? null;
});

export async function requireUser(): Promise<User> {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  return user;
}
