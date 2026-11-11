// The Mastodon adapter (epic #382, story #392, task DIST2.2.2, ADR 0360): the status it posts (the
// caption, the link, the visibility, an Idempotency-Key of the announcement), the instance limits it
// checks before any write, the cover image it attaches only with its description, the status id it
// captures and the read-only lookup of an uncertain attempt. Scripted instance only; no real network.
import test from "node:test";
import assert from "node:assert/strict";
import { socialAdapters } from "../../netlify/lib/social-adapters.mjs";
import { coverOf, holdsLink, idempotencyHeader, instanceLimits, metaTags, rateLimitWaitMs, statusLength, statusText } from "../../netlify/lib/social-mastodon.mjs";
import { call, isDelivery, providers, scripted, settle } from "./social-publish-fakes.mjs";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const INSTANCE = "https://social.example.org";
export const MASTODON = { OPENBLOG_SOCIAL_MASTODON_CLIENT_ID: "md-client-id", OPENBLOG_SOCIAL_MASTODON_CLIENT_SECRET: "mastodon-client-secret-0003", OPENBLOG_SOCIAL_MASTODON_INSTANCE: INSTANCE };
const COVER_ON = { ...MASTODON, OPENBLOG_SOCIAL_MASTODON_MEDIA: "cover", OPENBLOG_SOCIAL_PROVIDER_TIMEOUT_SECONDS: "15", OPENBLOG_SOCIAL_WORKER_BUDGET_SECONDS: "20" };
const TOKEN = "mastodon-access-token-0001";
const ACCOUNT = { provider: "mastodon", kind: "account", externalId: "109876543210", displayName: "@ada@social.example.org" };
const TEXT = "A new post is up.\n\nhttps://blog.example.com/posts/hello/";
const STATUS_ID = "113456789012345678";
const posted = { status: 200, body: { id: STATUS_ID, account: { id: ACCOUNT.externalId }, content: "<p>A new post is up.</p>" } };
const instance = (statuses = {}, media = {}) => ({ status: 200, body: { configuration: { statuses: { max_characters: 500, characters_reserved_per_url: 23, ...statuses }, media_attachments: { supported_mime_types: ["image/jpeg", "image/png"], image_size_limit: 16777216, description_limit: 1500, ...media } } } });
const PAGE = `<!doctype html><html><head><meta property="og:image" content="https://blog.example.com/images/cover.png">
<meta property="og:image:alt" content="A lantern on a quay at dusk, &quot;lit&quot; &amp; glowing"></head><body></body></html>`;
const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4]);

const adapterFor = (env, fetchImpl) => socialAdapters({ providers: providers(env), fetchImpl, now: () => NOW }).mastodon;
const route = (handlers) => (n, url, init) => {
  const parsed = new URL(url);
  const key = `${init.method || "GET"} ${parsed.origin}${parsed.pathname}`;
  const reply = handlers[key];
  if (!reply) return { status: 599, body: "unscripted" };
  return typeof reply === "function" ? reply(n, url, init) : reply;
};
const run = async (handlers, { env = MASTODON, input = {}, method = "publish" } = {}) => {
  const fake = scripted(route({ [`GET ${INSTANCE}/api/v2/instance`]: instance(), ...handlers }));
  const adapter = adapterFor(env, fake.fetchImpl);
  const base = call("mastodon", { accessToken: TOKEN, account: ACCOUNT, ...input });
  base.account = { ...ACCOUNT, ...(input.account || {}) };
  const result = await settle(adapter[method]({ ...base, ...(input.extra || {}) }));
  const status = fake.calls.find((c) => c.url === `${INSTANCE}/api/v1/statuses`);
  return { ...result, calls: fake.calls, status, form: status ? Object.fromEntries(new URLSearchParams(status.body)) : null };
};

test("the status: caption, a blank line and the link, public by default, one write with an Idempotency-Key of the announcement", async () => {
  const { value, calls, status, form } = await run({ [`POST ${INSTANCE}/api/v1/statuses`]: posted });
  assert.deepEqual(value, { providerPostId: STATUS_ID });
  assert.deepEqual(form, { status: TEXT, visibility: "public" });
  assert.equal(status.method, "POST");
  assert.equal(status.redirect, "manual");
  assert.equal(status.headers.authorization, `Bearer ${TOKEN}`);
  assert.equal(status.headers["content-type"], "application/x-www-form-urlencoded");
  assert.equal(status.headers["idempotency-key"], await idempotencyHeader("idem-key-0001"));
  assert.match(status.headers["idempotency-key"], /^openblog-[0-9a-f]{48}$/);
  assert.ok(!JSON.stringify(calls).includes("idem-key-0001"), "the idempotency key itself is never sent");
  const read = calls.find((c) => c.url === `${INSTANCE}/api/v2/instance`);
  assert.equal(read.headers.authorization, undefined, "the instance's limits are read without the token");
  assert.equal(calls.filter((c) => c.method === "POST").length, 1);
});

