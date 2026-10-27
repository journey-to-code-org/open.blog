// Suggestions for future work through the one hosted engagement function (#227, ADRs 0190 to 0195),
// exercised through HTTP-shaped events with a fake Supabase and site: a suggestion always enters
// pending as one feedback row for the page it was sent from, with no passage and a private receipt;
// the shared contract's refusals; quotas, replays, the opt-in and the site's mode; the reader's
// receipt, which never says an accepted suggestion is published; reports, which treat one like an id
// that does not exist; the editors' inbox; retention of a kept suggestion's private contact and
// unpublished name; and the additive, loosening SQL with its rollback.
import test from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createHandler } from "../../netlify/functions/engagement.mjs";
import { isPublishable } from "../../netlify/lib/participation-moderation.mjs";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const fixture = JSON.parse(read("../fixtures/future-suggestion-submissions.json"));
const feedbackSql = read("../../supabase/feedback.sql");
const rollback = read("../../supabase/future-suggestions-rollback.sql");

const environment = {
  SUPABASE_URL: "https://database.example",
  SUPABASE_SECRET_KEY: "sb_secret_test_server_only",
  OPENBLOG_SITE_ID: "lantern",
  OPENBLOG_SITE_ORIGIN: "https://blog.example",
  OPENBLOG_ADMIN_API_KEY: "admin-secret",
  OPENBLOG_ANALYTICS_SALT: "daily-hash-secret",
  OPENBLOG_FEEDBACK_ENABLED: "true",
  OPENBLOG_MODERATION_ENABLED: "true",
  OPENBLOG_PROTECTION_ENABLED: "true",
  OPENBLOG_SUGGESTIONS_ENABLED: "true",
};
const NOW = new Date("2026-10-26T10:00:00.000Z");
const ORIGIN = { origin: "https://blog.example" };
const ADMIN = { authorization: "Bearer admin-secret" };
const ID = (n) => `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const RECEIPT = "S".repeat(43);
const digest = (receipt) => createHash("sha256").update(receipt).digest("hex");
const WORK = "/posts/tides/";

const event = (path, method, { query = {}, body, headers = {} } = {}) => ({
  path: `/api/${path}`,
  httpMethod: method,
  headers: { "x-nf-client-connection-ip": "203.0.113.9", ...headers },
  queryStringParameters: query,
  body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
});
const send = (database, body, { query = { work: WORK }, ...options } = {}) => handlerFor(database, options)(event("feedback", "POST", { headers: ORIGIN, query, body }));

const request = (overrides = {}) => ({ version: 1, kind: "future-suggestion", type: "text", text: "Her letters from the 1850 survey would help with the tide tables.", ...overrides });

const fakeDatabase = (answer = () => []) => {
  const requests = [];
  const fetchImpl = async (url, options = {}) => {
    const parsed = new URL(url);
    const entry = { path: parsed.pathname, params: Object.fromEntries(parsed.searchParams), method: options.method || "GET", body: options.body ? JSON.parse(options.body) : undefined };
    requests.push(entry);
    const value = await answer(entry);
    if (entry.path.endsWith("/rpc/openblog_consume_rate_limit")) return { ok: true, status: 200, json: async () => (value && typeof value === "object" && "allowed" in value ? value : { allowed: true }) };
    if (value instanceof Error) return { ok: false, status: 500, json: async () => ({}) };
    return { ok: true, status: 200, json: async () => value };
  };
  return { requests, fetchImpl };
};
const site = (mode = "open") => async (url) => {
  if (url.endsWith("openblog-participation.json")) return { ok: true, status: 200, json: async () => ({ [WORK]: { "future-suggestion": mode, "abuse-report": "open", question: "open" } }) };
  return { ok: false, status: 404, json: async () => ({}) };
};
const handlerFor = (database, { env = environment, mode = "open", now = () => NOW } = {}) => createHandler({ env, fetchImpl: database.fetchImpl, siteFetchImpl: site(mode), now });
const writes = (database) => database.requests.filter((entry) => entry.method !== "GET" && !entry.path.endsWith("/rpc/openblog_consume_rate_limit"));
const inserted = (database) => writes(database).find((entry) => entry.method === "POST" && entry.path.endsWith("/openblog_feedback"));

// A stored suggestion row, as the table holds it.
const stored = (extra = {}) => ({
  id: ID(1), status: "pending", version: 1, moderated_at: null, moderation_reason: null, format_version: 1, kind: "future-suggestion",
  work: WORK, revision: null, target: null, body: "Her letters from the 1850 survey would help.",
  details: { type: "text", url: "https://example.org/letters", contact: { address: "ada@example.org", followUp: true } },
  seen_at: null, received_at: "2026-10-26T10:00:00+00:00", channel: "hosted", reader_name: "Ada", publish_name: false,
  item_revision: 1, approved_revision: null, clarification_asked: null, clarification_consent: false, purged_at: null, ...extra,
});

// ---- Submission

test("a suggestion enters pending as one feedback row for its page, with no passage and a private receipt", async () => {
  const database = fakeDatabase((entry) => (entry.method === "POST" && entry.path.endsWith("/openblog_feedback") ? [{ id: ID(7), status: "pending", received_at: "2026-10-26T10:00:00+00:00" }] : []));
  const response = await send(database, request({ url: "https://Example.org/letters", attribution: { name: "Ada", publishName: false }, contact: { address: "ada@example.org", followUp: true } }));
  assert.equal(response.statusCode, 202);
  const answer = JSON.parse(response.body);
  assert.equal(answer.status, "pending");
  assert.match(answer.receipt, /^[A-Za-z0-9_-]{43}$/);
  const row = inserted(database).body;
  assert.equal(row.status, "pending", "never anything but pending");
  assert.equal(row.kind, "future-suggestion");
  assert.equal(row.work, WORK);
  assert.equal(row.revision, null);
  assert.equal(row.target, null);
  assert.equal(row.body, request().text);
  assert.deepEqual(row.details, { type: "text", url: "https://example.org/letters", contact: { address: "ada@example.org", followUp: true } });
  assert.equal(row.reader_name, "Ada");
  assert.equal(row.publish_name, false);
  assert.equal(row.receipt_hash, digest(answer.receipt), "only the receipt's digest is kept");
  assert.equal(row.channel, "hosted");
  assert.equal(row.received_at, "2026-10-26T10:00:00Z", "the receiver's clock");
  for (const field of ["rank", "rating", "score", "vote", "approved_revision", "email"]) assert.ok(!(field in row), `no ${field} is collected`);
  assert.doesNotMatch(JSON.stringify(row), new RegExp(answer.receipt), "the receipt itself is never stored");
  // Nothing is fetched on the reader's behalf: only the database and the site's own manifest are called.
  assert.ok(database.requests.every((entry) => entry.path.startsWith("/rest/v1/")));
});

test("what the shared contract refuses is refused with its code, names no field's text and stores nothing", async () => {
  const refusals = fixture.cases.filter((entry) => entry.expect.code && entry.request?.kind === "future-suggestion" && entry.expect.code !== "tooLarge");
  assert.ok(refusals.length > 80);
  for (const entry of refusals) {
    const database = fakeDatabase();
    const response = await send(database, entry.request);
    assert.equal(response.statusCode, 422, entry.name);
    const answer = JSON.parse(response.body);
    assert.equal(answer.code, entry.expect.code, entry.name);
    assert.doesNotMatch(answer.error, /1850|Surveyor|ada@example/, "the message never repeats what was written");
    assert.equal(writes(database).length, 0, `${entry.name}: nothing is stored`);
  }
  const database = fakeDatabase();
  const tooLarge = await send(database, request({ text: "a".repeat(40_000) }));
  assert.equal(tooLarge.statusCode, 413);
  assert.equal(JSON.parse(tooLarge.body).code, "tooLarge");
  assert.equal((await send(database, '{"kind":"future-suggestion",')).statusCode, 422);
  assert.equal(writes(database).length, 0);
});

test("unsafe links are refused by the one shared rule before anything is stored", async () => {
  for (const url of ["http://127.0.0.1/", "http://[::127.0.0.1]/", "http://[2002:7f00:1::]/", "http://[64:ff9b::7f00:1]/", "http://[fec0::1]/", "http://localhost.localdomain/", "http://x.home/", "http://x.test/", "http://x.corp/", "http://198.18.0.1/", "https://example.org/?access_token=1", "javascript:alert(1)", "https://u:p@example.org/"]) {
    const database = fakeDatabase();
    const response = await send(database, request({ url }));
    assert.equal(response.statusCode, 422, url);
    assert.equal(JSON.parse(response.body).code, "invalidUrl", url);
    assert.equal(writes(database).length, 0);
  }
});

test("hostile text is kept as plain text and never answered as markup", async () => {
  const database = fakeDatabase((entry) => (entry.method === "POST" && entry.path.endsWith("/openblog_feedback") ? [{ id: ID(7) }] : []));
  const text = "<script>alert(1)</script> <img src=x onerror=alert(2)> &amp; \"quoted\"";
  const response = await send(database, request({ text, attribution: { name: "<b>Ada</b>", publishName: false } }));
  assert.equal(response.statusCode, 202);
  assert.equal(response.headers["Content-Type"], "application/json; charset=utf-8");
  assert.equal(inserted(database).body.body, text, "stored exactly as written; pages escape it");
  assert.equal(inserted(database).body.reader_name, "<b>Ada</b>");
});

test("a largest accepted suggestion is stored in a row the table accepts and reads back", async () => {
  const largest = fixture.cases.find((entry) => entry.name === "text and link at their limits");
  const database = fakeDatabase((entry) => (entry.method === "POST" && entry.path.endsWith("/openblog_feedback") ? [{ id: ID(7) }] : []));
  const response = await send(database, largest.request);
  assert.equal(response.statusCode, 202);
  const row = inserted(database).body;
  assert.ok(Buffer.byteLength(JSON.stringify(row.details)) <= 16 * 1024, "details fit the table's own check");
  assert.ok(row.body.length <= 20_000);
  // Four-byte characters at every limit are refused up front, never stored and then unreadable.
  const wide = fixture.cases.find((entry) => entry.name === "four-byte characters up to the submission bound");
  assert.equal((await send(fakeDatabase(), wide.request)).statusCode, 413);
});

test("the page is the request's work, one the site publishes with the kind open", async () => {
  for (const query of [{}, { work: "posts/tides" }, { work: "/posts/../tides/" }, { work: `${WORK}?x=1` }, { work: "//evil.example/" }]) {
    const database = fakeDatabase();
    const response = await send(database, request(), { query });
    assert.equal(response.statusCode, 422);
    assert.equal(JSON.parse(response.body).code, "invalidWork");
    assert.equal(writes(database).length, 0);
  }
  const unknown = fakeDatabase();
  const missing = await send(unknown, request(), { query: { work: "/posts/not-published/" } });
  assert.equal(missing.statusCode, 403, "a page the site does not publish with the kind open takes nothing");
  assert.equal(writes(unknown).length, 0);
});

test("rate limits, duplicates within the hour and a failing store each answer without losing the reader's claim", async () => {
  const limited = fakeDatabase((entry) => (entry.path.endsWith("/rpc/openblog_consume_rate_limit") ? { allowed: false } : []));
  const tooMany = await send(limited, request());
  assert.equal(tooMany.statusCode, 429);
  assert.equal(JSON.parse(tooMany.body).code, "rateLimited");
  assert.equal(limited.requests.find((entry) => entry.path.endsWith("/rpc/openblog_consume_rate_limit")).body.p_bucket, "suggestions", "its own quota, not passage feedback's");
  assert.equal(inserted(limited), undefined);

  let calls = 0;
  const repeated = fakeDatabase((entry) => {
    if (entry.path.endsWith("/rpc/openblog_consume_rate_limit")) return { allowed: entry.body.p_bucket !== "suggestions-repeat" || (calls += 1) === 1 };
    return entry.method === "POST" ? [{ id: ID(7) }] : [];
  });
  assert.equal((await send(repeated, request())).statusCode, 202);
  const again = await send(repeated, request());
  assert.equal(again.statusCode, 409);
  assert.equal(JSON.parse(again.body).code, "duplicate", "a double submit is told it was already sent");

  const failing = fakeDatabase((entry) => (entry.method === "POST" && entry.path.endsWith("/openblog_feedback") ? new Error("down") : []));
  const failed = await send(failing, request());
  assert.equal(failed.statusCode, 502);
  assert.ok(failing.requests.some((entry) => entry.method === "DELETE" && entry.path.endsWith("/openblog_rate_limits")), "the repeat claim is released, so a retry is taken");
});

test("the site's mode, the opt-in and the origin gate every suggestion", async () => {
  for (const [mode, status, code] of [["locked", 403, "closed"], ["hidden", 403, "unavailable"]]) {
    const database = fakeDatabase();
    const response = await send(database, request(), { mode });
    assert.equal(response.statusCode, status, mode);
    assert.equal(JSON.parse(response.body).code, code);
    assert.equal(inserted(database), undefined);
  }
  for (const env of [{ ...environment, OPENBLOG_SUGGESTIONS_ENABLED: "" }, { ...environment, OPENBLOG_PROTECTION_ENABLED: "" }, { ...environment, OPENBLOG_FEEDBACK_ENABLED: "" }]) {
    const database = fakeDatabase();
    const response = await send(database, request(), { env });
    assert.equal(response.statusCode, 404, "without receipts or the opt-in the reader gets the copy-and-send path");
    assert.equal(JSON.parse(response.body).code, "unavailable");
    assert.equal(database.requests.length, 0);
  }
  const database = fakeDatabase();
  const foreign = await handlerFor(database)(event("feedback", "POST", { headers: { origin: "https://evil.example" }, query: { work: WORK }, body: request() }));
  assert.equal(foreign.statusCode, 403);
  assert.equal(database.requests.length, 0);
});

test("a passage feedback submission is unchanged by the new kind", async () => {
  const database = fakeDatabase((entry) => (entry.method === "POST" && entry.path.endsWith("/openblog_feedback") ? [{ id: ID(7) }] : []));
  const question = {
    version: 1, kind: "question", work: WORK, revision: "p1:aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", target: { version: 1, kind: "work" }, body: "Why the tides?",
  };
  const response = await handlerFor(database)(event("feedback", "POST", { headers: ORIGIN, body: question }));
  assert.equal(response.statusCode, 202);
  assert.equal(inserted(database).body.kind, "question");
  assert.equal(inserted(database).body.work, WORK);
  assert.equal(inserted(database).body.revision, question.revision);
});

// ---- The reader's receipt

const receiptCall = (database, body, env = environment) => handlerFor(database, { env })(event("receipt", "POST", { headers: ORIGIN, body: { receipt: RECEIPT, ...body } }));

test("a receipt shows the reader their own suggestion and contact, and an accepted one is never called published", async () => {
  const read = async (extra) => {
    const database = fakeDatabase((entry) => (entry.method === "GET" && entry.path.endsWith("/openblog_feedback") ? [stored(extra)] : []));
    return JSON.parse((await receiptCall(database, { action: "read" })).body).item;
  };
  const pending = await read({});
  assert.equal(pending.kind, "future-suggestion");
  assert.equal(pending.body, stored().body);
  assert.equal(pending.details.contact.address, "ada@example.org", "the reader's own contact is theirs to see");
  assert.equal(pending.published, false);
  // Approved at its current text, which is "published" for a reflection, means only that the editors are interested.
  for (const approved of [{ status: "approved", approved_revision: 1 }, { status: "approved", approved_revision: 1, version: 5 }]) {
    assert.equal((await read(approved)).published, false, "an accepted suggestion is not published");
    assert.equal((await read(approved)).status, "approved");
  }
  assert.equal(isPublishable("future-suggestion"), false);
  assert.equal(isPublishable("abuse-report"), false);
  assert.equal(isPublishable("third-perspective"), true);
  assert.equal(isPublishable("nonsense"), false);
  // Every other kind keeps what it said.
  const question = fakeDatabase((entry) => (entry.method === "GET" && entry.path.endsWith("/openblog_feedback") ? [stored({ kind: "question", status: "approved", approved_revision: 1 })] : []));
  assert.equal(JSON.parse((await receiptCall(question, { action: "read" })).body).item.published, true);
});

test("a suggestion's clarification replaces the text and keeps the link, hints, page and contact", async () => {
  const asked = stored({ status: "clarification", clarification_asked: 1, moderation_reason: "unclear", version: 2, clarification_consent: true });
  const database = fakeDatabase((entry) => {
    if (entry.method === "GET") return [asked];
    if (entry.path.endsWith("/rpc/openblog_moderate_feedback_item")) return [{ ...asked, status: "pending", item_revision: 2, version: 3 }];
    return [];
  });
  const response = await receiptCall(database, { action: "clarify", expectedVersion: 2, body: "  What I meant.  ", details: { type: "video", contact: { address: "mallory@example.org", followUp: true } } });
  assert.equal(response.statusCode, 200);
  const call = writes(database).find((entry) => entry.path.endsWith("/rpc/openblog_moderate_feedback_item"));
  assert.equal(call.body.p_body, "What I meant.");
  assert.equal(call.body.p_actor_role, "submitter");
  assert.deepEqual(call.body.p_details, asked.details, "what the reader sends never replaces the stored details");
  const empty = fakeDatabase((entry) => (entry.method === "GET" ? [asked] : []));
  assert.equal(JSON.parse((await receiptCall(empty, { action: "clarify", expectedVersion: 2, body: "   " })).body).code, "invalidBody");
  assert.equal(JSON.parse((await receiptCall(empty, { action: "clarify", expectedVersion: 2, body: "x".repeat(2001) })).body).code, "invalidBody");
  assert.equal(writes(empty).length, 0);
});

test("a reader can always withdraw a suggestion and agree to be asked, with the opt-in off too", async () => {
  const off = { ...environment, OPENBLOG_SUGGESTIONS_ENABLED: "" };
  const database = fakeDatabase((entry) => {
    if (entry.method === "GET") return [stored({ status: "approved", approved_revision: 1, version: 2 })];
    if (entry.path.endsWith("/rpc/openblog_erase_feedback")) return [stored({ status: "withdrawn", version: 4, body: "-", details: {}, reader_name: null, publish_name: false, purged_at: "2026-10-26T10:00:00+00:00" })];
    return [];
  });
  const response = await receiptCall(database, { action: "withdraw", expectedVersion: 2 }, off);
  assert.equal(response.statusCode, 200);
  const call = writes(database).find((entry) => entry.path.endsWith("/rpc/openblog_erase_feedback"));
  assert.equal(call.body.p_withdraw, true);
  const { item } = JSON.parse(response.body);
  assert.equal(item.purged, true);
  assert.equal(item.body, undefined);
  const consent = fakeDatabase((entry) => (entry.method === "GET" ? [stored()] : entry.method === "PATCH" ? [stored({ clarification_consent: true, version: 1 })] : []));
  assert.equal((await receiptCall(consent, { action: "consent", consent: true, expectedVersion: 1 }, off)).statusCode, 200);
  assert.equal(writes(consent).find((entry) => entry.method === "PATCH").body.clarification_consent, true);
});

// ---- Reports

test("a report against an accepted suggestion gets the same answer as an id that does not exist", async () => {
  const report = (database) => handlerFor(database)(event("reports", "POST", { headers: ORIGIN, body: { source: "feedback", id: ID(1), ground: "abusive" } }));
  const accepted = fakeDatabase((entry) => (entry.method === "GET" && entry.path.endsWith("/openblog_feedback") ? [stored({ status: "approved", approved_revision: 1 })] : []));
  const missing = fakeDatabase(() => []);
  const [one, two] = [await report(accepted), await report(missing)];
  assert.equal(one.statusCode, 404);
  assert.equal(one.statusCode, two.statusCode);
  assert.deepEqual(JSON.parse(one.body), JSON.parse(two.body), "the same body, so the suggestion's existence does not leak");
  assert.equal(JSON.parse(one.body).code, "unavailable");
  assert.equal(writes(accepted).length, 0);
  // A public kind in the same state is still reportable.
  const question = fakeDatabase((entry) => (entry.method === "GET" && entry.path.endsWith("/openblog_feedback") ? [stored({ kind: "question", status: "approved", approved_revision: 1 })] : []));
  assert.equal((await report(question)).statusCode, 202);
});

// ---- The editors' inbox

test("the inbox lists suggestions as feedback items about a page with no passage, and moderates them by the one state machine", async () => {
  const database = fakeDatabase((entry) => (entry.path.endsWith("/openblog_feedback") ? [stored()] : []));
  const response = await handlerFor(database)(event("admin/moderation", "GET", { headers: ADMIN, query: { state: "pending", kind: "future-suggestion" } }));
  assert.equal(response.statusCode, 200);
  const page = JSON.parse(response.body);
  const [item] = page.items;
  assert.equal(item.feedback.kind, "future-suggestion");
  assert.equal(item.feedback.provenance.work, WORK);
  assert.equal(item.feedback.provenance.revision, null);
  assert.equal(item.feedback.provenance.target, null);
  assert.equal(item.feedback.details.type, "text");
  assert.equal(item.itemRevision, 1);
  assert.ok(!("decisions" in item), "a suggestion takes no correction decision");
  const query = database.requests.find((entry) => entry.path.endsWith("/openblog_feedback")).params;
  assert.match(query.and, /kind\.eq\.future-suggestion/);

  const decide = async (body) => {
    const row = stored();
    const writer = fakeDatabase((entry) => {
      if (entry.method === "GET") return [row];
      if (entry.path.endsWith("/rpc/openblog_moderate_feedback_item")) return [{ ...row, status: entry.body.p_to, version: 2, approved_revision: entry.body.p_to === "approved" ? 1 : null }];
      return [];
    });
    const answered = await handlerFor(writer)(event("admin/moderation", "PATCH", { headers: ADMIN, body: { source: "feedback", id: ID(1), from: "pending", expectedVersion: 1, actor: "mikey", ...body } }));
    return { answered, writer };
  };
  const approved = await decide({ action: "approve" });
  assert.equal(approved.answered.statusCode, 200);
  assert.equal(writes(approved.writer).find((entry) => entry.path.endsWith("/rpc/openblog_moderate_feedback_item")).body.p_to, "approved");
  const declined = await decide({ action: "reject", reason: "off-topic" });
  assert.equal(declined.answered.statusCode, 200);
  assert.equal((await decide({ action: "reject" })).answered.statusCode, 422, "a decline needs a reason");
});

test("a suggestion is never shown by any public route", async () => {
  const database = fakeDatabase((entry) => (entry.path.endsWith("/openblog_feedback") ? [stored({ status: "approved", approved_revision: 1 })] : []));
  for (const path of ["comments", "feedback", "views"]) {
    const response = await handlerFor(database)(event(path, "GET", { query: { path: WORK, work: WORK } }));
    assert.doesNotMatch(response.body, /letters|ada@example|1850/, path);
  }
});

test("a suggestion's contact reaches only its own receipt and the site Admin, by no other route", async () => {
  const row = stored({ status: "approved", approved_revision: 1 });
  const database = fakeDatabase((entry) => (entry.method === "GET" ? [row] : entry.path.includes("/rpc/") ? [row] : []));
  const leaks = (response, label) => assert.doesNotMatch(String(response.body), /ada@example|"contact"|followUp/, label);
  // The public routes, and the Admin routes without the key.
  for (const path of ["comments", "feedback", "views"]) leaks(await handlerFor(database)(event(path, "GET", { query: { path: WORK, work: WORK } })), path);
  for (const path of ["admin/feedback", "admin/moderation", "admin/retention", "admin/comments", "admin/analytics"]) {
    const response = await handlerFor(database)(event(path, "GET", { query: { state: "pending" } }));
    assert.equal(response.statusCode, 401, path);
    leaks(response, path);
  }
  // B5's own Admin view lists its own kinds only, and the generic change route never decides a suggestion.
  await handlerFor(database)(event("admin/feedback", "GET", { headers: ADMIN }));
  assert.match(database.requests.find((entry) => entry.path.endsWith("/openblog_feedback")).params.kind, /^in\.\(question,source-suggestion,correction-suggestion,alternative-interpretation\)$/);
  // The reader's own answers to a report, a submission and a withdrawal repeat nothing of it.
  leaks(await handlerFor(database)(event("reports", "POST", { headers: ORIGIN, body: { source: "feedback", id: ID(1), ground: "spam" } })), "reports");
  const submitted = fakeDatabase((entry) => (entry.method === "POST" && entry.path.endsWith("/openblog_feedback") ? [{ id: ID(7), status: "pending", received_at: "2026-10-26T10:00:00+00:00" }] : []));
  leaks(await send(submitted, request({ contact: { address: "ada@example.org", followUp: true } })), "submission");
  const withdrawn = await receiptCall(database, { action: "withdraw" });
  leaks(withdrawn, "withdraw");
  // The receipt, which proves the receipt secret, is the one place the reader sees it.
  assert.match((await receiptCall(database, { action: "read" })).body, /ada@example\.org/);
  assert.equal((await receiptCall(database, { action: "read" }, environment)).statusCode, 200);
  const wrong = await handlerFor(fakeDatabase(() => []))(event("receipt", "POST", { headers: ORIGIN, body: { receipt: "W".repeat(43), action: "read" } }));
  leaks(wrong, "a wrong receipt");
});

test("the generic Admin route never decides a suggestion; its decisions are the inbox's", async () => {
  const database = fakeDatabase((entry) => (entry.method === "GET" ? [stored()] : []));
  for (const body of [{ action: "approve" }, { action: "reject", reason: "spam" }]) {
    const refused = await handlerFor(database)(event("admin/feedback", "PATCH", { headers: ADMIN, body: { id: ID(1), from: "pending", expectedVersion: 1, ...body } }));
    assert.equal(refused.statusCode, 409);
    assert.equal(JSON.parse(refused.body).code, "useModerationInbox");
  }
  assert.equal(writes(database).length, 0);
});

// ---- Retention of a kept suggestion's private identity

const cutoffs = { pendingUntil: "2026-07-29T10:00:00Z", clarificationUntil: "2026-09-27T10:00:00Z", closedUntil: "2026-09-27T10:00:00Z", auditUntil: "2025-10-27T10:00:00Z" };
const protectedNow = new Date("2026-10-27T10:00:00.000Z");

test("a retention run lists and clears only suggestions that still hold a contact or an unpublished name", async () => {
  const held = stored({ id: ID(21), status: "approved", approved_revision: 1, version: 3, moderated_at: "2026-08-01T00:00:00+00:00" });
  const named = stored({ id: ID(22), status: "approved", approved_revision: 1, version: 3, moderated_at: "2026-08-01T00:00:00+00:00", details: { type: "text" } });
  const shown = stored({ id: ID(23), status: "approved", approved_revision: 1, version: 3, moderated_at: "2026-08-01T00:00:00+00:00", details: { type: "text" }, publish_name: true });
  const bare = stored({ id: ID(24), status: "approved", approved_revision: 1, version: 3, moderated_at: "2026-08-01T00:00:00+00:00", details: { type: "text" }, reader_name: null });
  const recent = stored({ id: ID(25), status: "approved", approved_revision: 1, version: 3, moderated_at: "2026-10-20T00:00:00+00:00" });
  const rows = { [held.id]: held, [named.id]: named, [shown.id]: shown, [bare.id]: bare, [recent.id]: recent };
  const database = fakeDatabase((entry) => {
    if (entry.method === "PATCH" && entry.path.endsWith("/openblog_feedback")) return [{ id: entry.params.id.slice(3), version: entry.body.version }];
    if (entry.path.endsWith("_events")) return entry.method === "DELETE" ? [] : [];
    if (entry.path.endsWith("/openblog_feedback")) return entry.params.id ? [rows[entry.params.id.slice(3)]].filter(Boolean) : Object.values(rows);
    return [];
  });
  const handler = handlerFor(database, { now: () => protectedNow });
  const dry = await handler(event("admin/retention", "GET", { headers: ADMIN, query: { ...cutoffs, comments: "false" } }));
  assert.equal(dry.statusCode, 200, dry.body);
  const listed = JSON.parse(dry.body).items.filter((item) => item.feedback?.kind === "future-suggestion");
  // The server filters to rows that hold something private; the function decides each exactly.
  const candidates = database.requests.filter((entry) => entry.method === "GET" && entry.path.endsWith("/openblog_feedback"))[0].params.or;
  assert.match(candidates, /status\.eq\.approved,kind\.eq\.future-suggestion,purged_at\.is\.null/);
  assert.match(candidates, /or\(details->contact\.not\.is\.null,and\(reader_name\.not\.is\.null,publish_name\.eq\.false\)\)/);
  assert.deepEqual(listed.map((item) => [item.id, item.step]).sort(), [[ID(21), "scrub-identity"], [ID(22), "scrub-identity"]].sort(), "only those holding identity, and only past the period");

  const run = await handler(event("admin/retention", "POST", { headers: { ...ADMIN, ...ORIGIN }, body: {
    ...cutoffs,
    items: [
      { source: "feedback", id: ID(21), version: 3, step: "scrub-identity" },
      { source: "feedback", id: ID(22), version: 3, step: "scrub-identity" },
      // Not due, already clear, or seen at another version: skipped.
      { source: "feedback", id: ID(23), version: 3, step: "scrub-identity" },
      { source: "feedback", id: ID(25), version: 3, step: "scrub-identity" },
      { source: "feedback", id: ID(21), version: 2, step: "scrub-identity" },
    ],
  } }));
  assert.equal(run.statusCode, 200, run.body);
  assert.deepEqual(JSON.parse(run.body), { ok: true, expired: 0, purged: 0, scrubbed: 2, skipped: 3, auditDeleted: null });
  const patches = writes(database).filter((entry) => entry.method === "PATCH");
  assert.equal(patches.length, 2);
  const [first] = patches;
  assert.deepEqual(first.params, { site_id: "eq.lantern", id: `eq.${ID(21)}`, version: "eq.3", status: "eq.approved", kind: "eq.future-suggestion", purged_at: "is.null", select: "id,version" });
  assert.deepEqual(first.body, { details: { type: "text", url: "https://example.org/letters" }, reader_name: null, version: 4 }, "the contact and the name go; the link and the text stay");
  assert.ok(!("body" in first.body) && !("status" in first.body), "nothing else is touched");
  const events = writes(database).filter((entry) => entry.method === "POST" && entry.path.endsWith("/openblog_feedback_events"));
  assert.equal(events.length, 2);
  assert.deepEqual({ ...events[0].body, at: undefined }, {
    site_id: "lantern", feedback_id: ID(21), action: "scrub-identity", from_status: "approved", to_status: "approved", reason: null, actor: "@retention",
    at: undefined, version: 4, kind: "future-suggestion", item_revision: 1, actor_role: "system",
  });
  assert.doesNotMatch(JSON.stringify(events), /ada|example\.org|Ada/, "the audit event holds nothing of the reader");
  // A step the function does not owe is skipped, not applied.
  const refused = await handler(event("admin/retention", "POST", { headers: { ...ADMIN, ...ORIGIN }, body: { ...cutoffs, items: [{ source: "feedback", id: ID(21), version: 3, step: "purge-content" }] } }));
  assert.deepEqual(JSON.parse(refused.body).purged, 0);
});
