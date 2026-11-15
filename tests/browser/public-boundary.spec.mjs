import { test, expect } from "@playwright/test";
import { execFileSync, spawn } from "node:child_process";
import { createHash, randomBytes } from "node:crypto";
import { once } from "node:events";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { removeTree } from "./teardown.mjs";

// What will be public in the real Admin Studio (A8.4, ADR 0125): the Research workspace previews,
// for the whole site, exactly which research each projection publishes and why the rest is
// withheld, from the build's own projection; Evidence Studio previews one post from its unsaved
// draft; every withheld item opens where it is changed; both reflow at 320 pixels; nothing is
// written; and the build publishes what the preview said, refusing nothing it did not name.

const repository = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const binary = join(repository, "target", "debug", process.platform === "win32" ? "openblog.exe" : "openblog");
const password = randomBytes(24).toString("hex");
const MODULES = ["social", "release", "field", "optimize", "accessibility", "evidence", "research", "assistant", "analytics", "contributors", "public-site"];
const LEAK = (label) => `ZqxLeak ${label} sentinel words kept private`;
const LIBRARY = {
  version: 1,
  sources: [
    { id: "plato", kind: "work", title: "Politeia" },
    {
      id: "slings", kind: "edition", of: "plato", title: "Platonis Rempublicam",
      rights: { status: "publicDomain", note: LEAK("rightsnote") },
      identifiers: [{ scheme: "url", value: "http://files.internal/ZqxLeakUrlSegmentSentinelAbcdefghijkl" }],
    },
    { id: "bloom", kind: "translation", of: "plato", language: "en", title: "Bloom" },
  ],
};
const NOTEBOOK = {
  version: 1,
  passages: [
    { id: "cave", source: "slings", excerpt: { text: "Behold the den" }, locators: [{ kind: "page", value: "514" }] },
    { id: "moved", source: "slings", excerpt: { text: LEAK("stalepassage") }, locators: [{ kind: "page", value: "600" }] },
  ],
  notes: [{ id: "worry", kind: "question", text: LEAK("note") }],
};
const ATLAS = {
  version: 2,
  entries: [
    { id: "plato-person", kind: "person", label: "Plato", visibility: "approved" },
    { id: "politeia", kind: "work", label: "Politeia", source: "plato", visibility: "approved" },
    { id: "the-good", kind: "concept", label: LEAK("entrylabel") },
  ],
  relationships: [
    { id: "politeia-discusses-good", kind: "discusses", from: "politeia", to: "the-good", assertedBy: { kind: "author" }, evidence: [{ source: "slings" }], uncertainty: LEAK("doubt"), visibility: "approved" },
  ],
};
const ALIGNMENTS = {
  version: 1,
  alignments: [
    { id: "cave-places", label: "The cave", visibility: "approved", members: [{ source: "slings", passage: "cave" }, { source: "bloom", absent: true }] },
    { id: "stale-places", label: "Moved", visibility: "approved", rationale: LEAK("stalerationale"), approvedPassages: { moved: "0000000000000000" }, members: [{ source: "slings", passage: "moved", locators: [{ kind: "page", value: "601" }] }, { source: "bloom", absent: true }] },
  ],
};
const CLAIMS = {
  version: 1,
  claims: [
    { id: "c1", post: "cave", statement: "The cave is an image of education.", visibility: "approved" },
    { id: "c2", post: "cave", statement: LEAK("claim") },
  ],
  links: [],
};
const BODY = "## Abstract\n\nThe cave educates [@slings, page 514].\n\nSee [Plato](/atlas/plato-person/), [the Good](/atlas/the-good/) and [the places](/comparisons/cave-places/).\n\n## References\n";
const POST = `---\ntitle: Cave\ndate: 2026-10-01\nprofile: research\ncitations: notes\n---\n\n${BODY}`;
let root;
let server;
let origin;

const research = (name) => join(root, ".openblog", "private", "research", name);
const FILES = ["sources.json", "notebook.json", "atlas.json", "alignments.json", "claims.json"];
const researchBytes = () => FILES.map((name) => readFileSync(research(name), "utf8"));
const post = (name) => join(root, "content", "posts", name);
const usePreset = (preset, editorMode) => {
  const file = join(root, ".openblog", "private", "admin-preferences", `${createHash("sha256").update("writer").digest("hex")}.json`);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify({ schemaVersion: 1, preset, density: "comfortable", editorMode, moduleOrder: MODULES, hiddenModules: [] }));
};

