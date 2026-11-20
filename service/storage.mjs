// The few Supabase Storage calls open.blog's functions make (quote request photos and the owner's
// retention choice), answered from a folder on a disk, for a host with no Supabase.
//
// Reached two ways:
//   - through the loopback bridge, with the service key, exactly as the functions call Supabase:
//       POST   /storage/v1/object/<bucket>/<path>          put an object (x-upsert: true replaces)
//       GET    /storage/v1/object/authenticated/<bucket>/<path>
//       DELETE /storage/v1/object/<bucket>/<path>           one object
//       DELETE /storage/v1/object/<bucket>   { prefixes }   several
//       POST   /storage/v1/object/list/<bucket> { prefix, limit }
//       POST   /storage/v1/object/move  { bucketId, sourceKey, destinationKey }
//       POST   /storage/v1/object/sign/<bucket>/<path> { expiresIn }  → { signedURL }
//   - on the public address, only a signed link: GET /storage/v1/object/sign/<bucket>/<path>?token=
//     A token is an HMAC of the object and its expiry under a key derived from the service secret;
//     it opens that one object until it expires, and only an image is ever sent back.
//
// Paths are a few segments of letters, digits, dot, dash and underscore; nothing can climb out of the
// folder. Each object's type is kept beside it, so the bytes are never served as anything else.

