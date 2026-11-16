// The exact public cover selected for an announcement. No network or storage: callers obtain
// the bytes and keep the returned snapshot with the announcement.
import { coverOf, MAX_COVER_BYTES } from "./social-mastodon.mjs";
import { checkCanonicalUrl, ScheduleError } from "./social-schedule.mjs";
import sharp from "sharp";

const TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const CONTROL = /[\u0000-\u001f\u007f-\u009f\u202a-\u202e\u2066-\u2069]/u;
const HEX = /^[0-9a-f]{64}$/;
const FIELDS = ["version", "url", "description", "mimeType", "size", "sha256", "fallback"];
const RESIZED_FIELDS = [...FIELDS, "sourceMimeType", "sourceSize", "sourceSha256", "transform"];
const THUMBNAIL_BYTES = 1_000_000;
const TRANSFORM = "bluesky-jpeg-v1";

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
  const fields = snapshot?.version === 2 ? RESIZED_FIELDS : FIELDS;
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot) ||
      Object.keys(snapshot).some((key) => !fields.includes(key)) ||
      fields.some((key) => !Object.hasOwn(snapshot, key)) ||
      ![1, 2].includes(snapshot.version) || typeof snapshot.url !== "string" ||
      typeof snapshot.description !== "string" || snapshot.description !== snapshot.description.trim() ||
      !snapshot.description || CONTROL.test(snapshot.description) || Array.from(snapshot.description).length > 1500 ||
      !TYPES.has(snapshot.mimeType) || !Number.isSafeInteger(snapshot.size) || snapshot.size < 1 ||
      snapshot.size > MAX_COVER_BYTES || typeof snapshot.sha256 !== "string" || !HEX.test(snapshot.sha256) ||
      !["stop", "text"].includes(snapshot.fallback)) throw new MediaError("invalid");
  if (snapshot.version === 2 && (snapshot.transform !== TRANSFORM || snapshot.mimeType !== "image/jpeg" ||
      snapshot.size > THUMBNAIL_BYTES || !TYPES.has(snapshot.sourceMimeType) ||
      !Number.isSafeInteger(snapshot.sourceSize) || snapshot.sourceSize <= THUMBNAIL_BYTES ||
      snapshot.sourceSize > MAX_COVER_BYTES || typeof snapshot.sourceSha256 !== "string" ||
      !HEX.test(snapshot.sourceSha256))) throw new MediaError("invalid");
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
    snapshot.version === 2 ? "openblog-social-media-v2" : "openblog-social-media-v1", canonicalUrl, snapshot.url, snapshot.description, snapshot.mimeType,
    snapshot.size, snapshot.sha256, snapshot.fallback,
  ];
  if (snapshot.version === 2) approval.push(snapshot.sourceMimeType, snapshot.sourceSize, snapshot.sourceSha256, snapshot.transform);
  return hash(new TextEncoder().encode(JSON.stringify(approval)));
}

export async function verifyMediaApproval(snapshot, canonicalUrl, approvedDigest) {
  if (typeof approvedDigest !== "string" || !HEX.test(approvedDigest)) throw new MediaError("invalid");
  if (await mediaApprovalDigest(snapshot, canonicalUrl) !== approvedDigest) throw new MediaError("changed");
  return snapshot;
}

async function readBytes(response, limit, tooLargeCode = "changed") {
  const reader = response.body.getReader();
  const parts = [];
  let total = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > limit) {
        await reader.cancel();
        throw new MediaError(tooLargeCode);
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
  return bytes;
}

async function getPublic(fetchImpl, url, accept, signal) {
  let response;
  try {
    response = await fetchImpl(url, { method: "GET", headers: { accept }, redirect: "manual", signal });
  } catch {
    throw new MediaError("unavailable");
  }
  if (response.status !== 200 || response.redirected || !response.body) throw new MediaError("unavailable");
  return response;
}

const responseType = (response) => (response.headers.get("content-type") || "").split(";", 1)[0].trim().toLowerCase();

async function thumbnail(bytes) {
  try {
    for (const side of [1200, 900, 640, 480, 320, 160]) {
      const output = await sharp(bytes, { limitInputPixels: 40_000_000, failOn: "warning" })
        .rotate().resize(side, side, { fit: "inside", withoutEnlargement: true })
        .flatten({ background: "#ffffff" }).jpeg({ quality: 82 }).toBuffer();
      if (output.byteLength <= THUMBNAIL_BYTES) return new Uint8Array(output);
    }
  } catch {
    throw new MediaError("invalid");
  }
  throw new MediaError("too-large");
}

export async function previewMedia(fetchImpl, canonicalUrl, work, signal, fallback = "text", resize = false) {
  try {
    checkCanonicalUrl(canonicalUrl, work);
  } catch (error) {
    if (error instanceof ScheduleError) throw new MediaError("invalid");
    throw error;
  }
  const page = await getPublic(fetchImpl, canonicalUrl, "text/html", signal);
  if (responseType(page) !== "text/html") throw new MediaError("unavailable");
  const html = new TextDecoder().decode(await readBytes(page, 512 * 1024));
  const cover = coverOf(html, canonicalUrl);
  if (!cover) throw new MediaError("unavailable");
  validate({ version: 1, ...cover, mimeType: "image/png", size: 1, sha256: "0".repeat(64), fallback }, canonicalUrl);
  const response = await getPublic(fetchImpl, cover.url, "image/jpeg,image/png,image/webp", signal);
  const mimeType = responseType(response);
  if (!TYPES.has(mimeType)) throw new MediaError("unavailable");
  const source = await readBytes(response, resize ? MAX_COVER_BYTES : THUMBNAIL_BYTES, "too-large");
  let bytes = source;
  let snapshot;
  if (resize && source.byteLength > THUMBNAIL_BYTES) {
    if (!validImage(source, mimeType)) throw new MediaError("invalid");
    bytes = await thumbnail(source);
    snapshot = Object.freeze(validate({
      version: 2, ...cover, mimeType: "image/jpeg", size: bytes.byteLength, sha256: await hash(bytes), fallback,
      sourceMimeType: mimeType, sourceSize: source.byteLength, sourceSha256: await hash(source), transform: TRANSFORM,
    }, canonicalUrl));
  } else {
    snapshot = await captureMedia({ ...cover, mimeType, bytes, fallback }, canonicalUrl);
  }
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return {
    media: { snapshot, approvalDigest: await mediaApprovalDigest(snapshot, canonicalUrl) },
    imageDataUrl: `data:${snapshot.mimeType};base64,${btoa(binary)}`,
  };
}

// Fetch only the URL the author approved, without credentials or redirects, and enforce the
// byte limit while reading rather than trusting Content-Length.
export async function fetchApprovedMedia(fetchImpl, snapshot, canonicalUrl, signal) {
  validate(snapshot, canonicalUrl);
  const sourceType = snapshot.version === 2 ? snapshot.sourceMimeType : snapshot.mimeType;
  const response = await getPublic(fetchImpl, snapshot.url, sourceType, signal);
  const mimeType = responseType(response);
  if (mimeType !== sourceType) throw new MediaError("changed");
  const source = await readBytes(response, snapshot.version === 2 ? snapshot.sourceSize : snapshot.size);
  let bytes = source;
  if (snapshot.version === 2) {
    if (source.byteLength !== snapshot.sourceSize || !validImage(source, mimeType) || await hash(source) !== snapshot.sourceSha256) throw new MediaError("changed");
    bytes = await thumbnail(source);
  }
  await verifyMedia(snapshot, canonicalUrl, bytes, snapshot.mimeType);
  return bytes;
}
