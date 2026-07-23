"use client";

import { useState } from "react";
import { createInvite } from "./actions";

// Generates a private invite link on demand and lets the owner copy it. The
// link is theirs to send however they like — no email needed.
export default function InviteButton() {
  const [link, setLink] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    const res = await createInvite();
    setBusy(false);
    if (!res.ok) {
      setError(res.message);
      return;
    }
    setLink(`${window.location.origin}/join?token=${res.token}`);
  };

  const copy = async () => {
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {}
  };

  if (link) {
    return (
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.target.select()}
          className="w-44 rounded-full border border-ink/25 bg-transparent px-3 py-1.5 text-xs text-ink/70 outline-none sm:w-64"
        />
        <button
          type="button"
          onClick={copy}
          className="shrink-0 rounded-full bg-forest-deep px-4 py-1.5 text-xs font-semibold text-parchment transition active:scale-[0.98]"
        >
          {copied ? "Copied ✓" : "Copy"}
        </button>
      </div>
    );
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={generate}
        disabled={busy}
        className="rounded-full bg-forest-deep px-4 py-1.5 text-xs font-semibold text-parchment transition active:scale-[0.98] disabled:opacity-50"
      >
        {busy ? "…" : "Invite"}
      </button>
      {error && <p className="mt-1 text-xs font-medium text-clay">{error}</p>}
    </div>
  );
}
