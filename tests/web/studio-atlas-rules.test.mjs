// The atlas's rules (Studio R12), ported from the old Admin's admin-research-atlas.test.mjs: the
// pure cases (drafts, payloads that keep every field, checks, datings, chronology). The view cases
// of the old shell are in tests/browser/studio-atlas.spec.mjs. Checks now return word ids.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import * as rules from "../../web/studio/parts/atlas-rules.js";
import { sayId } from "../../web/studio/parts/research-says.js";
const { textLines,keepUnchanged,NOTEBOOK_SLUG,codePoints,ATLAS_ENTRY_KINDS,ATLAS_CONFIDENCE,entryKindWords,firmWords,MAX_ATLAS_SHORT_CHARS,MAX_ATLAS_SUMMARY_CHARS,MAX_ATLAS_UNCERTAINTY_CHARS,MAX_ATLAS_ALIASES,MAX_ATLAS_EVIDENCE,MAX_ATLAS_DISSENTS,sameLocator,plural,validAtlasId,suggestAtlasId,foldAtlasText,atlasFilterEntries,atlasKindSpec,atlasEndpointChoices,atlasEntryName,atlasAttributionText,atlasStandingText,atlasConfidenceText,atlasEvidenceText,atlasRelationshipSentence,atlasLinkLine,atlasDiagnosticControl,atlasBuildText,atlasErrorMessage,atlasAttributionDraft,atlasAttributionPayload,atlasEvidenceDraft,atlasEvidencePayload,atlasEntryDraft,atlasEntryPayload,validateAtlasEntryDraft,atlasRelationshipDraft,atlasDissentDraft,rebaseAtlasRelationshipDraft,atlasRelationshipPayload,atlasPartyProblem,atlasEvidenceProblem,validateAtlasRelationshipDraft,ATLAS_ASPECTS,SHORT_MONTHS,MONTH_NAMES,DATE_SLOTS,DATE_SLOT_IDS,FORM_SLOTS,DATE_FORM_KEYS,POINT_KEYS,RELATIVE_KEYS,DATING_KEYS,DEFAULT_MAX_DATINGS,DEFAULT_MAX_YEAR,aspectNoun,extrasOf,wholeNumber,daysInMonth,atlasAspects,atlasYearText,eraYear,yearEra,ordinal,atlasPointText,atlasDateText,atlasPointDraft,atlasPointPayload,atlasDatingDraft,atlasDatingPayload,atlasDatingReading,pointKeys,compareKeys,notReversed,atlasPointProblem,validateAtlasDatings,rebaseAtlasEvidence,rebaseAtlasDatings,rebaseAtlasEntryDraft,atlasDatesText,atlasChronologyWindow,atlasChronologyGroupLabel,atlasOwnerName,atlasChronologyModel,atlasChronologyStatus } = rules;



// ---------------------------------------------------------------- DOM shim

class DomNode {
  constructor(tag = "", owner = null) {
    this.tagName = tag.toUpperCase();
    this.children = [];
    this.parent = null;
    this.attributes = {};
    this.listeners = {};
    this.dataset = {};
    this.style = {};
    this.owner = owner;
    this.hidden = false;
    this.disabled = false;
    this.checked = false;
    this.selected = false;
    this.open = false;
    this._text = "";
    this._value = undefined;
    this.classList = { contains: (name) => (this.className || "").split(/\s+/).includes(name) };
  }
  get value() {
    if (this.tagName === "SELECT" && this._value === undefined) return this.children.find((child) => child.selected)?.value ?? this.children[0]?.value ?? "";
    return this._value ?? "";
  }
  set value(value) {
    this._value = String(value);
  }
  append(...children) {
    for (const child of children.flat()) {
      if (child === null || child === undefined || child === false) continue;
      const node = child instanceof DomNode ? child : Object.assign(new DomNode("#text"), { textContent: String(child) });
      node.parent?.children.splice(node.parent.children.indexOf(node), 1);
      node.parent = this;
      this.children.push(node);
    }
  }
  replaceChildren(...children) {
    for (const child of this.children) child.parent = null;
    this.children = [];
    this.append(...children);
  }
  remove() {
    if (this.parent) this.parent.children.splice(this.parent.children.indexOf(this), 1);
    this.parent = null;
  }
  setAttribute(name, value) {
    this.attributes[name] = String(value);
    if (name === "id") this.id = String(value);
    if (name === "hidden") this.hidden = true;
    if (name.startsWith("data-")) this.dataset[name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase())] = String(value);
  }
  contains(node) {
    for (let current = node; current; current = current.parent) if (current === this) return true;
    return false;
  }
  removeAttribute(name) {
    delete this.attributes[name];
  }
  get isConnected() {
    for (let node = this; node; node = node.parent) if (node === this.owner?.body) return true;
    return false;
  }
  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
  addEventListener(name, listener, options = {}) {
    (this.listeners[name] ||= []).push({ listener, once: Boolean(options.once) });
  }
  dispatch(name, event = {}) {
    const listeners = this.listeners[name] || [];
    this.listeners[name] = listeners.filter((entry) => !entry.once);
    const payload = { type: name, target: this, currentTarget: this, preventDefault() {}, ...event };
    return Promise.all(listeners.map((entry) => entry.listener(payload)));
  }
  click() {
    if (this.disabled) return Promise.resolve();
    return this.dispatch("click");
  }
  focus() {
    // Like a browser: only controls, links and elements with a tabindex take focus, and never while disabled.
    const focusable = ["INPUT", "SELECT", "TEXTAREA", "BUTTON"].includes(this.tagName) || (this.tagName === "A" && "href" in this.attributes) || "tabindex" in this.attributes;
    if (!focusable || this.disabled) return;
    this.owner.activeElement = this;
  }
  showModal() {
    this.open = true;
  }
  close() {
    if (!this.open) return;
    this.open = false;
    // Browsers queue the close event as a task, after the code that closed the dialog.
    setTimeout(() => this.dispatch("close"), 0);
  }
  set textContent(value) {
    this.children = [];
    this._text = String(value);
  }
  get textContent() {
    return this._text + this.children.map((child) => child.textContent).join("");
  }
  matches(selector) {
    if (selector.startsWith("#")) return this.id === selector.slice(1);
    if (selector.startsWith(".")) return this.classList.contains(selector.slice(1));
    const attribute = selector.match(/^([a-z]*)\[([a-z-]+)\]$/);
    if (attribute) {
      const [, tag, name] = attribute;
      if (tag && this.tagName !== tag.toUpperCase()) return false;
      if (name === "open") return this.open;
      if (name.startsWith("data-")) return name.slice(5).replace(/-([a-z])/g, (_, letter) => letter.toUpperCase()) in this.dataset;
      return name in this.attributes;
    }
    return this.tagName === selector.toUpperCase();
  }
  querySelectorAll(selector) {
    const found = [];
    const visit = (node) => {
      for (const child of node.children) {
        if (child.matches(selector)) found.push(child);
        visit(child);
      }
    };
    visit(this);
    return found;
  }
  querySelector(selector) {
    return this.querySelectorAll(selector)[0] || null;
  }
}

