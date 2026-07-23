"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { publishCampaign, archiveCampaign, deleteCampaign } from "./actions";

export default function StatusActions({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [pending, startTransition] = useTransition();

  const run = (action: (id: string) => Promise<{ ok: boolean; message?: string }>) =>
    startTransition(async () => {
      setMessage(null);
      const res = await action(id);
      if (!res.ok) {
        setMessage(res.message ?? "Something went wrong.");
        return;
      }
      router.refresh();
    });

  return (
    // Sits inline at the end of a campaign row's action links — flows left
    // with them rather than pinning to the right edge of the panel.
    <div>
      <div className="flex flex-wrap items-center gap-2">
        {status === "draft" && (
          <button
            onClick={() => run(publishCampaign)}
            disabled={pending}
            className="rounded-full bg-forest-deep px-4 py-1.5 text-xs font-semibold text-parchment transition active:scale-[0.98] disabled:opacity-50"
          >
            Go live
          </button>
        )}
        {(status === "draft" || status === "live") && (
          <button
            onClick={() => run(archiveCampaign)}
            disabled={pending}
            className="rounded-full border border-ink/30 px-4 py-1.5 text-xs font-medium text-ink/70 transition hover:border-ink/60 disabled:opacity-50"
          >
            Archive
          </button>
        )}

        {/* Deliberately understated — a plain text link, not a button, so a
            permanent delete never sits a stray tap away. It opens a
            two-step confirm before anything happens. */}
        {confirmingDelete ? (
          <span className="flex items-center gap-2 text-xs">
            <span className="font-medium text-clay">Delete for good?</span>
            <button
              onClick={() => run(deleteCampaign)}
              disabled={pending}
              className="rounded-full bg-clay px-3 py-1 font-semibold text-cream transition active:scale-[0.98] disabled:opacity-50"
            >
              {pending ? "Deleting…" : "Yes, delete"}
            </button>
            <button
              onClick={() => setConfirmingDelete(false)}
              disabled={pending}
              className="font-medium text-ink/60 underline-offset-4 hover:underline"
            >
              Cancel
            </button>
          </span>
        ) : (
          <button
            onClick={() => {
              setMessage(null);
              setConfirmingDelete(true);
            }}
            disabled={pending}
            className="text-xs font-medium text-ink/40 underline-offset-4 hover:text-clay hover:underline disabled:opacity-50"
          >
            Delete
          </button>
        )}
      </div>
      {confirmingDelete && (
        <p className="mt-1 max-w-[20rem] text-xs text-ink/50">
          Removes the campaign and everything in it — collected rewards,
          results, and files. This can&apos;t be undone. (To hide it without
          losing the data, use Archive.)
        </p>
      )}
      {message && (
        <p className="mt-1 text-xs font-medium text-clay">{message}</p>
      )}
    </div>
  );
}
