// Research's own rules (Studio R11), with the route and workflow cases of the old Admin's
// admin-research-workspace.test.mjs: old addresses open their Studio screens, Research home's
// steps say how far research has come and which is next, forms are kept in memory while she moves
// within research, a site that doesn't use research gets none of it (G92), and every code a
// research answer can carry has her words (a fixture per value of the Rust enums, so a new code
// fails here). The old panel-chrome cases (landmarks of the old shell) go in R15.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  RESEARCH_CODES, RESEARCH_NOT_YET, keptKey, keptWords, researchHash, researchProblem, researchRoute, researchUsed, researchWords, workflowSteps,
} from "../../web/studio/parts/research-rules.js";
import { legacyRoute } from "../../web/studio/router.js";
import { dropAll, dropForm, keepForm, keptForms, peekForm, takeForm } from "../../web/studio/parts/research-kept.js";
import { researchFind } from "../../web/studio/parts/research-find.js";
import { addItems } from "../../web/studio/parts/add-words.js";
import { kindChoices } from "../../web/studio/parts/profile-words.js";
import { HER_BANNED } from "../../web/studio/parts/plain-words.js";

class ApiError extends Error { constructor(message, status, data) { super(message); this.status = status; this.data = data; } }

test("research screens share one address space, and the earlier addresses open the same places", () => {
  assert.equal(researchHash("overview"), "#/research");
  assert.equal(researchHash("sources", "plato"), "#/research/sources/plato");
  assert.equal(researchHash("notebook", "the good/2"), "#/research/notebook/the%20good%2F2", "an item id is one encoded segment");
  assert.equal(researchHash("public", "x"), "#/research/public", "What readers see opens no item by id");
  assert.equal(researchHash("missing"), "#/research");
  assert.equal(legacyRoute("#/sources"), "#/research/sources");
  assert.equal(legacyRoute("#/sources/plato?x=1"), "#/research/sources/plato?x=1", "the item and query are kept");
  assert.equal(legacyRoute("#/research/overview"), "#/research");
  assert.equal(legacyRoute("#/research"), null, "bare #/research is Research home, Studio's own (decision 11)");
  assert.equal(legacyRoute("#/research/notebook"), null);
  assert.equal(legacyRoute("#/research/sources/plato"), null);
  assert.equal(legacyRoute("#/research/<img src=x>"), "#/research", "an unknown research screen opens home");
  for (const hash of ["#/research/atlas", "#/atlas/plato", "#/compare/opening?layout=x", "#/research/public"]) {
    assert.equal(legacyRoute(hash), RESEARCH_NOT_YET.size ? "#/not-yet/research" : legacyRoute(hash), `${hash} waits for R12`);
  }
  assert.equal(legacyRoute("#/edit/posts%2Fa.md?pane=evidence"), "#/write/posts%2Fa.md?sheet=research");
  for (const hash of ["#/posts", "#/write", "#/"]) assert.equal(researchRoute(hash.replace(/^#\//, ""), [], ""), undefined, `${hash} is not research's`);
});

test("an empty library leads to the first source; the next step follows what's done; Back to your post when one is open", () => {
  const empty = workflowSteps({ library: { sources: [] }, notebook: { passages: [], notes: [] } });
  assert.equal(empty.empty, true);
  assert.deepEqual(empty.steps.map((s) => [s.id, s.done, s.visibility]), [["source", false, "private"], ["passage", false, "private"], ["cite", false, "readers"]]);
  assert.deepEqual(empty.primary, { label: "Add your first source", href: "#/research/sources?new=1", step: "source" });
  assert.equal(empty.steps[0].state, "Not started: your library is empty.");

  const sources = { sources: [{ id: "a", kind: "work" }, { id: "old", kind: "work", archived: true }] };
  const some = workflowSteps({ library: sources, notebook: { passages: [], notes: [] } });
  assert.equal(some.steps[0].state, "1 sources in your library.", "archived sources aren't counted");
  assert.equal(some.primary.step, "passage");
  assert.equal(some.primary.href, "#/research/notebook?new=passage");

  const done = workflowSteps({ library: sources, notebook: { passages: [{ id: "p1" }, { id: "p2" }], notes: [{ id: "n1" }] }, post: { path: "posts/a.md", title: "<script>x</script>" } });
  assert.equal(done.steps[1].state, "2 passages and 1 notes.");
  assert.equal(done.steps[2].state, "Your post: “<script>x</script>”", "a title is text");
  assert.deepEqual(done.primary, { label: "Back to your post", href: "#/write/posts%2Fa.md", step: "cite" });
  assert.equal(workflowSteps({ library: sources, notebook: { passages: [{ id: "p" }], notes: [] } }).primary.label, "Start a research post");
});

test("a store that can't be read is said in its own step, and the other still reports its own state", () => {
  const plan = workflowSteps({ library: { failed: true }, notebook: { passages: [{ id: "p1" }], notes: [] } });
  assert.equal(plan.steps[0].state, "Your source library can't be read, so nothing here changed.");
  assert.equal(plan.steps[1].state, "1 passages and 0 notes.");
  assert.notEqual(plan.primary.step, "source", "an unreadable library is never the next step");
});

test("forms are kept in memory while she moves within research, and said in the banner", () => {
  dropAll();
  assert.equal(keptWords(keptForms()), "");
  keepForm(keptKey("sources", "new"), { screen: "sources", id: "new", name: "Phaedo", hash: "#/research/sources?new=1", state: { draft: { title: "Phaedo" } } });
  assert.equal(keptWords(keptForms()), "You have an unsaved source: “Phaedo”.");
  keepForm(keptKey("notebook", "passage-1"), { screen: "notebook", id: "passage-1", what: "passage", name: "Republic, page 514", hash: "#/research/notebook/passage-1", state: {} });
  assert.equal(keptWords(keptForms()), "You have 2 unsaved changes in your research.");
  assert.equal(peekForm("sources:new").name, "Phaedo");
  assert.equal(takeForm("sources:new").state.draft.title, "Phaedo", "it comes back as she left it");
  assert.equal(peekForm("sources:new"), null, "and is no longer kept once open again");
  dropForm("notebook:passage-1");
  assert.deepEqual(keptForms(), []);
  // Nothing about kept forms reaches storage.
  const source = readFileSync(new URL("../../web/studio/parts/research-kept.js", import.meta.url), "utf8");
  assert.doesNotMatch(source.replace(/\/\/.*$/gm, ""), /localStorage|sessionStorage|indexedDB/);
});

test("a site that doesn't use research gets none of it: no Add something items, no Find entries but the door, no Research kind", () => {
  const plain = { siteUses: { trade: false }, profiles: [{ id: "article" }, { id: "recipe" }, { id: "research" }] };
  const used = { siteUses: { research: true }, profiles: plain.profiles };
  assert.equal(researchUsed(plain), false);
  assert.equal(researchUsed({}), false, "until a server says, never");
  assert.equal(researchUsed(used), true);
  const ids = (meta, post) => { const g = addItems(meta, post); return [...g.most, ...g.more, ...g.details].map((item) => item.id); };
  assert.ok(!ids(plain, {}).includes("cite") && !ids(plain, {}).includes("quotation"));
  assert.ok(ids(used, {}).includes("cite"));
  assert.deepEqual(addItems(used, { kind: "research" }).most.slice(-2).map((item) => item.id), ["cite", "quotation"], "first group on a research post");
  assert.deepEqual(researchFind(plain).map((item) => item.href), ["#/research"], "the developer's door, and only that");
  assert.match(researchFind(plain)[0].label, /^Start research \(for /);
  assert.ok(researchFind(used).length > 5);
  // About this post passes the gate (about-post.js): Research is offered only on a site that uses it.
  assert.ok(!kindChoices(plain, "article", { research: researchUsed(plain) }).some((choice) => choice.value === "research"));
  assert.ok(kindChoices(used, "article", { research: researchUsed(used) }).some((choice) => choice.value === "research"), "decision 1");
});

// ---- every code a research answer can carry

/** The kebab-case values of a Rust enum, read from the source so a new value fails this test. */
function rustCodes(file, name) {
  const text = readFileSync(new URL(`../../crates/openblog-core/src/${file}`, import.meta.url), "utf8");
  const start = text.indexOf(`pub enum ${name} {`);
  assert.ok(start >= 0, `${name} in ${file}`);
  const body = text.slice(start, text.indexOf("\n}", start));
  return [...body.matchAll(/^\s{4}([A-Z][A-Za-z0-9]*)\s*[,({]/gm)].map((m) => m[1].replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase());
}

const ENUMS = [["source_library.rs", "SourceDiagnosticCode", "sources"], ["research_notes.rs", "NoteDiagnosticCode", "notebook"], ["citations.rs", "CitationDiagnosticCode", "cite"]];

for (const [file, name, place] of ENUMS) {
  test(`every ${name} has her words, on a field or in a banner`, () => {
    const codes = rustCodes(file, name);
    assert.ok(codes.length >= 8, `${name}: ${codes.length} codes`);
    for (const code of codes) {
      assert.ok(RESEARCH_CODES.has(code), `${code} (${name}) is mapped`);
      const problem = researchProblem(new ApiError("x", 422, { error: "The server's own sentence", diagnostics: [{ code, field: "title", message: "m" }] }), place);
      const words = researchWords(problem);
      assert.ok(words, `${code} says something`);
      assert.doesNotMatch(words, HER_BANNED, `${code}: ${words}`);
      assert.doesNotMatch(words, /The server's own sentence|\b422\b|diagnostic/, `${code}: the server's sentence and code stay in details`);
      assert.match(problem.details, new RegExp(code === "invalid-json" || code === "unsupported-version" ? code : code), "the code is in details");
    }
  });
}

test("each kind of answer is said in her words, on the right field", () => {
  const p = (status, data, place = "sources") => researchProblem(new ApiError("x", status, data), place);
  assert.equal(p(0, null).id, "research.noSignal");
  assert.equal(p(0, null).signal, true);
  assert.equal(p(401, null).signedOut, true);
  assert.equal(p(500, { error: "disk" }).id, "research.serverDown");
  assert.equal(p(409, { code: "changed", conflict: true }).id, "sources.conflict");
  assert.equal(p(409, { conflict: true }, "notebook").id, "notebook.conflict");
  assert.equal(p(409, { conflict: true }, "cite").field, "source");
  assert.equal(p(413, { code: "too-large" }).id, "research.tooLarge");
  assert.equal(p(413, {}, "import").id, "sources.importTooBig");
  assert.equal(p(400, { code: "bad-request" }).id, "research.failed");
  assert.equal(p(422, { code: "unreadable", codes: ["invalid-json"] }).id, "research.unreadable");
  assert.equal(researchWords(p(422, { code: "unreadable" })), "Your source library can't be read, so nothing here changed. Tell the person who set up your site.");
  assert.deepEqual([p(422, { diagnostics: [{ code: "missing-field", field: "title" }] }).field, p(422, { diagnostics: [{ code: "missing-field", field: "title" }] }).id], ["title", "sources.needTitle"]);
  assert.deepEqual([p(422, { diagnostics: [{ code: "invalid-identifier", field: "identifiers[2]" }] }).field, p(422, { diagnostics: [{ code: "invalid-identifier", field: "identifiers[2]" }] }).row], ["identifiers", 2]);
  assert.equal(p(422, { diagnostics: [{ code: "duplicate-id", field: "id" }] }, "notebook").banner, true, "notebook ids are automatic: details only");
  assert.equal(p(422, { diagnostics: [{ code: "still-linked", field: "id", count: 3 }] }, "notebook").vars.count, 3);
  assert.equal(p(422, { diagnostics: [{ code: "never-heard-of-it", field: "title" }] }).id, "research.checkField", "an unknown code on a known field");
  assert.equal(p(422, { diagnostics: [{ code: "never-heard-of-it" }] }).id, "research.failed", "else a banner");
});

test("research's her-layer words name no system thing and no persona", async () => {
  const catalogs = [await import("../../web/studio/parts/research-words.js"), await import("../../web/studio/parts/cite-words.js")];
  const SYSTEM = /\b(revision|\.openblog|payload|projection|manifest|boundary|curation|diagnostic|anchor|offset|schema|openblog\.json|ADR|capture|Studio|Admin)\b/i;
  const PERSONA = /Grammi|Mikey|Ruth|Elkins|Dana|Pumpkin/;
  for (const { WORDS } of catalogs) {
    for (const [id, entry] of Object.entries(WORDS)) {
      assert.doesNotMatch(entry.text, PERSONA, id);
      if (entry.layer !== "her") continue;
      assert.doesNotMatch(entry.text, SYSTEM, id);
      assert.doesNotMatch(entry.text.replace(new RegExp(`\\b(${(entry.allows || []).join("|") || "-"})\\b`, "gi"), ""), HER_BANNED, id);
      assert.doesNotMatch(entry.text, /\{owner\}/, `${id}: research words never use {owner}`);
    }
  }
});

test("a research check's finding opens its source, passage or note", async () => {
  const { openItHash } = await import("../../web/studio/parts/research-rules.js");
  assert.equal(openItHash({ object: "source", id: "plato-republic" }), "#/research/sources/plato-republic");
  assert.equal(openItHash({ object: "passage", id: "p 1" }), "#/research/notebook/p%201");
  assert.equal(openItHash({ object: "note", id: "n1" }), "#/research/notebook/n1");
  assert.equal(openItHash({ object: "post", id: "x" }), "");
  assert.equal(openItHash({ object: "source" }), "");
});
