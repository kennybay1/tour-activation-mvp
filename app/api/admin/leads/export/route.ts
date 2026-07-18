import { NextRequest, NextResponse } from "next/server";
import { getAdminUser } from "@/lib/supabase-server";
import { supabaseAdmin } from "@/lib/supabase-admin";

function cell(v: unknown): string {
  if (v == null) return "";
  const s = String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

export async function GET(req: NextRequest) {
  const admin = await getAdminUser();
  if (!admin) {
    return NextResponse.redirect(new URL("/admin/login", req.url));
  }

  const { data, error } = await supabaseAdmin()
    .from("leads")
    .select(
      "name, email, organisation, role, artist_context, message, source, created_at"
    )
    .order("created_at", { ascending: false });
  if (error) {
    return NextResponse.json({ error: "server_error" }, { status: 500 });
  }

  const headers = [
    "name",
    "email",
    "organisation",
    "role",
    "artist_context",
    "message",
    "source",
    "created_at",
  ];
  const lines = [headers.join(",")];
  for (const r of data) {
    lines.push(
      headers.map((h) => cell((r as Record<string, unknown>)[h])).join(",")
    );
  }

  return new NextResponse(lines.join("\n") + "\n", {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="moments-leads.csv"`,
    },
  });
}
