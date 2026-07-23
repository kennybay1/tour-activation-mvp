"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";
import { makeInviteToken, readInviteToken } from "@/lib/workspace-invite";

export type TeamResult = { ok: boolean; message?: string };

// Mint an invite to the current user's own workspace. The client turns the
// token into a shareable /join link.
export async function createInvite(): Promise<
  { ok: true; token: string } | { ok: false; message: string }
> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in again." };
  return { ok: true, token: makeInviteToken(user.id, "editor") };
}

// Redeem an invite: the signed-in user joins the token's workspace.
export async function acceptInvite(token: string): Promise<TeamResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in again." };
  const parsed = readInviteToken(token);
  if (!parsed) {
    return { ok: false, message: "This invite link is invalid or has expired." };
  }
  if (parsed.ownerId === user.id) {
    return { ok: false, message: "That's your own workspace." };
  }
  const { error } = await supabaseAdmin()
    .from("workspace_members")
    .upsert(
      { owner_id: parsed.ownerId, member_id: user.id, role: parsed.role },
      { onConflict: "owner_id,member_id", ignoreDuplicates: true }
    );
  if (error) return { ok: false, message: "Couldn't join. Try again." };
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/team");
  return { ok: true };
}

// Owner removes a collaborator from their workspace.
export async function removeMember(memberId: string): Promise<TeamResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in again." };
  const { error } = await supabaseAdmin()
    .from("workspace_members")
    .delete()
    .eq("owner_id", user.id)
    .eq("member_id", memberId);
  if (error) return { ok: false, message: "Couldn't remove. Try again." };
  revalidatePath("/dashboard/team");
  return { ok: true };
}

// A member leaves a workspace they were invited to.
export async function leaveWorkspace(ownerId: string): Promise<TeamResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in again." };
  const { error } = await supabaseAdmin()
    .from("workspace_members")
    .delete()
    .eq("owner_id", ownerId)
    .eq("member_id", user.id);
  if (error) return { ok: false, message: "Couldn't leave. Try again." };
  revalidatePath("/dashboard");
  revalidatePath("/dashboard/team");
  return { ok: true };
}
