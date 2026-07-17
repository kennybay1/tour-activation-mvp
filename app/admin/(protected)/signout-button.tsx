"use client";

import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function SignOutButton() {
  const router = useRouter();
  return (
    <button
      onClick={async () => {
        await supabase.auth.signOut();
        router.push("/admin/login");
        router.refresh();
      }}
      className="rounded-xl border border-zinc-700 px-4 py-2 text-sm font-medium text-zinc-300 transition hover:border-zinc-500 active:scale-[0.98]"
    >
      Sign out
    </button>
  );
}