import { createHmac, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

const SEGMENT = /^[A-Za-z0-9][A-Za-z0-9._-]{0,127}$/;
const BUCKET = /^[a-z0-9][a-z0-9-]{0,62}$/;
const IMAGES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_EXPIRY = 7 * 24 * 60 * 60;

/** A safe object key ("a/b/c.jpg"), or null. */
export function objectKey(value) {
  const key = String(value ?? "");
  if (!key || key.length > 512) return null;
  const parts = key.split("/");
  if (parts.length > 8 || !parts.every((part) => SEGMENT.test(part) && part !== "." && part !== "..")) return null;
  if (parts.some((part) => part.endsWith(".type"))) return null;
  return parts.join("/");
}

const signingKey = (secret) => createHmac("sha256", String(secret)).update("openblog-storage-sign").digest();

export function signToken(secret, bucket, key, expires) {
  const mac = createHmac("sha256", signingKey(secret)).update(`${bucket}/${key}\n${expires}`).digest("base64url");
  return `${expires}.${mac}`;
}

export function checkToken(secret, bucket, key, token, now = Date.now()) {
  const [expires, mac] = String(token || "").split(".");
  if (!/^\d{1,12}$/.test(expires || "") || !mac) return false;
  if (Number(expires) * 1000 < now) return false;
  const wanted = Buffer.from(signToken(secret, bucket, key, expires).split(".")[1]);
  const given = Buffer.from(mac);
  return wanted.length === given.length && timingSafeEqual(wanted, given);
}

const reply = (status, body, headers = {}) => ({ status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff", ...headers }, body: typeof body === "string" || Buffer.isBuffer(body) ? body : JSON.stringify(body) });
const parseJson = (body) => {
  try {
    const value = JSON.parse(Buffer.isBuffer(body) ? body.toString("utf8") : String(body || "{}"));
    return value && typeof value === "object" && !Array.isArray(value) ? value : null;
  } catch {
    return null;
  }
};

/**
 * A storage answering the calls above from `root`. `secret` signs links (the service secret);
 * `serviceKey` is the token the functions present; `maxBytes` bounds one object.
 */
export function createStorage({ root, secret, serviceKey, maxBytes = 2 * 1024 * 1024, now = () => Date.now() }) {
  const file = (bucket, key) => join(root, bucket, ...key.split("/"));
  const exists = async (path) => stat(path).then((s) => s.isFile(), () => false);
  const remove = async (bucket, key) => {
    const path = file(bucket, key);
    if (!(await exists(path))) return false;
    await rm(path, { force: true });
    await rm(`${path}.type`, { force: true });
    return true;
  };
  const authorized = (headers) => {
    const given = Buffer.from(String(headers.authorization || ""));
    const wanted = Buffer.from(`Bearer ${serviceKey}`);
    return given.length === wanted.length && timingSafeEqual(given, wanted);
  };

  /** The public side: one signed link. Anything else is not found. */
  async function servePublic({ method, pathname, searchParams }) {
    if (method !== "GET" && method !== "HEAD") return reply(405, { error: "method" }, { allow: "GET" });
    const match = /^\/storage\/v1\/object\/sign\/([^/]+)\/(.+)$/.exec(pathname);
    const bucket = match?.[1];
    const key = match && objectKey(decodeURIComponent(match[2]));
    if (!bucket || !BUCKET.test(bucket) || !key || !checkToken(secret, bucket, key, searchParams.get("token"), now())) return reply(404, { error: "not-found" });
    const path = file(bucket, key);
    const type = await readFile(`${path}.type`, "utf8").catch(() => "");
    if (!IMAGES.has(type)) return reply(404, { error: "not-found" });
    const bytes = await readFile(path).catch(() => null);
    if (!bytes) return reply(404, { error: "not-found" });
    return reply(200, method === "HEAD" ? "" : bytes, {
      "content-type": type,
      "cache-control": "private, max-age=300",
      "content-security-policy": "default-src 'none'; sandbox",
      "cross-origin-resource-policy": "cross-origin",
    });
  }

  /** The functions' side, through the loopback bridge with the service key. */
  async function serveInternal({ method, pathname, headers, body }) {
    if (!authorized(headers)) return reply(401, { error: "unauthorized" });
    const rest = pathname.slice("/storage/v1/object".length);

    if (method === "POST" && rest === "/move") {
      const input = parseJson(body);
      const bucket = String(input?.bucketId || "");
      const from = objectKey(input?.sourceKey);
      const to = objectKey(input?.destinationKey);
      if (!BUCKET.test(bucket) || !from || !to) return reply(400, { error: "invalid" });
      const source = file(bucket, from);
      if (!(await exists(source))) return reply(404, { error: "not-found" });
      const target = file(bucket, to);
      await mkdir(dirname(target), { recursive: true });
      await rename(source, target);
      await rename(`${source}.type`, `${target}.type`).catch(() => {});
      return reply(200, { message: "Successfully moved" });
    }

    let match = /^\/list\/([^/]+)$/.exec(rest);
    if (method === "POST" && match) {
      const bucket = match[1];
      const input = parseJson(body);
      const prefix = input?.prefix ? objectKey(String(input.prefix).replace(/\/+$/, "")) : "";
      if (!BUCKET.test(bucket) || prefix === null) return reply(400, { error: "invalid" });
      const limit = Math.min(Math.max(Number(input?.limit) || 100, 1), 1000);
      const entries = await readdir(prefix ? file(bucket, prefix) : join(root, bucket), { withFileTypes: true }).catch(() => []);
      const names = entries.filter((entry) => entry.isFile() && !entry.name.endsWith(".type")).map((entry) => entry.name).sort().slice(0, limit);
      return reply(200, names.map((name) => ({ name })));
    }

    match = /^\/sign\/([^/]+)\/(.+)$/.exec(rest);
    if (method === "POST" && match) {
      const bucket = match[1];
      const key = objectKey(decodeURIComponent(match[2]));
      if (!BUCKET.test(bucket) || !key) return reply(400, { error: "invalid" });
      if (!(await exists(file(bucket, key)))) return reply(404, { error: "not-found" });
      const seconds = Math.min(Math.max(Math.floor(Number(parseJson(body)?.expiresIn) || 600), 1), MAX_EXPIRY);
      const token = signToken(secret, bucket, key, Math.floor(now() / 1000) + seconds);
      return reply(200, { signedURL: `/object/sign/${bucket}/${key}?token=${encodeURIComponent(token)}` });
    }

    match = /^\/authenticated\/([^/]+)\/(.+)$/.exec(rest);
    if (method === "GET" && match) {
      const bucket = match[1];
      const key = objectKey(decodeURIComponent(match[2]));
      if (!BUCKET.test(bucket) || !key) return reply(400, { error: "invalid" });
      const path = file(bucket, key);
      const bytes = await readFile(path).catch(() => null);
      if (!bytes) return reply(404, { error: "not-found" });
      const type = await readFile(`${path}.type`, "utf8").catch(() => "application/octet-stream");
      return reply(200, bytes, { "content-type": type });
    }

    match = /^\/([^/]+)$/.exec(rest);
    if (method === "DELETE" && match) {
      const bucket = match[1];
      const prefixes = parseJson(body)?.prefixes;
      if (!BUCKET.test(bucket) || !Array.isArray(prefixes) || prefixes.length > 1000) return reply(400, { error: "invalid" });
      const keys = prefixes.map(objectKey);
      if (keys.some((key) => !key)) return reply(400, { error: "invalid" });
      const removed = [];
      for (const key of keys) if (await remove(bucket, key)) removed.push({ name: key });
      return reply(200, removed);
    }

    match = /^\/([^/]+)\/(.+)$/.exec(rest);
    if (match) {
      const bucket = match[1];
      const key = objectKey(decodeURIComponent(match[2]));
      if (!BUCKET.test(bucket) || !key) return reply(400, { error: "invalid" });
      if (method === "DELETE") return (await remove(bucket, key)) ? reply(200, { message: "Successfully deleted" }) : reply(404, { error: "not-found" });
      if (method === "POST" || method === "PUT") {
        const bytes = Buffer.isBuffer(body) ? body : Buffer.from(String(body || ""));
        if (bytes.length > maxBytes) return reply(413, { error: "too-large" });
        const path = file(bucket, key);
        const upsert = method === "PUT" || String(headers["x-upsert"] || "").toLowerCase() === "true";
        if (!upsert && (await exists(path))) return reply(409, { error: "Duplicate" });
        const type = String(headers["content-type"] || "application/octet-stream").split(";")[0].trim().toLowerCase().slice(0, 100);
        await mkdir(dirname(path), { recursive: true });
        await writeFile(path, bytes);
        await writeFile(`${path}.type`, type);
        return reply(200, { Key: `${bucket}/${key}` });
      }
    }
    return reply(404, { error: "not-found" });
  }

  return { servePublic, serveInternal };
}

/** A storage that refuses everything, for a service with no disk: functions see it as unavailable. */
export const NO_STORAGE = {
  servePublic: async () => reply(404, { error: "not-found" }),
  serveInternal: async () => reply(503, { error: "storage-unavailable" }),
};
