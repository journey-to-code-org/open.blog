import { test } from "node:test";
import assert from "node:assert/strict";
import { KINDS, editHref, kindFields, kindForRoute } from "../../web/studio/parts/doc-kinds.js";
import { TOOLS } from "../../web/studio/screens/tools.js";

test("a page saves its title, line, menu and look; a collection its name", () => {
  assert.deepEqual(kindFields(KINDS.pages, { name: " About me ", description: " Hi ", inMenu: true, look: "" }), { title: "About me", description: "Hi", theme: "", nav: true });
  assert.deepEqual(kindFields(KINDS.pages, { name: "x", description: "", inMenu: false, look: "paper" }), { title: "x", description: "", theme: "paper", nav: null });
  assert.deepEqual(kindFields(KINDS.series, { name: "Thanksgiving", description: "", inMenu: true, look: "" }), { name: "Thanksgiving", description: "", theme: "" });
});

test("addresses: collections are series on disk, and a new one is new", () => {
  assert.equal(kindForRoute("collections"), KINDS.series);
  assert.equal(kindForRoute("page"), KINDS.pages);
  assert.equal(editHref(KINDS.series, ""), "#/collection/new");
  assert.equal(editHref(KINDS.pages, "pages/about.md"), "#/page/pages%2Fabout.md");
});

test("every tool opens an old Admin address, and none says a technical word", () => {
  for (const { items } of TOOLS) for (const [name, what, hash] of items) {
    assert.match(hash, /^#\//);
    assert.doesNotMatch(`${name} ${what}`, /JSON|config|API|deploy|git/i);
  }
});
