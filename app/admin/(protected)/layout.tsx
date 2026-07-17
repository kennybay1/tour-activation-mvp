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
    <div className="min-h-dvh bg-zinc-950 text-zinc-100 antialiased">
      <header className="border-b border-zinc-800">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-5 py-4">
          <div>
            <p className="font-semibold">Tour Activation</p>
            <p className="text-xs text-zinc-500">Admin — {user.email}</p>
          </div>
          <SignOutButton />
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-5 py-8">{children}</main>
    </div>
  );
}
