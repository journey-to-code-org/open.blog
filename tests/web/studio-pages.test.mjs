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

import { isOn, nameKeyOf } from "../../web/studio/parts/doc-kinds.js";
import { collectionOptions, seriesSlug } from "../../web/studio/parts/write-page.js";

test("the menu switch reads yes and on as the engine does, and is sent only when she changed it", () => {
  assert.ok(isOn("yes") && isOn("On") && isOn(true) && !isOn("no") && !isOn(undefined));
  assert.equal("nav" in kindFields(KINDS.pages, { name: "About", description: "", inMenu: true, look: "" }, { menuWas: true }), false);
  assert.equal(kindFields(KINDS.pages, { name: "About", description: "", inMenu: false, look: "" }, { menuWas: true }).nav, null);
});

test("a collection written with title: keeps title:", () => {
  assert.equal(nameKeyOf(KINDS.series, { title: "Cookies" }), "title");
  assert.equal(nameKeyOf(KINDS.series, {}), "name");
  assert.deepEqual(Object.keys(kindFields(KINDS.series, { name: "Cookie Tins", description: "", inMenu: false, look: "" }, { nameKey: "title" })), ["title", "description", "theme"]);
});

test("a post's collection shows as written: matched by its slug, or kept as one of its own", () => {
  const series = [{ slug: "thanksgiving", title: "Thanksgiving Table" }];
  assert.equal(seriesSlug("Thanksgiving"), "thanksgiving");
  const matched = collectionOptions(series, "Thanksgiving");
  assert.equal(matched.value, "Thanksgiving");
  assert.equal(matched.options.find((o) => o.value === "Thanksgiving").label, "Thanksgiving Table");
  const own = collectionOptions(series, "easter");
  assert.equal(own.options.at(-1).label, "easter (no page of its own yet)");
  assert.equal(collectionOptions([], "").options.length, 1);
});
