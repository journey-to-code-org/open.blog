// Ported from tests/web/admin-trade-checklist.test.mjs for the old Admin's retirement (R1): the
// checklist's pure rules against Studio's copy, Studio's step words and where each step opens, and
// the recipe notes in her words (G14). The old card's tests stay with the old Admin until R15.
import assert from "node:assert/strict";
import test from "node:test";

import { STEP_TEXT, checklistDone, checklistSteps, checklistVisible, progressWords, recipeNoteWords, stepHref } from "../../web/studio/parts/checklist-rules.js";

const answer = (done = []) => ({
  applies: true,
  done: done.length,
  total: 5,
  steps: ["business", "service", "job", "review", "destination"].map((id) => ({
    id,
    done: done.includes(id),
    href: id === "destination" || (id === "job" && done.includes("job")) ? (done.includes("job") ? "#/edit/posts%2Foak.md" : null) : { business: "#/business", service: "#/services", job: "#/capture", review: "#/reviews" }[id],
  })),
});

test("the list shows on a trade site with something left to do, and never once hidden or finished", () => {
  assert.equal(checklistVisible({ dismissed: false, data: answer() }), true);
  assert.equal(checklistVisible({ dismissed: true, data: answer() }), false, "hidden");
  assert.equal(checklistVisible({ dismissed: false, data: { ...answer(), applies: false } }), false, "not a trade site");
  assert.equal(checklistVisible({ dismissed: false, data: answer(["business", "service", "job", "review", "destination"]) }), false, "all done");
  assert.equal(checklistVisible({ dismissed: false, data: null }), false, "no answer shows nothing");
  assert.equal(checklistVisible({ dismissed: false, data: { applies: true, steps: "many" } }), false);
  assert.equal(checklistDone(answer(["business", "service", "job", "review", "destination"])), true);
  assert.equal(checklistDone(answer(["business"])), false);
  assert.equal(checklistDone({ applies: false, steps: [] }), false);
});

test("only known steps, real booleans and in-Admin links are kept from an answer", () => {
  const steps = checklistSteps({
    steps: [
      { id: "business", done: "yes", href: "javascript:alert(1)" },
      { id: "nope", done: true, href: "#/x" },
      { id: "review", done: true, href: "https://example.com/" },
      { id: "job", done: false, href: "#/capture" },
    ],
  });
  assert.deepEqual(steps, [
    { id: "business", done: false, href: null },
    { id: "review", done: true, href: null },
    { id: "job", done: false, href: "#/capture" },
  ]);
});

test("each step opens its Studio screen; sharing a job opens Share this job; Capture isn't built yet", () => {
  const steps = checklistSteps(answer(["job"]));
  const by = Object.fromEntries(steps.map((step) => [step.id, stepHref(step)]));
  assert.deepEqual(by, { business: "#/business", service: "#/services", job: "#/write/posts%2Foak.md", review: "#/reviews", destination: "#/sharing/job/posts%2Foak.md" });
  assert.equal(stepHref(checklistSteps(answer())[2]), null, "Capture is R4: hint, no button");
  assert.equal(stepHref({ id: "destination", href: null }), null);
  assert.equal(progressWords(steps), "1 of 5 done");
  assert.equal(STEP_TEXT.destination.waiting, "Publish a job first.");
  for (const text of Object.values(STEP_TEXT)) assert.doesNotMatch(JSON.stringify(text), /Capture|draft|Settings|Slug/, "her words, never the system's");
});

test("G14: recipe notes in her words, linking the page that holds the address", () => {
  const taken = recipeNoteWords({ code: "address-taken", address: "/recipes/", fallback: "/recipe-index/", page: { path: "pages/recipes.md", kind: "page", title: "My recipes" }, byAlias: false });
  assert.deepEqual(taken, {
    text: "Your page “My recipes” uses the address your recipe list wants, so the list is at /recipe-index/ instead.",
    open: { href: "#/page/pages%2Frecipes.md", label: "Open “My recipes”" },
    help: "",
  });
  const alias = recipeNoteWords({ code: "address-taken", fallback: "/recipes/all/", page: { path: "posts/old.md", kind: "post", title: "Old" }, byAlias: true });
  assert.equal(alias.open, null);
  assert.equal(alias.help, "Ask the person who set up your site to free the address.");
  assert.equal(recipeNoteWords({ code: "no-address", page: { path: "pages/r.md", kind: "page", title: "R" } }).text, "There's no list of all your recipes, because two pages use its addresses.");
  assert.equal(recipeNoteWords({ code: "wordless", facet: "course", value: "???" }).text, "Readers can't browse by the course “???” because it has no letters. Add a word, like Dessert.");
  assert.equal(recipeNoteWords({ code: "wordless", facet: "cuisine", value: "🍰" }).text, "Readers can't browse by the cuisine “🍰” because it has no letters. Add a word, like Italian.");
  assert.equal(recipeNoteWords({ code: "filter-taken", facet: "course", value: "Pie", page: { path: "series/pie.md", kind: "series", title: "Pie" } }).open.href, "#/collection/series%2Fpie.md");
  assert.equal(recipeNoteWords({ code: "what" }), null);
  assert.equal(recipeNoteWords(null), null);
  for (const note of [taken, alias]) assert.doesNotMatch(note.text, /Settings|Slug|Admin/);
});
