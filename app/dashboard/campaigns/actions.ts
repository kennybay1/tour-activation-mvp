"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser, supabaseServer } from "@/lib/supabase-server";

export type ActionResult = { ok: boolean; message?: string };

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
