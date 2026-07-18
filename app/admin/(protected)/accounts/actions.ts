"use server";

import { revalidatePath } from "next/cache";
import { getAdminUser } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Only is_approved is ever touched here. is_admin is deliberately not
// settable from the UI — that stays a Supabase-dashboard-only operation.
export async function setApproval(
  profileId: string,
  approved: boolean
): Promise<{ ok: boolean }> {
  const admin = await getAdminUser();
  if (!admin) return { ok: false };
  const { error } = await supabaseAdmin()
    .from("profiles")
    .update({ is_approved: approved })
    .eq("id", profileId);
  revalidatePath("/admin/accounts");
  return { ok: !error };
}
