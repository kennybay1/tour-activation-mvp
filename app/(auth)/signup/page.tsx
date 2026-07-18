"use client";

import { useState } from "react";
import Link from "next/link";
import { supabase } from "@/lib/supabase";

const inputCls =
  "w-full rounded-xl border border-ink/30 bg-transparent px-4 py-3 text-ink placeholder-ink/30 outline-none focus:border-forest";
const labelCls =
  "mb-2 mt-4 block text-xs font-medium uppercase tracking-[0.2em] text-ink/60";

export default function SignupPage() {
  const [orgName, setOrgName] = useState("");
  const [contactName, setContactName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const { error } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        data: {
          org_name: orgName.trim(),
          contact_name: contactName.trim(),
        },
      },
    });
    if (error) {
      setError(error.message);
      setBusy(false);
      return;
    }
    setDone(true);
  };

  if (done) {
    return (
      <div className="fade-up w-full max-w-sm">
        <h1 className="font-serif text-4xl">Check your email</h1>
        <p className="mt-4 leading-relaxed text-ink/70">
          We&apos;ve sent you a confirmation link. Click it, then sign in and
          start building your first drop.
        </p>
        <Link
          href="/login"
          className="mt-8 block w-full rounded-full bg-forest-deep py-3.5 text-center font-semibold text-parchment transition active:scale-[0.98]"
        >
          Go to sign in
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={onSubmit} className="fade-up w-full max-w-sm">
      <h1 className="font-serif text-4xl">Get started</h1>
      <p className="mt-2 text-sm text-ink/60">
        Create an account for your band, label or agency.
      </p>

      <label htmlFor="org" className={labelCls}>
        Organisation / artist name
      </label>
      <input
        id="org"
        required
        value={orgName}
        onChange={(e) => setOrgName(e.target.value)}
        placeholder="Test Band Ltd"
        className={inputCls}
      />

      <label htmlFor="contact" className={labelCls}>
        Your name
      </label>
      <input
        id="contact"
        required
        value={contactName}
        onChange={(e) => setContactName(e.target.value)}
        className={inputCls}
      />

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
        minLength={8}
        autoComplete="new-password"
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
        {busy ? "Creating account…" : "Create account"}
      </button>

      <p className="mt-4 text-center text-sm text-ink/60">
        Already have an account?{" "}
        <Link
          href="/login"
          className="font-medium text-clay underline underline-offset-4"
        >
          Sign in
        </Link>
      </p>
    </form>
  );
}
