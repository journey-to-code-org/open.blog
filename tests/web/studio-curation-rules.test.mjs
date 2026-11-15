// For readers' rules (Studio R12), ported from admin-curation.test.mjs: the pure cases. The view
// cases are in tests/browser/studio-for-readers.spec.mjs.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as rules from "../../web/studio/parts/curation-rules.js";
import { sayId } from "../../web/studio/parts/research-says.js";
const { CURATION_KINDS,curationKindWords,CURATION_WHY,curationWhyWords,CURATION_FIELDS,curationFieldWords,curationValueText,curationItemRows,curationSelectionName,curationStatusText,curationMove,curationPostSlug } = rules;

// Selected for readers (#196, ADR 0195, ADR 0196): the author's view of the selections inside the
// draft-side research panel. The view is the shared fixture the Rust tests pin byte for byte
// (tests/fixtures/curated-selections/view.json), so the page is tested against exactly what the
// server sends: what readers get, what is withheld and why, notices, ordering, and the forms that
// select, withdraw, select again and unselect, with revision checks, failures that change nothing,
// and focus that stays where the author is.

const FIXTURE = readFileSync(new URL("../fixtures/curated-selections/view.json", import.meta.url), "utf8");

const view = () => JSON.parse(FIXTURE);

const PRIVATE = "PRIVATE-CURATION-MARKER";

/** A fake server: every call is recorded; `answer` decides the reply to a change. */
function server(initial = view(), answer = () => null) {
  const calls = [];
  const state = { view: initial };
  return {
    calls,
    state,
    async call(method, path, options = {}) {
      const body = options.json === undefined ? undefined : structuredClone(options.json);
      calls.push({ method, path, body });
      if (method === "GET" && path.startsWith("research/curation")) return structuredClone(state.view);
      const reply = answer(method, path, body, state);
      if (reply instanceof Error) throw reply;
      if (reply) return structuredClone(reply);
      throw new ApiError(`unexpected ${method} ${path}`, 500, null);
    },
  };
}

async function mount(api, post = "cave", options = {}) {
  const section = createCurationSection({ api, getPost: () => post, ...options });
  document.body.append(section.element);
  await section.load();
  return { section, root: section.element, api };
}

const all = (root, tag) => root.querySelectorAll(tag);

const named = (root, text) => all(root, "button").find((node) => node.textContent === text || node.getAttribute("aria-label") === text) || null;

const click = (node) => node.dispatch("click");

const text = (node) => node.textContent.replace(/\s+/g, " ").trim();

const itemNode = (root, id) => all(root, "li").find((node) => node.dataset.curationItem === id) || null;

const given = (root) => all(all(root, "ol").find((node) => node.dataset.curationGiven === "true") || root, "li").filter((node) => node.dataset.curationItem).map((node) => node.dataset.curationItem);

const held = (root) => all(root, "li").filter((node) => node.dataset.curationItem && node.dataset.curationStatus === "withheld").map((node) => node.dataset.curationItem);

const previewed = (root) => all(root, "li").filter((node) => node.dataset.curationPreviewed).map((node) => node.dataset.curationPreviewed);

const alertText = (root) => {
  const box = all(root, "p").find((node) => node.dataset.curationError === "true");
  return box && !box.hidden ? box.textContent : "";
};

const status = (root) => all(root, "p").find((node) => node.dataset.curationStatus === "true")?.textContent || "";

// ---------------------------------------------------------------- the pure parts

test("the words for kinds, reasons and values never judge the research", () => {
  assert.deepEqual([...CURATION_KINDS].sort(), ["comparison", "contextual-entry", "explanation", "reference", "relationship", "source-annotation", "timeline"]);
  for (const kind of CURATION_KINDS) assert.ok(curationKindWords(kind), `${kind} has words`);
  for (const why of ["withdrawn", "stale", "target-missing", "not-approved", "not-published", "source-private", "post-not-published", "dependency-missing", "dependency-withheld", "cycle"]) {
    assert.ok(CURATION_WHY.includes(why), `${why} is known`);
    assert.doesNotMatch(curationWhyWords(why), /\b(score|verdict|false|true|wrong|credible|accepted)\b/i);
  }
  assert.equal(curationValueText({ kind: "author" }), "you");
  assert.equal(curationValueText({ kind: "named", name: "A later editor" }), "A later editor");
  assert.equal(curationValueText({ kind: "source", source: "scholar" }), "scholar");
  assert.equal(curationValueText([{ source: "burnet", locators: [{ kind: "page", value: "514", to: "515" }] }, "x"]), "burnet, page 514 to 515; x");
  assert.equal(curationValueText(null), "");
  assert.equal(curationPostSlug(" The Cave: Déjà vu! "), "the-cave-déjà-vu");
  assert.equal(curationPostSlug("!!!"), "");
});

