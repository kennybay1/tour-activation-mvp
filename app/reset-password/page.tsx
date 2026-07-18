"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

export default function ResetPasswordPage() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: `${window.location.origin}/update-password`,
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    setSent(true);
  };

  return (
    <div className="grain flex min-h-dvh items-center justify-center bg-cream px-5 font-sans text-ink">
      <div className="fade-up w-full max-w-sm">
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-clay">
          Tour Activation
        </p>
        <h1 className="mt-3 font-serif text-4xl">Reset password</h1>

        {sent ? (
          <>
            <p className="mt-4 leading-relaxed text-ink/70">
              If an account exists for that email, a reset link is on its way.
              Open it on this device to choose a new password.
            </p>
            <Link
              href="/login"
              className="mt-6 inline-block text-sm font-medium text-clay underline underline-offset-4"
            >
              Back to sign in
            </Link>
          </>
        ) : (
          <form onSubmit={onSubmit}>
            <label
              htmlFor="email"
              className="mb-2 mt-6 block text-xs font-medium uppercase tracking-[0.2em] text-ink/60"
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
              className="w-full rounded-xl border border-ink/30 bg-transparent px-4 py-3 text-ink outline-none focus:border-forest"
            />
            {error && (
              <p className="mt-4 text-sm font-medium text-clay">{error}</p>
            )}
            <button
              type="submit"
              disabled={busy}
              className="mt-6 w-full rounded-full bg-forest-deep py-3.5 font-semibold text-parchment transition active:scale-[0.98] disabled:opacity-50"
            >
              {busy ? "Sending…" : "Send reset link"}
            </button>
            <p className="mt-4 text-center text-sm text-ink/60">
              <Link
                href="/login"
                className="underline underline-offset-4 hover:text-ink"
              >
                Back to sign in
              </Link>
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
