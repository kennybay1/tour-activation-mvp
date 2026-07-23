"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { acceptInvite } from "../dashboard/team/actions";

export default function AcceptInvite({ token }: { token: string }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [error, setError] = useState<string | null>(null);

  const accept = () =>
    startTransition(async () => {
      setError(null);
      const res = await acceptInvite(token);
      if (!res.ok) {
        setError(res.message ?? "Couldn't join. Try again.");
        return;
      }
      router.replace("/dashboard");
      router.refresh();
    });

  return (
    <div>
      <button
        onClick={accept}
        disabled={pending}
        className="w-full rounded-full bg-forest-deep py-3.5 font-semibold text-parchment transition active:scale-[0.98] disabled:opacity-50"
      >
        {pending ? "Joining…" : "Accept invite"}
      </button>
      {error && <p className="mt-3 text-sm font-medium text-clay">{error}</p>}
    </div>
  );
}
