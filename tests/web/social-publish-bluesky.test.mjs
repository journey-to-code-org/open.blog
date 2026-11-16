// The Bluesky adapter (epic #382, story #391, task DIST2.1.2, ADR 0358): the post record it writes
// (text, facets in UTF-8 byte offsets, the link card), the record key that ties every attempt of an
// announcement to one record, the at:// URI it captures, and the read-only lookup by that key.
// Scripted service only; no real network.
import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { socialAdapters } from "../../netlify/lib/social-adapters.mjs";
import { announcementKey, blobCid, cardTitle, facetsFor, graphemes, tid, TID, withinPostLimits } from "../../netlify/lib/social-atproto.mjs";
import { captureMedia, mediaApprovalDigest, previewMedia } from "../../netlify/lib/social-media.mjs";
import { allProviders, call, isDelivery, scripted, settle } from "./social-publish-fakes.mjs";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const RKEY = "3mzar4gvw36e6";
const URI = `at://${DID}/app.bsky.feed.post/${RKEY}`;
const sharp = createRequire(new URL("../../netlify/package.json", import.meta.url))("sharp");
const TOKEN = "eyJhbGciOiJFUzI1NksifQ.eyJleHAiOjF9.c2ln";
const created = { status: 200, body: { uri: URI, cid: "bafyreib2rxk3rh6kzwq" } };

const adapter = (fetchImpl) => socialAdapters({ providers: allProviders(), fetchImpl, now: () => NOW }).bluesky;
const publish = async (reply, input = {}) => {
  const fake = scripted(reply);
  const result = await settle(adapter(fake.fetchImpl).publish(call("bluesky", { accessToken: TOKEN, ...input })));
  const write = fake.calls.find((c) => c.method === "POST");
  return { ...result, calls: fake.calls, write, sent: write ? JSON.parse(write.body) : null };
};
const bytes = (text, start, end) => Buffer.from(text, "utf8").subarray(start, end).toString("utf8");

test("blob CIDs encode the SHA-256 digest using CIDv1 and the raw codec", () => {
  assert.equal(blobCid("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"), "bafkreif2pall7dybz7vecqka3zo24irdwabwdi4wc55jznaq75q7eaavvu");
  assert.equal(blobCid("bad"), null);
});

test("an explicitly approved thumbnail is checked, uploaded as a blob and attached", async () => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 42]);
  const url = "https://blog.example.com/posts/hello/";
  const snapshot = await captureMedia({ url: "https://blog.example.com/c.png", description: "A lantern", mimeType: "image/png", bytes: png, fallback: "text" }, url);
  const media = { snapshot, approvalDigest: await mediaApprovalDigest(snapshot, url) };
  const blob = { $type: "blob", ref: { $link: blobCid(snapshot.sha256) }, mimeType: "image/png", size: png.length };
  const fake = scripted((n, target) => {
    if (target === url) return { status: 200, headers: { "content-type": "text/html" }, body: PAGE };
    if (target === snapshot.url) return { status: 200, headers: { "content-type": "image/png" }, body: png };
    if (target.endsWith(".uploadBlob")) return { status: 200, body: { blob } };
    if (target.endsWith(".createRecord")) return created;
    return { status: 599 };
  });
  const input = call("bluesky", { accessToken: TOKEN, post: { media } });
  assert.deepEqual(await adapter(fake.fetchImpl).publish(input), { providerPostId: URI });
  const imageRead = fake.calls.find((item) => item.url === snapshot.url);
  const upload = fake.calls.find((item) => item.url.endsWith(".uploadBlob"));
  const write = fake.calls.find((item) => item.url.endsWith(".createRecord"));
  assert.equal(imageRead.headers.authorization, undefined);
  assert.equal(imageRead.redirect, "manual");
  assert.deepEqual(upload.body, png);
  assert.equal(upload.headers["content-type"], "image/png");
  assert.deepEqual(JSON.parse(write.body).record.embed.external.thumb, blob);

  const record = (thumb) => ({ status: 200, body: { uri: URI, value: {
    $type: "app.bsky.feed.post", text: input.post.caption,
    embed: { external: { uri: url, ...(thumb ? { thumb } : {}) } },
  } } });
  for (const [value, expected] of [[blob, "published"], [null, "published"], [{ ...blob, ref: { $link: blobCid("0".repeat(64)) } }, "unknown"]]) {
    const lookup = scripted(record(value));
    assert.equal((await adapter(lookup.fetchImpl).reconcile(input)).state, expected);
  }
});