test("the same announcement always sends the same key, and another announcement another", async () => {
  assert.equal(await idempotencyHeader("idem-key-0001"), await idempotencyHeader("idem-key-0001"));
  assert.notEqual(await idempotencyHeader("idem-key-0001"), await idempotencyHeader("idem-key-0002"));
  assert.equal(await idempotencyHeader(""), null);
});

test("visibility is the deployer's, and a caption that already holds the link is not given it twice", async () => {
  const { form } = await run({ [`POST ${INSTANCE}/api/v1/statuses`]: posted }, { env: { ...MASTODON, OPENBLOG_SOCIAL_MASTODON_VISIBILITY: "private" } });
  assert.equal(form.visibility, "private");
  const caption = "Read https://blog.example.com/posts/hello/ today #rust @friend@example.social";
  const again = await run({ [`POST ${INSTANCE}/api/v1/statuses`]: posted }, { input: { post: { caption } } });
  assert.equal(again.form.status, caption);
  assert.equal(statusText("See https://blog.example.com/posts/hello/x", "https://blog.example.com/posts/hello/"), "See https://blog.example.com/posts/hello/x\n\nhttps://blog.example.com/posts/hello/");
});

test("a link already in the caption is not added again when brackets or a full stop sit around it (ADR 0386)", () => {
  const url = "https://blog.example.org/posts/soup/";
  for (const caption of [`Soup (${url})`, `New soup: ${url}.`, `Soup, ${url}, and bread`, `[${url}]`, `Is it ${url}?`, `See ${url}!\nMore soon`]) {
    assert.equal(statusText(caption, url), caption, caption);
    assert.ok(holdsLink(caption, url));
  }
  // A longer link, or a shorter one, is not the post's link.
  for (const caption of [`See ${url}x`, `See ${url}more.`, "See https://blog.example.org/posts/soup"]) assert.equal(statusText(caption, url), `${caption}\n\n${url}`, caption);
  // A bracket the link opened itself is part of it.
  assert.equal(statusText("Read (https://en.wikipedia.org/wiki/Bread_(food))", "https://en.wikipedia.org/wiki/Bread_(food)"), "Read (https://en.wikipedia.org/wiki/Bread_(food))");
  // The punctuation after a link is counted as text, the link as 23.
  assert.equal(statusLength(`Soup (${url}).`), "Soup ().".length + 23);
});

test("length is counted as Mastodon counts it, and a status over the instance's limit is refused without a write", async () => {
  assert.equal(statusLength(TEXT), "A new post is up.\n\n".length + 23);
  assert.equal(statusLength("x https://a.example/" + "y".repeat(100), 23), 2 + 23);
  const long = "a".repeat(475);
  const ok = await run({ [`POST ${INSTANCE}/api/v1/statuses`]: posted }, { input: { post: { caption: long } } });
  assert.deepEqual(ok.value, { providerPostId: STATUS_ID }, "475 characters, a blank line and a link are exactly 500");
  const small = await run({ [`GET ${INSTANCE}/api/v2/instance`]: instance({ max_characters: 280 }) }, { input: { post: { caption: "b".repeat(300) } } });
  assert.ok(isDelivery(small.error, "rejected"));
  assert.equal(small.status, undefined, "nothing is posted");
  const big = await run({ [`GET ${INSTANCE}/api/v2/instance`]: instance({ max_characters: 5000 }), [`POST ${INSTANCE}/api/v1/statuses`]: posted }, { input: { post: { caption: "c".repeat(476) } } });
  assert.ok(isDelivery(big.error, "rejected"), "the model's own limit holds whatever the instance takes");
  const silent = await run({ [`GET ${INSTANCE}/api/v2/instance`]: { status: 503, body: {} }, [`POST ${INSTANCE}/api/v1/statuses`]: posted });
  assert.deepEqual(silent.value, { providerPostId: STATUS_ID }, "an instance that does not say is held to Mastodon's defaults");
  assert.deepEqual(instanceLimits({ configuration: { statuses: { max_characters: -1, characters_reserved_per_url: "23" } } }), { maxCharacters: 500, charactersPerUrl: 23, descriptionLimit: 1500, imageSizeLimit: 16777216, mimeTypes: null });
});

