import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const TTL = 30 * 60;
const signature = (payload, secret) => createHmac("sha256", secret).update(payload).digest("base64url");

export function issuePass(site, secret, now) {
  const expiresAt = Math.floor(now.getTime() / 1000) + TTL;
  const payload = Buffer.from(JSON.stringify({ site, expiresAt, id: randomBytes(16).toString("hex") })).toString("base64url");
  return { pass: `${payload}.${signature(payload, secret)}`, expiresAt };
}

export function validPass(pass, site, secret, now) {
  if (typeof pass !== "string" || pass.length > 2048) return false;
  const [payload, mac, extra] = pass.split(".");
  if (!payload || !mac || extra !== undefined) return false;
  const expected = Buffer.from(signature(payload, secret));
  const supplied = Buffer.from(mac);
  if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) return false;
  try {
    const value = JSON.parse(Buffer.from(payload, "base64url").toString());
    const seconds = Math.floor(now.getTime() / 1000);
    return value.site === site && typeof value.id === "string" && Number.isInteger(value.expiresAt)
      && value.expiresAt > seconds && value.expiresAt <= seconds + TTL;
  } catch { return false; }
}

// Provider boundary: never propagate provider errors, tokens or secrets to logs/readers.
export async function verifyCaptcha({ provider, token, secret, hostname, fetchImpl }) {
  if (provider !== "turnstile" || typeof token !== "string" || !token || token.length > 2048) return false;
  try {
    const response = await fetchImpl("https://challenges.cloudflare.com/turnstile/v0/siteverify", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ secret, response: token }).toString(),
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) return false;
    const result = await response.json();
    return result.success === true && result.hostname === hostname && result.action === "comment";
  } catch { return false; }
}
