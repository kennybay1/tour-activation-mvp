"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { publishCampaign, archiveCampaign } from "./actions";

export default function StatusActions({
  id,
  status,
}: {
  id: string;
  status: string;
}) {
  const router = useRouter();
  const [message, setMessage] = useState<string | null>(null);
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
      <div className="flex gap-2">
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
      </div>
      {message && (
        <p className="mt-1 text-xs font-medium text-clay">{message}</p>
      )}
    </div>
  );
}