test("the approved resized thumbnail, not its oversized source, is uploaded and attached", async () => {
  const raw = randomBytes(1100 * 1100 * 3);
  const source = new Uint8Array(await sharp(raw, { raw: { width: 1100, height: 1100, channels: 3 } }).png().toBuffer());
  const url = "https://blog.example.com/posts/hello/";
  const imageUrl = "https://blog.example.com/c.png";
  const preview = await previewMedia(async (target) => target === url
    ? new Response('<meta property="og:image" content="/c.png"><meta property="og:image:alt" content="A lantern">', { headers: { "content-type": "text/html" } })
    : new Response(source, { headers: { "content-type": "image/png" } }), url, "/posts/hello/", undefined, "text", true);
  const approved = new Uint8Array(Buffer.from(preview.imageDataUrl.split(",")[1], "base64"));
  const snapshot = preview.media.snapshot;
  assert.equal(snapshot.version, 2);
  assert.ok(snapshot.size <= 1_000_000 && source.length > 1_000_000);
  const blob = { $type: "blob", ref: { $link: blobCid(snapshot.sha256) }, mimeType: "image/jpeg", size: approved.length };
  const fake = scripted((n, target) => {
    if (target === url) return { status: 200, headers: { "content-type": "text/html" }, body: PAGE };
    if (target === imageUrl) return { status: 200, headers: { "content-type": "image/png" }, body: source };
    if (target.endsWith(".uploadBlob")) return { status: 200, body: { blob } };
    if (target.endsWith(".createRecord")) return created;
    return { status: 599 };
  });
  assert.deepEqual(await adapter(fake.fetchImpl).publish(call("bluesky", { accessToken: TOKEN, post: { media: preview.media } })), { providerPostId: URI });
  assert.deepEqual(fake.calls.find((item) => item.url.endsWith(".uploadBlob")).body, approved);
  assert.deepEqual(JSON.parse(fake.calls.find((item) => item.url.endsWith(".createRecord")).body).record.embed.external.thumb, blob);
  const changed = source.slice();
  changed[changed.length - 1] ^= 1;
  const changedFetch = scripted((n, target) => {
    if (target === url) return { status: 200, headers: { "content-type": "text/html" }, body: PAGE };
    if (target === imageUrl) return { status: 200, headers: { "content-type": "image/png" }, body: changed };
    if (target.endsWith(".createRecord")) return created;
    return { status: 599 };
  });
  assert.deepEqual(await adapter(changedFetch.fetchImpl).publish(call("bluesky", { accessToken: TOKEN, post: { media: preview.media } })), { providerPostId: URI });
  assert.equal(changedFetch.calls.some((item) => item.url.endsWith(".uploadBlob")), false);
  assert.equal(JSON.parse(changedFetch.calls.find((item) => item.url.endsWith(".createRecord")).body).record.embed.external.thumb, undefined);
});

test("thumbnail failure uses the approved fallback; a changed approval never posts", async () => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 42]);
  const url = "https://blog.example.com/posts/hello/";
  for (const fallback of ["text", "stop"]) {
    const snapshot = await captureMedia({ url: "https://blog.example.com/c.png", description: "A lantern", mimeType: "image/png", bytes: png, fallback }, url);
    const media = { snapshot, approvalDigest: await mediaApprovalDigest(snapshot, url) };
    const fake = scripted((n, target) => target.endsWith(".createRecord") ? created : { status: 404 });
    const input = call("bluesky", { accessToken: TOKEN, post: { media } });
    const result = await settle(adapter(fake.fetchImpl).publish(input));
    const write = fake.calls.find((item) => item.url.endsWith(".createRecord"));
    if (fallback === "text") {
      assert.deepEqual(result.value, { providerPostId: URI });
      assert.equal(JSON.parse(write.body).record.embed.external.thumb, undefined);
    } else {
      assert.ok(isDelivery(result.error, "rejected"));
      assert.equal(write, undefined);
    }
    const invalid = scripted(created);
    input.post.media = { ...media, snapshot: { ...snapshot, description: "Changed" } };
    assert.ok(isDelivery((await settle(adapter(invalid.fetchImpl).publish(input))).error, "rejected"));
    assert.equal(invalid.calls.length, 0);
  }
});

