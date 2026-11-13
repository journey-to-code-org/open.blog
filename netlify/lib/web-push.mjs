// Web Push (ADR 0412), on node:crypto alone: the message is encrypted for one browser (RFC 8291,
// aes128gcm) and the request is signed with the site's VAPID key (RFC 8292), so the push service
// carries it without being able to read it.
//
// A transport resolves to `{ ok: true }`, `{ ok: false, gone: true }` (the browser dropped the
// subscription: forget it) or `{ ok: false, code }` with a fixed code. It never throws and never
// returns the push service's text.

import { createECDH, createPrivateKey, hkdfSync, randomBytes, createCipheriv, sign } from "node:crypto";

const b64url = (bytes) => Buffer.from(bytes).toString("base64url");
export const fromB64url = (text) => {
  const value = String(text ?? "");
  return /^[A-Za-z0-9_-]*$/.test(value) ? Buffer.from(value, "base64url") : Buffer.alloc(0);
};

// The push services of the browsers that send pushes. A subscription's endpoint must be one of
// them, so a stored device can never make the function send requests anywhere else.
const PUSH_HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^web\.push\.apple\.com$/, /^[a-z0-9-]+\.push\.apple\.com$/, /^[a-z0-9-]+\.notify\.windows\.com$/];

/** A browser's PushSubscription as JSON, checked; null when it is not one we would send to. */
export function checkSubscription(value) {
  if (!value || typeof value !== "object") return null;
  const endpoint = String(value.endpoint ?? "");
  let url;
  try {
    url = new URL(endpoint);
  } catch {
    return null;
  }
  if (endpoint.length > 1024 || url.protocol !== "https:" || url.username || url.password || url.port || !PUSH_HOSTS.some((host) => host.test(url.hostname))) return null;
  const p256dh = fromB64url(value.keys?.p256dh);
  const auth = fromB64url(value.keys?.auth);
  if (p256dh.length !== 65 || p256dh[0] !== 4 || auth.length !== 16) return null;
  return { endpoint: url.href, keys: { p256dh: b64url(p256dh), auth: b64url(auth) } };
}

/** The site's VAPID key pair, checked: the private key must be the public key's. */
export function vapidKeys(publicKey, privateKey) {
  const pub = fromB64url(publicKey);
  const priv = fromB64url(privateKey);
  if (pub.length !== 65 || pub[0] !== 4 || priv.length !== 32) return null;
  try {
    // The public key is worked out from the private one, so a pair that doesn't belong together fails.
    const ecdh = createECDH("prime256v1");
    ecdh.setPrivateKey(priv);
    if (!ecdh.getPublicKey().equals(pub)) return null;
    const key = createPrivateKey({ key: { kty: "EC", crv: "P-256", d: b64url(priv), x: b64url(pub.subarray(1, 33)), y: b64url(pub.subarray(33)) }, format: "jwk" });
    return { publicKey: b64url(pub), key };
  } catch {
    return null;
  }
}

/** A new VAPID key pair, for `node scripts/push-keys.mjs`. */
export function generateVapidKeys() {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return { publicKey: b64url(ecdh.getPublicKey()), privateKey: b64url(ecdh.getPrivateKey()) };
}

/** RFC 8292: a JWT for the push service's origin, signed ES256, good for twelve hours. */
export function vapidHeader({ endpoint, vapid, subject, now = Date.now() }) {
  const header = b64url(JSON.stringify({ typ: "JWT", alg: "ES256" }));
  const claims = b64url(JSON.stringify({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: subject }));
  const signature = sign("sha256", Buffer.from(`${header}.${claims}`), { key: vapid.key, dsaEncoding: "ieee-p1363" });
  return `vapid t=${header}.${claims}.${b64url(signature)}, k=${vapid.publicKey}`;
}

/** RFC 8291: the message encrypted for one subscription, as a single aes128gcm record. */
export function encrypt(subscription, plaintext, { salt = randomBytes(16), sender = null } = {}) {
  const uaPublic = fromB64url(subscription.keys.p256dh);
  const authSecret = fromB64url(subscription.keys.auth);
  const ecdh = sender ?? createECDH("prime256v1");
  if (!sender) ecdh.generateKeys();
  const asPublic = ecdh.getPublicKey();
  const shared = ecdh.computeSecret(uaPublic);
  const keyInfo = Buffer.concat([Buffer.from("WebPush: info\0"), uaPublic, asPublic]);
  const ikm = Buffer.from(hkdfSync("sha256", shared, authSecret, keyInfo, 32));
  const cek = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: aes128gcm\0"), 16));
  const nonce = Buffer.from(hkdfSync("sha256", ikm, salt, Buffer.from("Content-Encoding: nonce\0"), 12));
  const cipher = createCipheriv("aes-128-gcm", cek, nonce);
  // One record, so the padding delimiter is 0x02 (the last record).
  const body = Buffer.concat([cipher.update(Buffer.concat([Buffer.from(plaintext), Buffer.from([2])])), cipher.final(), cipher.getAuthTag()]);
  const recordSize = Buffer.alloc(4);
  recordSize.writeUInt32BE(4096);
  return Buffer.concat([salt, recordSize, Buffer.from([asPublic.length]), asPublic, body]);
}

/** Sends one notice to one subscription. */
export function webPushTransport({ vapid, subject, fetchImpl, now = () => Date.now(), timeoutMs = 5000 }) {
  return async (subscription, notice, { ttl = 6 * 3600, urgency = "high" } = {}) => {
    let response;
    try {
      response = await fetchImpl(subscription.endpoint, {
        method: "POST",
        headers: {
          authorization: vapidHeader({ endpoint: subscription.endpoint, vapid, subject, now: now() }),
          "content-encoding": "aes128gcm",
          "content-type": "application/octet-stream",
          ttl: String(ttl),
          urgency,
        },
        body: encrypt(subscription, JSON.stringify(notice)),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      return { ok: false, code: error?.name === "TimeoutError" ? "timeout" : "network" };
    }
    if (response.status >= 200 && response.status < 300) return { ok: true };
    if (response.status === 404 || response.status === 410) return { ok: false, gone: true, code: "gone" };
    const code = response.status === 401 || response.status === 403 ? "refused-key"
      : response.status === 413 ? "too-large"
      : response.status === 429 ? "rate-limited"
      : response.status >= 500 ? "provider-error"
      : "rejected";
    return { ok: false, code };
  };
}
