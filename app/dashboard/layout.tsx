import { requireUser, supabaseServer } from "@/lib/supabase-server";
import DashboardSignOut from "./signout-button";

export const dynamic = "force-dynamic";

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();

  // Authenticated client — RLS only lets the organiser see their own profile.
  const supabase = await supabaseServer();
  const { data: profile } = await supabase
    .from("profiles")
    .select("org_name")
    .eq("id", user.id)
    .maybeSingle();

  return (
    <div className="grain min-h-dvh bg-cream font-sans text-ink">
      <header className="border-b border-ink/20">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <div>
            <p className="font-serif text-xl italic">Moments</p>
            <p className="text-xs uppercase tracking-[0.2em] text-ink/50">
              {profile?.org_name || user.email}
            </p>
          </div>
          <DashboardSignOut />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-8">{children}</main>
    </div>
  );
}
