import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

async function javascriptFiles(directory) {
  const entries = await readdir(directory, { withFileTypes: true });
  const nested = await Promise.all(entries.map(async (entry) => {
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) return javascriptFiles(target);
    return entry.isFile() && entry.name.endsWith(".js") ? [target] : [];
  }));
  return nested.flat();
}

test("the no-JavaScript inventory covers every registered custom element", async () => {
  const files = await javascriptFiles(path.join(root, "web"));
  const registered = new Set();
  for (const file of files) {
    const source = await readFile(file, "utf8");
    for (const match of source.matchAll(/customElements\.define\(["'](ob-[a-z-]+)["']/g)) {
      registered.add(match[1]);
    }
  }

  const documentation = await readFile(path.join(root, "docs/no-javascript.md"), "utf8");
  const documented = new Set(
    [...documentation.matchAll(/^\| `<(ob-[a-z-]+)>` \|/gm)].map((match) => match[1]),
  );

  assert.deepEqual([...documented].sort(), [...registered].sort());
  assert.ok(documentation.includes("Semantic host markup without JavaScript"));
  assert.ok(documentation.includes("Runtime dependency and enhanced behavior"));
});

test("search stays inert until its enhancement reveals the form", async () => {
  const component = await readFile(path.join(root, "web/components/ob-search.js"), "utf8");
  assert.match(component, /this\.form\.hidden = false/);
});
