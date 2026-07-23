import "server-only";
import crypto from "node:crypto";

// A signed, self-contained workspace invite (no table needed). The token
// grants: join this owner's workspace, in this role, until it expires. It's
// only useful once redeemed by a logged-in user, who becomes the member —
// so a leaked link can at worst add the finder as an editor, which the owner
// can remove. Signed with the service-role key; a week's expiry limits that
// window. Same approach as the restore links.

const SECRET = process.env.SUPABASE_SERVICE_ROLE_KEY ?? "";
const TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const ROLES = new Set(["editor"]);

function sign(data: string): string {
  return crypto.createHmac("sha256", SECRET).update(data).digest("base64url");
}

export function makeInviteToken(ownerId: string, role: string): string {
  const payload = `${ownerId}|${role}|${Date.now() + TTL_MS}`;
  const body = Buffer.from(payload).toString("base64url");
  return `${body}.${sign(body)}`;
}

export function readInviteToken(
  token: string
): { ownerId: string; role: string } | null {
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
  const [ownerId, role, expStr] = payload.split("|");
  const exp = Number(expStr);
  if (!ownerId || !ROLES.has(role) || !Number.isFinite(exp) || Date.now() > exp) {
    return null;
  }
  return { ownerId, role };
}
