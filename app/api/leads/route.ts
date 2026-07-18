import { NextRequest, NextResponse } from "next/server";
import { supabaseAdmin } from "@/lib/supabase-admin";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ROLES = ["Artist", "Manager", "Label", "Promoter", "Agency", "Other"];
const RATE_MAX = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000;

// Per-IP rate limit, held in memory. On serverless this is per warm
// instance rather than truly global — good enough to stop casual abuse
// of a form that only writes rows.
const hits = new Map<string, number[]>();
function rateLimited(ip: string): boolean {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_MAX) {
    hits.set(ip, recent);
    return true;
  }
  recent.push(now);
  hits.set(ip, recent);
  return false;
}

function optional(v: unknown, max = 2000): string | null {
  if (typeof v !== "string") return null;
  const s = v.trim().slice(0, max);
  return s || null;
}

type LeadResponse = { ok: true } | { error: string };

export async function POST(
  req: NextRequest
): Promise<NextResponse<LeadResponse>> {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "unknown";
  if (rateLimited(ip)) {
    return NextResponse.json({ error: "rate_limited" }, { status: 429 });
  }

  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }

  const { name, email, organisation, role, artist_context, message } = body;

  if (typeof name !== "string" || !name.trim()) {
    return NextResponse.json({ error: "invalid_name" }, { status: 400 });
  }
  if (typeof email !== "string" || !EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ error: "invalid_email" }, { status: 400 });
  }
  const roleValue = optional(role, 40);
  if (roleValue && !ROLES.includes(roleValue)) {
    return NextResponse.json({ error: "invalid_role" }, { status: 400 });
  }

  const { error } = await supabaseAdmin().from("leads").insert({
    name: name.trim().slice(0, 200),
    email: email.trim().toLowerCase(),
    organisation: optional(organisation, 200),
    role: roleValue,
    artist_context: optional(artist_context, 500),
    message: optional(message),
  });
  if (error) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
