import { requireAdmin } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

export const dynamic = "force-dynamic";

export default async function AccountsPage() {
  await requireAdmin();
  const db = supabaseAdmin();

  const [{ data: profiles }, { data: usersData }, { data: campaignOwners }] =
    await Promise.all([
      db
        .from("profiles")
        .select("id, org_name, contact_name, is_admin, created_at")
        .order("created_at", { ascending: false }),
      db.auth.admin.listUsers(),
      db.from("campaigns").select("owner_id"),
    ]);

  const emailById = new Map(usersData.users.map((u) => [u.id, u.email]));
  const countByOwner = new Map<string, number>();
  for (const c of campaignOwners ?? []) {
    if (c.owner_id)
      countByOwner.set(c.owner_id, (countByOwner.get(c.owner_id) ?? 0) + 1);
  }

  return (
    <div className="fade-up">
      <h1 className="font-serif text-3xl">Accounts</h1>

      {!profiles?.length ? (
        <p className="mt-6 text-ink/60">No organiser accounts yet.</p>
      ) : (
        <div className="mt-6 overflow-x-auto border-y border-ink/25">
          <table className="w-full text-left text-sm">
            <thead className="text-xs uppercase tracking-[0.15em] text-ink/50">
              <tr className="border-b border-ink/25">
                <th className="px-3 py-3 font-medium">Organisation</th>
                <th className="px-3 py-3 font-medium">Contact</th>
                <th className="px-3 py-3 font-medium">Email</th>
                <th className="px-3 py-3 font-medium">Joined</th>
                <th className="px-3 py-3 text-right font-medium">Campaigns</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-ink/15">
              {profiles.map((p) => (
                <tr key={p.id} className="align-middle">
                  <td className="px-3 py-3 font-medium">
                    {p.org_name || <span className="text-ink/40">—</span>}
                    {p.is_admin && (
                      <span className="ml-2 rounded-full bg-ink/10 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-ink/60">
                        Admin
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-3 text-ink/80">
                    {p.contact_name || <span className="text-ink/40">—</span>}
                  </td>
                  <td className="px-3 py-3 text-ink/60">
                    {emailById.get(p.id) ?? "—"}
                  </td>
                  <td className="px-3 py-3 whitespace-nowrap text-ink/60">
                    {new Date(p.created_at).toLocaleDateString("en-GB")}
                  </td>
                  <td className="px-3 py-3 text-right font-mono text-xs">
                    {countByOwner.get(p.id) ?? 0}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