function installDom() {
  const previous = { Node: globalThis.Node, document: globalThis.document, location: globalThis.location, open: globalThis.open, localStorage: globalThis.localStorage };
  const documentShim = {
    activeElement: null,
    documentElement: { dataset: {} },
    title: "",
    createElement: (tag) => new DomNode(tag, documentShim),
    createTextNode: (text) => Object.assign(new DomNode("#text", documentShim), { textContent: String(text) }),
    querySelector: (selector) => documentShim.body.querySelector(selector),
  };
  documentShim.body = new DomNode("body", documentShim);
  globalThis.Node = DomNode;
  globalThis.document = documentShim;
  globalThis.location = { hash: "#/overview" };
  return {
    document: documentShim,
    restore() {
      for (const [name, value] of Object.entries(previous)) {
        if (value === undefined) delete globalThis[name];
        else globalThis[name] = value;
      }
    },
  };
}

const withDom = (run) => async () => {
  const dom = installDom();
  try {
    await run(dom);
  } finally {
    dom.restore();
  }
};

// ---------------------------------------------------------------- fixtures

class ApiError extends Error {
  constructor(message, status, data) {
    super(message);
    this.status = status;
    this.data = data;
  }
}

const HOSTILE = '<img src=x onerror="alert(1)"> Πλάτων 🙂 <script>alert(2)</script>';

const ANY = ["person", "work", "concept", "movement", "event"];

const KINDS = () => ({
  entries: ANY,
  relationships: [
    { kind: "authored", inverse: "authored by", from: ["person"], to: ["work"], symmetric: false, sameKind: false, acyclic: false },
    { kind: "influenced", inverse: "influenced by", from: ANY, to: ANY, symmetric: false, sameKind: false, acyclic: false },
    { kind: "member-of", inverse: "has member", from: ["person"], to: ["movement"], symmetric: false, sameKind: false, acyclic: false },
    { kind: "part-of", inverse: "has part", from: ["work", "concept", "movement", "event"], to: ["work", "concept", "movement", "event"], symmetric: false, sameKind: true, acyclic: true },
    { kind: "specializes", inverse: "generalized by", from: ["concept"], to: ["concept"], symmetric: false, sameKind: false, acyclic: true },
    { kind: "related-to", inverse: "related to", from: ANY, to: ANY, symmetric: true, sameKind: false, acyclic: false },
  ],
  aspects: [
    { aspect: "span", durative: true, entries: ANY, relationship: true },
    { aspect: "birth", durative: false, entries: ["person"], relationship: false },
    { aspect: "death", durative: false, entries: ["person"], relationship: false },
    { aspect: "active", durative: true, entries: ["person", "movement"], relationship: false },
    { aspect: "composition", durative: true, entries: ["work"], relationship: false },
    { aspect: "publication", durative: false, entries: ["work"], relationship: false },
    { aspect: "emergence", durative: false, entries: ["concept", "movement"], relationship: false },
  ],
  orders: ["before", "after", "during"],
  maxDatings: 20,
  maxYear: 100000,
});

const SOURCES = () => [
  { id: "plato-republic", kind: "work", title: "Πολιτεία" },
  { id: "slings-2003", kind: "edition", of: "plato-republic", title: "Platonis Rempublicam" },
  { id: "gone", kind: "work", title: "Gone", archived: true },
];

const PASSAGES = () => [{ id: "passage-1", source: "slings-2003", locators: [{ kind: "page", value: "514" }], preview: "the cave" }];

const ENTRIES = () => [
  { id: "plato", kind: "person", label: HOSTILE, aliases: ["Aristocles"], visibility: "private", shelf: 1 },
  { id: "politeia", kind: "work", label: "Politeia", source: "plato-republic", dates: [{ id: "politeia-composed", aspect: "composition", date: { notBefore: { year: -380, circa: true } }, assertedBy: { kind: "author" }, unsourced: true, confidence: "tentative", visibility: "private", shelf: 2 }], visibility: "approved" },
  { id: "allegory", kind: "concept", label: "Allegory", visibility: "private" },
  { id: "academy", kind: "movement", label: "The Academy", visibility: "private" },
];

const RELATIONSHIP = () => ({
  id: "plato-authored-politeia",
  kind: "authored",
  from: "plato",
  to: "politeia",
  assertedBy: { kind: "author", why: "kept" },
  confidence: "plausible",
  evidence: [{ source: "slings-2003", locators: [{ kind: "page", value: "514", hint: true }], margin: "kept" }],
  uncertainty: "The dating is unsettled.",
  contestedBy: [{ by: { kind: "named", name: "A later editor" }, note: "Doubts the attribution.", tag: "kept" }],
  visibility: "private",
  extra: 7,
});

const atlas = (over = {}) => ({
  file: ".openblog/private/research/atlas.json",
  revision: "r1",
  stored: true,
  entries: ENTRIES(),
  relationships: [RELATIONSHIP()],
  notices: [],
  missingConcepts: [],
  kinds: KINDS(),
  sources: SOURCES(),
  passages: PASSAGES(),
  ...over,
});

const EXPLORE = {
  plato: () => ({ revision: "r1", entry: ENTRIES()[0], outgoing: [{ label: "authored", other: { id: "politeia", kind: "work", label: "Politeia" }, standing: "contested", projected: false, relationship: RELATIONSHIP() }], incoming: [], notes: [] }),
  politeia: () => ({ revision: "r1", entry: ENTRIES()[1], outgoing: [], incoming: [{ label: "authored by", other: { id: "plato", kind: "person", label: HOSTILE }, standing: "contested", projected: false, relationship: RELATIONSHIP() }], notes: [] }),
  allegory: () => ({ revision: "r1", entry: ENTRIES()[2], outgoing: [], incoming: [], notes: [{ id: "note-2", kind: "question", preview: "Why a cave?" }] }),
  academy: () => ({ revision: "r1", entry: ENTRIES()[3], outgoing: [], incoming: [], notes: [] }),
};

function atlasApi(handlers = {}) {
  const calls = [];
  const all = {
    "GET research/atlas": () => atlas(),
    "POST research/atlas/explore": (body) => {
      const found = EXPLORE[body.id];
      if (!found) throw new ApiError("missing", 404, { error: "No atlas entry has this id", missing: true });
      return found();
    },
    ...handlers,
  };
  return {
    calls,
    async call(method, path, options = {}) {
      if (method !== "GET" && path !== "research/atlas/explore") calls.push({ method, path, body: structuredClone(options.json) });
      const handler = all[`${method} ${path}`];
      if (!handler) throw new ApiError(`unexpected ${method} ${path}`, 500, null);
      return handler(options.json);
    },
  };
}

function mountAtlas(api) {
  const app = new ObAdmin();
  const root = new DomNode("div", globalThis.document);
  app.api = api;
  app.meta = { siteTitle: "Blog" };
  app.preferences = normalizeAdminPreferences({ preset: "advanced" });
  app.replaceChildren = (...nodes) => root.replaceChildren(...nodes);
  return { app, root };
}

