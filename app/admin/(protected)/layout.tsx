import Link from "next/link";
import { requireAdmin } from "@/lib/supabase-server";
import SignOutButton from "./signout-button";

export const dynamic = "force-dynamic";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await requireAdmin();

  return (
    <div className="grain min-h-dvh bg-cream font-sans text-ink">
      <header className="border-b border-ink/20">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-5 py-4">
          <div className="flex items-baseline gap-8">
            <div>
              <p className="font-serif text-xl italic">Moments</p>
              <p className="text-xs uppercase tracking-[0.2em] text-ink/50">
                Platform admin — {user.email}
              </p>
            </div>
            <nav className="flex gap-5 text-sm font-medium">
              <Link
                href="/admin"
                className="text-ink/70 underline-offset-4 hover:text-ink hover:underline"
              >
                Campaigns
              </Link>
              <Link
                href="/admin/accounts"
                className="text-ink/70 underline-offset-4 hover:text-ink hover:underline"
              >
                Accounts
              </Link>
              <Link
                href="/admin/leads"
                className="text-ink/70 underline-offset-4 hover:text-ink hover:underline"
              >
                Leads
              </Link>
            </nav>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-5 py-8">{children}</main>
    </div>
  );
}
