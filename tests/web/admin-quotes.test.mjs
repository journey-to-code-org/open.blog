// The Requests screen (ADR 0903, #517 and #518): off and honest when quote requests are not set up,
// newest-first cards with status words, click-to-copy, filters, status changes, CSV export, and an
// erase that is previewed, confirmed and reported only when verified.
import assert from "node:assert/strict";
import test from "node:test";

import { OFF_TEXT, STATUS_WORDS, countdown, createQuoteRequests } from "../../web/admin/quotes.js";
import { ApiError, choose, withDom } from "./dom-shim.mjs";
import { all, flush, one, text } from "./voice-harness.mjs";

const NOW = Date.parse("2026-11-01T12:00:00Z");
const ID = (n) => `${String(n).repeat(8)}-1111-4111-8111-${String(n).repeat(12)}`;
const request = (n, over = {}) => ({
  id: ID(n), status: "new", name: `Person ${n}`, phone: `+1 360 555 010${n}`, email: n === 1 ? "pat@example.com" : null, town: "Bend", service: n === 3 ? "Decks" : "Fencing",
  description: "Replace the fence.", page: null, photoCount: 0, photos: [], createdAt: `2026-10-0${n}T10:00:00.000Z`, handledAt: null, archivedAt: null, eraseAfter: null, notify: "off", ...over,
});

function server(initial = {}) {
  const state = { overview: { enabled: true, state: "on" }, requests: [request(1, { photoCount: 1, photos: [{ url: "https://p.supabase.co/storage/v1/object/sign/b/a.jpg?token=t", type: "image/jpeg" }] }), request(2), request(3)], retentionDays: 30, ...initial };
  const fake = {
    state,
    calls: [],
    failWith: null,
    async call(method, path, options = {}) {
      this.calls.push({ method, path, body: options.json });
      if (this.failWith && method === "POST") {
        const error = this.failWith;
        this.failWith = null;
        throw error;
      }
      if (path === "quote/status") return structuredClone(state.overview);
      if (path.startsWith("quote/requests?") || path === "quote/requests") {
        const q = new URLSearchParams(path.split("?")[1] || "");
        const rows = state.requests.filter((r) => (!q.get("status") || r.status === q.get("status")) && (!q.get("service") || r.service === q.get("service")));
        return structuredClone({ requests: rows, services: [...new Set(state.requests.map((r) => r.service))].sort(), retentionDays: state.retentionDays });
      }
      const set = /^quote\/requests\/(.+)\/status$/.exec(path);
      if (set) {
        state.requests.find((r) => r.id === set[1]).status = options.json.status;
        if (options.json.status === "archived") state.requests.find((r) => r.id === set[1]).eraseAfter = "2026-11-30T12:00:00.000Z";
        return { id: set[1], status: options.json.status };
      }
      if (path.startsWith("quote/export")) return { csv: "id,x\r\n", count: state.requests.length, filename: "quote-requests-start-to-now.csv" };
      if (path === "quote/erase/preview") return { count: options.json.ids.length, photos: 1, token: "tok" };
      if (path === "quote/erase") {
        state.requests = state.requests.filter((r) => !options.json.ids.includes(r.id));
        return { erased: options.json.ids.length, verified: true };
      }
      if (path === "quote/retention/run") return { enabled: true, erased: 0 };
      throw new Error(`unexpected ${method} ${path}`);
    },
  };
  return fake;
}

async function open(api, extra = {}) {
  const copied = [];
  const downloads = [];
  const win = { navigator: { clipboard: { writeText: async (v) => copied.push(v) } } };
  const view = createQuoteRequests({ api, win, now: () => NOW, download: (...args) => downloads.push(args.slice(0, 2)), ...extra });
  document.body.append(view.element);
  await view.load();
  await flush();
  return { view, root: view.element, copied, downloads };
}
const click = async (node) => {
  await node.dispatch("click");
  await flush();
};
const buttons = (root, action) => all(root, "button").filter((b) => b.dataset.action === action);
const cards = (root) => all(root, "li").filter((li) => li.dataset.request);

test("not set up: the page says so, offers nothing, and names an invalid setting without its value", withDom(async () => {
  for (const [overview, expected] of [[{ enabled: false, state: "off" }, OFF_TEXT.off], [{ enabled: false, state: "invalid", problems: ["OPENBLOG_QUOTE_ENDPOINT"] }, OFF_TEXT.invalid], [{ enabled: false, state: "unavailable" }, OFF_TEXT.unavailable]]) {
    const api = server({ overview });
    const { root } = await open(api);
    assert.match(text(root), new RegExp(expected.slice(0, 30)));
    assert.equal(all(root, "button").length, 0);
    assert.deepEqual(api.calls.map((c) => c.path), ["quote/status"], "nothing else is requested");
  }
}));

test("each request is a card with a status word, copy buttons and photo thumbnails with alternative text", withDom(async () => {
  const { root, copied } = await open(server());
  const first = cards(root)[0];
  assert.equal(cards(root).length, 3);
  assert.match(text(first), /Person 1/);
  assert.match(text(first), /New/, "status is a word, not only a colour");
  const img = all(first, "img")[0];
  assert.equal(img.getAttribute("alt"), "Photo 1 from Person 1");
  await click(buttons(first, "copy-phone")[0]);
  assert.deepEqual(copied, ["+1 360 555 0101"]);
  assert.match(text(root), /Copied phone/);
  await click(buttons(first, "copy-email")[0]);
  assert.deepEqual(copied, ["+1 360 555 0101", "pat@example.com"]);
  assert.equal(buttons(cards(root)[1], "copy-email").length, 0, "no email, no email button");
}));