test("only a status of this account, named with an id, is a success; Mastodon's answers map to the delivery kinds", async () => {
  for (const [reply, kind] of [
    [{ status: 200, body: { id: STATUS_ID, account: { id: "999" } } }, "uncertain"],
    [{ status: 200, body: { id: "../x", account: { id: ACCOUNT.externalId } } }, "uncertain"],
    [{ status: 200, body: "not json" }, "uncertain"],
    [{ status: 202, body: {} }, "uncertain"],
    [{ status: 500, body: {} }, "uncertain"],
    [{ status: 302, headers: { location: "https://evil.example" }, body: "" }, "uncertain"],
    [{ status: 401, body: { error: "The access token is invalid" } }, "auth"],
    [{ status: 422, body: { error: "Validation failed: Text character limit of 500 exceeded" } }, "rejected"],
    [{ status: 403, body: { error: "This action is outside the authorized scopes" } }, "rejected"],
    [{ status: 404, body: {} }, "rejected"],
  ]) {
    const { error } = await run({ [`POST ${INSTANCE}/api/v1/statuses`]: reply });
    assert.ok(isDelivery(error, kind), `${reply.status} -> ${kind}, got ${error?.kind}`);
    assert.ok(!String(error.message).includes("Validation") && !String(error.message).includes("token is invalid"), "Mastodon's text is never repeated");
  }
});

test("a rate limit waits for Retry-After, or else for X-RateLimit-Reset", async () => {
  const hinted = await run({ [`POST ${INSTANCE}/api/v1/statuses`]: { status: 429, headers: { "retry-after": "120" }, body: {} } });
  assert.ok(isDelivery(hinted.error, "rate-limited"));
  assert.equal(hinted.error.retryAfterMs, 120_000);
  const reset = await run({ [`POST ${INSTANCE}/api/v1/statuses`]: { status: 429, headers: { "x-ratelimit-reset": "2026-11-01T12:05:00.000Z", "x-ratelimit-remaining": "0" }, body: {} } });
  assert.equal(reset.error.retryAfterMs, 300_000);
  assert.equal(rateLimitWaitMs(null, "soon", NOW), null);
  assert.equal(rateLimitWaitMs(null, "2026-11-01T11:00:00Z", NOW), 0);
});

test("checks before any request: the account id and kind, the token, the caption and the link", async () => {
  for (const input of [{ account: { externalId: "../../admin" } }, { account: { kind: "page" } }, { post: { canonicalUrl: "http://blog.example.com/x" } }, { post: { caption: "" } }, { post: { caption: "z".repeat(476) } }, { post: { idempotencyKey: "" } }]) {
    const { error, calls } = await run({}, { input });
    assert.ok(isDelivery(error, "rejected"), JSON.stringify(input));
    assert.equal(calls.filter((c) => c.method === "POST").length, 0);
  }
  const { error } = await run({}, { input: { accessToken: "" } });
  assert.ok(isDelivery(error, "auth"));
});

// ---- the cover image (OPENBLOG_SOCIAL_MASTODON_MEDIA=cover)

const coverHandlers = (over = {}) => ({
  "GET https://blog.example.com/posts/hello/": { status: 200, headers: { "content-type": "text/html; charset=utf-8" }, body: PAGE },
  "GET https://blog.example.com/images/cover.png": { status: 200, headers: { "content-type": "image/png" }, body: PNG },
  [`POST ${INSTANCE}/api/v2/media`]: { status: 200, body: { id: "77", type: "image", description: "A lantern" } },
  [`POST ${INSTANCE}/api/v1/statuses`]: posted,
  ...over,
});

