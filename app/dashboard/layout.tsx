import type { Metadata } from "next";
import {
  requireUser,
  getAdminUser,
  supabaseServer,
} from "@/lib/supabase-server";
import SiteHeader from "../site-header";
import { UnsavedChangesProvider } from "../unsaved-changes";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  robots: { index: false, follow: false },
};

export default async function DashboardLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireUser();
  const admin = await getAdminUser();

  // Authenticated client — RLS only lets the organiser see their own profile.
  const supabase = await supabaseServer();
  const { data: profile } = await supabase
    .from("profiles")
    .select("org_name")
    .eq("id", user.id)
    .maybeSingle();

  return (
    // The provider wraps the header too — header links must be able to ask
    // the campaign form about unsaved changes before navigating away.
    <UnsavedChangesProvider>
      <div className="grain min-h-dvh bg-cream font-sans text-ink">
        <SiteHeader
          session={{
            orgName: profile?.org_name || user.email || "Account",
            isAdmin: !!admin,
          }}
        />
        <main className="mx-auto max-w-4xl px-5 py-8">{children}</main>
      </div>
    </UnsavedChangesProvider>
  );
}
