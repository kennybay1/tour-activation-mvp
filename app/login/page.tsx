"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

const inputCls =
  "w-full rounded-xl border border-ink/30 bg-transparent px-4 py-3 text-ink placeholder-ink/30 outline-none focus:border-forest";
const labelCls =
  "mb-2 mt-4 block text-xs font-medium uppercase tracking-[0.2em] text-ink/60";

export default function LoginPage() {
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
    router.replace("/dashboard");
    router.refresh();
  };

  return (
    <div className="grain flex min-h-dvh items-center justify-center bg-cream px-5 font-sans text-ink">
      <form onSubmit={onSubmit} className="fade-up w-full max-w-sm">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-clay">
          Tour Activation
        </p>
        <h1 className="mt-3 font-serif text-4xl">Sign in</h1>

        <label htmlFor="email" className={labelCls}>
          Email
        </label>
        <input
          id="email"
          type="email"
          required
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className={inputCls}
        />

        <label htmlFor="password" className={labelCls}>
          Password
        </label>
        <input
          id="password"
          type="password"
          required
          autoComplete="current-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className={inputCls}
        />

        {error && <p className="mt-4 text-sm font-medium text-clay">{error}</p>}

        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full rounded-full bg-forest-deep py-3.5 font-semibold text-parchment transition active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "Signing in…" : "Sign in"}
        </button>

        <div className="mt-4 flex items-center justify-between text-sm text-ink/60">
          <Link
            href="/signup"
            className="font-medium text-clay underline underline-offset-4"
          >
            Create an account
          </Link>
          <Link
            href="/reset-password"
            className="underline underline-offset-4 hover:text-ink"
          >
            Forgot password?
          </Link>
        </div>
      </form>
    </div>
  );
}
