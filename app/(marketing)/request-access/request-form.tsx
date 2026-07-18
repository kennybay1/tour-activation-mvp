"use client";

import { useState } from "react";
import Link from "next/link";

const inputCls =
  "w-full rounded-xl border border-ink/30 bg-transparent px-4 py-3 text-ink placeholder-ink/30 outline-none focus:border-forest";
const labelCls =
  "mb-2 mt-5 block text-xs font-medium uppercase tracking-[0.2em] text-ink/60";

const ROLES = ["Artist", "Manager", "Label", "Promoter", "Agency", "Other"];

export default function RequestAccessForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [organisation, setOrganisation] = useState("");
  const [role, setRole] = useState("");
  const [artistContext, setArtistContext] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/leads", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name,
          email,
          organisation,
          role,
          artist_context: artistContext,
          message,
        }),
      });
      if (res.status === 429) {
        setError("Too many messages from this connection — try again in an hour.");
        setBusy(false);
        return;
      }
      const json = await res.json();
      if (!json.ok) {
        setError(
          json.error === "invalid_email"
            ? "That email address doesn't look right."
            : "Something went wrong — your message wasn't sent. Please try again."
        );
        setBusy(false);
        return;
      }
      setDone(true);
    } catch {
      setError(
        "Something went wrong — your message wasn't sent. Please try again."
      );
      setBusy(false);
    }
  };

  if (done) {
    return (
      <div className="fade-up mx-auto w-full max-w-xl px-5 py-16 text-center">
        <h1 className="font-serif text-4xl">Talk to us</h1>
        <p className="mt-6 rounded-2xl border border-ink/25 p-8 font-serif text-2xl">
          Got it — we&apos;ll be in touch shortly.
        </p>
        <p className="mt-6 text-sm text-ink/60">
          Ready to build now?{" "}
          <Link
            href="/signup"
            className="font-medium text-clay underline underline-offset-4"
          >
            Get started
          </Link>
        </p>
      </div>
    );
  }

  return (
    <div className="mx-auto w-full max-w-xl px-5 py-16">
      <h1 className="font-serif text-4xl">Talk to us</h1>
      <p className="mt-3 leading-relaxed text-ink/70">
        Planning a tour, a release, or something stranger? Tell us what
        you&apos;re thinking and we&apos;ll help you scope it.
      </p>

      <form onSubmit={onSubmit} noValidate>
        <label htmlFor="name" className={labelCls}>
          Name *
        </label>
        <input
          id="name"
          required
          value={name}
          onChange={(e) => setName(e.target.value)}
          className={inputCls}
        />

        <label htmlFor="email" className={labelCls}>
          Email *
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

        <label htmlFor="organisation" className={labelCls}>
          Organisation
        </label>
        <input
          id="organisation"
          value={organisation}
          onChange={(e) => setOrganisation(e.target.value)}
          className={inputCls}
        />

        <label htmlFor="role" className={labelCls}>
          Role
        </label>
        <select
          id="role"
          value={role}
          onChange={(e) => setRole(e.target.value)}
          className={inputCls}
        >
          <option value="">Choose…</option>
          {ROLES.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
        </select>

        <label htmlFor="artist-context" className={labelCls}>
          Who would you run this for?
        </label>
        <input
          id="artist-context"
          value={artistContext}
          onChange={(e) => setArtistContext(e.target.value)}
          placeholder="An artist, a release, a tour…"
          className={inputCls}
        />

        <label htmlFor="message" className={labelCls}>
          Anything else?
        </label>
        <textarea
          id="message"
          rows={4}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          className={inputCls}
        />

        {error && (
          <p className="mt-4 text-sm font-medium text-clay">{error}</p>
        )}

        <button
          type="submit"
          disabled={busy || !name.trim() || !email.trim()}
          className="mt-6 w-full rounded-full bg-forest-deep py-3.5 font-semibold text-parchment transition active:scale-[0.98] disabled:opacity-50"
        >
          {busy ? "Sending…" : "Send"}
        </button>
      </form>

      <p className="mt-6 text-center text-sm text-ink/60">
        Ready to build now?{" "}
        <Link
          href="/signup"
          className="font-medium text-clay underline underline-offset-4"
        >
          Get started
        </Link>
      </p>
    </div>
  );
}
