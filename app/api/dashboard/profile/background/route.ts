import { NextRequest, NextResponse } from "next/server";
import { getSessionUser } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

// Dashboard backdrop upload/removal for the signed-in organiser. Mirrors
// the campaign background route: the storage write runs server-side with
// the service role, and identity (the session user) is the whole ownership
// check — you can only ever set your own backdrop. The image path lives in
// the auth user's metadata, so no table schema is involved.
export const maxDuration = 30;

const ALLOWED_TYPES: Record<string, string> = {
  "image/webp": "webp",
  "image/jpeg": "jpg",
  "image/png": "png",
};
// Post-downscale ceiling — the client re-encodes to ≤2400px WebP before
// sending, which lands far below this.
const MAX_UPLOAD_BYTES = 4 * 1024 * 1024;

// Namespaced under profile/ — campaign backgrounds live at
// {userId}/{campaignId}/… in the same bucket, so the two can never collide.
const pathFor = (userId: string, ext: string) =>
  `profile/${userId}/background-${Date.now()}.${ext}`;

type BackdropResponse = { path: string } | { ok: true } | { error: string };

async function saveMetadataPath(
  userId: string,
  existing: Record<string, unknown>,
  path: string | null
): Promise<boolean> {
  const db = supabaseAdmin();
  const { error } = await db.auth.admin.updateUserById(userId, {
    user_metadata: { ...existing, dashboard_background_path: path },
  });
  return !error;
}

export async function POST(
  req: NextRequest
): Promise<NextResponse<BackdropResponse>> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

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

  const db = supabaseAdmin();
  // Timestamped name: a replacement gets a fresh URL rather than a stale
  // CDN-cached copy of the old object.
  const path = pathFor(user.id, ext);
  const { error: uploadError } = await db.storage
    .from("backgrounds")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) {
    return NextResponse.json({ error: "upload_failed" }, { status: 502 });
  }

  const previous =
    typeof user.user_metadata?.dashboard_background_path === "string"
      ? user.user_metadata.dashboard_background_path
      : null;
  if (!(await saveMetadataPath(user.id, user.user_metadata ?? {}, path))) {
    // Don't leave an orphan behind the failed metadata update.
    await db.storage.from("backgrounds").remove([path]);
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  // Replacing deletes the old object; best-effort only.
  if (previous && previous !== path) {
    await db.storage.from("backgrounds").remove([previous]);
  }

  return NextResponse.json({ path });
}

export async function DELETE(): Promise<NextResponse<BackdropResponse>> {
  const user = await getSessionUser();
  if (!user) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const previous =
    typeof user.user_metadata?.dashboard_background_path === "string"
      ? user.user_metadata.dashboard_background_path
      : null;
  if (!(await saveMetadataPath(user.id, user.user_metadata ?? {}, null))) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }
  if (previous) {
    await supabaseAdmin().storage.from("backgrounds").remove([previous]);
  }
  return NextResponse.json({ ok: true });
}
