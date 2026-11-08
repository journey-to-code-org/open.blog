// The Bluesky adapter (epic #382, story #391, task DIST2.1.2, ADR 0358): the post record it writes
// (text, facets in UTF-8 byte offsets, the link card), the record key that ties every attempt of an
// announcement to one record, the at:// URI it captures, and the read-only lookup by that key.
// Scripted service only; no real network.
import test from "node:test";
import assert from "node:assert/strict";
import { socialAdapters } from "../../netlify/lib/social-adapters.mjs";
import { announcementKey, cardTitle, facetsFor, graphemes, tid, TID, withinPostLimits } from "../../netlify/lib/social-atproto.mjs";
import { allProviders, call, isDelivery, scripted, settle } from "./social-publish-fakes.mjs";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const DID = "did:plc:abcdefghijklmnopqrstuvwx";
const RKEY = "3mzar4gvw36e6";
const URI = `at://${DID}/app.bsky.feed.post/${RKEY}`;
const TOKEN = "eyJhbGciOiJFUzI1NksifQ.eyJleHAiOjF9.c2ln";
const created = { status: 200, body: { uri: URI, cid: "bafyreib2rxk3rh6kzwq" } };

const adapter = (fetchImpl) => socialAdapters({ providers: allProviders(), fetchImpl, now: () => NOW }).bluesky;
const publish = async (reply, input = {}) => {
  const fake = scripted(reply);
  const result = await settle(adapter(fake.fetchImpl).publish(call("bluesky", { accessToken: TOKEN, ...input })));
  return { ...result, calls: fake.calls, sent: fake.calls[0] ? JSON.parse(fake.calls[0].body) : null };
};
const bytes = (text, start, end) => Buffer.from(text, "utf8").subarray(start, end).toString("utf8");

test("the post: caption as text, the canonical post as a link card, the record key of the announcement, one createRecord", async () => {
  const { value, calls, sent } = await publish(created);
  assert.deepEqual(value, { providerPostId: URI });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, "https://bsky.social/xrpc/com.atproto.repo.createRecord");
  assert.equal(calls[0].method, "POST");
  assert.equal(calls[0].headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(calls[0].redirect, "manual");
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
  assert.ok(!calls[0].body.includes("idem-key-0001"), "the idempotency key itself is never sent");
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