test.beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "openblog-public-boundary-"));
  cpSync(join(repository, "examples", "portable-publishing"), root, { recursive: true });
  mkdirSync(dirname(research("sources.json")), { recursive: true });
  writeFileSync(research("sources.json"), JSON.stringify(LIBRARY));
  writeFileSync(research("notebook.json"), JSON.stringify(NOTEBOOK));
  writeFileSync(research("atlas.json"), JSON.stringify(ATLAS));
  writeFileSync(research("alignments.json"), JSON.stringify(ALIGNMENTS));
  writeFileSync(research("claims.json"), JSON.stringify(CLAIMS));
  writeFileSync(post("cave.md"), POST);
  const config = JSON.parse(readFileSync(join(root, "openblog.json"), "utf8"));
  config.knowledgeAtlas = { publish: true };
  config.comparisons = { publish: true };
  config.claimEvidence = { publish: true };
  writeFileSync(join(root, "openblog.json"), JSON.stringify(config, null, 2));
  execFileSync(binary, ["user", "add", "writer", "--root", root], { env: { ...process.env, OPENBLOG_PASSWORD: password }, stdio: "pipe" });
  const listener = createServer();
  listener.listen(0, "127.0.0.1");
  await once(listener, "listening");
  const port = listener.address().port;
  await new Promise((done) => listener.close(done));
  origin = `http://127.0.0.1:${port}`;
  server = spawn(binary, ["serve", "--admin", "--root", root, "--port", String(port)], { cwd: repository, stdio: "pipe" });
  let output = "";
  server.stdout.on("data", (data) => { output += data; });
  server.stderr.on("data", (data) => { output += data; });
  await expect(async () => {
    if (server.exitCode !== null) throw new Error(`Test server exited: ${output}`);
    expect((await fetch(`${origin}/admin/studio/`)).ok).toBe(true);
  }).toPass({ timeout: 30000 });
});

test.afterAll(async () => {
  if (server && server.exitCode === null) {
    const stopped = once(server, "exit");
    server.kill();
    await stopped;
  }
  // Windows can hold the stopped server's files for a moment.
  removeTree(root);
});

let dialogs;
test.beforeEach(({ page }) => {
  usePreset("simple", "markdown");
  writeFileSync(post("cave.md"), POST);
  dialogs = [];
  page.on("dialog", async (dialog) => {
    dialogs.push(dialog.message());
    await dialog.accept();
  });
});

const preview = (page, scope = "site") => page.locator(`[data-boundary-preview="${scope}"]`);
const projection = (page, key, scope = "site") => preview(page, scope).locator(`[data-boundary-projection="${key}"]`);
// The first item with the key: the projection listed first. The atlas query file lists the same entries
// again, in a section of its own, so a key can be in two sections.
const item = (page, key, scope = "site") => preview(page, scope).locator(`[data-boundary-item="${key}"]`).first();

/** Elements of `region` whose box ends right of it, or a region that scrolls sideways, by name. */
const overflowing = (region) =>
  region.evaluate((element) => {
    const edge = element.getBoundingClientRect().right;
    return [...element.querySelectorAll("*")]
      .filter((node) => node.getClientRects().length && node.getBoundingClientRect().right > edge + 1)
      .map((node) => `${node.tagName.toLowerCase()}.${[...node.classList].join(".")}${node.id ? `#${node.id}` : ""}`)
      .concat(element.scrollWidth - element.clientWidth > 1 ? ["the region scrolls sideways"] : [])
      .concat(element.getBoundingClientRect().right > window.innerWidth + 1 ? ["the region is wider than the window"] : []);
  });

test("the build publishes what the preview says, names what it withholds, and carries no private text", async () => {
  const out = join(root, "dist-boundary");
  const output = execFileSync(binary, ["build", "--root", root, "--out", out], { encoding: "utf8", stdio: "pipe" });
  expect(output).toContain("Research published:");
  const files = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const path = join(dir, name);
      if (statSync(path).isDirectory()) walk(path);
      else files.push(path);
    }
  };
  walk(out);
  const atlas = JSON.parse(readFileSync(join(out, "atlas.json"), "utf8"));
  expect(atlas.entries.map((entry) => entry.id)).toEqual(["plato-person", "politeia"]);
  const comparisons = JSON.parse(readFileSync(join(out, "comparisons.json"), "utf8"));
  expect(comparisons.comparisons.map((comparison) => comparison.id)).toEqual(["cave-places"]);
  for (const file of files) {
    const text = readFileSync(file, "utf8");
    expect(text, file).not.toContain("ZqxLeak");
    expect(text, file).not.toContain("files.internal");
  }
  rmSync(out, { recursive: true, force: true });
});
