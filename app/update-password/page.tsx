"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { supabase } from "@/lib/supabase";

export default function UpdatePasswordPage() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      setError(
        "Couldn't set the password — the reset link may have expired. Request a new one from the sign-in page."
      );
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
        <h1 className="mt-3 font-serif text-4xl">Choose a new password</h1>

        <label
          htmlFor="password"
          className="mb-2 mt-6 block text-xs font-medium uppercase tracking-[0.2em] text-ink/60"
        >
          New password
        </label>
        <input
          id="password"
          type="password"
          required
          minLength={8}
          autoComplete="new-password"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full rounded-xl border border-ink/30 bg-transparent px-4 py-3 text-ink outline-none focus:border-forest"
        />
        {error && <p className="mt-4 text-sm font-medium text-clay">{error}</p>}
        <button
          type="submit"
          disabled={busy}
          className="mt-6 w-full rounded-full bg-forest-deep py-3.5 font-semibold text-parchment transition active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "Saving…" : "Save and continue"}
        </button>
      </form>
    </div>
  );
}