const byId = (root, id) => root.querySelector(`#${id}`);

const type = async (control, value, event = "input") => {
  control.value = value;
  await control.dispatch(event, { target: control });
};

const choose = (control, value) => type(control, value, "change");

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

const submit = (root) => root.querySelector("form").dispatch("submit");

const buttonLabelled = (root, text) => root.querySelectorAll("button").find((button) => button.textContent === text);

const entryIds = (root) => root.querySelectorAll("button").filter((button) => button.dataset.atlasEntry).map((button) => button.dataset.atlasEntry);

const options = (select) => select.children.map((option) => option.value).filter(Boolean);

const optionText = (select) => select.children.map((option) => option.textContent);

// ---------------------------------------------------------------- pure helpers

test("entries filter by kind and by any word of the id, label or other names", () => {
  const entries = ENTRIES();
  assert.deepEqual(atlasFilterEntries(entries, { kind: "work" }).map((entry) => entry.id), ["politeia"]);
  assert.deepEqual(atlasFilterEntries(entries, { query: "aristocles" }).map((entry) => entry.id), ["plato"]);
  assert.deepEqual(atlasFilterEntries(entries, { query: "  ΠΛΆΤΩΝ " }).map((entry) => entry.id), ["plato"]);
  assert.deepEqual(atlasFilterEntries(entries, { query: "the academy" }).map((entry) => entry.id), ["academy"]);
  assert.deepEqual(atlasFilterEntries(entries, { query: "academy", kind: "person" }), []);
  assert.equal(atlasFilterEntries(entries, {}).length, 4);
});

test("endpoint pickers offer only the entry kinds a relationship kind may join", () => {
  const entries = ENTRIES();
  const ids = (list) => list.map((entry) => entry.id);
  assert.deepEqual(ids(atlasEndpointChoices(KINDS(), "authored", "from", entries)), ["plato"]);
  assert.deepEqual(ids(atlasEndpointChoices(KINDS(), "authored", "to", entries)), ["politeia"]);
  assert.deepEqual(ids(atlasEndpointChoices(KINDS(), "member-of", "to", entries)), ["academy"]);
  // part-of joins two entries of one kind; the other end narrows the choice and is never offered itself.
  const work = entries[1];
  assert.deepEqual(ids(atlasEndpointChoices(KINDS(), "part-of", "to", [...entries, { id: "book-7", kind: "work", label: "Book 7" }], work)), ["book-7"]);
  assert.ok(!ids(atlasEndpointChoices(KINDS(), "influenced", "to", entries, entries[0])).includes("plato"), "no self-relationship");
  assert.equal(atlasEndpointChoices(KINDS(), "", "from", entries).length, 4, "with no kind, every entry");
});

test("identifiers are readable slugs that nothing uses yet", () => {
  assert.equal(suggestAtlasId("Théodore of Cyrene", []), "theodore-of-cyrene");
  assert.equal(suggestAtlasId("Πολιτεία", [], "work"), "work");
  assert.equal(suggestAtlasId("Plato", ["plato", "plato-2"]), "plato-3");
  assert.ok(suggestAtlasId("x".repeat(200)).length <= 64);
  assert.ok(validAtlasId("the-good") && !validAtlasId("The Good") && !validAtlasId("a--b") && !validAtlasId("x".repeat(65)));
});

test("standing is asserted or contested by named parties, and never consensus", () => {
  const sources = SOURCES();
  assert.equal(atlasStandingText({ contestedBy: [] }), "", "no dissent says nothing: there are no words for agreement");
  const contested = atlasStandingText(RELATIONSHIP(), sources);
  assert.equal(contested, "Disputed by A later editor.");
  assert.equal(atlasStandingText({ contestedBy: [{ by: { kind: "source", source: "plato-republic" } }, { by: { kind: "author" } }] }, sources), "Disputed by Πολιτεία; you.");
  for (const text of [contested, atlasConfidenceText({ confidence: "strong" }), atlasEvidenceText({ unsourced: true })]) {
    assert.doesNotMatch(text, /consensus|agreed|established|fact/i);
  }
  assert.equal(atlasConfidenceText({}), "Tentative");
  assert.equal(atlasEvidenceText({ unsourced: true }), "No evidence yet.");
  assert.equal(atlasEvidenceText({ evidence: [{}, {}] }), "On 2 pieces of evidence.");
  assert.equal(atlasLinkLine(RELATIONSHIP(), { entries: ENTRIES(), sources }), `${HOSTILE} authored Politeia — ${firmWords(RELATIONSHIP().confidence)} — ${atlasAttributionText(RELATIONSHIP().assertedBy, sources)} say so, on ${RELATIONSHIP().evidence.length} pieces of evidence`);
  assert.equal(atlasRelationshipSentence(RELATIONSHIP(), ENTRIES()), `${HOSTILE} authored Politeia`);
});

test("server diagnostics map to the control that fixes them", () => {
  assert.equal(atlasDiagnosticControl("dates[0].date.at.year", "entry"), "dating-0-at-value");
  assert.equal(atlasDiagnosticControl("dates[2].date.notBefore.month", "entry"), "dating-2-not-before-month");
  assert.equal(atlasDiagnosticControl("dates[1].date.notAfter", "entry"), "dating-1-not-after-precision");
  assert.equal(atlasDiagnosticControl("dates[1].date", "relationship"), "dating-1-form");
  assert.equal(atlasDiagnosticControl("dates[0].date.relative.aspect", "entry"), "dating-0-relative-aspect");
  assert.equal(atlasDiagnosticControl("dates[0].assertedBy.name", "entry"), "dating-0-asserted-name");
  assert.equal(atlasDiagnosticControl("dates[0].evidence[1].passage", "relationship"), "dating-0-evidence-1-passage");
  assert.equal(atlasDiagnosticControl("dates[0].evidence", "entry"), "dating-0-evidence");
  assert.equal(atlasDiagnosticControl("dates[3].visibility", "entry"), "dating-3-approved");
  assert.equal(atlasDiagnosticControl("dates[3].id", "entry"), "dating-3-id");
  assert.equal(atlasDiagnosticControl("dates", "entry"), "dates");
  assert.equal(atlasDiagnosticControl("visibility", "entry"), "approved");
  assert.equal(atlasDiagnosticControl("evidence[1].locators[0].kind", "relationship"), "evidence-1-locators");
  assert.equal(atlasDiagnosticControl("evidence", "relationship"), "evidence");
  assert.equal(atlasDiagnosticControl("assertedBy.name", "relationship"), "asserted-name");
  assert.equal(atlasDiagnosticControl("contestedBy[0].by.source", "relationship"), "dissent-0-source");
  assert.equal(atlasDiagnosticControl("contestedBy[2].evidence[0].passage", "relationship"), "dissent-2-evidence-0-passage");
  assert.equal(atlasDiagnosticControl("contestedBy[1]", "relationship"), "dissent-1");
  assert.equal(atlasDiagnosticControl("to", "relationship"), "to");
  const message = atlasErrorMessage({ data: { diagnostics: [{ code: "cycle", collection: "relationships", id: "a-b", field: "to", message: "part of a cycle" }] } });
  assert.equal(message, "cycle a-b to: part of a cycle", "the server's own sentence, for the details");
});