test("changed bytes or a forged blob response never enter a Bluesky post", async () => {
  const png = Uint8Array.from([137, 80, 78, 71, 13, 10, 26, 10, 42]);
  const changed = png.slice();
  changed[8] ^= 1;
  const url = "https://blog.example.com/posts/hello/";
  const snapshot = await captureMedia({ url: "https://blog.example.com/c.png", description: "A lantern", mimeType: "image/png", bytes: png, fallback: "text" }, url);
  const media = { snapshot, approvalDigest: await mediaApprovalDigest(snapshot, url) };
  for (const tampered of ["bytes", "blob"]) {
    const fake = scripted((n, target) => {
      if (target === snapshot.url) return { status: 200, headers: { "content-type": "image/png" }, body: tampered === "bytes" ? changed : png };
      if (target.endsWith(".uploadBlob")) return { status: 200, body: { blob: { $type: "blob", ref: { $link: blobCid("0".repeat(64)) }, mimeType: "image/png", size: png.length } } };
      if (target.endsWith(".createRecord")) return created;
      return { status: 404 };
    });
    const result = await adapter(fake.fetchImpl).publish(call("bluesky", { accessToken: TOKEN, post: { media } }));
    assert.deepEqual(result, { providerPostId: URI });
    const write = fake.calls.find((item) => item.url.endsWith(".createRecord"));
    assert.equal(JSON.parse(write.body).record.embed.external.thumb, undefined);
    if (tampered === "bytes") assert.equal(fake.calls.some((item) => item.url.endsWith(".uploadBlob")), false);
  }
});

test("the post: caption as text, the canonical post as a link card, the record key of the announcement, one createRecord", async () => {
  const { value, calls, sent } = await publish(created);
  assert.deepEqual(value, { providerPostId: URI });
  assert.equal(calls.length, 2, "the post's page is read for its card, then one write");
  assert.deepEqual([calls[0].method, calls[0].url, calls[0].headers.authorization], ["GET", "https://blog.example.com/posts/hello/", undefined], "the public page never gets the token");
  assert.equal(calls[1].url, "https://bsky.social/xrpc/com.atproto.repo.createRecord");
  assert.equal(calls[1].method, "POST");
  assert.equal(calls[1].headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[1].redirect, "manual");
  assert.deepEqual(sent, {
    repo: DID,
    collection: "app.bsky.feed.post",
    rkey: RKEY,
    record: {
      $type: "app.bsky.feed.post",
      text: "A new post is up.",
      createdAt: "2026-11-01T12:00:00.000Z",
      embed: { $type: "app.bsky.embed.external", external: { uri: "https://blog.example.com/posts/hello/", title: "A new post is up.", description: "" } },
    },
  });
  assert.ok(!calls[1].body.includes("idem-key-0001"), "the idempotency key itself is never sent");
});

const PAGE = '<!doctype html><html><head><meta property="og:title" content="Hello &amp; lanterns"><meta property="og:description" content="How we light the&#10;quay at dusk."><meta property="og:image" content="https://blog.example.com/c.png"></head><body></body></html>';
const withPage = (page, write = created) => (n, url) => (url === "https://blog.example.com/posts/hello/" ? page : write);

test("the card shows the post's own title and description from its public page, never the caption twice (ADR 0386)", async () => {
  const caption = "Soup is up #recipes, see https://blog.example.com/posts/hello/ (and @friend)";
  const { value, sent } = await publish(withPage({ status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: PAGE }), { post: { caption } });
  assert.deepEqual(value, { providerPostId: URI });
  assert.equal(sent.record.text, caption);
  assert.deepEqual(sent.record.embed.external, { uri: "https://blog.example.com/posts/hello/", title: "Hello & lanterns", description: "How we light the quay at dusk." });
  // A page that cannot be had, is not HTML, redirects, or names no title: the caption's first line, as before.
  for (const page of [{ status: 404 }, { status: 200, headers: { "content-type": "application/json" }, body: "{}" }, { status: 301, headers: { location: "https://elsewhere.example/" } }, { status: 200, headers: { "content-type": "text/html" }, body: "<html></html>" }, new TypeError("fetch failed")]) {
    const fallback = await publish(withPage(page), { post: { caption } });
    assert.deepEqual(fallback.value, { providerPostId: URI });
    assert.deepEqual(fallback.sent.record.embed.external, { uri: "https://blog.example.com/posts/hello/", title: caption, description: "" });
  }
});