test("moving a selection never leaves the list or loses another", () => {
  assert.deepEqual(curationMove(["a", "b", "c"], "b", -1), ["b", "a", "c"]);
  assert.deepEqual(curationMove(["a", "b", "c"], "b", 1), ["a", "c", "b"]);
  assert.deepEqual(curationMove(["a", "b", "c"], "a", -1), ["a", "b", "c"], "the first cannot go up");
  assert.deepEqual(curationMove(["a", "b", "c"], "c", 1), ["a", "b", "c"], "the last cannot go down");
  assert.deepEqual(curationMove(["a", "b"], "z", 1), ["a", "b"], "an unknown id changes nothing");
});

test("each item reads back from the public value, in the order its fields are listed", () => {
  const data = view();
  const relationship = data.preview.items.find((item) => item.kind === "relationship");
  const rows = curationItemRows(relationship);
  assert.ok(rows.some((row) => row.label === "Who says so"), "attribution is shown");
  assert.ok(rows.some((row) => row.label === "How firmly"), "confidence is shown");
  assert.ok(rows.some((row) => row.label === "The evidence"), "evidence is shown");
  assert.ok(rows.every((row) => row.value !== ""), "no empty row");
  const entry = data.preview.items.find((item) => item.kind === "contextual-entry" && item.target === "plato");
  assert.deepEqual(curationItemRows(entry).map((row) => row.name).slice(0, 2), ["label", "id"]);
  assert.match(curationItemRows(entry).find((row) => row.name === "summary").value, /Athenian philosopher/);
  assert.equal(curationSelectionName({ kind: "reference", label: "Platonis Opera", target: "burnet" }), "Reference: Platonis Opera");
  assert.equal(curationStatusText({ status: "published" }), "Shown to readers");
  assert.equal(curationStatusText({ status: "withheld", why: "stale" }), curationWhyWords("stale"));
});

// ---------------------------------------------------------------- in the research panel

const panelData = () => ({
  library: {
    revision: "lib-1",
    sources: [
      { id: "burnet", kind: "edition", of: "republic", title: "Platonis Opera" },
      { id: "diary", kind: "work", title: "A private diary" },
    ],
    interpretations: [],
  },
  notebook: { revision: "nb-1", passages: [], notes: [] },
  atlas: {
    publish: true,
    url: "/atlas/",
    entries: [
      { id: "plato", kind: "person", label: "Plato", aliases: [], approved: true, url: "/atlas/plato/", datings: [{ id: "plato-birth-a", aspect: "birth", text: "428 BCE" }] },
      { id: "secret", kind: "concept", label: "A private entry", aliases: [], approved: false, url: null, datings: [] },
    ],
  },
  comparisons: { publish: true, url: "/comparisons/", items: [{ id: "cave", label: "The cave", approved: true, url: "/comparisons/cave/", interpretations: [] }] },
});

function panelServer(extra = () => null) {
  const research = panelData();
  const curation = view();
  curation.candidates.sources = [{ id: "burnet", label: "Platonis Opera" }];
  return {
    calls: [],
    async call(method, path, options = {}) {
      this.calls.push({ method, path, body: options.json });
      if (method === "GET" && path === "research/draft") return structuredClone(research);
      if (method === "GET" && path.startsWith("research/curation")) return structuredClone(curation);
      const reply = extra(method, path, options.json);
      if (reply) return reply;
      throw new ApiError(`unexpected ${method} ${path}`, 500, null);
    },
  };
}

