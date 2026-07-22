"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser, supabaseServer } from "@/lib/supabase-server";

export type ActionResult = { ok: boolean; message?: string };

// The builder saves through the browser Supabase client, so no Server Action
// runs and Next never learns the campaign list changed — "Your campaigns"
// would keep serving its cached copy until a manual refresh. The form calls
// this after every successful save to mark that list stale, the same way
// publish/archive below do.
export async function revalidateDashboard(): Promise<void> {
  const user = await getSessionUser();
  if (!user) return;
  revalidatePath("/dashboard");
}

// Both actions use the organiser's own authenticated client — RLS means the
// update silently matches zero rows unless they own the campaign.

export async function publishCampaign(id: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in again." };
  const supabase = await supabaseServer();

  const { data, error } = await supabase
    .from("campaigns")
    .update({ status: "live" })
    .eq("id", id)
    .select("id");
  if (error || !data?.length) {
    return { ok: false, message: "Couldn't publish. Try again." };
  }
  revalidatePath("/dashboard");
  return { ok: true };
}

export async function archiveCampaign(id: string): Promise<ActionResult> {
  const user = await getSessionUser();
  if (!user) return { ok: false, message: "Please sign in again." };
  const supabase = await supabaseServer();
  const { data, error } = await supabase
    .from("campaigns")
    .update({ status: "archived" })
    .eq("id", id)
    .select("id");
  if (error || !data?.length) {
    return { ok: false, message: "Couldn't archive. Try again." };
  }
  revalidatePath("/dashboard");
  return { ok: true };
}
