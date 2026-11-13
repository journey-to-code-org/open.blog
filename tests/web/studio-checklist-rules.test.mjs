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

test("G14: recipe notes in her words, linking the page that holds the spot, paths only in details", () => {
  const taken = recipeNoteWords({ code: "address-taken", address: "/recipes/", fallback: "/recipe-index/", page: { path: "pages/recipes.md", kind: "page", title: "My recipes" }, byAlias: false });
  assert.deepEqual(taken, {
    text: "Your recipe list has moved to a new spot on your blog, because your page “My recipes” uses its usual one. Links to it still work.",
    open: { href: "#/page/pages%2Frecipes.md", label: "Open “My recipes”" },
    help: "",
    details: ["code address-taken", "wanted /recipes/", "now at /recipe-index/", "page pages/recipes.md"],
  });
  const alias = recipeNoteWords({ code: "address-taken", fallback: "/recipes/all/", page: { path: "posts/old.md", kind: "post", title: "Old" }, byAlias: true });
  assert.equal(alias.open, null);
  assert.equal(alias.help, "Ask the person who set up your site to free that spot.");
  assert.equal(recipeNoteWords({ code: "no-address", page: { path: "pages/r.md", kind: "page", title: "R" } }).text, "There's no list of all your recipes, because two pages are using its spot on your blog.");
  // A course whose name is missing, empty or has no letters is never quoted: it would look broken.
  for (const value of ["???", "", "   ", "\u0007", null, undefined, 5, "\u200b"]) {
    const note = recipeNoteWords({ code: "wordless", facet: "course", value });
    assert.equal(note.text, "Readers can't browse by a course with no name. Give it a word, like Dessert.", JSON.stringify(value));
  }
  assert.equal(recipeNoteWords({ code: "wordless", facet: "cuisine", value: "🍰" }).text, "Readers can't browse by a cuisine with no name. Give it a word, like Italian.");
  assert.deepEqual(recipeNoteWords({ code: "wordless", facet: "course", value: "???" }).details, ["code wordless", "course \"???\""]);
  const pie = recipeNoteWords({ code: "filter-taken", facet: "course", value: "Pie", page: { path: "series/pie.md", kind: "series", title: "Pie" } });
  assert.equal(pie.open.href, "#/collection/series%2Fpie.md");
  assert.equal(pie.text, "Your collection “Pie” is using the spot for Pie recipes, so readers can't browse by Pie.");
  assert.equal(recipeNoteWords({ code: "filter-taken", facet: "course", value: "!!", page: { path: "series/x.md", kind: "series", title: "X" } }).text, "Your collection “X” is using the spot for one of your courses, so readers can't browse by it.");
  assert.equal(recipeNoteWords({ code: "what" }), null);
  assert.equal(recipeNoteWords(null), null);
  const every = [taken, alias, recipeNoteWords({ code: "no-address" }), recipeNoteWords({ code: "wordless", value: "???" }), pie];
  for (const note of every) {
    assert.doesNotMatch(`${note.text} ${note.help}`, /Settings|Slug|Admin|address|\/|\?\?\?/, note.text);
  }
});
