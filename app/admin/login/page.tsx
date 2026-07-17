"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function AdminLogin() {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    if (error) {
      setError("Wrong email or password.");
      setBusy(false);
      return;
    }
    router.replace("/admin");
    router.refresh();
  };

  return (
    <div className="flex min-h-dvh items-center justify-center bg-zinc-950 px-5 text-zinc-100 antialiased">
      <form onSubmit={onSubmit} className="w-full max-w-sm">
        <h1 className="text-2xl font-bold tracking-tight">Admin sign in</h1>
        <p className="mt-1 text-sm text-zinc-500">Tour Activation</p>

        <label
          htmlFor="email"
          className="mb-2 mt-8 block text-sm font-medium text-zinc-300"
        >
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 outline-none focus:border-fuchsia-500"
        />

        <label
          htmlFor="password"
          className="mb-2 mt-4 block text-sm font-medium text-zinc-300"
        >
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-zinc-700 bg-zinc-900 px-4 py-3 text-zinc-100 outline-none focus:border-fuchsia-500"
        />

        {error && <p className="mt-4 text-sm text-red-400">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full rounded-xl bg-zinc-50 py-3 font-semibold text-zinc-950 transition active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>
      </form>
    </div>
  );
}
