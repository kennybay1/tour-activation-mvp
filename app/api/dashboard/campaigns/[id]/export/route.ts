import { NextRequest, NextResponse } from "next/server";
import { supabaseServer } from "@/lib/supabase-server";

// CSV cell escaping: quote anything containing commas, quotes or newlines.
function cell(v: unknown): string {
  if (v == null) return "";
  const s = typeof v === "object" ? JSON.stringify(v) : String(v);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

function toCsv(headers: string[], rows: Record<string, unknown>[]): string {
  const lines = [headers.join(",")];
  for (const row of rows) {
    lines.push(headers.map((h) => cell(row[h])).join(","));
  }
  return lines.join("\n") + "\n";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  // Authenticated client throughout — the service role key is never used
  // here. RLS is the ownership check: a campaign this user doesn't own
  // simply doesn't come back.
  const supabase = await supabaseServer();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return NextResponse.redirect(new URL("/login", req.url));
  }

  const { id } = await params;
  const type =
    req.nextUrl.searchParams.get("type") === "all" ? "all" : "consented";

  const { data: campaign } = await supabase
    .from("campaigns")
    .select("id, slug")
    .eq("id", id)
    .maybeSingle();
  if (!campaign) {
    return NextResponse.json({ error: "campaign_not_found" }, { status: 404 });
  }

  let csv: string;
  if (type === "consented") {
    const { data, error } = await supabase
      .from("claims")
      .select("email, consent_at, unlocked, ticket_clicked_at")
      .eq("campaign_id", campaign.id)
      .eq("marketing_consent", true)
      .order("consent_at", { ascending: true });
    if (error) {
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }
    csv = toCsv(["email", "consent_at", "unlocked", "ticket_clicked_at"], data);
  } else {
    const { data, error } = await supabase
      .from("claims")
      .select("*")
      .eq("campaign_id", campaign.id)
      .order("created_at", { ascending: true });
    if (error) {
      return NextResponse.json({ error: "server_error" }, { status: 500 });
    }
    const headers = data.length
      ? Object.keys(data[0])
      : [
          "id",
          "campaign_id",
          "email",
          "marketing_consent",
          "consent_at",
          "unlocked",
          "unlocked_at",
          "distance_m",
          "location_accuracy_m",
          "ticket_clicked_at",
          "user_agent",
          "created_at",
        ];
    csv = toCsv(headers, data);
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${campaign.slug}-${type}-claims.csv"`,
    },
  });
}