test("the cover is uploaded with its description and attached; the blog is read without the token", async () => {
  const { value, calls, form } = await run(coverHandlers(), { env: COVER_ON });
  assert.deepEqual(value, { providerPostId: STATUS_ID });
  const upload = calls.find((c) => c.url === `${INSTANCE}/api/v2/media`);
  assert.ok(upload.body instanceof FormData);
  assert.equal(upload.body.get("description"), 'A lantern on a quay at dusk, "lit" & glowing');
  const file = upload.body.get("file");
  assert.equal(file.type, "image/png");
  assert.deepEqual(new Uint8Array(await file.arrayBuffer()), PNG);
  assert.equal(form["media_ids[]"], "77");
  for (const read of calls.filter((c) => c.url.startsWith("https://blog.example.com/"))) assert.equal(read.headers.authorization, undefined, "the token never goes to the blog");
});

test("a cover still processing is looked at again and attached once ready", async () => {
  let polls = 0;
  const { form } = await run(
    coverHandlers({
      [`POST ${INSTANCE}/api/v2/media`]: { status: 202, body: { id: "78", url: null } },
      [`GET ${INSTANCE}/api/v1/media/78`]: () => (++polls === 1 ? { status: 206, body: {} } : { status: 200, body: { id: "78" } }),
    }),
    { env: COVER_ON },
  );
  assert.equal(form["media_ids[]"], "78");
  assert.equal(polls, 2);
});

test("without a description, off the blog's origin, too large, of another type or refused, the cover is left out and the status still goes", async () => {
  const cases = [
    { "GET https://blog.example.com/posts/hello/": { status: 200, headers: { "content-type": "text/html" }, body: PAGE.replace(/<meta property="og:image:alt"[^>]*>/, "") } },
    { "GET https://blog.example.com/posts/hello/": { status: 200, headers: { "content-type": "text/html" }, body: PAGE.replace("https://blog.example.com/images/cover.png", "https://cdn.evil.example/cover.png") } },
    { "GET https://blog.example.com/posts/hello/": { status: 404, body: "" } },
    { "GET https://blog.example.com/images/cover.png": { status: 200, headers: { "content-type": "image/svg+xml" }, body: "<svg/>" } },
    { "GET https://blog.example.com/images/cover.png": { status: 200, headers: { "content-type": "image/png", "content-length": String(9 * 1024 * 1024) }, body: PNG } },
    { [`POST ${INSTANCE}/api/v2/media`]: { status: 422, body: {} } },
    { [`POST ${INSTANCE}/api/v2/media`]: { status: 429, body: {} } },
    { [`POST ${INSTANCE}/api/v2/media`]: { status: 202, body: { id: "79" } }, [`GET ${INSTANCE}/api/v1/media/79`]: { status: 206, body: {} } },
  ];
  for (const over of cases) {
    const { value, form, calls } = await run(coverHandlers(over), { env: COVER_ON });
    assert.deepEqual(value, { providerPostId: STATUS_ID }, JSON.stringify(Object.keys(over)));
    assert.equal(form["media_ids[]"], undefined, JSON.stringify(Object.keys(over)));
    assert.ok(!calls.some((c) => c.url.startsWith("https://cdn.evil.example")), "nothing off the blog's origin is fetched");
  }
  const refused = await run(coverHandlers({ [`POST ${INSTANCE}/api/v2/media`]: { status: 401, body: {} } }), { env: COVER_ON });
  assert.ok(isDelivery(refused.error, "auth"), "a refused token on the upload flags the account");
  assert.equal(refused.status, undefined);
  const off = await run(coverHandlers(), { env: MASTODON });
  assert.ok(!off.calls.some((c) => c.url.startsWith("https://blog.example.com/")), "with the cover off the blog is not read");
});

test("the cover is read from og:image and og:image:alt, decoded and bounded", () => {
  const tags = metaTags(`<meta name="twitter:image:alt" content="x"><meta content='https://b.example/a.png' property='og:image'><meta property="og:image:alt" content="Caf&#233; &#x2014; dusk">`);
  assert.equal(tags.get("og:image"), "https://b.example/a.png");
  assert.equal(tags.get("og:image:alt"), "Café — dusk");
  assert.deepEqual(coverOf(PAGE, "https://blog.example.com/posts/hello/"), { url: "https://blog.example.com/images/cover.png", description: 'A lantern on a quay at dusk, "lit" & glowing' });
  assert.deepEqual(coverOf(PAGE.replace("https://blog.example.com/images/cover.png", "/images/c.png"), "https://blog.example.com/posts/hello/"), { url: "https://blog.example.com/images/c.png", description: 'A lantern on a quay at dusk, "lit" & glowing' });
  assert.equal(coverOf(PAGE, "https://blog.example.com/posts/hello/", 10), null, "a description over the instance's limit is not cut short");
  assert.equal(coverOf(PAGE.replace("https://blog.example.com/images/cover.png", "http://blog.example.com/c.png"), "https://blog.example.com/posts/hello/"), null);
  assert.equal(coverOf(PAGE.replace("dusk", "dusk‮"), "https://blog.example.com/posts/hello/"), null);
});

