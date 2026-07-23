import { requireUser } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import InviteButton from "./invite-button";
import { RemoveMember, LeaveWorkspace } from "./member-actions";

export const dynamic = "force-dynamic";

// Resolve a set of user ids to something human — org name if they've set one,
// otherwise their email. Owner-only data, read with the service role.
async function identify(ids: string[]): Promise<Record<string, string>> {
  if (!ids.length) return {};
  const db = supabaseAdmin();
  const { data: profiles } = await db
    .from("profiles")
    .select("id, org_name")
    .in("id", ids);
  const orgById = new Map(
    (profiles ?? []).map((p) => [p.id, (p.org_name || "").trim()])
  );
  const entries = await Promise.all(
    ids.map(async (id) => {
      const org = orgById.get(id);
      if (org) return [id, org] as const;
      const { data } = await db.auth.admin.getUserById(id);
      return [id, data.user?.email ?? "A collaborator"] as const;
    })
  );
  return Object.fromEntries(entries);
}

export default async function TeamPage() {
  const user = await requireUser();
  const db = supabaseAdmin();

  const [{ data: myMembers }, { data: myWorkspaces }] = await Promise.all([
    db.from("workspace_members").select("member_id, created_at").eq("owner_id", user.id),
    db.from("workspace_members").select("owner_id, created_at").eq("member_id", user.id),
  ]);

  const names = await identify([
    ...(myMembers ?? []).map((m) => m.member_id),
    ...(myWorkspaces ?? []).map((w) => w.owner_id),
  ]);

  return (
    <div className="fade-up max-w-2xl">
      <h1 className="font-serif text-3xl">Team</h1>
      <p className="mt-1 mb-8 text-sm text-ink/50">
        Invite people to help build and edit your campaigns.
      </p>

      <section>
        <div className="flex items-center justify-between gap-4">
          <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-ink/60">
            Your collaborators
          </h2>
          <InviteButton />
        </div>

        {!myMembers?.length ? (
          <p className="mt-4 text-sm text-ink/60">
            No one yet. Use &ldquo;Invite&rdquo; to create a private link and
            send it however you like — they can view and edit all your
            campaigns once they join.
          </p>
        ) : (
          <ul className="mt-4 divide-y divide-ink/15 border-y border-ink/25">
            {myMembers.map((m) => (
              <li
                key={m.member_id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium">{names[m.member_id]}</p>
                  <p className="text-xs text-ink/50">Editor</p>
                </div>
                <RemoveMember
                  memberId={m.member_id}
                  name={names[m.member_id]}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      {!!myWorkspaces?.length && (
        <section className="mt-12">
          <h2 className="text-xs font-medium uppercase tracking-[0.2em] text-ink/60">
            Shared with you
          </h2>
          <p className="mt-1 text-xs text-ink/50">
            Workspaces you can build in — their campaigns appear in Your
            campaigns.
          </p>
          <ul className="mt-4 divide-y divide-ink/15 border-y border-ink/25">
            {myWorkspaces.map((w) => (
              <li
                key={w.owner_id}
                className="flex items-center justify-between gap-4 py-3"
              >
                <p className="truncate font-medium">{names[w.owner_id]}</p>
                <LeaveWorkspace ownerId={w.owner_id} name={names[w.owner_id]} />
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}
