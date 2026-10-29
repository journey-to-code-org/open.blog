// The architecture of optional social publishing (epic #353, story #360, ADR 0740): it is off
// unless switched on, nothing in a browser talks to Supabase or the hosted social function, and the
// hosted code cannot write a post, a build or the site file. These are release gates: they hold for
// the whole feature, not for one route. No network, no Supabase: every call goes to a recorder.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { createHandler as createSocial } from "../../netlify/functions/social.mjs";
import { createHandler as createWorker } from "../../netlify/functions/social-worker.mjs";
import { ADMIN_KEY, WORKER_KEY, env } from "./social-queue-fakes.mjs";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));

function recorder() {
  const calls = [];
  const fetchImpl = async (url) => {
    calls.push(String(url));
    throw new Error("no network in this test");
  };
  return { calls, fetchImpl };
}

// Every hosted route the guide lists, plus the provider callbacks and an unknown path.
const ROUTES = [
  ["GET", "status"],
  ["GET", "connections"],
  ["POST", "connections"],
  ["POST", "connections/11111111-1111-4111-8111-111111111111/select"],
  ["POST", "connections/11111111-1111-4111-8111-111111111111/cancel"],
  ["GET", "accounts"],
  ["POST", "accounts/11111111-1111-4111-8111-111111111111/reconnect"],
  ["POST", "accounts/11111111-1111-4111-8111-111111111111/disconnect"],
  ["GET", "destinations"],
  ["GET", "announcements"],
  ["POST", "announcements"],
  ["PATCH", "announcements"],
  ["POST", "announcements/reschedule"],
  ["POST", "announcements/cancel"],
  ["POST", "announcements/retry"],
  ["POST", "announcements/resolve"],
  ["GET", "announcements/attempts"],
  ["GET", "callback/linkedin"],
  ["GET", "callback/facebook"],
  ["GET", "nothing-here"],
];

const event = (method, route, key) => ({
  httpMethod: method,
  path: `/api/social/${route}`,
  rawQuery: "id=11111111-1111-4111-8111-111111111111&code=abc&state=def",
  headers: { authorization: `Bearer ${key}`, "x-openblog-actor": "editor", "content-type": "application/json" },
  body: method === "GET" ? "" : JSON.stringify({ provider: "linkedin" }),
});

// The settings a deployment has when it is NOT switched on: none at all, or everything but a
// value of OPENBLOG_SOCIAL_ENABLED that is not exactly `true`.
const OFF = [
  ["no settings", {}],
  ...["", "TRUE", "True", "1", "yes", "on", "true;", "false"].map((value) => [`OPENBLOG_SOCIAL_ENABLED=${JSON.stringify(value)}`, env({ OPENBLOG_SOCIAL_ENABLED: value })]),
  ["no token keys", env({ OPENBLOG_SOCIAL_TOKEN_KEYS: "" })],
  ["worker key equal to the admin key", env({ OPENBLOG_SOCIAL_WORKER_KEY: ADMIN_KEY })],
];

test("every hosted social route and the worker are a 404 that calls nothing unless switched on", async () => {
  for (const [label, settings] of OFF) {
    const { calls, fetchImpl } = recorder();
    const social = createSocial({ env: settings, fetchImpl, now: () => 0 });
    const worker = createWorker({ env: settings, fetchImpl, now: () => 0, sink: { log() {}, warn() {}, error() {} } });
    for (const [method, route] of ROUTES) {
      for (const key of [ADMIN_KEY, WORKER_KEY]) {
        const reply = await social(event(method, route, key));
        assert.equal(reply.statusCode, 404, `${label}: ${method} ${route}`);
        assert.equal(JSON.parse(reply.body).error, "not-enabled", `${label}: ${method} ${route}`);
      }
    }
    const ran = await worker({ httpMethod: "POST", path: "/api/social-worker", headers: { authorization: `Bearer ${WORKER_KEY}` }, body: "" });
    assert.equal(ran.statusCode, 404, `${label}: worker`);
    assert.deepEqual(calls, [], `${label}: no outgoing call`);
    for (const value of [ADMIN_KEY, WORKER_KEY]) {
      assert.ok(!JSON.stringify(ran).includes(value), `${label}: no key in the reply`);
    }
  }
});

function files(dir, keep) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) out.push(...files(path, keep));
    else if (keep(path)) out.push(path);
  }
  return out;
}

test("nothing in a browser bundle talks to Supabase or to the hosted social function", () => {
  const browser = files(join(ROOT, "web"), (path) => /\.(m?js|html|css|json)$/.test(path));
  assert.ok(browser.some((path) => path.endsWith(join("admin", "social.js"))), "the Admin social page is scanned");
  const forbidden = [
    [/supabase\.co\b/i, "a Supabase project address"],
    [/\/rest\/v1\b/, "the Supabase REST path"],
    [/@supabase\//, "a Supabase client library"],
    [/\bcreateClient\s*\(/, "a Supabase client"],
    [/\.netlify\/functions\/social/, "the hosted social function"],
    [/(?<!\/admin)\/api\/social/, "the hosted social route (Admin's own /admin/api/social is the only one allowed)"],
    [/\bsb_secret_[A-Za-z0-9]/, "a Supabase secret key"],
  ];
  for (const path of browser) {
    const text = readFileSync(path, "utf8");
    for (const [pattern, what] of forbidden) {
      assert.doesNotMatch(text, pattern, `${relative(ROOT, path)} carries ${what}`);
    }
  }
});

// Follow relative imports from the hosted social entry points, so a shared helper that touches the
// file system cannot slip in through a module that is not named social-*.
function importGraph(entries) {
  const seen = new Set();
  const queue = [...entries];
  while (queue.length) {
    const path = queue.pop();
    if (seen.has(path)) continue;
    seen.add(path);
    const source = readFileSync(path, "utf8");
    for (const match of source.matchAll(/(?:^|\n)\s*(?:import|export)\s[^;]*?from\s+["'](\.{1,2}\/[^"']+)["']/g)) {
      queue.push(resolve(dirname(path), match[1]));
    }
  }
  return [...seen];
}

test("the hosted social code cannot write a post, a build or the site file", () => {
  const entries = [
    ...files(join(ROOT, "netlify", "functions"), (path) => /[\\/]social[^\\/]*\.mjs$/.test(path)),
    ...files(join(ROOT, "netlify", "lib"), (path) => /[\\/]social-[^\\/]*\.mjs$/.test(path)),
  ];
  assert.ok(entries.length >= 10, "the hosted social modules were found");
  const graph = importGraph(entries);
  for (const path of graph) {
    const source = readFileSync(path, "utf8");
    assert.doesNotMatch(source, /["'](node:)?fs(\/promises)?["']/, `${relative(ROOT, path)} imports a file system API`);
    assert.doesNotMatch(source, /["'](node:)?child_process["']/, `${relative(ROOT, path)} can run a process`);
    assert.doesNotMatch(source, /openblog\.json|content\/posts/, `${relative(ROOT, path)} names the site's own files`);
  }
});
