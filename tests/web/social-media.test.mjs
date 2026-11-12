import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { captureMedia, fetchApprovedMedia, mediaApprovalDigest, MediaError, previewMedia, verifyMedia, verifyMediaApproval } from "../../netlify/lib/social-media.mjs";

const sharp = createRequire(new URL("../../netlify/package.json", import.meta.url))("sharp");
const page = "https://blog.example.org/posts/one/";
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 42]);
const image = { url: "https://blog.example.org/images/cover.png", description: "A lantern", mimeType: "image/png", bytes: png, fallback: "stop" };

test("an oversized Bluesky cover is resized to the exact approved thumbnail and reproduced on delivery", async () => {
  const raw = randomBytes(1100 * 1100 * 3);
  const source = new Uint8Array(await sharp(raw, { raw: { width: 1100, height: 1100, channels: 3 } }).png().toBuffer());
  assert.ok(source.byteLength > 1_000_000 && source.byteLength < 8 * 1024 * 1024);
  const fetch = async (url) => url === page
    ? new Response('<meta property="og:image" content="/images/cover.png"><meta property="og:image:alt" content="A lantern">', { headers: { "content-type": "text/html" } })
    : new Response(source, { headers: { "content-type": "image/png" } });
  const result = await previewMedia(fetch, page, "/posts/one/", undefined, "text", true);
  const { snapshot, approvalDigest } = result.media;
  assert.equal(snapshot.version, 2);
  assert.equal(snapshot.mimeType, "image/jpeg");
  assert.equal(snapshot.sourceMimeType, "image/png");
  assert.equal(snapshot.sourceSize, source.length);
  assert.ok(snapshot.size <= 1_000_000);
  const previewed = new Uint8Array(Buffer.from(result.imageDataUrl.split(",")[1], "base64"));
  assert.equal(previewed.length, snapshot.size);
  assert.deepEqual(await fetchApprovedMedia(fetch, snapshot, page), previewed);
  assert.equal(await verifyMediaApproval(snapshot, page, approvalDigest), snapshot);
  const dimensions = await sharp(previewed).metadata();
  assert.ok(dimensions.width <= 1200 && dimensions.height <= 1200);
  const changed = source.slice();
  changed[changed.length - 1] ^= 1;
  await assert.rejects(fetchApprovedMedia(async () => new Response(changed, { headers: { "content-type": "image/png" } }), snapshot, page), (error) => error.code === "changed");
  await assert.rejects(verifyMediaApproval({ ...snapshot, sourceSha256: "0".repeat(64) }, page, approvalDigest), (error) => error.code === "changed");
  await assert.rejects(previewMedia(fetch, page, "/posts/one/"), (error) => error.code === "too-large");
});

test("the Bluesky size boundary preserves a one-million-byte image and resizes one byte more", async () => {
  const tiny = await sharp({ create: { width: 1, height: 1, channels: 3, background: "#ffffff" } }).png().toBuffer();
  for (const [size, version] of [[1_000_000, 1], [1_000_001, 2]]) {
    const source = new Uint8Array(size);
    source.set(tiny);
    const fetch = async (url) => url === page
      ? new Response('<meta property="og:image" content="/images/cover.png"><meta property="og:image:alt" content="A lantern">', { headers: { "content-type": "text/html" } })
      : new Response(source, { headers: { "content-type": "image/png" } });
    const preview = await previewMedia(fetch, page, "/posts/one/", undefined, "text", true);
    assert.equal(preview.media.snapshot.version, version);
    assert.ok(preview.media.snapshot.size <= 1_000_000);
    assert.deepEqual(await fetchApprovedMedia(fetch, preview.media.snapshot, page), new Uint8Array(Buffer.from(preview.imageDataUrl.split(",")[1], "base64")));
  }
});

test("resizing refuses oversized downloads and images above the pixel limit", async () => {
  const tiny = await sharp({ create: { width: 1, height: 1, channels: 3, background: "#ffffff" } }).png().toBuffer();
  const fetchImage = (source) => async (url) => url === page
    ? new Response('<meta property="og:image" content="/images/cover.png"><meta property="og:image:alt" content="A lantern">', { headers: { "content-type": "text/html" } })
    : new Response(source, { headers: { "content-type": "image/png" } });
  const tooLarge = new Uint8Array(8 * 1024 * 1024 + 1);
  tooLarge.set(tiny);
  await assert.rejects(previewMedia(fetchImage(tooLarge), page, "/posts/one/", undefined, "text", true), (error) => error.code === "too-large");
  const tooManyPixels = new Uint8Array(1_000_001);
  tooManyPixels.set(tiny);
  const view = new DataView(tooManyPixels.buffer);
  view.setUint32(16, 10_000);
  view.setUint32(20, 10_000);
  await assert.rejects(previewMedia(fetchImage(tooManyPixels), page, "/posts/one/", undefined, "text", true), (error) => error.code === "invalid");
});

