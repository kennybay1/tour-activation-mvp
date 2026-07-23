import "server-only";
import crypto from "node:crypto";

// A stateless, signed capability for "resume your journey" links (Layer 2b).
// The token grants one thing: adopt a given identity session on a given
// campaign, until it expires. It's only ever issued after the server has
// confirmed the requester owns the email (by emailing the link to that
// address), which is what makes this the VERIFIED path — unlike the typed-
// email restore, a link can't be used by someone who merely knows the
// address. Signed with the service-role key (server-only, high entropy), so
// no store and no schema change are needed; short expiry limits replay.

const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TTL_MS = 60 * 60 * 1000; // 1 hour

function sign(data: string): string {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}

export function makeRestoreToken(slug: string, sessionId: string): string {
  const payload = `${slug}|${sessionId}|${Date.now() + TTL_MS}`;
  const body = Buffer.from(payload).toString("base64url");
  return `${body}.${sign(body)}`;
}

// Returns the slug + session the token grants, or null if it's malformed,
// tampered with, or expired.
export function readRestoreToken(
  token: string
): { slug: string; sessionId: string } | null {
  if (!SECRET) return null;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const body = token.slice(0, dot);
  const sig = token.slice(dot + 1);

  const expected = sign(body);
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;

  let payload: string;
  try {
    payload = Buffer.from(body, "base64url").toString("utf8");
  } catch {
    return null;
  }
  const [slug, sessionId, expStr] = payload.split("|");
  const exp = Number(expStr);
  if (!slug || !sessionId || !Number.isFinite(exp) || Date.now() > exp) {
    return null;
  }
  return { slug, sessionId };
}