test("a failed copy says so and shows the value to copy by hand", withDom(async () => {
  const { root } = await open(server(), { win: { navigator: { clipboard: { writeText: async () => { throw new Error("denied"); } } } } });
  await click(buttons(cards(root)[0], "copy-phone")[0]);
  assert.match(text(one(root, "[role]") ? root : root), /Could not copy automatically/);
  assert.match(text(root), /\+1 360 555 0101/);
}));

test("marking handled and archiving go through the server and redraw with the new status", withDom(async () => {
  const api = server();
  const { root } = await open(api);
  await click(buttons(cards(root)[1], "mark-handled")[0]);
  assert.deepEqual(api.calls.find((c) => c.method === "POST" && c.path.endsWith("/status")).body, { status: "handled" });
  assert.match(text(cards(root)[1]), /Handled/);
  assert.equal(buttons(cards(root)[1], "mark-handled").length, 0);
  await click(buttons(cards(root)[1], "archive")[0]);
  assert.match(text(cards(root)[1]), /Archived/);
  assert.match(text(cards(root)[1]), /Erased automatically in 29 days \(2026-11-30\)/);
  assert.ok(buttons(cards(root)[1], "mark-new").length === 1);
  assert.deepEqual(Object.keys(STATUS_WORDS), ["new", "handled", "archived"]);
}));

test("filters ask the server for the status and service", withDom(async () => {
  const api = server();
  const { root } = await open(api);
  const [status, service] = all(root, "select");
  await choose(status, "new");
  await flush();
  assert.ok(api.calls.some((c) => c.path === "quote/requests?status=new"));
  const again = all(root, "select")[1];
  await choose(again, "Decks");
  await flush();
  assert.ok(api.calls.some((c) => c.path === "quote/requests?status=new&service=Decks"));
  assert.equal(cards(root).length, 1);
  assert.ok(service);
}));

test("an empty list says what to expect", withDom(async () => {
  const { root } = await open(server({ requests: [] }));
  assert.match(text(root), /No requests yet/);
}));

test("export downloads the CSV the server built, for the chosen days", withDom(async () => {
  const api = server();
  const { root, downloads } = await open(api);
  const [from, to] = all(root, "input").filter((i) => i.getAttribute("type") === "date");
  from.value = "2026-10-01";
  to.value = "2026-10-31";
  await click(buttons(root, "export")[0]);
  assert.ok(api.calls.some((c) => c.path === "quote/export?from=2026-10-01&to=2026-10-31"));
  assert.deepEqual(downloads, [["quote-requests-start-to-now.csv", "id,x\r\n"]]);
  assert.match(text(root), /Exported 3 requests/);
}));

test("erase is previewed, confirmed, reported as verified, and cancel erases nothing", withDom(async () => {
  const api = server();
  const { root } = await open(api);
  assert.equal(buttons(root, "erase")[0].disabled, true, "nothing selected, nothing to erase");
  const pick = (n) => all(cards(root)[n], "input")[0];
  pick(1).checked = true;
  await pick(1).dispatch("change", { target: pick(1) });
  await flush();
  assert.equal(buttons(root, "erase")[0].disabled, false);
  await click(buttons(root, "erase")[0]);
  assert.match(text(root), /Erase 1 request\?/);
  assert.match(text(root), /cannot be undone/);
  assert.ok(!api.calls.some((c) => c.path === "quote/erase"), "a preview erases nothing");
  await click(buttons(root, "erase-cancel")[0]);
  assert.match(text(root), /Nothing was erased/);
  assert.equal(cards(root).length, 3);
  await click(buttons(root, "erase")[0]);
  await click(buttons(root, "erase-confirm")[0]);
  assert.deepEqual(api.calls.find((c) => c.path === "quote/erase").body, { ids: [ID(2)], token: "tok" });
  assert.equal(cards(root).length, 2);
  assert.match(text(root), /Erased 1 request and checked afterward: none remain/);
}));

test("a failed erase says so and the requests are still listed", withDom(async () => {
  const api = server();
  const { root } = await open(api);
  const pick = all(cards(root)[0], "input")[0];
  pick.checked = true;
  await pick.dispatch("change", { target: pick });
  await flush();
  await click(buttons(root, "erase")[0]);
  api.failWith = new ApiError("Erase failed. Every request is still in place; try again", 502);
  await click(buttons(root, "erase-confirm")[0]);
  assert.match(text(root), /Every request is still in place/);
  assert.equal(cards(root).length, 3);
}));

test("retention is explained, and expired archived requests can be erased on demand", withDom(async () => {
  const api = server({ requests: [request(1, { status: "archived", eraseAfter: "2026-10-30T12:00:00.000Z" })] });
  const { root } = await open(api);
  assert.match(text(root), /erased automatically 30 days after you archive/);
  assert.match(text(cards(root)[0]), /next daily sweep/);
  await click(buttons(root, "sweep")[0]);
  assert.ok(api.calls.some((c) => c.path === "quote/retention/run"));
  const off = await open(server({ retentionDays: null }));
  assert.match(text(off.root), /kept until you erase them/);
  assert.equal(buttons(off.root, "sweep").length, 0);
  assert.equal(countdown(null), "");
  assert.equal(countdown("2026-11-04T12:00:00.000Z", NOW), "Erased automatically in 3 days (2026-11-04)");
}));

test("a load failure offers a retry and shows no request", withDom(async () => {
  const api = server();
  api.call = async () => {
    throw new ApiError("boom", 502);
  };
  const { root } = await open(api);
  assert.match(text(root), /boom/);
  assert.equal(buttons(root, "quote-retry").length, 1);
  assert.equal(cards(root).length, 0);
}));
