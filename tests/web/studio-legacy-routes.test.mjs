// Every address the old Admin ever answered still lands on the right Studio screen (R15).
// The fixture was written from the old Admin's admin.js before it was deleted (its dispatch,
// canonicalAdminHash, RESEARCH_PANELS, KINDS and the queries it read), with every notice
// address ever sent. legacyRoute is kept forever: bookmarks, notices queued on other phones
// and old invitation links carry these addresses. docs/specs/studio/r15/spec.md.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { legacyRoute, parseRoute } from "../../web/studio/router.js";
import { studioAddress } from "../../web/studio/parts/notification-rules.js";

const here = dirname(fileURLToPath(import.meta.url));
const fixture = JSON.parse(readFileSync(join(here, "fixtures", "old-admin-addresses.json"), "utf8"));
const index = readFileSync(join(here, "..", "..", "web", "studio", "screens", "index.js"), "utf8");
const screens = new Set([...index.matchAll(/name: "([a-z-]+)"/g)].map((m) => m[1]));
const TOKEN = "tok123secret";

/** What the router shows for an address: legacyRoute's answer or the address, and its screen (Home for an unknown one). */
function lands(hash) {
  const studio = legacyRoute(hash) ?? (String(hash).startsWith("#") ? hash : `#${hash}`);
  const name = parseRoute(studio).name;
  return { studio, screen: screens.has(name) ? name : "home" };
}

test("the fixture covers every head the old dispatch answered, and the queries it read", () => {
  const heads = new Set(fixture.addresses.map(({ old }) => old.replace(/^#\/?/, "").split(/[/?]/)[0]));
  for (const head of fixture.heads) assert.ok(heads.has(head), head);
  const olds = fixture.addresses.map(({ old }) => old);
  for (const query of ["?status=draft", "?focus=", "?pane=evidence", "?kind=", "?sheet=home-screen", "?pack="]) {
    assert.ok(olds.some((old) => old.includes(query)), query);
  }
  assert.ok(fixture.addresses.length >= 150);
});

test("every old address lands where the fixture says", () => {
  for (const { old, studio, screen } of fixture.addresses) {
    assert.deepEqual(lands(old), { studio, screen }, old);
  }
});

test("every landing is a Studio screen, never the not-yet page or More tools", () => {
  for (const { old, screen } of fixture.addresses) {
    assert.ok(screens.has(screen), `${old} → ${screen}`);
    assert.notEqual(screen, "not-yet", old);
    assert.notEqual(screen, "tools", old);
  }
  assert.ok(!screens.has("not-yet") && !screens.has("tools"), "both screens are gone");
});

test("mapping twice changes nothing, and no landing keeps an invitation token", () => {
  for (const { old, studio } of fixture.addresses) {
    assert.equal(legacyRoute(studio), null, `${old} → ${studio} maps again`);
    assert.ok(!studio.includes(TOKEN), old);
  }
});

test("every notice ever sent opens its screen through the worker's address rule", () => {
  const origin = "https://blog.example";
  for (const { url, screen } of fixture.notices) {
    const opened = new URL(studioAddress(url, origin));
    assert.equal(opened.origin, origin, url);
    assert.equal(opened.pathname, "/admin/studio/", url);
    const hash = opened.hash || "#/";
    const landed = lands(hash);
    assert.equal(landed.screen, screen, url);
    assert.ok(!landed.studio.includes(TOKEN) || url.includes("/together/join/"), `${url} keeps its token`);
  }
});

test("the docs write the old addresses out in one place only: admin.md's Old addresses", async () => {
  const { readdirSync, statSync } = await import("node:fs");
  const docs = join(here, "..", "..", "docs");
  const walk = (dir) => readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === "adr" || name === "specs" ? [] : walk(path);
    return name.endsWith(".md") ? [path] : [];
  });
  const found = walk(docs).filter((path) => readFileSync(path, "utf8").includes("/admin/#"));
  assert.deepEqual(found.map((path) => path.slice(docs.length + 1)), ["admin.md"]);
  const manual = readFileSync(join(docs, "admin.md"), "utf8");
  const oldAddresses = manual.indexOf("## Old addresses");
  assert.ok(oldAddresses > 0);
  assert.ok(!manual.slice(0, oldAddresses).includes("/admin/#"), "only under Old addresses");
});
