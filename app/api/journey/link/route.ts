import { NextRequest, NextResponse } from "next/server";
import { readRestoreToken } from "@/lib/magic-link";

// The other half of Layer 2b: a fan taps the emailed link and lands here.
// A valid token means the server already verified they own the address, so
// we adopt its identity session into the durable cookie (same mechanism as
// /api/session) and send them into the journey, where their collection is
// waiting. An invalid or expired token just drops them on the normal page.

const COOKIE = "ta_sid";
const COOKIE_MAX_AGE = 60 * 60 * 24 * 400;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const token = req.nextUrl.searchParams.get("token") ?? "";
  const parsed = readRestoreToken(token);

  if (!parsed) {
    // Bad or stale link — no harm, just open the campaign normally. Only
    // slugs from valid tokens are ever trusted; there's nothing to open here.
    return NextResponse.redirect(new URL("/", req.url));
  }

  const res = NextResponse.redirect(new URL(`/c/${parsed.slug}`, req.url));
  res.cookies.set(COOKIE, parsed.sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: COOKIE_MAX_AGE,
  });
  return res;
}
