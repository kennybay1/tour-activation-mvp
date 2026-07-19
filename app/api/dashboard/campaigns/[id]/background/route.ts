import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Background image upload/removal for a campaign the signed-in organiser
// owns. Runs the storage write server-side with the service role so no
// storage bucket policies are involved — ownership is enforced here,
// explicitly, before anything touches storage. The client sends the
// already-downscaled image, so the payload stays comfortably small.
export const maxDuration = 30;

const ALLOWED_TYPES: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};
// Post-downscale ceiling — the form re-encodes to ≤2400px WebP before
// sending, which lands far below this. Also keeps us inside Vercel's
// request-body limit.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

type BackgroundResponse = { path: string } | { ok: true } | { error: string };

// Returns the campaign row only if the signed-in user owns it — the
// service role bypasses RLS, so this check is the security boundary.
async function ownedCampaign(id: string) {
  const user = await getSessionUser();
  if (!user) return { error: 401 as const };
  const db = supabaseAdmin();
  const { data: campaign, error } = await db
    .from("campaigns")
    .select("id, owner_id, background_image_path")
    .eq("id", id)
    .maybeSingle();
  if (error) return { error: 500 as const };
  if (!campaign || campaign.owner_id !== user.id) return { error: 404 as const };
  return { user, campaign, db };
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<BackgroundResponse>> {
  const { id } = await params;
  const ctx = await ownedCampaign(id);
  if ("error" in ctx) {
    return NextResponse.json(
      { error: ctx.error === 401 ? "unauthorized" : ctx.error === 404 ? "not_found" : "server_error" },
      { status: ctx.error }
    );
  }
  const { user, campaign, db } = ctx;

  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid_form" }, { status: 400 });
  }
  const file = form.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "missing_file" }, { status: 400 });
  }
  const ext = ALLOWED_TYPES[file.type];
  if (!ext) {
    return NextResponse.json({ error: "unsupported_type" }, { status: 400 });
  }
  if (file.size === 0 || file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "too_large" }, { status: 400 });
  }

  // Timestamped name: a replacement gets a fresh URL rather than a stale
  // CDN-cached copy of the old object.
  const path = `${user.id}/${campaign.id}/background-${Date.now()}.${ext}`;
  const { error: uploadError } = await db.storage
    .from("backgrounds")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) {
    return NextResponse.json({ error: "upload_failed" }, { status: 502 });
  }

  const { error: updateError } = await db
    .from("campaigns")
    .update({ background_image_path: path })
    .eq("id", campaign.id);
  if (updateError) {
    // Don't leave an orphan behind the failed column update.
    await db.storage.from("backgrounds").remove([path]);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  // Replacing deletes the old object; best-effort only.
  if (campaign.background_image_path && campaign.background_image_path !== path) {
    await db.storage.from("backgrounds").remove([campaign.background_image_path]);
  }

  return NextResponse.json({ path });
}

export async function DELETE(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse<BackgroundResponse>> {
  const { id } = await params;
  const ctx = await ownedCampaign(id);
  if ("error" in ctx) {
    return NextResponse.json(
      { error: ctx.error === 401 ? "unauthorized" : ctx.error === 404 ? "not_found" : "server_error" },
      { status: ctx.error }
    );
  }
  const { campaign, db } = ctx;

  const { error: updateError } = await db
    .from("campaigns")
    .update({ background_image_path: null })
    .eq("id", campaign.id);
  if (updateError) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if (campaign.background_image_path) {
    await db.storage.from("backgrounds").remove([campaign.background_image_path]);
  }
  return NextResponse.json({ ok: true });
}