test("payloads keep unknown fields at every level the form edits", () => {
  const entry = atlasEntryDraft(ENTRIES()[1]);
  entry.label = "  Republic ";
  const sent = atlasEntryPayload(entry);
  assert.deepEqual(sent.dates, ENTRIES()[1].dates, "datings, precision and unknown fields are carried over unchanged");
  assert.equal(sent.bounds, undefined);
  assert.equal(sent.label, "Republic");
  assert.equal(sent.source, "plato-republic");
  const person = atlasEntryDraft(ENTRIES()[0]);
  person.aliases = "Aristocles\n\n  Platon  ";
  assert.deepEqual(atlasEntryPayload(person).aliases, ["Aristocles", "Platon"]);
  assert.equal(atlasEntryPayload(person).shelf, 1);
  assert.equal(atlasEntryPayload(person).visibility, "private");

  const draft = atlasRelationshipDraft(RELATIONSHIP());
  const same = atlasRelationshipPayload(draft);
  assert.deepEqual(same, RELATIONSHIP(), "an untouched relationship round-trips exactly");
  draft.evidence[0].locators = "page: 515";
  draft.contestedBy[0].note = "Changed.";
  const edited = atlasRelationshipPayload(draft);
  assert.equal(edited.evidence[0].margin, "kept");
  assert.deepEqual(edited.evidence[0].locators, [{ kind: "page", value: "515" }]);
  assert.equal(edited.contestedBy[0].tag, "kept");
  assert.equal(edited.assertedBy.why, "kept");
  assert.equal(edited.extra, 7);
  const unsourced = atlasRelationshipDraft({ id: "r", kind: "influenced", from: "plato", to: "allegory", assertedBy: { kind: "author" }, unsourced: true });
  assert.equal(atlasRelationshipPayload(unsourced).unsourced, true);
  assert.equal(atlasRelationshipPayload(unsourced).evidence, undefined);
});

