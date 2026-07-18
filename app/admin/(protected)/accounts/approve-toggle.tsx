"use client";

import { useTransition } from "react";
import { useRouter } from "next/navigation";
import { setApproval } from "./actions";

export default function ApproveToggle({
  profileId,
  approved,
}: {
  profileId: string;
  approved: boolean;
}) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  return (
    <button
      onClick={() =>
        startTransition(async () => {
          await setApproval(profileId, !approved);
          router.refresh();
        })
      }
      disabled={pending}
      className={
        approved
          ? "rounded-full bg-forest px-4 py-1.5 text-xs font-semibold text-parchment transition active:scale-[0.98] disabled:opacity-50"
          : "rounded-full border border-ink/30 px-4 py-1.5 text-xs font-medium text-ink/70 transition hover:border-ink/60 disabled:opacity-50"
      }
    >
      {approved ? "Approved ✓" : "Approve"}
    </button>
  );
}
