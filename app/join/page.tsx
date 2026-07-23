import Link from "next/link";
import { getSessionUser } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { readInviteToken } from "@/lib/workspace-invite";
import AcceptInvite from "./accept";

export const dynamic = "force-dynamic";

async function workspaceName(ownerId: string): Promise<string> {
  const db = supabaseAdmin();
  const { data: profile } = await db
    .from("profiles")
    .select("org_name")
    .eq("id", ownerId)
    .maybeSingle();
  if (profile?.org_name?.trim()) return profile.org_name.trim();
  const { data } = await db.auth.admin.getUserById(ownerId);
  return data.user?.email ?? "this workspace";
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grain flex min-h-dvh items-center justify-center bg-cream px-5 py-10 font-sans text-ink">
      <div className="fade-up w-full max-w-sm text-center">{children}</div>
    </div>
  );
}

export default async function JoinPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token } = await searchParams;
  const parsed = token ? readInviteToken(token) : null;

  if (!parsed) {
    return (
      <Shell>
        <h1 className="font-serif text-3xl">Invite not valid</h1>
        <p className="mt-3 text-ink/60">
          This link is invalid or has expired. Ask whoever sent it for a fresh
          one.
        </p>
      </Shell>
    );
  }

  const name = await workspaceName(parsed.ownerId);
  const user = await getSessionUser();

  if (!user) {
    const next = `/join?token=${encodeURIComponent(token!)}`;
    return (
      <Shell>
        <p className="text-xs font-medium uppercase tracking-[0.3em] text-clay">
          You&apos;re invited
        </p>
        <h1 className="mt-3 font-serif text-4xl leading-tight">
          Join {name}
        </h1>
        <p className="mt-3 text-ink/60">
          Sign in or create a free account to start building together.
        </p>
        <div className="mt-8 flex flex-col gap-3">
          <Link
            href={`/login?next=${encodeURIComponent(next)}`}
            className="rounded-full bg-forest-deep py-3.5 font-semibold text-parchment transition active:scale-[0.98]"
          >
            Sign in
          </Link>
          <Link
            href={`/signup?next=${encodeURIComponent(next)}`}
            className="rounded-full border border-ink/30 py-3.5 font-medium text-ink/80 transition hover:border-ink/60"
          >
            Create an account
          </Link>
        </div>
      </Shell>
    );
  }

  if (parsed.ownerId === user.id) {
    return (
      <Shell>
        <h1 className="font-serif text-3xl">That&apos;s your workspace</h1>
        <p className="mt-3 text-ink/60">
          This invite is for your own workspace — nothing to join.
        </p>
        <Link
          href="/dashboard"
          className="mt-8 inline-block rounded-full bg-forest-deep px-6 py-3 font-semibold text-parchment"
        >
          Go to your campaigns
        </Link>
      </Shell>
    );
  }

  return (
    <Shell>
      <p className="text-xs font-medium uppercase tracking-[0.3em] text-clay">
        You&apos;re invited
      </p>
      <h1 className="mt-3 font-serif text-4xl leading-tight">Join {name}</h1>
      <p className="mt-3 text-ink/60">
        You&apos;ll be able to view and edit all of {name}&apos;s campaigns.
      </p>
      <div className="mt-8">
        <AcceptInvite token={token!} />
      </div>
    </Shell>
  );
}
