// Joining by link (Studio R14a): the invitation token is read once from the address and taken out
// of it before Studio asks the server anything (G112, G119). Pure and DOM-free.
import { say } from "./words.js";

/** An invitation token: the reflection's id, a dot, 64 hex characters. */
export const TOKEN = /^[a-z0-9-]{1,128}\.[0-9a-f]{64}$/;

/** The address Join opens at, with no token in it. */
export const JOIN_HASH = "#/together/join";

/**
 * The token in an invitation address and the address to show instead, or null. Both forms are
 * read: Studio's `#/together/join/<token>` and the old Admin's `#/shared/accept/<token>`. Anything
 * after the token (a query, a second path part) or a token of the wrong shape is no token: the
 * address is then left to the router, which never reads a token.
 * @returns {{ token: string, hash: string } | null}
 */
export function joinToken(hash) {
  const raw = String(hash || "").replace(/^#\/?/, "");
  const match = /^(?:together\/join|shared\/accept)\/(.+)$/.exec(raw);
  if (!match) return null;
  let token = match[1];
  try { token = decodeURIComponent(token); } catch { return null; }
  return TOKEN.test(token) ? { token, hash: JOIN_HASH } : null;
}

/** A refusal on the Join page in her words. */
export function joinProblem(error) {
  const code = error?.data?.code;
  if (error?.status === 0) return say("join.noSignal");
  if (code === "password") return say("join.passwordShort");
  if (code === "too-many-tries" || error?.status === 429) return say("join.tooMany");
  return say("join.notWorking");
}
