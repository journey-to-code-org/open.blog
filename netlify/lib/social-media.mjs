// The exact public cover selected for an announcement. No network or storage: callers obtain
// the bytes and keep the returned snapshot with the announcement.
import { MAX_COVER_BYTES } from "./social-mastodon.mjs";

const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const HEX = /^[0-9a-f]{64}$/;
const FIELDS = ["version", "url", "description", "mimeType", "size", "sha256", "fallback"];

export class MediaError extends Error {
  constructor(code) {
    super(code === "changed" ? "The approved image changed." :
      code === "unavailable" ? "The approved image could not be read." : "The image selection is not valid.");
    this.name = "MediaError";
    this.code = code;
  }
}

function validImage(bytes, mimeType) {
  if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0 || bytes.byteLength > MAX_COVER_BYTES) return false;
  if (mimeType === "image/jpeg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/png") return bytes.length >= 8 && [137, 80, 78, 71, 13, 10, 26, 10].every((n, i) => bytes[i] === n);
  if (mimeType === "image/webp") return bytes.length >= 12 && String.fromCharCode(...bytes.slice(0, 4)) === "RIFF" && String.fromCharCode(...bytes.slice(8, 12)) === "WEBP";
  return false;
}

function validate(snapshot, canonicalUrl) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
      Object.keys(snapshot).some((key) => !FIELDS.includes(key)) ||
      FIELDS.some((key) => !Object.hasOwn(snapshot, key)) ||
      snapshot.version !== 1 || typeof snapshot.url !== "string" ||
      typeof snapshot.description !== "string" || snapshot.description !== snapshot.description.trim() ||
      !snapshot.description || CONTROL.test(snapshot.description) || Array.from(snapshot.description).length > 1500 ||
      !TYPES.has(snapshot.mimeType) || !Number.isSafeInteger(snapshot.size) || snapshot.size < 1 ||
      snapshot.size > MAX_COVER_BYTES || typeof snapshot.sha256 !== "string" || !HEX.test(snapshot.sha256) ||
      !["stop", "text"].includes(snapshot.fallback)) throw new MediaError("invalid");
  let page;
  let image;
  try {
    page = new URL(canonicalUrl);
    image = new URL(snapshot.url);
  } catch {
    throw new MediaError("invalid");
  }
  if (page.protocol !== "https:" || page.username || page.password || page.search || page.hash ||
      image.protocol !== "https:" || image.origin !== page.origin || image.username || image.password ||
      image.search || image.hash || snapshot.url !== image.href || snapshot.url.length > 2000) {
    throw new MediaError("invalid");
  }
  return snapshot;
}

async function hash(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export async function captureMedia({ url, description, mimeType, bytes, fallback }, canonicalUrl) {
  if (!TYPES.has(mimeType) || !validImage(bytes, mimeType)) throw new MediaError("invalid");
  return Object.freeze(validate({
    version: 1, url, description, mimeType, size: bytes.byteLength, sha256: await hash(bytes), fallback,
  }, canonicalUrl));
}

export async function verifyMedia(snapshot, canonicalUrl, bytes, mimeType) {
  validate(snapshot, canonicalUrl);
  if (mimeType !== snapshot.mimeType || !validImage(bytes, mimeType) ||
      bytes.byteLength !== snapshot.size || await hash(bytes) !== snapshot.sha256) {
    throw new MediaError("changed");
  }
  return snapshot;
}

export async function mediaApprovalDigest(snapshot, canonicalUrl) {
  validate(snapshot, canonicalUrl);
  const approval = [
    "openblog-social-media-v1", canonicalUrl, snapshot.url, snapshot.description, snapshot.mimeType,
    snapshot.size, snapshot.sha256, snapshot.fallback,
  ];
  return hash(new TextEncoder().encode(JSON.stringify(approval)));
}

export async function verifyMediaApproval(snapshot, canonicalUrl, approvedDigest) {
  if (typeof approvedDigest !== "string" || !HEX.test(approvedDigest)) throw new MediaError("invalid");
  if (await mediaApprovalDigest(snapshot, canonicalUrl) !== approvedDigest) throw new MediaError("changed");
  return snapshot;
}

// Fetch only the URL the author approved, without credentials or redirects, and enforce the
// byte limit while reading rather than trusting Content-Length.
export async function fetchApprovedMedia(fetchImpl, snapshot, canonicalUrl, signal) {
  validate(snapshot, canonicalUrl);
  let response;
  try {
    response = await fetchImpl(snapshot.url, { method: "GET", headers: { accept: snapshot.mimeType }, redirect: "manual", signal });
  } catch {
    throw new MediaError("unavailable");
  }
  if (response.status !== 200 || response.redirected || !response.body) throw new MediaError("unavailable");
  const mimeType = (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();
  if (mimeType !== snapshot.mimeType) throw new MediaError("changed");
  const reader = response.body.getReader();
  const parts = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > snapshot.size || total > MAX_COVER_BYTES) {
        await reader.cancel();
        throw new MediaError("changed");
      }
      parts.push(value);
    }
  } catch (error) {
    if (error instanceof MediaError) throw error;
    throw new MediaError("unavailable");
  } finally {
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.byteLength;
  }
  await verifyMedia(snapshot, canonicalUrl, bytes, mimeType);
  return bytes;
}
