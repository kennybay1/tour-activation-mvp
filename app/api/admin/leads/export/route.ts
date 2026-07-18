import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

function cell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.redirect(new URL("/admin/login", req.url));
  }

  const db = supabaseAdmin();
  const { data, error } = await db
    .from("claims")
    .select(
      "email, marketing_consent, consent_at, unlocked, unlocked_at, ticket_clicked_at, created_at, campaigns(slug, title)"
    )
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  const headers = [
    "email",
    "campaign_slug",
    "campaign_title",
    "marketing_consent",
    "consent_at",
    "unlocked",
    "unlocked_at",
    "ticket_clicked_at",
    "created_at",
  ];
  const lines = [headers.join(",")];
  for (const r of data as unknown as Array<
    Record<string, unknown> & { campaigns: { slug: string; title: string } | null }
  >) {
    lines.push(
      [
        cell(r.email),
        cell(r.campaigns?.slug),
        cell(r.campaigns?.title),
        cell(r.marketing_consent),
        cell(r.consent_at),
        cell(r.unlocked),
        cell(r.unlocked_at),
        cell(r.ticket_clicked_at),
        cell(r.created_at),
      ].join(",")
    );
  }

  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="moments-leads.csv"`,
    },
  });
}
