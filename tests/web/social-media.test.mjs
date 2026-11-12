import test from "node:test";
import assert from "node:assert/strict";
import { captureMedia, fetchApprovedMedia, mediaApprovalDigest, MediaError, verifyMedia, verifyMediaApproval } from "../../netlify/lib/social-media.mjs";

const page = "https://blog.example.org/posts/one/";
const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 42]);
const image = { url: "https://blog.example.org/images/cover.png", description: "A lantern", mimeType: "image/png", bytes: png, fallback: "stop" };

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