test("a repeat of an attempt that landed is refused for its taken record key and settles as posted, not failed", async () => {
  const taken = { status: 400, body: { error: "InvalidRequest", message: "Record already exists" } };
  const replies = (record) => (n, url, init) => (url.includes("getRecord") ? record : url.includes("createRecord") ? taken : { status: 404 });
  const landed = await publish(replies({ status: 200, body: { uri: URI, cid: "bafyrei", value: { $type: "app.bsky.feed.post", text: "A new post is up.", embed: { $type: "app.bsky.embed.external", external: { uri: "https://blog.example.com/posts/hello/" } } } } }));
  assert.deepEqual(landed.value, { providerPostId: URI });
  assert.equal(landed.calls.filter((c) => c.method === "POST").length, 1, "never written twice");
  // The record under that key is something else, or is not there: still a refusal.
  const other = await publish(replies({ status: 200, body: { uri: URI, cid: "bafyrei", value: { $type: "app.bsky.feed.post", text: "Something else", embed: { $type: "app.bsky.embed.external", external: { uri: "https://blog.example.com/posts/hello/" } } } } }));
  assert.ok(isDelivery(other.error, "rejected"));
  const none = await publish(replies({ status: 400, body: { error: "RecordNotFound" } }));
  assert.ok(isDelivery(none.error, "rejected"));
});

test("links and hashtags in the caption become facets at UTF-8 byte offsets; mentions stay plain text", async () => {
  const caption = "Café notes: https://blog.example.com/posts/café-1/, and more at (https://example.org/x). #Rust #2026 #ünïcode thanks @someone.bsky.social";
  const { sent } = await publish(created, { post: { caption } });
  const { text, facets } = sent.record;
  assert.equal(text, caption);
  const features = facets.map((facet) => [bytes(text, facet.index.byteStart, facet.index.byteEnd), facet.features[0]]);
  assert.deepEqual(features, [
    ["https://blog.example.com/posts/café-1/", { $type: "app.bsky.richtext.facet#link", uri: "https://blog.example.com/posts/café-1/" }],
    ["https://example.org/x", { $type: "app.bsky.richtext.facet#link", uri: "https://example.org/x" }],
    ["#Rust", { $type: "app.bsky.richtext.facet#tag", tag: "Rust" }],
    ["#ünïcode", { $type: "app.bsky.richtext.facet#tag", tag: "ünïcode" }],
  ]);
  assert.ok(!JSON.stringify(facets).includes("mention"), "no mention is guessed");
  // No facets at all is no `facets` field.
  assert.equal("facets" in (await publish(created)).sent.record, false);
  // A link that is not http(s) or names credentials is left alone.
  assert.deepEqual(facetsFor("see https://user:pw@example.org/ and ftp://example.org/"), []);
  assert.deepEqual(facetsFor("a#b and #123 are not tags"), []);
});

test("the card title is the caption's first line, plain and bounded", () => {
  assert.equal(cardTitle("First line\nsecond line"), "First line");
  assert.equal(cardTitle("  spaced\tout  "), "spaced out");
  assert.equal(cardTitle("\n"), "Read the full post");
  assert.equal(Array.from(cardTitle("é".repeat(400))).length, 300);
});

