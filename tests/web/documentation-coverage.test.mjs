import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (relative) => readFileSync(path.join(root, relative), "utf8").replace(/\r/g, "");

test("every guide in docs is linked from another document than the changelog", () => {
  const guides = readdirSync(path.join(root, "docs")).filter((name) => name.endsWith(".md") && name !== "README.md");
  const others = (exclude) =>
    [
      "README.md",
      ...readdirSync(path.join(root, "docs"))
        .filter((name) => name.endsWith(".md"))
        .map((name) => `docs/${name}`),
    ]
      .filter((file) => file !== exclude)
      .map(read)
      .join("\n");
  const orphans = guides.filter((name) => !new RegExp(`\\]\\((?:docs/)?${name.replace(/\./g, "\\.")}[#)]`).test(others(`docs/${name}`)));
  assert.deepEqual(orphans, []);
});

function landingSectionsParagraph() {
  const content = read("docs/content.md");
  const start = content.indexOf("#### Landing page sections");
  assert.notEqual(start, -1);
  const end = content.indexOf("\n#", start + 1);
  return content.slice(start, end === -1 ? undefined : end);
}

test("the landing section docs name every section type this release defines", () => {
  const source = read("crates/openblog-core/src/landing.rs");
  const list = source.match(/pub const SECTION_TYPES: \[&str; \d+\] = \[([^\]]+)\]/);
  assert.ok(list, "SECTION_TYPES not found");
  const types = [...list[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(types.length > 10);
  const docs = landingSectionsParagraph();
  assert.deepEqual(
    types.filter((type) => !docs.includes(`\`${type}\``)),
    [],
  );
});

test("the landing section docs name every section type that needs version 2", () => {
  const source = read("crates/openblog-core/src/landing.rs");
  const body = source.slice(source.indexOf("pub fn version_for_page"));
  const needs = body.match(/Some\(((?:"[a-z-]+"\s*\|?\s*)+)\)/);
  assert.ok(needs, "version_for_page list not found");
  const types = [...needs[1].matchAll(/"([a-z-]+)"/g)].map((m) => m[1]);
  assert.ok(types.includes("business-facts"));
  const docs = landingSectionsParagraph();
  const sentence = docs.slice(docs.lastIndexOf(".", docs.indexOf('`"version": 2`')));
  const versionSentence = sentence.slice(0, sentence.indexOf(".", 2) + 1);
  assert.deepEqual(
    types.filter((type) => !versionSentence.includes(`\`${type}\``)),
    [],
    versionSentence,
  );
});