test("preview reads a same-origin cover and returns the exact selection to approve", async () => {
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url === page) return new Response(`<meta property="og:image" content="/images/cover.png"><meta property="og:image:alt" content="A lantern">`, { headers: { "content-type": "text/html" } });
    return new Response(png, { headers: { "content-type": "image/png" } });
  };
  const result = await previewMedia(fetch, page, "/posts/one/");
  assert.equal(result.media.snapshot.url, image.url);
  assert.equal(result.media.snapshot.description, image.description);
  assert.equal(result.media.snapshot.fallback, "text");
  assert.equal(await verifyMediaApproval(result.media.snapshot, page, result.media.approvalDigest), result.media.snapshot);
  assert.deepEqual(Buffer.from(result.imageDataUrl.split(",")[1], "base64"), Buffer.from(png));
  assert.deepEqual(calls.map((call) => call.url), [page, image.url]);
  assert.ok(calls.every((call) => call.init.redirect === "manual" && !call.init.headers.authorization));
});

test("preview refuses invalid canonical links and off-origin or undescribed covers", async () => {
  let calls = 0;
  const fetch = async () => {
    calls += 1;
    return new Response(`<meta property="og:image" content="https://other.example.org/c.png"><meta property="og:image:alt" content="Lantern">`, { headers: { "content-type": "text/html" } });
  };
  await assert.rejects(previewMedia(fetch, page, "/posts/other/"), (error) => error.code === "invalid");
  assert.equal(calls, 0);
  await assert.rejects(previewMedia(fetch, page, "/posts/one/"), (error) => error.code === "unavailable");
  assert.equal(calls, 1);
});

test("the approved image snapshot binds exact bytes, type, description and fallback", async () => {
  const snapshot = await captureMedia(image, page);
  assert.equal(snapshot.size, png.length);
  assert.match(snapshot.sha256, /^[0-9a-f]{64}$/);
  assert.equal(snapshot.description, "A lantern");
  assert.equal(snapshot.fallback, "stop");
  assert.equal(await verifyMedia(snapshot, page, png, "image/png"), snapshot);
  const approval = await mediaApprovalDigest(snapshot, page);
  assert.equal(approval, await mediaApprovalDigest({ ...snapshot }, page));
  assert.equal(await verifyMediaApproval(snapshot, page, approval), snapshot);
  for (const changed of [
    { description: "Another lantern" }, { fallback: "text" },
    { url: "https://blog.example.org/images/other.png" }, { sha256: "0".repeat(64) },
  ]) {
    assert.notEqual(await mediaApprovalDigest({ ...snapshot, ...changed }, page), approval);
    await assert.rejects(verifyMediaApproval({ ...snapshot, ...changed }, page, approval), (error) => error.code === "changed");
  }
  await assert.rejects(verifyMediaApproval(snapshot, page, "bad"), (error) => error.code === "invalid");
  assert.notEqual(await mediaApprovalDigest(snapshot, "https://blog.example.org/posts/two/"), approval);
  const changed = png.slice();
  changed[8] ^= 1;
  await assert.rejects(verifyMedia(snapshot, page, changed, "image/png"), (error) => error instanceof MediaError && error.code === "changed");
  await assert.rejects(verifyMedia(snapshot, page, png, "image/jpeg"), (error) => error instanceof MediaError && error.code === "changed");
});

test("delivery fetches the approved URL without credentials or redirects and verifies every byte", async () => {
  const snapshot = await captureMedia(image, page);
  let request;
  const fetch = async (url, init) => {
    request = { url, init };
    return new Response(png, { headers: { "content-type": "image/png" } });
  };
  assert.deepEqual(await fetchApprovedMedia(fetch, snapshot, page), png);
  assert.equal(request.url, image.url);
  assert.equal(request.init.redirect, "manual");
  assert.deepEqual(request.init.headers, { accept: "image/png" });
  const changed = png.slice();
  changed[8] ^= 1;
  await assert.rejects(fetchApprovedMedia(async () => new Response(changed, { headers: { "content-type": "image/png" } }), snapshot, page), (error) => error.code === "changed");
  await assert.rejects(fetchApprovedMedia(async () => new Response(null, { status: 302, headers: { location: "https://other.example.org/a" } }), snapshot, page), (error) => error.code === "unavailable");
  await assert.rejects(fetchApprovedMedia(async () => new Response(new Uint8Array(png.length + 1), { headers: { "content-type": "image/png" } }), snapshot, page), (error) => error.code === "changed");
  let canceled = false;
  const body = new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(png.length + 1));
    },
    cancel() { canceled = true; },
  });
  await assert.rejects(fetchApprovedMedia(async () => new Response(body, { headers: { "content-type": "image/png" } }), snapshot, page), (error) => error.code === "changed");
  assert.equal(canceled, true);
  await assert.rejects(fetchApprovedMedia(async () => { throw new Error("network"); }, snapshot, page), (error) => error.code === "unavailable");
});

test("invalid images, descriptions, URLs and fallback choices are refused", async () => {
  for (const change of [
    { description: "" }, { description: " \t " }, { description: "name\u0000" },
    { url: "https://other.example.org/cover.png" }, { url: "http://blog.example.org/a" },
    { url: "https://blog.example.org/a#x" }, { url: "https://blog.example.org/a?token=x" },
    { fallback: undefined }, { fallback: "guess" },
    { bytes: Uint8Array.from([1, 2, 3]) }, { mimeType: "image/gif" },
  ]) {
    await assert.rejects(captureMedia({ ...image, ...change }, page), (error) => error instanceof MediaError && error.code === "invalid");
  }
  const snapshot = await captureMedia(image, page);
  await assert.rejects(verifyMedia({ ...snapshot, extra: true }, page, png, "image/png"), MediaError);
});