test("the record key is a TID made from the announcement: stable for it, different for another", async () => {
  const key = await announcementKey({ scheduledFor: "2026-11-01T12:00:00Z", idempotencyKey: "idem-key-0001" });
  assert.equal(key, RKEY);
  assert.ok(TID.test(key));
  assert.equal(await announcementKey({ scheduledFor: "2026-11-01T12:00:00.000Z", idempotencyKey: "idem-key-0001" }), key);
  assert.notEqual(await announcementKey({ scheduledFor: "2026-11-01T12:00:00Z", idempotencyKey: "idem-key-0002" }), key);
  assert.notEqual(await announcementKey({ scheduledFor: "2026-11-01T12:01:00Z", idempotencyKey: "idem-key-0001" }), key);
  assert.equal(await announcementKey({ scheduledFor: "soon", idempotencyKey: "idem-key-0001" }), null);
  assert.equal(await announcementKey({ scheduledFor: "2026-11-01T12:00:00Z" }), null);
  // TIDs sort by time, and the alphabet is base32-sortable.
  assert.equal(tid(0n, 0), "2222222222222");
  assert.ok(tid(1_700_000_000_000_000n, 0) < tid(1_800_000_000_000_000n, 0));
  // Two attempts of one announcement send the same key.
  const first = await publish({ status: 500 });
  const second = await publish(created);
  assert.equal(first.sent.rkey, second.sent.rkey);
});

test("refused before any call: a wrong account, a caption over Bluesky's limit, no time, no token", async () => {
  for (const input of [
    { account: { externalId: "urn:li:person:abc" } },
    { account: { kind: "page" } },
    { post: { caption: "a".repeat(301) } },
    { post: { scheduledFor: undefined } },
    { post: { canonicalUrl: "http://blog.example.com/posts/hello/" } },
    { accessToken: "" },
  ]) {
    const { error, calls } = await publish(created, input);
    assert.ok(isDelivery(error, input.accessToken === "" ? "auth" : "rejected"), JSON.stringify(input));
    assert.equal(calls.length, 0);
  }
  assert.ok(withinPostLimits("😀".repeat(300)));
  assert.equal(graphemes("👩‍👩‍👧"), 1);
});

const reconcile = async (reply, input = {}) => {
  const fake = scripted(reply);
  const found = await adapter(fake.fetchImpl).reconcile({ ...call("bluesky", { accessToken: TOKEN, ...input }), attemptedAt: "2026-11-01T12:00:01Z", finishedAt: "2026-11-01T12:00:05Z" });
  return { found, calls: fake.calls };
};
const record = (over = {}) => ({ status: 200, body: { uri: URI, cid: "bafyrei", value: { $type: "app.bsky.feed.post", text: "A new post is up.", createdAt: "2026-11-01T12:00:00.000Z", embed: { $type: "app.bsky.embed.external", external: { uri: "https://blog.example.com/posts/hello/", title: "x", description: "" } }, ...over } } });

test("reconcile asks for exactly this announcement's record, read-only", async () => {
  const { found, calls } = await reconcile(record());
  assert.deepEqual(found, { state: "published", providerPostId: URI });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].method, "GET");
  const url = new URL(calls[0].url);
  assert.equal(url.origin + url.pathname, "https://bsky.social/xrpc/com.atproto.repo.getRecord");
  assert.deepEqual(Object.fromEntries(url.searchParams), { repo: DID, collection: "app.bsky.feed.post", rkey: RKEY });
  assert.equal(calls[0].body, undefined);
});

test("reconcile: not found is a conclusive absence; anything that is not exactly the announcement is unknown", async () => {
  assert.deepEqual((await reconcile({ status: 400, body: { error: "RecordNotFound", message: "Could not locate record" } })).found, { state: "absent", conclusive: true });
  for (const reply of [
    record({ text: "Edited elsewhere" }),
    record({ embed: { $type: "app.bsky.embed.external", external: { uri: "https://elsewhere.example/" } } }),
    record({ $type: "app.bsky.feed.like" }),
    { status: 200, body: { uri: `at://${DID}/app.bsky.feed.post/3mzzzzzzzzzzz`, value: record().body.value } },
    { status: 400, body: { error: "InvalidRequest" } },
    { status: 401, body: { error: "ExpiredToken" } },
    { status: 500 },
    { status: 200, body: "<html>" },
    new TypeError("fetch failed"),
  ]) {
    assert.deepEqual((await reconcile(reply)).found, { state: "unknown" });
  }
  // A post it cannot plan is unknown, never a guess, and no call is made.
  const bad = await reconcile(record(), { account: { externalId: "nope" } });
  assert.deepEqual(bad.found, { state: "unknown" });
  assert.equal(bad.calls.length, 0);
});