// ---- reconcile

const statusesUrl = `GET ${INSTANCE}/api/v1/accounts/${ACCOUNT.externalId}/statuses`;
const at = (offsetSeconds) => new Date(Date.parse("2026-11-01T12:00:00Z") + offsetSeconds * 1000).toISOString();
const listed = (...items) => ({ status: 200, body: items.map(([id, offset]) => ({ id, created_at: at(offset), content: "<p>html</p>" })) });
const source = (texts) => (n, url) => {
  const id = url.split("/").at(-2);
  return Object.hasOwn(texts, id) ? { status: 200, body: { id, text: texts[id], spoiler_text: "" } } : { status: 404, body: {} };
};
const reconcile = (handlers, extra = {}) => run(handlers, { method: "reconcile", input: { extra: { attemptedAt: at(0), finishedAt: at(4), ...extra } } });
const sources = (texts) => Object.fromEntries(Object.keys(texts).map((id) => [`GET ${INSTANCE}/api/v1/statuses/${id}/source`, source(texts)]));

test("reconcile: the one status in the window whose text is this announcement's is published", async () => {
  const { value, calls } = await reconcile({ [statusesUrl]: listed(["300", 3], ["200", -4000]), ...sources({ 300: TEXT }) });
  assert.deepEqual(value, { state: "published", providerPostId: "300" });
  const list = calls.find((c) => c.url.includes("/statuses?"));
  assert.equal(new URL(list.url).searchParams.get("limit"), "40");
  assert.equal(new URL(list.url).searchParams.get("exclude_reblogs"), "true");
  assert.equal(list.headers.authorization, `Bearer ${TOKEN}`);
  assert.ok(!calls.some((c) => c.method !== "GET"), "reconcile never writes");
});

test("reconcile: absent only when the window holds no status at all and the page reaches back past it", async () => {
  assert.deepEqual((await reconcile({ [statusesUrl]: listed(["200", -4000]) })).value, { state: "absent", conclusive: true });
  assert.deepEqual((await reconcile({ [statusesUrl]: listed() })).value, { state: "absent", conclusive: true });
  const full = listed(...Array.from({ length: 40 }, (_, i) => [String(1000 + i), 3600 + i]));
  assert.deepEqual((await reconcile({ [statusesUrl]: full })).value, { state: "unknown" }, "a full page that does not reach the window says nothing");
});

test("reconcile: a differing status, two matches, too many, a missing permission or a bad reply is unknown", async () => {
  for (const handlers of [
    { [statusesUrl]: listed(["300", 3]), ...sources({ 300: "Edited on Mastodon" }) },
    { [statusesUrl]: listed(["300", 3], ["301", 5]), ...sources({ 300: TEXT, 301: TEXT }) },
    { [statusesUrl]: listed(...Array.from({ length: 6 }, (_, i) => [String(300 + i), i])), ...sources({ 300: TEXT }) },
    { [statusesUrl]: listed(["300", 3]) },
    { [statusesUrl]: { status: 403, body: { error: "This action is outside the authorized scopes" } } },
    { [statusesUrl]: { status: 200, body: { not: "a list" } } },
    { [statusesUrl]: { status: 200, body: [{ id: "x y", created_at: at(0) }] } },
  ]) {
    assert.deepEqual((await reconcile(handlers)).value, { state: "unknown" });
  }
  assert.deepEqual((await reconcile({}, { attemptedAt: null })).value, { state: "unknown" });
});

test("reconcile: an attempt with no recorded end is looked at for fifteen minutes", async () => {
  const late = await reconcile({ [statusesUrl]: listed(["300", 800]), ...sources({ 300: TEXT }) }, { finishedAt: null });
  assert.deepEqual(late.value, { state: "published", providerPostId: "300" });
  const tooLate = await reconcile({ [statusesUrl]: listed(["300", 800]), ...sources({ 300: TEXT }) });
  assert.deepEqual(tooLate.value, { state: "absent", conclusive: true }, "outside a finished attempt's window it is not this attempt");
});
