"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { removeMember, leaveWorkspace } from "./actions";

// Small two-step confirm shared by "remove a collaborator" and "leave a
// workspace" — a stray tap shouldn't cut someone's access.
function ConfirmAction({
  label,
  confirmLabel,
  run,
}: {
  label: string;
  confirmLabel: string;
  run: () => Promise<{ ok: boolean; message?: string }>;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = useState(false);
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const go = () =>
    startTransition(async () => {
      setError(null);
      const res = await run();
      if (!res.ok) {
        setError(res.message ?? "Something went wrong.");
        return;
      }
      router.refresh();
    });

  if (confirming) {
    return (
      <span className="flex items-center gap-2 text-xs">
        <span className="text-ink/60">{confirmLabel}</span>
        <button
          onClick={go}
          disabled={pending}
          className="rounded-full bg-clay px-3 py-1 font-semibold text-cream transition disabled:opacity-50"
        >
          {pending ? "…" : "Yes"}
        </button>
        <button
          onClick={() => setConfirming(false)}
          disabled={pending}
          className="font-medium text-ink/60 underline-offset-4 hover:underline"
        >
          Cancel
        </button>
      </span>
    );
  }

  return (
    <span>
      <button
        onClick={() => setConfirming(true)}
        className="text-xs font-medium text-ink/40 underline-offset-4 hover:text-clay hover:underline"
      >
        {label}
      </button>
      {error && <span className="ml-2 text-xs font-medium text-clay">{error}</span>}
    </span>
  );
}

export function RemoveMember({
  memberId,
  name,
}: {
  memberId: string;
  name: string;
}) {
  return (
    <ConfirmAction
      label="Remove"
      confirmLabel={`Remove ${name}?`}
      run={() => removeMember(memberId)}
    />
  );
}

export function LeaveWorkspace({
  ownerId,
  name,
}: {
  ownerId: string;
  name: string;
}) {
  return (
    <ConfirmAction
      label="Leave"
      confirmLabel={`Leave ${name}?`}
      run={() => leaveWorkspace(ownerId)}
    />
  );
}
