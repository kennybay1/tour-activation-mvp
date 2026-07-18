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
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <div>
            <p className="font-serif text-xl italic">Tour Activation</p>
            <p className="text-xs uppercase tracking-[0.2em] text-ink/50">
              Admin — {user.email}
            </p>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-8">{children}</main>
    </div>
  );
}
