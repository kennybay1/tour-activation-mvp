import { NextRequest, NextResponse } from "next/server";

// A fan's anonymous id, kept in a first-party cookie that the SERVER sets.
// This matters on iOS Safari: script-writable storage (localStorage, and
// cookies written by JS) is wiped after ~7 days without a visit, which would
// silently reset a fan's collection partway through a multi-week journey. A
// cookie set from a response header isn't subject to that cap, so it survives.
//
// The id is not a secret — it only ties a device to the stops it collected —
// so the cookie is HttpOnly for tidiness and the id is also returned in the
// body, which is how the client learns it (every other route keeps reading
// the id from the request body, unchanged).

const COOKIE = "ta_sid";
// Browsers cap persistent cookies at ~400 days; refreshed on every visit so
// an active fan's id effectively never expires.
const MAX_AGE = 60 * 60 * 24 * 400;
const ID_RE = /^[A-Za-z0-9_-]{8,100}$/;

export async function GET(req: NextRequest): Promise<NextResponse> {
  const existing = req.cookies.get(COOKIE)?.value;
  let sessionId = existing && ID_RE.test(existing) ? existing : null;

  if (!sessionId) {
    // First visit on this browser — adopt the id the client already had in
    // local storage if there is one, so an in-progress fan isn't reset by
    // this change; otherwise mint a fresh one.
    const adopt = req.nextUrl.searchParams.get("adopt");
    sessionId = adopt && ID_RE.test(adopt) ? adopt : crypto.randomUUID();
  }

  const res = NextResponse.json({ session_id: sessionId });
  res.cookies.set(COOKIE, sessionId, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE,
  });
  return res;
}