test("advisory checks name the first problem and the control for it", () => {
  const context = { entries: ENTRIES(), kinds: KINDS(), sources: SOURCES(), passages: PASSAGES() };
  const base = () => atlasRelationshipDraft({ id: "r", kind: "influenced", from: "plato", to: "allegory", assertedBy: { kind: "author" } });
  assert.equal(validateAtlasRelationshipDraft(atlasRelationshipDraft(null), context).field, "kind");
  const wrong = base();
  wrong.kind = "authored";
  wrong.to = "allegory";
  assert.equal(validateAtlasRelationshipDraft(wrong, context).field, "to");
  assert.equal(validateAtlasRelationshipDraft(base(), context).field, "evidence");
  const strong = base();
  strong.unsourced = true;
  strong.confidence = "strong";
  assert.equal(validateAtlasRelationshipDraft(strong, context).field, "confidence");
  const approved = base();
  approved.evidence = [atlasEvidenceDraft({ source: "slings-2003", passage: "passage-1" })];
  approved.approved = true;
  assert.equal(validateAtlasRelationshipDraft(approved, context).id, "atlas.showNoPassage");
  assert.match(sayId("atlas.showNoPassage"), /can't point into your notebook/);
  const mismatched = base();
  mismatched.evidence = [atlasEvidenceDraft({ source: "plato-republic", passage: "passage-1" })];
  assert.equal(validateAtlasRelationshipDraft(mismatched, context).field, "evidence-0-passage");
  const dissent = base();
  dissent.unsourced = true;
  dissent.contestedBy = [atlasDissentDraft({ by: { kind: "named", name: "X" } })];
  assert.equal(validateAtlasRelationshipDraft(dissent, context).field, "dissent-0-note");
  const named = base();
  named.unsourced = true;
  named.assertedBy.kind = "named";
  assert.equal(validateAtlasRelationshipDraft(named, context).field, "asserted-name");
  const ok = base();
  ok.unsourced = true;
  assert.equal(validateAtlasRelationshipDraft(ok, context), null);

  const entry = atlasEntryDraft(null, { kind: "person" });
  assert.equal(validateAtlasEntryDraft(entry, { creating: true }).field, "id");
  entry.id = "plato";
  assert.equal(validateAtlasEntryDraft(entry, { creating: true, used: ["plato"] }).field, "id");
  entry.id = "socrates";
  assert.equal(validateAtlasEntryDraft(entry, { creating: true }).field, "label");
  entry.label = "Socrates";
  assert.equal(validateAtlasEntryDraft(entry, { creating: true }), null);
});

test("the entry form names an entry's datings and keeps them, never flattening them to years", () => {
  assert.equal(atlasDatesText(0), "No datings yet.");
  assert.equal(atlasDatesText(3), "3 datings.");
  assert.equal(atlasEntryDraft(ENTRIES()[1]).datings.length, 1);
  assert.equal(atlasEntryDraft(ENTRIES()[0]).datings.length, 0);
  assert.equal(atlasEntryPayload(atlasEntryDraft(ENTRIES()[0])).dates, undefined);
});

test("a rebased draft takes each nested item from the stored index it was read from, and leaves new items alone", () => {
  const draft = atlasRelationshipDraft(RELATIONSHIP());
  draft.evidence.unshift(atlasEvidenceDraft({ source: "plato-republic" }));
  draft.contestedBy.push(atlasDissentDraft({ by: { kind: "named", name: "New" }, note: "Mine." }));
  const newer = RELATIONSHIP();
  newer.evidence[0].added = "elsewhere";
  newer.contestedBy[0].by.added = "elsewhere";
  rebaseAtlasRelationshipDraft(draft, newer);
  const sent = atlasRelationshipPayload(draft);
  assert.deepEqual(sent.evidence[0], { source: "plato-republic" }, "a new item has nothing to rebase onto");
  assert.equal(sent.evidence[1].added, "elsewhere", "a moved item still rests on the item it came from");
  assert.equal(sent.contestedBy[0].by.added, "elsewhere");
  assert.deepEqual(sent.contestedBy[1], { by: { kind: "named", name: "New" }, note: "Mine." });
  const gone = atlasRelationshipDraft(RELATIONSHIP());
  rebaseAtlasRelationshipDraft(gone, { ...RELATIONSHIP(), evidence: [], contestedBy: [] });
  assert.equal(atlasRelationshipPayload(gone).evidence[0].margin, "kept", "an item removed elsewhere keeps the copy the draft holds");
});

test("a rebased draft keeps its own copy of an item whose stored index now holds another item", () => {
  const record = RELATIONSHIP();
  record.evidence = [
    { source: "removed-elsewhere", passage: "p-0", own: "first" },
    { source: "slings-2003", passage: "p-1", own: "second" },
  ];
  record.contestedBy = [
    { by: { kind: "named", name: "Removed elsewhere" }, note: "Gone.", own: "first" },
    { by: { kind: "named", name: "A later editor" }, note: "Doubts the attribution.", own: "second" },
  ];
  const draft = atlasRelationshipDraft(record);
  draft.evidence.shift();
  draft.contestedBy.shift();
  const newer = RELATIONSHIP();
  newer.evidence = [{ source: "slings-2003", passage: "p-1", own: "second", added: "elsewhere" }];
  newer.contestedBy = [{ by: { kind: "named", name: "A later editor" }, note: "Doubts the attribution.", own: "second", added: "elsewhere" }];
  rebaseAtlasRelationshipDraft(draft, newer);
  const sent = atlasRelationshipPayload(draft);
  assert.deepEqual(sent.evidence, [{ source: "slings-2003", passage: "p-1", own: "second", added: "elsewhere" }], "the evidence item rests on its own stored copy, now at index 0, and never on another item at index 1");
  assert.equal(sent.contestedBy.length, 1);
  assert.equal(sent.contestedBy[0].own, "second", "the dissent keeps its own fields");
  assert.equal(sent.contestedBy[0].added, "elsewhere", "the dissent's party is unique in both lists, so it rests on its own stored copy, now at index 0");

  const shifted = atlasRelationshipDraft(record);
  const elsewhere = RELATIONSHIP();
  elsewhere.evidence = [{ source: "slings-2003", passage: "p-1", own: "second" }];
  elsewhere.contestedBy = [{ by: { kind: "named", name: "A later editor" }, note: "Doubts the attribution.", own: "second" }];
  rebaseAtlasRelationshipDraft(shifted, elsewhere);
  const kept = atlasRelationshipPayload(shifted);
  assert.deepEqual(kept.evidence.map((item) => item.own), ["first", "second"], "an item removed elsewhere ahead of the draft's items neither loses nor borrows fields");
  assert.deepEqual(kept.contestedBy.map((item) => item.own), ["first", "second"]);
  assert.equal(kept.contestedBy[1].by.name, "A later editor");
});

// Two evidence items citing the same source and passage, told apart only by their locators.
const TWINS = () => [
  { source: "slings-2003", passage: "p-1", locators: [{ kind: "page", value: "1" }], own: "A" },
  { source: "slings-2003", passage: "p-1", locators: [{ kind: "page", value: "2" }], own: "B" },
];

const removedA = () => [{ ...TWINS()[1], added: "b" }];

const swapped = () => [
  { ...TWINS()[1], added: "b" },
  { ...TWINS()[0], added: "a" },
];

const checkTwins = (sent, expected, message) => {
  assert.deepEqual(sent.map((item) => [item.own, item.added, item.locators[0].value]), expected, message);
};

test("evidence citing the same source and passage twice never rests on the other item after a removal or a swap elsewhere", () => {
  const record = RELATIONSHIP();
  record.evidence = TWINS();
  record.contestedBy[0].evidence = TWINS();
  for (const [change, expected] of [
    [removedA, [["A", undefined, "1"], ["B", "b", "2"]]],
    [swapped, [["A", "a", "1"], ["B", "b", "2"]]],
  ]) {
    const draft = atlasRelationshipDraft(record);
    const newer = RELATIONSHIP();
    newer.evidence = change();
    newer.contestedBy[0].evidence = change();
    rebaseAtlasRelationshipDraft(draft, newer);
    const sent = atlasRelationshipPayload(draft);
    checkTwins(sent.evidence, expected, `relationship evidence after ${change.name}: A keeps its own fields and B takes only its own`);
    checkTwins(sent.contestedBy[0].evidence, expected, `dissent evidence after ${change.name}`);
  }
});

test("identical evidence items keep their own copy when the identical group changed size elsewhere", () => {
  const same = () => [{ source: "s", passage: "p", own: "A" }, { source: "s", passage: "p", own: "B" }];
  const record = { ...RELATIONSHIP(), evidence: same(), contestedBy: [] };
  const draft = atlasRelationshipDraft(record);
  rebaseAtlasRelationshipDraft(draft, { ...record, evidence: [{ ...same()[1], added: "b" }] });
  assert.deepEqual(atlasRelationshipPayload(draft).evidence.map((item) => [item.own, item.added]), [["A", undefined], ["B", undefined]]);
  // When the group is the same size the item at its own index is followed.
  const again = atlasRelationshipDraft(record);
  rebaseAtlasRelationshipDraft(again, { ...record, evidence: [{ ...same()[0], added: "a" }, same()[1]] });
  assert.deepEqual(atlasRelationshipPayload(again).evidence.map((item) => [item.own, item.added]), [["A", "a"], ["B", undefined]]);
});

test("a dating's evidence citing the same source and passage twice never rests on the other item after a removal or a swap elsewhere", () => {
  const stored = (evidence) => ({ id: "birth", aspect: "birth", date: { at: { year: -428 } }, assertedBy: { kind: "author" }, confidence: "tentative", evidence, visibility: "private" });
  for (const [change, expected] of [
    [removedA, [["A", undefined, "1"], ["B", "b", "2"]]],
    [swapped, [["A", "a", "1"], ["B", "b", "2"]]],
  ]) {
    const opened = [stored(TWINS())];
    const datings = opened.map((item) => atlasDatingDraft(item));
    rebaseAtlasDatings(datings, [stored(change())], opened);
    checkTwins(atlasDatingPayload(datings[0]).evidence, expected, `dating evidence after ${change.name}`);
  }
  // A pair only one item holds is still followed wherever it moves.
  const opened = [stored([{ source: "other", locators: [{ kind: "page", value: "9" }] }, TWINS()[0]])];
  const datings = opened.map((item) => atlasDatingDraft(item));
  rebaseAtlasDatings(datings, [stored([{ ...TWINS()[0], added: "a" }])], opened);
  const sent = atlasDatingPayload(datings[0]).evidence;
  assert.equal(sent[0].added, undefined, "an item removed elsewhere borrows nothing");
  assert.equal(sent[1].added, "a", "a moved item rests on its own newer copy");
});

// ---------------------------------------------------------------- chronology (ADR 0098)

const CHRONO_ENTRIES = () => {
  const entries = ENTRIES();
  entries[0].dates = [
    { id: "plato-born-a", aspect: "birth", date: { at: { year: -428, circa: true } }, assertedBy: { kind: "named", name: "Diogenes" }, confidence: "plausible", evidence: [{ source: "plato-republic" }], note: HOSTILE, visibility: "private" },
    { id: "plato-born-b", aspect: "birth", date: { at: { year: -427 } }, assertedBy: { kind: "author" }, confidence: "tentative", unsourced: true, visibility: "private" },
    { id: "plato-died", aspect: "death", date: { notAfter: { century: -6 } }, assertedBy: { kind: "author" }, confidence: "tentative", unsourced: true, visibility: "private" },
  ];
  entries[1].dates.push({ id: "politeia-after", aspect: "composition", date: { relative: { order: "after", entry: "plato", aspect: "birth" } }, assertedBy: { kind: "source", source: "plato-republic" }, confidence: "tentative", evidence: [{ source: "plato-republic" }], visibility: "approved" });
  entries[2].dates = [{ id: "allegory-unknown", aspect: "emergence", date: { unknown: true }, assertedBy: { kind: "author" }, confidence: "tentative", unsourced: true, visibility: "private" }];
  return entries;
};

const placed = (id, owner, index, field, aspect, text, placement, startYear = null, endYear = null) => ({ id, owner, collection: "entries", index, field, aspect, text, placement, startYear, endYear, projected: false });

const CHRONOLOGY = () => ({
  timeline: [
    placed("plato-died", "plato", 0, "dates[2]", "death", "not after 6th century BCE", "dated", null, -501),
    placed("plato-born-a", "plato", 0, "dates[0]", "birth", "c. 428 BCE", "dated", -428, -428),
    placed("plato-born-b", "plato", 0, "dates[1]", "birth", "427 BCE", "dated", -427, -427),
    placed("politeia-composed", "politeia", 1, "dates[0]", "composition", "not before c. 380 BCE", "dated", -380, null),
    placed("politeia-after", "politeia", 1, "dates[1]", "composition", "after `plato` birth", "relative"),
    placed("allegory-unknown", "allegory", 2, "dates[0]", "emergence", "unknown", "unknown"),
  ],
  prompts: [
    { code: "death-before-birth", collection: "entries", index: 0, id: "plato", field: "dates[2]", datings: ["plato-died", "plato-born-a"], message: "death dating `plato-died` (not after 6th century BCE) ends before birth dating `plato-born-a` (c. 428 BCE) can begin, so as recorded they cannot both hold. They come from different parties: check the values against the cited evidence; a recorded disagreement can stay side by side as it is." },
    { code: "death-before-birth", collection: "entries", index: 0, id: "plato", field: "dates[2]", datings: ["plato-died", "plato-born-b"], message: "death dating `plato-died` (not after 6th century BCE) ends before birth dating `plato-born-b` (427 BCE) can begin, so as recorded they cannot both hold. They come from the same party: check the values against the cited evidence." },
  ],
  unlisted: 0,
});

const chronoAtlas = (over = {}) => atlas({ entries: CHRONO_ENTRIES(), chronology: CHRONOLOGY(), ...over });

const VERDICTS = /consensus|agreed|established|most likely|accepted date|correct date|true date/i;

test("points and dates read back at their stated precision, BCE written out, exactly as the core writes them", () => {
  assert.equal(atlasPointText({ decade: -380 }), "the 380s BCE");
  assert.equal(atlasPointText({ decade: 1380, circa: true }), "c. 1380s CE");
  assert.equal(atlasPointText({ century: -4 }), "4th century BCE");
  assert.equal(atlasPointText({ century: 21 }), "21st century CE");
  assert.equal(atlasPointText({ century: 12 }), "12th century CE");
  assert.equal(atlasPointText({ year: -428, circa: true }), "c. 428 BCE");
  assert.equal(atlasPointText({ year: 1380 }), "1380 CE");
  assert.equal(atlasPointText({ year: -44, month: 3, day: 15, calendar: "julian" }), "15 Mar 44 BCE (julian)");
  assert.equal(atlasPointText({ year: 0 }), "", "there is no year 0");
  assert.equal(atlasDateText({ notBefore: { year: -387, circa: true }, notAfter: { year: -367 } }), "between c. 387 BCE and 367 BCE");
  assert.equal(atlasDateText({ notAfter: { century: -6 } }), "not after 6th century BCE");
  assert.equal(atlasDateText({ from: { decade: -390 } }), "from the 390s BCE");
  assert.equal(atlasDateText({ to: { year: 5 } }), "until 5 CE");
  assert.equal(atlasDateText({ unknown: true }), "unknown");
  assert.equal(atlasDateText({ relative: { order: "after", entry: "plato", aspect: "active" } }), "after plato active", "without entries, the key as it is");
  assert.equal(atlasDateText({ relative: { order: "after", entry: "plato", aspect: "active" } }, [{ id: "plato", label: "Plato" }]), "after the activity of Plato");
});

test("a dating round-trips exactly, keeps unknown fields at every level, and states BCE without a minus sign", () => {
  const stored = {
    id: "d1", aspect: "composition", shelf: { kept: true },
    date: { notBefore: { year: -387, circa: true, hint: 1 }, notAfter: { decade: -360 }, margin: 2 },
    assertedBy: { kind: "named", name: "Nails", why: "kept" }, confidence: "plausible",
    evidence: [{ source: "plato-republic", locators: [{ kind: "page", value: "9" }], tag: "kept" }],
    note: "Reckoned by archon years.", visibility: "approved",
  };
  const draft = atlasDatingDraft(stored);
  assert.deepEqual(atlasDatingPayload(draft), stored, "an untouched dating round-trips exactly");
  assert.equal(draft.form, "window");
  assert.deepEqual([draft.points.notBefore.magnitude, draft.points.notBefore.era, draft.points.notBefore.precision], ["387", "bce", "year"]);
  assert.deepEqual([draft.points.notAfter.magnitude, draft.points.notAfter.precision], ["360", "decade"]);
  draft.points.notBefore.magnitude = "390";
  draft.points.notBefore.circa = false;
  draft.note = "Edited.";
  const edited = atlasDatingPayload(draft);
  assert.deepEqual(edited.date, { notBefore: { year: -390, hint: 1 }, notAfter: { decade: -360 }, margin: 2 });
  assert.equal(edited.shelf.kept, true);
  assert.equal(edited.assertedBy.why, "kept");
  assert.equal(edited.evidence[0].tag, "kept");
  // Switching form keeps the date's own unknown fields and only the slots of the new form.
  draft.form = "at";
  draft.points.at = { ...draft.points.at, precision: "day", magnitude: "44", era: "bce", month: "3", day: "15", calendar: "julian" };
  assert.deepEqual(atlasDatingPayload(draft).date, { at: { year: -44, month: 3, day: 15, calendar: "julian" }, margin: 2 });
  assert.equal(atlasDatingReading(draft), "15 Mar 44 BCE (julian)");
  draft.points.at.precision = "century";
  draft.points.at.magnitude = "4";
  assert.deepEqual(atlasDatingPayload(draft).date.at, { century: -4 }, "a calendar only goes with a month");
  // An open end stays open, and a stored open start is not filled in.
  const open = atlasDatingDraft({ id: "d2", aspect: "active", date: { to: { year: -347 } }, assertedBy: { kind: "author" }, confidence: "tentative", unsourced: true, visibility: "private" });
  assert.equal(open.points.from.precision, "open");
  assert.deepEqual(atlasDatingPayload(open).date, { to: { year: -347 } });
  const relative = atlasDatingDraft({ id: "d3", aspect: "composition", date: { relative: { order: "after", entry: "phaedo", aspect: "composition", why: "kept" } }, assertedBy: { kind: "author" }, confidence: "tentative", unsourced: true, visibility: "private" });
  assert.deepEqual(atlasDatingPayload(relative).date, { relative: { order: "after", entry: "phaedo", aspect: "composition", why: "kept" } });
  const unknown = atlasDatingDraft({ id: "d4", aspect: "birth", date: { unknown: true }, assertedBy: { kind: "author" }, confidence: "tentative", unsourced: true, visibility: "private" });
  assert.deepEqual(atlasDatingPayload(unknown).date, { unknown: true });
  assert.equal(atlasDatingReading(atlasDatingDraft(null, { aspect: "birth" })), "not complete yet");
});

test("advisory dating checks constrain the aspect by kind and name the control to fix", () => {
  const context = (over = {}) => ({ owner: "person", ownerId: "plato", kinds: KINDS(), entries: ENTRIES(), sources: SOURCES(), passages: PASSAGES(), used: ["plato", "politeia"], ...over });
  const dating = (over = {}) => Object.assign(atlasDatingDraft({ id: "plato-born", aspect: "birth", date: { at: { year: -428 } }, assertedBy: { kind: "author" }, confidence: "tentative", unsourced: true, visibility: "private" }), over);
  const field = (list, over) => validateAtlasDatings(list, context(over))?.field ?? null;
  assert.equal(field([dating()]), null);
  assert.equal(field([dating({ id: "Plato Born" })]), "dating-0-id");
  assert.equal(field([dating({ id: "politeia" })]), "dating-0-id", "one identifier space");
  assert.equal(field([dating(), dating()]), "dating-1-id");
  assert.equal(field([dating({ aspect: "composition" })]), "dating-0-aspect", "a person has no composition");
  assert.equal(field([dating({ aspect: "span" })], { owner: "relationship", ownerId: "" }), null);
  assert.equal(field([dating()], { owner: "relationship", ownerId: "" }), "dating-0-aspect", "a relationship is dated only by its span");
  assert.equal(field([dating({ form: "range" })]), "dating-0-form", "a birth is a window, not a duration");
  const year = (magnitude, precision = "year", extra = {}) => dating({ points: { ...dating().points, at: { ...dating().points.at, magnitude, precision, ...extra } } });
  assert.equal(field([year("0")]), "dating-0-at-value", "there is no year 0");
  assert.equal(field([year("-428")]), "dating-0-at-value", "BCE is chosen, never typed as a minus sign");
  assert.equal(field([year("385", "decade")]), "dating-0-at-value");
  assert.equal(field([year("380", "decade")]), null);
  assert.equal(field([year("428", "month")]), "dating-0-at-month");
  assert.equal(field([year("428", "day", { month: "2", day: "30" })]), "dating-0-at-day");
  assert.equal(field([year("428", "day", { month: "2", day: "29" })]), null, "February may have 29 days");
  const window = (start, end) => {
    const value = dating({ form: "window" });
    value.points.notBefore = { ...value.points.notBefore, ...start };
    value.points.notAfter = { ...value.points.notAfter, ...end };
    return value;
  };
  assert.equal(field([window({ precision: "open" }, { precision: "open" })]), "dating-0-not-before-precision");
  assert.equal(field([window({ precision: "year", magnitude: "300", era: "bce" }, { precision: "year", magnitude: "400", era: "bce" })]), "dating-0-not-after-value", "a window that starts after it ends");
  assert.equal(field([window({ precision: "year", magnitude: "400", era: "bce" }, { precision: "century", magnitude: "4", era: "bce" })]), null);
  const relative = (rel) => dating({ aspect: "death", form: "relative", relative: { extras: {}, order: "after", entry: "", aspect: "", ...rel } });
  assert.equal(field([relative({})]), "dating-0-relative-entry");
  assert.equal(field([relative({ entry: "politeia", aspect: "birth" })]), "dating-0-relative-aspect", "a work has no birth");
  assert.equal(field([relative({ entry: "politeia", aspect: "publication", order: "during" })]), "dating-0-relative-aspect", "during needs an aspect that lasts");
  assert.equal(field([relative({ entry: "plato", aspect: "death" })]), "dating-0-relative-aspect", "not against the aspect it dates");
  assert.equal(field([relative({ entry: "politeia", aspect: "composition", order: "during" })]), null);
  assert.equal(field([dating({ unsourced: false })]), "dating-0-evidence");
  assert.equal(field([dating({ confidence: "strong" })]), "dating-0-confidence");
  assert.equal(field([dating({ approved: true })]), "dating-0-approved");
  assert.equal(field([dating({ unsourced: false, approved: true, evidence: [atlasEvidenceDraft({ source: "slings-2003", passage: "passage-1" })] })]), "dating-0-approved");
  const named = dating();
  named.assertedBy.kind = "named";
  assert.equal(field([named]), "dating-0-asserted-name");
});

test("a dating draft rests on the newer stored datings by identity, never by position", () => {
  const stored = (id, over = {}) => ({ id, aspect: "birth", date: { at: { year: -428 } }, assertedBy: { kind: "author" }, confidence: "tentative", unsourced: true, visibility: "private", ...over });
  const opened = [stored("a"), stored("b", { date: { at: { year: -427 } } }), stored("gone-here"), stored("gone-there")];
  const datings = opened.map((item) => atlasDatingDraft(item));
  datings.splice(2, 1); // the author removes `gone-here`
  datings[1].note = "Mine.";
  datings.push(atlasDatingDraft(null, { id: "new", aspect: "death" }));
  // Elsewhere: the list is reordered, `gone-there` removed, `c` added, and fields added to `a` and `b`.
  const newer = [
    stored("c", { aspect: "death" }),
    stored("b", { date: { at: { year: -427, hint: "elsewhere" }, margin: 1 }, shelf: "elsewhere" }),
    stored("gone-here"),
    stored("a", { assertedBy: { kind: "author", why: "elsewhere" } }),
  ];
  const added = rebaseAtlasDatings(datings, newer, opened);
  assert.equal(added, 1);
  const sent = datings.map(atlasDatingPayload);
  assert.deepEqual(sent.map((item) => item.id), ["a", "b", "gone-there", "new", "c"]);
  assert.equal(sent[0].assertedBy.why, "elsewhere", "a moved dating rests on its own newer copy");
  assert.deepEqual(sent[1].date, { at: { year: -427, hint: "elsewhere" }, margin: 1 });
  assert.equal(sent[1].shelf, "elsewhere");
  assert.equal(sent[1].note, "Mine.", "the draft's own edit wins");
  assert.equal(sent[2].shelf, undefined, "a dating removed elsewhere keeps the draft's copy and borrows nothing");
  assert.ok(!sent.some((item) => item.id === "gone-here"), "a dating the author removed is not brought back");

  const entry = atlasEntryDraft({ ...ENTRIES()[1] });
  entry.label = "Republic";
  const current = { ...ENTRIES()[1], added: "elsewhere" };
  current.dates = [{ ...current.dates[0], shelf: "elsewhere" }];
  rebaseAtlasEntryDraft(entry, current);
  const payload = atlasEntryPayload(entry);
  assert.equal(payload.added, "elsewhere");
  assert.equal(payload.dates[0].shelf, "elsewhere");
  assert.equal(payload.label, "Republic");
});

test("the chronology model keeps competing datings together and never flattens them under a filter", () => {
  const state = { entries: CHRONO_ENTRIES(), relationships: [], chronology: CHRONOLOGY(), kinds: KINDS(), sources: SOURCES() };
  const all = atlasChronologyModel(state, {});
  assert.deepEqual(all.rows.map((row) => row.key), ["entries:plato:death", "entries:plato:birth", "entries:politeia:composition", "entries:allegory:emergence"]);
  assert.deepEqual(all.rows[1].datings.map((dating) => dating.id), ["plato-born-a", "plato-born-b"], "competing datings side by side, in the index's order");
  assert.deepEqual(all.groups.map((group) => group.label), ["No earliest date stated", "5th century BCE", "4th century BCE"]);
  assert.deepEqual(all.unplaced.map((row) => row.key), ["entries:allegory:emergence"], "an unknown date is never placed in time");
  assert.deepEqual(all.relative.map(({ dating }) => dating.id), ["politeia-after"]);
  assert.equal(all.rows[0].datings[0].prompts, 2);
  assert.equal(atlasChronologyStatus(all, {}), "6 of 6 datings");

  const narrow = { fromYear: "430", fromEra: "bce", toYear: "428", toEra: "bce", zoom: "decade" };
  const windowed = atlasChronologyModel(state, narrow);
  assert.deepEqual(windowed.groups.map((group) => group.rows.map((row) => row.key)), [["entries:plato:birth"]]);
  assert.equal(windowed.groups[0].label, "the 420s BCE");
  const [inside, outside] = windowed.groups[0].rows[0].datings;
  assert.deepEqual([inside.inWindow, outside.inWindow], [true, false], "the competitor outside the window stays, marked");
  assert.deepEqual(windowed.unplaced.map((row) => row.key), ["entries:allegory:emergence"]);
  assert.equal(atlasChronologyStatus(windowed, narrow), "3 of 6 datings · from 430 BCE · to 428 BCE");

  assert.deepEqual(atlasChronologyModel(state, { aspect: "birth" }).groups.flatMap((group) => group.rows.map((row) => row.key)), ["entries:plato:birth"]);
  assert.deepEqual(atlasChronologyModel(state, { competing: true }).groups.flatMap((group) => group.rows.map((row) => row.key)), ["entries:plato:birth", "entries:politeia:composition"]);
  assert.deepEqual(atlasChronologyModel(state, { prompted: true }).groups.flatMap((group) => group.rows.map((row) => row.key)), ["entries:plato:death", "entries:plato:birth"]);
  assert.deepEqual(atlasChronologyModel(state, { query: "politeia" }).groups.flatMap((group) => group.rows.map((row) => row.key)), ["entries:politeia:composition"]);
  assert.equal(atlasChronologyModel(state, { zoom: "none" }).groups.length, 1);
  assert.equal(atlasChronologyWindow({ fromYear: "300", fromEra: "bce", toYear: "400", toEra: "bce" }).problem, "atlas.windowReversed");
  assert.equal(atlasChronologyWindow({ fromYear: "0" }).problem, "atlas.windowBad", "there is no year 0");
  assert.equal(atlasChronologyGroupLabel(-428, "century"), "5th century BCE");
  assert.equal(atlasChronologyGroupLabel(-400, "century"), "4th century BCE");
  assert.equal(atlasChronologyGroupLabel(-1, "decade"), "1–9 BCE");
  assert.equal(atlasChronologyGroupLabel(1, "century"), "1st century CE");
  assert.equal(atlasChronologyGroupLabel(1999, "decade"), "the 1990s CE");
  assert.equal(atlasChronologyGroupLabel(-44, "year"), "44 BCE");
  const empty = atlasChronologyModel({ entries: [], relationships: [], chronology: { timeline: [], prompts: [], unlisted: 0 } }, {});
  assert.equal(atlasChronologyStatus(empty, {}), "0 of 0 datings");
});

test("a save says whether the published atlas was rebuilt, only when the site publishes it", () => {
  assert.equal(atlasBuildText(undefined), "");
  assert.equal(atlasBuildText({ ok: true, files: 9 }), "atlas.rebuilt");
  assert.equal(atlasBuildText({ ok: false, error: "x" }), "atlas.rebuildFailed");
  assert.equal(atlasBuildText({ ok: true, pending: true }), "", "a deferred build hasn't run");
  assert.match(sayId("atlas.rebuildFailed"), /Tell /);
});

test("atlas code never parses text as markup and announces changes", () => {
  const read = (path) => readFileSync(new URL(`../../web/studio/${path}`, import.meta.url), "utf8");
  const code = ["parts/atlas-rules.js", "parts/atlas-form.js", "parts/atlas-dates.js", "parts/chronology.js", "screens/atlas.js"].map(read).join("\n");
  assert.doesNotMatch(code, /innerHTML|insertAdjacentHTML|outerHTML|createContextualFragment|<canvas|<svg/);
  assert.match(code, /role: "alert"/);
  assert.match(code, /"aria-live": "polite"/);
  assert.match(code, /h\("legend"/);
});


test("years are typed as plain years with BCE or CE: no year 0, and 1 BCE is -1 (decision 13)", () => {
  assert.equal(eraYear("1", "bce"), -1);
  assert.equal(eraYear("428", "bce"), -428);
  assert.equal(eraYear("1066", "ce"), 1066);
  assert.ok(Number.isNaN(eraYear("0", "bce")), "there is no year 0");
  assert.ok(Number.isNaN(eraYear("-5", "ce")), "never a negative number");
  assert.ok(Number.isNaN(eraYear("", "ce")));
  assert.deepEqual(yearEra(-1), { year: "1", era: "bce" });
  assert.deepEqual(yearEra(-428), { year: "428", era: "bce" });
  assert.deepEqual(yearEra(2026), { year: "2026", era: "ce" });
  assert.deepEqual(yearEra(0), { year: "", era: "ce" });
  for (const year of [-1, -428, 1, 2026]) { const back = yearEra(year); assert.equal(eraYear(back.year, back.era), year); }
});

test("a BCE dating with circa and decade precision saves at its stated precision and reads back the same", () => {
  const draft = atlasDatingDraft(null, { id: "plato-birth", aspect: "birth" });
  draft.points.at = { ...draft.points.at, precision: "decade", magnitude: "420", era: "bce", circa: true };
  const record = atlasDatingPayload(draft);
  assert.deepEqual(record.date, { at: { decade: -420, circa: true } });
  assert.equal(atlasDateText(record.date), "c. 420s BCE");
  const again = atlasDatingDraft(record);
  assert.deepEqual([again.points.at.precision, again.points.at.magnitude, again.points.at.era, again.points.at.circa], ["decade", "420", "bce", true]);
  assert.deepEqual(atlasDatingPayload(again).date, record.date, "opened and saved again, the same");
});
